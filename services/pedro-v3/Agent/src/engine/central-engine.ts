// ============================================================================
// central-engine.ts — R13 Inc2/C (+B). O AGENTE CENTRAL governa o turno.
//
// UM único cérebro comercial por turno (Brain/11 §2). Fluxo:
//   inbox consolidado -> prompt do portal -> ConversationState -> WorkingMemory -> transcript -> TurnFrame
//   -> AgentBrainPort loop (query autorizada por chamada; tool devolve FATO tipado; observação volta ao MESMO
//      cérebro) -> UMA decisão final -> compose/render (reusa) -> policies validam -> reducers (estado + WM) ->
//      commit CAS (state + WorkingMemory + decisão + eventos + outbox na MESMA UnitOfWork) -> EffectGate OFF.
//
// Regras de ferro: nenhum handler comercial roda antes do cérebro; regex é só evidência; tool nunca fala com o
// lead; policy valida, não escolhe assunto; no máximo uma decisão comercial; tool só quando falta um fato.
//
// Flag: PEDRO_V3_BRAIN_MODE=central_shadow (default OFF). Sem efeito externo (shadow): o outbox nasce 'pending'
// e NENHUM dispatcher é criado aqui.
// ============================================================================
import type { DecisionLlm } from "../domain/llm.ts";
import type { Clock, Persistence, UnitOfWork, WorkingMemoryOutcomeStore } from "../domain/ports.ts";
import type { TurnContextPreparer, QueryLoopLimits } from "../domain/context.ts";
import type { TurnContext } from "../domain/context.ts";
import { createInitialState } from "../domain/conversation-state.ts";
import type { ConversationState } from "../domain/conversation-state.ts";
import type {
  DecisionMutation, ProposedDecision, ProposedEffectPlan, QueryCall, QueryResult, TurnAction, TurnDecision, EffectResult,
} from "../domain/decision.ts";
import type {
  AgentBrainPort, AgentBrainDecision, AgentToolObservation, CentralQueryCall, PersistedWorkingMemory,
  PhotoActionDraft, ToolResultMemory, ToolTelemetry, WorkingMemoryV1, BusinessInfoTopic,
} from "../domain/agent-brain.ts";
import type { TenantAgentRef } from "../domain/read-ports.ts";
import type { InboxRecord, OutboxRecord, ProviderCapability, TurnEventRecord } from "../domain/effect-intent.ts";
import { redact } from "../domain/effect-intent.ts";
import type { Id, Iso, JsonValue, VehicleFact, RememberedVehicleIdentity } from "../domain/types.ts";
import { composeAndVerify, withTimeout } from "./decision-engine.ts";
import type { QueryRunner, TurnOutput } from "./decision-engine.ts";
import { PolicyEngine, hasDeny } from "./policy-engine.ts";
import { ResponseRenderer } from "./response-renderer.ts";
import { buildContextualSdrReply } from "./continuity-fallback.ts";
import type { RenderedResponse, ResponsePart } from "../domain/decision.ts";
import { finalize } from "./finalizer.ts";
import { applyDecision } from "./state-reducer.ts";
import { materializeEffectPlans } from "./effect-materializer.ts";
import { computeRenderedOfferContext } from "./offer-context.ts";
import { focusInvalidationMutations, isNewSearchTurn } from "./vehicle-focus.ts";
import { extractLeadSlots, resolveSelectedVehicle } from "./lead-extraction.ts";
import { safeCommitSlots } from "./conversation-engine.ts";
import { reconcileObjectiveWithQuestion, type SdrQualificationPolicy } from "./sdr-conductor.ts";
import { buildTurnFrame } from "./turn-frame-builder.ts";
import { normalizeText } from "./catalog-utils.ts";
import {
  loadPersistedWorkingMemory, deriveCanonicalViews, applyDecisionWorkingMemoryMutations,
  applySystemWorkingMemoryMutations, applyEffectOutcomeToWorkingMemory, isValidPhotoActionDraft,
  toAgentObservation, toToolResultMemory, toToolTelemetry,
} from "./working-memory.ts";
import type { TenantBusinessInfoSource } from "./tenant-business-info.ts";
import { resolveTenantBusinessInfo, businessInfoToolResultMemory } from "./tenant-business-info.ts";

// ── Flag de modo ─────────────────────────────────────────────────────────────────────────────────────────────
export type BrainMode = "off" | "central_shadow" | "central_active";
export function readBrainMode(env: Record<string, string | undefined> = process.env): BrainMode {
  const value = env.PEDRO_V3_BRAIN_MODE?.trim();
  return value === "central_shadow" || value === "central_active" ? value : "off";
}
export function isCentralShadowMode(env: Record<string, string | undefined> = process.env): boolean {
  return readBrainMode(env) === "central_shadow";
}

export const DEFAULT_ALLOWED_TOOLS = ["stock_search", "vehicle_details", "vehicle_photos_resolve", "tenant_business_info", "crm_read"] as const;

export type CentralTurnArgs = {
  readonly persistence: Persistence;
  readonly clock: Clock;
  readonly brain: AgentBrainPort;
  readonly llm: DecisionLlm;                 // compose/render (segue o prompt do portal + guidance do cérebro)
  readonly runQuery: QueryRunner;            // os 4 QueryCall do kernel (ref já embutido)
  readonly businessInfo: TenantBusinessInfoSource;
  readonly contextPreparer: TurnContextPreparer;
  readonly conversationId: Id;
  readonly tenantId: Id;
  readonly agentId: Id;
  readonly leadId?: Id | null;
  readonly workerId: string;
  readonly turnId: Id;
  readonly leaseTtlMs: number;
  readonly portalPromptSha256: string;
  readonly limits: QueryLoopLimits;
  readonly maxValidationAttempts: number;
  readonly sdrPolicy?: SdrQualificationPolicy;
  readonly brainMaxSteps?: number;                       // teto de passos de ferramenta do cérebro (default 4)
  readonly allowedTools?: ReadonlySet<string> | readonly string[];
  readonly providerCapability?: Partial<Record<OutboxRecord["kind"], ProviderCapability>>;
  // AUTORIA ÚNICA (audit): quando true, o cérebro AUTORA um ResponseDraft e o engine RENDERIZA aterrado (sem 2º
  // LLM/compose); deny volta ao MESMO cérebro; esgotou -> fallback técnico honesto. central_active liga isto.
  readonly singleAuthor?: boolean;
};

export type ResponseSource = "brain_final" | "brain_retry" | "deterministic_recall" | "technical_fallback" | "legacy_compose";

function requiredToolBeforeFinal(frame: ReturnType<typeof buildTurnFrame>, observations: readonly AgentToolObservation[]): string | null {
  const wasObserved = (tool: string) => observations.some((observation) =>
    observation.tool === tool && (observation.ok || observation.error.code !== "REQUIRED_TOOL_MISSING"));
  if (frame.signals.mentionsMoreOptions && !wasObserved("stock_search")) {
    return "O lead pediu mais opções. Execute stock_search com os filtros atuais e excludeKeys da última oferta antes da resposta final.";
  }
  if (frame.signals.mentionsStore && !wasObserved("tenant_business_info")) {
    return "O lead pediu informação da loja. Execute tenant_business_info antes da resposta final.";
  }
  return null;
}

export type CentralTurnResult =
  | { status: "no_op"; turnId: Id; claimedEventIds: Id[] }
  | {
      status: "committed";
      turnId: Id;
      claimedEventIds: Id[];
      decision: TurnDecision;
      composedText: string;
      terminalSafe: boolean;
      facts: QueryResult[];
      outbox: OutboxRecord[];
      stateVersion: number;
      workingMemory: PersistedWorkingMemory;
      toolObservations: AgentToolObservation[];
      toolTelemetry: ToolTelemetry[];
      brainSteps: number;
      responseSource: ResponseSource;
      degraded: boolean;   // audit B1: technical_fallback é degradação observável (nunca "sucesso normal")
      institutionalResolved: readonly { readonly topic: string; readonly status: "ok" | "not_configured" | "failure" }[];
      policyFeedback: readonly string[];   // feedbacks de deny devolvidos ao cérebro no turno (observabilidade)
      droppedSelectKeys: readonly string[];   // Hardening 1: seleções descartadas por falta de label canônico
    }
  | { status: "commit_failed"; turnId: Id; claimedEventIds: Id[]; reason: string };

// ── helpers puros ──────────────────────────────────────────────────────────────────────────────────────────
function payloadJson(value: unknown): JsonValue {
  if (value === undefined) return null;
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map(payloadJson);
  if (typeof value === "object") { const out: { [k: string]: JsonValue } = {}; for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = payloadJson(v); return out; }
  return String(value);
}
function textFromInbox(rec: InboxRecord): string {
  const raw = rec.raw as Record<string, unknown>;
  const text = raw.text ?? raw.message ?? raw.body ?? raw.transcription ?? "";
  return typeof text === "string" ? text.trim() : "";
}
function aggregateLeadMessage(records: InboxRecord[]): string {
  const ordered = [...records].sort((a, b) => {
    const ta = Date.parse(a.receivedAt), tb = Date.parse(b.receivedAt);
    if (ta !== tb) return ta - tb;
    return a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0;
  });
  return ordered.map(textFromInbox).filter(Boolean).join("\n");
}
function makeEvent(args: { conversationId: Id; turnId: Id; type: string; suffix: string; payload: { [k: string]: JsonValue }; at: Iso }): TurnEventRecord {
  return { eventId: `${args.turnId}:${args.suffix}`, conversationId: args.conversationId, turnId: args.turnId, type: args.type, payloadSchemaVersion: 1, payload: redact(args.payload), at: args.at };
}
function deriveProposedAction(effects: readonly ProposedEffectPlan[]): TurnAction {
  if (effects.some((e) => e.kind === "send_media")) return "send_photos";
  if (effects.some((e) => e.kind === "handoff")) return "handoff";
  if (effects.some((e) => e.kind === "schedule_visit")) return "schedule_visit";
  return "reply";
}
// Toda resposta precisa de UM send_message (o texto renderizado vai nele). Se o cérebro não propôs, injeta.
function ensureSendMessage(effects: readonly ProposedEffectPlan[]): ProposedEffectPlan[] {
  const list = [...effects];
  if (!list.some((e) => e.kind === "send_message")) {
    list.unshift({ kind: "send_message", planId: "reply", order: 0, onSuccess: [] } as ProposedEffectPlan);
  }
  return list;
}
// tool `crm_read` só passa com leadId; tenant_business_info não é QueryCall (tratada à parte). Aqui autorizamos
// só a superfície do kernel (POL-STATE-011) — a policy VALIDA, não escolhe assunto.
function isKernelQueryCall(call: CentralQueryCall): call is QueryCall {
  return call.tool === "stock_search" || call.tool === "vehicle_details" || call.tool === "vehicle_photos_resolve" || call.tool === "crm_read";
}

// ── Enforcement determinístico de invariantes (Brain/11 §5: validador/executor; NÃO conduz o assunto) ──────────
// PEDIDO de foto AGORA (imperativo) — distinto de PERGUNTA de memória ("qual carro pedi fotos?").
const PHOTO_MEMORY_Q_RX = /\b(qual|que|quais)\b[^?]*\b(foto|carro|ve[ií]culo|modelo)\b[^?]*\b(pedi|pediu|mandei|mostrei|recebi)\b/;
const PHOTO_REQUEST_RX = /\b(manda|mandar|envia|enviar|mostra|mostrar|me\s+ve|quero\s+ver|posso\s+ver|ver\s+as?)\b[^?]*\bfotos?\b|\bfotos?\s+d(o|a|e|esse|essa|ele|ela|aquele)\b|\bfoto\s+d(a|o)\s+(primeir|segund|terceir|quart)/;
function isPhotoRequestBlock(text: string): boolean {
  const n = normalizeText(text);
  if (PHOTO_MEMORY_Q_RX.test(n)) return false;   // pergunta de memória NUNCA é pedido de envio
  return PHOTO_REQUEST_RX.test(n);
}
function isPhotoMemoryQuestionBlock(text: string): boolean { return PHOTO_MEMORY_Q_RX.test(normalizeText(text)); }
// A resposta cita o veículo lembrado? (token de marca/modelo do label, ignorando o ano).
function mentionsLabel(text: string, label: string): boolean {
  const t = normalizeText(text);
  return normalizeText(label).split(/\s+/).filter((w) => w.length >= 3 && !/^(19|20)\d{2}$/.test(w)).some((tok) => t.includes(tok));
}
// Invariante "no máximo UMA pergunta": mantém todas as sentenças NÃO-interrogativas + a PRIMEIRA interrogativa,
// descarta as demais interrogativas. Remover texto é grounding-safe (nunca cria alegação). PURO.
export function trimToOneQuestion(text: string): string {
  if ((text.match(/\?/g) ?? []).length <= 1) return text;
  const sentences = text.split(/(?<=[.!?])\s+/);
  let sawQuestion = false;
  const kept: string[] = [];
  for (const s of sentences) {
    if (s.includes("?")) { if (sawQuestion) continue; sawQuestion = true; }
    kept.push(s);
  }
  return kept.join(" ").trim();
}

// Parser de label "Marca Modelo Ano" -> identidade (ano só se o token final for um ano real; senão null).
function parseLabel(label: string | null | undefined): { marca: string | null; modelo: string | null; ano: number | null } {
  if (!label) return { marca: null, modelo: null, ano: null };
  const tokens = label.trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return { marca: null, modelo: null, ano: null };
  const yearTok = tokens[tokens.length - 1];
  const hasYear = /^(19|20)\d{2}$/.test(yearTok);
  const marca = tokens[0];
  const modelo = (hasYear ? tokens.slice(1, -1) : tokens.slice(1)).join(" ");
  if (!marca || !modelo) return { marca: null, modelo: null, ano: null };
  return { marca, modelo, ano: hasYear ? Number(yearTok) : null };
}
// Identidades LEMBRADAS (audit autoria única): marca/modelo/ano (real ou null) de ofertas/seleção/foto anteriores.
// SÓ para NOMEAR no renderer — NUNCA km/câmbio/cor/preço. ZERO VehicleFact fabricado (nada de ano=0/preco=-1).
// Atributo só vem de QueryResult REAL do MESMO vehicleKey (renderer falha fechado sem o fato).
function buildRememberedIdentities(state: ConversationState): RememberedVehicleIdentity[] {
  const out: RememberedVehicleIdentity[] = [];
  const seen = new Set<string>();
  const push = (key: string | null | undefined, marca: string | null | undefined, modelo: string | null | undefined, ano: number | null | undefined): void => {
    if (!key || !marca || !modelo || seen.has(key)) return;
    seen.add(key);
    out.push({ vehicleKey: key, marca, modelo, ano: typeof ano === "number" && ano > 0 ? ano : null });
  };
  for (const it of state.lastRenderedOfferContext?.items ?? []) push(it.vehicleKey, it.marca, it.modelo, it.ano ?? null);
  const sel = state.vehicleContext?.selected;
  if (sel?.key) { const p = parseLabel(sel.label); push(sel.key, p.marca, p.modelo, p.ano); }
  const lastPhoto = loadPersistedWorkingMemory(state.workingMemory).memory.lastPhotoAction;
  if (lastPhoto?.vehicleKey) { const p = parseLabel(lastPhoto.label); push(lastPhoto.vehicleKey, p.marca, p.modelo, p.ano); }
  return out;
}

// Auto-grounding (executor determinístico): veículos que a RESPOSTA pode nomear — alvo de foto (send_media) e o
// selecionado — precisam estar nos FATOS p/ o compose citar nome/atributo aterrado. vehicle_photos_resolve NÃO
// devolve marca/modelo; então buscamos vehicle_details (dados REAIS: preço/câmbio/cor) desses veículos. Bounded (3),
// best-effort (falha não derruba o turno). Não conduz o assunto — só garante grounding do que já foi decidido.
async function groundNamedVehicles(args: {
  readonly proposedEffects: readonly ProposedEffectPlan[];
  readonly state: ConversationState;
  readonly facts: readonly QueryResult[];
  readonly identities: readonly RememberedVehicleIdentity[];
  readonly runQuery: QueryRunner;
  readonly timeoutMs: number;
}): Promise<QueryResult[]> {
  const keys = new Set<string>();
  for (const e of args.proposedEffects) if (e.kind === "send_media" && typeof e.vehicleKey === "string" && e.vehicleKey) keys.add(e.vehicleKey);
  if (args.state.vehicleContext.selected?.key) keys.add(args.state.vehicleContext.selected.key);
  if (keys.size === 0) return [];
  const known = new Set<string>();
  for (const f of args.facts) {
    if (!f.ok) continue;
    if (f.tool === "stock_search") for (const v of f.data.items) known.add(v.vehicleKey);
    if (f.tool === "vehicle_details") known.add(f.data.vehicle.vehicleKey);
  }
  // Identidade LEMBRADA cobre o NOME (marca/modelo) -> não re-consulta só p/ nomear (legacy). Atributo continua
  // aterrado no compose/validate contra fato REAL; identidade nunca vira "0 km"/preço.
  for (const id of args.identities) known.add(id.vehicleKey);
  const toFetch = [...keys].filter((k) => !known.has(k)).slice(0, 3);
  const out: QueryResult[] = [];
  for (const vehicleKey of toFetch) {
    try {
      const res = await withTimeout(args.runQuery({ tool: "vehicle_details", input: { vehicleKey } }), args.timeoutMs, "query: ground vehicle_details");
      if (res.ok) out.push(res);
    } catch { /* best-effort: grounding ausente só significa que o compose não poderá nomear o veículo */ }
  }
  return out;
}

// Nome HUMANO do veículo (MARCA MODELO ANO) a partir dos fatos REAIS do turno + identidade lembrada + oferta anterior
// + seleção. NUNCA devolve a chave crua (P0-2/audit): sem nome humano -> null (o chamador NÃO persiste/expõe a chave).
function canonicalVehicleLabel(vehicleKey: string, facts: readonly QueryResult[], identities: readonly RememberedVehicleIdentity[], state: ConversationState): string | null {
  for (const f of facts) {
    if (!f.ok) continue;
    if (f.tool === "stock_search") { const v = f.data.items.find((x) => x.vehicleKey === vehicleKey); if (v) { const l = [v.marca, v.modelo, v.ano].filter(Boolean).join(" ").trim(); if (l) return l; } }
    if (f.tool === "vehicle_details" && f.data.vehicle.vehicleKey === vehicleKey) { const v = f.data.vehicle; const l = [v.marca, v.modelo, v.ano].filter(Boolean).join(" ").trim(); if (l) return l; }
  }
  const id = identities.find((i) => i.vehicleKey === vehicleKey);
  if (id) { const l = [id.marca, id.modelo, id.ano].filter(Boolean).join(" ").trim(); if (l && l !== vehicleKey) return l; }
  const it = state.lastRenderedOfferContext?.items.find((i) => i.vehicleKey === vehicleKey);
  if (it) { const l = [it.marca, it.modelo, it.ano].filter(Boolean).join(" ").trim(); if (l) return l; }
  const sel = state.vehicleContext.selected;
  if (sel?.key === vehicleKey && sel.label && sel.label !== vehicleKey) return sel.label;
  return null;   // NUNCA a chave crua
}
// P0-2 + Hardening 1 (audit): o LABEL de toda select_vehicle_focus vem EXCLUSIVAMENTE de fonte CANÔNICA (VehicleFact /
// RememberedVehicleIdentity / lastRenderedOfferContext) via canonicalVehicleLabel -> "MARCA MODELO ANO". NUNCA aceita o
// label proposto pela LLM como fallback. Sem label canônico -> DESCARTA só a seleção (jamais persiste label vazio/da
// LLM) e registra o key no diagnóstico. O StateReducer ainda rejeita qualquer select com label vazio/== key (defesa 2ª).
export function canonicalizeSelectMutations(muts: readonly DecisionMutation[], facts: readonly QueryResult[], identities: readonly RememberedVehicleIdentity[], state: ConversationState): { mutations: DecisionMutation[]; droppedKeys: string[] } {
  const mutations: DecisionMutation[] = [];
  const droppedKeys: string[] = [];
  for (const m of muts) {
    if (m.op !== "select_vehicle_focus") { mutations.push(m); continue; }
    const canon = canonicalVehicleLabel(m.vehicle.key, facts, identities, state);
    if (canon && canon !== m.vehicle.key) mutations.push({ ...m, vehicle: { ...m.vehicle, label: canon } });
    else droppedKeys.push(m.vehicle.key);
  }
  return { mutations, droppedKeys };
}
// P0-2 (audit): TODA vehicleKey conhecida no turno (fatos + identidade + seleção + oferta) — para o guard "nenhuma
// resposta ao lead contém literalmente uma chave interna".
function knownVehicleKeys(facts: readonly QueryResult[], identities: readonly RememberedVehicleIdentity[], state: ConversationState): Set<string> {
  const keys = new Set<string>();
  for (const f of facts) { if (!f.ok) continue; if (f.tool === "stock_search") for (const v of f.data.items) keys.add(v.vehicleKey); if (f.tool === "vehicle_details") keys.add(f.data.vehicle.vehicleKey); }
  for (const id of identities) keys.add(id.vehicleKey);
  if (state.vehicleContext.selected?.key) keys.add(state.vehicleContext.selected.key);
  for (const it of state.lastRenderedOfferContext?.items ?? []) keys.add(it.vehicleKey);
  keys.delete("");
  return keys;
}

// Executor DETERMINÍSTICO de uma decisão JÁ tomada (Brain/11 §5), usado SÓ quando o compose do LLM falha o
// grounding. Renderiza aterrado por construção: foto -> texto sem atributos; oferta -> lista numerada dos fatos do
// turno; senão -> resposta SDR contextual (sem citar veículo). Nunca inventa; substitui o terminal_safe genérico.
function renderDeterministicResponse(decision: TurnDecision, toolFacts: readonly QueryResult[], composeFacts: readonly QueryResult[], state: ConversationState, leadMessage: string): RenderedResponse {
  if (decision.effectPlan.some((p) => p.kind === "send_media")) {
    const parts: ResponsePart[] = [{ type: "text", content: "Aqui estao as fotos que voce pediu. Quer que eu te passe mais detalhes desse carro?" }];
    return { draft: { parts }, text: ResponseRenderer.render({ parts }, [...composeFacts], state) };
  }
  const items = toolFacts.flatMap((f) => (f.ok && f.tool === "stock_search") ? f.data.items : []).filter((v) => typeof v.preco === "number" && v.preco > 0);
  if (items.length > 0) {
    const keys = [...new Set(items.map((v) => v.vehicleKey))].slice(0, 5);
    const parts: ResponsePart[] = [{ type: "text", content: "Tenho estas opcoes para voce:" }, { type: "vehicle_offer_list", vehicleKeys: keys }, { type: "text", content: "Quer ver as fotos de alguma?" }];
    return { draft: { parts }, text: ResponseRenderer.render({ parts }, [...composeFacts], state) };
  }
  const text = buildContextualSdrReply(state, { leadMessage });
  return { draft: { parts: [{ type: "text", content: text }] }, text };
}

// ── AUTORIA ÚNICA (Brain/11 §2, audit) — helpers ──────────────────────────────────────────────────────────────
type SingleAuthorResult =
  | { readonly ok: true; readonly decision: TurnDecision; readonly composed: RenderedResponse; readonly proposedEffects: ProposedEffectPlan[] }
  | { readonly ok: false; readonly feedback: string };

// Sanitiza deny da policy num feedback CURTO e acionável ao MESMO cérebro (sem PII/segredo/URL).
function sanitizePolicyFeedback(verdicts: readonly { policyId?: string; outcome: string; violations?: readonly string[] }[]): string {
  const msg = verdicts.filter((v) => v.outcome === "deny").flatMap((v) => v.violations ?? [v.policyId ?? "regra"]).join("; ").slice(0, 200);
  return `Resposta REJEITADA pela validação (${msg}). Corrija: afirme km/cor/câmbio/ano/preço só via vehicle_ref/money_ref do vehicleKey EXATO já consultado por vehicle_details; no máximo UMA pergunta; não repita dado já conhecido.`;
}

// Fallback TÉCNICO honesto (DEGRADAÇÃO OBSERVÁVEL): o cérebro não conseguiu aterrar a resposta no limite. Uma única
// fala honesta, SEM inventar fato, SEM listar carro/mudar de assunto/empurrar funil, e SEM prometer retorno proativo
// (não existe mecanismo de retorno). PURO. Marcado como terminalSafe/degraded pelo chamador.
function buildTechnicalFallback(): RenderedResponse {
  const text = "Me desculpe, não consegui confirmar essa informação com segurança agora. Consegue reformular pra eu te ajudar melhor?";
  return { draft: { parts: [{ type: "text", content: text }] }, text };
}

// Assinatura da chamada de tool p/ PROIBIR loop idêntico (mesma tool + mesmos args). PURO.
function toolCallSignature(call: CentralQueryCall): string {
  const input = ((call as { input?: unknown }).input ?? {}) as Record<string, unknown>;
  const norm: Record<string, unknown> = {};
  for (const k of Object.keys(input).sort()) norm[k] = input[k];
  return `${call.tool}:${JSON.stringify(norm)}`;
}

export function enrichStockSearchCall(
  call: QueryCall,
  options: {
    readonly popular: boolean;
    readonly moreOptions: boolean;
    readonly previousVehicleKeys: readonly string[];
  },
): QueryCall {
  if (call.tool !== "stock_search") return call;
  const previous = options.moreOptions
    ? options.previousVehicleKeys.filter((key): key is string => typeof key === "string" && key.length > 0)
    : [];
  const excludeKeys = previous.length > 0
    ? [...new Set([...(Array.isArray(call.input.excludeKeys) ? call.input.excludeKeys : []), ...previous])]
    : call.input.excludeKeys;
  return {
    ...call,
    input: {
      ...call.input,
      ...(options.popular ? { popular: true } : {}),
      ...(excludeKeys ? { excludeKeys } : {}),
    },
  };
}

// AUTORIA ÚNICA: o cérebro autora um ResponseDraft; o engine RENDERIZA aterrado (SEM 2º LLM), valida contra os
// fatos REAIS do turno e devolve ok|feedback. Identidade de memória só NOMEIA (marca/modelo/ano); km/cor/câmbio/
// preço só de fato REAL do MESMO vehicleKey — o renderer falha FECHADO (feedback -> o cérebro consulta ou difere).
function authorFromBrainDraft(args: {
  readonly finalDecision: AgentBrainDecision;
  readonly leadMessage: string;
  readonly facts: readonly QueryResult[];               // fatos REAIS de tool (grounding de atributo/oferta)
  readonly identities: readonly RememberedVehicleIdentity[]; // identidade (memória) só p/ NOMEAR (marca/modelo/ano)
  readonly ctx: TurnContext;
  readonly turnId: string;
}): SingleAuthorResult {
  const draft = args.finalDecision.responsePlan.draft;
  if (!draft || draft.parts.length === 0) {
    return { ok: false, feedback: "Devolva 'draft' com parts estruturadas (text/vehicle_ref/money_ref/vehicle_offer_list). Não escreva km/cor/câmbio/ano/preço em texto livre." };
  }
  const brainEffects = isPhotoRequestBlock(args.leadMessage) ? args.finalDecision.proposedEffects : args.finalDecision.proposedEffects.filter((e) => e.kind !== "send_media");
  const proposedEffects = ensureSendMessage(brainEffects);
  const proposal: ProposedDecision = {
    proposedAction: deriveProposedAction(proposedEffects),
    facts: [...(args.finalDecision.stateMutations ?? [])],
    proposedEffects,
    responsePlan: { guidance: args.finalDecision.responsePlan.guidance },
    reasonCode: args.finalDecision.reasonCode, reasonSummary: args.finalDecision.reasonSummary, confidence: args.finalDecision.confidence,
  };
  const realFacts = [...args.facts];
  // P0-3 (audit): busca com RESULTADOS deve RESPONDER, não pedir autorização. Se o turno tem itens de stock_search e o
  // draft NÃO traz vehicle_offer_list (nem send_media de um carro específico) -> deny + feedback ao MESMO cérebro. A LLM
  // segue autora da introdução/CTA; o engine só exige que a pergunta atual (disponibilidade) seja respondida com a lista.
  if (realFacts.some((f) => f.ok && f.tool === "stock_search" && f.data.items.length > 0)
      && !draft.parts.some((p) => p.type === "vehicle_offer_list")
      && !proposedEffects.some((e) => e.kind === "send_media")) {
    return { ok: false, feedback: "Você buscou o estoque e HÁ itens disponíveis. Inclua uma vehicle_offer_list com pelo menos um dos vehicleKeys retornados (você continua autor da introdução e do CTA). NÃO pergunte 'quer que eu mostre a lista?' — MOSTRE a lista agora." };
  }
  // B3 (audit): postQuery é AUTORIDADE. Se negar (ex.: oferta acima do teto, veículo fora dos fatos), o draft ORIGINAL
  // NÃO pode ser enviado — feedback ao MESMO cérebro; nenhum efeito comercial original sobrevive (o retry re-autora).
  const post = PolicyEngine.postQuery(proposal, realFacts, args.ctx);
  if (hasDeny(post)) return { ok: false, feedback: sanitizePolicyFeedback(post) };
  const decision0 = finalize(args.turnId, proposal, post, realFacts);
  // Render: identidade só NOMEIA (marca/modelo/ano); km/cor/câmbio/preço só do fato REAL do MESMO vehicleKey.
  let composed: RenderedResponse;
  try {
    composed = { draft, text: ResponseRenderer.render(draft, realFacts, args.ctx.state, args.identities) };
  } catch (err) {
    return { ok: false, feedback: `Uma parte cita um FATO ausente/não consultado (${String((err as Error)?.message ?? err).slice(0, 140)}). Chame vehicle_details do vehicleKey ANTES de afirmar km/cor/câmbio/preço, ou diga em text que vai confirmar.` };
  }
  // P0-2 (audit): a resposta ao lead NUNCA pode conter LITERALMENTE uma vehicleKey conhecida (chave/código interno).
  for (const k of knownVehicleKeys(realFacts, args.identities, args.ctx.state)) {
    if (composed.text.includes(k)) return { ok: false, feedback: `Você escreveu a chave interna do veículo ("${k}") na resposta. Use o NOME do carro (marca modelo ano), NUNCA a chave/código interno.` };
  }
  // Valida contra fatos REAIS (identidade de memória NÃO aterra atributo/oferta).
  const gv = PolicyEngine.validateResponse(composed, realFacts, decision0, args.ctx);
  if (hasDeny(gv)) return { ok: false, feedback: sanitizePolicyFeedback(gv) };
  return { ok: true, decision: decision0, composed, proposedEffects };
}

// B2 (audit): para pergunta de ATRIBUTO do veículo SELECIONADO, o turno EXIGE um vehicle_details BEM-SUCEDIDO do MESMO
// vehicleKey antes do final. Sem esse fato -> mensagem que força a consulta (o cérebro devolve query). Detalhe de OUTRO
// vehicleKey NÃO satisfaz. Sem veículo selecionado -> null (o cérebro pede esclarecimento; nunca consulta arbitrário).
function requireVehicleDetailBeforeFinal(frame: ReturnType<typeof buildTurnFrame>, observations: readonly AgentToolObservation[]): string | null {
  if (frame.signals.relation !== "asks_vehicle_detail") return null;
  const selectedKey = frame.workingMemory.selectedVehicle?.vehicleKey ?? null;
  if (!selectedKey) return null;
  const hasDetail = observations.some((o) => o.tool === "vehicle_details" && o.ok && o.data.vehicle.vehicleKey === selectedKey);
  if (hasDetail) return null;
  return `O cliente perguntou um atributo do veículo SELECIONADO. Execute vehicle_details({"vehicleKey":"${selectedKey}"}) e use SÓ esse fato (de OUTRO carro não vale) antes da resposta final.`;
}

// audit institucional: detecção GERAL dos tópicos pedidos no bloco (address/hours/unit). Léxico = EVIDÊNCIA (não
// regra por frase). Pode retornar VÁRIOS ("endereço E horário"). O engine garante UMA observação TERMINAL por tópico
// (ok:true OU NOT_CONFIGURED). normalizeText remove acentos -> padrões sem acento.
const INST_ADDRESS_RX = /\benderec|\bonde\s+(?:fica|e|esta|estao|fica\s+a\s+loja)|\blocaliza|\bcomo\s+(?:chego|chegar)|\bfica(?:m)?\s+(?:onde|em|na|no)/;
const INST_HOURS_RX = /\bhorario|\bque\s+horas|\bfuncionamento|\baberto|\bfecha(?:m|do)?\b|\batende(?:m|ndo)?\b|\bhoras?\s+(?:de\s+)?(?:atend|funcion|abr|fech)/;
const INST_UNIT_RX = /\bunidade|\bfilia|\bmatriz|\bqual\s+loja/;
function institutionalTopicsRequested(block: string): BusinessInfoTopic[] {
  const n = normalizeText(block);
  const out: BusinessInfoTopic[] = [];
  if (INST_ADDRESS_RX.test(n)) out.push("address");
  if (INST_HOURS_RX.test(n)) out.push("hours");
  if (INST_UNIT_RX.test(n)) out.push("unit");
  return out;
}

// ── Turno central ────────────────────────────────────────────────────────────────────────────────────────────
export async function runCentralConversationTurn(args: CentralTurnArgs): Promise<CentralTurnResult> {
  const {
    persistence, clock, brain, llm, runQuery, businessInfo, contextPreparer,
    conversationId, tenantId, agentId, leadId, workerId, turnId, leaseTtlMs, portalPromptSha256,
    limits, maxValidationAttempts, providerCapability, sdrPolicy,
  } = args;
  const ref: TenantAgentRef = { tenantId, agentId };
  const allowed = new Set(args.allowedTools ?? DEFAULT_ALLOWED_TOOLS);
  const brainMaxSteps = args.brainMaxSteps ?? 4;
  let claimedEventIds: Id[] = [];

  return persistence.withLease(conversationId, workerId, leaseTtlMs, async (lease): Promise<CentralTurnResult> => {
    const cutoff = clock.now();
    claimedEventIds = await persistence.claimBurst(conversationId, cutoff, workerId, turnId, lease);
    if (claimedEventIds.length === 0) return { status: "no_op", turnId, claimedEventIds };

    try {
      const loadedInbox = await Promise.all(claimedEventIds.map((eventId) => persistence.get(eventId)));
      const inboxRecords = loadedInbox.filter((rec): rec is InboxRecord => rec != null);
      if (inboxRecords.length !== claimedEventIds.length) throw new Error("claimed inbox record missing");

      const snapshot = await persistence.load(conversationId);
      const expectedVersion = snapshot?.version ?? 0;
      const state = snapshot?.state ?? createInitialState({ conversationId, tenantId, agentId, leadId, now: cutoff });
      // Isolamento (B item 3): estado carregado precisa pertencer a ESTA conta/agente/conversa. Falha fechado.
      if (state.tenantId !== tenantId || state.agentId !== agentId || state.conversationId !== conversationId) {
        throw new Error(`central: state ownership mismatch (loaded ${state.tenantId}/${state.agentId}/${state.conversationId} != ${tenantId}/${agentId}/${conversationId})`);
      }
      const leadMessage = aggregateLeadMessage(inboxRecords);
      const prepared = await contextPreparer.prepare({ state, turnId, leadMessage, now: cutoff });

      // Bind factual answers before the brain runs. This does not choose the reply; it only projects
      // conservative slot facts (for example, a bare name when the previous accepted question asked for it).
      const extractedSlots = extractLeadSlots({
        leadMessage,
        state,
        interpretation: prepared.interpretation,
        claimExtractor: prepared.claimExtractor,
        turnId,
      });
      const { contextState, committed: safeExtractedSlots } = safeCommitSlots(state, extractedSlots, turnId, cutoff);

      const ctx: TurnContext = {
        state: contextState, turnId, leadMessage, now: cutoff,
        interpretation: prepared.interpretation, tenantCatalog: prepared.tenantCatalog, claimExtractor: prepared.claimExtractor,
      };

      // ── WorkingMemory: parte persistida (WM-owned) + view canônica derivada do estado. ──
      const persisted0: PersistedWorkingMemory = loadPersistedWorkingMemory(contextState.workingMemory).memory;
      const wmV1: WorkingMemoryV1 = { ...persisted0, ...deriveCanonicalViews(contextState) };
      const frame = buildTurnFrame({ turnId, now: cutoff, block: leadMessage, portalPromptSha256, workingMemory: wmV1, interpretation: prepared.interpretation, state: contextState });

      // ── LOOP do cérebro: query (autorizada por chamada) | final. Observações FACTUAIS voltam ao MESMO cérebro. ──
      const observations: AgentToolObservation[] = [];
      const facts: QueryResult[] = [];                 // só os 4 QueryCall (grounding comercial)
      const toolResultMems: ToolResultMemory[] = [];   // memória sanitizada das tools executadas
      const toolTelemetry: ToolTelemetry[] = [];
      let finalDecision: AgentBrainDecision | null = null;
      let brainSteps = 0;
      // AUTORIA ÚNICA (audit): estado do caminho single-author.
      const singleAuthor = args.singleAuthor ?? false;
      const identities = buildRememberedIdentities(contextState); // identidade LEMBRADA (marca/modelo/ano) — só p/ NOMEAR
      let authoredComposed: RenderedResponse | null = null;
      let authoredDecision: TurnDecision | null = null;
      let authoredProposedEffects: ProposedEffectPlan[] | null = null;
      let responseSource: ResponseSource = singleAuthor ? "technical_fallback" : "legacy_compose";
      let brainRetries = 0;
      const policyFeedbackLog: string[] = [];
      const seenToolSigs = new Set<string>();
      // audit institucional: cache/observação TERMINAL por tópico. resolveInstitutional executa NO MÁXIMO 1x por
      // tópico (nunca repete a mesma chamada); NOT_CONFIGURED é terminal (ausência definitiva); READ_SOURCE_FAILURE
      // é falha técnica (permanece cacheada como tentada — não re-tenta, mas o cérebro pode degradar honestamente).
      const institutionalObs = new Map<BusinessInfoTopic, AgentToolObservation>();
      const resolveInstitutional = async (topic: BusinessInfoTopic): Promise<AgentToolObservation> => {
        const cached = institutionalObs.get(topic);
        if (cached) return cached;
        const started = Date.parse(clock.now());
        const obs = await resolveTenantBusinessInfo(businessInfo, ref, topic);
        institutionalObs.set(topic, obs);
        observations.push(obs);
        toolResultMems.push(businessInfoToolResultMemory(topic, obs.ok, turnId));
        toolTelemetry.push({ tool: "tenant_business_info", ok: obs.ok, ms: Math.max(0, Date.parse(clock.now()) - started) });
        return obs;
      };

      for (; brainSteps < brainMaxSteps; brainSteps++) {
        let step;
        try {
          step = await withTimeout(brain.proposeNextStep(frame, observations), limits.proposeTimeoutMs ?? 30_000, "propose: agent brain step exceeded timeout");
        } catch { break; } // falha técnica do cérebro -> sai do loop -> fallback seguro (nunca silêncio)
        if (step.kind === "final") {
          if (singleAuthor) {
            // audit institucional: garante UMA observação TERMINAL por tópico pedido no bloco ANTES de qualquer
            // requisito (evita o loop do requiredToolBeforeFinal.mentionsStore + do próprio cérebro). Resolve
            // DETERMINISTICAMENTE (cache -> nunca repete a mesma chamada; NOT_CONFIGURED terminal -> sem loop/fallback).
            // Depois o cérebro responde os fatos disponíveis e informa honestamente os ausentes.
            const missingInst = institutionalTopicsRequested(leadMessage).filter((t) => !institutionalObs.has(t));
            if (missingInst.length > 0) {
              for (const topic of missingInst) await resolveInstitutional(topic);
              if (brainSteps + 1 < brainMaxSteps) continue; else break;
            }
          }
          const missingTool = requiredToolBeforeFinal(frame, observations);
          if (missingTool && brainSteps + 1 < brainMaxSteps) {
            observations.push({ tool: frame.signals.mentionsStore ? "tenant_business_info" : "stock_search", ok: false, error: { code: "REQUIRED_TOOL_MISSING", message: missingTool } });
            continue;
          }
          if (missingTool) break;
          if (singleAuthor) {
            // B2 (audit): pergunta de atributo do SELECIONADO exige vehicle_details bem-sucedido do MESMO key ANTES
            // do final. Sem o fato -> força a consulta (retry); esgotou -> fallback degradado pós-loop.
            const needDetail = requireVehicleDetailBeforeFinal(frame, observations);
            if (needDetail && brainSteps + 1 < brainMaxSteps) { observations.push({ tool: "vehicle_details", ok: false, error: { code: "REQUIRED_TOOL_MISSING", message: needDetail } }); continue; }
            if (needDetail) break;
            // Renderiza+valida a autoria do cérebro AQUI. Deny/fato ausente -> feedback tipado ao MESMO cérebro
            // (retry) enquanto houver passo; senão sai do loop -> fallback técnico honesto pós-loop.
            const authored = authorFromBrainDraft({ finalDecision: step.decision, leadMessage, facts, identities, ctx, turnId });
            if (authored.ok) {
              finalDecision = step.decision; authoredDecision = authored.decision; authoredComposed = authored.composed; authoredProposedEffects = authored.proposedEffects;
              responseSource = brainRetries === 0 ? "brain_final" : "brain_retry";
              break;
            }
            brainRetries += 1; policyFeedbackLog.push(authored.feedback);
            if (brainSteps + 1 < brainMaxSteps) { observations.push({ tool: "response", ok: false, error: { code: "RESPONSE_REJECTED", message: authored.feedback } }); continue; }
            break;
          }
          finalDecision = step.decision;
          break;
        }

        const call = step.call;
        // Allowlist: tool proibida NÃO executa (observação de erro; o cérebro segue com o que tem).
        if (!allowed.has(call.tool)) {
          observations.push({ tool: call.tool, ok: false, error: { code: "FORBIDDEN", message: `tool '${call.tool}' fora do allowlist` } });
          continue;
        }
        // Proíbe loop idêntico: mesma tool + mesmos args -> devolve o fato já obtido (nunca reexecuta).
        const sig = toolCallSignature(call);
        if (seenToolSigs.has(sig)) {
          observations.push({ tool: call.tool, ok: false, error: { code: "DUP_TOOL", message: "Você já consultou isso neste turno; use o fato que a ferramenta retornou (não repita a mesma chamada)." } });
          continue;
        }
        seenToolSigs.add(sig);
        if (call.tool === "tenant_business_info") {
          // resolveInstitutional dedup por tópico (1x); repetição do MESMO tópico devolve o cache (nunca reexecuta).
          await resolveInstitutional(call.input.topic);
          continue;
        }
        if (!isKernelQueryCall(call)) { observations.push({ tool: (call as { tool: string }).tool, ok: false, error: { code: "VALIDATION", message: "tool desconhecida" } }); continue; }
        // AUTORIZAÇÃO POR CHAMADA (POL-STATE-011): a policy VALIDA (allow/deny), nunca escolhe o assunto.
        const verdict = PolicyEngine.authorizeQuery(call, ctx, facts);
        if (verdict.outcome !== "allow") {
          observations.push({ tool: call.tool, ok: false, error: { code: "FORBIDDEN", message: verdict.violations?.join(";") ?? "query negada" } });
          continue;
        }
        // P0-4 (audit): "mais opções" -> o ENGINE enriquece excludeKeys com a UNIÃO das keys da última oferta (não
        // depende de a LLM lembrar); preserva tipo/câmbio/teto. A chamada EXECUTADA (não só a proposta) carrega os excludes.
        const execCall = enrichStockSearchCall(call, {
          popular: frame.signals.mentionsPopular === true,
          moreOptions: frame.signals.mentionsMoreOptions,
          previousVehicleKeys: (contextState.lastRenderedOfferContext?.items ?? []).map((item) => item.vehicleKey),
        });
        const started = Date.parse(clock.now());
        let res: QueryResult;
        try {
          res = await withTimeout(runQuery(execCall), limits.queryTimeoutMs ?? 20_000, `query: ${call.tool} exceeded timeout`);
        } catch {
          observations.push({ tool: call.tool, ok: false, error: { code: "UPSTREAM", message: "tool indisponivel" } });
          continue;
        }
        facts.push(res);
        observations.push(toAgentObservation(res));
        toolResultMems.push(toToolResultMemory(res, turnId));
        toolTelemetry.push(toToolTelemetry(res, Math.max(0, Date.parse(clock.now()) - started)));
      }

      // ── AUTORIA: single-author (draft do cérebro, SEM 2º compose) OU legacy (DecisionLlm.compose). ──
      let turnOutput: TurnOutput;
      let proposedEffects: ProposedEffectPlan[];
      let composeFacts: QueryResult[];   // fatos p/ resolver label do veículo (foto) no commit
      if (singleAuthor) {
        // Usa a resposta que o cérebro AUTOROU+aterrou (render+validate já feitos no loop). Se nada passou no
        // limite, FALLBACK TÉCNICO DEGRADADO — honesto, responde à pergunta atual; NUNCA lista/menu/muda de assunto/
        // funil; NUNCA promete retorno. JAMAIS chama DecisionLlm.compose. terminalSafe=true (degradação observável).
        composeFacts = [...facts];   // só fatos REAIS resolvem label de foto no commit (identidade não carrega km/cor)
        let effectiveDecision: TurnDecision;
        let composed: RenderedResponse;
        if (authoredComposed && authoredDecision && authoredProposedEffects) {
          effectiveDecision = authoredDecision; composed = authoredComposed; proposedEffects = authoredProposedEffects;
        } else {
          responseSource = "technical_fallback";
          composed = buildTechnicalFallback();
          proposedEffects = ensureSendMessage([]);   // B3: nenhum efeito comercial original sobrevive (só a fala honesta)
          const fbProposal: ProposedDecision = { proposedAction: "clarify", facts: [], proposedEffects, responsePlan: { guidance: composed.text }, reasonCode: "technical_fallback", reasonSummary: "cérebro não produziu resposta aterrada no limite de passos", confidence: 0.3 };
          effectiveDecision = finalize(turnId, fbProposal, PolicyEngine.postQuery(fbProposal, facts, ctx), facts);
          finalDecision = finalDecision ?? { reasonCode: "technical_fallback", reasonSummary: "fallback técnico honesto", confidence: 0.3, responsePlan: { guidance: composed.text, draft: null }, proposedEffects: [], memoryMutations: [], stateMutations: [] };
        }
        // ≤1 pergunta.
        const trimmedText = trimToOneQuestion(composed.text);
        if (trimmedText !== composed.text) composed = { ...composed, text: trimmedText };
        // Recall determinístico de foto (invariante 8): pergunta de MEMÓRIA de foto SEMPRE nomeia o veículo lembrado.
        // O label é FATO de memória (grounded por construção) -> responde MESMO se o cérebro não autorou. NÃO é
        // degradação: marca responseSource=deterministic_recall (resposta aterrada, não fallback técnico).
        const recalledLabel = persisted0.lastPhotoAction?.label ?? null;
        if (recalledLabel && isPhotoMemoryQuestionBlock(leadMessage) && !effectiveDecision.effectPlan.some((p) => p.kind === "send_media") && !mentionsLabel(composed.text, recalledLabel)) {
          const recall = `Você pediu as fotos do ${recalledLabel}. Quer que eu te passe mais detalhes dele?`;
          composed = { draft: { parts: [{ type: "text", content: recall }] }, text: recall };
          responseSource = "deterministic_recall";
        }
        const degraded = responseSource === "technical_fallback";
        if (sdrPolicy && !degraded) effectiveDecision = reconcileObjectiveWithQuestion({ decision: effectiveDecision, composedText: composed.text, state: contextState, turnId, policy: sdrPolicy });
        turnOutput = { decision: effectiveDecision, composed, facts, loopExhausted: false, terminalSafe: degraded, steps: brainSteps };
      } else {
        // ── LEGACY (compose por DecisionLlm): caminho anterior, intocado (shadow/testes de engine). ──
        if (!finalDecision) {
          finalDecision = {
            reasonCode: "brain_loop_exhausted", reasonSummary: "cérebro não concluiu no limite de passos", confidence: 0.4,
            responsePlan: { guidance: "Peça um esclarecimento gentil ao lead, sem inventar veículo, preço ou informação." },
            proposedEffects: [], memoryMutations: [], stateMutations: [],
          };
        }
        const brainEffects = isPhotoRequestBlock(leadMessage) ? finalDecision.proposedEffects : finalDecision.proposedEffects.filter((e) => e.kind !== "send_media");
        proposedEffects = ensureSendMessage(brainEffects);
        const stateMutations: DecisionMutation[] = [...(finalDecision.stateMutations ?? [])];
        const proposal: ProposedDecision = {
          proposedAction: deriveProposedAction(proposedEffects),
          facts: stateMutations,
          proposedEffects,
          responsePlan: { guidance: finalDecision.responsePlan.guidance },
          reasonCode: finalDecision.reasonCode, reasonSummary: finalDecision.reasonSummary, confidence: finalDecision.confidence,
        };
        const post = PolicyEngine.postQuery(proposal, facts, ctx);           // postQuery só com fatos de TOOL (não autoriza oferta por memória)
        const decision0 = finalize(turnId, proposal, post, facts);
        // audit: identidade LEMBRADA (nome) via `identities`; atributos só de fato REAL (facts + auto-grounding real).
        const groundFacts = await groundNamedVehicles({ proposedEffects, state: contextState, facts, identities, runQuery, timeoutMs: limits.queryTimeoutMs ?? 20_000 });
        composeFacts = [...facts, ...groundFacts];
        const cv = await composeAndVerify({ decision: decision0, facts: composeFacts, ctx, llm, limits, maxValidationAttempts, identities });
        let effectiveDecision = cv.decision;
        let composedRaw = cv.composed;
        let terminalSafe = cv.terminalSafe;
        if (cv.terminalSafe) {
          const det = renderDeterministicResponse(decision0, facts, composeFacts, ctx.state, leadMessage);
          const gv = PolicyEngine.validateResponse(det, composeFacts, decision0, ctx);
          if (!hasDeny(gv)) { effectiveDecision = decision0; composedRaw = det; terminalSafe = false; }
        }
        const trimmedText = trimToOneQuestion(composedRaw.text);
        let composed = trimmedText === composedRaw.text ? composedRaw : { ...composedRaw, text: trimmedText };
        const recalledLabel = persisted0.lastPhotoAction?.label ?? null;
        if (recalledLabel && isPhotoMemoryQuestionBlock(leadMessage) && !effectiveDecision.effectPlan.some((p) => p.kind === "send_media") && !mentionsLabel(composed.text, recalledLabel)) {
          const recall = `Você pediu as fotos do ${recalledLabel}. Quer que eu te passe mais detalhes dele?`;
          composed = { draft: { parts: [{ type: "text", content: recall }] }, text: recall };
        }
        if (sdrPolicy && !terminalSafe) {
          effectiveDecision = reconcileObjectiveWithQuestion({ decision: effectiveDecision, composedText: composed.text, state: contextState, turnId, policy: sdrPolicy });
        }
        turnOutput = { decision: effectiveDecision, composed, facts, loopExhausted: false, terminalSafe, steps: brainSteps };
      }
      if (!finalDecision) throw new Error("central: no final decision after authoring");
      const decision = turnOutput.decision;
      const composed = turnOutput.composed;
      const terminalSafe = turnOutput.terminalSafe;

      // ── WorkingMemory reducers: decisão (cérebro propõe) + sistema (tools executadas, autoridade do engine). ──
      let persistedWM = persisted0;
      if (finalDecision.memoryMutations.length > 0) {
        const r = applyDecisionWorkingMemoryMutations(persisted0, finalDecision.memoryMutations, { authorizedTurnId: turnId });
        if (r.ok) persistedWM = r.next; // rejeição NÃO corrompe: mantém a base (fail-closed por lote)
      }
      if (toolResultMems.length > 0) {
        const sys = applySystemWorkingMemoryMutations(persistedWM, toolResultMems.map((result) => ({ op: "record_tool_result" as const, result })), { authorizedTurnId: turnId });
        if (sys.ok) persistedWM = sys.next;
      }
      const nextWM = persistedWM;

      // ── Estado: o ENGINE é a única fonte do append_lead_turn; foco invalidado pela AÇÃO do turno. ──
      const renderedOfferContext = computeRenderedOfferContext(turnOutput, turnId, cutoff);
      const renderedItems = renderedOfferContext?.items ?? [];
      const leadTurnMutations: DecisionMutation[] = leadMessage.trim().length > 0 ? [{ op: "append_lead_turn", turn: { role: "lead", text: leadMessage, at: cutoff } }] : [];
      const brainStateMutations = decision.decisionMutations.filter((m) => m.op !== "append_lead_turn");
      const newSearchExecuted = isNewSearchTurn({
        isPhotoIntent: proposedEffects.some((e) => e.kind === "send_media"),
        relation: prepared.interpretation.relation, renderedItemCount: renderedItems.length, explicitSearchKind: null,
      });
      const focusInvalidation = focusInvalidationMutations(newSearchExecuted, renderedItems, turnId);
      const moreOptionsReset: DecisionMutation[] = (renderedItems.length > 0 && (contextState.moreOptionsExhausted ?? 0) > 0) ? [{ op: "set_more_options_exhausted", value: 0 }] : [];
      // Resolução DETERMINÍSTICA de referência ordinal/modelo à ÚLTIMA oferta ("o primeiro", "gostei do segundo") ->
      // selectedVehicleFocus. Grounded (só seleciona item da última lista renderizada); SEM inferência booleana (não
      // reintroduz o bug de possuiTroca). Aplicada por último -> vence a seleção do cérebro em caso de divergência.
      const ordinalRef = resolveSelectedVehicle(leadMessage, contextState, prepared.claimExtractor);
      const ordinalSelect: DecisionMutation[] = ordinalRef ? [{ op: "select_vehicle_focus", vehicle: ordinalRef, sourceTurnId: turnId }] : [];

      // P0-2 + Hardening 1 (audit): canonicaliza o label de toda select_vehicle_focus (do cérebro ou do ordinal) SÓ por
      // fonte canônica -> "MARCA MODELO ANO". Sem label canônico a seleção é DESCARTADA (nunca persiste label da LLM/vazio);
      // os keys descartados vão para observabilidade (droppedSelectKeys).
      const canonSelect = canonicalizeSelectMutations(
        [...leadTurnMutations, ...safeExtractedSlots, ...brainStateMutations, ...focusInvalidation, ...moreOptionsReset, ...ordinalSelect],
        composeFacts, identities, contextState,
      );
      const committedMutations = canonSelect.mutations;
      const droppedSelectKeys = canonSelect.droppedKeys;
      let reduced = applyDecision(state, committedMutations, turnId, cutoff);
      if (!reduced.ok) {
        // Fato de estado proposto pelo cérebro inválido -> o reducer (autoridade) rejeita SÓ o do cérebro; a
        // fala e a memória do turno continuam (nunca derruba o turno por causa de uma mutação do cérebro).
        reduced = applyDecision(state, [...leadTurnMutations, ...safeExtractedSlots, ...focusInvalidation, ...moreOptionsReset], turnId, cutoff);
        if (!reduced.ok) throw new Error(`central: decision mutations rejected: ${reduced.rejected.map((r) => r.reason).join("; ")}`);
      }
      reduced.next.workingMemory = nextWM;
      if (renderedOfferContext) reduced.next.lastRenderedOfferContext = renderedOfferContext;

      // ── B item 2: draft accepted-safe de foto por effectId (promovido à WM só no receipt accepted). ──
      const pending: Record<string, PhotoActionDraft> = { ...(reduced.next.pendingPhotoActions ?? {}) };
      for (const plan of decision.effectPlan) {
        if (plan.kind !== "send_media" || !plan.photoIds || plan.photoIds.length === 0) continue;
        // P0-2 (audit): nome HUMANO (marca modelo ano) — NUNCA a chave crua. Sem nome grounded -> NÃO persiste o draft
        // (nada de lastPhotoAction.label = chave; o recall só nomeia quando há nome real).
        const label = canonicalVehicleLabel(plan.vehicleKey, composeFacts, identities, contextState);
        if (label == null) continue;
        const draft: PhotoActionDraft = { vehicleKey: plan.vehicleKey, label, photoIds: [...plan.photoIds], effectId: plan.effectId, sourceTurnId: turnId, sourceTurnNumber: reduced.next.turnNumber };
        if (isValidPhotoActionDraft(draft)) pending[plan.effectId] = draft;
      }
      reduced.next.pendingPhotoActions = pending;

      // Isolamento defensivo no commit.
      if (reduced.next.tenantId !== tenantId || reduced.next.agentId !== agentId || reduced.next.conversationId !== conversationId) {
        throw new Error("central: next state ownership mismatch at commit");
      }

      const outbox = materializeEffectPlans(decision, composed, { conversationId, createdAt: cutoff, providerCapability });

      // Observabilidade institucional (audit): status TERMINAL por tópico resolvido no turno.
      const institutionalResolved = [...institutionalObs.entries()].map(([topic, obs]) => ({
        topic, status: (obs.ok ? "ok" : (obs.error.code === "NOT_CONFIGURED" ? "not_configured" : "failure")) as "ok" | "not_configured" | "failure",
      }));

      const events = [
        makeEvent({ conversationId, turnId, type: "turn_claimed", suffix: "claimed", payload: { eventIds: claimedEventIds }, at: cutoff }),
        // Observabilidade (audit): responseSource distingue autoria; brainReason = intenção do cérebro (≠ texto
        // enviado, que fica em response_composed); tools/selectedVehicleKey/policyFeedback p/ auditar o turno.
        makeEvent({ conversationId, turnId, type: "decision_final", suffix: "decision", payload: {
          action: decision.action, reasonCode: decision.reasonCode, effectIds: outbox.map((r) => r.effectId),
          brainMode: singleAuthor ? "central_active" : "central_shadow", brainSteps, responseSource, degraded: responseSource === "technical_fallback", brainRetries,
          brainReason: finalDecision.reasonSummary.slice(0, 160), selectedVehicleKey: contextState.vehicleContext.selected?.key ?? null,
          toolsExecuted: toolTelemetry.map((t) => t.tool), policyFeedback: policyFeedbackLog.slice(0, 3),
          institutionalResolved, droppedSelectKeys,
        }, at: cutoff }),
        makeEvent({ conversationId, turnId, type: "response_composed", suffix: "response", payload: { text: composed.text, terminalSafe, responseSource, degraded: responseSource === "technical_fallback" }, at: cutoff }),
      ];

      // ── COMMIT ATÔMICO: state (com WorkingMemory embutida) + decisão + eventos + outbox na MESMA UnitOfWork CAS. ──
      const uow: UnitOfWork = persistence.begin({ lease });
      uow.casState(conversationId, expectedVersion, reduced.next);
      uow.appendEvents(events);
      uow.appendDecision(conversationId, { ...decision, decisionMutations: committedMutations });
      uow.appendOutbox(outbox);
      uow.markInboxDone(claimedEventIds, workerId, turnId);
      const commit = await uow.commit();
      if (!commit.ok) {
        await persistence.releaseClaim(claimedEventIds, workerId, turnId);
        return { status: "commit_failed", turnId, claimedEventIds, reason: commit.reason };
      }

      return {
        status: "committed", turnId, claimedEventIds, decision, composedText: composed.text, terminalSafe,
        facts, outbox, stateVersion: reduced.next.version, workingMemory: nextWM, toolObservations: observations, toolTelemetry, brainSteps, responseSource,
        degraded: responseSource === "technical_fallback", institutionalResolved, policyFeedback: policyFeedbackLog, droppedSelectKeys,
      };
    } catch (err) {
      await persistence.releaseClaim(claimedEventIds, workerId, turnId);
      return { status: "commit_failed", turnId, claimedEventIds, reason: err instanceof Error ? err.message : String(err) };
    }
  });
}

// ============================================================================
// B item 2 — Outcome ACCEPTED da ação de foto: promove pendingPhotoActions[effectId] -> WorkingMemory.lastPhotoAction.
//   accepted (ou delivered) -> atualiza lastPhotoAction (accepted-safe); NÃO toca photoLedger (isso é do
//   commitEffectOutcome no nível delivered). Idempotência INDEPENDENTE via appliedAcceptedEffectIds (NÃO usa o
//   outcomeAppliedAt do outbox, que governa a fase delivered — um marcador não pode impedir o outro). newer-wins
//   pelo sourceTurnNumber (applyEffectOutcomeToWorkingMemory). failed/outcome_uncertain NÃO consomem idempotência.
// ============================================================================
export async function applyAcceptedPhotoActionOutcome(args: {
  readonly persistence: Persistence;
  readonly conversationId: string;
  readonly effectId: string;
  readonly result: EffectResult;
  readonly maxCasRetries?: number;
}): Promise<{ ok: true; applied: boolean } | { ok: false; reason: string }> {
  const { persistence, conversationId, effectId, result } = args;
  if (result.effectId !== effectId) return { ok: false, reason: `effectId mismatch (${result.effectId} != ${effectId})` };
  if (result.status !== "succeeded") return { ok: true, applied: false };                    // failed/uncertain: não consome
  if (result.receipt.level !== "accepted" && result.receipt.level !== "delivered") return { ok: true, applied: false };
  const retries = args.maxCasRetries ?? 3;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const snapshot = await persistence.load(conversationId);
    if (!snapshot) return { ok: false, reason: "state_not_found" };
    const state = snapshot.state;
    const alreadyApplied = state.appliedAcceptedEffectIds ?? [];
    if (alreadyApplied.includes(effectId)) return { ok: true, applied: false };              // idempotente (accepted OU delivered posterior)
    const draft = state.pendingPhotoActions?.[effectId];
    if (!draft) return { ok: true, applied: false };                                          // não é ação de foto rastreada
    const persisted: PersistedWorkingMemory = loadPersistedWorkingMemory(state.workingMemory).memory;
    const red = applyEffectOutcomeToWorkingMemory(persisted, { op: "mark_photo_action_accepted", action: draft }, result);
    if (!red.ok) return { ok: false, reason: red.rejected.map((r) => r.reason).join("; ") };
    // Audit Codex: envia SOMENTE a WorkingMemory (nunca o ConversationState completo). O adapter/RPC carrega o estado
    // ATUAL e atualiza só workingMemory/appliedAcceptedEffectIds/version/updatedAt (preserva o resto). Fail-closed
    // se o adapter não expõe a capability (nunca cai num casState de estado completo — o UnitOfWork é só de turno).
    const wmStore = persistence as Partial<WorkingMemoryOutcomeStore>;
    if (typeof wmStore.commitWorkingMemoryOutcome !== "function") return { ok: false, reason: "persistence_missing_working_memory_outcome" };
    const c = await wmStore.commitWorkingMemoryOutcome(conversationId, effectId, snapshot.version, red.next, result.receipt.at);
    if (!c.ok) return { ok: false, reason: c.reason };
    if (c.applied) return { ok: true, applied: true };
    // applied=false -> duplicado (o loop recarrega e vê alreadyApplied -> no-op) OU conflito de versão -> reprocessa.
  }
  return { ok: false, reason: "cas_retries_exhausted" };
}

// ============================================================================
// R13-D/4 (audit Codex): RECONCILIAÇÃO DURÁVEL da promoção accepted-safe. Rastro durável = um send_media 'succeeded'
// (accepted|delivered) cujo effectId NÃO está em appliedAcceptedEffectIds e TEM um pendingPhotoAction. Isso acontece
// se a promoção falhou (CAS/transiente) DEPOIS do dispatch. Reprocessa via applyAcceptedPhotoActionOutcome (idempotente,
// SEM redispatch — a mídia já foi enviada; isto é só escrita de WorkingMemory). Um scheduler/poller pode chamar isto
// periodicamente; sobrevive a restart (o rastro está no estado persistido).
// ============================================================================
export async function reconcileAcceptedPhotoOutcomes(args: {
  readonly persistence: Persistence;
  readonly conversationId: string;
}): Promise<{ reconciled: number; failed: number; pending: number }> {
  const { persistence, conversationId } = args;
  const snapshot = await persistence.load(conversationId);
  if (!snapshot) return { reconciled: 0, failed: 0, pending: 0 };
  const applied = new Set(snapshot.state.appliedAcceptedEffectIds ?? []);
  const drafts = snapshot.state.pendingPhotoActions ?? {};
  const outbox = await persistence.listOutbox(conversationId);
  let reconciled = 0, failed = 0, pending = 0;
  for (const rec of outbox) {
    if (rec.kind !== "send_media" || rec.status !== "succeeded") continue;
    if (rec.receiptLevel !== "accepted" && rec.receiptLevel !== "delivered") continue;
    if (applied.has(rec.effectId)) continue;   // já promovido
    if (!drafts[rec.effectId]) continue;        // sem draft rastreado (não é ação de foto do central)
    pending += 1;
    const pr = rec.providerReceipt;
    const receiptAt = (pr && typeof pr === "object" && !Array.isArray(pr) && typeof (pr as { at?: unknown }).at === "string")
      ? (pr as { at: string }).at : (rec.terminalAt ?? rec.createdAt);
    const result: EffectResult = { status: "succeeded", effectId: rec.effectId, receipt: { effectId: rec.effectId, level: rec.receiptLevel, at: receiptAt } };
    const r = await applyAcceptedPhotoActionOutcome({ persistence, conversationId, effectId: rec.effectId, result });
    if (r.ok && r.applied) reconciled += 1; else if (!r.ok) failed += 1;
  }
  return { reconciled, failed, pending };
}
