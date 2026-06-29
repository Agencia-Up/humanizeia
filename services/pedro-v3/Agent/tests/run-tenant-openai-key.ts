import { readFileSync } from "node:fs";
import {
  BYOK_GRANDFATHER_CUTOFF,
  resolveTenantOpenAiSecret,
  TenantOpenAiKeyError,
  type TenantSecretGateway,
} from "../src/adapters/read/tenant-openai-key.ts";
import type { DatabaseFilters, DatabaseRow } from "../src/domain/database-gateway.ts";
import type { JsonValue } from "../src/domain/types.ts";

let ok = 0;
let failed = 0;

function check(name: string, condition: boolean, detail = ""): void {
  if (condition) {
    ok += 1;
    console.log(`OK  ${name}`);
  } else {
    failed += 1;
    console.error(`FAIL ${name}${detail ? ` :: ${detail}` : ""}`);
  }
}

const OLD = "2026-01-01T00:00:00Z";   // <= cutoff -> grandfathered
const NEW = "2026-07-01T00:00:00Z";   // > cutoff  -> conta nova

type GwOpts = {
  clientKeys?: Record<string, string>;
  platformKey?: string;
  createdAt?: Record<string, string>;
  clientThrows?: boolean;
  platformThrows?: boolean;
  profileThrows?: boolean;
  rpcNames?: string[];
  clientArgs?: { value?: DatabaseRow };
};

function fakeGateway(opts: GwOpts): TenantSecretGateway {
  return {
    async rpc<T extends JsonValue>(name: string, args: DatabaseRow): Promise<T> {
      opts.rpcNames?.push(name);
      if (name === "get_client_ai_key") {
        if (opts.clientArgs) opts.clientArgs.value = args;
        if (opts.clientThrows) throw new Error("client boom token=sk-CLIENT-LEAK-9999");
        return ((opts.clientKeys ?? {})[String(args.p_user_id as JsonValue)] ?? "") as unknown as T;
      }
      if (name === "get_platform_ai_key") {
        if (opts.platformThrows) throw new Error("platform boom token=sk-PLATFORM-LEAK-9999");
        return (opts.platformKey ?? "") as unknown as T;
      }
      return "" as unknown as T;
    },
    async selectOne(table: string, filters: DatabaseFilters, _columns?: string): Promise<DatabaseRow | null> {
      if (table !== "profiles") return null;
      if (opts.profileThrows) throw new Error("profile boom");
      const created = (opts.createdAt ?? {})[String(filters.id as JsonValue)];
      return created ? { created_at: created } : null;
    },
  };
}

async function expectError(name: string, fn: () => Promise<unknown>, code: string): Promise<void> {
  try {
    await fn();
    check(name, false, "nao lancou");
  } catch (error) {
    check(name, error instanceof TenantOpenAiKeyError && error.code === code, error instanceof Error ? error.message : String(error));
  }
}

async function main(): Promise<void> {
  // Estrutural: regra factual reutilizada do v2 + servico sem env global.
  check("BYOK_GRANDFATHER_CUTOFF = 2026-06-16T03:00:00Z (igual v2)", BYOK_GRANDFATHER_CUTOFF === Date.parse("2026-06-16T03:00:00Z"));
  const serverSrc = readFileSync(new URL("../src/runtime/server.ts", import.meta.url), "utf8");
  check("servico nao exige OPENAI_API_KEY global", !/OPENAI_API_KEY/.test(serverSrc), "server.ts ainda cita OPENAI_API_KEY");
  check("servico usa resolveTenantOpenAiSecret (BYOK por tenant)", /resolveTenantOpenAiSecret/.test(serverSrc));

  // 1. Cliente COM chave propria -> usa a do cliente (e nem consulta a plataforma).
  const rpc1: string[] = [];
  const args1: { value?: DatabaseRow } = {};
  const sClient = await resolveTenantOpenAiSecret({
    gateway: fakeGateway({ clientKeys: { t: "sk-CLIENT-AAAA" }, platformKey: "sk-PLATFORM-X", rpcNames: rpc1, clientArgs: args1 }),
    tenantId: "t",
  });
  check("cliente com chave propria usa client key", sClient.materialize((k) => k) === "sk-CLIENT-AAAA");
  check("client key nao consulta a plataforma", !rpc1.includes("get_platform_ai_key"));
  check("chama get_client_ai_key com p_user_id/p_provider", (args1.value?.p_user_id as JsonValue) === "t" && (args1.value?.p_provider as JsonValue) === "openai");

  // 2. Grandfathered (created_at <= cutoff) SEM chave propria -> usa a da plataforma.
  const sPlat = await resolveTenantOpenAiSecret({
    gateway: fakeGateway({ clientKeys: {}, createdAt: { t: OLD }, platformKey: "sk-PLATFORM-BBBB" }),
    tenantId: "t",
  });
  check("grandfathered sem client key usa platform key", sPlat.materialize((k) => k) === "sk-PLATFORM-BBBB");

  // 3. Conta NOVA (created_at > cutoff) SEM chave propria -> fail-closed (e nem chama a plataforma).
  const rpc3: string[] = [];
  await expectError("conta nova sem client key falha fechado", () => resolveTenantOpenAiSecret({
    gateway: fakeGateway({ clientKeys: {}, createdAt: { t: NEW }, platformKey: "sk-PLATFORM-BBBB", rpcNames: rpc3 }),
    tenantId: "t",
  }), "OPENAI_KEY_NOT_FOUND");
  check("conta nova nem consulta a plataforma", !rpc3.includes("get_platform_ai_key"));

  // 4. Erro de leitura do PROFILE -> fail-open (grandfathered) -> usa plataforma (nao derruba conta atual).
  const sFailOpen = await resolveTenantOpenAiSecret({
    gateway: fakeGateway({ clientKeys: {}, profileThrows: true, platformKey: "sk-PLATFORM-BBBB" }),
    tenantId: "t",
  });
  check("erro de leitura de profile fail-open -> usa platform", sFailOpen.materialize((k) => k) === "sk-PLATFORM-BBBB");
  // 4b. Sem row de profile (created_at nulo) -> fail-open tambem.
  const sNoRow = await resolveTenantOpenAiSecret({
    gateway: fakeGateway({ clientKeys: {}, createdAt: {}, platformKey: "sk-PLATFORM-BBBB" }),
    tenantId: "t",
  });
  check("profile inexistente -> fail-open -> usa platform", sNoRow.materialize((k) => k) === "sk-PLATFORM-BBBB");

  // 5. Grandfathered mas plataforma SEM chave -> fail-closed.
  await expectError("grandfathered sem chave de plataforma falha fechado", () => resolveTenantOpenAiSecret({
    gateway: fakeGateway({ clientKeys: {}, createdAt: { t: OLD }, platformKey: "" }),
    tenantId: "t",
  }), "OPENAI_KEY_NOT_FOUND");

  // 6. Erro ao ler a chave da PLATAFORMA -> OPENAI_KEY_LOOKUP_FAILED, sanitizado.
  let platErr: unknown = null;
  try {
    await resolveTenantOpenAiSecret({ gateway: fakeGateway({ clientKeys: {}, createdAt: { t: OLD }, platformThrows: true }), tenantId: "t" });
  } catch (e) { platErr = e; }
  check("erro de leitura da plataforma vira OPENAI_KEY_LOOKUP_FAILED", platErr instanceof TenantOpenAiKeyError && platErr.code === "OPENAI_KEY_LOOKUP_FAILED");
  check("erro de plataforma sanitizado NAO vaza segredo", !/sk-PLATFORM-LEAK-9999/.test(platErr instanceof Error ? `${platErr.name}:${platErr.message}` : String(platErr)));

  // 7. Erro ao ler a CLIENT key e best-effort (igual v2): cai pro fallback, nao derruba.
  const sClientErr = await resolveTenantOpenAiSecret({
    gateway: fakeGateway({ clientThrows: true, createdAt: { t: OLD }, platformKey: "sk-PLATFORM-BBBB" }),
    tenantId: "t",
  });
  check("erro na client key cai pro fallback (grandfathered -> platform)", sClientErr.materialize((k) => k) === "sk-PLATFORM-BBBB");

  // 8. Cross-tenant: tenant-B NUNCA recebe a client key do tenant-A.
  const argsB: { value?: DatabaseRow } = {};
  await expectError("cross-tenant (B novo) nao acessa client key do A", () => resolveTenantOpenAiSecret({
    gateway: fakeGateway({ clientKeys: { "tenant-A": "sk-CLIENT-AAAA" }, createdAt: { "tenant-B": NEW }, clientArgs: argsB }),
    tenantId: "tenant-B",
  }), "OPENAI_KEY_NOT_FOUND");
  check("cross-tenant consulta o tenant pedido (B)", (argsB.value?.p_user_id as JsonValue) === "tenant-B");
  const sCrossPlat = await resolveTenantOpenAiSecret({
    gateway: fakeGateway({ clientKeys: { "tenant-A": "sk-CLIENT-AAAA" }, createdAt: { "tenant-B": OLD }, platformKey: "sk-PLATFORM-BBBB" }),
    tenantId: "tenant-B",
  });
  check("cross-tenant (B grandfathered) usa platform, nunca o client de A", sCrossPlat.materialize((k) => k) === "sk-PLATFORM-BBBB");

  // 9. Boundary do cutoff: exatamente no cutoff -> grandfathered; 1ms depois -> nova.
  const sBoundary = await resolveTenantOpenAiSecret({
    gateway: fakeGateway({ clientKeys: {}, createdAt: { t: new Date(BYOK_GRANDFATHER_CUTOFF).toISOString() }, platformKey: "sk-PLATFORM-BBBB" }),
    tenantId: "t",
  });
  check("created_at == cutoff -> grandfathered (usa platform)", sBoundary.materialize((k) => k) === "sk-PLATFORM-BBBB");
  await expectError("created_at 1ms apos o cutoff -> conta nova fail-closed", () => resolveTenantOpenAiSecret({
    gateway: fakeGateway({ clientKeys: {}, createdAt: { t: new Date(BYOK_GRANDFATHER_CUTOFF + 1).toISOString() }, platformKey: "sk-PLATFORM-BBBB" }),
    tenantId: "t",
  }), "OPENAI_KEY_NOT_FOUND");

  // 10. Chave invalida (com espaco) -> tratada como ausente.
  await expectError("client key com espaco + conta nova -> fail-closed", () => resolveTenantOpenAiSecret({
    gateway: fakeGateway({ clientKeys: { t: "sk com espaco" }, createdAt: { t: NEW } }),
    tenantId: "t",
  }), "OPENAI_KEY_NOT_FOUND");

  // 11. tenantId vazio -> TENANT_INVALID, sem consultar o gateway.
  const rpcEmpty: string[] = [];
  await expectError("tenantId vazio -> TENANT_INVALID", () => resolveTenantOpenAiSecret({
    gateway: fakeGateway({ clientKeys: { x: "sk-x" }, rpcNames: rpcEmpty }), tenantId: "   ",
  }), "TENANT_INVALID");
  check("tenantId vazio nao consulta o gateway", rpcEmpty.length === 0);

  // 12. Sem vazamento em JSON/objeto, e chave so via materialize (header).
  const dumpClient = JSON.stringify(sClient);
  const dumpPlat = JSON.stringify({ openAiSecret: sPlat, note: "root summary" });
  check("JSON.stringify(client secret) nao vaza", !/sk-CLIENT-AAAA/.test(dumpClient) && /openai_runtime_secret/.test(dumpClient));
  check("JSON.stringify de objeto com platform secret nao vaza", !/sk-PLATFORM-BBBB/.test(dumpPlat));
  check("secret nao expoe a chave como propriedade enumeravel", !Object.values(sPlat as object).includes("sk-PLATFORM-BBBB"));

  console.log(`=== TENANT OPENAI KEY: ${ok} OK | ${failed} FALHA ===`);
  if (failed > 0) process.exit(1);
}

void main();
