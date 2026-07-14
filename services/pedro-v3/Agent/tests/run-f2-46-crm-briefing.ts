// ============================================================================
// F2.46 — CRM/Handoff FASES 1+2 (missão 2026-07-09): CRM write seguro + briefing.
//  Os 10 testes obrigatórios da missão:
//   1. lead com nome+carro+troca+entrada+parcela grava CRM e gera briefing
//   2. lead de anúncio preserva o veículo do anúncio no briefing/CRM
//   3. carro de troca NÃO contamina veículo de interesse
//   4. veículo de interesse NÃO contamina troca
//   5. campo humano já preenchido no CRM NÃO é sobrescrito
//   6. retry do mesmo turno/effect NÃO duplica escrita
//   7. falha no CRM NÃO impede a resposta ao lead
//   8. cross-tenant BLOQUEADO (fail-closed)
//   9. briefing sem dado NÃO inventa
//  10. test:all e tsc verdes (gates do runner)
//   npx tsx tests/run-f2-46-crm-briefing.ts
// ============================================================================
import { runCentralConversationTurn, type CentralTurnResult } from "../src/engine/central-engine.ts";
import { OutboxDispatcher, type EffectDispatcher } from "../src/engine/outbox-dispatcher.ts";
import { CompositeEffectDispatcher, CrmWriteEffectDispatcher, type CrmLeadRow, type CrmLeadStore, CRM_SUMMARY_PREFIX } from "../src/adapters/effects/crm-write-dispatcher.ts";
import { buildCrmFields, buildCrmWritePlan, CRM_WRITE_ORDER } from "../src/engine/crm-write.ts";
import { buildAgentSummary, buildSellerBriefing, classifySdrCategory, suggestNextStep } from "../src/engine/briefing-builder.ts";
import { InMemoryPersistence, FakeClock, FakeIdGen } from "../src/adapters/persistence/in-memory-store.ts";
import { ScriptedAgentBrain, type BrainResponder } from "../src/adapters/llm/fake-agent-brain.ts";
import { buildTenantCatalog } from "../src/engine/catalog-utils.ts";
import { CatalogClaimExtractor } from "../src/engine/turn-context-preparer.ts";
import { buildSdrQualificationPolicy } from "../src/engine/sdr-conductor.ts";
import { redact } from "../src/domain/effect-intent.ts";
import { createInitialState, type ConversationState, type AdContext } from "../src/domain/conversation-state.ts";
import type { TurnContextPreparer } from "../src/domain/context.ts";
import type { DecisionLlm } from "../src/domain/llm.ts";
import type { TenantBusinessInfoSource } from "../src/engine/tenant-business-info.ts";
import type { AgentBrainStep, AgentBrainDecision, TurnUnderstanding, PrimaryIntent, AgentToolObservation } from "../src/domain/agent-brain.ts";
import type { ProposedEffectPlan, QueryCall, QueryResult, ResponsePart, ResponseDraft, TurnRelation, EffectReceipt, EffectResult } from "../src/domain/decision.ts";
import type { OutboxRecord } from "../src/domain/effect-intent.ts";
import type { TenantAgentRef } from "../src/domain/read-ports.ts";
import type { VehicleFact } from "../src/domain/types.ts";
import { commitEffectOutcome } from "../src/engine/effect-outcome-commit.ts";
import { applyAcceptedPhotoActionOutcome } from "../src/engine/central-engine.ts";

let ok = 0, fail = 0; const fails: string[] = [];
function check(name: string, pass: boolean, detail = ""): void {
  if (pass) { ok++; console.log(`  OK  ${name}`); } else { fail++; fails.push(`${name}${detail ? ` — ${detail}` : ""}`); console.error(`  RED ${name}${detail ? ` — ${detail}` : ""}`); }
}
const TENANT = "ecb26258", AGENT = "d4fd5c38", NOW = "2026-07-09T12:00:00.000Z", SHA = "sha-44";
const REF: TenantAgentRef = { tenantId: TENANT, agentId: AGENT };
const LEAD_ID = "lead-douglas-1";
const norm = (s: string): string => (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const has = (s: string, n: string): boolean => norm(s).includes(norm(n));

const ONIX: VehicleFact = { vehicleKey: "rm:onix", marca: "Chevrolet", modelo: "Onix", ano: 2018, preco: 62000, km: 70000, cambio: "Manual", cor: "Prata", tipo: "hatch" };
const COMPASS: VehicleFact = { vehicleKey: "rm:compass", marca: "Jeep", modelo: "Compass", ano: 2019, preco: 99000, km: 70000, cambio: "Automatico", cor: "Branco", tipo: "suv" };
const STOCK = [ONIX, COMPASS];
const catalog = buildTenantCatalog(STOCK);
const extractor = new CatalogClaimExtractor(catalog);
const sdrPolicy = buildSdrQualificationPolicy({ qualificationQuestions: [], agentName: "Aloan", companyName: "Icom", promptText: "Você é o Aloan da Icom." } as never);
const makeBI = (): TenantBusinessInfoSource => ({ async getBusinessInfo() { return { address: "Rua Teste 100", hours: null, unit: "Icom", source: "test" }; } });

const runQuery = async (call: QueryCall): Promise<QueryResult> => {
  if (call.tool === "stock_search") {
    const inp = call.input as { modelo?: string; tipo?: string };
    let items = STOCK.slice();
    if (inp.modelo) { const m = norm(inp.modelo); items = items.filter((v) => norm(`${v.marca} ${v.modelo}`).includes(m)); }
    if (inp.tipo) items = items.filter((v) => v.tipo === inp.tipo);
    return { ok: true, tool: "stock_search", data: { items, filtersUsed: inp as Record<string, never> }, source: "fake" } as QueryResult;
  }
  if (call.tool === "vehicle_photos_resolve") { const key = (call.input as { vehicleRef?: { key?: string } }).vehicleRef?.key ?? ""; return { ok: true, tool: "vehicle_photos_resolve", data: { vehicleKey: key, ambiguous: false, photoIds: ["p1", "p2"] }, source: "fake" } as QueryResult; }
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
function qU(call: { tool: string; input: Record<string, unknown> }, u: TurnUnderstanding): AgentBrainStep { return { kind: "query", call: call as never, understanding: u } as AgentBrainStep; }
const resist: BrainResponder = () => finU([txt("Certo!")], "reply", U("other"));
const searchB = (input: Record<string, unknown>): BrainResponder => (f, obs: readonly AgentToolObservation[]) => {
  const u: TurnUnderstanding = { primaryIntent: "search_stock", requestedCapabilities: ["stock_search"], subject: "none", subjectValue: null, subjectSource: "current_turn", evidence: [{ capability: "stock_search", quote: (f.block ?? "").trim().split(/\s+/).slice(0, 2).join(" ") || "tem" }], isTopicChange: false, answeredLeadQuestions: [] };
  const so = obs.find((o) => o.tool === "stock_search" && o.ok) as Extract<AgentToolObservation, { tool: "stock_search"; ok: true }> | undefined;
  if (!so) return qU({ tool: "stock_search", input }, u);
  if (so.data.items.length === 0) return finU([txt("No momento não tenho esse modelo. Quer ver opções parecidas?")], "reply", u);
  return finU([txt("Encontrei estas opções:"), { type: "vehicle_offer_list", vehicleKeys: so.data.items.map((i) => i.vehicleKey) } as ResponsePart, txt("Quer ver as fotos de algum deles?")], "reply", u);
};
const selectFirst: BrainResponder = () => finU([txt("Boa escolha! Quer ver as condições?")], "reply",
  { primaryIntent: "select_vehicle", requestedCapabilities: ["select"], subject: "ordinal_from_last_offer", subjectValue: "1", subjectSource: "current_turn", evidence: [{ capability: "select", quote: "primeiro" }], isTopicChange: false, answeredLeadQuestions: [] });

// ── FakeCrmStore: simula ai_crm_leads com ownership (id + tenant + agent). ──
class FakeCrmStore implements CrmLeadStore {
  updates = 0;
  failNextUpdate = false;
  constructor(public rows: Array<{ id: string; tenantId: string; agentId: string; fields: Record<string, string | null> }>) {}
  async fetchOwnedLead(ref: TenantAgentRef, leadId: string): Promise<CrmLeadRow | null> {
    const row = this.rows.find((r) => r.id === leadId && r.tenantId === ref.tenantId && r.agentId === ref.agentId);
    return row ? { id: row.id, fields: { ...row.fields } } : null;
  }
  async updateOwnedLead(ref: TenantAgentRef, leadId: string, fields: Record<string, string>): Promise<{ ok: boolean; updatedRows: number; error?: string }> {
    if (this.failNextUpdate) { this.failNextUpdate = false; throw new Error("crm_down"); }
    const row = this.rows.find((r) => r.id === leadId && r.tenantId === ref.tenantId && r.agentId === ref.agentId);
    if (!row) return { ok: true, updatedRows: 0 };
    Object.assign(row.fields, fields);
    this.updates += 1;
    return { ok: true, updatedRows: 1 };
  }
}
// FakeWhatsApp: send_* sempre aceito (efeitos OFF de verdade — nada sai).
class FakeWaDispatcher implements EffectDispatcher {
  sent: string[] = [];
  async dispatch(record: OutboxRecord): Promise<EffectResult> {
    this.sent.push(record.kind);
    return { status: "succeeded", effectId: record.effectId, receipt: { effectId: record.effectId, level: "accepted", at: NOW, providerMessageId: `fake-${record.effectId}` } };
  }
}
const allowAllGate = { isActiveMode: () => true };

type Cap = { outbox: OutboxRecord[]; committed: boolean; state: ConversationState | null; sent: string[] };
function conv(store: CrmLeadStore, opts?: { leadId?: string | null; crmEnabled?: boolean }) {
  const brain = new ScriptedAgentBrain(); const preparer = new RelPreparer(); const clock = new FakeClock(NOW); const persistence = new InMemoryPersistence(clock, new FakeIdGen());
  const wa = new FakeWaDispatcher();
  const composite = new CompositeEffectDispatcher({ send_message: wa, send_media: wa, crm_write: new CrmWriteEffectDispatcher({ ref: REF, clock, store }) });
  const id = `wa:f44_${Math.random().toString(36).slice(2, 8)}`; let s = 0;
  const t = async (lead: string, responder?: BrainResponder, ad?: AdContext): Promise<Cap> => {
    s++;
    brain.setResponder(responder ?? resist);
    const raw = s === 1 && ad ? { text: lead, adContext: ad } : { text: lead };
    await persistence.tryInsert({ eventId: `${id}-e${s}`, conversationId: id, raw: redact(raw as never) as never, receivedAt: clock.now() });
    clock.advance(1000);
    const turnId = `${id}-t${s}`;
    const r: CentralTurnResult = await runCentralConversationTurn({
      persistence, clock, brain, llm: new ComposeSpyLlm(), runQuery, businessInfo: makeBI(), contextPreparer: preparer,
      conversationId: id, tenantId: TENANT, agentId: AGENT, leadId: opts?.leadId === undefined ? LEAD_ID : opts.leadId,
      workerId: "w", turnId, leaseTtlMs: 60_000, portalPromptSha256: SHA,
      limits: { maxSteps: 8, totalTimeoutMs: 8000, proposeTimeoutMs: 3000, queryTimeoutMs: 3000, composeTimeoutMs: 3000 },
      maxValidationAttempts: 3, brainMaxSteps: 8, sdrPolicy, allowedTools: ["stock_search", "vehicle_details", "vehicle_photos_resolve", "tenant_business_info"],
      providerCapability: { send_message: "none", send_media: "none" }, singleAuthor: true, llmFirst: true,
      crmWriteEnabled: opts?.crmEnabled ?? true,
    });
    // Dispatch REAL via OutboxDispatcher (ordem/dependências/commit) — WhatsApp fake + CRM real-contra-fake.
    const dispatcher = new OutboxDispatcher(persistence, clock, composite, allowAllGate as never, "w:test");
    await dispatcher.dispatchConversation(id);
    // Receipts residuais (send_media accepted-safe) — best-effort p/ manter a WM coerente nos turnos de foto.
    for (const rec of (await persistence.listOutbox(id)) as unknown as OutboxRecord[]) {
      if (rec.kind === "send_media" && rec.status === "succeeded") {
        const receipt: EffectReceipt = { effectId: rec.effectId, level: "accepted", providerMessageId: `ev-${rec.effectId}`, at: clock.now() };
        await applyAcceptedPhotoActionOutcome({ persistence, conversationId: id, effectId: rec.effectId, result: { status: "succeeded", effectId: rec.effectId, receipt } });
      }
    }
    const outbox = (await persistence.listOutbox(id)).filter((o) => o.turnId === turnId) as unknown as OutboxRecord[];
    return { outbox, committed: r.status === "committed", state: persistence.load(id)?.state ?? null, sent: [...wa.sent] };
  };
  return { t, store };
}
const crmOf = (c: Cap): OutboxRecord | undefined => c.outbox.find((o) => o.kind === "crm_write");
const fieldsOf = (rec: OutboxRecord | undefined): Record<string, string> => {
  if (!rec) return {};
  const { __redacted: _r, ...p } = rec.payload as Record<string, unknown>;
  return (p.fields ?? {}) as Record<string, string>;
};

async function main(): Promise<void> {
  console.log("== F2.46: CRM write seguro (Fase 1) + briefing (Fase 2) ==");

  // ── 1) jornada completa: nome + carro + troca + entrada + parcela -> CRM gravado + briefing ──
  {
    const store = new FakeCrmStore([{ id: LEAD_ID, tenantId: TENANT, agentId: AGENT, fields: {} }]);
    const c = conv(store);
    await c.t("quero um Onix", searchB({ modelo: "Onix" }));
    await c.t("gostei do primeiro", selectFirst);
    await c.t("meu nome é Douglas", () => finU([txt("Prazer, Douglas! Você tem carro para dar de troca?")], "reply", U("other")));
    await c.t("tenho uma Hilux 2020 85km rodados", () => finU([txt("Perfeito! Anotei sua Hilux 2020 para avaliação. Você tem um valor de entrada?")], "reply", U("trade_in")));
    await c.t("tenho 8k de entrada", () => finU([txt("Show! E qual parcela caberia no seu orçamento?")], "reply", U("financing")));
    const t6 = await c.t("até 1500 por mês", () => finU([txt("Perfeito! Vou te passar as melhores condições.")], "reply", U("financing")));
    const lead = store.rows[0].fields;
    check("[1a] CRM gravado: client_name=Douglas", lead.client_name === "Douglas", `client_name=${lead.client_name}`);
    check("[1b] CRM: vehicle_interest = Onix SELECIONADO (canônico)", has(lead.vehicle_interest ?? "", "onix"), `interest=${lead.vehicle_interest}`);
    check("[1c] CRM: troca/entrada/parcela gravados", has(lead.trade_in_vehicle ?? "", "hilux") && (lead.down_payment ?? "").includes("8.000") && (lead.desired_installment ?? "").includes("1.500"), `troca=${lead.trade_in_vehicle} entrada=${lead.down_payment} parcela=${lead.desired_installment}`);
    check("[1d] CRM: summary [Pedro v3] presente", (lead.summary ?? "").startsWith(CRM_SUMMARY_PREFIX), `summary=${(lead.summary ?? "").slice(0, 60)}`);
    const briefing = buildSellerBriefing({ state: t6.state!, adContext: null, adVehicleLabel: null, lastPhotoAction: null, agentName: "Aloan", leadPhone: "5512999999999" });
    check("[1e] briefing tem interesse Onix + troca Hilux + pagamento + próximo passo", has(briefing, "onix") && has(briefing, "hilux") && has(briefing, "8.000") && has(briefing, "1.500") && has(briefing, "Próxima ação"), briefing.slice(0, 200));
    check("[1f] categoria SDR = qualificado (nome+interesse+2+ dados)", classifySdrCategory(t6.state!) === "qualificado", classifySdrCategory(t6.state!));
    // ordem: crm_write SEMPRE depois do send_message
    const crm = crmOf(t6);
    check("[1g] crm_write com order alto (depois do reply) e idempotencyKey=turnId:crm", crm != null && crm.order === CRM_WRITE_ORDER && crm.effectId.endsWith(":crm") && crm.status === "succeeded", `order=${crm?.order} id=${crm?.effectId} status=${crm?.status}`);
  }

  // ── 2) lead de ANÚNCIO: veículo do anúncio preservado no CRM/briefing (sem o lead digitar o modelo) ──
  {
    const store = new FakeCrmStore([{ id: LEAD_ID, tenantId: TENANT, agentId: AGENT, fields: {} }]);
    const c = conv(store);
    const ad: AdContext = { adId: "1", source: "facebook", sourceUrl: "https://fb.me/x", title: "Icom", body: "Veículos revisados", greeting: "Olá! Quer saber mais sobre o Jeep Compass 2019?", imageUrls: [], capturedAtTurn: 0 };
    const t1 = await c.t("Oi, tenho interesse", searchB({ modelo: "Compass" }), ad);
    const lead = store.rows[0].fields;
    check("[2a] CRM: origem=trafico_pago + vehicle_interest do ANÚNCIO (Compass)", lead.origem === "trafico_pago" && has(lead.vehicle_interest ?? "", "compass"), `origem=${lead.origem} interest=${lead.vehicle_interest}`);
    const briefing = buildSellerBriefing({ state: t1.state!, adContext: ad, adVehicleLabel: "Jeep Compass 2019", lastPhotoAction: null, agentName: "Aloan", leadPhone: null });
    check("[2b] briefing: seção Origem cita o anúncio + veículo do anúncio", has(briefing, "anúncio") && has(briefing, "Compass 2019"), briefing.slice(0, 220));
  }

  // ── 3/4) TROCA não contamina INTERESSE e vice-versa (colunas separadas por construção) ──
  {
    const store = new FakeCrmStore([{ id: LEAD_ID, tenantId: TENANT, agentId: AGENT, fields: {} }]);
    const c = conv(store);
    await c.t("quero um Onix", searchB({ modelo: "Onix" }));
    await c.t("gostei do primeiro", selectFirst);
    await c.t("quais as condições?", () => finU([txt("Você tem carro para dar de troca?")], "reply", U("other")));
    const t4 = await c.t("tenho uma Hilux 2020 85km rodados", () => finU([txt("Anotei sua Hilux 2020! Você tem valor de entrada?")], "reply", U("trade_in")));
    const lead = store.rows[0].fields;
    check("[3] trade_in_vehicle=Hilux e vehicle_interest=Onix (troca ↛ interesse)", has(lead.trade_in_vehicle ?? "", "hilux") && has(lead.vehicle_interest ?? "", "onix") && !has(lead.vehicle_interest ?? "", "hilux"), `interest=${lead.vehicle_interest} troca=${lead.trade_in_vehicle}`);
    check("[4] interesse não vazou p/ troca (troca sem Onix)", !has(lead.trade_in_vehicle ?? "", "onix"), `troca=${lead.trade_in_vehicle}`);
    const briefing = buildSellerBriefing({ state: t4.state!, adContext: null, adVehicleLabel: null, lastPhotoAction: null, agentName: "Aloan", leadPhone: null });
    const interesseLine = briefing.split("\n").find((l) => l.includes("Interesse")) ?? "";
    const trocaLine = briefing.split("\n").find((l) => l.includes("Troca")) ?? "";
    check("[3b] briefing: linha Interesse=Onix, linha Troca=Hilux (seções separadas)", has(interesseLine, "onix") && !has(interesseLine, "hilux") && has(trocaLine, "hilux") && !has(trocaLine, "onix"), `${interesseLine} | ${trocaLine}`);
  }

  // ── 5) campo HUMANO preenchido não é sobrescrito (fill-only-if-empty) ──
  {
    const store = new FakeCrmStore([{ id: LEAD_ID, tenantId: TENANT, agentId: AGENT, fields: { client_name: "Nome Do Vendedor", client_city: "Taubaté (vendedor)", summary: "resumo escrito pelo humano" } }]);
    const c = conv(store);
    await c.t("meu nome é Douglas, sou de Jacareí", () => finU([txt("Prazer, Douglas! O que você procura?")], "reply", U("other")));
    const lead = store.rows[0].fields;
    check("[5a] client_name do humano INTOCADO", lead.client_name === "Nome Do Vendedor", `client_name=${lead.client_name}`);
    check("[5b] client_city do humano INTOCADO", lead.client_city === "Taubaté (vendedor)", `city=${lead.client_city}`);
    check("[5c] summary de OUTRA autoria INTOCADO (sem prefixo [Pedro v3] não atualiza)", lead.summary === "resumo escrito pelo humano", `summary=${lead.summary}`);
  }

  // ── 6) retry do MESMO effect não duplica escrita (idempotente) ──
  {
    const store = new FakeCrmStore([{ id: LEAD_ID, tenantId: TENANT, agentId: AGENT, fields: {} }]);
    const clock = new FakeClock(NOW);
    const dispatcher = new CrmWriteEffectDispatcher({ ref: REF, clock, store });
    const record = {
      effectId: "t1:crm", conversationId: "c1", turnId: "t1", planId: "crm", kind: "crm_write", idempotencyKey: "t1:crm",
      order: CRM_WRITE_ORDER, dependsOn: [], payload: redact({ leadId: LEAD_ID, fields: { client_name: "Douglas", down_payment: "R$ 8.000" } }),
      onSuccess: [], status: "pending", providerCapability: "none", receiptLevel: null, attempts: 0, nextRetryAt: null,
      providerReceipt: null, outcomeAppliedAt: null, lastError: null, createdAt: NOW, dispatchedAt: null,
    } as unknown as OutboxRecord;
    const r1 = await dispatcher.dispatch(record);
    const updatesAfterFirst = store.updates;
    const r2 = await dispatcher.dispatch(record);   // retry (ex.: outcome_uncertain re-processado)
    check("[6] retry idempotente: 1º grava, 2º é no-op (campos já preenchidos)", r1.status === "succeeded" && r2.status === "succeeded" && store.updates === updatesAfterFirst && store.rows[0].fields.client_name === "Douglas", `updates=${store.updates} r2=${r2.status}`);
  }

  // ── 7) falha no CRM NÃO silencia o lead (reply já despachado; crm falha isolada) ──
  {
    const store = new FakeCrmStore([{ id: LEAD_ID, tenantId: TENANT, agentId: AGENT, fields: {} }]);
    store.failNextUpdate = true;
    const c = conv(store);
    const t1 = await c.t("meu nome é Douglas", () => finU([txt("Prazer, Douglas! O que você procura?")], "reply", U("other")));
    const msg = t1.outbox.find((o) => o.kind === "send_message");
    const crm = crmOf(t1);
    check("[7a] send_message SUCCEEDED mesmo com CRM falhando", msg?.status === "succeeded", `msg=${msg?.status}`);
    check("[7b] crm_write terminou uncertain/failed SEM afetar o reply", crm != null && (crm.status === "outcome_uncertain" || crm.status === "failed"), `crm=${crm?.status}`);
    check("[7c] resposta chegou ao lead (fake WA registrou o send)", t1.sent.includes("send_message"), t1.sent.join(","));
  }

  // ── 8) cross-tenant BLOQUEADO (lead de outro tenant/agente) ──
  {
    const store = new FakeCrmStore([{ id: "lead-de-outro", tenantId: "outro-tenant", agentId: "outro-agente", fields: {} }]);
    const c = conv(store, { leadId: "lead-de-outro" });
    const t1 = await c.t("meu nome é Douglas", () => finU([txt("Prazer, Douglas! O que você procura?")], "reply", U("other")));
    const crm = crmOf(t1);
    check("[8] crm_write FORBIDDEN (lead não pertence ao tenant/agente) e nada foi escrito", crm?.status === "failed" && store.rows[0].fields.client_name == null && store.updates === 0, `crm=${crm?.status} updates=${store.updates}`);
  }

  // ── 9) briefing sem dado NÃO inventa + resumo operacional substitui transcrição ──
  {
    const empty = createInitialState({ conversationId: "c9", tenantId: TENANT, agentId: AGENT, leadId: null, now: NOW });
    const briefing = buildSellerBriefing({ state: empty, adContext: null, adVehicleLabel: null, lastPhotoAction: null, agentName: "Aloan", leadPhone: null });
    check("[9a] briefing vazio usa placeholder humano e não inventa dado", has(briefing, "Contato do WhatsApp") && !/r\$\s*\d/i.test(briefing) && !has(briefing, "Troca:") && !has(briefing, "Visita:") && !has(briefing, "Fotos enviadas"), briefing.slice(0, 240));
    check("[9b] categoria = inativo + próxima ação começa pela necessidade", classifySdrCategory(empty) === "inativo" && has(suggestNextStep(empty), "necessidade principal"), `${classifySdrCategory(empty)} | ${suggestNextStep(empty)}`);
    check("[9c] briefing tem Resumo do agente e nunca Últimas mensagens", has(briefing, "Resumo do agente") && !has(briefing, "Últimas mensagens"), briefing);
    // buildCrmWritePlan fail-closed: sem leadId -> null; sem campos -> null; sem mudança -> null
    check("[9d] plan fail-closed: sem leadId => null; estado vazio => null", buildCrmWritePlan({ stateAfter: empty, stateBefore: null, adContext: null, adVehicleLabel: null, leadId: null, turnId: "t" }) === null && buildCrmWritePlan({ stateAfter: empty, stateBefore: null, adContext: null, adVehicleLabel: null, leadId: LEAD_ID, turnId: "t" }) === null);
    const store = new FakeCrmStore([{ id: LEAD_ID, tenantId: TENANT, agentId: AGENT, fields: {} }]);
    const c = conv(store, { leadId: null });
    const t1 = await c.t("meu nome é Douglas", () => finU([txt("Prazer! O que você procura?")], "reply", U("other")));
    check("[9e] sem leadId: NENHUM crm_write no outbox (fail-closed)", crmOf(t1) === undefined);
    const c2 = conv(new FakeCrmStore([{ id: LEAD_ID, tenantId: TENANT, agentId: AGENT, fields: {} }]), { crmEnabled: false });
    const t2 = await c2.t("meu nome é Douglas", () => finU([txt("Prazer! O que você procura?")], "reply", U("other")));
    check("[9f] flag OFF: NENHUM crm_write no outbox (default fail-closed)", crmOf(t2) === undefined);
  }

  // ── 9R) relatório para vendedor: resume fatos, anúncio e inatividade sem despejar conversa crua ──
  {
    const s = createInitialState({ conversationId: "c9r", tenantId: TENANT, agentId: AGENT, leadId: LEAD_ID, now: NOW });
    s.slots.tipoVeiculo = { status: "known", value: "suv", confidence: 1, updatedAt: NOW, sourceTurnId: "t1" };
    s.lastRenderedOfferContext = {
      sourceTurnId: "t1", createdAt: NOW,
      items: [
        { ordinal: 1, vehicleKey: "rm:compass", marca: "Jeep", modelo: "Compass", ano: 2019, tipo: "suv" },
        { ordinal: 2, vehicleKey: "rm:renegade", marca: "Jeep", modelo: "Renegade", ano: 2021, tipo: "suv" },
      ],
    };
    s.recentTurns = [
      { role: "lead", text: "Tem SUV? Quero ver fotos", at: NOW },
      { role: "agent", text: "Separei duas opções", at: NOW },
    ];
    const ad: AdContext = { adId: "ad-9", source: "facebook", sourceUrl: "https://fb.me/x", title: "Jeep Compass 2019", body: "Oferta Jeep Compass", greeting: "Olá", imageUrls: [], capturedAtTurn: 0 };
    const args = { state: s, adContext: ad, adVehicleLabel: "Jeep Compass 2019", lastPhotoAction: { label: "Jeep Compass 2019", photoIds: ["p1", "p2", "p3"] }, agentName: "Aloan", leadPhone: "55129888823679", leadDisplayName: "Douglas 🚗", handoffReason: "followup_timeout_handoff" as const };
    const summary = buildAgentSummary(args).join(" ");
    const briefing = buildSellerBriefing(args);
    check("[9R-1] nome usa pushName saneado, nunca Lead/não informado", has(briefing, "LEAD — Douglas") && !has(briefing, "não informado"), briefing.slice(0, 120));
    check("[9R-2] resumo registra anúncio, opções, fotos e inatividade", has(summary, "anúncio") && has(summary, "2 opções") && has(summary, "3 fotos") && has(summary, "inativo"), summary);
    check("[9R-3] briefing não replica falas cruas", !has(briefing, "Cliente:") && !has(briefing, "IA:") && !has(briefing, "Últimas mensagens"), briefing);
    check("[9R-4] próxima ação retoma opções apresentadas", has(suggestNextStep(s, args), "2 opções apresentadas"), suggestNextStep(s, args));
  }

  // ── delta por turno: turno sem coleta nova NÃO emite crm_write ──
  {
    const store = new FakeCrmStore([{ id: LEAD_ID, tenantId: TENANT, agentId: AGENT, fields: {} }]);
    const c = conv(store);
    const t1 = await c.t("meu nome é Douglas", () => finU([txt("Prazer, Douglas! O que você procura?")], "reply", U("other")));
    const t2 = await c.t("hmm deixa eu pensar", () => finU([txt("Claro! Fico à disposição.")], "reply", U("smalltalk")));
    check("[Δ] turno COM coleta emite crm_write; turno SEM coleta não emite", crmOf(t1) != null && crmOf(t2) === undefined, `t1=${crmOf(t1)?.status} t2=${crmOf(t2)?.effectId ?? "none"}`);
  }

  // ── R) receipt do crm_write = DELIVERED (audit Codex): crm_write é efeito CRÍTICO (effect-policy exige
  //      "delivered" p/ satisfazer dependência). O PATCH é síncrono => sucesso É entrega. Um efeito DEPENDENTE
  //      do crm_write (Fase 3: handoff/notify_seller) fica LIBERADO após o sucesso — nunca preso em pending. ──
  {
    const store = new FakeCrmStore([{ id: LEAD_ID, tenantId: TENANT, agentId: AGENT, fields: {} }]);
    const clock = new FakeClock(NOW);
    const persistence = new InMemoryPersistence(clock, new FakeIdGen());
    const convId = "wa:f46_receipt";
    const base = {
      conversationId: convId, turnId: "t1", dependsOn: [] as string[], onSuccess: [], status: "pending",
      providerCapability: "none", receiptLevel: null, attempts: 0, nextRetryAt: null, providerReceipt: null,
      outcomeAppliedAt: null, lastError: null, createdAt: NOW, dispatchedAt: null,
    };
    const crmRec = { ...base, effectId: "t1:crm", planId: "crm", kind: "crm_write", idempotencyKey: "t1:crm", order: 0, payload: redact({ leadId: LEAD_ID, fields: { client_name: "Douglas" } }) } as unknown as OutboxRecord;
    const dependent = { ...base, effectId: "t1:notify", planId: "notify", kind: "send_message", idempotencyKey: "t1:notify", order: 1, dependsOn: ["crm"], payload: redact({ text: "briefing ao vendedor (fase 3 simulada)" }) } as unknown as OutboxRecord;
    const tx = persistence.begin();
    tx.casState(convId, 0, createInitialState({ conversationId: convId, tenantId: TENANT, agentId: AGENT, leadId: LEAD_ID, now: NOW }));
    tx.appendOutbox([crmRec, dependent]);
    const seeded = await tx.commit();
    check("[R-0] seed do outbox ok", seeded.ok === true);
    const wa = new FakeWaDispatcher();
    const composite = new CompositeEffectDispatcher({ send_message: wa, send_media: wa, crm_write: new CrmWriteEffectDispatcher({ ref: REF, clock, store }) });
    const dispatcher = new OutboxDispatcher(persistence, clock, composite, allowAllGate as never, "w:receipt");
    await dispatcher.dispatchConversation(convId);
    const after = persistence.listOutbox(convId) as unknown as OutboxRecord[];
    const crmAfter = after.find((o) => o.effectId === "t1:crm");
    const depAfter = after.find((o) => o.effectId === "t1:notify");
    check("[R-1] crm_write succeeded + receiptLevel=DELIVERED + outcomeAppliedAt preenchido", crmAfter?.status === "succeeded" && crmAfter.receiptLevel === "delivered" && crmAfter.outcomeAppliedAt != null, `status=${crmAfter?.status} level=${crmAfter?.receiptLevel} applied=${crmAfter?.outcomeAppliedAt}`);
    check("[R-2] efeito DEPENDENTE do crm_write foi LIBERADO e despachou (não ficou pending/skipped)", depAfter?.status === "succeeded" && wa.sent.includes("send_message"), `dep=${depAfter?.status} sent=${wa.sent.join(",")}`);
    check("[R-3] CRM realmente gravado no store", store.rows[0].fields.client_name === "Douglas", `name=${store.rows[0].fields.client_name}`);
  }

  // ── puro: buildCrmFields nunca emite chave vazia/null ──
  {
    const empty = createInitialState({ conversationId: "c0", tenantId: TENANT, agentId: AGENT, leadId: null, now: NOW });
    const fields = buildCrmFields(empty, null, null);
    check("[P] estado vazio => 0 campos (nunca null/vazio no payload)", Object.keys(fields).length === 0, JSON.stringify(fields));
  }

  console.log(`\n== F2.46: ${ok} OK | ${fail} FALHA ==`);
  if (fail > 0) { for (const f of fails) console.error("  FALHOU: " + f); process.exit(1); }
}

main().catch((err) => { console.error(err); process.exit(1); });
