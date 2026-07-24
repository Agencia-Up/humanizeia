import * as net from "net";

// Interfaces injetáveis para isolamento total em testes offline
export interface DnsResolver {
  resolve(hostname: string): Promise<string[]>;
  lookup(hostname: string): Promise<string>;
}

export interface HttpTransport {
  fetch(url: string, init?: RequestInit): Promise<Response>;
}

export interface Sleeper {
  sleep(ms: number): Promise<void>;
}

// Implementações reais padrão
export class RealDnsResolver implements DnsResolver {
  async resolve(hostname: string): Promise<string[]> {
    const dns = await import("dns/promises");
    return dns.resolve(hostname);
  }
  async lookup(hostname: string): Promise<string> {
    const dns = await import("dns/promises");
    const res = await dns.lookup(hostname);
    return res.address;
  }
}

export class RealHttpTransport implements HttpTransport {
  async fetch(url: string, init?: RequestInit): Promise<Response> {
    return fetch(url, init);
  }
}

export class RealSleeper implements Sleeper {
  async sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

const ALLOWED_HOSTS_BY_PROVIDER: Record<string, Set<string>> = {
  revendamais: new Set(["app.revendamais.com.br"]),
  bndv: new Set(["api-estoque.azurewebsites.net"])
};

const MAX_REDIRECTS = 3;
const MAX_RESPONSE_BYTES = 15 * 1024 * 1024; // 15 Megabytes

export type SafeRequestOptions = {
  readonly method?: "GET" | "POST";
  readonly headers?: Record<string, string>;
  readonly body?: string;
  readonly timeoutMs?: number;
  readonly maxRetries?: number;
  readonly provider: "revendamais" | "bndv";
  // Por padrão a resposta DEVE ser application/json (feeds/estoque). O endpoint BNDV /login pode devolver o token
  // como texto puro; só ESSE caso passa expectJson:false. Todas as demais travas (SSRF/IP/host/tamanho/redirect)
  // continuam valendo — some apenas a exigência de content-type JSON.
  readonly expectJson?: boolean;
};

// Verifica se um IP é privado, loopback ou link-local
export function isPrivateIp(ip: string): boolean {
  if (!net.isIP(ip)) return true;

  if (net.isIPv4(ip)) {
    const parts = ip.split(".").map(Number);
    if (parts[0] === 127) return true; // Loopback
    if (parts[0] === 10) return true; // Class A private
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true; // Class B private
    if (parts[0] === 192 && parts[1] === 168) return true; // Class C private
    if (parts[0] === 169 && parts[1] === 254) return true; // Link-local
    return false;
  } else {
    const norm = ip.toLowerCase();
    if (norm === "::1" || norm === "::") return true;
    if (norm.startsWith("fc") || norm.startsWith("fd")) return true; // Unique Local
    if (norm.startsWith("fe8") || norm.startsWith("fe9") || norm.startsWith("fea") || norm.startsWith("feb")) return true; // Link-local
    return false;
  }
}

function hasSensitiveHeader(headers: Record<string, string>): boolean {
  const sensitive = ["authorization", "apikey", "cookie", "x-api-key", "token"];
  return Object.keys(headers).some(h => sensitive.includes(h.toLowerCase()));
}

export class SafeHttpClient {
  constructor(
    private readonly dns: DnsResolver = new RealDnsResolver(),
    private readonly transport: HttpTransport = new RealHttpTransport(),
    private readonly sleeper: Sleeper = new RealSleeper()
  ) {}

  // Valida a URL e o Host baseado no provedor
  validateUrl(urlString: string, provider: "revendamais" | "bndv"): URL {
    let url: URL;
    try {
      url = new URL(urlString);
    } catch {
      throw new Error("INVALID_URL_FORMAT");
    }

    // F2.7.2: feeds legados do v2 vem cadastrados como http:// (ex.: app.revendamais.com.br). Em vez de
    // rejeitar (quebrando o estoque), NORMALIZAMOS http->https. Isso e ESTRITAMENTE mais seguro que recusar
    // (sempre buscamos https) e nao abre superficie: a allowlist de host abaixo + o anti-SSRF de IP continuam
    // barrando qualquer host nao previsto. (Reverte a decisao "rejeitar http" — sinalizado p/ auditoria do Codex.)
    if (url.protocol === "http:") {
      url.protocol = "https:";
    }
    if (url.protocol !== "https:") {
      throw new Error("HTTPS_REQUIRED");
    }

    const allowed = ALLOWED_HOSTS_BY_PROVIDER[provider];
    if (!allowed || !allowed.has(url.hostname.toLowerCase())) {
      throw new Error("HOST_NOT_ALLOWED_BY_POLICY");
    }

    return url;
  }

  // Resolve o hostname para IP e valida
  async validateHostIp(host: string): Promise<void> {
    try {
      const addresses = await this.dns.resolve(host).catch(async () => {
        const addr = await this.dns.lookup(host);
        return [addr];
      });

      for (const addr of addresses) {
        if (isPrivateIp(addr)) {
          throw new Error("SSRF_IP_BLOCKED");
        }
      }
    } catch (err) {
      if ((err as any).message === "SSRF_IP_BLOCKED") throw err;
      throw new Error("DNS_RESOLUTION_FAILED");
    }
  }

  // Executa requisição HTTPS de forma segura e blindada com tratamento sanitizado de erros
  async safeFetch(
    urlString: string,
    options: SafeRequestOptions
  ): Promise<{ text: string; contentType: string }> {
    const method = options.method || "GET";
    const timeoutMs = options.timeoutMs || 10000;
    const maxRetries = method === "GET" ? (options.maxRetries ?? 2) : 0;

    let attempt = 0;
    while (true) {
      try {
        return await this.executeSingleFetch(urlString, method, options);
      } catch (err) {
        attempt++;
        const errMsg = (err as any).message || "UNKNOWN_HTTP_ERROR";
        const isTimeoutOrNetwork = errMsg === "TIMEOUT" || errMsg === "NETWORK_ERROR";

        if (attempt > maxRetries || !isTimeoutOrNetwork) {
          // Erros NUNCA podem conter a URL completa, tokens ou headers
          throw new Error(`SAFE_FETCH_FAILURE: ${errMsg}`);
        }
        await this.sleeper.sleep(300 * attempt);
      }
    }
  }

  private async executeSingleFetch(
    urlString: string,
    method: "GET" | "POST",
    options: SafeRequestOptions
  ): Promise<{ text: string; contentType: string }> {
    let currentUrlString = urlString;
    let redirectsCount = 0;

    const timeoutMs = options.timeoutMs || 10000;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      while (true) {
        const url = this.validateUrl(currentUrlString, options.provider);
        // Usa a URL JA validada/normalizada (https) no fetch e na base de redirect — nao a string crua
        // (que poderia ser http). Garante o invariante "so buscamos https" de fato no transporte (F2.7.2).
        currentUrlString = url.toString();
        await this.validateHostIp(url.hostname);

        const res = await this.transport.fetch(currentUrlString, {
          method,
          headers: {
            ...options.headers,
            "Accept-Encoding": "identity",
          },
          body: method === "POST" ? options.body : undefined,
          redirect: "manual",
          signal: controller.signal
        }).catch(err => {
          if (err.name === "AbortError" || controller.signal.aborted) throw new Error("TIMEOUT");
          throw new Error("NETWORK_ERROR");
        });

        // Trata redirect manual
        if ([301, 302, 307, 308].includes(res.status)) {
          redirectsCount++;
          if (redirectsCount > MAX_REDIRECTS) {
            throw new Error("TOO_MANY_REDIRECTS");
          }
          const location = res.headers.get("location");
          if (!location) {
            throw new Error("REDIRECT_MISSING_LOCATION");
          }

          const nextUrlString = new URL(location, currentUrlString).toString();

          // Validação cross-origin e vazamento de headers sensíveis
          const prevUrl = new URL(currentUrlString);
          const nextUrl = new URL(nextUrlString);
          const originChanged = prevUrl.origin !== nextUrl.origin;

          if (originChanged && hasSensitiveHeader(options.headers || {})) {
            throw new Error("SSRF_REDIRECT_BLOCKED_SENSITIVE_HEADER");
          }

          currentUrlString = nextUrlString;
          continue;
        }

        if (!res.ok) {
          throw new Error(`HTTP_STATUS_${res.status}`);
        }

        const contentType = res.headers.get("content-type") || "";

        // Validação de content-type obrigatória também no GET — EXCETO quando o chamador declara expectJson:false
        // (só o BNDV /login, que pode devolver o token como texto puro). Todas as outras travas seguem ativas.
        if (options.expectJson !== false && !contentType.toLowerCase().includes("application/json")) {
          throw new Error("INVALID_CONTENT_TYPE");
        }

        // Validação do content-length antes de ler (se disponível)
        const contentLengthHeader = res.headers.get("content-length");
        if (contentLengthHeader) {
          const length = Number(contentLengthHeader);
          if (Number.isFinite(length) && length > MAX_RESPONSE_BYTES) {
            throw new Error("RESPONSE_TOO_LARGE");
          }
        }

        // Lê chunks de forma segura limitando bytes máximos
        const reader = res.body?.getReader();
        if (!reader) {
          const text = await res.text();
          if (Buffer.byteLength(text) > MAX_RESPONSE_BYTES) {
            throw new Error("RESPONSE_TOO_LARGE");
          }
          return { text, contentType };
        }

        let accumulatedBytes = 0;
        const chunks: Uint8Array[] = [];

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            if (value) {
              accumulatedBytes += value.byteLength;
              if (accumulatedBytes > MAX_RESPONSE_BYTES) {
                throw new Error("RESPONSE_TOO_LARGE");
              }
              chunks.push(value);
            }
          }
        } finally {
          reader.releaseLock();
        }

        // Concatena e converte para string
        const concatenated = new Uint8Array(accumulatedBytes);
        let offset = 0;
        for (const chunk of chunks) {
          concatenated.set(chunk, offset);
          offset += chunk.byteLength;
        }

        const text = new TextDecoder().decode(concatenated);
        return { text, contentType };
      }
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
