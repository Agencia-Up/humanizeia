// ============================================================================
// F2.7.10 (dominio BR) — "carro popular" = ENTRADA/economico -> oferta real do estoque;
// "mais vendidos/procurados" = ranking sem fonte -> honesto. + coerencia terminal-safe.
// Offline ($0).  npx tsx tests/run-f2-7-10-popularity.ts
// ============================================================================
import {
  detectPopularEconomyIntent, detectPopularityRankingIntent,
  resolvePopularEconomyOffer, buildPopularEconomyTurnOutput,
  resolvePopularityRankingIntent, buildPopularityRankingTurnOutput,
} from "../src/engine/popularity-intent.ts";
import { runTurn, detectBroadStockQuery } from "../src/engine/decision-engine.ts";
import type { QueryRunner } from "../src/engine/decision-engine.ts";
import { runConversationTurn } from "../src/engine/conversation-engine.ts";
import { InMemoryPersistence, FakeClock, FakeIdGen } from "../src/adapters/persistence/in-memory-store.ts";
import { FakeLlm } from "../src/adapters/llm/fake-llm.ts";
import type { ComposeOverride } from "../src/adapters/llm/fake-llm.ts";
import { buildTenantCatalog, normalizeText } from "../src/engine/catalog-utils.ts";
import { CatalogClaimExtractor } from "../src/engine/turn-context-preparer.ts";
import { createInitialState } from "../src/domain/conversation-state.ts";
import type { DecisionStep, QueryCall, QueryResult, TenantCatalog } from "../src/domain/decision.ts";
import type { TurnContext } from "../src/domain/context.ts";
import type { VehicleFact } from "../src/domain/types.ts";

const NOW = "2026-06-30T20:00:00.000Z";
const TENANT = "icom", AGENT = "aloan";
let ok = 0, fail = 0; const fails: string[] = [];
function check(name: string, pass: boolean, detail = ""): void {
  if (pass) { ok++; console.log(`  OK  ${name}`); }
  else { fail++; fails.push(`${name} — ${detail}`); console.log(`  RED ${name}${detail ? ` — ${detail}` : ""}`); }
}

const STOCK: VehicleFact[] = [
  { vehicleKey: "fiat|uno|2014", marca: "Fiat", modelo: "Uno", ano: 2014, preco: 29990, km: 120000, tipo: "hatch" },
  { vehicleKey: "vw|gol|2015", marca: "Volkswagen", modelo: "Gol", ano: 2015, preco: 38990, km: 95000, tipo: "hatch" },
  { vehicleKey: "fiat|mobi|2019", marca: "Fiat", modelo: "Mobi", ano: 2019, preco: 44990, km: 60000, tipo: "hatch" },
  { vehicleKey: "chevrolet|onix|2014", marca: "Chevrolet", modelo: "Onix", ano: 2014, preco: 54990, km: 130000, tipo: "hatch" },
  { vehicleKey: "jeep|renegade|2018", marca: "Jeep", modelo: "Renegade", ano: 2018, preco: 72990, km: 80000, tipo: "suv" },
  { vehicleKey: "hyundai|hb20|2022", marca: "Hyundai", modelo: "HB20", ano: 2022, preco: 79990, km: 40000, tipo: "hatch" },
];
const catalog: TenantCatalog = buildTenantCatalog(STOCK);
const extractor = new CatalogClaimExtractor(catalog);

let calls: QueryCall[] = [];
const makeRunQuery = (stock: VehicleFact[]): QueryRunner => async (call) => {
  calls.push(call);
  if (call.tool === "stock_search") {
    const modelo = call.input.modelo ? normalizeText(call.input.modelo) : null;
    const items = stock.filter((v) => !modelo || normalizeText(v.modelo).includes(modelo)).slice().sort((a, b) => a.preco - b.preco);
    return { ok: true as const, tool: "stock_search" as const, data: { items, filtersUsed: call.input as any }, source: "fake" };
  }
  return { ok: false, tool: call.tool, error: { code: "NOT_FOUND", message: "n/a", retryable: false } } as QueryResult;
};
const ctx = (leadMessage: string): TurnContext =>
  ({ state: createInitialState({ conversationId: "c1", tenantId: TENANT, agentId: AGENT, leadId: "l1", now: NOW }), turnId: "t1", leadMessage, now: NOW, interpretation: { relation: "asks_vehicle_detail" }, tenantCatalog: catalog, claimExtractor: extractor });
const limits = { maxSteps: 4, totalTimeoutMs: 5000 };

async function engineTurn(text: string, stock: VehicleFact[] = STOCK) {
  calls = [];
  const clock = new FakeClock(NOW);
  const p = new InMemoryPersistence(clock, new FakeIdGen());
  await p.tryInsert({ eventId: "e1", conversationId: "cE", raw: { __redacted: true, text } as any, receivedAt: NOW });
  await runConversationTurn({
    persistence: p, clock, llm: new FakeLlm(), runQuery: makeRunQuery(stock),
    conversationId: "cE", tenantId: TENANT, agentId: AGENT, leadId: null,
    workerId: "w", turnId: "tE", leaseTtlMs: 60_000,
    interpretation: { relation: "asks_vehicle_detail" }, tenantCatalog: catalog, claimExtractor: extractor,
    limits: { maxSteps: 4, totalTimeoutMs: 5000 }, maxValidationAttempts: 2,
    providerCapability: { send_message: "none" } as any,
  });
  const outbox = await p.listOutbox("cE");
  return { outbox, broadCall: calls.find((c) => c.tool === "stock_search" && (c.input as any)?.broad === true) };
}

async function main(): Promise<void> {
  console.log("\n=== F2.7.10 Populares=economico + ranking honesto + coerencia ===\n");

  // 1) ECONOMY detection
  for (const m of ["mais populares", "carros populares", "modelos populares", "tem populares?", "queria um popular"]) {
    check(`economy: "${m}" -> true`, detectPopularEconomyIntent(m) === true);
  }
  for (const m of ["mais vendidos", "mais baratos", "quero um onix", "Boa tarde"]) {
    check(`economy: "${m}" -> false`, detectPopularEconomyIntent(m) === false);
  }
  // 2) RANKING detection
  for (const m of ["mais vendidos", "quais os mais procurados?", "o que mais sai?", "quais mais saem", "tem best sellers?", "campeões de venda"]) {
    check(`ranking: "${m}" -> true`, detectPopularityRankingIntent(m) === true);
  }
  for (const m of ["mais populares", "carros populares", "mais baratos", "quero um onix"]) {
    check(`ranking: "${m}" -> false`, detectPopularityRankingIntent(m) === false);
  }
  // 3) "mais baratos" segue na via de PRECO (F2.7.9), nao economy/ranking
  check("baratos: broad-price true", detectBroadStockQuery({ leadMessage: "mais baratos" }) === true);
  check("baratos: economy false", detectPopularEconomyIntent("mais baratos") === false);

  // 4) resolvePopularEconomyOffer: 5 mais em conta; vazio -> none
  {
    const r = await resolvePopularEconomyOffer({ runQuery: makeRunQuery(STOCK) });
    check("economy offer: 5 veiculos", r.kind === "offer" && r.vehicles.length === 5, JSON.stringify(r.kind));
    check("economy offer: 1o = mais barato (Uno)", r.kind === "offer" && r.vehicles[0].modelo === "Uno");
    check("economy offer: exclui o mais caro (HB20)", r.kind === "offer" && !r.vehicles.some((v) => v.modelo === "HB20"));
    const empty = await resolvePopularEconomyOffer({ runQuery: makeRunQuery([]) });
    check("economy offer vazio -> none", empty.kind === "none");
  }
  // 5) buildPopularEconomyTurnOutput: nota + lista ancorada; nao terminal-safe; so send_message
  {
    const offer = buildPopularEconomyTurnOutput({ kind: "offer", vehicles: [STOCK[0], STOCK[1]] }, "t-eco");
    check("economy build: NAO terminal-safe", offer.terminalSafe === false);
    check("economy build: reasonCode popular_economy_offer", offer.decision.reasonCode === "popular_economy_offer");
    check("economy build: so send_message (sem send_media)", offer.decision.effectPlan.every((p) => p.kind === "send_message"));
    check("economy build: nota explica criterio (entrada/economicas)", /entrada|econom/i.test(offer.composed.text), offer.composed.text.slice(0, 80));
    check("economy build: lista ancorada (Uno + preco)", /uno/i.test(offer.composed.text) && /29\.990/.test(offer.composed.text), offer.composed.text);
    const none = buildPopularEconomyTurnOutput({ kind: "none" }, "t-eco0");
    check("economy build none: honesto, sem inventar", none.terminalSafe === false && /nao tenho opcoes de entrada|não tenho opções de entrada/i.test(none.composed.text));
  }
  // 6) buildPopularityRankingTurnOutput: honesto, sem oferta
  {
    const r = buildPopularityRankingTurnOutput("t-rk");
    check("ranking build: NAO terminal-safe", r.terminalSafe === false);
    check("ranking build: reasonCode popularity_ranking_no_data", r.decision.reasonCode === "popularity_ranking_no_data");
    check("ranking build: honesto (nao invento ranking)", /ranking real de vendas|nao vou inventar|não vou inventar/i.test(r.composed.text), r.composed.text);
  }
  check("resolve ranking: honest", resolvePopularityRankingIntent({ leadMessage: "mais vendidos" })?.kind === "honest");
  check("resolve ranking: populares -> null (nao e ranking)", resolvePopularityRankingIntent({ leadMessage: "mais populares" }) === null);

  // 7) e2e: "mais populares" -> stock_search(broad) + send_message, sem send_media (lista real)
  {
    const { outbox, broadCall } = await engineTurn("mais populares");
    check("e2e economy: rodou stock_search(broad)", !!broadCall);
    check("e2e economy: outbox send_message, ZERO send_media", outbox.some((r) => r.kind === "send_message") && !outbox.some((r) => r.kind === "send_media"), JSON.stringify(outbox.map((r) => r.kind)));
  }
  // 8) e2e: "carros populares e baratos" -> tambem oferta real (economy), sem ranking inventado
  {
    const { outbox, broadCall } = await engineTurn("carros populares e baratos");
    check("e2e combo: rodou stock_search(broad) + send_message", !!broadCall && outbox.some((r) => r.kind === "send_message"));
  }
  // 9) e2e: "mais vendidos" -> honesto, SEM stock_search, sem send_media
  {
    const { outbox, broadCall } = await engineTurn("quais os mais vendidos?");
    check("e2e ranking: NAO rodou stock_search(broad)", !broadCall);
    check("e2e ranking: outbox send_message, sem send_media", outbox.some((r) => r.kind === "send_message") && !outbox.some((r) => r.kind === "send_media"));
  }

  // 9b) ⭐ P1 do Codex: HIBRIDO popular + ranking explicito -> o RANKING VENCE (honesto, NAO stock_search broad)
  {
    // o conflito existe (ambos os detectores acendem); o engine resolve dando prioridade ao ranking
    check("hibrido: 'carros populares mais vendidos' acende economy E ranking", detectPopularEconomyIntent("carros populares mais vendidos") === true && detectPopularityRankingIntent("carros populares mais vendidos") === true);
    for (const m of ["carros populares mais vendidos", "populares mais procurados", "modelos populares que mais saem"]) {
      const { outbox, broadCall } = await engineTurn(m);
      check(`e2e hibrido: "${m}" -> RANKING honesto (sem stock_search broad, so send_message)`, !broadCall && outbox.some((r) => r.kind === "send_message") && !outbox.some((r) => r.kind === "send_media"), JSON.stringify(outbox.map((r) => r.kind)));
    }
  }

  // 10) Tarefa 2 — coerencia: oferta grounded nao e terminal-safe; ungrounded -> terminal-safe so com fallback
  {
    const offerCompose: ComposeOverride = (_d, facts) => {
      const s = facts.find((f) => f.ok && f.tool === "stock_search");
      const keys = s && s.ok && s.tool === "stock_search" ? s.data.items.map((v) => v.vehicleKey) : [];
      return { parts: [{ type: "text", content: "Opções em conta:" }, { type: "vehicle_offer_list", vehicleKeys: keys }] };
    };
    const fakeCompose: ComposeOverride = () => ({ parts: [{ type: "text", content: "Veja:" }, { type: "vehicle_offer_list", vehicleKeys: ["fake|key|9999"] }] });
    const script = (): DecisionStep[] => [{ kind: "final", proposal: { proposedAction: "reply", facts: [], proposedEffects: [{ kind: "send_message", planId: "reply", order: 0, onSuccess: [] }], responsePlan: { guidance: "ofertar" }, reasonCode: "x", reasonSummary: "x", confidence: 1 } }];

    const llmOk = new FakeLlm(); llmOk.setTurnScript(script(), offerCompose);
    const valid = await runTurn({ ctx: ctx("Quais modelos baratos você tem?"), llm: llmOk, runQuery: makeRunQuery(STOCK), limits, maxValidationAttempts: 2 });
    check("T2: oferta grounded -> NAO terminal-safe", valid.terminalSafe === false && valid.decision.reasonCode !== "terminal_safe", valid.decision.reasonCode);

    const llmBad = new FakeLlm(); llmBad.setTurnScript(script(), fakeCompose);
    const bad = await runTurn({ ctx: ctx("me ve umas opcoes ai"), llm: llmBad, runQuery: makeRunQuery(STOCK), limits, maxValidationAttempts: 2 });
    check("T2: oferta ungrounded -> terminal-safe", bad.terminalSafe === true);
    check("T2: terminal-safe so com send_message (cancela comercial)", bad.decision.effectPlan.every((p) => p.kind === "send_message"));
  }

  console.log(`\n=== F2.7.10: ${ok} OK | ${fail} FALHA ===`);
  if (fail > 0) { for (const f of fails) console.error("  - " + f); process.exit(1); }
}

main().catch((error) => { console.error(error); process.exit(1); });
