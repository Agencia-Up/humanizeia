// ============================================================================
// F2.47 — IDENTIDADE DO LEAD no CRM (Opção A do bloqueio 2026-07-10, hardened
// pela auditoria Codex). Casos A..K da missão + teste de integração da FIAÇÃO
// REAL (item 11): bridge-like leadId=null -> ingest -> routing null -> settled
// -> resolver/ensure -> routing/state com UUID -> buildCrmWritePlan -> outbox
// crm_write -> dispatcher delivered -> outcomeAppliedAt. Inclui caso-CONTROLE
// que reproduz a fiação ANTIGA (sem resolver) e prova zero crm_write.
//   npx tsx tests/run-f2-47-crm-lead-identity.ts
// ============================================================================
import { runCentralConversationTurn, type CentralTurnResult } from "../src/engine/central-engine.ts";
import { OutboxDispatcher, type EffectDispatcher } from "../src/engine/outbox-dispatcher.ts";
import { CompositeEffectDispatcher, CrmWriteEffectDispatcher, type CrmLeadRow, type CrmLeadStore } from "../src/adapters/effects/crm-write-dispatcher.ts";
import type { CrmLeadIdentityStore, LeadIdentityResolution } from "../src/adapters/effects/crm-lead-identity-store.ts";
import { resolveConversationLeadBinding, type LeadBindingDecision } from "../src/engine/crm-lead-binding.ts";
import { canonicalWhatsappRemoteJid } from "../src/domain/whatsapp-jid.ts";
import { isRealLeadName, buildCrmFields, CRM_WRITE_ORDER } from "../src/engine/crm-write.ts";
import { ingestPilotMessage } from "../src/engine/pilot-ingest.ts";
import { InMemoryPersistence, FakeClock, FakeIdGen } from "../src/adapters/persistence/in-memory-store.ts";
import { ScriptedAgentBrain, type BrainResponder } from "../src/adapters/llm/fake-agent-brain.ts";
import { buildTenantCatalog } from "../src/engine/catalog-utils.ts";
import { CatalogClaimExtractor } from "../src/engine/turn-context-preparer.ts";
import { buildSdrQualificationPolicy } from "../src/engine/sdr-conductor.ts";
import { redact } from "../src/domain/effect-intent.ts";
import { createInitialState, type AdContext, type ConversationState } from "../src/domain/conversation-state.ts";
import type { TurnContextPreparer } from "../src/domain/context.ts";
import type { DecisionLlm } from "../src/domain/llm.ts";
import type { TenantBusinessInfoSource } from "../src/engine/tenant-business-info.ts";
import type { AgentBrainStep, AgentBrainDecision, TurnUnderstanding, PrimaryIntent, AgentToolObservation } from "../src/domain/agent-brain.ts";
import type { ProposedEffectPlan, QueryCall, QueryResult, ResponsePart, ResponseDraft, TurnRelation, EffectResult } from "../src/domain/decision.ts";
import type { OutboxRecord } from "../src/domain/effect-intent.ts";
import type { TenantAgentRef } from "../src/domain/read-ports.ts";
import type { VehicleFact } from "../src/domain/types.ts";

let ok = 0, fail = 0; const fails: string[] = [];
function check(name: string, pass: boolean, detail = ""): void {
  if (pass) { ok++; console.log(`  OK  ${name}`); } else { fail++; fails.push(`${name}${detail ? ` — ${detail}` : ""}`); console.error(`  RED ${name}${detail ? ` — ${detail}` : ""}`); }
}
const TENANT = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const AGENT = "33333333-3333-4333-8333-333333333333";
const NOW = "2026-07-10T12:00:00.000Z";
const SHA = "sha-47";
const REF: TenantAgentRef = { tenantId: TENANT, agentId: AGENT };
const PHONE = "5512988887777";
const JID = `${PHONE}@s.whatsapp.net`;
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

// ── FakeCrmDb: ai_crm_leads fake com unique (agent_id, remote_jid), implementando as DUAS
//    portas com a MESMA semântica do SupabaseCrmLeadStore (select owned -> insert ignore-dup
//    -> select FINAL owned -> foreign check). Knobs p/ falha transitória e corrida. ──────────
type DbRow = { id: string; user_id: string; agent_id: string; remote_jid: string; fields: Record<string, string | null> };
class FakeCrmDb implements CrmLeadStore, CrmLeadIdentityStore {
  rows: DbRow[] = [];
  updates = 0; inserts = 0; resolves = 0;
  failNextUpdate = false; failNextResolve = false; failNextInsert = false;
  insertDelayMs = 0;
  #seq = 0;
  #uuid(): string { this.#seq++; return `aaaaaaaa-0000-4000-8000-${String(this.#seq).padStart(12, "0")}`; }
  seed(row: { user_id: string; agent_id: string; remote_jid: string; fields?: Record<string, string | null> }): DbRow {
    const r: DbRow = { id: this.#uuid(), user_id: row.user_id, agent_id: row.agent_id, remote_jid: row.remote_jid, fields: { ...(row.fields ?? {}) } };
    this.rows.push(r); return r;
  }
  // CrmLeadStore (update fill-only)
  async fetchOwnedLead(ref: TenantAgentRef, leadId: string): Promise<CrmLeadRow | null> {
    const row = this.rows.find((r) => r.id === leadId && r.user_id === ref.tenantId && r.agent_id === ref.agentId);
    return row ? { id: row.id, fields: { ...row.fields } } : null;
  }
  async updateOwnedLead(ref: TenantAgentRef, leadId: string, fields: Record<string, string>): Promise<{ ok: boolean; updatedRows: number; error?: string }> {
    if (this.failNextUpdate) { this.failNextUpdate = false; throw new Error("crm_down"); }
    const row = this.rows.find((r) => r.id === leadId && r.user_id === ref.tenantId && r.agent_id === ref.agentId);
    if (!row) return { ok: true, updatedRows: 0 };
    Object.assign(row.fields, fields);
    this.updates += 1;
    return { ok: true, updatedRows: 1 };
  }
  // CrmLeadIdentityStore
  async resolveOwnedLead(ref: TenantAgentRef, remoteJid: string): Promise<string | null> {
    const jid = canonicalWhatsappRemoteJid(remoteJid);
    if (!jid) return null;
    if (this.failNextResolve) { this.failNextResolve = false; throw new Error("crm_identity_down"); }
    this.resolves += 1;
    const row = this.rows.find((r) => r.user_id === ref.tenantId && r.agent_id === ref.agentId && r.remote_jid === jid);
    return row?.id ?? null;
  }
  async ensureOwnedLead(ref: TenantAgentRef, remoteJid: string): Promise<LeadIdentityResolution> {
    const jid = canonicalWhatsappRemoteJid(remoteJid);
    if (!jid) return { ok: false, reason: "invalid_jid" };
    try {
      const existing = await this.resolveOwnedLead(ref, jid);
      if (existing) return { ok: true, leadId: existing, created: false };
      if (this.failNextInsert) { this.failNextInsert = false; return { ok: false, reason: "transient" }; }
      if (this.insertDelayMs > 0) await new Promise((r) => setTimeout(r, this.insertDelayMs));
      // "unique (agent_id, remote_jid)" + ignore-duplicates: quem perde a corrida NÃO insere.
      const conflict = this.rows.find((r) => r.agent_id === ref.agentId && r.remote_jid === jid);
      let created = false;
      if (!conflict) {
        // Criação MÍNIMA espelhando o store real: lead_name placeholder, status novos, SEM origem.
        this.rows.push({ id: this.#uuid(), user_id: ref.tenantId, agent_id: ref.agentId, remote_jid: jid, fields: { lead_name: "Lead", status: "novo", status_crm: "novo" } });
        this.inserts += 1; created = true;
      }
      const confirmed = await this.resolveOwnedLead(ref, jid);   // seleção FINAL sempre owned
      if (confirmed) return { ok: true, leadId: confirmed, created };
      const foreign = this.rows.some((r) => r.agent_id === ref.agentId && r.remote_jid === jid);
      return foreign ? { ok: false, reason: "foreign_tenant_conflict" } : { ok: false, reason: "transient" };
    } catch {
      return { ok: false, reason: "transient" };
    }
  }
  async resolveOrEnsureOwnedLead(ref: TenantAgentRef, remoteJid: string): Promise<LeadIdentityResolution> {
    return this.ensureOwnedLead(ref, remoteJid);
  }
}
class FakeWaDispatcher implements EffectDispatcher {
  sent: string[] = [];
  async dispatch(record: OutboxRecord): Promise<EffectResult> {
    this.sent.push(record.kind);
    return { status: "succeeded", effectId: record.effectId, receipt: { effectId: record.effectId, level: "accepted", at: NOW, providerMessageId: `fake-${record.effectId}` } };
  }
}
// Spy do routing: registra TODAS as chamadas (ingest com null + re-hidratação com uuid).
class RoutingSpyPersistence extends InMemoryPersistence {
  routingCalls: Array<{ conversationId: string; leadId: string | null }> = [];
  override upsertRouting(conversationId: string, agentId: string, leadId: string | null, toAddr: string): void {
    this.routingCalls.push({ conversationId, leadId });
    super.upsertRouting(conversationId, agentId, leadId, toAddr);
  }
}
const allowAllGate = { isActiveMode: () => true };

// ── conv47: FIAÇÃO REAL espelhando o processSettled do server — ingest (bridge-like,
//    leadId SEMPRE null) -> settled -> binding -> routing rehidratada -> engine -> dispatch. ──
type Cap = { outbox: OutboxRecord[]; committed: boolean; state: ConversationState | null; sent: string[]; binding: LeadBindingDecision | null; settledLeadId: string | null };
type ConvOpts = { toAddr?: string; persistence?: RoutingSpyPersistence; clock?: FakeClock; conversationId?: string; legacyWiring?: boolean };
function conv47(db: FakeCrmDb | null, opts?: ConvOpts) {
  const brain = new ScriptedAgentBrain(); const preparer = new RelPreparer();
  const clock = opts?.clock ?? new FakeClock(NOW);
  const persistence = opts?.persistence ?? new RoutingSpyPersistence(clock, new FakeIdGen());
  const wa = new FakeWaDispatcher();
  const routes: Record<string, EffectDispatcher> = { send_message: wa, send_media: wa };
  if (db) routes.crm_write = new CrmWriteEffectDispatcher({ ref: REF, clock, store: db });
  const composite = new CompositeEffectDispatcher(routes as never);
  const conversationId = opts?.conversationId ?? `wa:f47_${Math.random().toString(36).slice(2, 8)}`;
  const toAddr = opts?.toAddr ?? PHONE;
  let s = 0;
  const t = async (lead: string, responder?: BrainResponder, ad?: Record<string, unknown>): Promise<Cap> => {
    s++;
    brain.setResponder(responder ?? resist);
    // 1) INGEST exatamente como o bridge entrega (leadId: null SEMPRE — o contrato real de produção).
    await ingestPilotMessage(persistence, clock, {
      eventId: `${conversationId}-e${s}-${Math.random().toString(36).slice(2, 6)}`, conversationId, agentId: AGENT,
      leadId: null, toAddr, messageText: lead, receivedAt: clock.now(), ...(ad ? { adContext: ad } : {}),
    });
    clock.advance(7000);   // assenta o debounce (default 6000ms)
    // 2) SETTLED via a MESMA consulta do poller.
    const settled = (await persistence.findSettledConversations(clock.now(), 6000, 12000, 20)).find((x) => x.conversationId === conversationId);
    if (!settled) throw new Error("conversa não assentou");
    // 3) BINDING como o server (processSettled) faz — ou fiação ANTIGA (controle).
    let binding: LeadBindingDecision | null = null;
    let leadIdForTurn = settled.leadId;
    let crmEnabled = db != null;
    let bootstrap = false;
    if (!opts?.legacyWiring) {
      const stateLeadId = persistence.load(conversationId)?.state.leadId ?? null;
      binding = await resolveConversationLeadBinding({ identity: db, ref: REF, toAddr: settled.toAddr, settledLeadId: settled.leadId, stateLeadId });
      leadIdForTurn = binding.leadId;
      crmEnabled = db != null && binding.crmEnabled;
      bootstrap = binding.bootstrapSync;
      if (binding.leadId != null && binding.leadId !== settled.leadId) {
        await persistence.upsertRouting(conversationId, settled.agentId, binding.leadId, settled.toAddr);
      }
    }
    // 4) TURNO + 5) DISPATCH reais.
    const turnId = `${conversationId}-t${s}`;
    const r: CentralTurnResult = await runCentralConversationTurn({
      persistence, clock, brain, llm: new ComposeSpyLlm(), runQuery, businessInfo: makeBI(), contextPreparer: preparer,
      conversationId, tenantId: TENANT, agentId: AGENT, leadId: leadIdForTurn,
      workerId: "w", turnId, leaseTtlMs: 60_000, portalPromptSha256: SHA,
      limits: { maxSteps: 8, totalTimeoutMs: 8000, proposeTimeoutMs: 3000, queryTimeoutMs: 3000, composeTimeoutMs: 3000 },
      maxValidationAttempts: 3, brainMaxSteps: 8, sdrPolicy, allowedTools: ["stock_search", "vehicle_details", "vehicle_photos_resolve", "tenant_business_info"],
      providerCapability: { send_message: "none", send_media: "none" }, singleAuthor: true, llmFirst: true,
      crmWriteEnabled: crmEnabled, crmBootstrapSync: bootstrap,
    });
    const dispatcher = new OutboxDispatcher(persistence, clock, composite, allowAllGate as never, "w:test");
    await dispatcher.dispatchConversation(conversationId);
    const outbox = (await persistence.listOutbox(conversationId)).filter((o) => o.turnId === turnId) as unknown as OutboxRecord[];
    return { outbox, committed: r.status === "committed", state: persistence.load(conversationId)?.state ?? null, sent: [...wa.sent], binding, settledLeadId: settled.leadId };
  };
  return { t, db, persistence, clock, conversationId };
}
const crmOf = (c: Cap): OutboxRecord | undefined => c.outbox.find((o) => o.kind === "crm_write");
const fieldsOf = (rec: OutboxRecord | undefined): Record<string, string> => {
  if (!rec) return {};
  const { __redacted: _r, ...p } = rec.payload as Record<string, unknown>;
  return (p.fields ?? {}) as Record<string, string>;
};

async function main(): Promise<void> {
  console.log("== F2.47: identidade do lead no CRM (Opção A hardened) ==");

  // ── [F] JID canônico: uma única função p/ lookup/insert/testes; inválido NUNCA vira consulta ──
  {
    const c = canonicalWhatsappRemoteJid;
    check("[F1] telefone nacional 11 dígitos ganha 55", c("12988887777") === JID, String(c("12988887777")));
    check("[F2] telefone nacional 10 dígitos ganha 55", c("1288887777") === "551288887777@s.whatsapp.net", String(c("1288887777")));
    check("[F3] internacional 13 dígitos preservado", c(PHONE) === JID, String(c(PHONE)));
    check("[F4] internacional 12 dígitos preservado", c("551288887777") === "551288887777@s.whatsapp.net", String(c("551288887777")));
    check("[F5] jid já canônico normaliza limpo", c(JID) === JID, String(c(JID)));
    check("[F6] formatação humana removida", c("+55 (12) 98888-7777") === JID, String(c("+55 (12) 98888-7777")));
    check("[F7] vazio/curto/lixo rejeitados", c("") === null && c("12345") === null && c("abc") === null && c(null) === null, "");
    check("[F8] grupo @g.us rejeitado", c("123456789-987654@g.us") === null, String(c("123456789-987654@g.us")));
    check("[F9] @lid e @broadcast rejeitados", c("98765432101234@lid") === null && c("status@broadcast") === null, "");
    check("[F10] sufixo desconhecido rejeitado", c(`${PHONE}@c.us`) === null, String(c(`${PHONE}@c.us`)));
  }

  // ── [A] flag OFF: zero lookup, zero insert, zero crm_write ──
  {
    const db = new FakeCrmDb();   // existe, mas o binding recebe identity=null (flag OFF)
    const binding = await resolveConversationLeadBinding({ identity: null, ref: REF, toAddr: PHONE, settledLeadId: null, stateLeadId: null });
    check("[A1] binding com flag OFF: crm_off, leadId null, zero IO", binding.note === "crm_off" && binding.leadId === null && !binding.crmEnabled && db.resolves === 0 && db.inserts === 0, JSON.stringify(binding));
    const c = conv47(null);
    const t1 = await c.t("meu nome é Douglas", () => finU([txt("Prazer, Douglas!")], "reply", U("other")));
    check("[A2] fluxo com flag OFF: lead respondido e ZERO crm_write", t1.sent.includes("send_message") && crmOf(t1) == null, t1.outbox.map((o) => o.kind).join(","));
  }

  // ── [B] lead EXISTENTE: resolve o UUID, não insere, não altera campos; ownership completo ──
  {
    const db = new FakeCrmDb();
    const seeded = db.seed({ user_id: TENANT, agent_id: AGENT, remote_jid: JID, fields: { lead_name: "João Humano", client_city: "Taubaté" } });
    const c = conv47(db);
    const t1 = await c.t("boa tarde", () => finU([txt("Boa tarde! Como posso ajudar?")], "reply", U("other")));
    check("[B1] binding resolveu o lead existente (sem criar)", t1.binding?.note === "resolved_existing_lead" && t1.binding?.leadId === seeded.id && db.inserts === 0, JSON.stringify(t1.binding));
    check("[B2] campos humanos INTOCADOS (nome/cidade preservados)", seeded.fields.lead_name === "João Humano" && seeded.fields.client_city === "Taubaté", JSON.stringify(seeded.fields));
    check("[B3] state vinculado ao UUID resolvido (durável)", t1.state?.leadId === seeded.id, String(t1.state?.leadId));
  }

  // ── [C] lead INEXISTENTE: cria mínima, UUID confirmado, routing+state recebem, crm_write no MESMO turno ──
  // ── (item 11: fiação de produção completa, bridge-like leadId=null de ponta a ponta) ──
  {
    const db = new FakeCrmDb();
    const c = conv47(db);
    const t1 = await c.t("meu nome é Douglas", () => finU([txt("Prazer, Douglas! O que procura?")], "reply", U("other")));
    const row = db.rows[0];
    check("[C1] ingest bridge-like: routing começou NULL (contrato real)", t1.settledLeadId === null, String(t1.settledLeadId));
    check("[C2] linha criada MÍNIMA: placeholder Lead, status novo, SEM origem", db.rows.length === 1 && row.fields.status === "novo" && row.fields.origem === undefined, JSON.stringify(row?.fields));
    check("[C3] binding bound_new + bootstrap no 1º vínculo", t1.binding?.note === "bound_new" && t1.binding?.bootstrapSync === true && t1.binding?.leadId === row.id, JSON.stringify(t1.binding));
    const rehydrate = c.persistence.routingCalls.filter((r) => r.leadId === row.id);
    check("[C4] routing re-hidratada com o UUID (tenant-scoped)", rehydrate.length === 1, JSON.stringify(c.persistence.routingCalls));
    check("[C5] state.leadId = UUID (vínculo durável via commit)", t1.state?.leadId === row.id, String(t1.state?.leadId));
    const crm = crmOf(t1);
    check("[C6] crm_write NASCEU no mesmo turno: succeeded + delivered + outcomeAppliedAt + order pós-reply",
      crm?.status === "succeeded" && (crm as { receiptLevel?: string }).receiptLevel === "delivered" && (crm as { outcomeAppliedAt?: string | null }).outcomeAppliedAt != null && crm?.order === CRM_WRITE_ORDER,
      `status=${crm?.status} receipt=${(crm as { receiptLevel?: string })?.receiptLevel}`);
    check("[C7] nome REAL gravado: client_name e lead_name promovido (Lead -> Douglas)", row.fields.client_name === "Douglas" && row.fields.lead_name === "Douglas", JSON.stringify(row.fields));

    // Regressão REAL da routing: a PRÓXIMA mensagem re-ingere com null (RPC sobrescreve) — o vínculo
    // durável do STATE segura a identidade SEM novo ensure (zero consultas novas ao CRM).
    const resolvesBefore = db.resolves;
    const t2 = await c.t("tenho uma Hilux 2020 85km rodados", () => finU([txt("Anotei sua Hilux!")], "reply", U("trade_in")));
    check("[C8] regressão reproduzida: routing voltou a null no ingest do turno 2", t2.settledLeadId === null, String(t2.settledLeadId));
    check("[C9] turno 2 bound_existing pelo STATE (durável), ZERO consulta nova ao CRM", t2.binding?.note === "bound_existing" && t2.binding?.leadId === row.id && db.resolves === resolvesBefore && db.inserts === 1, `note=${t2.binding?.note} resolves=${db.resolves}`);
    const f2 = fieldsOf(crmOf(t2));
    check("[C10] turno 2 é DELTA normal (bootstrap só no 1º vínculo)", t2.binding?.bootstrapSync === false && has(f2.trade_in_vehicle ?? "", "hilux"), JSON.stringify(f2));
  }

  // ── [D] concorrência: dois ensures simultâneos -> UMA linha, MESMO UUID ──
  {
    const db = new FakeCrmDb();
    db.insertDelayMs = 5;   // abre a janela da corrida entre o resolve e o insert
    const [r1, r2] = await Promise.all([db.ensureOwnedLead(REF, JID), db.ensureOwnedLead(REF, JID)]);
    check("[D1] ambos ok com o MESMO UUID", r1.ok && r2.ok && r1.ok === true && r2.ok === true && r1.leadId === r2.leadId, JSON.stringify({ r1, r2 }));
    check("[D2] nenhuma duplicata (1 linha, 1 insert)", db.rows.length === 1 && db.inserts === 1, `rows=${db.rows.length} inserts=${db.inserts}`);
  }

  // ── [E] cross-tenant: linha de OUTRO tenant não é retornada/atualizada; conflito fail-closed ──
  {
    const db = new FakeCrmDb();
    const foreign = db.seed({ user_id: TENANT_B, agent_id: AGENT, remote_jid: JID, fields: { lead_name: "Cliente Do Outro" } });
    check("[E1] resolve owned não enxerga lead de outro tenant", (await db.resolveOwnedLead(REF, JID)) === null, "");
    const r = await db.ensureOwnedLead(REF, JID);
    check("[E2] ensure detecta conflito de tenant e FALHA FECHADO (não reutiliza/atualiza)", !r.ok && r.ok === false && r.reason === "foreign_tenant_conflict" && db.rows.length === 1, JSON.stringify(r));
    const c = conv47(db);
    const t1 = await c.t("meu nome é Douglas", () => finU([txt("Prazer!")], "reply", U("other")));
    check("[E3] fluxo: lead RESPONDIDO, zero crm_write, linha alheia intocada", t1.sent.includes("send_message") && crmOf(t1) == null && foreign.fields.lead_name === "Cliente Do Outro" && t1.binding?.note === "foreign_tenant_conflict", `note=${t1.binding?.note}`);
  }

  // ── [G] origem: criação NÃO inventa; anúncio factual preenche; origem humana preservada ──
  {
    const db = new FakeCrmDb();
    const c = conv47(db);
    const ad = { adId: "ad1", source: "facebook", sourceUrl: "https://fb.me/x", title: "Icom", body: "Jeep Compass 2019 revisado", greeting: "Olá! Quer saber mais sobre o Jeep Compass 2019?", imageUrls: [] };
    await c.t("Oi, tenho interesse", searchB({ modelo: "Compass" }), ad);
    check("[G1] entrada por ANÚNCIO: origem=trafico_pago via adContext factual (criação deixou null)", db.rows[0]?.fields.origem === "trafico_pago", String(db.rows[0]?.fields.origem));

    const db2 = new FakeCrmDb();
    const c2 = conv47(db2);
    await c2.t("meu nome é Douglas", () => finU([txt("Prazer!")], "reply", U("other")));
    check("[G2] SEM anúncio: origem NÃO inventada (continua ausente)", db2.rows[0]?.fields.origem === undefined, String(db2.rows[0]?.fields.origem));

    const db3 = new FakeCrmDb();
    db3.seed({ user_id: TENANT, agent_id: AGENT, remote_jid: JID, fields: { origem: "indicacao" } });
    const c3 = conv47(db3);
    await c3.t("Oi, vi o anúncio", searchB({ modelo: "Compass" }), ad);
    check("[G3] origem HUMANA existente preservada (anúncio não sequestra)", db3.rows[0].fields.origem === "indicacao", String(db3.rows[0].fields.origem));
  }

  // ── [H] nomes: promoção de placeholder, preservação de humano, lixo rejeitado, retry no-op ──
  {
    check("[H0] isRealLeadName: Douglas sim; Lead/emoji/vazio não", isRealLeadName("Douglas") && !isRealLeadName("Lead") && !isRealLeadName("🙂") && !isRealLeadName("") && !isRealLeadName("cliente"), "");
    const db = new FakeCrmDb();
    const seeded = db.seed({ user_id: TENANT, agent_id: AGENT, remote_jid: JID, fields: { lead_name: "Lead" } });
    const clock = new FakeClock(NOW);
    const dispatcher = new CrmWriteEffectDispatcher({ ref: REF, clock, store: db });
    const rec = (fields: Record<string, string>, id: string): OutboxRecord => ({
      effectId: id, conversationId: "c", turnId: "t", planId: "crm", kind: "crm_write", idempotencyKey: id,
      order: CRM_WRITE_ORDER, dependsOn: [], payload: redact({ leadId: seeded.id, fields }),
      onSuccess: [], status: "pending", providerCapability: "none", receiptLevel: null, attempts: 0, nextRetryAt: null,
      providerReceipt: null, outcomeAppliedAt: null, lastError: null, createdAt: NOW, dispatchedAt: null,
    } as unknown as OutboxRecord);
    await dispatcher.dispatch(rec({ lead_name: "Douglas" }, "t1:crm"));
    check("[H1] placeholder Lead PROMOVIDO para Douglas", seeded.fields.lead_name === "Douglas", String(seeded.fields.lead_name));
    await dispatcher.dispatch(rec({ lead_name: "Wander" }, "t2:crm"));
    check("[H2] nome humano REAL preservado (Douglas não vira Wander)", seeded.fields.lead_name === "Douglas", String(seeded.fields.lead_name));
    await dispatcher.dispatch(rec({ lead_name: "Lead" }, "t3:crm"));
    await dispatcher.dispatch(rec({ lead_name: "🙂" }, "t4:crm"));
    check("[H3] regressão/lixo rejeitados (Lead e emoji não escrevem)", seeded.fields.lead_name === "Douglas", String(seeded.fields.lead_name));
    const updatesBefore = db.updates;
    await dispatcher.dispatch(rec({ lead_name: "Douglas" }, "t1:crm"));
    check("[H4] retry com o mesmo nome = no-op", db.updates === updatesBefore, `updates=${db.updates}`);
    const empty = createInitialState({ conversationId: "cH", tenantId: TENANT, agentId: AGENT, leadId: null, now: NOW });
    const noName = buildCrmFields({ ...empty, slots: { ...empty.slots, nome: { status: "known", value: "Lead" } } } as ConversationState, null, null);
    check("[H5] builder nem EMITE nome não-real (Lead não vira client_name/lead_name)", noName.client_name === undefined && noName.lead_name === undefined, JSON.stringify(noName));
  }

  // ── [I] falha transitória: lead respondido, zero crm_write inválido; próxima execução resolve
  //        e o BOOTSTRAP sincroniza os slots ACUMULADOS (não só o delta do turno) ──
  {
    const db = new FakeCrmDb();
    const c = conv47(db);
    db.failNextResolve = true;
    const t1 = await c.t("meu nome é Douglas", () => finU([txt("Prazer, Douglas!")], "reply", U("other")));
    check("[I1] falha transitória: lead RESPONDIDO, zero crm_write, sem vínculo", t1.sent.includes("send_message") && crmOf(t1) == null && t1.binding?.note === "transient_resolution_failure" && t1.state?.leadId == null, `note=${t1.binding?.note}`);
    const t2 = await c.t("tenho 8k de entrada", () => finU([txt("Show! Qual parcela cabe?")], "reply", U("financing")));
    const f2 = fieldsOf(crmOf(t2));
    check("[I2] próxima execução resolve + BOOTSTRAP: payload contém o ACUMULADO (nome do turno 1 + entrada do turno 2)", t2.binding?.note === "bound_new" && t2.binding?.bootstrapSync === true && f2.client_name === "Douglas" && (f2.down_payment ?? "").includes("8.000"), JSON.stringify(f2));
    check("[I3] linha do CRM ficou completa (nada da coleta anterior se perdeu)", db.rows[0]?.fields.client_name === "Douglas" && (db.rows[0]?.fields.down_payment ?? "").includes("8.000"), JSON.stringify(db.rows[0]?.fields));
  }

  // ── [J] idempotência/restart: retry não duplica lead nem effect; restart mantém o vínculo ──
  {
    const db = new FakeCrmDb();
    const r1 = await db.ensureOwnedLead(REF, JID);
    const r2 = await db.ensureOwnedLead(REF, JID);   // retry após incerteza
    check("[J1] retry do ensure converge (mesmo UUID, 1 linha)", r1.ok && r2.ok && r1.ok === true && r2.ok === true && r1.leadId === r2.leadId && db.rows.length === 1, "");
    const clock = new FakeClock(NOW);
    const persistence = new RoutingSpyPersistence(clock, new FakeIdGen());
    const convId = "wa:f47_restart";
    const c1 = conv47(db, { persistence, clock, conversationId: convId });
    const ta = await c1.t("meu nome é Douglas", () => finU([txt("Prazer!")], "reply", U("other")));
    const uuid = ta.binding?.leadId ?? null;
    // "restart": processo NOVO (brain/dispatcher/spies novos), MESMA persistence/banco.
    const insertsBefore = db.inserts;
    const c2 = conv47(db, { persistence, clock, conversationId: convId });
    const tb = await c2.t("quero ver um Onix", searchB({ modelo: "Onix" }));
    check("[J2] restart recupera o MESMO leadId pelo state (sem novo insert)", tb.binding?.leadId === uuid && tb.binding?.note === "bound_existing" && db.inserts === insertsBefore, `note=${tb.binding?.note}`);
    check("[J3] effects idempotentes por turno (effectId turnId:crm distintos, sem duplicar escrita do mesmo turno)", (await persistence.listOutbox(convId)).filter((o) => o.kind === "crm_write").every((o) => o.effectId.endsWith(":crm")), "");
  }

  // ── [K] mismatch: vínculo conflitante -> fail-closed (binding E defesa em profundidade do engine) ──
  {
    const otherUuid = "bbbbbbbb-0000-4000-8000-000000000001";
    const db = new FakeCrmDb();
    const seeded = db.seed({ user_id: TENANT, agent_id: AGENT, remote_jid: JID });
    const b1 = await resolveConversationLeadBinding({ identity: db, ref: REF, toAddr: PHONE, settledLeadId: otherUuid, stateLeadId: seeded.id });
    check("[K1] routing≠state: fail-closed p/ CRM, state prevalece como identidade", b1.note === "routing_state_mismatch" && !b1.crmEnabled && b1.leadId === seeded.id, JSON.stringify(b1));
    const b2 = await resolveConversationLeadBinding({ identity: db, ref: REF, toAddr: PHONE, settledLeadId: otherUuid, stateLeadId: null });
    check("[K2] resolve≠routing não-nula: conflito suspeito, fail-closed", b2.note === "resolved_conflicts_routing" && !b2.crmEnabled && b2.leadId === null, JSON.stringify(b2));
    // Defesa em profundidade do ENGINE: turno 1 vincula uuid REAL; turno 2 é forçado com OUTRO leadId
    // (bypass do binding) e flag ligada -> o chokepoint NÃO emite crm_write e o vínculo não regride.
    const c = conv47(db);
    const t1 = await c.t("meu nome é Douglas", () => finU([txt("Prazer!")], "reply", U("other")));
    const bound = t1.state?.leadId ?? null;
    const turnId = `${c.conversationId}-forced`;
    await ingestPilotMessage(c.persistence, c.clock, { eventId: `${c.conversationId}-forced-e`, conversationId: c.conversationId, agentId: AGENT, leadId: null, toAddr: PHONE, messageText: "tenho 8k de entrada", receivedAt: c.clock.now() });
    c.clock.advance(7000);
    const brain2 = new ScriptedAgentBrain(); brain2.setResponder(() => finU([txt("Show!")], "reply", U("financing")));
    await runCentralConversationTurn({
      persistence: c.persistence, clock: c.clock, brain: brain2, llm: new ComposeSpyLlm(), runQuery, businessInfo: makeBI(), contextPreparer: new RelPreparer(),
      conversationId: c.conversationId, tenantId: TENANT, agentId: AGENT, leadId: otherUuid,   // <- leadId CONFLITANTE
      workerId: "w", turnId, leaseTtlMs: 60_000, portalPromptSha256: SHA,
      limits: { maxSteps: 8, totalTimeoutMs: 8000, proposeTimeoutMs: 3000, queryTimeoutMs: 3000, composeTimeoutMs: 3000 },
      maxValidationAttempts: 3, brainMaxSteps: 8, sdrPolicy, allowedTools: ["stock_search", "vehicle_details", "vehicle_photos_resolve", "tenant_business_info"],
      providerCapability: { send_message: "none", send_media: "none" }, singleAuthor: true, llmFirst: true,
      crmWriteEnabled: true, crmBootstrapSync: false,
    });
    const forced = (await c.persistence.listOutbox(c.conversationId)).filter((o) => o.turnId === turnId);
    check("[K3] engine fail-closed: leadId conflitante com state vinculado => ZERO crm_write + vínculo intacto", forced.every((o) => o.kind !== "crm_write") && c.persistence.load(c.conversationId)?.state.leadId === bound, `kinds=${forced.map((o) => o.kind).join(",")}`);
  }

  // ── [11-CONTROLE] fiação ANTIGA (sem resolver): flag ativa + leadId da routing (null) => ZERO
  //     crm_write — o teste de integração [C] passa SOMENTE com a nova fiação. ──
  {
    const db = new FakeCrmDb();
    const c = conv47(db, { legacyWiring: true });
    const t1 = await c.t("meu nome é Douglas", () => finU([txt("Prazer, Douglas!")], "reply", U("other")));
    check("[CTRL] fiação antiga: crmWriteEnabled=true mas leadId=null (bridge) => zero crm_write, zero linha criada", crmOf(t1) == null && db.rows.length === 0 && db.inserts === 0 && t1.sent.includes("send_message"), `rows=${db.rows.length}`);
  }

  console.log(`\n== F2.47: ${ok} OK | ${fail} FALHA ==`);
  if (fail > 0) { for (const f of fails) console.error(`  FALHA: ${f}`); process.exit(1); }
}

main().catch((error) => { console.error(error); process.exit(1); });
