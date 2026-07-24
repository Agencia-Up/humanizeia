// ============================================================================
// bndv-auth.ts — Autenticação BNDV para o loader do Pedro v3.
//
// PORT vendorizado de `supabase/functions/_shared/bndv-auth.ts` (o loader do v3 NÃO pode importar de fora de
// Agent/src — é a fronteira do container que derrubou a produção no outage de 2026-07-22; ver run-container-boundary).
//
// A API de Estoque BNDV tem DOIS modos de credencial (platform_integrations.api_key_encrypted é JSON PURO, apesar do
// nome — o portal grava JSON.stringify(credentials)):
//   - LEGADO (Bruno/Icom): { api_token } -> Authorization: `Bearer <api_token>`.
//   - NOVO   (Mônaco, clientes recentes): { external_key, password } -> POST /login -> token -> `Bearer <token>`.
//
// INCIDENTE (Mônaco 2026-07-24): o loader do v3 só sabia o modo LEGADO (lia api_token e mandava Bearer cru). A Mônaco
// conectou no modo NOVO (external_key+password, validado pelo portal no cadastro), então o v3 NUNCA conseguia
// autenticar -> catálogo 0 -> agente dizia "não temos SUVs". Este módulo dá ao v3 o mesmo /login das Edge Functions.
//
// Diferença do shared: o /login aqui passa pelo SafeHttpClient (SSRF/host-allowlist/IP/tamanho/redirect), não fetch cru.
// NUNCA loga senha/token. Falha de auth NÃO retorna credencial — só um código de erro curto e seguro.
// ============================================================================
import type { SafeHttpClient } from "./http-client.ts";

const BNDV_LOGIN_URL = "https://api-estoque.azurewebsites.net/login";

export interface BndvCredentials {
  readonly api_token?: string;      // legado: Bearer estático
  readonly external_key?: string;   // novo: /login (ExternalKey)
  readonly password?: string;       // novo: /login (Senha)
}

function pick(cred: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const k of keys) {
    const v = cred[k];
    if (typeof v === "string" && v.trim() !== "") return v.trim();
  }
  return undefined;
}

// Normaliza o JSON de credencial (tolera aliases camelCase/pt-BR sem inventar valores).
export function parseBndvCredentials(cred: Record<string, unknown>): BndvCredentials {
  return {
    api_token: pick(cred, ["api_token", "token"]),
    external_key: pick(cred, ["external_key", "externalKey"]),
    password: pick(cred, ["password", "senha"]),
  };
}

// Extrai o token do corpo do /login, robusto a formatos comuns (JSON com token/accessToken/... ou o token cru).
function extractLoginToken(rawText: string): string | null {
  const trimmed = rawText.trim();
  if (!trimmed) return null;
  try {
    const body = JSON.parse(trimmed) as unknown;
    if (typeof body === "string" && body.trim()) return body.trim();
    if (body && typeof body === "object") {
      const o = body as Record<string, unknown>;
      const nested = (o.data as Record<string, unknown> | undefined) ?? (o.result as Record<string, unknown> | undefined) ?? {};
      const candidates = [o.token, o.accessToken, o.access_token, o.jwt, o.Token, o.bearerToken, nested.token, nested.accessToken, nested.access_token, nested.jwt];
      for (const c of candidates) if (typeof c === "string" && c.trim()) return c.trim();
      return null;
    }
  } catch {
    // corpo não-JSON: pode ser o token cru
  }
  const t = trimmed.replace(/^"+|"+$/g, "");
  if (t && !t.startsWith("{") && !t.startsWith("[") && t.length >= 8 && t.length < 8192) return t;
  return null;
}

export type BndvAuthResult =
  | { readonly ok: true; readonly authHeader: string; readonly mode: "login" | "bearer" }
  | { readonly ok: false; readonly error: string };

// Resolve o header Authorization para o /graphql. Faz o /login quando há ExternalKey+Senha; senão usa o Bearer legado.
export async function resolveBndvAuthHeader(cred: BndvCredentials, http: SafeHttpClient): Promise<BndvAuthResult> {
  const extKey = cred.external_key?.trim();
  const pwd = cred.password?.trim();

  if (extKey && pwd) {
    let text: string;
    try {
      const res = await http.safeFetch(BNDV_LOGIN_URL, {
        method: "POST",
        provider: "bndv",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ externalKey: extKey, password: pwd }),
        expectJson: false,   // o /login pode devolver o token como texto puro
      });
      text = res.text;
    } catch {
      // SafeHttpClient já lança sanitizado (SAFE_FETCH_FAILURE: HTTP_STATUS_401/timeout/etc.) — nunca vaza credencial.
      return { ok: false, error: "BNDV_LOGIN_FAILED" };
    }
    const token = extractLoginToken(text);
    if (!token) return { ok: false, error: "BNDV_LOGIN_NO_TOKEN" };
    // O /graphql EXIGE o prefixo "Bearer " (testado na API real 2026-07-03: token cru => 400 "Token inválido").
    return { ok: true, authHeader: token.startsWith("Bearer ") ? token : `Bearer ${token}`, mode: "login" };
  }

  const apiToken = cred.api_token?.trim();
  if (apiToken) {
    return { ok: true, authHeader: apiToken.startsWith("Bearer ") ? apiToken : `Bearer ${apiToken}`, mode: "bearer" };
  }

  return { ok: false, error: "BNDV_CREDENTIALS_MISSING" };
}
