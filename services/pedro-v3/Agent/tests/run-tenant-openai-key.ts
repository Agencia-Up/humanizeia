import { readFileSync } from "node:fs";
import {
  resolveTenantOpenAiSecret,
  TenantOpenAiKeyError,
  type TenantSecretGateway,
} from "../src/adapters/read/tenant-openai-key.ts";
import type { DatabaseRow } from "../src/domain/database-gateway.ts";
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

type Capture = { name?: string; args?: DatabaseRow };

function fakeGateway(opts: {
  keys?: Record<string, string>;
  throwErr?: unknown;
  capture?: Capture;
}): TenantSecretGateway {
  return {
    async rpc<T extends JsonValue>(name: string, args: DatabaseRow): Promise<T> {
      if (opts.capture) { opts.capture.name = name; opts.capture.args = args; }
      if (opts.throwErr) throw opts.throwErr;
      if (name !== "get_client_ai_key") return "" as unknown as T;
      const tenant = String((args.p_user_id as JsonValue) ?? "");
      return ((opts.keys ?? {})[tenant] ?? "") as unknown as T;
    },
  };
}

async function main(): Promise<void> {
  // 1. Estrutural: o servico NAO referencia mais a env global OPENAI_API_KEY e usa o resolver por tenant.
  const serverSrc = readFileSync(new URL("../src/runtime/server.ts", import.meta.url), "utf8");
  check("servico nao exige OPENAI_API_KEY global", !/OPENAI_API_KEY/.test(serverSrc), "server.ts ainda cita OPENAI_API_KEY");
  check("servico usa resolveTenantOpenAiSecret (BYOK por tenant)", /resolveTenantOpenAiSecret/.test(serverSrc));

  // 2. Resolve a chave do tenant CORRETO.
  const capA: Capture = {};
  const secretA = await resolveTenantOpenAiSecret({
    gateway: fakeGateway({ keys: { "tenant-A": "sk-secret-AAAA" }, capture: capA }),
    tenantId: "tenant-A",
  });
  check("resolve a chave do tenant correto", secretA.materialize((k) => k) === "sk-secret-AAAA");
  check("chama get_client_ai_key com p_user_id/p_provider do tenant", capA.name === "get_client_ai_key"
    && (capA.args?.p_user_id as JsonValue) === "tenant-A" && (capA.args?.p_provider as JsonValue) === "openai");

  // 3. Cross-tenant: gateway so tem chave do tenant-A; pedir tenant-B nao acessa a chave de A -> falha fechado.
  const capB: Capture = {};
  let crossThrew = "";
  try {
    await resolveTenantOpenAiSecret({
      gateway: fakeGateway({ keys: { "tenant-A": "sk-secret-AAAA" }, capture: capB }),
      tenantId: "tenant-B",
    });
  } catch (e) { crossThrew = e instanceof TenantOpenAiKeyError ? e.code : "other"; }
  check("cross-tenant nao acessa chave de outro tenant (falha fechado)", crossThrew === "OPENAI_KEY_NOT_FOUND");
  check("cross-tenant consulta o tenant pedido (B), nunca o A", (capB.args?.p_user_id as JsonValue) === "tenant-B");

  // 4. Ausencia de chave (vazio) -> falha fechado, SEM fallback global.
  await expectError("ausencia de chave falha fechado", () => resolveTenantOpenAiSecret({
    gateway: fakeGateway({ keys: {} }), tenantId: "tenant-A",
  }), "OPENAI_KEY_NOT_FOUND");
  // 4b. Chave nula/nao-string -> falha fechado.
  await expectError("chave nula falha fechado", () => resolveTenantOpenAiSecret({
    gateway: { async rpc<T extends JsonValue>(): Promise<T> { return null as unknown as T; } }, tenantId: "tenant-A",
  }), "OPENAI_KEY_NOT_FOUND");
  // 4c. Chave com espaco (suspeita) -> rejeitada.
  await expectError("chave com espaco rejeitada", () => resolveTenantOpenAiSecret({
    gateway: fakeGateway({ keys: { "t": "sk com espaco" } }), tenantId: "t",
  }), "OPENAI_KEY_NOT_FOUND");
  // 4d. tenantId vazio -> TENANT_INVALID e nem chama o gateway.
  const capEmpty: Capture = {};
  await expectError("tenantId vazio -> TENANT_INVALID", () => resolveTenantOpenAiSecret({
    gateway: fakeGateway({ keys: { "x": "sk-x" }, capture: capEmpty }), tenantId: "   ",
  }), "TENANT_INVALID");
  check("tenantId vazio nao consulta o gateway", capEmpty.name === undefined);

  // 5. Erro de leitura -> sanitizado (codigo generico), SEM vazar segredo/corpo do gateway.
  let lookupErr: unknown = null;
  try {
    await resolveTenantOpenAiSecret({
      gateway: fakeGateway({ throwErr: new Error("upstream blew up token=sk-LEAKED-9999") }),
      tenantId: "tenant-A",
    });
  } catch (e) { lookupErr = e; }
  const lookupMsg = lookupErr instanceof Error ? `${lookupErr.name}:${lookupErr.message}` : String(lookupErr);
  check("erro de leitura vira OPENAI_KEY_LOOKUP_FAILED", lookupErr instanceof TenantOpenAiKeyError && lookupErr.code === "OPENAI_KEY_LOOKUP_FAILED");
  check("erro sanitizado NAO vaza o segredo do upstream", !/sk-LEAKED-9999/.test(lookupMsg), lookupMsg);

  // 6. JSON.stringify do secret (e de objetos que o contem) NAO vaza a chave.
  const dumpSecret = JSON.stringify(secretA);
  const dumpWrap = JSON.stringify({ openAiSecret: secretA, note: "root summary" });
  check("JSON.stringify(secret) nao vaza a chave", !/sk-secret-AAAA/.test(dumpSecret), dumpSecret);
  check("JSON.stringify de objeto com o secret nao vaza a chave", !/sk-secret-AAAA/.test(dumpWrap));
  check("toJSON do secret e opaco", /openai_runtime_secret/.test(dumpSecret));

  // 7. O adapter recebe a chave SO via materialize (caminho do header), nunca como propriedade publica.
  let headerKey = "";
  secretA.materialize((k) => { headerKey = k; return k; });
  check("adapter recebe a chave exata via materialize (header)", headerKey === "sk-secret-AAAA");
  check("secret nao expoe a chave como propriedade enumeravel", !Object.values(secretA as object).includes("sk-secret-AAAA"));

  console.log(`=== TENANT OPENAI KEY: ${ok} OK | ${failed} FALHA ===`);
  if (failed > 0) process.exit(1);
}

async function expectError(name: string, fn: () => Promise<unknown>, code: string): Promise<void> {
  try {
    await fn();
    check(name, false, "nao lancou");
  } catch (error) {
    check(name, error instanceof TenantOpenAiKeyError && error.code === code, error instanceof Error ? error.message : String(error));
  }
}

void main();
