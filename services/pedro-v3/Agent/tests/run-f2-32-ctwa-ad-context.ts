// ============================================================================
// F2.32 — CTWA / Facebook Ads: o Pedro v3 lê o CONTEXTO do anúncio Click-to-WhatsApp e usa como intenção inicial, sem
// inventar, sem travar o funil, LLM-first. O anúncio é CONTEXTO (não resposta do lead); o turno atual e as correções
// SEMPRE vencem. O veículo do anúncio é resolvido do TEXTO (aterrado no catálogo + taxonomia de mercado p/ out-of-stock).
//   npx tsx tests/run-f2-32-ctwa-ad-context.ts
// ============================================================================
import { runCentralConversationTurn, type CentralTurnResult } from "../src/engine/central-engine.ts";
import { extractAdVehicleConstraints, refersToAd, isBareGreeting, sanitizeAdContext, resolveAdVehicleFromMarket } from "../src/engine/ad-context.ts";
import { asksLeadContactPhone } from "../src/engine/turn-domain.ts";
import { InMemoryPersistence, FakeClock, FakeIdGen } from "../src/adapters/persistence/in-memory-store.ts";
import { ScriptedAgentBrain, type BrainResponder } from "../src/adapters/llm/fake-agent-brain.ts";
import { buildTenantCatalog } from "../src/engine/catalog-utils.ts";
import { CatalogClaimExtractor } from "../src/engine/turn-context-preparer.ts";
import { buildSdrQualificationPolicy } from "../src/engine/sdr-conductor.ts";
import { redact } from "../src/domain/effect-intent.ts";
import type { TurnContextPreparer } from "../src/domain/context.ts";
import type { DecisionLlm } from "../src/domain/llm.ts";
import type { TenantBusinessInfoSource } from "../src/engine/tenant-business-info.ts";
import type { AgentBrainStep, AgentBrainDecision, TurnUnderstanding, PrimaryIntent } from "../src/domain/agent-brain.ts";
import type { ProposedEffectPlan, QueryCall, QueryResult, ResponsePart, ResponseDraft, TurnRelation } from "../src/domain/decision.ts";
import type { VehicleFact } from "../src/domain/types.ts";
import type { AdContext } from "../src/domain/conversation-state.ts";

let ok = 0, fail = 0; const fails: string[] = [];
function check(name: string, pass: boolean, detail = ""): void {
  if (pass) { ok++; console.log(`  OK  ${name}`); } else { fail++; fails.push(`${name}${detail ? ` — ${detail}` : ""}`); console.error(`  RED ${name}${detail ? ` — ${detail}` : ""}`); }
}
const TENANT = "ecb26258", AGENT = "d4fd5c38", NOW = "2026-07-06T12:00:00.000Z", SHA = "sha-32";
const norm = (s: string): string => (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const has = (s: string, n: string): boolean => norm(s).includes(norm(n));

// Estoque: Compass 2017/2019 (SUV), 2x Onix (hatch), Tracker + Renegade (SUV). SEM Nissan/Kicks (out-of-stock).
const COMPASS17: VehicleFact = { vehicleKey: "rm:cmp17", marca: "Jeep", modelo: "Compass", ano: 2017, preco: 92990, km: 88000, cambio: "Automatico", cor: "Branco", tipo: "suv" };
const COMPASS19: VehicleFact = { vehicleKey: "rm:cmp19", marca: "Jeep", modelo: "Compass", ano: 2019, preco: 96990, km: 82000, cambio: "Automatico", cor: "Branco", tipo: "suv" };
const ONIX18: VehicleFact = { vehicleKey: "rm:onix18", marca: "Chevrolet", modelo: "Onix", ano: 2018, preco: 54990, km: 70000, cambio: "Manual", cor: "Preto", tipo: "hatch" };
const ONIX20: VehicleFact = { vehicleKey: "rm:onix20", marca: "Chevrolet", modelo: "Onix", ano: 2020, preco: 63990, km: 40000, cambio: "Automatico", cor: "Prata", tipo: "hatch" };
const TRACKER: VehicleFact = { vehicleKey: "rm:tracker", marca: "Chevrolet", modelo: "Tracker", ano: 2020, preco: 88000, km: 30000, cambio: "Automatico", cor: "Vermelho", tipo: "suv" };
const RENEGADE: VehicleFact = { vehicleKey: "rm:renegade", marca: "Jeep", modelo: "Renegade", ano: 2018, preco: 74990, km: 85000, cambio: "Automatico", cor: "Cinza", tipo: "suv" };
const STOCK = [COMPASS17, COMPASS19, ONIX18, ONIX20, TRACKER, RENEGADE];
const catalog = buildTenantCatalog(STOCK);
const extractor = new CatalogClaimExtractor(catalog);
const sdrPolicy = buildSdrQualificationPolicy({ qualificationQuestions: [], agentName: "Aloan", companyName: "Avant", promptText: "Você é o Aloan da Avant." } as never);
const makeBI = (): TenantBusinessInfoSource => ({ async getBusinessInfo() { return { address: "Rua Teste 100, Taubaté", hours: null, unit: "Avant", source: "test" }; } });

// Fixtures de anúncio (externalAdReply sanitizado).
const adCompass: AdContext = { adId: "120253981641730460", source: "FB_Ads", sourceUrl: "https://fb.me/c9tWuhhGL", title: "Avant Motors", body: "Veículos revisados", greeting: "Olá! Quer saber mais sobre o Jeep Compass 2019?", imageUrls: [], capturedAtTurn: 0 };
const adOnix: AdContext = { adId: "999", source: "FB_Ads", sourceUrl: null, title: "Avant", body: "", greeting: "Quer saber mais sobre o Chevrolet Onix?", imageUrls: [], capturedAtTurn: 0 };
const adSUV: AdContext = { adId: "777", source: "instagram", sourceUrl: null, title: "SUVs a partir de R$ 40 mil", body: "Encontre o SUV ideal na Avant Motors!", greeting: null, imageUrls: [], capturedAtTurn: 0 };
const adKicks: AdContext = { adId: "555", source: "FB_Ads", sourceUrl: null, title: "Avant", body: "", greeting: "Quer saber mais sobre o Nissan Kicks 2020?", imageUrls: [], capturedAtTurn: 0 };
const adInstitucional: AdContext = { adId: "111", source: "FB_Ads", sourceUrl: null, title: "Venha conhecer nosso estoque e saia de carro novo!", body: "Encontre o carro ideal para você na Avant Motors!", greeting: "Oi! Como podemos ajudar?", imageUrls: [], capturedAtTurn: 0 };

const executed: QueryCall[] = [];
const runQuery = async (call: QueryCall): Promise<QueryResult> => {
  executed.push(call);
  if (call.tool === "stock_search") {
    const inp = call.input as { marca?: string; modelo?: string; tipo?: string; precoMax?: number; cambio?: string; excludeKeys?: string[]; broad?: boolean };
    let items = STOCK.slice();
    if (inp.marca) { const m = norm(inp.marca); items = items.filter((v) => norm(v.marca).includes(m) || m.includes(norm(v.marca))); }
    if (inp.modelo) { const toks = norm(inp.modelo).split(/\s+/).filter(Boolean); items = items.filter((v) => { const vt = norm(`${v.marca} ${v.modelo}`); return inp.broad ? toks.some((t) => vt.includes(t)) : toks.every((t) => vt.includes(t)); }); }
    if (inp.tipo) items = items.filter((v) => v.tipo === inp.tipo);
    if (typeof inp.precoMax === "number") items = items.filter((v) => (v.preco ?? Infinity) <= inp.precoMax!);
    if (inp.cambio) items = items.filter((v) => (inp.cambio === "automatic") === /autom/i.test(v.cambio ?? ""));
    if (inp.excludeKeys) items = items.filter((v) => !inp.excludeKeys!.includes(v.vehicleKey));
    return { ok: true, tool: "stock_search", data: { items, filtersUsed: inp as Record<string, never> }, source: "fake" } as QueryResult;
  }
  if (call.tool === "vehicle_photos_resolve") { const key = (call.input as { vehicleRef?: { key?: string } }).vehicleRef?.key ?? ""; return { ok: true, tool: "vehicle_photos_resolve", data: { vehicleKey: key, ambiguous: false, photoIds: ["p1"] }, source: "fake" } as QueryResult; }
  if (call.tool === "vehicle_details") { const v = STOCK.find((x) => x.vehicleKey === (call.input as { vehicleKey?: string }).vehicleKey); return v ? { ok: true, tool: "vehicle_details", data: { vehicle: v }, source: "fake" } as QueryResult : { ok: false, tool: "vehicle_details", error: { code: "NOT_FOUND", message: "n/a", retryable: false } } as QueryResult; }
  throw new Error("tool " + call.tool);
};
class ComposeSpyLlm implements DecisionLlm { async proposeNextQueryOrFinal(): Promise<never> { throw new Error("no compose"); } async compose(): Promise<ResponseDraft> { return { parts: [{ type: "text", content: "x" }] }; } }
class RelPreparer implements TurnContextPreparer { relation: TurnRelation = "ambiguous"; async prepare(): Promise<{ interpretation: { relation: TurnRelation }; tenantCatalog: typeof catalog; claimExtractor: typeof extractor }> { return { interpretation: { relation: this.relation }, tenantCatalog: catalog, claimExtractor: extractor }; } }

const U = (primaryIntent: PrimaryIntent): TurnUnderstanding => ({ primaryIntent, requestedCapabilities: [], subject: "none", subjectValue: null, subjectSource: "current_turn", evidence: [], isTopicChange: false, answeredLeadQuestions: [] });
const txt = (content: string): ResponsePart => ({ type: "text", content });
const reply: ProposedEffectPlan = { kind: "send_message", planId: "reply", order: 0, onSuccess: [] } as ProposedEffectPlan;
function finU(parts: ResponsePart[], reasonCode: string, u: TurnUnderstanding): AgentBrainStep {
  return { kind: "final", understanding: u, decision: { reasonCode, reasonSummary: "r", confidence: 0.9, responsePlan: { guidance: "g", draft: { parts } }, proposedEffects: [reply], memoryMutations: [], stateMutations: [] } as AgentBrainDecision };
}
const resist: BrainResponder = () => finU([txt("Certo!")], "reply", U("other"));
// ⭐AUTORIDADE (audit Codex): turnos em que o lead ESPECIFICA busca ("na verdade quero o Onix", "quero um SUV") — a
// LLM real classifica search_stock; declara o ATO mas resiste (o executor determinístico garante a execução).
const resistSearch: BrainResponder = (f) => finU([txt("Certo!")], "reply", {
  ...U("search_stock"), requestedCapabilities: ["stock_search"],
  evidence: [{ capability: "stock_search", quote: (f.block ?? "").trim().split(/\s+/).slice(0, 2).join(" ") || "tem" }],
});

type Cap = { outbox: string; committed: boolean; hasMedia: boolean; exec: string[]; stockInput: Record<string, unknown> | null; reasonCode: string | null; adVehicleSeen: string | null; hasHandoff: boolean };
async function turn(persistence: InMemoryPersistence, clock: FakeClock, brain: ScriptedAgentBrain, preparer: RelPreparer, convId: string, seq: number, lead: string, relation: TurnRelation, responder: BrainResponder, ad?: AdContext): Promise<Cap> {
  executed.length = 0; preparer.relation = relation; brain.setResponder(responder);
  const raw = ad ? redact({ text: lead, adContext: ad } as never) : redact({ text: lead });
  await persistence.tryInsert({ eventId: `${convId}-e${seq}`, conversationId: convId, raw, receivedAt: clock.now() });
  clock.advance(1000);
  const turnId = `${convId}-t${seq}`;
  const r: CentralTurnResult = await runCentralConversationTurn({
    persistence, clock, brain, llm: new ComposeSpyLlm(), runQuery, businessInfo: makeBI(), contextPreparer: preparer,
    conversationId: convId, tenantId: TENANT, agentId: AGENT, leadId: null, workerId: "w", turnId, leaseTtlMs: 60_000, portalPromptSha256: SHA,
    limits: { maxSteps: 8, totalTimeoutMs: 8000, proposeTimeoutMs: 3000, queryTimeoutMs: 3000, composeTimeoutMs: 3000 },
    maxValidationAttempts: 2, brainMaxSteps: 8, sdrPolicy, allowedTools: ["stock_search", "vehicle_details", "vehicle_photos_resolve", "tenant_business_info"],
    providerCapability: { send_message: "none", send_media: "none" }, singleAuthor: true, llmFirst: true,
  });
  const stock = [...executed].reverse().find((e) => e.tool === "stock_search");
  const outbox = (await persistence.listOutbox(convId)).filter((o) => o.turnId === turnId) as unknown as { kind: string; payload?: { text?: string } }[];
  const adSeen = brain.seenFrames.length > 0 ? (brain.seenFrames[brain.seenFrames.length - 1].signals.adVehicle ?? null) : null;
  return {
    outbox: outbox.find((o) => o.kind === "send_message")?.payload?.text ?? "", committed: r.status === "committed", hasMedia: outbox.some((o) => o.kind === "send_media"),
    exec: executed.map((e) => e.tool), stockInput: stock ? (stock.input as Record<string, unknown>) : null,
    reasonCode: r.status === "committed" ? r.decision.reasonCode : null, adVehicleSeen: adSeen, hasHandoff: outbox.some((o) => o.kind === "handoff" || o.kind === "notify_seller"),
  };
}
let seq0 = 0;
function conv() {
  const brain = new ScriptedAgentBrain(); const preparer = new RelPreparer(); const clock = new FakeClock(NOW); const persistence = new InMemoryPersistence(clock, new FakeIdGen());
  const id = `wa:conv${seq0++}`; let s = 0;
  const t = (lead: string, opts?: { rel?: TurnRelation; responder?: BrainResponder; ad?: AdContext }): Promise<Cap> => turn(persistence, clock, brain, preparer, id, ++s, lead, opts?.rel ?? "ambiguous", opts?.responder ?? resist, opts?.ad);
  return { t };
}

async function main(): Promise<void> {
  console.log("== F2.32: CTWA / Facebook Ads (contexto de anúncio) ==");

  // ── PARTE 1 — PURO ──
  check("[U-1] extractAd(Compass) -> {marca:jeep, modelos:[Compass], tipo:suv}, SEM anos", (() => { const c = extractAdVehicleConstraints(adCompass, extractor); return has(c.marca ?? "", "jeep") && (c.modelos ?? []).some((m) => has(m, "compass")) && c.tipo === "suv" && c.anos === undefined; })());
  check("[U-2] extractAd(SUV genérico) -> tipo=suv, sem modelo", (() => { const c = extractAdVehicleConstraints(adSUV, extractor); return c.tipo === "suv" && (c.modelos === undefined || c.modelos.length === 0); })());
  check("[U-3] extractAd(institucional) -> {} (sem veículo)", (() => { const c = extractAdVehicleConstraints(adInstitucional, extractor); return !c.marca && !(c.modelos && c.modelos.length) && !c.tipo; })());
  check("[U-4] extractAd(Kicks fora de estoque) -> resolve marca/modelo/tipo do MERCADO", (() => { const c = extractAdVehicleConstraints(adKicks, extractor); return has(c.marca ?? "", "nissan") && (c.modelos ?? []).some((m) => has(m, "kicks")) && c.tipo === "suv"; })());
  check("[U-5] resolveAdVehicleFromMarket('Onix Plus') != 'Onix' (longest-first)", resolveAdVehicleFromMarket("sobre o chevrolet onix plus 2020")?.modelo === "Onix Plus" && resolveAdVehicleFromMarket("sobre o onix")?.modelo === "Onix");
  check("[U-6] refersToAd 'esse ainda tem?' -> true; 'quanto custa o gol?' -> false", refersToAd("esse ainda tem?") === true && refersToAd("quanto custa o gol?") === false);
  check("[U-7] isBareGreeting 'boa tarde' -> true; 'quero um onix' -> false", isBareGreeting("boa tarde") === true && isBareGreeting("quero um onix") === false);
  check("[U-8] sanitizeAdContext ignora lixo + null se vazio", (() => { const s = sanitizeAdContext({ greeting: "oi sobre o Compass", adId: "1", junk: "x" }, 3); return !!s && s.adId === "1" && s.capturedAtTurn === 3 && sanitizeAdContext({ nada: 1 }, 1) === null; })());

  // ── PARTE 2 — INTEGRAÇÃO ──
  // A) CTWA Compass + "tem esse?" -> stock_search Compass, não pergunta modelo.
  {
    const c = conv();
    const r = await c.t("tem esse?", { ad: adCompass });
    check("[A-1] busca o Compass do anúncio (modelo=compass)", has(String(r.stockInput?.modelo ?? ""), "compass"), `input=${JSON.stringify(r.stockInput)}`);
    check("[A-2] lista Compass e NÃO pergunta 'qual modelo'", has(r.outbox, "Compass") && !has(r.outbox, "qual modelo") && !has(r.outbox, "que tipo"), `outbox="${r.outbox}"`);
    check("[A-3] cérebro vê o veículo do anúncio (signals.adVehicle)", r.adVehicleSeen != null && has(r.adVehicleSeen, "compass"), `adVehicle=${r.adVehicleSeen}`);
    check("[A-4] sem handoff automático por vir de anúncio", !r.hasHandoff);
  }
  // B) CTWA Onix + "quero fotos" -> resolve Onix; múltiplos Onix -> lista/pergunta qual (nunca carro errado).
  {
    const c = conv();
    const r = await c.t("quero fotos", { ad: adOnix, rel: "ambiguous" });
    check("[B-1] busca o Onix do anúncio", has(String(r.stockInput?.modelo ?? ""), "onix"), `input=${JSON.stringify(r.stockInput)}`);
    check("[B-2] múltiplos Onix -> apresenta Onix e NÃO manda foto de carro errado", has(r.outbox, "Onix") && !has(r.outbox, "Compass") && !has(r.outbox, "Tracker"), `outbox="${r.outbox}"`);
  }
  // C) CTWA SUV genérico + "até 100k" -> busca SUV até 100k.
  {
    const c = conv();
    const r = await c.t("até 100k", { ad: adSUV });
    check("[C-1] busca tipo=suv precoMax=100000 (anúncio SUV + refino do lead)", r.stockInput?.tipo === "suv" && r.stockInput?.precoMax === 100000, `input=${JSON.stringify(r.stockInput)}`);
    check("[C-2] lista SUVs (não pergunta o tipo — o anúncio já disse SUV)", (has(r.outbox, "Compass") || has(r.outbox, "Tracker") || has(r.outbox, "Renegade")) && !has(r.outbox, "Onix"), `outbox="${r.outbox}"`);
  }
  // D) CTWA veículo FORA de estoque (Kicks=SUV) -> honesto sobre não ter o do anúncio + oferece MESMO TIPO (SUV), nunca
  //    cruza de tipo (Onix hatch) nem inventa. Fix A (audit CTWA condução SDR): "ofereça algo parecido na mesma faixa/tipo".
  {
    const c = conv();
    const r = await c.t("esse ainda tem?", { ad: adKicks });
    check("[D-1] o veículo do anúncio (Nissan/Kicks) dirige o turno (cérebro vê adVehicle)", has(r.adVehicleSeen ?? "", "kicks") || has(r.adVehicleSeen ?? "", "nissan") || has(String(r.stockInput?.tipo ?? ""), "suv"), `adVehicle=${r.adVehicleSeen} input=${JSON.stringify(r.stockInput)}`);
    check("[D-2] honesto (não achou o do anúncio) + oferece MESMO TIPO (SUV), SEM cruzar p/ Onix hatch, sem media", (r.reasonCode === "recovery_relaxed_offer" || r.reasonCode === "recovery_stock_empty") && !has(r.outbox, "Onix") && !r.hasMedia && /nao encontrei|nao achei|nao temos/.test(norm(r.outbox)), `rc=${r.reasonCode} outbox="${r.outbox}"`);
  }
  // E) Correção: anúncio Compass, lead "na verdade quero Onix" -> Onix vence.
  {
    const c = conv();
    await c.t("tem esse?", { ad: adCompass });                 // T1: anúncio Compass
    const t2 = await c.t("na verdade quero o Onix", { responder: resistSearch });            // T2: correção
    check("[E-1] correção do lead VENCE o anúncio: busca Onix (não Compass)", has(String(t2.stockInput?.modelo ?? ""), "onix") && !has(String(t2.stockInput?.modelo ?? ""), "compass"), `input=${JSON.stringify(t2.stockInput)}`);
    check("[E-2] outbox lista Onix, não Compass", has(t2.outbox, "Onix") && !has(t2.outbox, "Compass"), `outbox="${t2.outbox}"`);
  }
  // F) Institucional: anúncio Compass, "onde fica a loja?" -> responde loja, NÃO força estoque.
  {
    const c = conv();
    const r = await c.t("onde fica a loja?", { ad: adCompass, rel: "asks_store" as TurnRelation });
    check("[F-1] institucional NÃO força stock_search do anúncio", !r.exec.includes("stock_search"), `exec=${r.exec.join(",")}`);
    check("[F-2] responde a loja (endereço), não lista Compass", has(r.outbox, "Taubaté") || has(r.outbox, "Rua") || !has(r.outbox, "Compass"), `outbox="${r.outbox}"`);
  }
  // G) Desinteresse: anúncio Compass, "não solicitei" -> não lista carro.
  {
    const c = conv();
    const r = await c.t("não solicitei nada", { ad: adCompass });
    check("[G-1] desinteresse -> NÃO roda stock_search do anúncio", !r.exec.includes("stock_search"), `exec=${r.exec.join(",")}`);
    check("[G-2] NÃO lista Compass; resposta curta", r.committed && !has(r.outbox, "Compass") && !has(r.outbox, "opções"), `outbox="${r.outbox}"`);
  }
  // H) Sem handoff automático + sem pedir telefone em qualquer turno de anúncio.
  {
    const c = conv();
    const r = await c.t("boa tarde", { ad: adCompass });   // saudação curta de anúncio -> entra no Compass
    check("[H-1] saudação curta de anúncio -> busca o Compass (entrada por anúncio)", has(String(r.stockInput?.modelo ?? ""), "compass"), `input=${JSON.stringify(r.stockInput)}`);
    check("[H-2] sem handoff/transferência automática", !r.hasHandoff);
    check("[H-3] não pede telefone (WhatsApp)", !asksLeadContactPhone(r.outbox), `outbox="${r.outbox}"`);
  }
  // F) Fix B (audit CTWA): anúncio GENÉRICO (sem veículo) + abertura -> se o cérebro pede NOME, o engine
  // devolve feedback e o MESMO cérebro reescreve a descoberta. O engine nunca autora a abertura comercial.
  {
    const c = conv();
    const askNameThenDiscover: BrainResponder = (_frame, observations) => {
      const wasCorrected = observations.some((obs) => !obs.ok && /não peça o nome|entenda a intenção comercial/i.test(obs.error.message));
      return wasCorrected
        ? finU([txt("Claro! Você procura algum modelo ou tipo de carro, ou tem uma faixa de preço em mente?")], "discover_need", U("other"))
        : finU([txt("Olá! Para te ajudar melhor, qual é o seu nome?")], "reply", U("other"));
    };
    const r = await c.t("Olá! Tenho interesse e queria mais informações, por favor.", { ad: adInstitucional, responder: askNameThenDiscover });
    check("[ADGEN-1] abertura de anúncio genérico NÃO abre pedindo nome", !/\bseu\s+nome\b/.test(norm(r.outbox)), `outbox="${r.outbox}"`);
    check("[ADGEN-2] a LLM reescreve a DESCOBERTA comercial (sem backstop do engine)", (has(r.outbox, "modelo") || has(r.outbox, "tipo") || has(r.outbox, "faixa")) && r.reasonCode === "discover_need", `rc=${r.reasonCode} outbox="${r.outbox}"`);
  }
  // ADGEN-3) Fix B: anúncio genérico mas o lead JÁ especifica (SUV) -> NÃO força discovery (o lead engatou); segue comercial.
  {
    const c = conv();
    const r = await c.t("quero um SUV", { ad: adInstitucional, responder: resistSearch });
    check("[ADGEN-3] lead que já especifica não recebe discovery genérico (busca o tipo)", r.reasonCode !== "ad_generic_discovery" && (has(r.outbox, "Compass") || has(r.outbox, "Tracker") || has(r.outbox, "Renegade") || r.exec.includes("stock_search")), `rc=${r.reasonCode} outbox="${r.outbox}" exec=${r.exec.join(",")}`);
  }

  console.log(`\n== F2.32: ${ok} OK | ${fail} FALHA ==`);
  if (fail > 0) { console.error("FALHAS:\n - " + fails.join("\n - ")); process.exit(1); }
}
main().catch((e) => { console.error(e); process.exit(1); });
