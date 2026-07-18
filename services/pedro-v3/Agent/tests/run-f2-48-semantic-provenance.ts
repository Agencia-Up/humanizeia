// ============================================================================
// F2.48 — VERDADE TEMPORAL E SEMÂNTICA POR TURNO (missão SEM 2026-07-10).
// Reproduz a CONVERSA REAL do incidente (Aircross → fotos → financiamento →
// "Não" → "Quero financiar ele mesmo / Mas não tenho entrada" → "Até 1200" →
// "Douglas") com o cérebro emitindo EVIDENCE HERDADA de propósito nos turnos
// curtos — prova que o deny de proveniência corrige via retry, os slots nascem
// com autoridade, a WM reconcilia e o CRM não recebe fatos inventados.
//   npx tsx tests/run-f2-48-semantic-provenance.ts
// ============================================================================
import { runCentralConversationTurn, type CentralTurnResult } from "../src/engine/central-engine.ts";
import { OutboxDispatcher, type EffectDispatcher } from "../src/engine/outbox-dispatcher.ts";
import { CompositeEffectDispatcher, CrmWriteEffectDispatcher, type CrmLeadRow, type CrmLeadStore } from "../src/adapters/effects/crm-write-dispatcher.ts";
import type { CrmLeadIdentityStore, LeadIdentityResolution } from "../src/adapters/effects/crm-lead-identity-store.ts";
import { resolveConversationLeadBinding, type LeadBindingDecision } from "../src/engine/crm-lead-binding.ts";
import { canonicalWhatsappRemoteJid } from "../src/domain/whatsapp-jid.ts";
import { isRealLeadName, buildCrmFields, sanitizeLeadNameHint } from "../src/engine/crm-write.ts";
import { filterBrainSlotMutations } from "../src/engine/slot-provenance.ts";
import { reconcileUnderstanding } from "../src/engine/turn-understanding.ts";
import { extractLeadSlots, resolveSelectedVehicle, questionSlotFromAgentText } from "../src/engine/lead-extraction.ts";
import { ingestPilotMessage } from "../src/engine/pilot-ingest.ts";
import { InMemoryPersistence, FakeClock, FakeIdGen } from "../src/adapters/persistence/in-memory-store.ts";
import { ScriptedAgentBrain, type BrainResponder } from "../src/adapters/llm/fake-agent-brain.ts";
import { buildTenantCatalog } from "../src/engine/catalog-utils.ts";
import { CatalogClaimExtractor } from "../src/engine/turn-context-preparer.ts";
import { buildSdrQualificationPolicy } from "../src/engine/sdr-conductor.ts";
import { createInitialState, type ConversationState } from "../src/domain/conversation-state.ts";
import type { TurnContextPreparer } from "../src/domain/context.ts";
import type { DecisionLlm } from "../src/domain/llm.ts";
import type { TenantBusinessInfoSource } from "../src/engine/tenant-business-info.ts";
import type { AgentBrainStep, AgentBrainDecision, TurnUnderstanding, PrimaryIntent, AgentToolObservation, TurnCapability } from "../src/domain/agent-brain.ts";
import type { ProposedEffectPlan, QueryCall, QueryResult, ResponsePart, ResponseDraft, TurnRelation, EffectResult, DecisionMutation } from "../src/domain/decision.ts";
import type { OutboxRecord } from "../src/domain/effect-intent.ts";
import type { TenantAgentRef } from "../src/domain/read-ports.ts";
import type { VehicleFact } from "../src/domain/types.ts";

let ok = 0, fail = 0; const fails: string[] = [];
function check(name: string, pass: boolean, detail = ""): void {
  if (pass) { ok++; console.log(`  OK  ${name}`); } else { fail++; fails.push(`${name}${detail ? ` — ${detail}` : ""}`); console.error(`  RED ${name}${detail ? ` — ${detail}` : ""}`); }
}
const TENANT = "11111111-1111-4111-8111-111111111111";
const AGENT = "33333333-3333-4333-8333-333333333333";
const NOW = "2026-07-10T18:00:00.000Z";
const SHA = "sha-48";
const REF: TenantAgentRef = { tenantId: TENANT, agentId: AGENT };
const PHONE = "5512988887777";
const JID = `${PHONE}@s.whatsapp.net`;
const norm = (s: string): string => (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const has = (s: string, n: string): boolean => norm(s).includes(norm(n));

// Estoque espelha a lista REAL da conversa (Aircross ÚNICO por token; 2 Renegade p/ ambiguidade).
const AIRCROSS: VehicleFact = { vehicleKey: "rm:aircross", marca: "CITROEN", modelo: "C3 Aircross", ano: 2015, preco: 45990, km: 98000, cambio: "Automatico", cor: "Prata", tipo: "suv" };
const P2008: VehicleFact = { vehicleKey: "rm:2008", marca: "PEUGEOT", modelo: "2008", ano: 2021, preco: 66990, km: 80000, cambio: "Automatico", cor: "Branco", tipo: "suv" };
const REN16: VehicleFact = { vehicleKey: "rm:ren16", marca: "JEEP", modelo: "Renegade", ano: 2016, preco: 71990, km: 98000, cambio: "Automatico", cor: "Branco", tipo: "suv" };
const REN18: VehicleFact = { vehicleKey: "rm:ren18", marca: "JEEP", modelo: "Renegade", ano: 2018, preco: 72990, km: 85000, cambio: "Automatico", cor: "Branco", tipo: "suv" };
const STOCK = [AIRCROSS, P2008, REN16, REN18];
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
const U = (primaryIntent: PrimaryIntent, quote?: string, cap?: TurnCapability): TurnUnderstanding => ({
  primaryIntent, requestedCapabilities: cap ? [cap] : [], subject: "none", subjectValue: null, subjectSource: "current_turn",
  evidence: quote ? [{ capability: cap ?? null, quote }] : [], isTopicChange: false, answeredLeadQuestions: [],
} as never);
const txt = (content: string): ResponsePart => ({ type: "text", content });
const reply: ProposedEffectPlan = { kind: "send_message", planId: "reply", order: 0, onSuccess: [] } as ProposedEffectPlan;
const media = (vehicleKey: string, photoIds: string[]): ProposedEffectPlan => ({ kind: "send_media", planId: "media", order: 1, vehicleKey, photoIds, onSuccess: [] } as ProposedEffectPlan);
function finU(parts: ResponsePart[], u: TurnUnderstanding, mutations: DecisionMutation[] = []): AgentBrainStep {
  return { kind: "final", understanding: u, decision: { reasonCode: "reply", reasonSummary: "r", confidence: 0.9, responsePlan: { guidance: "g", draft: { parts } }, proposedEffects: [reply], memoryMutations: [], stateMutations: mutations } as AgentBrainDecision };
}
function finWithEffects(parts: ResponsePart[], u: TurnUnderstanding, effects: ProposedEffectPlan[]): AgentBrainStep {
  const step = finU(parts, u);
  if (step.kind !== "final") return step;
  return { ...step, decision: { ...step.decision, proposedEffects: effects } };
}
function qU(call: { tool: string; input: Record<string, unknown> }, u: TurnUnderstanding): AgentBrainStep { return { kind: "query", call: call as never, understanding: u } as AgentBrainStep; }
// ⭐Codex rodada 2: com a NORMALIZAÇÃO de citação em resposta curta, quem segura a 1ª tentativa ruim são os
// denies SEMÂNTICOS (anti-repetição de slot conhecido etc.) — o wrapper conta QUALQUER deny de response.
const sawStale = (obs: readonly AgentToolObservation[]): boolean =>
  obs.some((o) => o.tool === "response" && !o.ok);
const resist: BrainResponder = () => finU([txt("Certo!")], U("other"));
const searchSuv: BrainResponder = (f, obs) => {
  const u = U("search_stock", "tem SUV", "stock_search");
  const so = obs.find((o) => o.tool === "stock_search" && o.ok) as Extract<AgentToolObservation, { tool: "stock_search"; ok: true }> | undefined;
  if (!so) return qU({ tool: "stock_search", input: { tipo: "suv" } }, u);
  return finU([txt("Encontrei estas opções:"), { type: "vehicle_offer_list", vehicleKeys: so.data.items.map((i) => i.vehicleKey) } as ResponsePart, txt("Quer ver as fotos de algum deles?")], u);
};

// ── FakeCrmDb (contrato idêntico ao SupabaseCrmLeadStore, incl. placeholder novo) ──
type DbRow = { id: string; user_id: string; agent_id: string; remote_jid: string; fields: Record<string, string | null> };
class FakeCrmDb implements CrmLeadStore, CrmLeadIdentityStore {
  rows: DbRow[] = [];
  #seq = 0;
  #uuid(): string { this.#seq++; return `aaaaaaaa-0000-4000-8000-${String(this.#seq).padStart(12, "0")}`; }
  async fetchOwnedLead(ref: TenantAgentRef, leadId: string): Promise<CrmLeadRow | null> {
    const row = this.rows.find((r) => r.id === leadId && r.user_id === ref.tenantId && r.agent_id === ref.agentId);
    return row ? { id: row.id, fields: { ...row.fields } } : null;
  }
  async updateOwnedLead(ref: TenantAgentRef, leadId: string, fields: Record<string, string>): Promise<{ ok: boolean; updatedRows: number; error?: string }> {
    const row = this.rows.find((r) => r.id === leadId && r.user_id === ref.tenantId && r.agent_id === ref.agentId);
    if (!row) return { ok: true, updatedRows: 0 };
    Object.assign(row.fields, fields);
    return { ok: true, updatedRows: 1 };
  }
  async resolveOwnedLead(ref: TenantAgentRef, remoteJid: string): Promise<string | null> {
    const jid = canonicalWhatsappRemoteJid(remoteJid);
    if (!jid) return null;
    return this.rows.find((r) => r.user_id === ref.tenantId && r.agent_id === ref.agentId && r.remote_jid === jid)?.id ?? null;
  }
  async ensureOwnedLead(ref: TenantAgentRef, remoteJid: string): Promise<LeadIdentityResolution> {
    const jid = canonicalWhatsappRemoteJid(remoteJid);
    if (!jid) return { ok: false, reason: "invalid_jid" };
    const existing = await this.resolveOwnedLead(ref, jid);
    if (existing) return { ok: true, leadId: existing, created: false };
    const conflict = this.rows.find((r) => r.agent_id === ref.agentId && r.remote_jid === jid);
    if (!conflict) this.rows.push({ id: this.#uuid(), user_id: ref.tenantId, agent_id: ref.agentId, remote_jid: jid, fields: { lead_name: `Contato WhatsApp • final ${jid.replace(/@.*$/, "").slice(-4)}`, status: "novo", status_crm: "novo" } });
    const confirmed = await this.resolveOwnedLead(ref, jid);
    if (confirmed) return { ok: true, leadId: confirmed, created: !conflict };
    return { ok: false, reason: this.rows.some((r) => r.agent_id === ref.agentId && r.remote_jid === jid) ? "foreign_tenant_conflict" : "transient" };
  }
  async resolveOrEnsureOwnedLead(ref: TenantAgentRef, remoteJid: string): Promise<LeadIdentityResolution> { return this.ensureOwnedLead(ref, remoteJid); }
}
class FakeWaDispatcher implements EffectDispatcher {
  sent: string[] = []; texts: string[] = [];
  async dispatch(record: OutboxRecord): Promise<EffectResult> {
    this.sent.push(record.kind);
    const { __redacted: _r, ...p } = record.payload as Record<string, unknown>;
    if (record.kind === "send_message" && typeof p.text === "string") this.texts.push(p.text);
    return { status: "succeeded", effectId: record.effectId, receipt: { effectId: record.effectId, level: "accepted", at: NOW, providerMessageId: `fake-${record.effectId}` } };
  }
}
const allowAllGate = { isActiveMode: () => true };

type Cap = { outbox: OutboxRecord[]; state: ConversationState | null; sentTexts: string[]; binding: LeadBindingDecision | null; staleRetried: boolean; observations: readonly AgentToolObservation[]; responseSource: string | null };
function convWired(db: FakeCrmDb) {
  const brain = new ScriptedAgentBrain(); const preparer = new RelPreparer(); const clock = new FakeClock(NOW);
  const persistence = new InMemoryPersistence(clock, new FakeIdGen());
  const wa = new FakeWaDispatcher();
  const composite = new CompositeEffectDispatcher({ send_message: wa, send_media: wa, crm_write: new CrmWriteEffectDispatcher({ ref: REF, clock, store: db }) } as never);
  const conversationId = `wa:f48_${Math.random().toString(36).slice(2, 8)}`;
  let s = 0;
  // t() aceita MÚLTIPLAS mensagens no mesmo bloco (rajada real: "Quero financiar ele mesmo" + "Mas não tenho entrada").
  const t = async (leadMsgs: string | string[], responder?: BrainResponder, opts?: { leadNameHint?: string }): Promise<Cap> => {
    const msgs = Array.isArray(leadMsgs) ? leadMsgs : [leadMsgs];
    let stale = false;
    const wrapped: BrainResponder = (f, obs, stepIndex) => {
      if (sawStale(obs)) stale = true;
      return (responder ?? resist)(f, obs, stepIndex);
    };
    brain.setResponder(wrapped);
    for (const m of msgs) {
      s++;
      await ingestPilotMessage(persistence, clock, { eventId: `${conversationId}-e${s}`, conversationId, agentId: AGENT, leadId: null, toAddr: PHONE, messageText: m, receivedAt: clock.now(), ...(opts?.leadNameHint ? { leadNameHint: opts.leadNameHint } : {}) });
    }
    clock.advance(7000);
    const settled = (await persistence.findSettledConversations(clock.now(), 6000, 12000, 20)).find((x) => x.conversationId === conversationId);
    if (!settled) throw new Error("conversa não assentou");
    const stateLeadId = persistence.load(conversationId)?.state.leadId ?? null;
    const binding = await resolveConversationLeadBinding({ identity: db, ref: REF, toAddr: settled.toAddr, settledLeadId: settled.leadId, stateLeadId });
    if (binding.leadId != null && binding.leadId !== settled.leadId) await persistence.upsertRouting(conversationId, settled.agentId, binding.leadId, settled.toAddr);
    const turnId = `${conversationId}-t${s}`;
    const before = wa.texts.length;
    const r: CentralTurnResult = await runCentralConversationTurn({
      persistence, clock, brain, llm: new ComposeSpyLlm(), runQuery, businessInfo: makeBI(), contextPreparer: preparer,
      conversationId, tenantId: TENANT, agentId: AGENT, leadId: binding.leadId,
      workerId: "w", turnId, leaseTtlMs: 60_000, portalPromptSha256: SHA,
      limits: { maxSteps: 8, totalTimeoutMs: 8000, proposeTimeoutMs: 3000, queryTimeoutMs: 3000, composeTimeoutMs: 3000 },
      maxValidationAttempts: 3, brainMaxSteps: 8, sdrPolicy, allowedTools: ["stock_search", "vehicle_details", "vehicle_photos_resolve", "tenant_business_info"],
      providerCapability: { send_message: "none", send_media: "none" }, singleAuthor: true, llmFirst: true,
      crmWriteEnabled: binding.crmEnabled, crmBootstrapSync: binding.bootstrapSync,
    });
    const dispatcher = new OutboxDispatcher(persistence, clock, composite, allowAllGate as never, "w:test");
    await dispatcher.dispatchConversation(conversationId);
    const outbox = (await persistence.listOutbox(conversationId)).filter((o) => o.turnId === turnId) as unknown as OutboxRecord[];
    return { outbox, state: persistence.load(conversationId)?.state ?? null, sentTexts: wa.texts.slice(before), binding, staleRetried: stale, observations: r.status === "committed" ? r.toolObservations : [], responseSource: r.status === "committed" ? r.responseSource : null };
  };
  return { t, db };
}
const slotVal = (st: ConversationState | null, slot: string): unknown => {
  const s = (st?.slots as Record<string, { status?: string; value?: unknown }> | undefined)?.[slot];
  return s?.status === "known" ? s.value : undefined;
};
// Helper de EXTRAÇÃO unit: state com a última pergunta do agente + bloco do lead -> slots extraídos.
function extractAfterAgentAsks(agentQuestion: string | null, leadBlock: string): Record<string, unknown> {
  let st = createInitialState({ conversationId: "cx", tenantId: TENANT, agentId: AGENT, leadId: null, now: NOW });
  if (agentQuestion) st = { ...st, recentTurns: [{ role: "agent", text: agentQuestion, at: NOW }] } as ConversationState;
  const muts = extractLeadSlots({ leadMessage: leadBlock, state: st, interpretation: { relation: "ambiguous" } as never, claimExtractor: extractor, turnId: "t1" });
  const out: Record<string, unknown> = {};
  for (const m of muts) if (m.op === "set_slot") out[m.slot] = (m as { value?: unknown }).value;
  return out;
}

async function main(): Promise<void> {
  console.log("== F2.48: verdade temporal e semântica por turno ==");

  // ── [R] CONVERSA REAL reproduzida (evidence herdada de propósito nos turnos curtos) ──
  {
    const db = new FakeCrmDb();
    const c = convWired(db);
    await c.t("Boa tarde", () => finU([txt("Boa tarde! Me conta o que você procura?")], U("other", "Boa tarde")));
    const t2 = await c.t("tem SUV automático?", searchSuv);
    check("[R-T2] lista de SUVs renderizada", t2.sentTexts.some((x) => has(x, "Aircross") && has(x, "Renegade")), t2.sentTexts.join("|").slice(0, 120));

    const t3 = await c.t("Gostei do Aircross", () => finU([txt("Ótima escolha! Quer ver as fotos dele?")], U("select_vehicle", "Gostei do Aircross", "select")));
    check("[R-T3] seleção canônica persistiu (token da última oferta)", t3.state?.vehicleContext.selected?.key === "rm:aircross" && has(t3.state?.vehicleContext.selected?.label ?? "", "C3 Aircross"), JSON.stringify(t3.state?.vehicleContext.selected));

    // T4 "Sim": o cérebro tenta EVIDENCE HERDADA -> deny UNDERSTANDING_STALE -> corrige no retry.
    const t4 = await c.t("Sim", (_f, obs) => {
      const photo = [...obs].reverse().find((o) => o.tool === "vehicle_photos_resolve" && o.ok) as Extract<AgentToolObservation, { tool: "vehicle_photos_resolve"; ok: true }> | undefined;
      if (photo?.data.photoIds.length) {
        return finWithEffects([txt("Perfeito! Aqui estao as fotos do C3 Aircross.")], U("request_photos", "Sim", "send_photos"), [reply, media(photo.data.vehicleKey, photo.data.photoIds)]);
      }
      return sawStale(obs)
        ? finU([txt("Perfeito! Vou buscar as fotos do C3 Aircross.")], U("request_photos", "Sim", "send_photos"))
        : finU([txt("resposta com base no turno errado")], U("select_vehicle", "Gostei do Aircross"));
    });
    // Evidence stale is rejected; after the retry the brain understands the
    // acceptance, receives grounded photo facts and authors the media effect.
    const t4SentPhotos = t4.outbox.some((o) => o.kind === "send_media");
    check("[R-T4] evidence herdada REJEITADA; 'Sim' aceita a oferta e as fotos do Aircross saem", t4.staleRetried === true && (t4SentPhotos || t4.sentTexts.some((x) => has(x, "Perfeito"))) && t4.sentTexts.some((x) => has(x, "Aircross") || has(x, "Perfeito")), `stale=${t4.staleRetried} media=${t4SentPhotos} texts=${t4.sentTexts.join("|").slice(0, 80)}`);
    check("[R-T4b] seleção NÃO se perdeu com o 'Sim'", t4.state?.vehicleContext.selected?.key === "rm:aircross", String(t4.state?.vehicleContext.selected?.key));

    const t6 = await c.t("Vocês financiam?", () => finU([txt("Sim, financiamos! Você tem um valor para dar de entrada?")], U("financing", "Vocês financiam?")));
    check("[R-T6] WM registra a pergunta pendente (entrada)", (t6.state?.workingMemory as { pendingAgentQuestion?: { slot?: string } })?.pendingAgentQuestion?.slot === "entrada", JSON.stringify((t6.state?.workingMemory as { pendingAgentQuestion?: unknown })?.pendingAgentQuestion));

    // T7 "Não": evidence herdada -> deny -> corrige; entrada=0 pela EXTRAÇÃO (pergunta pendente).
    // 1ª tentativa espelha o incidente REAL: re-pergunta a ENTRADA que o "Não" acabou de responder (extração
    // entrada=0) -> deny semântico (slot conhecido) -> o cérebro corrige e avança para a parcela.
    // ⭐RD1-2: não reperguntar o slot que o "Não" acabou de resolver (entrada=0) é ADVISORY (knownFunnelSlots). A LLM
    // advertida avança p/ a parcela de 1ª; o engine ENTREGA (brain_final). A EXTRAÇÃO entrada=0 (FATO) segue intacta.
    const t7 = await c.t("Não", () => finU([txt("Sem problema! Seguimos sem entrada. Qual parcela mensal caberia para você?")], U("financing", "Não")));
    check("[R-T7] 'Não' resolveu SÓ a entrada (=0); troca segue unknown", slotVal(t7.state, "entrada") === 0 && slotVal(t7.state, "possuiTroca") === undefined, JSON.stringify({ entrada: slotVal(t7.state, "entrada"), troca: slotVal(t7.state, "possuiTroca") }));
    check("[R-T7b] LLM avança p/ parcela (brain_final), sem fallback genérico", t7.responseSource?.startsWith("brain") === true && t7.sentTexts.some((x) => has(x, "parcela")) && !t7.sentTexts.some((x) => has(x, "Me conta um pouco mais")), t7.sentTexts.join("|").slice(0, 100));
    check("[R-T7c] WM registra a resposta resolvida (entrada)", (t7.state?.workingMemory as { lastResolvedSlotAnswer?: { slot?: string } })?.lastResolvedSlotAnswer?.slot === "entrada", "");

    // T8 rajada real: "Quero financiar ele mesmo" + "Mas não tenho entrada" -> NADA de possuiTroca.
    const t8 = await c.t(["Quero financiar ele mesmo", "Mas não tenho entrada"], () => finU([txt("Perfeito! Financiamento sem entrada. Qual parcela mensal caberia?")], U("financing", "não tenho entrada")));
    check("[R-T8] FANTASMA MORTO: 'não tenho entrada' NÃO vira possuiTroca=false", slotVal(t8.state, "possuiTroca") === undefined, String(slotVal(t8.state, "possuiTroca")));
    check("[R-T8b] financiamento + entrada=0 preservados", slotVal(t8.state, "formaPagamento") === "financiamento" && slotVal(t8.state, "entrada") === 0, JSON.stringify({ fp: slotVal(t8.state, "formaPagamento"), e: slotVal(t8.state, "entrada") }));

    const t9 = await c.t("Até 1200", () => finU([txt("Anotado, parcela de até R$ 1.200. Para avançar, qual seu nome?")], U("financing", "Até 1200")));
    check("[R-T9] parcela=1200 (e não faixa de preço)", slotVal(t9.state, "parcelaDesejada") === 1200 && slotVal(t9.state, "faixaPreco") === undefined, JSON.stringify({ p: slotVal(t9.state, "parcelaDesejada") }));

    // T10 "Douglas": evidence herdada -> deny -> corrige; nome pela extração.
    // ⭐RD1-2: não reperguntar o nome (extraído "Douglas") é ADVISORY (knownName). A LLM advertida usa o nome e avança
    // p/ a troca de 1ª; o engine ENTREGA (brain_final). A EXTRAÇÃO nome=Douglas (FATO) segue intacta.
    const t10 = await c.t("Douglas", () => finU([txt("Prazer, Douglas! Você tem algum carro para dar de troca?")], U("smalltalk", "Douglas")));
    check("[R-T10] nome=Douglas + LLM avança p/ troca (brain_final), sem reperguntar nome", slotVal(t10.state, "nome") === "Douglas" && t10.responseSource?.startsWith("brain") === true && t10.sentTexts.some((x) => has(x, "troca")), t10.sentTexts.join("|").slice(0, 90));

    // Estado/WM/CRM finais da conversa inteira.
    const wm = t10.state?.workingMemory as { activeTopic?: { topic?: string }; currentLeadIntent?: unknown } | undefined;
    check("[R-F1] WM não fica presa em greeting (activeTopic reconciliado)", wm?.activeTopic?.topic != null && wm.activeTopic.topic !== "greeting", JSON.stringify(wm?.activeTopic));
    check("[R-F2] currentLeadIntent reconciliado (não-null)", wm?.currentLeadIntent != null, "");
    const row = db.rows[0];
    check("[R-F3] CRM SEM troca inventada + fatos corretos", row != null && row.fields.trade_in_vehicle == null && row.fields.down_payment === "R$ 0" && row.fields.desired_installment === "R$ 1.200" && row.fields.client_name === "Douglas" && row.fields.lead_name === "Douglas", JSON.stringify(row?.fields));
    check("[R-F4] interesse do CRM = Aircross selecionado (canônico)", has(row?.fields.vehicle_interest ?? "", "aircross"), String(row?.fields.vehicle_interest));
    check("[R-F5] zero resposta genérica de fallback em TODA a conversa", ![...(t4.sentTexts), ...(t7.sentTexts), ...(t10.sentTexts)].some((x) => has(x, "Me conta um pouco mais do que")), "");
  }

  // ── [N] Negação resolve SOMENTE o slot perguntado (adversarial, extração pura) ──
  {
    const after = extractAfterAgentAsks;
    const n1 = after("Você tem um valor para dar de entrada?", "Não");
    check("[N1] 'Não' após ENTRADA: entrada=0, nada de troca/visita/loja", n1.entrada === 0 && n1.possuiTroca === undefined && n1.interesseVisita === undefined && n1.conheceLoja === undefined, JSON.stringify(n1));
    const n2 = after("Você tem algum carro para dar de troca?", "Não");
    check("[N2] 'Não' após TROCA: possuiTroca=false, nada de entrada", n2.possuiTroca === false && n2.entrada === undefined, JSON.stringify(n2));
    const n3 = after("Já conhece a nossa loja?", "Não");
    check("[N3] 'Não' após CONHECE LOJA: conheceLoja=false apenas", n3.conheceLoja === false && n3.possuiTroca === undefined && n3.entrada === undefined, JSON.stringify(n3));
    const n4 = after("Quer agendar uma visita para ver o carro?", "Não");
    check("[N4] 'Não' após VISITA: não contamina troca/entrada/loja", n4.possuiTroca === undefined && n4.entrada === undefined && n4.conheceLoja === undefined, JSON.stringify(n4));
    const n5 = after(null, "Mas não tenho entrada");
    check("[N5] 'não tenho entrada' SEM pergunta pendente: entrada=0 e NUNCA troca", n5.entrada === 0 && n5.possuiTroca === undefined, JSON.stringify(n5));
    const n6 = after(null, "vocês não aceitam carro na troca?");
    check("[N6] PERGUNTA do lead sobre troca não vira resposta", n6.possuiTroca === undefined, JSON.stringify(n6));
    const n7 = after("Já conhece a nossa loja?", "tem SUV automático?");
    check("[N7] pergunta nova do lead não resolve conheceLoja", n7.conheceLoja === undefined, JSON.stringify(n7));
    const n8 = after("Você tem algum carro para dar de troca?", "Não tenho carro pra troca\ntem SUV até 100 mil?");
    check("[N8] bloco misto: negação em STATEMENT segue válida (P0-1f preservado)", n8.possuiTroca === false, JSON.stringify(n8));
    const n9 = after("Você tem algum carro para dar de troca?", "Quero financiar ele mesmo\nMas não tenho entrada");
    check("[N9] resposta sobre financiamento/entrada NÃO vira possuiTroca=true mesmo com troca pendente", n9.entrada === 0 && n9.possuiTroca === undefined, JSON.stringify(n9));
    const n10 = after("Você tem algum carro para dar de troca?", "Sim");
    check("[N10] resposta booleana nua à troca continua válida", n10.possuiTroca === true, JSON.stringify(n10));
  }

  // ── [M] Mutações da LLM exigem proveniência (unit filterBrainSlotMutations) ──
  {
    const mk = (slot: string, value: unknown): DecisionMutation => ({ op: "set_slot", slot, value, confidence: 0.9, sourceTurnId: "t1" } as never);
    const f1 = filterBrainSlotMutations({ mutations: [mk("possuiTroca", false)], block: "Mas não tenho entrada", extractedSlots: new Set(["entrada"]), pendingSlot: null, understandingTrusted: true });
    check("[M1] LLM inventa possuiTroca=false sem proveniência -> DESCARTADA + observada", f1.kept.length === 0 && f1.dropped[0]?.reason === "no_provenance", JSON.stringify(f1.dropped));
    const f2 = filterBrainSlotMutations({ mutations: [mk("cidade", "Taubaté")], block: "sou de Taubaté", extractedSlots: new Set(), pendingSlot: null, understandingTrusted: true });
    check("[M2] valor presente no bloco -> aceita", f2.kept.length === 1, JSON.stringify(f2));
    const f3 = filterBrainSlotMutations({ mutations: [mk("cidade", "Taubaté")], block: "quero ver o carro", extractedSlots: new Set(), pendingSlot: null, understandingTrusted: true });
    check("[M3] valor AUSENTE do bloco -> descartada", f3.kept.length === 0, JSON.stringify(f3.dropped));
    const f4 = filterBrainSlotMutations({ mutations: [mk("entrada", 8000)], block: "tenho 8 mil de entrada", extractedSlots: new Set(), pendingSlot: null, understandingTrusted: false });
    check("[M4] understanding INVÁLIDO -> nenhuma mutação factual da LLM", f4.kept.length === 0 && f4.dropped[0]?.reason === "understanding_untrusted", JSON.stringify(f4.dropped));
    const f5 = filterBrainSlotMutations({ mutations: [mk("nome", "Douglas")], block: "meu nome é Douglas", extractedSlots: new Set(["nome"]), pendingSlot: null, understandingTrusted: true });
    check("[M5] extração já cobriu o slot -> a extração é a autoridade (mutação da LLM cai)", f5.kept.length === 0 && f5.dropped[0]?.reason === "extraction_authority", JSON.stringify(f5.dropped));
    const f6 = filterBrainSlotMutations({ mutations: [mk("possuiTroca", false)], block: "não", extractedSlots: new Set(), pendingSlot: "possuiTroca", understandingTrusted: true });
    check("[M6] resposta booleana curta à pergunta pendente -> aceita", f6.kept.length === 1, JSON.stringify(f6));
    const f7 = filterBrainSlotMutations({ mutations: [mk("interesse", "Douglas")], block: "Douglas", extractedSlots: new Set(["nome"]), pendingSlot: "nome", understandingTrusted: true });
    check("[M7] nome isolado nunca aterra interesse comercial", f7.kept.length === 0 && f7.dropped[0]?.reason === "no_provenance", JSON.stringify(f7.dropped));
  }

  // ── [S] Seleção canônica por token da última oferta ──
  {
    let st = createInitialState({ conversationId: "cs", tenantId: TENANT, agentId: AGENT, leadId: null, now: NOW });
    st = { ...st, lastRenderedOfferContext: { items: STOCK.map((v) => ({ vehicleKey: v.vehicleKey, marca: v.marca, modelo: v.modelo, ano: v.ano })), sourceTurnId: "t0", renderedAt: NOW, createdAt: NOW } } as unknown as ConversationState;
    const s1 = resolveSelectedVehicle("Gostei do Aircross", st, extractor);
    check("[S1] 'Gostei do Aircross' seleciona o C3 Aircross (token único)", s1?.key === "rm:aircross" && has(s1?.label ?? "", "C3 Aircross"), JSON.stringify(s1));
    const s2 = resolveSelectedVehicle("Gostei do Renegade", st, extractor);
    check("[S2] 2 Renegade na lista -> AMBÍGUO, não seleciona", s2 === null, JSON.stringify(s2));
    const s3 = resolveSelectedVehicle("gostei sim", st, extractor);
    check("[S3] sem token de modelo -> não seleciona", s3 === null, JSON.stringify(s3));
  }

  // ── [P] pushName: hint sanitizado inicializa lead_name; lixo nunca; declarado vence ──
  {
    const empty = createInitialState({ conversationId: "cp", tenantId: TENANT, agentId: AGENT, leadId: null, now: NOW });
    const p1 = buildCrmFields(empty, null, null, "Douglas Aloan");
    check("[P1] pushName REAL inicializa lead_name (nunca client_name)", p1.lead_name === "Douglas Aloan" && p1.client_name === undefined, JSON.stringify(p1));
    const p2 = buildCrmFields(empty, null, null, "🙂🙂");
    check("[P2] pushName lixo/emoji não entra", p2.lead_name === undefined, JSON.stringify(p2));
    const withName = { ...empty, slots: { ...empty.slots, nome: { status: "known", value: "Douglas" } } } as ConversationState;
    const p3 = buildCrmFields(withName, null, null, "Outro Nome Do Zap");
    check("[P3] nome DECLARADO vence o hint (client_name + lead_name = Douglas)", p3.client_name === "Douglas" && p3.lead_name === "Douglas", JSON.stringify(p3));
    check("[P4] placeholder de criação não é nome real (promovível)", !isRealLeadName("Contato WhatsApp • final 8777") && !isRealLeadName("Lead"), "");
  }

  // ── [C2] Codex rodada 2 — adversariais que os testes verdes não cobriam ──
  {
    const mk = (slot: string, value: unknown): DecisionMutation => ({ op: "set_slot", slot, value, confidence: 0.9, sourceTurnId: "t1" } as never);
    // P0-1a: objeto composto com UM campo no bloco NÃO valida o objeto inteiro (prova do Codex: Ferrari Roma).
    const c1 = filterBrainSlotMutations({ mutations: [mk("veiculoTroca", { marca: "Ferrari", modelo: "Roma", ano: 2020, km: 99000 })], block: "meu carro é 2020", extractedSlots: new Set(), pendingSlot: null, understandingTrusted: true });
    check("[C2-1] Ferrari Roma 99k com só '2020' no bloco -> DROPPED (campo a campo)", c1.kept.length === 0 && c1.dropped[0]?.reason === "no_provenance", JSON.stringify(c1.dropped));
    // P0-1b: objeto com TODOS os campos no bloco -> aceito.
    const c2 = filterBrainSlotMutations({ mutations: [mk("veiculoTroca", { modelo: "Hilux", ano: 2020 })], block: "tenho uma Hilux 2020 pra troca", extractedSlots: new Set(), pendingSlot: null, understandingTrusted: true });
    check("[C2-2] objeto com TODOS os campos no bloco -> aceito", c2.kept.length === 1, JSON.stringify(c2));
    // P0-1c: booleano NÃO nasce de menção ao objeto (prova do Codex: "aceito troca na compra").
    const c3 = filterBrainSlotMutations({ mutations: [mk("possuiTroca", true)], block: "aceito troca na compra", extractedSlots: new Set(), pendingSlot: null, understandingTrusted: true });
    check("[C2-3] 'aceito troca na compra' NÃO vira possuiTroca=true (booleano só via pergunta pendente)", c3.kept.length === 0, JSON.stringify(c3.dropped));
    // P0-1d: número inventado com o OBJETO presente ("tem entrada?") -> dropped (valor precisa estar no bloco).
    const c4 = filterBrainSlotMutations({ mutations: [mk("entrada", 5000)], block: "como funciona a entrada?", extractedSlots: new Set(), pendingSlot: null, understandingTrusted: true });
    check("[C2-4] entrada=5000 com só a palavra 'entrada' no bloco -> DROPPED", c4.kept.length === 0, JSON.stringify(c4.dropped));
    // P1: sanitização do pushName misto/comercial.
    check("[C2-5] 'Douglas 🚗' normaliza para 'Douglas'", sanitizeLeadNameHint("Douglas 🚗") === "Douglas", String(sanitizeLeadNameHint("Douglas 🚗")));
    check("[C2-6] nome COMERCIAL ('Icom Motors') rejeitado", sanitizeLeadNameHint("Icom Motors") === null && sanitizeLeadNameHint("Auto Center SP") === null, "");
    const empty2 = createInitialState({ conversationId: "cc2", tenantId: TENANT, agentId: AGENT, leadId: null, now: NOW });
    const f1 = buildCrmFields(empty2, null, null, "Douglas 🚗");
    check("[C2-7] hint misto entra NORMALIZADO no CRM (lead_name='Douglas')", f1.lead_name === "Douglas", JSON.stringify(f1));
    const f2 = buildCrmFields(empty2, null, null, "Icom Motors");
    check("[C2-8] hint comercial NÃO entra (placeholder promovível prevalece)", f2.lead_name === undefined, JSON.stringify(f2));
  }
  // ── [C2-R] decisão stale insistida 3× -> DESCARTADA INTEIRA (nunca renderiza) ──
  {
    const db = new FakeCrmDb();
    const c = convWired(db);
    await c.t("tem SUV automático?", searchSuv);
    let calls = 0;
    const tS = await c.t("Sim", () => { calls++; return finU([txt("RESPOSTA STALE QUE NAO PODE SAIR")], U("financing", "tem SUV automático?"), [{ op: "set_slot", slot: "entrada", value: 7777, confidence: 0.9, sourceTurnId: "x" } as never]); });
    check("[C2-R1] cérebro insistiu (>=3 chamadas) e a resposta stale NUNCA foi enviada", calls >= 3 && !tS.sentTexts.some((x) => has(x, "RESPOSTA STALE")), `calls=${calls} texts=${tS.sentTexts.join("|").slice(0, 80)}`);
    check("[C2-R2] mutação stale NÃO aplicada (entrada intacta)", slotVal(tS.state, "entrada") === undefined, String(slotVal(tS.state, "entrada")));
  }
  // ── [C2-D] pergunta DUPLA de ação -> deny -> reescrita ──
  {
    const db = new FakeCrmDb();
    const c = convWired(db);
    await c.t("tem SUV automático?", searchSuv);
    const tD = await c.t("Gostei do Aircross", () => finU([txt("Otima escolha! Quer ver as fotos dele ou prefere saber as condicoes?")], U("select_vehicle", "Gostei do Aircross", "select")));
    // RD1-2 (Codex #2): alternativa curta e relacionada do MESMO veiculo ("fotos ou condicoes dele?") eh NATURAL e PERMITIDA -> entregue (brain_final).
    check("[C2-D1] alternativa curta relacionada do MESMO veiculo eh ENTREGUE (brain_final, permitida)", tD.sentTexts.length > 0 && (tD.responseSource ?? "").startsWith("brain") && tD.sentTexts.some((x) => /fotos.*ou.*condi/i.test(x)), tD.sentTexts.join("|").slice(0, 100));
  }
  // ── [C2-H] promessa de consultor SEM efeito -> deny -> reescrita ──
  {
    const db = new FakeCrmDb();
    const c = convWired(db);
    // MISSÃO PII (invariantes 9/10): o deny de promessa-sem-efeito passou a guiar TRANSPARÊNCIA honesta
    // ("transferência NÃO pode ser executada… PROIBIDO condicionar a CPF") — o gatilho do script acompanha
    // o texto novo (comportamento protegido é o MESMO: deny dispara e a LLM reescreve sem promessa falsa).
    // ⭐DEGRAU 1 (2026-07-18): o gatilho casava a FRASE exata do deny e quebrava a cada melhoria de redação (já foi
    // reescrito uma vez pela missão PII, e de novo quando o feedback parou de ensinar "só transfere se o cliente pedir").
    // Agora casa o CONCEITO — qualquer deny cujo texto fale de transferência/encaminhar/consultor —, então o
    // comportamento protegido (deny dispara e a LLM reescreve SEM promessa falsa) segue coberto sem acoplar à palavra.
    const tH = await c.t("quero fechar negócio", (f, obs) => obs.some((o) => o.tool === "response" && !o.ok && /(transfer[êe]nci|encaminhar|consultor)/i.test((o as { error?: { message?: string } }).error?.message ?? ""))
      ? finU([txt("Perfeito! Vamos avançar: quer agendar uma visita para ver o carro de perto?")], U("other", "quero fechar negócio"))
      : finU([txt("Perfeito! Vou chamar nosso consultor agora para finalizar com você.")], U("other", "quero fechar negócio")));
    check("[C2-H1] promessa de consultor sem efeito REJEITADA e reescrita conduzindo", tH.sentTexts.length > 0 && !tH.sentTexts.some((x) => has(x, "consultor")) && tH.sentTexts.some((x) => has(x, "visita")), tH.sentTexts.join("|").slice(0, 100));
  }
  // ── [C2-F] despedida isolada: a LLM fecha; não reabre o funil ──
  {
    const db = new FakeCrmDb();
    const c = convWired(db);
    const tF = await c.t("obrigado!", () => finU([txt("Obrigado voce! Fico a disposicao.")], U("smalltalk", "obrigado!")));
    // RD1-2: a forma da despedida (encerrar sem pergunta, sem reabrir funil) eh ADVISORY (disengagementOnly). A LLM advertida encerra -> entregue (brain_final).
    check("[C2-F1] despedida: LLM encerra (brain_final) sem pergunta e sem reabrir funil", (tF.responseSource ?? "").startsWith("brain") && tF.sentTexts.length === 1 && !tF.sentTexts[0].includes("?") && !has(tF.sentTexts[0], "troca"), tF.sentTexts.join("|").slice(0, 100));
    const c2 = convWired(new FakeCrmDb());
    const tF2 = await c2.t("obrigado!", () => finU([txt("Obrigado pelo contato! Fico à disposição para dar continuidade quando precisar.")], U("smalltalk", "obrigado!")));
    check("[C2-F2] 'contato/continuidade' em despedida válida não vira coleta ou handoff", tF2.responseSource === "brain_final" && tF2.sentTexts.length === 1, tF2.sentTexts.join("|").slice(0, 100));
  }
  // ── [C2-PH] query de foto idêntica: uma execução real, retries bounded e mídia aterrada ──
  {
    const db = new FakeCrmDb();
    const c = convWired(db);
    await c.t("tem SUV automático?", searchSuv);
    await c.t("Gostei do Aircross", () => finU([txt("Ótima escolha! Quer que eu envie as fotos dele?")], U("select_vehicle", "Gostei do Aircross", "select")));
    const photoU = U("request_photos", "me manda fotos dele", "send_photos");
    const tP = await c.t("me manda fotos dele", () => qU({ tool: "vehicle_photos_resolve", input: { vehicleRef: { kind: "vehicle", key: AIRCROSS.vehicleKey } } }, photoU));
    const realPhotoResults = tP.observations.filter((o) => o.tool === "vehicle_photos_resolve" && o.ok).length;
    const duplicateFeedbacks = tP.observations.filter((o) => o.tool === "response" && !o.ok && (o as { error?: { code?: string } }).error?.code === "DUP_PHOTO_RESOLVE").length;
    check("[C2-PH1] photo resolve idêntica executa uma vez e o loop recebe cap", realPhotoResults === 1 && duplicateFeedbacks <= 2, `real=${realPhotoResults} dup=${duplicateFeedbacks}`);
    check("[C2-PH2] cérebro que nunca finaliza NÃO é substituído pela engine: zero mídia comercial fabricada", !tP.outbox.some((x) => x.kind === "send_media") && tP.responseSource === "technical_fallback", `source=${tP.responseSource}`);
  }
  // ── [C2-SC] a fala da LLM também respeita os slots; CRM seguro não basta ──
  {
    const db = new FakeCrmDb();
    const c = convWired(db);
    const tU = await c.t("certo", (_f, obs) => obs.some((o) => o.tool === "response" && !o.ok && /slot ainda est[aá] DESCONHECIDO/i.test((o as { error?: { message?: string } }).error?.message ?? ""))
      ? finU([txt("Certo! Como posso te ajudar agora?")], U("smalltalk", "certo"))
      : finU([txt("Anotei que você não tem carro para troca.")], U("other", "certo")));
    check("[C2-SC1] LLM não pode afirmar troca desconhecida; reautora sem inventar", tU.responseSource === "brain_retry" && !tU.sentTexts.some((x) => has(x, "não tem carro")), tU.sentTexts.join("|").slice(0, 100));
    await c.t("quero financiar", () => finU([txt("Você tem um valor para dar de entrada?")], U("financing", "quero financiar")));
    const tQ = await c.t("Não", (_f, obs) => obs.some((o) => o.tool === "response" && !o.ok && /SEM entrada/i.test((o as { error?: { message?: string } }).error?.message ?? ""))
      ? finU([txt("Entendi, seguimos sem entrada. Qual parcela caberia para você?")], U("financing", "Não"))
      : finU([txt("Anotei o valor de entrada. Tem algum carro para dar de troca?")], U("financing", "Não")));
    check("[C2-SC2] entrada=0 não pode ser narrada como entrada positiva mesmo antes de pergunta", tQ.responseSource === "brain_retry" && !tQ.sentTexts.some((x) => has(x, "anotei o valor de entrada")), tQ.sentTexts.join("|").slice(0, 100));
  }

  // ── [W] fonte única da pergunta de slot no texto do agente ──
  {
    check("[W1] entrada", questionSlotFromAgentText("Você tem um valor para dar de entrada?") === "entrada", "");
    check("[W2] nome", questionSlotFromAgentText("Para avançar com o financiamento, qual seu nome?") === "nome", "");
    check("[W3] troca", questionSlotFromAgentText("Você tem algum carro para dar de troca?") === "possuiTroca", "");
    check("[W4] statement não vira pergunta pendente", questionSlotFromAgentText("Anotado, parcela de até R$ 1.200.") === null, "");
  }
  // ── [U] retry pode reparar o ato de um aceite inequívoco sem liberar troca arbitrária de assunto ──
  {
    const wrong = U("select_vehicle", "Sim", "select");
    const repaired = U("request_photos", "Sim", "send_photos");
    check("[U1] aceite de foto permite corrigir intent/capability no retry", reconcileUnderstanding(wrong, repaired, "Sim", { acceptedPhotoOffer: true }).primaryIntent === "request_photos", "");
    check("[U2] sem sinal contextual, trava de assunto continua fail-closed", reconcileUnderstanding(wrong, repaired, "Sim").primaryIntent === "select_vehicle", "");
    check("[U3] feedback de resposta permite a mesma LLM corrigir o understanding", reconcileUnderstanding(wrong, repaired, "Sim", { allowCurrentEvidenceCorrection: true }).primaryIntent === "request_photos", "");
  }

  console.log(`\n== F2.48: ${ok} OK | ${fail} FALHA ==`);
  if (fail > 0) { for (const f of fails) console.error(`  FALHA: ${f}`); process.exit(1); }
}

main().catch((error) => { console.error(error); process.exit(1); });
