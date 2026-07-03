// ============================================================================
// F2.7.12 (P0) â€” referencia ORDINAL de lista resolve contra a memoria ESTRUTURADA
// (lastRenderedOfferContext), nunca contra texto/modelo. "foto do 3" -> item 3, nunca C3.
// Offline ($0).  npx tsx tests/run-f2-7-12-ordinal-offer.ts
// ============================================================================
import { createInitialState } from "../src/domain/conversation-state.ts";
import type { ConversationState, RenderedOfferItem } from "../src/domain/conversation-state.ts";
import { resolvePhotoIntent } from "../src/engine/photo-intent.ts";
import { computeRenderedOfferContext } from "../src/engine/offer-context.ts";
import { runConversationTurn } from "../src/engine/conversation-engine.ts";
import { InMemoryPersistence, FakeClock, FakeIdGen } from "../src/adapters/persistence/in-memory-store.ts";
import { FakeLlm } from "../src/adapters/llm/fake-llm.ts";
import type { ComposeOverride } from "../src/adapters/llm/fake-llm.ts";
import { buildTenantCatalog, normalizeText } from "../src/engine/catalog-utils.ts";
import { CatalogClaimExtractor } from "../src/engine/turn-context-preparer.ts";
import type { QueryRunner } from "../src/engine/decision-engine.ts";
import type { DecisionStep, QueryCall, QueryResult, TenantCatalog, TurnInterpretation } from "../src/domain/decision.ts";
import type { VehicleFact } from "../src/domain/types.ts";

const NOW = "2026-06-30T22:00:00.000Z";
const TENANT = "icom", AGENT = "aloan";
let ok = 0, fail = 0; const fails: string[] = [];
function check(name: string, pass: boolean, detail = ""): void {
  if (pass) { ok++; console.log(`  OK  ${name}`); }
  else { fail++; fails.push(`${name} â€” ${detail}`); console.log(`  RED ${name}${detail ? ` â€” ${detail}` : ""}`); }
}

const HB20_2015 = "hyundai|hb20|2015", HB20S_2017 = "hyundai|hb20s|2017", HB20_2021 = "hyundai|hb20|2021", C3 = "citroen|c3|2015", ONIX = "chevrolet|onix|2014";
const STOCK: VehicleFact[] = [
  { vehicleKey: HB20_2015, marca: "Hyundai", modelo: "HB20", ano: 2015, preco: 49990, km: 134000, tipo: "hatch" },
  { vehicleKey: HB20S_2017, marca: "Hyundai", modelo: "HB20 S", ano: 2017, preco: 69990, km: 104000, tipo: "hatch" },
  { vehicleKey: HB20_2021, marca: "Hyundai", modelo: "HB20", ano: 2021, preco: 71990, km: 77000, tipo: "hatch" },
  { vehicleKey: C3, marca: "Citroen", modelo: "C3", ano: 2015, preco: 47990, km: 116000, tipo: "hatch" },
  { vehicleKey: ONIX, marca: "Chevrolet", modelo: "Onix", ano: 2014, preco: 54990, km: 132000, tipo: "hatch" },
];
const PHOTOS: Record<string, string[]> = { [HB20_2015]: ["a1"], [HB20S_2017]: ["b1"], [HB20_2021]: ["c1", "c2"], [C3]: ["d1"], [ONIX]: ["e1", "e2"] };
const catalog: TenantCatalog = buildTenantCatalog(STOCK);
const extractor = new CatalogClaimExtractor(catalog);

let calls: QueryCall[] = [];
const runQuery: QueryRunner = async (call) => {
  calls.push(call);
  if (call.tool === "stock_search") {
    const modelo = call.input.modelo ? normalizeText(call.input.modelo) : null;
    const items = STOCK.filter((v) => !modelo || normalizeText(v.modelo).includes(modelo)).slice().sort((a, b) => a.preco - b.preco);
    return { ok: true as const, tool: "stock_search" as const, data: { items, filtersUsed: call.input as any }, source: "fake" };
  }
  if (call.tool === "vehicle_photos_resolve") {
    const key = call.input.vehicleRef.key;
    return { ok: true as const, tool: "vehicle_photos_resolve" as const, data: { vehicleKey: key, ambiguous: false, photoIds: PHOTOS[key] ?? [] }, source: "fake" };
  }
  return { ok: false, tool: call.tool, error: { code: "NOT_FOUND", message: "n/a", retryable: false } } as QueryResult;
};

const baseState = (over: Partial<ConversationState> = {}): ConversationState => ({ ...createInitialState({ conversationId: "c1", tenantId: TENANT, agentId: AGENT, leadId: "l1", now: NOW }), ...over });
const itemsFor = (...keys: string[]): RenderedOfferItem[] => keys.map((k, i) => { const v = STOCK.find((s) => s.vehicleKey === k)!; return { ordinal: i + 1, vehicleKey: k, marca: v.marca, modelo: v.modelo, ano: v.ano }; });
const offered = (...keys: string[]): ConversationState => baseState({ lastRenderedOfferContext: { sourceTurnId: "t-off", createdAt: NOW, items: itemsFor(...keys) } });
const TI = (models?: string[]): TurnInterpretation => ({ relation: "asks_vehicle_detail", ...(models ? { extractedEntities: { models } } : {}) });
const intent = (leadMessage: string, state: ConversationState, ti: TurnInterpretation = TI()) => { calls = []; return resolvePhotoIntent({ leadMessage, state, claimExtractor: extractor, runQuery, interpretation: ti }); };

async function main(): Promise<void> {
  console.log("\n=== F2.7.12 Referencia ordinal de lista ===\n");
  const hb20List = offered(HB20_2015, HB20S_2017, HB20_2021);

  // 1) lista 3 HB20; "Me manda foto do 3" -> HB20 2021; NUNCA stock_search por "3"
  {
    const r = await intent("Me manda foto do 3", hb20List);
    check("1 'foto do 3' -> send HB20 2021 (item 3 da lista)", r?.kind === "send" && r.vehicleKey === HB20_2021, JSON.stringify(r));
    check("1 NAO chamou stock_search por '3'", !calls.some((c) => c.tool === "stock_search"), JSON.stringify(calls.map((c) => c.tool)));
  }
  // 2) "me manda foto do terceiro" -> HB20 2021
  {
    const r = await intent("me manda foto do terceiro", hb20List);
    check("2 'foto do terceiro' -> HB20 2021", r?.kind === "send" && r.vehicleKey === HB20_2021, JSON.stringify(r));
  }
  // 3) lista ATUAL HB20 vence C3 ANTIGO do texto (memoria estruturada, nao recentTurns)
  {
    const st = offered(HB20_2015, HB20S_2017, HB20_2021);
    st.recentTurns = [{ role: "agent", text: "Antes te mostrei: CITROEN C3 2015 â€” R$ 47.990", at: NOW }];
    const r = await intent("foto do 3", st);
    check("3 lista atual HB20 vence C3 antigo do texto", r?.kind === "send" && r.vehicleKey === HB20_2021, JSON.stringify(r));
  }
  // 4) "foto do 4" numa lista de 3 -> ask_which, sem send
  {
    const r = await intent("foto do 4", hb20List);
    check("4 'foto do 4' (lista de 3) -> ask_which, sem send_media", r?.kind === "ask_which", JSON.stringify(r));
  }
  // 5) "foto do C3" (modelo explicito, fora da ultima lista) -> stock_search C3; inexistente -> honesto
  {
    const r = await intent("foto do c3", hb20List);
    check("5 'foto do c3' (modelo explicito) -> send C3 via stock_search", r?.kind === "send" && r.vehicleKey === C3, JSON.stringify(r));
    const r2 = await intent("foto do fusca", hb20List, TI(["fusca"]));
    check("5b modelo citado inexistente -> not_found honesto (sem send)", r2?.kind === "not_found", JSON.stringify(r2));
  }
  // 6) "foto do 3" sem lista estruturada -> ask_which (fail-closed), NUNCA stock_search('3')
  {
    const r = await intent("foto do 3", baseState());
    check("6 'foto do 3' sem lista -> ask_which (fail-closed)", r?.kind === "ask_which", JSON.stringify(r));
    check("6 'foto do 3' sem lista NAO faz stock_search", !calls.some((c) => c.tool === "stock_search"), JSON.stringify(calls.map((c) => c.tool)));
  }
  // 6b) â­ P1 do Codex: QUANTIDADE ("N fotos/imagens") NAO e ordinal; ordinal FORTE (item/opcao) vence
  {
    const r1 = await intent("manda 3 fotos do onix", hb20List);
    check("P1 'manda 3 fotos do onix' -> Onix (quantidade, NAO item 3)", r1?.kind === "send" && r1.vehicleKey === ONIX, JSON.stringify(r1));
    const r2 = await intent("quero 2 imagens do hb20", hb20List);
    // P0-1 (Codex): "2 imagens" Ã© QUANTIDADE (nÃ£o item 2); "hb20" casa 3 HB20 sem seleÃ§Ã£o -> pergunta qual ANO
    // (PROIBIDO items[0] com mÃºltiplos). Antes o handler mandava items[0] silenciosamente.
    check("P0-1 'quero 2 imagens do hb20' -> ask_which (3 HB20, quantidadeâ‰ item 2, mÃºltiplos sem seleÃ§Ã£o)", r2?.kind === "ask_which", JSON.stringify(r2));
    const r3 = await intent("tem 3 fotos dele?", hb20List);
    check("P1 'tem 3 fotos dele?' (lista multipla) -> ask_which (NAO item 3)", r3?.kind === "ask_which", JSON.stringify(r3));
    const r4 = await intent("manda a foto da opÃ§Ã£o 3", hb20List);
    check("P1 'da opÃ§Ã£o 3' (ordinal forte) -> item 3 (HB20 2021)", r4?.kind === "send" && r4.vehicleKey === HB20_2021, JSON.stringify(r4));
    const r5 = await intent("manda a foto do item 2", hb20List);
    check("P1 'do item 2' (ordinal forte) -> item 2 (HB20 S 2017)", r5?.kind === "send" && r5.vehicleKey === HB20S_2017, JSON.stringify(r5));
    // ordinal forte (palavra) vence ate modelo explicito no conflito
    const r6 = await intent("manda a foto do segundo onix", hb20List);
    check("P1 ordinal forte ('segundo') vence modelo explicito ('onix') -> item 2", r6?.kind === "send" && r6.vehicleKey === HB20S_2017, JSON.stringify(r6));
  }

  // 7) computeRenderedOfferContext: do vehicle_offer_list + facts (caminho LLM), na ordem
  {
    const facts: QueryResult[] = [{ ok: true, tool: "stock_search", data: { items: STOCK, filtersUsed: {} }, source: "fake" } as any];
    const turnOutput: any = { decision: {}, composed: { draft: { parts: [{ type: "text", content: "x" }, { type: "vehicle_offer_list", vehicleKeys: [HB20_2015, HB20S_2017, HB20_2021] }] }, text: "x" }, facts, loopExhausted: false, terminalSafe: false, steps: 0 };
    const ctx = computeRenderedOfferContext(turnOutput, "tX", NOW);
    check("7 compute: 3 itens na ORDEM renderizada", !!ctx && ctx.items.length === 3 && ctx.items[2].vehicleKey === HB20_2021 && ctx.items[2].ordinal === 3, JSON.stringify(ctx?.items.map((i) => i.vehicleKey)));
    check("7 compute: enriquece com marca/modelo/ano dos fatos", !!ctx && ctx.items[2].modelo === "HB20" && ctx.items[2].ano === 2021);
  }

  // 8) E2E: render de vehicle_offer_list grava lastRenderedOfferContext; depois "foto do 3" -> HB20 2021 (nao C3)
  {
    const clock = new FakeClock(NOW);
    const p = new InMemoryPersistence(clock, new FakeIdGen());
    // turno A: o LLM oferta os 3 HB20 (vehicle_offer_list) -> engine grava a memoria estruturada
    await p.tryInsert({ eventId: "eA", conversationId: "cO", raw: { __redacted: true, text: "E Hb20 tem?" } as any, receivedAt: NOW });
    const llm = new FakeLlm();
    const offerCompose: ComposeOverride = (_d, facts) => {
      const s = facts.find((f) => f.ok && f.tool === "stock_search");
      const keys = s && s.ok && s.tool === "stock_search" ? s.data.items.map((v) => v.vehicleKey) : [];
      return { parts: [{ type: "text", content: "Temos estas opÃ§Ãµes pra vocÃª:" }, { type: "vehicle_offer_list", vehicleKeys: keys }] };
    };
    const script: DecisionStep[] = [{ kind: "final", proposal: { proposedAction: "reply", facts: [], proposedEffects: [{ kind: "send_message", planId: "reply", order: 0, onSuccess: [] }], responsePlan: { guidance: "ofertar hb20" }, reasonCode: "hb20", reasonSummary: "x", confidence: 1 } }];
    llm.setTurnScript(script, offerCompose);
    const common = { persistence: p, clock, runQuery, conversationId: "cO", tenantId: TENANT, agentId: AGENT, leadId: null, workerId: "w", leaseTtlMs: 60_000, tenantCatalog: catalog, claimExtractor: extractor, limits: { maxSteps: 4, totalTimeoutMs: 5000 }, maxValidationAttempts: 2, providerCapability: { send_message: "none", send_media: "none" } as any };
    await runConversationTurn({ ...common, llm, turnId: "tA", interpretation: TI(["hb20"]) });
    const st = p.load("cO")?.state;
    check("8 e2e: state.lastRenderedOfferContext com os 3 HB20 na ordem", !!st?.lastRenderedOfferContext && st.lastRenderedOfferContext.items.length === 3 && st.lastRenderedOfferContext.items[2].vehicleKey === HB20_2021, JSON.stringify(st?.lastRenderedOfferContext?.items.map((i) => i.vehicleKey)));

    // turno B: "Me manda foto do 3" -> usa a memoria estruturada -> HB20 2021 (NAO C3)
    await p.tryInsert({ eventId: "eB", conversationId: "cO", raw: { __redacted: true, text: "Me manda foto do 3" } as any, receivedAt: NOW });
    await runConversationTurn({ ...common, llm: new FakeLlm(), turnId: "tB", interpretation: TI() });
    const media = (await p.listOutbox("cO")).find((r) => r.kind === "send_media");
    check("8 e2e: 'foto do 3' -> send_media do HB20 2021 (nao C3)", !!media && (media.payload as any).vehicleKey === HB20_2021, JSON.stringify((media?.payload as any)?.vehicleKey));
  }


  // 9) E2E: referencia ordinal invalida em lista curta nao vai para LLM inventar nem terminal-safe.
  {
    const clock = new FakeClock(NOW);
    const p = new InMemoryPersistence(clock, new FakeIdGen());
    const oneItemState = offered(ONIX);
    (p as any).states.set("cInvalid", { state: oneItemState, version: 1 });
    await p.tryInsert({ eventId: "eInvalid", conversationId: "cInvalid", raw: { __redacted: true, text: "Quero o terceiro" } as any, receivedAt: NOW });
    calls = [];
    const res = await runConversationTurn({
      persistence: p,
      clock,
      llm: new FakeLlm(),
      runQuery,
      conversationId: "cInvalid",
      tenantId: TENANT,
      agentId: AGENT,
      leadId: null,
      workerId: "w",
      turnId: "tInvalid",
      leaseTtlMs: 60_000,
      interpretation: { relation: "continues_offer" },
      tenantCatalog: catalog,
      claimExtractor: extractor,
      limits: { maxSteps: 4, totalTimeoutMs: 5000 },
      maxValidationAttempts: 2,
      providerCapability: { send_message: "none", send_media: "none" } as any,
    });
    const outbox = await p.listOutbox("cInvalid");
    check("9 ordinal invalido: committed sem terminal-safe", res.status === "committed" && res.decision.reasonCode === "ordinal_out_of_range" && res.terminalSafe === false, res.status === "committed" ? `${res.decision.reasonCode} ts=${res.terminalSafe}` : res.status);
    check("9 ordinal invalido: nao envia media nem consulta estoque", outbox.every((r) => r.kind === "send_message") && !calls.some((c) => c.tool === "stock_search"), JSON.stringify({ outbox: outbox.map((r) => r.kind), calls }));
    check("9 ordinal invalido: explica que nao existe item 3 na lista atual", res.status === "committed" && /item 3|terceir/i.test(res.composedText) && /apenas 1 opcao|1 opcao/i.test(res.composedText), res.status === "committed" ? res.composedText : res.status);
  }

  console.log(`\n=== F2.7.12: ${ok} OK | ${fail} FALHA ===`);
  if (fail > 0) { for (const f of fails) console.error("  - " + f); process.exit(1); }
}

main().catch((error) => { console.error(error); process.exit(1); });

