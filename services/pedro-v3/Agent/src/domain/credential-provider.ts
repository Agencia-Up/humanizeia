// credential-provider.ts — F2.5.2A / A.1
//
// Contrato SEPARADO de credenciais. O resto do sistema (TenantRuntimeConfig, estado,
// QueryResult, eventos, logs) NUNCA vê o segredo — vê apenas um `SecretRef` OPACO.
// O segredo só é resolvido no PONTO DE USO futuro (stock-source da F2.5.2B), via
// `CredentialProvider.resolve`. O `TenantConfigSource` NÃO chama `resolve` (R1-6/R1-7).
//
// A.1: `provider` é UNIÃO FECHADA; `makeSecretRef` valida contra ALLOWLISTS REAIS de
// valores (não só projeção de campos); `resolve` é FAIL-CLOSED (resultado discriminado).

import type { Awaitable } from "./ports.ts";
import type { StockProvider } from "./read-ports.ts";

export type SecretProvider = StockProvider | "uazapi";
export type SecretPurpose = "stock_feed" | "whatsapp_instance";

// Allowlists REAIS de valores aceitos (nao apenas nomes de campo).
export const SECRET_PROVIDER_ALLOWLIST: readonly SecretProvider[] = ["revendamais", "bndv", "uazapi"];
export const SECRET_PURPOSE_ALLOWLIST: readonly SecretPurpose[] = ["stock_feed", "whatsapp_instance"];

// Identidade OPACA suficiente para resolver o segredo depois. NUNCA contém
// feed URL, token, api_key_encrypted ou qualquer material secreto.
export type SecretRef = {
  readonly tenantId: string;
  readonly integrationId: string;
  readonly provider: SecretProvider; // uniao fechada, nao string livre
  readonly purpose: SecretPurpose;
};

// Segredo resolvido — só circula no ponto de uso; nunca em config/estado/log.
export type ResolvedSecret = {
  readonly purpose: SecretPurpose;
  readonly material: string;
};

export type SecretResolveErrorCode =
  | "SECRET_NOT_FOUND"
  | "SECRET_OWNERSHIP_MISMATCH"
  | "SECRET_PROVIDER_MISMATCH";

// resolve é FAIL-CLOSED: nunca devolve material "default"; ausência/divergência falha.
export type ResolveSecretResult =
  | { readonly ok: true; readonly secret: ResolvedSecret }
  | { readonly ok: false; readonly error: SecretResolveErrorCode };

export interface CredentialProvider {
  // Resolve o segredo a partir do ref opaco. NÃO usado na F2.5.2A.
  resolve(ref: SecretRef): Awaitable<ResolveSecretResult>;
}

// Erro de construção de SecretRef. Nomeia o CAMPO inválido, NUNCA o valor.
export class SecretRefError extends Error {
  constructor(public readonly field: "tenantId" | "integrationId" | "provider" | "purpose") {
    super(`secret ref inválido: campo '${field}' fora do contrato`);
    this.name = "SecretRefError";
  }
}

// Constrói um SecretRef validando contra as ALLOWLISTS de valores e exigindo ids
// não-vazios. Rejeita de forma segura (sem ecoar o valor inválido). Resultado frozen.
export function makeSecretRef(input: {
  tenantId: string;
  integrationId: string;
  provider: SecretProvider;
  purpose: SecretPurpose;
}): SecretRef {
  if (typeof input?.tenantId !== "string" || input.tenantId.trim() === "") throw new SecretRefError("tenantId");
  if (typeof input?.integrationId !== "string" || input.integrationId.trim() === "") throw new SecretRefError("integrationId");
  if (!SECRET_PROVIDER_ALLOWLIST.includes(input.provider)) throw new SecretRefError("provider");
  if (!SECRET_PURPOSE_ALLOWLIST.includes(input.purpose)) throw new SecretRefError("purpose");
  return Object.freeze({
    tenantId: input.tenantId,
    integrationId: input.integrationId,
    provider: input.provider,
    purpose: input.purpose,
  });
}

// Nomes de campo que NUNCA podem aparecer (chave exata, minúscula) em config,
// SecretRef, evento ou log. Usado por testes e por checagens defensivas.
export const SECRET_KEY_DENYLIST: readonly string[] = [
  "feed_url",
  "feedurl",
  "api_token",
  "apitoken",
  "api_key",
  "apikey",
  "api_key_encrypted",
  "token",
  "secret",
  "password",
  "authorization",
  "bearer",
  "credential",
  "credentials",
];
