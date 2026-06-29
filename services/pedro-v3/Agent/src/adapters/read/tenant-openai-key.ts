import type { V3DatabaseGateway } from "../../domain/database-gateway.ts";
import type { JsonValue } from "../../domain/types.ts";
import { OpenAiRuntimeSecret } from "../../engine/openai-canary-root.ts";

// Porta minima: so o `rpc` do gateway service-role. Mantem o resolver desacoplado e testavel com fake.
export type TenantSecretGateway = Pick<V3DatabaseGateway, "rpc">;

export class TenantOpenAiKeyError extends Error {
  constructor(public readonly code:
    | "TENANT_INVALID"
    | "OPENAI_KEY_NOT_FOUND"
    | "OPENAI_KEY_LOOKUP_FAILED") {
    super(code);
    this.name = "TenantOpenAiKeyError";
  }
}

const GET_CLIENT_AI_KEY_RPC = "get_client_ai_key";
const MAX_KEY_LEN = 512;

// BYOK do produto: resolve a chave OpenAI do TENANT pelo Vault, via a MESMA RPC service-role do v2
// (`aiKeys.resolveAiKey` -> `get_client_ai_key`). Escopada por `p_user_id` (o tenant). SEM fallback
// global/plataforma (regra F2.6J): se o tenant nao tem chave valida, falha FECHADO.
//
// Seguranca: a chave NUNCA volta como string crua, nem e logada/serializada — volta embrulhada em
// `OpenAiRuntimeSecret` (opaca; `toJSON` nao expoe; so `materialize` libera no header do adapter).
// Erro de leitura e SANITIZADO (`OPENAI_KEY_LOOKUP_FAILED`), sem propagar corpo/segredo do gateway.
export async function resolveTenantOpenAiSecret(deps: {
  readonly gateway: TenantSecretGateway;
  readonly tenantId: string;
}): Promise<OpenAiRuntimeSecret> {
  const tenantId = typeof deps.tenantId === "string" ? deps.tenantId.trim() : "";
  if (tenantId.length === 0) throw new TenantOpenAiKeyError("TENANT_INVALID");

  let raw: JsonValue;
  try {
    raw = await deps.gateway.rpc<JsonValue>(GET_CLIENT_AI_KEY_RPC, {
      p_user_id: tenantId,
      p_provider: "openai",
    });
  } catch {
    // NUNCA propaga a excecao original (pode conter corpo/segredo) — erro tipado e generico.
    throw new TenantOpenAiKeyError("OPENAI_KEY_LOOKUP_FAILED");
  }

  const key = typeof raw === "string" ? raw.trim() : "";
  if (key.length === 0 || key.length > MAX_KEY_LEN || /\s/.test(key)) {
    throw new TenantOpenAiKeyError("OPENAI_KEY_NOT_FOUND");
  }
  return OpenAiRuntimeSecret.fromString(key);
}
