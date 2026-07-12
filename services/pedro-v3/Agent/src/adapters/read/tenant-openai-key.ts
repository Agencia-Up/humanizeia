import type { V3DatabaseGateway } from "../../domain/database-gateway.ts";
import type { JsonValue } from "../../domain/types.ts";
import { OpenAiRuntimeSecret } from "../../engine/openai-canary-root.ts";
import { AiRuntimeSecret, type PedroAiProvider } from "../../runtime/ai-provider.ts";

// Porta minima: `rpc` (client/platform key via Vault) + `selectOne` (profiles.created_at p/ grandfather).
export type TenantSecretGateway = Pick<V3DatabaseGateway, "rpc" | "selectOne">;

export class TenantOpenAiKeyError extends Error {
  constructor(public readonly code:
    | "TENANT_INVALID"
    | "OPENAI_KEY_NOT_FOUND"        // conta nova sem chave propria, OU plataforma sem chave -> fail-closed
    | "OPENAI_KEY_LOOKUP_FAILED") { // erro ao ler a chave da PLATAFORMA (client key e best-effort)
    super(code);
    this.name = "TenantOpenAiKeyError";
  }
}

// Regra factual REUTILIZADA do v2 (`_shared/aiKeys.ts`): contas criadas ATE este instante usam a chave
// da PLATAFORMA (grandfathered). Contas novas precisam da propria. Manter os dois valores em sincronia.
export const BYOK_GRANDFATHER_CUTOFF = Date.parse("2026-06-16T03:00:00Z");

const GET_CLIENT_AI_KEY_RPC = "get_client_ai_key";
const GET_PLATFORM_AI_KEY_RPC = "get_platform_ai_key";
const MAX_KEY_LEN = 512;

function validKey(raw: JsonValue): string | null {
  const key = typeof raw === "string" ? raw.trim() : "";
  if (key.length === 0 || key.length > MAX_KEY_LEN || /\s/.test(key)) return null;
  return key;
}

// Conta grandfathered? (pode usar a chave da plataforma). FAIL-OPEN igual ao v2: erro de leitura OU
// ausencia de created_at -> assume grandfathered, pra NUNCA derrubar uma conta ATUAL por falha de leitura.
async function isGrandfathered(gateway: TenantSecretGateway, tenantId: string): Promise<boolean> {
  try {
    const row = await gateway.selectOne("profiles", { id: tenantId }, "created_at");
    const createdRaw = row?.created_at;
    const createdMs = typeof createdRaw === "string" ? Date.parse(createdRaw) : NaN;
    if (Number.isFinite(createdMs)) return createdMs <= BYOK_GRANDFATHER_CUTOFF;
    return true; // sem row / created_at nulo -> fail-open (nao derruba conta atual)
  } catch {
    return true; // erro de leitura -> fail-open
  }
}

// BYOK do produto, MESMO comportamento do v2 (F2.6K):
//   1. chave PROPRIA do cliente (Vault, RPC get_client_ai_key) -> usa;
//   2. sem propria + conta GRANDFATHERED -> chave da PLATAFORMA (Vault, RPC get_platform_ai_key);
//   3. sem propria + conta NOVA -> fail-closed.
// Seguranca: nenhuma chave vem de env do container; a chave volta SO embrulhada em OpenAiRuntimeSecret
// (opaca; toJSON nao expoe; liberada so via materialize no header). Erros sanitizados, sem vazar segredo.
async function resolveTenantKey(deps: {
  readonly gateway: TenantSecretGateway;
  readonly tenantId: string;
  readonly provider: PedroAiProvider;
}): Promise<string> {
  const tenantId = typeof deps.tenantId === "string" ? deps.tenantId.trim() : "";
  if (tenantId.length === 0) throw new TenantOpenAiKeyError("TENANT_INVALID");

  // 1. Chave PROPRIA do cliente. Best-effort (igual v2): erro aqui NAO derruba — cai pro fallback.
  let clientRaw: JsonValue = "";
  try {
    clientRaw = await deps.gateway.rpc<JsonValue>(GET_CLIENT_AI_KEY_RPC, {
      p_user_id: tenantId,
      p_provider: deps.provider,
    });
  } catch {
    clientRaw = "";
  }
  const clientKey = validKey(clientRaw);
  if (clientKey) return clientKey;

  // 2. Sem chave propria: a chave da plataforma SO vale pra conta grandfathered.
  if (!(await isGrandfathered(deps.gateway, tenantId))) {
    throw new TenantOpenAiKeyError("OPENAI_KEY_NOT_FOUND"); // conta nova sem chave propria -> fail-closed
  }
  let platformRaw: JsonValue;
  try {
    platformRaw = await deps.gateway.rpc<JsonValue>(GET_PLATFORM_AI_KEY_RPC, { p_provider: deps.provider });
  } catch {
    // a plataforma e a unica fonte restante; erro aqui = nao da pra resolver -> sanitizado, sem fallback inseguro
    throw new TenantOpenAiKeyError("OPENAI_KEY_LOOKUP_FAILED");
  }
  const platformKey = validKey(platformRaw);
  if (platformKey) return platformKey;

  // grandfathered, mas a plataforma nao tem chave configurada no Vault -> fail-closed
  throw new TenantOpenAiKeyError("OPENAI_KEY_NOT_FOUND");
}

export async function resolveTenantOpenAiSecret(deps: {
  readonly gateway: TenantSecretGateway;
  readonly tenantId: string;
}): Promise<OpenAiRuntimeSecret> {
  return OpenAiRuntimeSecret.fromString(await resolveTenantKey({ ...deps, provider: "openai" }));
}

export async function resolveTenantAiSecret(deps: {
  readonly gateway: TenantSecretGateway;
  readonly tenantId: string;
  readonly provider: PedroAiProvider;
}): Promise<AiRuntimeSecret> {
  return AiRuntimeSecret.fromString(deps.provider, await resolveTenantKey(deps));
}
