// ============================================================================
// F2.7.13 - PRIORIDADE DO TURNO ATUAL. O lead pediu AGORA -> resposta sobre o
// pedido atual, com catalogo dinamico e filtros combinados. Nunca usa interesse
// velho (Argo/Onix/lista antiga) para responder Jeep/Toyota/BYD/etc.
//   npx tsx tests/run-f2-7-13-turn-priority.ts
// ============================================================================
import { computeTurnFrame, resolveExplicitSearchIntent, buildExplicitSearchTurnOutput, resolveMoreOptionsIntent } from "../src/engine/explicit-search.ts";
import { detectContinuityIntent } from "../src/engine/continuity-fallback.ts";
import { runConversationTurn } from "../src/engine/conversation-engine.ts";
import { deriveModelContext } from "../src/engine/model-context-view.ts";
import { InMemoryPersistence, FakeClock, FakeIdGen } from "../src/adapters/persistence/in-memory-store.ts";
import { FakeLlm, type ComposeOverride } from "../src/adapters/llm/fake-llm.ts";
import { buildTenantCatalog, normalizeText } from "../src/engine/catalog-utils.ts";
import { CatalogClaimExtractor } from "../src/engine/turn-context-preparer.ts";
import type { ConversationState } from "../src/domain/conversation-state.ts";
import { createInitialState } from "../src/domain/conversation-state.ts";
import type { QueryRunner } from "../src/engine/decision-engine.ts";
import type { QueryCall, QueryResult, TenantCatalog, TurnInterpretation } from "../src/domain/decision.ts";
import type { VehicleFact } from "../src/domain/types.ts";

const NOW = "2026-06-30T23:30:00.000Z";
const TENANT = "icom", AGENT = "aloan";
let ok = 0, fail = 0; const fails: string[] = [];
function check(name: string, pass: boolean, detail = ""): void {
  if (pass) { ok++; console.log(`  OK  ${name}`); }
  else { fail++; fails.push(`${name} - ${detail}`); console.log(`  RED ${name}${detail ? ` - ${detail}` : ""}`); }
}

const ONIX = "chevrolet|onix|2014", GOL = "vw|gol|2015", HB20_AUTO = "hyundai|hb20|2021", RENEGADE = "jeep|renegade|2018", COMPASS = "jeep|compass|2020", CRUZE = "chevrolet|cruze|2019", BYD = "byd|song|2024", COROLLA = "toyota|corolla|2018", STRADA = "fiat|strada|2018", TORO = "fiat|toro|2017";
const STOCK: VehicleFact[] = [
  { vehicleKey: ONIX, marca: "Chevrolet", modelo: "Onix", ano: 2014, preco: 54990, km: 132000, tipo: "hatch", cambio: "Manual" },
  { vehicleKey: GOL, marca: "Volkswagen", modelo: "Gol", ano: 2015, preco: 38990, km: 95000, tipo: "hatch", cambio: "Manual" },
  { vehicleKey: HB20_AUTO, marca: "Hyundai", modelo: "HB20", ano: 2021, preco: 69990, km: 50000, tipo: "hatch", cambio: "Automatico" },
  { vehicleKey: RENEGADE, marca: "Jeep", modelo: "Renegade", ano: 2018, preco: 72990, km: 80000, tipo: "suv" },
  { vehicleKey: COMPASS, marca: "Jeep", modelo: "Compass", ano: 2020, preco: 99990, km: 45000, tipo: "suv" },
  { vehicleKey: CRUZE, marca: "Chevrolet", modelo: "Cruze", ano: 2019, preco: 79990, km: 60000, tipo: "sedan" },
  { vehicleKey: BYD, marca: "BYD", modelo: "Song", ano: 2024, preco: 149990, km: 9000, tipo: "suv" },
  { vehicleKey: COROLLA, marca: "Toyota", modelo: "Corolla", ano: 2018, preco: 55990, km: 110000, tipo: "sedan" },
  { vehicleKey: STRADA, marca: "Fiat", modelo: "Strada", ano: 2018, preco: 76990, km: 104000, tipo: "pickup" },
  { vehicleKey: TORO, marca: "Fiat", modelo: "Toro", ano: 2017, preco: 94990, km: 88000, tipo: "pickup" },
];
const NO_JEEP = STOCK.filter((v) => v.marca !== "Jeep");
const PHOTOS: Record<string, string[]> = Object.fromEntries(STOCK.map((v) => [v.vehicleKey, ["p1"]]));
const catalog: TenantCatalog = buildTenantCatalog(STOCK);
const extractor = new CatalogClaimExtractor(catalog);

let calls: QueryCall[] = [];
const runQueryFor = (stock: VehicleFact[]): QueryRunner => async (call) => {
  calls.push(call);
  if (call.tool === "stock_search") {
    let pool = stock.filter((v) => typeof v.preco === "number" && v.preco > 0);
    if (call.input.modelo) { const m = normalizeText(call.input.modelo); pool = pool.filter((v) => normalizeText(`${v.marca} ${v.modelo}`).includes(m)); }
    if (call.input.tipo) pool = pool.filter((v) => v.tipo === call.input.tipo);
    if (typeof call.input.precoMax === "number") pool = pool.filter((v) => v.preco <= call.input.precoMax!);
    pool = pool.slice().sort((a, b) => a.preco - b.preco);
    return { ok: true as const, tool: "stock_search" as const, data: { items: pool, filtersUsed: call.input as any }, source: "fake" };
  }
  if (call.tool === "vehicle_photos_resolve") { const key = call.input.vehicleRef.key; return { ok: true as const, tool: "vehicle_photos_resolve" as const, data: { vehicleKey: key, ambiguous: false, photoIds: PHOTOS[key] ?? [] }, source: "fake" }; }
  return { ok: false, tool: call.tool, error: { code: "NOT_FOUND", message: "n/a", retryable: false } } as QueryResult;
};
const runQuery = runQueryFor(STOCK);
const runQueryWithBrokenPickupType: QueryRunner = async (call) => {
  calls.push(call);
  if (call.tool === "stock_search" && call.input.tipo === "pickup" && !call.input.modelo) {
    return { ok: true as const, tool: "stock_search" as const, data: { items: [], filtersUsed: call.input as any }, source: "fake" };
  }
  return runQueryFor(STOCK)(call);
};
const frame = (m: string) => computeTurnFrame({ leadMessage: m, claimExtractor: extractor });
const explicit = (m: string, q: QueryRunner = runQuery) => { calls = []; return resolveExplicitSearchIntent({ leadMessage: m, claimExtractor: extractor, interpretation: { relation: "asks_vehicle_detail" }, runQuery: q }); };

const baseState = (over: Partial<ConversationState> = {}): ConversationState => ({ ...createInitialState({ conversationId: "c1", tenantId: TENANT, agentId: AGENT, leadId: "l1", now: NOW }), ...over });
const seededState = (): ConversationState => baseState({
  turnNumber: 5,
  recentTurns: [{ role: "agent", text: "Separei: 1. Fiat Argo 2018 - R$ 45.990\n2. Chevrolet Onix 2014 - R$ 54.990", at: NOW }],
  slots: { ...baseState().slots, interesse: { value: "onix, renegade, argo, hb 20, 3", status: "known", confidence: 0.9, updatedAt: NOW } } as any,
  lastRenderedOfferContext: { sourceTurnId: "told", createdAt: NOW, items: [{ ordinal: 1, vehicleKey: "fiat|argo|2018", marca: "Fiat", modelo: "Argo", ano: 2018 }, { ordinal: 2, vehicleKey: ONIX, marca: "Chevrolet", modelo: "Onix", ano: 2014 }] },
});

// 1B.7: dublê do compose do LLM real. Se há veículos nos fatos do turno, emite UM vehicle_offer_list
// ancorado (o renderer resolve marca/modelo/preço/km) — como o LLM real faria seguindo o guidance; senão,
// texto honesto SEM inventar marca. Prova o fluxo handler->fatos->compose sem depender de texto fixo.
const fakeCompose: ComposeOverride = (_decision, facts) => {
  const items = facts.filter((f) => f.ok && f.tool === "stock_search").flatMap((f) => (f as Extract<QueryResult, { ok: true; tool: "stock_search" }>).data.items ?? []);
  if (items.length > 0) return { parts: [{ type: "text", content: "Encontrei estas opcoes pra voce:" }, { type: "vehicle_offer_list", vehicleKeys: items.slice(0, 5).map((v) => v.vehicleKey) }] };
  return { parts: [{ type: "text", content: "No momento nao achei esse modelo no nosso estoque. Quer que eu amplie a faixa de valor ou veja outro tipo?" }] };
};

async function e2e(leadText: string, stock: VehicleFact[], state: ConversationState) {
  calls = [];
  const clock = new FakeClock(NOW); const p = new InMemoryPersistence(clock, new FakeIdGen());
  (p as any).states.set("cT", { state, version: 1 });
  await p.tryInsert({ eventId: "e1", conversationId: "cT", raw: { __redacted: true, text: leadText } as any, receivedAt: NOW });
  const llm = new FakeLlm(); llm.setTurnScript([], fakeCompose);
  const res = await runConversationTurn({
    persistence: p, clock, llm, runQuery: runQueryFor(stock),
    conversationId: "cT", tenantId: TENANT, agentId: AGENT, leadId: null, workerId: "w", turnId: "tT", leaseTtlMs: 60_000,
    interpretation: { relation: "asks_vehicle_detail" }, tenantCatalog: catalog, claimExtractor: extractor,
    limits: { maxSteps: 4, totalTimeoutMs: 5000 }, maxValidationAttempts: 2, providerCapability: { send_message: "none" } as any,
  });
  return res;
}

async function main(): Promise<void> {
  console.log("\n=== F2.7.13 Prioridade do turno atual ===\n");

  check("frame: 'voces tem jeep?' -> newIntent (marca dinamica)", frame("voces tem jeep?").isNewCommercialIntent === true && frame("voces tem jeep?").explicitBrands.includes("Jeep"));
  check("frame: 'voces tem byd?' -> marca dinamica fora da lista velha", frame("voces tem byd?").isNewCommercialIntent === true && frame("voces tem byd?").explicitBrands.includes("BYD"));
  check("frame: 'tem gol?' -> newIntent (modelo)", frame("tem gol?").isNewCommercialIntent === true);
  check("frame: 'quero sedan' -> newIntent (tipo)", frame("quero sedan").isNewCommercialIntent === true && frame("quero sedan").explicitTypes.includes("sedan"));
  check("frame: 'ate 60 mil' -> newIntent (faixa)", frame("tem algo ate 60 mil?").isNewCommercialIntent === true && frame("tem algo ate 60 mil?").budgetMax === 60000);
  check("frame: 'esse tem foto?' -> referenceOnly (nao newIntent)", frame("esse tem foto?").isNewCommercialIntent === false && frame("esse tem foto?").isReferenceOnly === true);
  check("frame: 'Boa noite' -> nem newIntent nem reference", frame("Boa noite").isNewCommercialIntent === false && frame("Boa noite").isReferenceOnly === false);
  // P1 busca SEMÂNTICA (Codex): "hatch automático" = tipo hatch + câmbio (filtro), NUNCA modelo "hatch automatico".
  {
    const fH = computeTurnFrame({ leadMessage: "prefiro hatch automatico", claimExtractor: extractor, interpretation: { relation: "direction_change", extractedEntities: { model: "hatch automatico" } } });
    check("busca semântica: 'hatch automático' -> tipo hatch, sem modelo com câmbio", fH.explicitTypes.includes("hatch") && fH.explicitModels.every((m) => !/automatic/i.test(m) && normalizeText(m) !== "hatch automatico"), JSON.stringify({ t: fH.explicitTypes, m: fH.explicitModels }));
  }

  {
    const fAuto = frame("prefiro hatch automatico");
    const fManual = frame("prefiro manual");
    const fNoAuto = frame("nao quero automatico");
    check("cambio: hatch automatico -> transmission automatic", fAuto.transmission === "automatic" && fAuto.explicitTypes.includes("hatch"), JSON.stringify(fAuto));
    check("cambio: manual -> transmission manual", fManual.transmission === "manual", JSON.stringify(fManual));
    check("cambio: nao quero automatico -> manual", fNoAuto.transmission === "manual", JSON.stringify(fNoAuto));
  }

  {
    const autoHatch = await explicit("prefiro hatch automatico");
    check("explicit: hatch automatico -> so automaticos mesmo se source devolver manuais", autoHatch?.kind === "offer" && autoHatch.vehicles.length === 1 && autoHatch.vehicles[0].vehicleKey === HB20_AUTO, JSON.stringify(autoHatch));
    check("explicit: query carregou tipo hatch + cambio automatic", calls.some((c) => c.tool === "stock_search" && c.input.tipo === "hatch" && c.input.cambio === "automatic"), JSON.stringify(calls));
  }

  {
    const jeep = await explicit("voces tem jeep?");
    check("explicit: 'jeep' -> offer com veiculos Jeep", jeep?.kind === "offer" && jeep.vehicles.every((v) => v.marca === "Jeep") && jeep.vehicles.length >= 1, JSON.stringify(jeep?.kind));
    check("explicit: rodou stock_search por jeep", calls.some((c) => c.tool === "stock_search" && /jeep/i.test(JSON.stringify(c.input))));
    const byd = await explicit("voces tem byd?");
    check("explicit: marca dinamica BYD -> offer", byd?.kind === "offer" && byd.vehicles.some((v) => v.marca === "BYD"), JSON.stringify(byd));
    const noJeep = await explicit("voces tem jeep?", runQueryFor(NO_JEEP));
    check("explicit: 'jeep' SEM estoque -> none honesto", noJeep?.kind === "none", JSON.stringify(noJeep));
    const sedan = await explicit("quero sedan");
    check("explicit: 'sedan' -> offer (tipo)", sedan?.kind === "offer" && sedan.vehicles.every((v) => v.tipo === "sedan"));
    const pickup = await explicit("queria uma picape", runQueryWithBrokenPickupType);
    check("explicit: 'picape' usa fallback de taxonomia quando filtro tipo vem vazio", pickup?.kind === "offer" && pickup.vehicles.some((v) => v.modelo === "Strada") && pickup.vehicles.some((v) => v.modelo === "Toro"), JSON.stringify(pickup));
    check("explicit: fallback de picape consultou modelos canonicos", calls.some((c) => c.tool === "stock_search" && c.input.modelo === "Strada") && calls.some((c) => c.tool === "stock_search" && c.input.modelo === "Toro"), JSON.stringify(calls));
    check("explicit: 'Boa noite' -> null", (await explicit("Boa noite")) === null);
  }

  {
    const jeep80 = await explicit("tem jeep ate 80 mil?");
    check("combo: Jeep + teto 80k -> so veiculos <=80k", jeep80?.kind === "offer" && jeep80.vehicles.length === 1 && jeep80.vehicles.every((v) => v.marca === "Jeep" && v.preco <= 80000), JSON.stringify(jeep80));
    check("combo: query carregou modelo+precoMax", calls.some((c) => c.tool === "stock_search" && c.input.modelo && c.input.precoMax === 80000), JSON.stringify(calls));
    const sedan60 = await explicit("quero sedan ate 60 mil");
    check("combo: sedan + teto 60k -> filtra ambos", sedan60?.kind === "offer" && sedan60.vehicles.every((v) => v.tipo === "sedan" && v.preco <= 60000), JSON.stringify(sedan60));
  }

  {
    const multi = await explicit("jeep ou toyota?");
    check("multi-marca: busca os dois alvos, nao cai para memoria", multi?.kind === "offer" && multi.vehicles.some((v) => v.marca === "Jeep") && multi.vehicles.some((v) => v.marca === "Toyota"), JSON.stringify(multi));
    check("multi-marca: nao citou Argo/Onix antigos", multi?.kind === "offer" && multi.vehicles.every((v) => !/argo|onix/i.test(`${v.marca} ${v.modelo}`)), JSON.stringify(multi));
    const multiModel = await explicit("onix ou gol?");
    check("multi-modelo: busca Onix e Gol deterministicamente", multiModel?.kind === "offer" && multiModel.vehicles.some((v) => v.modelo === "Onix") && multiModel.vehicles.some((v) => v.modelo === "Gol"), JSON.stringify(multiModel));
  }

  {
    const offer = buildExplicitSearchTurnOutput({ kind: "offer", label: "Jeep", vehicles: [STOCK[2], STOCK[3]], missingLabels: [] }, "t");
    check("build offer: NAO terminal-safe + reasonCode explicit_offer", offer.terminalSafe === false && offer.decision.reasonCode === "explicit_offer");
    check("build offer: lista ancorada + renderedOfferContext", /renegade/i.test(offer.composed.text) && (offer.renderedOfferContext?.length ?? 0) === 2);
    const none = buildExplicitSearchTurnOutput({ kind: "none", label: "Jeep" }, "t");
    check("build none: honesto, NAO terminal-safe, sem Desculpe", none.terminalSafe === false && /nao tenho jeep/i.test(none.composed.text) && !/desculpe a lentid/i.test(none.composed.text), none.composed.text);
  }

  {
    const state = seededState();
    const c = deriveModelContext(state, { relation: "asks_vehicle_detail" }, { leadMessage: "voces tem jeep?", claimExtractor: extractor });
    check("contexto: currentTurnFrame aponta Jeep", c.currentTurnFrame?.isNewCommercialIntent === true && c.currentTurnFrame.explicitBrands.includes("Jeep"), JSON.stringify(c.currentTurnFrame));
    check("contexto: interesse velho nao aparece em conversationFacts quando turno atual e novo", !c.conversationFacts.some((f) => /argo|onix|3/.test(f)), JSON.stringify(c.conversationFacts));
    check("contexto: lastCommercialInterest usa turno atual, nao Argo antigo", c.lastCommercialInterest?.model === "Jeep", JSON.stringify(c.lastCommercialInterest));
  }

  {
    const res: any = await e2e("voces tem jeep?", STOCK, seededState());
    check("e2e jeep: committed + reasonCode explicit_offer", res.status === "committed" && res.decision.reasonCode === "explicit_offer", res.status === "committed" ? res.decision.reasonCode : res.status);
    check("e2e jeep: resposta fala de Jeep, NUNCA Argo/Onix", res.status === "committed" && /renegade|compass/i.test(res.composedText) && !/argo|onix/i.test(res.composedText), res.composedText);
    check("e2e jeep: rodou stock_search por jeep", calls.some((c) => c.tool === "stock_search" && /jeep/i.test(JSON.stringify(c.input))));
  }
  {
    const res: any = await e2e("quero Jeep", STOCK, seededState());
    check("e2e quero jeep: explicit_offer Jeep ignora lista antiga", res.status === "committed" && res.decision.reasonCode === "explicit_offer" && /renegade|compass/i.test(res.composedText) && !/argo/i.test(res.composedText), res.composedText);
  }
  {
    const res: any = await e2e("tem Gol?", STOCK, seededState());
    check("e2e gol: explicit_offer Gol, nunca Onix", res.status === "committed" && res.decision.reasonCode === "explicit_offer" && /gol/i.test(res.composedText) && !/onix/i.test(res.composedText), res.composedText);
  }
  {
    const res: any = await e2e("voces tem jeep?", NO_JEEP, seededState());
    check("e2e jeep ausente: explicit_not_found (compose honesto valida, NAO vira terminal_safe)", res.status === "committed" && res.decision.reasonCode === "explicit_not_found" && res.terminalSafe !== true, res.status === "committed" ? `${res.decision.reasonCode} ts=${res.terminalSafe}` : res.status);
    // 1B.7 (Secao 8): NAO asserta texto literal do dube; assevera que NAO ofertou veiculo errado nem caiu no fallback tecnico.
    check("e2e jeep ausente: sem Argo/Onix e sem 'Desculpe'", res.status === "committed" && !/argo|onix/i.test(res.composedText) && !/desculpe a lentid/i.test(res.composedText), res.composedText);
  }

  {
    const introduced = baseState({ turnNumber: 3, recentTurns: [{ role: "agent", text: "Beleza!", at: NOW }] });
    check("continuity: 'quero Jeep' -> NAO continuidade", detectContinuityIntent({ leadMessage: "quero Jeep", state: introduced, claimExtractor: extractor }) === false);
    check("continuity: 'tem gol?' -> NAO continuidade", detectContinuityIntent({ leadMessage: "tem gol?", state: introduced, claimExtractor: extractor }) === false);
    check("continuity: 'ok' -> continuidade", detectContinuityIntent({ leadMessage: "ok", state: introduced, claimExtractor: extractor }) === true);
  }

  {
    const autoState = baseState({
      slots: { ...baseState().slots, tipoVeiculo: { value: "hatch", status: "known", confidence: 0.9, updatedAt: NOW } } as any,
      searchPreferences: { transmission: "automatic" },
      offers: { last: null, presentedKeys: [ONIX, GOL] },
      lastRenderedOfferContext: { sourceTurnId: "t-old", createdAt: NOW, items: [{ ordinal: 1, vehicleKey: ONIX, marca: "Chevrolet", modelo: "Onix", ano: 2014 }, { ordinal: 2, vehicleKey: GOL, marca: "Volkswagen", modelo: "Gol", ano: 2015 }] },
    });
    calls = [];
    const moreAuto = await resolveMoreOptionsIntent({ leadMessage: "mais opcoes", state: autoState, runQuery: runQueryFor(STOCK), claimExtractor: extractor });
    check("mais opções: herda cambio automatic e exclui manuais/listados", moreAuto?.kind === "offer" && moreAuto.vehicles.length === 1 && moreAuto.vehicles[0].vehicleKey === HB20_AUTO, JSON.stringify(moreAuto));
    check("mais opções: query carregou cambio automatic", calls.some((c) => c.tool === "stock_search" && c.input.cambio === "automatic"), JSON.stringify(calls));
  }

  console.log(`\n=== F2.7.13: ${ok} OK | ${fail} FALHA ===`);
  if (fail > 0) { for (const f of fails) console.error("  - " + f); process.exit(1); }
}

main().catch((error) => { console.error(error); process.exit(1); });
