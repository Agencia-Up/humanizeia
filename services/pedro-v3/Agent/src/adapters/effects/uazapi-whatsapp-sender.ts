import type { CredentialProvider, SecretRef } from "../../domain/credential-provider.ts";
import type { WhatsAppMediaInput, WhatsAppSendPort, WhatsAppSendResult, WhatsAppTextInput } from "./whatsapp-dispatcher.ts";

export type UazapiHttpRequest = {
  readonly method: "POST";
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  readonly signal: AbortSignal;
};

export type UazapiHttpResponse = {
  readonly ok: boolean;
  readonly status: number;
  readonly json?: unknown;
  readonly text?: string;
};

export interface UazapiHttpTransport {
  postJson(url: string, request: UazapiHttpRequest): Promise<UazapiHttpResponse>;
}

export type UazapiSenderConfig = {
  readonly baseUrl: string;
  readonly allowedHosts: readonly string[];
  readonly instanceName?: string | null;
  readonly tokenRef: SecretRef;
  readonly timeoutMs?: number;
  readonly typingDelay?: {
    readonly minMs?: number;
    readonly maxMs?: number;
    readonly sleep?: (ms: number) => Promise<void>;
  };
};

export class UazapiSenderError extends Error {
  constructor(public readonly code:
    | "UAZAPI_BASE_URL_INVALID"
    | "UAZAPI_HOST_NOT_ALLOWED"
    | "UAZAPI_CONFIG_INVALID") {
    super(code);
    this.name = "UazapiSenderError";
  }
}

function parseBaseUrl(baseUrl: string, allowedHosts: readonly string[]): URL {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new UazapiSenderError("UAZAPI_BASE_URL_INVALID");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new UazapiSenderError("UAZAPI_BASE_URL_INVALID");
  }
  if (!Array.isArray(allowedHosts) || allowedHosts.length === 0) {
    throw new UazapiSenderError("UAZAPI_HOST_NOT_ALLOWED");
  }
  const hosts = new Set(allowedHosts.map((host) => host.toLowerCase()));
  if (!hosts.has(url.hostname.toLowerCase())) throw new UazapiSenderError("UAZAPI_HOST_NOT_ALLOWED");
  return url;
}

function appendPath(base: URL, path: string): string {
  const out = new URL(base.toString());
  const prefix = out.pathname.replace(/\/+$/, "");
  out.pathname = `${prefix}${path}`;
  out.search = "";
  out.hash = "";
  return out.toString();
}

function digitsOnly(value: string): string {
  return value.replace(/\D+/g, "");
}

export function normalizeUazapiDestination(value: string): string | null {
  const digits = digitsOnly(value);
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  if (digits.length >= 12 && digits.length <= 13) return digits;
  return null;
}

function safeIdFromResponse(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  for (const key of ["messageid", "messageId", "message_id", "id", "key"]) {
    const raw = record[key];
    if (typeof raw === "string" && raw.trim().length > 0 && raw.length <= 160) return raw;
  }
  const data = record.data;
  if (typeof data === "object" && data !== null && !Array.isArray(data)) {
    return safeIdFromResponse(data);
  }
  return undefined;
}

function failure(message: string, retryable: boolean): WhatsAppSendResult {
  return { ok: false, code: "UPSTREAM", message, retryable };
}

function timeoutFailure(): WhatsAppSendResult {
  return { ok: false, code: "TIMEOUT", message: "uazapi_timeout", retryable: true };
}

function validationFailure(message: string): WhatsAppSendResult {
  return { ok: false, code: "VALIDATION", message, retryable: false };
}

function delayForTyping(text: string, minMs: number, maxMs: number): number {
  const estimated = Math.round(text.trim().length * 45);
  return Math.max(minMs, Math.min(maxMs, estimated));
}

export class UazapiWhatsAppSender implements WhatsAppSendPort {
  readonly endpointBase: string;
  readonly timeoutMs: number;
  readonly #credentialProvider: CredentialProvider;
  readonly #transport: UazapiHttpTransport;
  readonly #tokenRef: SecretRef;
  readonly #instanceName: string | null;
  readonly #typingMinMs: number;
  readonly #typingMaxMs: number;
  readonly #sleep: (ms: number) => Promise<void>;

  constructor(config: UazapiSenderConfig, credentialProvider: CredentialProvider, transport: UazapiHttpTransport) {
    const base = parseBaseUrl(config.baseUrl, config.allowedHosts);
    const timeoutMs = config.timeoutMs ?? 15_000;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) {
      throw new UazapiSenderError("UAZAPI_CONFIG_INVALID");
    }
    if (config.tokenRef.provider !== "uazapi" || config.tokenRef.purpose !== "whatsapp_instance") {
      throw new UazapiSenderError("UAZAPI_CONFIG_INVALID");
    }
    this.endpointBase = base.toString().replace(/\/+$/, "");
    this.timeoutMs = timeoutMs;
    this.#credentialProvider = credentialProvider;
    this.#transport = transport;
    this.#tokenRef = config.tokenRef;
    this.#instanceName = typeof config.instanceName === "string" && config.instanceName.trim() ? config.instanceName.trim() : null;
    const typingMinMs = config.typingDelay?.minMs ?? 700;
    const typingMaxMs = config.typingDelay?.maxMs ?? 2_800;
    if (!Number.isInteger(typingMinMs) || !Number.isInteger(typingMaxMs) || typingMinMs < 0 || typingMaxMs < typingMinMs || typingMaxMs > 10_000) {
      throw new UazapiSenderError("UAZAPI_CONFIG_INVALID");
    }
    this.#typingMinMs = typingMinMs;
    this.#typingMaxMs = typingMaxMs;
    this.#sleep = config.typingDelay?.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  toJSON(): Record<string, unknown> {
    return {
      endpointBase: this.endpointBase,
      timeoutMs: this.timeoutMs,
      tokenRef: this.#tokenRef,
      hasInstanceName: this.#instanceName !== null,
      typing: { minMs: this.#typingMinMs, maxMs: this.#typingMaxMs },
    };
  }

  async sendText(input: WhatsAppTextInput): Promise<WhatsAppSendResult> {
    const destination = normalizeUazapiDestination(input.to);
    if (!destination) return validationFailure("invalid_destination");
    if (typeof input.text !== "string" || input.text.trim().length === 0) return validationFailure("missing_text");

    const attempts: { readonly url: string; readonly body: Record<string, unknown> }[] = [
      { url: this.url("/send/text"), body: { number: destination, text: input.text, track_source: "pedro_v3", track_id: input.idempotencyKey } },
      { url: this.url("/send/text"), body: { remoteJid: `${destination}@s.whatsapp.net`, text: input.text, track_source: "pedro_v3", track_id: input.idempotencyKey } },
    ];
    if (this.#instanceName) {
      attempts.push({ url: this.url(`/message/sendText/${encodeURIComponent(this.#instanceName)}`), body: { number: destination, text: input.text, track_source: "pedro_v3", track_id: input.idempotencyKey } });
    }

    const showTyping = input.showTyping === true;
    if (showTyping) {
      await this.setPresence(destination, "composing");
      await this.#sleep(delayForTyping(input.text, this.#typingMinMs, this.#typingMaxMs));
    }
    try {
      let last: WhatsAppSendResult = failure("uazapi_http_failure", true);
      for (const attempt of attempts) {
        const result = await this.post(attempt.url, attempt.body);
        if (result.ok) return result;
        last = result;
        if (!result.retryable) break;
      }
      return last;
    } finally {
      if (showTyping) await this.setPresence(destination, "paused");
    }
  }

  async sendImage(input: WhatsAppMediaInput): Promise<WhatsAppSendResult> {
    const destination = normalizeUazapiDestination(input.to);
    if (!destination) return validationFailure("invalid_destination");
    if (typeof input.url !== "string" || !input.url.startsWith("https://")) return validationFailure("invalid_media_url");
    if (typeof input.photoId !== "string" || input.photoId.trim().length === 0) return validationFailure("missing_photo_id");

    return this.post(this.url("/send/media"), {
      number: destination,
      file: input.url,
      type: "image",
      caption: "",
      track_source: "pedro_v3",
      track_id: input.idempotencyKey,
    });
  }

  private url(path: string): string {
    return appendPath(new URL(this.endpointBase), path);
  }

  // Presence e puramente visual. Falhas aqui nunca impedem o envio da mensagem.
  private async setPresence(destination: string, presence: "composing" | "paused"): Promise<void> {
    const secret = await this.#credentialProvider.resolve(this.#tokenRef);
    if (!secret.ok || secret.secret.purpose !== "whatsapp_instance" || !secret.secret.material.trim()) return;
    for (const path of ["/message/presence", "/chat/presence"]) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), Math.min(this.timeoutMs, 5_000));
      try {
        const response = await this.#transport.postJson(this.url(path), {
          method: "POST",
          headers: {
            "content-type": "application/json",
            token: secret.secret.material,
            apikey: secret.secret.material,
          },
          body: JSON.stringify({ number: destination, presence }),
          signal: controller.signal,
        });
        if (response.ok) return;
      } catch {
        // Best-effort: tenta o endpoint compativel seguinte ou segue para o envio.
      } finally {
        clearTimeout(timeout);
      }
    }
  }

  private async post(url: string, body: Record<string, unknown>): Promise<WhatsAppSendResult> {
    const secret = await this.#credentialProvider.resolve(this.#tokenRef);
    if (!secret.ok || secret.secret.purpose !== "whatsapp_instance" || !secret.secret.material.trim()) {
      return validationFailure("uazapi_secret_unavailable");
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.#transport.postJson(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          token: secret.secret.material,
          apikey: secret.secret.material,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) return failure("uazapi_http_failure", response.status >= 500 || response.status === 429);
      return { ok: true, level: "accepted", providerMessageId: safeIdFromResponse(response.json) };
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return timeoutFailure();
      if (error instanceof Error && error.name === "AbortError") return timeoutFailure();
      return failure("uazapi_transport_failure", true);
    } finally {
      clearTimeout(timeout);
    }
  }
}
