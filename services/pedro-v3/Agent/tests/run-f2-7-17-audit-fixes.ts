// ============================================================================
// F2.7.17 - Correcoes da AUDITORIA P1 (testes END-TO-END pelo engine real):
//   Finding 1: busca por TIPO sem match ATERRADO NAO lista carro do tipo errado (nem mente "nao tenho SUV").
//   Finding 2: o conductor VE os slots que o handler gravou no MESMO turno -> NAO repergunta "qual modelo/tipo?".
// e2e = runConversationTurn de verdade (persistence + sdrPolicy + explicit-search + conductor).
//   npx tsx tests/run-f2-7-17-audit-fixes.ts
// ============================================================================
import { runConversationTurn } from "../src/engine/conversation-engine.ts";
import { InMemoryPersistence, FakeClock, FakeIdGen } from "../src/adapters/persistence/in-memory-store.ts";
import { FakeLlm } from "../src/adapters/llm/fake-llm.ts";
import { buildTenantCatalog, normalizeText } from "../src/engine/catalog-utils.ts";
import { CatalogClaimExtractor } from "../src/engine/turn-context-preparer.ts";
import { buildSdrQualificationPolicy } from "../src/engine/sdr-conductor.ts";
import { createInitialState } from "../src/domain/conversation-state.ts";
import type { ConversationState } from "../src/domain/conversation-state.ts";
import type { QueryRunner } from "../src/engine/decision-engine.ts";
import type { QueryCall, QueryResult, TenantCatalog } from "../src/domain/decision.ts";
import type { VehicleFact, VehicleType } from "../src/domain/types.ts";

const NOW = "2026-07-01T13:00:00.000Z";
const TENANT = "icom", AGENT = "aloan";
let ok = 0, fail = 0; const fails: string[] = [];
function check(name: string, pass: boolean, detail = ""): void {
  if (pass) { ok++; console.log(`  OK  ${name}`); }
  else { fail++; fails.push(`${name} - ${detail}`); console.log(`  RED ${name}${detail ? ` - ${detail}` : ""}`); }
}

const V = (vehicleKey: string, marca: string, modelo: string, ano: number, preco: number, km: number, tipo: VehicleType): VehicleFact =>
  ({ vehicleKey, marca, modelo, ano, preco, km, tipo });
const RENEGADE = V("revendamais:1", "Jeep", "Renegade", 2018, 72990, 80000, "suv");
const P2008    = V("revendamais:2", "Peugeot", "2008", 2021, 66990, 40000, "suv");
const C3       = V("revendamais:5", "Citroen", "C3", 2015, 47990, 116000, "hatch");
const GOL      = V("revendamais:6", "Volkswagen", "Gol", 2015, 38990, 95000, "hatch");

const catalog: TenantCatalog = buildTenantCatalog([RENEGADE, P2008, C3, GOL]);
const extractor = new CatalogClaimExtractor(catalog);
const sourceFor = (stock: VehicleFact[]): QueryRunner => async (call: QueryCall) => {
  if (call.tool !== "stock_search") return { ok: false, tool: call.tool, error: { code: "NOT_FOUND", message: "n/a", retryable: false } } as QueryResult;
  let pool = stock.filter((v) => typeof v.preco === "number" && v.preco > 0);
  if (call.input.tipo) pool = pool.filter((v) => v.tipo !== "unknown" && v.tipo === call.input.tipo);
  if (typeof call.input.precoMax === "number") pool = pool.filter((v) => v.preco <= call.input.precoMax!);
  if (call.input.modelo) { const m = normalizeText(call.input.modelo); pool = pool.filter((v) => normalizeText(`${v.marca} ${v.modelo}`).includes(m)); }
  return { ok: true as const, tool: "stock_search" as const, data: { items: pool.slice().sort((a, b) => a.preco - b.preco), filtersUsed: call.input as any }, source: "fake" };
};

const sdrPolicy = buildSdrQualificationPolicy({ qualificationQuestions: null, agentName: "Aloan", companyName: null });

async function e2e(leadText: string, stock: VehicleFact[], seed: Partial<ConversationState> = {}) {
  const clock = new FakeClock(NOW); const p = new InMemoryPersistence(clock, new FakeIdGen());
  const state = { ...createInitialState({ conversationId: "cT", tenantId: TENANT, agentId: AGENT, leadId: "l1", now: NOW }), ...seed };
  (p as any).states.set("cT", { state, version: 1 });
  await p.tryInsert({ eventId: "e1", conversationId: "cT", raw: { __redacted: true, text: leadText } as any, receivedAt: NOW });
  return runConversationTurn({
    persistence: p, clock, llm: new FakeLlm(), runQuery: sourceFor(stock),
    conversationId: "cT", tenantId: TENANT, agentId: AGENT, leadId: null, workerId: "w", turnId: "tT", leaseTtlMs: 60_000,
    interpretation: { relation: "asks_vehicle_detail" }, tenantCatalog: catalog, claimExtractor: extractor, sdrPolicy,
    limits: { maxSteps: 4, totalTimeoutMs: 5000 }, maxValidationAttempts: 2, providerCapability: { send_message: "none" },
  } as any);
}

const initialSlots = () => createInitialState({ conversationId: "cT", tenantId: TENANT, agentId: AGENT, leadId: "l1", now: NOW }).slots;

async function main(): Promise<void> {
  console.log("\n=== F2.7.17 Correcoes da auditoria (e2e) ===\n");

  // FINDING 1 (e2e): "suv ate 30 mil" sem SUV na faixa -> resposta SEM carro (nem hatch) + pergunta condutiva.
  {
    const res: any = await e2e("quero um suv ate 30 mil", [RENEGADE, P2008, C3, GOL]); // SUVs > 30k; hatches baratos
    const txt: string = res.status === "committed" ? res.composedText : "";
    check("Finding 1 e2e: turno commitou", res.status === "committed", res.status);
    check("Finding 1 e2e: NAO lista carro (nem hatch)", !!txt && !/renegade|2008|\bc3\b|\bgol\b/i.test(txt), txt.slice(0, 140));
    check("Finding 1 e2e: termina com pergunta", !!txt && txt.trim().endsWith("?"), txt.slice(-100));
  }

  // FINDING 2 (e2e): nome JA conhecido -> "voces tem suv?" oferta SUV + grava tipo/interesse; o conductor
  //   NAO pode reperguntar "qual modelo ou tipo?" no MESMO turno (ve os slots do handler via projecao).
  //   (Sem o fix, o conductor veria interesse "unknown" e enfiaria a pergunta-padrao de interesse.)
  {
    const seed: Partial<ConversationState> = {
      turnNumber: 3,
      slots: { ...initialSlots(), nome: { value: "Douglas", status: "known", confidence: 0.9, updatedAt: NOW } as any },
    };
    const res: any = await e2e("voces tem suv?", [RENEGADE, P2008, C3, GOL], seed);
    const txt: string = res.status === "committed" ? res.composedText : "";
    check("Finding 2 e2e: turno commitou", res.status === "committed", res.status);
    check("Finding 2 e2e: ofertou SUV (Renegade/2008)", !!txt && /renegade|2008/i.test(txt), txt.slice(0, 140));
    check("Finding 2 e2e: NAO repergunta 'modelo ou tipo'", !!txt && !/modelo ou tipo/i.test(txt), txt.slice(-140));
  }

  // FINDING 2b (e2e): PRIMEIRO contato (turnNumber 0) "tem SUV?" -> oferta + APRESENTA o agente + NAO
  //   repergunta o tipo. A projecao dos slots do handler NAO pode bumpar turnNumber, senao o conductor pula a
  //   apresentacao do portal (ensureInitialIntroduction: turnNumber>0 -> nao apresenta). Sem seed => turnNumber 0.
  {
    const res: any = await e2e("voces tem suv?", [RENEGADE, P2008, C3, GOL]);
    const txt: string = res.status === "committed" ? res.composedText : "";
    check("Finding 2b e2e: turno commitou", res.status === "committed", res.status);
    check("Finding 2b e2e: APRESENTA o agente (Aloan) no 1o contato", !!txt && /aloan/i.test(txt), txt.slice(0, 130));
    check("Finding 2b e2e: ofertou SUV", !!txt && /renegade|2008/i.test(txt), txt.slice(0, 170));
    check("Finding 2b e2e: NAO repergunta 'modelo ou tipo'", !!txt && !/modelo ou tipo/i.test(txt), txt.slice(-130));
  }

  console.log(`\n${fail === 0 ? "PASS" : "FAIL"} - ${ok} ok, ${fail} red`);
  if (fails.length) { for (const f of fails) console.log("  - " + f); process.exit(1); }
}

main().catch((e) => { console.error(e); process.exit(1); });
