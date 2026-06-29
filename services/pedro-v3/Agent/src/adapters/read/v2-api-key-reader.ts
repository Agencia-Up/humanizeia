// v2-api-key-reader.ts — F2.5.4A
//
// Implementação concreta do contrato `SecretDecryptor` para o `api_key_encrypted`
// do Pedro v2.
//
// ⚠️ ACHADO FACTUAL (ver Brain/decisions/ADR-008): o `api_key_encrypted` do v2 NÃO é
// criptografado. O código vivo o lê como PLAINTEXT:
//   - `stockSearch_20260525_photo_flow.ts::parseCredentials` faz `JSON.parse(raw)`
//     (ou usa o raw como `api_token` se não for JSON);
//   - `mediaContext.ts`/`metaSender.ts` usam `api_key_encrypted` DIRETO como token.
// Portanto NÃO existe formato criptográfico a "comprovar" e NÃO se inventa decryptor.
// Esta classe apenas PARSEIA o plaintext provado e seleciona o material por provider,
// de forma FAIL-CLOSED. Não há chave; nada de ciphertext/plaintext entra em log.

import type { SecretDecryptor } from "./supabase-v2-read-adapter.ts";

function firstNonEmptyString(obj: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return null;
}

function tryParseObject(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // não é JSON — raw escalar (tratado pelo chamador por provider)
  }
  return null;
}

export class V2PlaintextApiKeyReader implements SecretDecryptor {
  // Retorna o material de uso (feed_url para RevendaMais, api_token para BNDV) ou
  // null (fail-closed) quando o payload é vazio/ inválido/ não contém o campo do provider.
  // Nunca registra ciphertext, plaintext, chave ou token.
  async decryptApiKey(
    ciphertext: string,
    context: { readonly tenantId: string; readonly integrationId: string; readonly provider: string },
  ): Promise<string | null> {
    if (typeof ciphertext !== "string" || ciphertext.trim() === "") return null;

    const provider = context.provider.toLowerCase();
    const obj = tryParseObject(ciphertext);

    if (provider === "revendamais") {
      // Feed RevendaMais: precisa de uma URL. Sem URL → fail-closed (nunca usa token como URL).
      if (obj) return firstNonEmptyString(obj, ["feed_url", "url"]);
      const raw = ciphertext.trim();
      return raw.toLowerCase().startsWith("https://") ? raw : null;
    }

    if (provider === "bndv") {
      // BNDV: token bearer. JSON -> api_token; raw escalar -> o proprio raw (como no v2).
      if (obj) return firstNonEmptyString(obj, ["api_token", "token"]);
      const raw = ciphertext.trim();
      return raw === "" ? null : raw;
    }

    if (provider === "uazapi") {
      // Uazapi/wa_instances: no v2 o token pode estar cru ou em JSON.
      if (obj) return firstNonEmptyString(obj, ["api_key", "api_key_encrypted", "token", "apikey"]);
      const raw = ciphertext.trim();
      return raw === "" ? null : raw;
    }

    // provider desconhecido → fail-closed
    return null;
  }
}
