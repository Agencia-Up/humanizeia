// ============================================================================
// F2.7.9 — Busca AMPLA por preco baixo ("modelos baratos") -> stock_search + lista real,
// nunca terminal-safe. Offline ($0).  npx tsx tests/run-f2-7-9-cheap-stock.ts
// ============================================================================
import { runTurn, detectBroadStockQuery, limitCheapest } from "../src/engine/decision-engine.ts";
import type { QueryRunner } from "../src/engine/decision-engine.ts";
import { FakeLlm } from "../src/adapters/llm/fake-llm.ts";
import type { ComposeOverride } from "../src/adapters/llm/fake-llm.ts";
import { buildTenantCatalog, normalizeText } from "../src/engine/catalog-utils.ts";
import { CatalogClaimExtractor } from "../src/engine/turn-context-preparer.ts";
import { createInitialState } from "../src/domain/conversation-state.ts";
import type { ConversationState } from "../src/domain/conversation-state.ts";
import type { DecisionStep, QueryCall, QueryResult, TenantCatalog, TurnInterpretation } from "../src/domain/decision.ts";
import type { TurnContext } from "../src/domain/context.ts";
import type { VehicleFact } from "../src/domain/types.ts";

const NOW = "2026-06-30T19:00:00.000Z";
let ok = 0, fail = 0; const fails: string[] = [];
function check(name: string, pass: boolean, detail = ""): void {
  if (pass) { ok++; console.log(`  OK  ${name}`); }
  else { fail++; fails.push(`${name} — ${detail}`); console.log(`  RED ${name}${detail ? ` — ${detail}` : ""}`); }
}

const STOCK: VehicleFact[] = [
  { vehicleKey: "vw|gol|2015", marca: "Volkswagen", modelo: "Gol", ano: 2015, preco: 38990, tipo: "hatch" },
  { vehicleKey: "fiat|uno|2014", marca: "Fiat", modelo: "Uno", ano: 2014, preco: 29990, tipo: "hatch" },
  { vehicleKey: "chevrolet|onix|2014", marca: "Chevrolet", modelo: "Onix", ano: 2014, preco: 54990, tipo: "hatch" },
  { vehicleKey: "jeep|renegade|2018", marca: "Jeep", modelo: "Renegade", ano: 2018, preco: 72990, tipo: "suv" },
  { vehicleKey: "hyundai|hb20|2022", marca: "Hyundai", modelo: "HB20", ano: 2022, preco: 79990, tipo: "hatch" },
  { vehicleKey: "fiat|mobi|2019", marca: "Fiat", modelo: "Mobi", ano: 2019, preco: 44990, tipo: "hatch" },
]; // 6 veiculos; 5 mais baratos = Uno, Gol, Mobi, Onix, Renegade (HB20 fora)
const catalog: TenantCatalog = buildTenantCatalog(STOCK);
const extractor = new CatalogClaimExtractor(catalog);

let calls: QueryCall[] = [];
const makeRunQuery = (stock: VehicleFact[]): QueryRunner => async (call) => {
  calls.push(call);
  if (call.tool === "stock_search") {
    const modelo = call.input.modelo ? normalizeText(call.input.modelo) : null;
    const items = stock.filter((v) => !modelo || normalizeText(v.modelo).includes(modelo))
      .slice().sort((a, b) => a.preco - b.preco); // a fonte real ordena por preco asc
    return { ok: true as const, tool: "stock_search" as const, data: { items, filtersUsed: call.input as any }, source: "fake" };
  }
  return { ok: false, tool: call.tool, error: { code: "NOT_FOUND", message: "n/a", retryable: false } } as QueryResult;
};

const baseState = (): ConversationState => createInitialState({ conversationId: "c1", tenantId: "icom", agentId: "aloan", leadId: "l1", now: NOW });
const ctx = (leadMessage: string, interpretation: TurnInterpretation = { relation: "asks_vehicle_detail" }): TurnContext =>
  ({ state: baseState(), turnId: "t1", leadMessage, now: NOW, interpretation, tenantCatalog: catalog, claimExtractor: extractor });

// compose dirigido: oferta via vehicle_offer_list com os keys DOS FATOS (grounded); honesto se vazio.
const offerCompose: ComposeOverride = (_decision, facts) => {
  const stock = facts.find((f) => f.ok && f.tool === "stock_search");
  const keys = stock && stock.ok && stock.tool === "stock_search" ? stock.data.items.map((v) => v.vehicleKey) : [];
  return keys.length > 0
    ? { parts: [{ type: "text", content: "Separei algumas opções mais em conta:" }, { type: "vehicle_offer_list", vehicleKeys: keys }] }
    : { parts: [{ type: "text", content: "No momento não temos opções no estoque. Quer que eu te avise quando chegar algo?" }] };
};
const offerScript = (): DecisionStep[] => [{
  kind: "final",
  proposal: { proposedAction: "reply", facts: [], proposedEffects: [{ kind: "send_message", planId: "reply", order: 0, onSuccess: [] }], responsePlan: { guidance: "Ofertar opcoes em conta." }, reasonCode: "offer_cheap", reasonSummary: "ofertar baratos", confidence: 1 },
}];
const limits = { maxSteps: 4, totalTimeoutMs: 5000 };

async function runBroad(leadMessage: string, stock: VehicleFact[] = STOCK) {
  calls = [];
  const llm = new FakeLlm();
  llm.setTurnScript(offerScript(), offerCompose);
  const out = await runTurn({ ctx: ctx(leadMessage), llm, runQuery: makeRunQuery(stock), limits, maxValidationAttempts: 2 });
  const broadCall = calls.find((c) => c.tool === "stock_search" && (c.input as any)?.broad === true);
  return { out, broadCall };
}

async function main(): Promise<void> {
  console.log("\n=== F2.7.9 Busca ampla por preco baixo ===\n");

  // 1) detectBroadStockQuery
  for (const m of ["Quais modelos baratos você tem?", "Tem carros mais baratos?", "Quero opções econômicas", "tem algo mais em conta?", "quero algo acessível"]) {
    check(`detect: "${m}" -> true`, detectBroadStockQuery({ leadMessage: m }) === true);
  }
  for (const m of ["quero um onix", "Boa tarde", "tem gol?", "qual o horário de vocês?"]) {
    check(`detect: "${m}" -> false`, detectBroadStockQuery({ leadMessage: m }) === false);
  }

  // 2) limitCheapest: ordena por preco asc + limita a 5
  {
    const res = { ok: true as const, tool: "stock_search" as const, data: { items: STOCK, filtersUsed: {} }, source: "fake" } as QueryResult;
    const lim = limitCheapest(res, 5) as any;
    check("limitCheapest: limita a 5", lim.data.items.length === 5);
    check("limitCheapest: 1o = mais barato (Uno)", lim.data.items[0].modelo === "Uno" && lim.data.items[0].preco === 29990);
    check("limitCheapest: ordenado asc", lim.data.items.every((v: VehicleFact, i: number, a: VehicleFact[]) => i === 0 || a[i - 1].preco <= v.preco));
    check("limitCheapest: exclui o mais caro (HB20)", !lim.data.items.some((v: VehicleFact) => v.modelo === "HB20"));
  }

  // 3) e2e: "Quais modelos baratos" -> stock_search(broad) + NAO terminal-safe + lista grounded
  {
    const { out, broadCall } = await runBroad("Quais modelos baratos você tem?");
    check("e2e: rodou stock_search(broad)", !!broadCall);
    check("e2e: NAO terminal-safe", out.terminalSafe === false && out.decision.reasonCode !== "terminal_safe", out.decision.reasonCode);
    const f = out.facts.find((x) => x.ok && x.tool === "stock_search");
    check("e2e: facts tem 1..5 veiculos mais baratos", !!f && f.ok && f.tool === "stock_search" && f.data.items.length > 0 && f.data.items.length <= 5);
    check("e2e: resposta cita o mais barato (Uno) — grounded, sem grude", /uno/i.test(out.composed.text) && !/desculpe a lentid/i.test(out.composed.text), out.composed.text);
  }

  // 4) "Tem carros mais baratos?" / "Quero opções econômicas" -> broad + nao terminal-safe
  for (const m of ["Tem carros mais baratos?", "Quero opções econômicas"]) {
    const { out, broadCall } = await runBroad(m);
    check(`e2e: "${m}" -> stock_search(broad), nao terminal-safe`, !!broadCall && out.terminalSafe === false && out.decision.reasonCode !== "terminal_safe", out.decision.reasonCode);
  }

  // 5) estoque vazio -> honesto, SEM terminal-safe
  {
    const { out, broadCall } = await runBroad("Quais modelos baratos você tem?", []);
    check("e2e vazio: rodou broad", !!broadCall);
    check("e2e vazio: NAO terminal-safe", out.terminalSafe === false && out.decision.reasonCode !== "terminal_safe", out.decision.reasonCode);
    check("e2e vazio: resposta honesta (sem lista)", /nao temos|não temos|estoque/i.test(out.composed.text), out.composed.text);
  }

  // 6) modelo nomeado NAO vira broad (usa stock_search por modelo)
  {
    calls = [];
    const llm = new FakeLlm(); llm.setTurnScript(offerScript(), offerCompose);
    await runTurn({ ctx: ctx("quero um onix", { relation: "asks_vehicle_detail", extractedEntities: { models: ["onix"] } }), llm, runQuery: makeRunQuery(STOCK), limits, maxValidationAttempts: 2 });
    const broadCall = calls.find((c) => c.tool === "stock_search" && (c.input as any)?.broad === true);
    const modelCall = calls.find((c) => c.tool === "stock_search" && (c.input as any)?.modelo);
    check("e2e: modelo nomeado -> stock_search(modelo), NAO broad", !broadCall && !!modelCall);
  }

  console.log(`\n=== F2.7.9: ${ok} OK | ${fail} FALHA ===`);
  if (fail > 0) { for (const f of fails) console.error("  - " + f); process.exit(1); }
}

main().catch((error) => { console.error(error); process.exit(1); });
