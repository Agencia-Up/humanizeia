// ============================================================================
// _shared/bndv-auth.ts — Autenticação BNDV (compartilhada por bndv-stock-search e test-integration).
//
// A API de Estoque BNDV (https://api-estoque.azurewebsites.net) tem DOIS modos de credencial:
//  - LOGIN (fluxo oficial, cliente novo): POST /login { externalKey, password } -> token; depois o /graphql usa
//    `Authorization: <token>` (token cru, conforme a doc oficial).
//  - BEARER (legado, ex.: Bruno): um Bearer Token estático salvo direto -> `Authorization: Bearer <api_token>`.
//
// Este módulo resolve o header de Authorization a partir das credenciais salvas (JSON em
// platform_integrations.api_key_encrypted), fazendo o /login quando necessário. NUNCA loga a senha/token.
// ============================================================================
const BNDV_BASE = "https://api-estoque.azurewebsites.net";
export const BNDV_GRAPHQL_URL = `${BNDV_BASE}/graphql`;
const BNDV_LOGIN_URL = `${BNDV_BASE}/login`;

export interface BndvCredentials {
  api_token?: string;      // legado: Bearer token estático
  external_key?: string;   // novo: /login (ExternalKey)
  password?: string;       // novo: /login (Senha)
  customer_key?: string;   // opcional: chave da loja (filtro)
}

// Parse tolerante do que está salvo (JSON { ... } OU string crua = api_token legado).
export function parseBndvCredentials(raw: string | null | undefined): BndvCredentials {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed as BndvCredentials;
  } catch {
    return { api_token: raw };
  }
  return {};
}

export function hasLoginCredentials(creds: BndvCredentials): boolean {
  return !!creds.external_key?.trim() && !!creds.password?.trim();
}

// Extrai o token da resposta do /login de forma robusta a formatos comuns (JSON com token/accessToken/... ou
// corpo que É o token cru). Retorna null se não achar.
function extractLoginToken(body: unknown, rawText: string): string | null {
  if (typeof body === "string" && body.trim()) return body.trim();
  if (body && typeof body === "object") {
    const o = body as Record<string, unknown>;
    const nested = (o.data as Record<string, unknown> | undefined) ?? (o.result as Record<string, unknown> | undefined) ?? {};
    const candidates = [
      o.token, o.accessToken, o.access_token, o.jwt, o.Token, o.bearerToken,
      nested.token, nested.accessToken, nested.access_token, nested.jwt,
    ];
    for (const c of candidates) if (typeof c === "string" && c.trim()) return c.trim();
  }
  const t = rawText.trim().replace(/^"+|"+$/g, "");
  if (t && !t.startsWith("{") && !t.startsWith("[") && t.length >= 8 && t.length < 8192) return t;
  return null;
}

export type BndvAuthResult =
  | { ok: true; authHeader: string; mode: "login" | "bearer" }
  | { ok: false; error: string };

// Resolve o valor do header Authorization para chamar o /graphql. Faz o /login quando há ExternalKey+Senha.
export async function resolveBndvAuthHeader(creds: BndvCredentials): Promise<BndvAuthResult> {
  const extKey = creds.external_key?.trim();
  const pwd = creds.password?.trim();

  if (extKey && pwd) {
    let res: Response;
    try {
      res = await fetch(BNDV_LOGIN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ externalKey: extKey, password: pwd }),
      });
    } catch (e: any) {
      return { ok: false, error: `Falha de rede ao autenticar no BNDV (/login): ${e?.message ?? String(e)}` };
    }
    const rawText = await res.text().catch(() => "");
    let body: unknown = null;
    try { body = JSON.parse(rawText); } catch { /* corpo pode ser o token cru */ }

    if (!res.ok) {
      const msg = (body && typeof body === "object" && typeof (body as any).message === "string") ? (body as any).message : "";
      return { ok: false, error: `BNDV /login retornou status ${res.status}. Confira a ExternalKey e a Senha do cliente. ${msg}`.trim() };
    }
    const token = extractLoginToken(body, rawText);
    if (!token) {
      return { ok: false, error: "BNDV /login respondeu OK, mas não consegui extrair o token da resposta (formato inesperado)." };
    }
    // Doc oficial: Authorization = token cru (sem "Bearer").
    return { ok: true, authHeader: token, mode: "login" };
  }

  const apiToken = creds.api_token?.trim();
  if (apiToken) {
    return { ok: true, authHeader: apiToken.startsWith("Bearer ") ? apiToken : `Bearer ${apiToken}`, mode: "bearer" };
  }

  return { ok: false, error: "Credenciais BNDV ausentes. Informe ExternalKey + Senha (fluxo novo) ou um Bearer Token (legado)." };
}
