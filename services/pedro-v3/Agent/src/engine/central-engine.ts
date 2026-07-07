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
  DecisionMutation, ProposedDecision, ProposedEffectPlan, QueryCall, QueryResult, TurnAction, TurnDecision, EffectResult, ResponseDraft,
} from "../domain/decision.ts";
import type {
  AgentBrainPort, AgentBrainDecision, AgentToolObservation, CentralQueryCall, PersistedWorkingMemory,
  PhotoActionDraft, ToolResultMemory, ToolTelemetry, WorkingMemoryV1, BusinessInfoTopic, CurrentTurnIntent, FrameSignals,
  TurnUnderstanding,
} from "../domain/agent-brain.ts";
import {
  validateTurnUnderstanding, deriveFallbackUnderstanding, authorizesPhotoSend, isPhotoRecall, isStockSearchTurn,
  resolveTurnTarget, reconcileUnderstanding, targetAcceptsKey, denyFingerprint, isPhotoDeclined,
  toolCapabilityAuthorized, selectAuthorized, authorizesPhotoByResolvedOrdinal,
  type ValidatedUnderstanding, type TargetResolution, type TargetResolutionSource, type KnownVehicleModel,
} from "./turn-understanding.ts";
import { shouldSupersedeStaleBlock, DEFAULT_DEBOUNCE_CONFIG } from "./debounce-policy.ts";
import { detectQuestionRepetition } from "./question-repetition.ts";
import { detectCommercialConstraints, sufficientForStockSearch, canonicalBrand, describeConstraints, mergeActiveConstraints, constraintsToStockInput, detectCorrections, activeConstraintsFromStockInput, mentionsMotorcycle, deriveScopeFromHomogeneousOffer, type CommercialConstraints } from "./commercial-constraints.ts";
import { detectDisengagement, type LeadEngagement } from "./lead-intent.ts";
import { extractAdVehicleConstraints, adHasVehicle, refersToAd, isBareGreeting, sanitizeAdContext } from "./ad-context.ts";
import type { AdContext } from "../domain/conversation-state.ts";
import type { ClaimExtractor } from "../domain/decision.ts";
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
import { reconcileObjectiveWithQuestion, stripAllObjectiveMutations, type SdrQualificationPolicy } from "./sdr-conductor.ts";
import { buildTurnFrame, buildFrameSignals } from "./turn-frame-builder.ts";
import { institutionalTopicsRequested, mentionsContact } from "./turn-domain.ts";
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
  // LLM-FIRST (missão SDR real): quando true, o engine NÃO gerencia objetivo de funil (nada de
  // reconcileObjectiveWithQuestion) — o funil vira contexto read-only e o CÉREBRO decide a próxima pergunta/condução.
  // Guardrails (grounding/foto/CPF/erro/≤1 pergunta) continuam. central_active liga isto; legado mantém false.
  readonly llmFirst?: boolean;
  // TRAVA ANTI-PARCIAL (P0 bloco-do-lead): teto de espera do bloco. Se chegou mensagem nova durante o processamento e o
  // bloco ainda é mais jovem que isto, o turno é SUPERSEDED (não despacha; reagrupa). Default = maxWait do debounce.
  readonly blockAwaitMaxMs?: number;
};

export type ResponseSource = "brain_final" | "brain_retry" | "deterministic_recall" | "deterministic_photo" | "deterministic_institutional" | "deterministic_recovery" | "technical_fallback" | "legacy_compose";
// Fontes DEGRADADAS (o cérebro não autorou; o engine recuperou). deterministic_recovery = recuperação CONTEXTUAL aterrada
// (oferta/qual/honesto — texto útil, não genérico); technical_fallback = último recurso genérico. Ambas contam degraded.
const DEGRADED_SOURCES: ReadonlySet<ResponseSource> = new Set(["technical_fallback", "deterministic_recovery"]);
function isDegradedSource(src: ResponseSource): boolean { return DEGRADED_SOURCES.has(src); }

function requiredToolBeforeFinal(frame: ReturnType<typeof buildTurnFrame>, observations: readonly AgentToolObservation[], searchTurn: boolean, moreOptionsNeedsScope: boolean): string | null {
  const wasObserved = (tool: string) => observations.some((observation) =>
    observation.tool === tool && (observation.ok || observation.error.code !== "REQUIRED_TOOL_MISSING"));
  // T4 (fonte única): uma pergunta de DISPONIBILIDADE/estoque do turno atual (understanding.primaryIntent=search_stock,
  // já corrige typo "kiks"→Kicks pelo cérebro) EXIGE stock_search relevante antes do final — senão o cérebro responde o
  // assunto anterior sem buscar (e a memória de foto não pode assumir a busca). Gated em llmFirst para não forçar busca
  // no legado (onde o SDR pode acolher+perguntar o nome antes de listar — F2.13 [3c]).
  if (searchTurn && !wasObserved("stock_search")) {
    return "O cliente deu filtro comercial suficiente NESTE turno (modelo, marca, tipo, faixa de preço, câmbio ou 'popular'). Chame stock_search com TODOS esses filtros (marca/modelo/tipo/precoMax/cambio/popular) ANTES de responder — corrija erros de digitação e NUNCA pergunte 'qual modelo/tipo você procura?' quando ele já informou. Se não houver estoque, seja honesto e ofereça algo parecido na mesma faixa.";
  }
  // "mais opções" exige nova busca — MAS só quando há ESCOPO recuperável (F2.29). Sem escopo (nem filtro ativo, nem
  // oferta homogênea derivável) NÃO se força busca genérica: o engine PERGUNTA o escopo (executor determinístico). Forçar
  // uma busca sem filtro devolveria lista genérica (o bug do print: "tem outros?" -> carros baratos aleatórios + moto).
  if (frame.signals.mentionsMoreOptions && !wasObserved("stock_search") && !moreOptionsNeedsScope) {
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
      // T6 (fonte única): semântica do turno + resolução de alvo + recuperação (observabilidade e testes).
      understanding: TurnUnderstanding;
      understandingFromBrain: boolean;
      targetResolutionSource: TargetResolutionSource | null;
      resolvedVehicleKey: string | null;
      previousSelectedVehicleKey: string | null;
      recoveryReason: string | null;
    }
  | { status: "commit_failed"; turnId: Id; claimedEventIds: Id[]; reason: string }
  // TRAVA ANTI-PARCIAL (P0 bloco-do-lead): chegou mensagem nova durante o processamento -> NÃO despachou (o claim foi
  // devolvido; o poller reagrupa o bloco completo). Não é erro: o dispatcher ignora e o próximo tick reprocessa.
  | { status: "superseded"; turnId: Id; claimedEventIds: Id[]; pendingCount: number };

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
// F2.32 (CTWA): o contexto de anúncio viaja no `raw.adContext` do inbox (o bridge o coloca na 1ª mensagem). Lê o PRIMEIRO
// da rajada (sanitizado). Ausente -> null (o engine herda do state = recuperação de rajada).
function adContextFromInbox(records: InboxRecord[]): AdContext | null {
  const ordered = [...records].sort((a, b) => {
    const ta = Date.parse(a.receivedAt), tb = Date.parse(b.receivedAt);
    if (ta !== tb) return ta - tb;
    return a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0;
  });
  for (const rec of ordered) {
    const raw = rec.raw as Record<string, unknown>;
    const ad = raw.adContext;
    if (ad && typeof ad === "object") {
      const capturedRaw = (ad as Record<string, unknown>).capturedAtTurn;
      const sanitized = sanitizeAdContext(ad, typeof capturedRaw === "number" ? capturedRaw : 0);
      if (sanitized) return sanitized;
    }
  }
  return null;
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
  // P0 (RESOLUÇÃO ÚNICA): DEDUP de select_vehicle_focus — para o MESMO vehicleKey, só a ÚLTIMA seleção do turno vale
  // (o cérebro + o ordinal determinístico podiam emitir duas mutações idênticas). Preserva a ordem das demais mutações.
  const lastSelectIdxByKey = new Map<string, number>();
  muts.forEach((m, i) => { if (m.op === "select_vehicle_focus") lastSelectIdxByKey.set(m.vehicle.key, i); });
  for (let i = 0; i < muts.length; i++) {
    const m = muts[i];
    if (m.op !== "select_vehicle_focus") { mutations.push(m); continue; }
    if (lastSelectIdxByKey.get(m.vehicle.key) !== i) continue;   // dedup: há uma seleção POSTERIOR do mesmo key
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

// DEGRADAÇÃO OBSERVÁVEL (T5): quando o cérebro não aterra no limite, o TEXTO ao lead vem de buildContextualRecovery
// (contextual/honesto, nunca "não consegui confirmar"/"reformule"). O marcador interno technical_fallback fica só p/
// observabilidade (degraded=true). Não existe mais fala genérica no outbox do central_active.

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
    // P0 (LLM-first): constraints comerciais determinísticos do turno. O engine só PREENCHE LACUNAS da chamada — o
    // valor explícito do cérebro SEMPRE vence (nunca sobrescreve marca/modelo/tipo/preço/câmbio que o cérebro já pôs).
    readonly constraints?: CommercialConstraints;
    // F2.29: o lead pediu MOTO explicitamente -> libera moto na busca (default do estoque é EXCLUIR moto de lista de carro).
    readonly wantsMotorcycle?: boolean;
    // INC3 (F2.30): clampa o excludeKeys ao APRESENTADO (só central_active/llmFirst; shadow/legado mantém a união antiga).
    readonly enforceShownClamp?: boolean;
  },
): QueryCall {
  if (call.tool !== "stock_search") return call;
  const brainExcludeInput = (Array.isArray(call.input.excludeKeys) ? call.input.excludeKeys : []).filter((k): k is string => typeof k === "string" && k.length > 0);
  let excludeKeys: string[] | undefined;
  if (options.enforceShownClamp) {
    // INC3 (F2.30): o excludeKeys é CLAMPADO ao que o lead REALMENTE viu (previousVehicleKeys = conjunto CUMULATIVO de
    // veículos APRESENTADOS). O cérebro NUNCA pode esconder estoque que não mostrou: a proposta dele é filtrada ao
    // apresentado. Em "mais opções" exclui TODO o apresentado (não re-mostra). Bug do Compass: o cérebro passava as 17
    // keys que VIU no resultado da busca — escondendo os 2 Compass nunca exibidos ("não temos outros" falso).
    const shown = new Set(options.previousVehicleKeys.filter((key): key is string => typeof key === "string" && key.length > 0));
    const brainExcludes = brainExcludeInput.filter((k) => shown.has(k));
    const excludeList = options.moreOptions ? [...shown] : brainExcludes;
    excludeKeys = excludeList.length > 0 ? excludeList : undefined;
  } else {
    // Legado/shadow (comportamento antigo): honra o excludeKeys do cérebro e une as keys da última oferta em "mais opções".
    const previous = options.moreOptions
      ? options.previousVehicleKeys.filter((key): key is string => typeof key === "string" && key.length > 0)
      : [];
    const merged = previous.length > 0 ? [...new Set([...brainExcludeInput, ...previous])] : brainExcludeInput;
    excludeKeys = merged.length > 0 ? merged : undefined;
  }
  // Lacunas preenchidas com o constraint do turno (o do cérebro vence; marca canonicalizada volks->volkswagen).
  const c = options.constraints;
  const filled: Partial<QueryCall["input"]> = {};
  if (c) {
    if (call.input.marca == null && c.marca) (filled as { marca?: string }).marca = canonicalBrand(c.marca);
    if (call.input.modelo == null && c.modelos && c.modelos.length > 0) {
      (filled as { modelo?: string }).modelo = c.modelos.join(" ");
      if (c.modelos.length > 1 && call.input.broad == null) (filled as { broad?: boolean }).broad = true;
    }
    if (call.input.tipo == null && c.tipo) (filled as { tipo?: typeof c.tipo }).tipo = c.tipo;
    if (call.input.precoMax == null && c.precoMax != null) (filled as { precoMax?: number }).precoMax = c.precoMax;
    if (call.input.cambio == null && c.cambio) (filled as { cambio?: typeof c.cambio }).cambio = c.cambio;
  }
  // INC3: DROPA o excludeKeys ORIGINAL do cérebro (nunca passa verbatim) — só entra o CLAMPADO (ou nada).
  const { excludeKeys: _brainExcludeDropped, ...restInput } = call.input;
  return {
    ...call,
    input: {
      ...restInput,
      ...filled,
      ...(options.popular || c?.popular ? { popular: true } : {}),
      ...(excludeKeys ? { excludeKeys } : {}),
      // F2.29: só libera moto se o lead pediu moto OU o cérebro já marcou includeMotorcycles. Senão, DEFAULT exclui.
      ...(options.wantsMotorcycle || call.input.includeMotorcycles === true ? { includeMotorcycles: true } : {}),
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
  readonly selectionTurn?: boolean;   // P0-sel: o lead está selecionando um veículo -> feedback específico se citar atributo
  readonly institutionalObs?: ReadonlyMap<BusinessInfoTopic, AgentToolObservation>;   // completude: tópicos institucionais resolvidos
  readonly photoVU: ValidatedUnderstanding | null;   // FONTE ÚNICA: vU que autoriza foto (llmFirst=cérebro; senão fallback)
  readonly requireBrain: boolean;                    // P0-2: em llmFirst, send_media exige understanding do cérebro
  readonly target: TargetResolution;                 // P0-1: alvo do assunto (candidateVehicleKeys verificados por modelo)
}): SingleAuthorResult {
  const draft = args.finalDecision.responsePlan.draft;
  if (!draft || draft.parts.length === 0) {
    return { ok: false, feedback: "Devolva 'draft' com parts estruturadas (text/vehicle_ref/money_ref/vehicle_offer_list). Não escreva km/cor/câmbio/ano/preço em texto livre." };
  }
  // P0-sel (missão): numa SELEÇÃO, quando o grounding falha (o cérebro citou km/cor/câmbio/preço sem vehicle_details), o
  // feedback é ESPECÍFICO — acolha a escolha e ofereça o próximo passo, NÃO cite atributo sem consultar. (Sem isto o
  // cérebro insistia em descrever o carro e degradava em technical_fallback.)
  const SELECTION_ATTR_FEEDBACK = "Você pode ACOLHER a escolha do cliente e oferecer o próximo passo (fotos, detalhes ou condições), mas NÃO cite km/cor/câmbio/preço/ano sem antes consultar vehicle_details do carro selecionado. Responda curto e humano, sem atributos.";
  const sendMediaKeys = args.finalDecision.proposedEffects.filter((e) => e.kind === "send_media").map((e) => e.vehicleKey).filter((k): k is string => typeof k === "string" && k !== "");
  // P0-2 (audit Codex): em llmFirst, send_media exige understanding VÁLIDO DO CÉREBRO. Sem ele -> REQUIRED_TURN_UNDERSTANDING
  // (retry); o fallback regex NUNCA autoriza mídia na produção.
  if (args.requireBrain && sendMediaKeys.length > 0 && !(args.photoVU?.fromBrain && args.photoVU.trusted)) {
    return { ok: false, feedback: "Para ENVIAR foto (send_media) você precisa declarar no MESMO passo um 'understanding' válido com requestedCapabilities incluindo 'send_photos' e uma evidence citando o TRECHO do bloco onde o cliente pediu foto. Sem isso, não envie mídia." };
  }
  // T2 (fonte única): a AUTORIDADE de enviar foto é a SEMÂNTICA (authorizesPhotoSend: capability send_photos com
  // evidência PRÓPRIA que menciona foto, sem negação, não é memória) — nunca regex de frase. Recall nunca envia mídia.
  const photoAuthorized = authorizesPhotoSend(args.photoVU, args.leadMessage, args.requireBrain);
  const photoRecall = isPhotoRecall(args.photoVU);
  // P0-1 (audit Codex): CONFLITO — subjectValue do understanding não corresponde ao modelo ESCRITO pelo cliente ->
  // entendimento INVÁLIDO. Nunca envia mídia; pede correção do subject (o claim escrito manda).
  if (args.target.kind === "conflict" && (sendMediaKeys.length > 0 || photoAuthorized)) {
    return { ok: false, feedback: "Seu 'understanding.subjectValue' NÃO corresponde ao modelo que o cliente ESCREVEU no bloco. O modelo do texto do cliente é a AUTORIDADE — corrija subject/subjectValue para ele antes de qualquer ação e NÃO envie foto de outro carro." };
  }
  if (!photoAuthorized && (sendMediaKeys.length > 0 || reasonCodeIsPhotoSend(args.finalDecision.reasonCode))) {
    return { ok: false, feedback: PHOTO_NOT_REQUESTED_FEEDBACK };
  }
  // P0-1 (audit Codex): a foto autorizada TEM de ser do ALVO do assunto (key ∈ candidateVehicleKeys verificados por
  // modelo). Foto do carro ERRADO (ex.: pediu Kicks, resolveu Onix) -> REJEITA + feedback; nunca envia o carro errado.
  if (photoAuthorized && sendMediaKeys.some((k) => !targetAcceptsKey(args.target, k))) {
    const alvo = args.target.kind !== "conflict" && args.target.subjectModel ? `o ${args.target.subjectModel}` : "o carro que o cliente pediu";
    return { ok: false, feedback: `A foto que você resolveu NÃO é de ${alvo}. Resolva vehicle_photos_resolve do vehicleKey CORRETO do assunto atual (o carro que o cliente citou/selecionou) — nunca envie a foto de outro veículo. Se houver mais de uma variante possível, pergunte QUAL antes de enviar.` };
  }
  const brainEffects = photoAuthorized ? args.finalDecision.proposedEffects : args.finalDecision.proposedEffects.filter((e) => e.kind !== "send_media");
  const proposedEffects = ensureSendMessage(brainEffects);
  // P0-2 (audit Codex): filtra select_vehicle_focus proposto pela LLM SEM capability select + evidência (descarta; o foco
  // não muda). Ordinal determinístico válido (target=turn_ordinal do mesmo key) AINDA seleciona. Só em llmFirst (requireBrain).
  const rawStateMutations = args.finalDecision.stateMutations ?? [];
  const stateMutations = args.requireBrain
    ? rawStateMutations.filter((m) => {
        if (m.op !== "select_vehicle_focus") return true;
        const ordinalOk = args.target.kind === "resolved" && args.target.source === "turn_ordinal" && args.target.vehicleKey === m.vehicle.key;
        return ordinalOk || selectAuthorized(args.photoVU);
      })
    : rawStateMutations;
  const proposal: ProposedDecision = {
    proposedAction: deriveProposedAction(proposedEffects),
    facts: [...stateMutations],
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
    if (args.selectionTurn) return { ok: false, feedback: SELECTION_ATTR_FEEDBACK };
    return { ok: false, feedback: `Uma parte cita um FATO ausente/não consultado (${String((err as Error)?.message ?? err).slice(0, 140)}). Chame vehicle_details do vehicleKey ANTES de afirmar km/cor/câmbio/preço, ou diga em text que vai confirmar.` };
  }
  // T2: mesmo sem send_media/reasonCode, o TEXTO não pode PROMETER foto num turno que não autoriza foto (e não é recall,
  // que legitimamente NOMEIA a foto lembrada). Guarda de OUTPUT (não classifica o turno) — a autoridade é photoAuthorized.
  if (!photoAuthorized && !photoRecall && textPromisesPhoto(composed.text)) {
    return { ok: false, feedback: PHOTO_NOT_REQUESTED_FEEDBACK };
  }
  // P0-2 (audit): a resposta ao lead NUNCA pode conter LITERALMENTE uma vehicleKey conhecida (chave/código interno).
  for (const k of knownVehicleKeys(realFacts, args.identities, args.ctx.state)) {
    if (composed.text.includes(k)) return { ok: false, feedback: `Você escreveu a chave interna do veículo ("${k}") na resposta. Use o NOME do carro (marca modelo ano), NUNCA a chave/código interno.` };
  }
  // Valida contra fatos REAIS (identidade de memória NÃO aterra atributo/oferta).
  const gv = PolicyEngine.validateResponse(composed, realFacts, decision0, args.ctx);
  if (hasDeny(gv)) return { ok: false, feedback: args.selectionTurn ? SELECTION_ATTR_FEEDBACK : sanitizePolicyFeedback(gv) };
  // COMPLETUDE (prompt-first): a resposta não pode IGNORAR um pedido explícito (horário/endereço/unidade/foto). Grounding
  // ok mas pediu horário e respondeu só endereço -> feedback ao MESMO cérebro (retry). Não reescreve, não decide o assunto.
  // P0 (RESOLUÇÃO ÚNICA): foto pedida = semântica do cérebro OU ordinal resolvido + pedido explícito ("foto do segundo").
  // Sem isto, quando o cérebro rotula "foto do segundo" só como seleção, ele podia ignorar a foto e passar batido.
  const incomplete = turnCompletenessFeedback({ leadMessage: args.leadMessage, composed, institutionalObs: args.institutionalObs ?? new Map(), proposedEffects, pendingObjective: args.ctx.state.currentObjective?.status === "pending", photoRequested: photoAuthorized || authorizesPhotoByResolvedOrdinal(args.target, args.leadMessage) });
  if (incomplete) return { ok: false, feedback: incomplete };
  // P0 (ANTI-REPETIÇÃO): em llmFirst, não repergunte um slot JÁ CONHECIDO (nome/interesse/tipo/preço) nem repita uma
  // pergunta recente do agente. Devolve feedback ao MESMO cérebro (retry) — nunca reescreve o texto aqui. (Incidente:
  // "Qual seu nome?"/"o que você procura?" reperguntados turno após turno mesmo com o nome já conhecido.)
  if (args.requireBrain) {
    const slots = args.ctx.state.slots;
    const rep = detectQuestionRepetition({
      finalText: composed.text,
      slotsKnown: {
        nome: slots.nome?.status === "known",
        interesse: slots.interesse?.status === "known",
        tipoVeiculo: slots.tipoVeiculo?.status === "known",
        faixaPreco: slots.faixaPreco?.status === "known",
      },
      recentTurns: args.ctx.state.recentTurns ?? [],
    });
    if (rep) return { ok: false, feedback: rep.feedback };
  }
  return { ok: true, decision: decision0, composed, proposedEffects };
}

// B2 (audit): para pergunta de ATRIBUTO do veículo SELECIONADO, o turno EXIGE um vehicle_details BEM-SUCEDIDO do MESMO
// vehicleKey antes do final. Sem esse fato -> mensagem que força a consulta (o cérebro devolve query). Detalhe de OUTRO
// vehicleKey NÃO satisfaz. Sem veículo selecionado -> null (o cérebro pede esclarecimento; nunca consulta arbitrário).
// P0-sel (missão): SÓ exige detalhe quando o lead REALMENTE pergunta um atributo (km/cor/câmbio/preço/ano/consumo/...).
// Uma SELEÇÃO ("gostei do segundo", "esse") pode vir classificada como asks_vehicle_detail pelo preparer — mas sem
// pergunta de atributo NÃO deve forçar vehicle_details (o cérebro acolhe a escolha; citar atributo é barrado no validate).
const ATTR_QUESTION_RX = /\bkm\b|quilometr|rodad|\bcor\b|\bcambio\b|c[aâ]mbio|autom[aá]tic|\bmanual\b|\bpre[çc]o\b|\bvalor\b|quanto\s+(?:custa|sai|fica|e)\b|\bano\b|\bconsumo\b|\bmotor\b|\bversao\b|vers[aã]o|\bopcionais\b|\bcompleto\b|quantos?\s+(?:km|quilometr)/;
function requireVehicleDetailBeforeFinal(frame: ReturnType<typeof buildTurnFrame>, observations: readonly AgentToolObservation[]): string | null {
  if (frame.signals.relation !== "asks_vehicle_detail") return null;
  if (!ATTR_QUESTION_RX.test(normalizeText(frame.block))) return null;   // seleção pura -> não força detalhe
  const selectedKey = frame.workingMemory.selectedVehicle?.vehicleKey ?? null;
  if (!selectedKey) return null;
  const hasDetail = observations.some((o) => o.tool === "vehicle_details" && o.ok && o.data.vehicle.vehicleKey === selectedKey);
  if (hasDetail) return null;
  return `O cliente perguntou um atributo do veículo SELECIONADO. Execute vehicle_details({"vehicleKey":"${selectedKey}"}) e use SÓ esse fato (de OUTRO carro não vale) antes da resposta final.`;
}

// audit institucional: detecção GERAL dos tópicos pedidos no bloco (address/hours/unit) — agora em turn-domain.ts,
// compartilhada com policy-engine para o ROTEAMENTO POR DOMÍNIO (institucional não aplica policy de veículo/funil).

// ── P0 (audit TRAVA DE CONTEXTO): intenção do TURNO ATUAL (só do bloco corrente) e limpeza de foto stale ──────────
// Orçamento/faixa de preço = evidência de busca comercial. normalizeText remove acentos.
const BUDGET_RX = /\bate\s+\d|\br\$\s*\d|\b\d{2,3}\s*mil\b|\bbarat|\beconomic|\bfaixa\s+de\s+pre|\bor[çc]amento\b/;
function isFreshSearchTurn(leadMessage: string, signals: FrameSignals, claimExtractor: ClaimExtractor): boolean {
  if (signals.mentionsVehicleType != null || signals.mentionsMoreOptions || signals.mentionsPopular === true) return true;
  if (BUDGET_RX.test(normalizeText(leadMessage))) return true;
  return claimExtractor.extractClaims(leadMessage).some((c) => c.kind === "model" || c.kind === "brand_model" || c.kind === "brand");
}
// Precedência: memória de foto > pedido de foto > institucional > busca nova > outro. Deriva SÓ do bloco atual.
export function deriveCurrentTurnIntent(leadMessage: string, signals: FrameSignals, claimExtractor: ClaimExtractor): CurrentTurnIntent {
  if (isPhotoMemoryQuestionBlock(leadMessage)) return "photo_memory";
  if (isPhotoRequestBlock(leadMessage)) return "photo_request";
  if (institutionalTopicsRequested(leadMessage).length > 0) return "institutional";
  if (isFreshSearchTurn(leadMessage, signals, claimExtractor)) return "search";
  return "other";
}
// Quando o TURNO ATUAL é uma busca nova, memória velha de FOTO não pode conduzir: zera activeTopic/currentLeadIntent
// de foto no FRAME que o cérebro vê. A memória PERSISTIDA fica intacta (o cérebro re-seta o tópico correto no turno).
// Só afeta o frame. PURO.
export function clearStalePhotoIntent(wm: WorkingMemoryV1, currentTurnIntent: CurrentTurnIntent): WorkingMemoryV1 {
  if (currentTurnIntent !== "search") return wm;
  const topicIsPhoto = wm.activeTopic != null && /foto|photo/i.test(wm.activeTopic.topic);
  const intentIsPhoto = wm.currentLeadIntent?.intent === "photo_request" || wm.currentLeadIntent?.intent === "photo_memory_question";
  if (!topicIsPhoto && !intentIsPhoto) return wm;
  return { ...wm, activeTopic: topicIsPhoto ? null : wm.activeTopic, currentLeadIntent: intentIsPhoto ? null : wm.currentLeadIntent };
}

// ── P0-B (audit): num turno que NÃO pede foto, a resposta não pode PROMETER foto (texto), ter reasonCode de foto,
//    nem send_media. Guarda determinística no author + fallback. ─────────────────────────────────────────────────
// Fix 1 (diag conv2): reasonCode por ALLOW/DENY EXATO — bloqueia SÓ códigos que significam ENVIO/promessa ATIVA de foto.
// NUNCA bloqueia códigos de RECUSA/negação/continuidade ("respect_photo_decline_and_offer_next_step" etc.) que contêm a
// substring "photo" mas NÃO enviam nada (era a causa do technical_fallback do T10).
const PHOTO_SEND_REASON_CODES = new Set(["send_photos", "send_vehicle_photos", "photo_send", "vehicle_photo_send", "send_media_photo"]);
function reasonCodeIsPhotoSend(code: string | null | undefined): boolean {
  return typeof code === "string" && PHOTO_SEND_REASON_CODES.has(code.trim().toLowerCase());
}
// Fix 2 (diag conv2): SÓ ENVIO ATIVO/promessa assertiva de foto — NUNCA uma OFERTA interrogativa ("quer que eu te envie
// as fotos?", "posso te mandar fotos?", "prefere fotos ou condições?"). Verbos no INDICATIVO (vou/estou/enviei/mandei) +
// "aqui estão"/"segue" = envio ativo; o subjuntivo "envie" (após "quer que eu te...") NÃO entra -> oferta passa.
const PHOTO_ACTIVE_SEND_RX = /\baqui\s+est[aã]o?\s+as\s+fotos\b|\bseguem?\s+(?:as\s+)?fotos\b|\b(?:vou|irei|vamos)\s+(?:te\s+|lhe\s+)?(?:enviar|mandar)\s+(?:as\s+)?fotos\b|\bestou\s+(?:te\s+|lhe\s+)?(?:enviando|mandando)\s+(?:as\s+)?fotos\b|\b(?:te\s+|lhe\s+)?(?:enviei|mandei)\s+(?:as\s+)?fotos\b|\benviando\s+as\s+fotos\b|\bmandando\s+as\s+fotos\b|\bfotos\s+do\s+carro\s+que\s+voce\s+pediu\b/;
function textPromisesPhoto(text: string): boolean { return PHOTO_ACTIVE_SEND_RX.test(normalizeText(text)); }
const PHOTO_NOT_REQUESTED_FEEDBACK = "O cliente NÃO pediu fotos neste turno — ele pediu outra coisa (provavelmente uma busca). NÃO prometa nem envie fotos e NÃO use reasonCode de foto. Responda o que ele pediu AGORA: se for busca de carro (tipo/modelo/orçamento/popular/mais opções), devolva {\"kind\":\"query\",\"call\":{\"tool\":\"stock_search\",...}} e depois liste; senão responda a pergunta atual dele.";

// ── COMPLETUDE DO TURNO (missão prompt-first 2026-07-04): validação LEVE que NÃO decide a conversa nem reescreve —
//    só impede que a resposta IGNORE um pedido EXPLÍCITO do lead. Se o lead pediu X e a resposta não trouxe X (o valor
//    OU a ausência honesta), devolve feedback ao MESMO cérebro (retry). LLM-first: o cérebro re-autora respondendo o
//    tópico pedido. Cobre address/hours/unit (institucional) e foto. km/cor/câmbio/preço e estoque JÁ são cobertos por
//    requireVehicleDetailBeforeFinal + POL-ATTR-VALUE + requiredToolBeforeFinal (não duplicar aqui). ────────────────
const INST_TOPIC_LABEL: Record<BusinessInfoTopic, string> = { address: "o ENDEREÇO/localização da loja", hours: "o HORÁRIO de funcionamento", unit: "a UNIDADE/loja" };
// Sinal de que a resposta TOCOU o tópico (valor exato falhou, mas o cérebro respondeu o assunto — incl. ausência honesta
// "não tenho o horário configurado"). normalizeText remove acentos.
const INST_TOPIC_SIGNAL: Record<BusinessInfoTopic, RegExp> = {
  address: /\benderec|\bfica(?:mos)?\s+(?:na|no|em)\b|\bavenida\b|\bav\.?\s|\brua\b|\brodovia\b|\bbairro\b|\bnumero\b|\blocaliza|\bmapa\b|\bestacionament|\bshopping\b/,
  hours: /\bhorario|\bfuncion|\batende|\baberto|\bfecha|\d{1,2}\s*h\b|\bhoras?\b|\bsegunda\b|\bs[aá]bado\b|\bdomingo\b|\bdias?\s+[uú]tei/,
  unit: /\bunidade|\bloja\b|\bfilial|\bmatriz/,
};
function respondsInstitutionalTopic(normResp: string, topic: BusinessInfoTopic, obs: AgentToolObservation | undefined): boolean {
  // Tópico RESOLVIDO: aceita se a resposta cita um token significativo do VALOR (o cérebro usou o fato).
  if (obs?.ok && obs.tool === "tenant_business_info") {
    const val = normalizeText(obs.data.value);
    const tokens = topic === "hours" ? (val.match(/\d{1,2}\s*h/g) ?? []) : val.split(/[\s,]+/).filter((w) => w.length >= 4).slice(0, 5);
    if (tokens.some((tok) => normResp.includes(tok.trim()))) return true;
  }
  // Senão, aceita se a resposta ao menos TOCOU o tópico (paráfrase OU ausência honesta) — prompt-first: o cérebro pode
  // responder do prompt mesmo quando a tool diz NOT_CONFIGURED; e a ausência honesta é resposta válida.
  return INST_TOPIC_SIGNAL[topic].test(normResp);
}
// Foto pedida e não atendida: precisa send_media OU dizer honestamente que não localizou (oferta interrogativa não conta).
const PHOTO_HONEST_ABSENCE_RX = /\bnao\s+(?:encontrei|localizei|achei|tenho|consegui|temos)\b[^.?!]{0,28}(?:fotos?|imagens?|midias?)|(?:fotos?|imagens?)[^.?!]{0,28}(?:nao\s+(?:disponiv|encontr|localiz)|indisponiv)/;
function turnCompletenessFeedback(args: {
  readonly leadMessage: string;
  readonly composed: RenderedResponse;
  readonly institutionalObs: ReadonlyMap<BusinessInfoTopic, AgentToolObservation>;
  readonly proposedEffects: readonly ProposedEffectPlan[];
  readonly pendingObjective: boolean;   // objetivo pendente (ex.: pagamento) -> policy pode ter prioridade sobre a foto
  readonly photoRequested: boolean;     // T2 (fonte única): o turno autoriza foto pela semântica (não regex de frase)
}): string | null {
  const normResp = normalizeText(args.composed.text);
  // Institucional: cada tópico PEDIDO tem que aparecer na resposta (valor ou ausência honesta), senão foi ignorado.
  for (const topic of institutionalTopicsRequested(args.leadMessage)) {
    if (respondsInstitutionalTopic(normResp, topic, args.institutionalObs.get(topic))) continue;
    return `O cliente pediu ${INST_TOPIC_LABEL[topic]} NESTE turno e a sua resposta não trouxe isso (respondeu outro assunto no lugar). Responda ${INST_TOPIC_LABEL[topic]} usando o dado do seu prompt/tenant_business_info — ou, se realmente não houver, diga honestamente que não tem essa informação. Se ele pediu MAIS de uma coisa no mesmo turno (ex.: horário E foto), responda TODAS, não só uma.`;
  }
  // Foto: pediu foto -> send_media OU ausência honesta. (A oferta "quer que eu te envie?" não satisfaz um pedido explícito.)
  // CEDE quando há objetivo PENDENTE: uma policy de prioridade (ex.: POL-TRACK-001, responder pagamento não vira foto)
  // pode ter legitimamente redirecionado o turno — não reexigir a foto que a policy acabou de barrar.
  if (!args.pendingObjective
      && args.photoRequested
      && !args.proposedEffects.some((e) => e.kind === "send_media")
      && !PHOTO_HONEST_ABSENCE_RX.test(normResp)) {
    return "O cliente pediu FOTO neste turno e a resposta não enviou (send_media) nem disse honestamente que não localizou. Resolva vehicle_photos_resolve do carro certo e inclua send_media com os photoIds — ou diga que não encontrou as fotos. NÃO responda só outro assunto ignorando o pedido de foto.";
  }
  return null;
}

// ── P0-C (audit): EXECUTOR DETERMINÍSTICO de foto. Usado no single-author quando o cérebro NÃO autorou resposta
//    aterrada. Pedido de foto + alvo resolvido (ordinal/modelo da última lista ou selecionado) + vehicle_photos_resolve
//    OK com photoIds -> materializa send_media (nunca fallback genérico). Sem alvo/lista -> pede qual veículo (não
//    consulta arbitrário). Alvo resolvido mas sem photoIds -> honesto e específico. PURO. ───────────────────────────
function buildDeterministicPhotoResponse(args: {
  readonly leadMessage: string;
  readonly ctx: TurnContext;
  readonly facts: readonly QueryResult[];
  readonly identities: readonly RememberedVehicleIdentity[];
  readonly turnId: string;
  readonly photoVU: ValidatedUnderstanding | null;   // P0-2: vU que autoriza foto (llmFirst=cérebro; senão fallback)
  readonly requireBrain: boolean;
  readonly target: TargetResolution;                 // P0-1: alvo do assunto (verificado por modelo)
}): { decision: TurnDecision; composed: RenderedResponse; proposedEffects: ProposedEffectPlan[]; targetSource: TargetResolutionSource } | null {
  // P0-2: em llmFirst sem cérebro NÃO envia — EXCETO quando o alvo veio de turn_ordinal (índice EXATO da última lista) +
  // pedido explícito de foto: aí a resolução única autoriza (grounding máximo; nunca é "foto solta"). Some o "de qual carro?".
  if (!authorizesPhotoSend(args.photoVU, args.leadMessage, args.requireBrain) && !authorizesPhotoByResolvedOrdinal(args.target, args.leadMessage)) return null;
  const state = args.ctx.state;
  const factsArr = [...args.facts];
  const build = (proposedEffects: ProposedEffectPlan[], text: string, action: TurnAction, reasonCode: string, reasonSummary: string, confidence: number, targetSource: TargetResolutionSource) => {
    const proposal: ProposedDecision = { proposedAction: action, facts: [], proposedEffects, responsePlan: { guidance: text }, reasonCode, reasonSummary, confidence };
    const post = PolicyEngine.postQuery(proposal, factsArr, args.ctx);
    if (hasDeny(post)) return null;
    const decision = finalize(args.turnId, proposal, post, factsArr);
    return { decision, composed: { draft: { parts: [{ type: "text" as const, content: text }] }, text }, proposedEffects, targetSource };
  };
  // P0-1: o ALVO vem do ASSUNTO (ordinal/modelo verificado/pronome), NUNCA de um photo fact solto. Ambíguo/ausente -> pergunta.
  const target = args.target;
  const hasList = (state.lastRenderedOfferContext?.items?.length ?? 0) > 0;
  if (target.kind !== "resolved") {
    const text = target.kind === "ambiguous"
      ? `Temos mais de uma opção${target.subjectModel ? ` de ${target.subjectModel}` : ""}. De qual você quer as fotos? Me diz o número ou o ano.`
      : (hasList ? "De qual carro da lista você quer as fotos? Me diz o número ou o modelo." : "Claro! De qual carro você quer ver as fotos?");
    return build(ensureSendMessage([]), text, "clarify", "photo_clarify_which", "pedido de foto sem alvo único do assunto", 0.5, target.kind === "ambiguous" ? "ambiguous" : "none");
  }
  const targetKey = target.vehicleKey;
  const label = canonicalVehicleLabel(targetKey, args.facts, args.identities, state);
  // P0-1: a foto SÓ vale se o vehicle_photos_resolve for do ALVO (key ∈ candidates). Fato de outro carro é IGNORADO.
  const photos = args.facts.find(
    (f): f is Extract<QueryResult, { ok: true; tool: "vehicle_photos_resolve" }> =>
      f.ok && f.tool === "vehicle_photos_resolve" && f.data.vehicleKey === targetKey && targetAcceptsKey(target, f.data.vehicleKey) && f.data.photoIds.length > 0,
  );
  if (photos) {
    const media: ProposedEffectPlan = { kind: "send_media", planId: "photos", order: 1, onSuccess: [], vehicleKey: targetKey, photoIds: [...photos.data.photoIds] };
    const text = label ? `Aqui estão as fotos do ${label}. Quer que eu te passe mais detalhes dele?` : "Aqui estão as fotos que você pediu. Quer que eu te passe mais detalhes desse carro?";
    return build(ensureSendMessage([media]), text, "send_photos", "send_vehicle_photos", "executor determinístico de foto (alvo do assunto + photoIds reais)", 0.9, target.source);
  }
  const text = label ? `Não localizei as fotos do ${label} agora. Quer que eu te passe os detalhes dele por aqui?` : "Não localizei as fotos desse carro agora. Quer que eu te passe os detalhes dele por aqui?";
  return build(ensureSendMessage([]), text, "clarify", "photo_unavailable", "alvo resolvido mas sem photoIds do assunto", 0.4, target.source);
}

// ── P0 ROTEAMENTO POR DOMÍNIO (missão): RESPOSTA INSTITUCIONAL determinística. Se o lead pediu endereço/horário/loja e
//    a tool tenant_business_info RESOLVEU o tópico, o turno NUNCA vira technical_fallback — responde com os FATOS da tool
//    (não menu, não "não consegui confirmar"). Tópicos ok respondidos; NOT_CONFIGURED respondido honestamente. Não cita
//    carro, não usa vehicle_details, não pergunta funil. É o fallback determinístico MÍNIMO que a missão autoriza (§4). PURO.
function buildInstitutionalResponse(args: {
  readonly leadMessage: string;
  readonly institutionalObs: ReadonlyMap<BusinessInfoTopic, AgentToolObservation>;
  readonly ctx: TurnContext;
  readonly turnId: string;
}): { decision: TurnDecision; composed: RenderedResponse; proposedEffects: ProposedEffectPlan[] } | null {
  const topics = institutionalTopicsRequested(args.leadMessage);
  // audit Codex (§G): contato (instagram/site/telefone) não é topic da tool -> honesto (o prompt tem, mas o determinístico
  // não parseia; a resposta natural do cérebro é a via principal, isto é só o backstop honesto — nunca fallback técnico).
  if (topics.length === 0) {
    if (!mentionsContact(args.leadMessage)) return null;
    const text = "Sobre o nosso contato, deixa eu confirmar essa informação com a equipe e já te passo. Posso te ajudar em mais alguma coisa?";
    const pe = ensureSendMessage([]);
    const prop: ProposedDecision = { proposedAction: "reply", facts: [], proposedEffects: pe, responsePlan: { guidance: text }, reasonCode: "institutional_answer", reasonSummary: "contato institucional (honesto)", confidence: 0.7 };
    return { decision: finalize(args.turnId, prop, PolicyEngine.postQuery(prop, [], args.ctx), []), composed: { draft: { parts: [{ type: "text", content: text }] }, text }, proposedEffects: pe };
  }
  const clauses: string[] = [];
  for (const topic of topics) {
    const obs = args.institutionalObs.get(topic);
    if (obs?.ok && obs.tool === "tenant_business_info") {
      const v = obs.data.value;
      clauses.push(topic === "address" ? `a loja fica na ${v}` : topic === "hours" ? `nosso horário é ${v}` : `nossa unidade é ${v}`);
    } else {
      // NOT_CONFIGURED / falha -> honesto (nunca inventa). audit Codex (§F): mesmo TODOS ausentes gera resposta honesta.
      clauses.push(topic === "address" ? "sobre o endereço, ainda não tenho ele configurado aqui, mas confirmo com a equipe"
        : topic === "hours" ? "sobre o horário, ainda não tenho essa informação configurada aqui, mas confirmo com a equipe"
        : "sobre a unidade, ainda não tenho isso configurado aqui");
    }
  }
  const body = clauses.length === 1 ? clauses[0] : `${clauses.slice(0, -1).join(", ")} e ${clauses[clauses.length - 1]}`;
  const text = `Claro! ${body.charAt(0).toUpperCase()}${body.slice(1)}. Posso te ajudar em mais alguma coisa?`;
  const proposedEffects = ensureSendMessage([]);
  const proposal: ProposedDecision = { proposedAction: "reply", facts: [], proposedEffects, responsePlan: { guidance: text }, reasonCode: "institutional_answer", reasonSummary: "resposta institucional determinística (fatos da tool)", confidence: 0.9 };
  const decision = finalize(args.turnId, proposal, PolicyEngine.postQuery(proposal, [], args.ctx), []);
  return { decision, composed: { draft: { parts: [{ type: "text", content: text }] }, text }, proposedEffects };
}

// ── Fase 4 (Evidence H): DESINTERESSE. Lead desengajado -> resposta CURTA e humana, SEM lista/funil/pressão. Executor
//    determinístico (como o institucional): usado quando o cérebro não autora. NÃO empurra venda; deixa a porta aberta. ──
function buildDisengagementResponse(args: { readonly engagement: LeadEngagement; readonly ctx: TurnContext; readonly turnId: string }): { decision: TurnDecision; composed: RenderedResponse; proposedEffects: ProposedEffectPlan[] } {
  const text = args.engagement === "not_interested"
    ? "Sem problema! Se precisar de qualquer informação sobre os nossos veículos, fico por aqui à disposição. 😊"
    : "Tranquilo! Qualquer coisa que precisar sobre os veículos, é só me chamar. 😊";
  const pe = ensureSendMessage([]);
  const prop: ProposedDecision = { proposedAction: "reply", facts: [], proposedEffects: pe, responsePlan: { guidance: text }, reasonCode: "lead_disengaged", reasonSummary: "desinteresse -> resposta curta, sem funil/lista", confidence: 0.85 };
  const decision = finalize(args.turnId, prop, PolicyEngine.postQuery(prop, [], args.ctx), []);
  return { decision, composed: { draft: { parts: [{ type: "text", content: text }] }, text }, proposedEffects: pe };
}

// F2.29 (invariante 5): "mais opções/tem outros?" SEM escopo recuperável (nem filtro comercial ativo, nem oferta homogênea
// derivável) -> o engine PERGUNTA o escopo em vez de listar genérico. Determinístico, aterrado, honesto: não inventa lista,
// não mostra moto/carros aleatórios. Só dispara quando o cérebro não autorou resposta aceitável (fallback do else-branch).
function buildMoreOptionsScopeQuestion(args: { readonly ctx: TurnContext; readonly turnId: string }): { decision: TurnDecision; composed: RenderedResponse; proposedEffects: ProposedEffectPlan[] } {
  const text = "Claro! Pra te mostrar as opções certas, você quer ver outros de qual tipo (SUV, sedan, hatch, picape) ou faixa de valor?";
  const pe = ensureSendMessage([]);
  const prop: ProposedDecision = { proposedAction: "reply", facts: [], proposedEffects: pe, responsePlan: { guidance: text }, reasonCode: "more_options_needs_scope", reasonSummary: "mais opções sem escopo recuperável -> pergunta tipo/faixa (nunca lista genérico)", confidence: 0.8 };
  const decision = finalize(args.turnId, prop, PolicyEngine.postQuery(prop, [], args.ctx), []);
  return { decision, composed: { draft: { parts: [{ type: "text", content: text }] }, text }, proposedEffects: pe };
}

// ── T5: RECUPERAÇÃO CONTEXTUAL. Só APÓS a falha do cérebro (esgotou passos OU deny repetido). Usa TurnUnderstanding +
//    fatos REAIS do turno — NUNCA texto genérico ("não consegui confirmar"/"reformule"), NUNCA menu robótico fora de
//    contexto. SEMPRE devolve algo aterrado. Não é um chatbot paralelo: atua só na falha e só com o que o turno tem. ──
function buildContextualRecovery(args: {
  readonly vU: ValidatedUnderstanding;
  readonly leadMessage: string;
  readonly facts: readonly QueryResult[];
  readonly observations: readonly AgentToolObservation[];   // P1: diferenciar busca executada-vazia / falha / não-executada
  readonly identities: readonly RememberedVehicleIdentity[];
  readonly ctx: TurnContext;
  readonly turnId: string;
  readonly constraints?: CommercialConstraints;   // P0 (LLM-first): recuperação de busca NOMEIA o filtro (honesta, contextual)
}): { decision: TurnDecision; composed: RenderedResponse; proposedEffects: ProposedEffectPlan[]; recoveryReason: string; lastResort: boolean } {
  const u = args.vU.understanding;
  const state = args.ctx.state;
  const factsArr = [...args.facts];
  // lastResort = default GENÉRICO sem contexto (technical_fallback). Recuperações contextuais (oferta/qual/honesto) = false.
  const mk = (draft: ResponseDraft, text: string, action: TurnAction, reasonCode: string, recoveryReason: string, lastResort = false) => {
    const proposedEffects = ensureSendMessage([]);
    const proposal: ProposedDecision = { proposedAction: action, facts: [], proposedEffects, responsePlan: { guidance: text }, reasonCode, reasonSummary: recoveryReason, confidence: 0.6 };
    const decision = finalize(args.turnId, proposal, PolicyEngine.postQuery(proposal, factsArr, args.ctx), factsArr);
    return { decision, composed: { draft, text } as RenderedResponse, proposedEffects, recoveryReason, lastResort };
  };
  const plain = (text: string, action: TurnAction, reasonCode: string, recoveryReason: string, lastResort = false) => mk({ parts: [{ type: "text", content: text }] }, text, action, reasonCode, recoveryReason, lastResort);
  // NEGAÇÃO de foto ("não quero foto", "agora não"): ACOLHE e segue (não repergunta nada conhecido). Antes de tudo.
  if (isPhotoDeclined(args.leadMessage)) return plain("Sem problema! Quando quiser as fotos ou mais detalhes é só me falar. 😊", "reply", "recovery_photo_declined", "negação de foto -> acolhe e segue");
  // BUSCA (hint do entendimento OU há itens). P1: DIFERENCIA — executada com itens -> lista; executada 0 -> ausência REAL;
  // tool FALHOU -> indisponibilidade temporária; NÃO executada -> nunca afirma ausência, pergunta específica.
  // Busca (hint do entendimento OU há fato de estoque). NÃO usa constraint p/ rotear: o executor determinístico de busca
  // (F2.26) já garante um FATO de stock_search sempre que o turno é comercial — a recuperação lista/honesto pelo fato REAL.
  const searchHint = u.primaryIntent === "search_stock" || u.requestedCapabilities.includes("stock_search") || factsArr.some((f) => f.ok && f.tool === "stock_search");
  if (searchHint) {
    const stockRanOk = factsArr.some((f) => f.ok && f.tool === "stock_search");
    // P1 (audit Codex): QUALQUER falha REAL de stock_search = indisponibilidade — não só UPSTREAM. Exclui só erros de
    // CONTROLE do engine (não são falha da tool).
    const CONTROL_CODES = new Set(["REQUIRED_TOOL_MISSING", "DUP_TOOL", "FORBIDDEN", "REQUIRED_TURN_UNDERSTANDING"]);
    const stockFailed = args.observations.some((o) => o.tool === "stock_search" && !o.ok && !CONTROL_CODES.has(o.error.code));
    const itemKeys: string[] = [];
    for (const f of factsArr) if (f.ok && f.tool === "stock_search") for (const v of f.data.items) if (!itemKeys.includes(v.vehicleKey)) itemKeys.push(v.vehicleKey);
    if (itemKeys.length > 0) {
      const draft: ResponseDraft = { parts: [{ type: "text", content: "Encontrei estas opções pra você:" }, { type: "vehicle_offer_list", vehicleKeys: itemKeys.slice(0, 6) }, { type: "text", content: "Quer ver as fotos de alguma?" }] };
      try { return mk(draft, ResponseRenderer.render(draft, factsArr, state, args.identities), "reply", "recovery_offer", "busca com itens -> lista aterrada"); } catch { /* cai no honesto */ }
    }
    // P0: busca EXECUTADA com 0 itens -> honesto NOMEANDO o filtro (nunca "esse modelo"), com alternativa. O executor
    // determinístico (F2.26) garante que um turno comercial SEMPRE tem fato de estoque aqui — nunca uma promessa "vou
    // procurar" sem ação. Sem constraint (fato genérico) mantém o texto padrão.
    const desc = args.constraints ? describeConstraints(args.constraints) : "";
    if (stockRanOk) return plain(desc ? `Não achei ${desc} no estoque agora. Quer que eu amplie para outras opções parecidas na mesma faixa?` : "Procurei aqui e não encontrei esse modelo no estoque no momento. Quer que eu procure algo parecido na mesma faixa de preço?", "clarify", "recovery_stock_empty", "busca executada com 0 itens -> ausência real + similar");
    if (stockFailed) return plain("Tive uma instabilidade pra puxar o estoque agora. Me confirma o modelo que você procura que eu já verifico?", "clarify", "recovery_stock_failed", "tool de busca falhou -> indisponibilidade temporária");
    return plain("Qual modelo ou tipo de carro você procura? Já busco no nosso estoque pra você.", "clarify", "recovery_stock_not_run", "nenhuma busca executada -> não afirma ausência, pergunta específica");
  }
  // DETALHE: com veículo selecionado -> pergunta qual atributo (sem inventar); sem veículo -> pergunta qual carro.
  if (u.primaryIntent === "vehicle_detail" || u.requestedCapabilities.includes("vehicle_details")) {
    const sel = state.vehicleContext.selected;
    if (sel?.key) { const label = canonicalVehicleLabel(sel.key, factsArr, args.identities, state) ?? "esse carro"; return plain(`Sobre o ${label}, o que você quer saber — km, ano, preço ou condições? Já te confirmo.`, "clarify", "recovery_detail_attr", "detalhe sem fato -> pergunta o atributo"); }
    return plain("De qual carro você quer os detalhes?", "clarify", "recovery_detail_no_vehicle", "detalhe sem veículo -> pergunta qual");
  }
  // FOTO sem alvo (o executor de foto não resolveu) -> pergunta qual (nunca envia mídia sem alvo).
  if (u.primaryIntent === "request_photos" || u.requestedCapabilities.includes("send_photos")) {
    const text = (state.lastRenderedOfferContext?.items?.length ?? 0) > 0 ? "De qual carro da lista você quer as fotos? Me diz o número ou o modelo." : "De qual carro você quer ver as fotos?";
    return plain(text, "clarify", "recovery_photo_which", "foto sem alvo -> pergunta qual");
  }
  // Default GENÉRICO (lastResort) — sem contexto acionável. É o ÚNICO caso marcado technical_fallback (não "reformule").
  return plain("Me conta um pouco mais do que você procura que eu já te ajudo. 😊", "clarify", "recovery_ask_need", "sem contexto acionável -> pede o que procura", true);
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
  const blockAwaitMaxMs = args.blockAwaitMaxMs ?? DEFAULT_DEBOUNCE_CONFIG.maxWaitMs;   // teto anti-parcial (P0 bloco-do-lead)
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
      // P0 (audit TRAVA DE CONTEXTO): intenção do TURNO ATUAL (só do bloco corrente) separada da memória. Quando é uma
      // busca nova, memória velha de FOTO é limpa do frame que o cérebro vê (activeTopic/currentLeadIntent) — a intenção
      // atual vence a memória. O cérebro recebe currentTurnIntent nos signals e é obrigado (requiredToolBeforeFinal) a
      // rodar stock_search numa busca. A memória persistida fica intacta (o cérebro re-seta o tópico correto no turno).
      const baseSignals = buildFrameSignals(leadMessage, prepared.interpretation);
      const currentTurnIntent = deriveCurrentTurnIntent(leadMessage, baseSignals, prepared.claimExtractor);
      // AUTORIA ÚNICA / LLM-first (declarados cedo p/ gatear o filtro comercial ativo abaixo).
      const singleAuthor = args.singleAuthor ?? false;
      const llmFirst = args.llmFirst ?? false;   // LLM-first: engine não gerencia objetivo de funil (só valida)
      // P0 (LLM-first): constraint comercial DETERMINÍSTICO do bloco atual (marca/modelo/tipo/preçoMax/câmbio/popular).
      // Base de dois invariantes: (1) força stock_search quando o lead deu filtro suficiente e nenhuma busca rodou;
      // (2) enriquece a chamada executada preenchendo lacunas. NÃO decide a resposta — só descreve o filtro do turno.
      const currentConstraints = detectCommercialConstraints({ block: leadMessage, signals: baseSignals, claimExtractor: prepared.claimExtractor, interpretation: prepared.interpretation });
      // GATE por intenção do turno: NUNCA força busca num turno de FOTO/DETALHE/INSTITUCIONAL. deriveCurrentTurnIntent já
      // dá a precedência certa (foto > institucional > busca). "me manda foto do Onix" = photo_request (não busca) mesmo
      // citando um modelo. Pergunta de ATRIBUTO do veículo ("quanto custa o Onix?", relation asks_vehicle_detail) é DETALHE,
      // não busca — usa a RELATION (não regex de atributo, senão "pode ser automático" viraria detalhe). Só search/other
      // COM constraint comercial do BLOCO ATUAL, e que NÃO seja detalhe, dispara a força.
      const isVehicleDetailTurn = baseSignals.relation === "asks_vehicle_detail";
      const leadEngagement: LeadEngagement | null = detectDisengagement(leadMessage);
      // ── F2.32 (CTWA/Facebook Ads): o anúncio é CONTEXTO da conversa (não resposta do lead). Vem sanitizado na rajada
      //    (raw.adContext) ou herda do state. O engine resolve o VEÍCULO do anúncio do TEXTO aterrado no catálogo (nunca
      //    inventa) e o usa como SEED do escopo de busca. PRIORIDADE: atual > correção > anúncio > ativo. O anúncio DIRIGE
      //    o turno só se: há veículo no anúncio, o turno NÃO é institucional/desinteresse, e o bloco atual NÃO nomeia um
      //    veículo DIFERENTE (aí o atual/correção vence). Anúncio institucional (sem carro) -> contexto leve, não força busca. ──
      const burstAdContext = adContextFromInbox(inboxRecords);
      const effectiveAdContext: AdContext | null = burstAdContext ?? contextState.adContext ?? null;
      const adConstraints: CommercialConstraints = (llmFirst && effectiveAdContext) ? extractAdVehicleConstraints(effectiveAdContext, prepared.claimExtractor, prepared.interpretation) : {};
      const adVehicle = adHasVehicle(adConstraints);
      const currentHasVehicle = !!(currentConstraints.marca || (currentConstraints.modelos && currentConstraints.modelos.length > 0) || currentConstraints.tipo);
      const adDrivesTurn = llmFirst && effectiveAdContext != null && adVehicle && currentTurnIntent !== "institutional" && leadEngagement == null && !currentHasVehicle;
      // Turno de ENTRADA/REFERÊNCIA ao anúncio: "esse ainda tem?", saudação curta de entrada, foto/detalhe do anunciado,
      // ou um refino comercial (preço/câmbio) sobre o carro do anúncio -> o anúncio SEED-a a busca deste turno.
      const adEntryTurn = adDrivesTurn && (refersToAd(leadMessage) || isBareGreeting(leadMessage) || sufficientForStockSearch(currentConstraints)
        || currentTurnIntent === "photo_request" || currentTurnIntent === "photo_memory" || isVehicleDetailTurn || baseSignals.mentionsPhoto === true);
      // GATE por intenção do turno + entrada de anúncio: search/other com constraint do bloco, OU entrada de anúncio.
      const commercialSearchTurn = ((currentTurnIntent === "search" || currentTurnIntent === "other") && !isVehicleDetailTurn && sufficientForStockSearch(currentConstraints)) || adEntryTurn;
      // Fase 4 (Evidence H): DESENGAJAMENTO acionável = lead desinteressado E o turno NÃO tem constraint comercial suficiente,
      // "mais opções", foto ou institucional (senão o PEDIDO vence o desinteresse: "obrigado, quero Onix" ainda busca).
      // Suprime funil/lista; o executor determinístico responde curto e deixa a porta aberta. (Anúncio não muda isto:
      // adDrivesTurn já exige leadEngagement==null, então "não solicitei" não vira busca de anúncio.)
      const disengagedActionable = leadEngagement != null && !sufficientForStockSearch(currentConstraints) && !baseSignals.mentionsMoreOptions
        && currentTurnIntent !== "photo_request" && currentTurnIntent !== "photo_memory" && currentTurnIntent !== "institutional";
      // F2.26 (audit Codex): FILTRO ATIVO acumulado — o lead refina a MESMA intenção em turnos separados. Só turno de
      // BUSCA (constraint novo OU "mais opções") mergeia o bloco atual sobre o filtro persistido; foto/detalhe/institucional
      // PRESERVAM o ativo. O merge alimenta a busca (enrich + executor determinístico) e é persistido no commit.
      // GATE em llmFirst: é feature do central_active. Legado/shadow (compose) usam SÓ o bloco atual (comportamento antigo).
      const activeConstraints: CommercialConstraints = contextState.activeSearchConstraints ?? {};
      // Inv.1/2 (Evidence 1 Compass): correções explícitas ("esquece sedan", "não é sedan") removem o tipo no merge;
      // um modelo específico novo solta o tipo antigo conflitante. detectCorrections é EXTRAÇÃO de fato, não handler.
      // Uma correção também é turno de busca (aplica a remoção sobre o filtro ativo mesmo sem novo modelo/tipo).
      const commercialCorrections = detectCorrections(leadMessage);
      // F2.32: em turno de ENTRADA de anúncio, o veículo do anúncio é a BASE do escopo (acima do filtro ativo antigo —
      // prioridade anúncio>ativo); o bloco atual (ex.: "até 100k") REFINA por cima. Fora de anúncio, base = filtro ativo.
      const searchBase: CommercialConstraints = (llmFirst && adEntryTurn) ? mergeActiveConstraints(activeConstraints, adConstraints) : activeConstraints;
      const isSearchishTurn = commercialSearchTurn || baseSignals.mentionsMoreOptions || commercialCorrections.removedTypes.length > 0;
      const commercialConstraints: CommercialConstraints = (llmFirst && isSearchishTurn) ? mergeActiveConstraints(searchBase, currentConstraints, commercialCorrections) : currentConstraints;
      // F2.29 (invariante 4): moto NUNCA em lista de carro (default do estoque exclui). Só o lead pedindo moto EXPLICITAMENTE
      // libera moto na busca. Conservador (palavra "moto/scooter/..."), não infere por modelo.
      const wantsMotorcycle = mentionsMotorcycle(leadMessage);
      // INC3 (F2.30): conjunto CUMULATIVO do que o lead JÁ VIU (offers.presentedKeys acumulado + última oferta renderizada).
      // É a fonte da verdade do excludeKeys em "mais opções": clampa a proposta do cérebro (nunca esconde estoque não
      // mostrado) e garante que nada já visto reapareça entre rodadas. presentedKeys é populado no commit abaixo.
      const shownVehicleKeys = [...new Set([
        ...((contextState.offers?.presentedKeys ?? []) as string[]),
        ...(contextState.lastRenderedOfferContext?.items ?? []).map((i) => i.vehicleKey),
      ].filter((k): k is string => typeof k === "string" && k.length > 0))];
      // F2.29 (invariantes 3+5): "mais opções/tem outros?" PRECISA de escopo. Prioridade: filtro comercial mergeado
      // (ativo+atual) se suficiente; senão deriva da ÚLTIMA OFERTA se HOMOGÊNEA (5 sedans -> tipo=sedan); senão nada
      // recuperável -> o engine PERGUNTA o escopo (não lista genérico). Só em llmFirst e só quando o lead pede mais opções.
      const moreOptionsDerivedScope = (llmFirst && baseSignals.mentionsMoreOptions && !sufficientForStockSearch(commercialConstraints))
        ? deriveScopeFromHomogeneousOffer(contextState.lastRenderedOfferContext?.items ?? [])
        : null;
      // Escopo EFETIVO da busca do turno: o comercial (se suficiente) senão o derivado da oferta homogênea.
      const effectiveSearchScope: CommercialConstraints = sufficientForStockSearch(commercialConstraints) ? commercialConstraints : (moreOptionsDerivedScope ?? commercialConstraints);
      // "mais opções" sem NENHUM escopo recuperável (nem comercial, nem derivável da oferta) -> pergunta o escopo.
      const moreOptionsNeedsScope = llmFirst && baseSignals.mentionsMoreOptions && !sufficientForStockSearch(effectiveSearchScope);
      const wmForFrame = clearStalePhotoIntent(wmV1, currentTurnIntent);
      // F2.32: o cérebro vê o veículo do anúncio (label aterrado) sempre que há anúncio COM veículo — mesmo fora de turno
      // de entrada — para conduzir LLM-first (o prompt deixa claro que o turno atual/correção vencem o anúncio).
      const adVehicleHint = (llmFirst && effectiveAdContext && adVehicle)
        ? ((adConstraints.modelos && adConstraints.modelos.length > 0) ? [adConstraints.marca, adConstraints.modelos.join("/")].filter(Boolean).join(" ") : describeConstraints(adConstraints))
        : undefined;
      const frame = buildTurnFrame({ turnId, now: cutoff, block: leadMessage, portalPromptSha256, workingMemory: wmForFrame, interpretation: prepared.interpretation, state: contextState, currentTurnIntent, adVehicleHint });

      // ── LOOP do cérebro: query (autorizada por chamada) | final. Observações FACTUAIS voltam ao MESMO cérebro. ──
      const observations: AgentToolObservation[] = [];
      const facts: QueryResult[] = [];                 // só os 4 QueryCall (grounding comercial)
      const toolResultMems: ToolResultMemory[] = [];   // memória sanitizada das tools executadas
      const toolTelemetry: ToolTelemetry[] = [];
      let finalDecision: AgentBrainDecision | null = null;
      let brainSteps = 0;
      // AUTORIA ÚNICA (audit): singleAuthor/llmFirst já declarados acima (perto do currentTurnIntent) p/ o gate do filtro comercial.
      const identities = buildRememberedIdentities(contextState); // identidade LEMBRADA (marca/modelo/ano) — só p/ NOMEAR
      // P0-sel (missão): o lead está SELECIONANDO um veículo da última lista/foco ("gostei do segundo", "esse", ordinal)?
      // Numa seleção o cérebro pode dar um final NATURAL sem vehicle_details (citar atributo é barrado no validate, com
      // feedback específico "acolha a escolha, não cite atributo sem vehicle_details").
      const selectionTurn = resolveSelectedVehicle(leadMessage, contextState, ctx.claimExtractor) != null;
      let authoredComposed: RenderedResponse | null = null;
      let authoredDecision: TurnDecision | null = null;
      let authoredProposedEffects: ProposedEffectPlan[] | null = null;
      let responseSource: ResponseSource = singleAuthor ? "technical_fallback" : "legacy_compose";
      let recoveryReason: string | null = null;                     // T6: motivo da recuperação contextual (observabilidade)
      let targetResolutionSource: TargetResolutionSource | null = null;   // T6: como o alvo do turno foi resolvido
      let brainRetries = 0;
      const policyFeedbackLog: string[] = [];
      // ── FONTE ÚNICA (audit Codex): SÓ o understanding DO CÉREBRO (fromBrain, evidência⊂bloco) autoriza ação comercial
      //    (send_media/tool/foco). A 1ª compreensão válida TRAVA o assunto (reconcileUnderstanding). O fallback é HINT
      //    conservador só p/ recuperação TEXTUAL — nunca autoriza. `knownModels` verifica o modelo do alvo (P0-1).
      const fallbackUnderstanding = deriveFallbackUnderstanding(leadMessage, baseSignals, prepared.claimExtractor);
      let lockedU: TurnUnderstanding | null = null;                 // base TRAVADA do turno (do cérebro)
      const brainVU = (): ValidatedUnderstanding | null => (lockedU ? validateTurnUnderstanding(lockedU, leadMessage, true) : null);
      const authoritativeVU = (): ValidatedUnderstanding => brainVU() ?? validateTurnUnderstanding(fallbackUnderstanding, leadMessage, false);
      // key -> {marca,modelo} ESTRUTURADO (audit Codex P0): SÓ de fontes com modelo estruturado confiável — VehicleFact
      // (stock_search/vehicle_details), oferta e identidade. NUNCA `selected.label` (texto livre; não infere modelo
      // aproximado). A identidade do modelo é EXATA (catalog-utils.modelIdentityMatches), nunca substring.
      const buildKnownModels = (): Map<string, KnownVehicleModel> => {
        const m = new Map<string, KnownVehicleModel>();
        for (const f of facts) { if (!f.ok) continue; if (f.tool === "stock_search") for (const v of f.data.items) m.set(v.vehicleKey, { marca: v.marca ?? null, modelo: v.modelo ?? null }); if (f.tool === "vehicle_details") m.set(f.data.vehicle.vehicleKey, { marca: f.data.vehicle.marca ?? null, modelo: f.data.vehicle.modelo ?? null }); }
        for (const it of contextState.lastRenderedOfferContext?.items ?? []) m.set(it.vehicleKey, { marca: it.marca ?? null, modelo: it.modelo ?? null });
        for (const id of identities) m.set(id.vehicleKey, { marca: id.marca ?? null, modelo: id.modelo ?? null });
        return m;
      };
      const resolveTarget = (): TargetResolution => resolveTurnTarget({ understanding: brainVU()?.understanding ?? null, leadMessage, state: contextState, claimExtractor: ctx.claimExtractor, knownModels: buildKnownModels() });
      // requireBrain = produção (central_active+llmFirst): só o cérebro autoriza foto. Sem llmFirst (replay/legado) o
      // fallback validado autoriza (mantém a coerência de evidência de foto). photoVU escolhe a fonte por modo.
      const requireBrain = llmFirst;
      const photoVU = (): ValidatedUnderstanding | null => (llmFirst ? brainVU() : authoritativeVU());
      const seenDenyFingerprints = new Set<string>();               // deny repetido -> recupera já (não gasta tentativas)
      let repeatedDeny = false;
      const seenToolSigs = new Set<string>();
      const COMMERCIAL_TOOLS = new Set(["stock_search", "vehicle_details", "vehicle_photos_resolve"]);
      const systemDetailKeys = new Set<string>();                   // P0-2: keys cujo vehicle_details o ENGINE exigiu (grounding)
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
        // Fonte única: captura+TRAVA o entendimento do turno (a 1ª compreensão válida é a base; refinamento só adiciona fato).
        if (step.understanding) lockedU = reconcileUnderstanding(lockedU, step.understanding, leadMessage);
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
          // T4: exigência de stock_search pela SEMÂNTICA do CÉREBRO (só brainVU força busca; fallback nunca força tool).
          // P0 (LLM-first): a busca é exigida pela SEMÂNTICA do cérebro OU por um constraint comercial DETERMINÍSTICO do
          // bloco (marca/modelo/tipo/preço/câmbio/popular). Sem isto, quando o cérebro sub-classificava "até 50 mil e que
          // seja da volks", o turno caía em recovery_stock_not_run e reperguntava o que o lead já disse.
          const missingTool = requiredToolBeforeFinal(frame, observations, llmFirst && (isStockSearchTurn(brainVU()) || commercialSearchTurn), moreOptionsNeedsScope);
          if (missingTool && brainSteps + 1 < brainMaxSteps) {
            observations.push({ tool: frame.signals.mentionsStore ? "tenant_business_info" : "stock_search", ok: false, error: { code: "REQUIRED_TOOL_MISSING", message: missingTool } });
            continue;
          }
          if (missingTool) break;
          if (singleAuthor) {
            // B2 (audit): pergunta de atributo do SELECIONADO exige vehicle_details bem-sucedido do MESMO key ANTES
            // do final. Sem o fato -> força a consulta (retry); esgotou -> fallback degradado pós-loop.
            const needDetail = requireVehicleDetailBeforeFinal(frame, observations);
            // P0-2 (exceção sistêmica TIPADA): necessidade de grounding do engine AUTORIZA vehicle_details do key selecionado
            // (separada da intenção da LLM). Registra o key p/ o gate de tool liberar a consulta de aterramento.
            if (needDetail) { const selKey = frame.workingMemory.selectedVehicle?.vehicleKey; if (selKey) systemDetailKeys.add(selKey); }
            if (needDetail && brainSteps + 1 < brainMaxSteps) { observations.push({ tool: "vehicle_details", ok: false, error: { code: "REQUIRED_TOOL_MISSING", message: needDetail } }); continue; }
            if (needDetail) break;
            // Renderiza+valida a autoria do cérebro AQUI. Deny/fato ausente -> feedback tipado ao MESMO cérebro
            // (retry) enquanto houver passo; senão sai do loop -> fallback técnico honesto pós-loop.
            const authored = authorFromBrainDraft({ finalDecision: step.decision, leadMessage, facts, identities, ctx, turnId, selectionTurn, institutionalObs, photoVU: photoVU(), requireBrain, target: resolveTarget() });
            if (authored.ok) {
              finalDecision = step.decision; authoredDecision = authored.decision; authoredComposed = authored.composed; authoredProposedEffects = authored.proposedEffects;
              responseSource = brainRetries === 0 ? "brain_final" : "brain_retry";
              break;
            }
            brainRetries += 1; policyFeedbackLog.push(authored.feedback);
            // T5: fingerprint de deny REPETIDO -> não gasta as 3 tentativas idênticas; sai p/ RECUPERAÇÃO contextual.
            const fp = denyFingerprint(authored.feedback);
            if (seenDenyFingerprints.has(fp)) { repeatedDeny = true; break; }
            seenDenyFingerprints.add(fp);
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
        // P0-2 (audit Codex): AUTORIZAÇÃO TIPADA POR TOOL — cada tool comercial exige a capability PRÓPRIA + evidência
        // própria do CÉREBRO (stock_search->stock_search; vehicle_details->vehicle_details; vehicle_photos_resolve->
        // send_photos). Exceção SISTÊMICA: vehicle_details do key que o engine exigiu p/ grounding (systemDetailKeys).
        // Sem autorização -> rejeita (REQUIRED_TURN_UNDERSTANDING) e o cérebro re-emite. (tenant_business_info isento.)
        const sysDetailOk = call.tool === "vehicle_details" && systemDetailKeys.has(((call.input as { vehicleKey?: string }).vehicleKey) ?? "");
        if (singleAuthor && llmFirst && COMMERCIAL_TOOLS.has(call.tool) && !sysDetailOk && !toolCapabilityAuthorized(brainVU(), call.tool)) {
          const capNeeded = call.tool === "vehicle_photos_resolve" ? "send_photos" : call.tool;
          observations.push({ tool: call.tool, ok: false, error: { code: "REQUIRED_TURN_UNDERSTANDING", message: `Para usar '${call.tool}' inclua NO MESMO passo um 'understanding' com requestedCapabilities contendo '${capNeeded}' e uma evidence (capability '${capNeeded}') citando o TRECHO LITERAL do bloco atual que justifica isso.` } });
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
          previousVehicleKeys: shownVehicleKeys,  // INC3: conjunto CUMULATIVO apresentado (clampa o excludeKeys do cérebro)
          constraints: commercialConstraints,   // P0: preenche lacunas (marca/preço/tipo/câmbio) que o cérebro omitiu
          wantsMotorcycle,                       // F2.29: só libera moto se o lead pediu moto explicitamente
          enforceShownClamp: llmFirst,           // INC3: clampa só no central_active; shadow/legado mantém a união antiga
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
        // ── P0 (RESOLUÇÃO ÚNICA de veículo): completude determinística de FOTO por ORDINAL. Quando o cérebro NÃO autorou
        //    resposta e o lead pediu foto de um item da última lista ("me manda foto do segundo"), o alvo resolve por
        //    turn_ordinal (índice EXATO) mas o cérebro às vezes rotulou só como SELEÇÃO e não chamou vehicle_photos_resolve
        //    — daí o turno degradava em "de qual carro?" (recovery). Aqui o ENGINE resolve as fotos do alvo EXATO (1x) p/ o
        //    executor determinístico ter photoIds reais. NÃO é "foto solta": só dispara com ordinal resolvido + pedido
        //    explícito de foto (grounding máximo). A mesma fonte de alvo (resolveTarget) alimenta seleção, foto e recall. ──
        if (!authoredComposed) {
          const photoTarget = resolveTarget();
          const wantsPhotoNow = authorizesPhotoSend(photoVU(), leadMessage, requireBrain) || authorizesPhotoByResolvedOrdinal(photoTarget, leadMessage);
          if (wantsPhotoNow && photoTarget.kind === "resolved" && !facts.some((f) => f.ok && f.tool === "vehicle_photos_resolve" && f.data.vehicleKey === photoTarget.vehicleKey)) {
            try {
              const photoRes = await withTimeout(runQuery({ tool: "vehicle_photos_resolve", input: { vehicleRef: { kind: "vehicle", key: photoTarget.vehicleKey } } }), limits.queryTimeoutMs ?? 20_000, "query: vehicle_photos_resolve (ordinal) exceeded timeout");
              facts.push(photoRes); observations.push(toAgentObservation(photoRes)); toolResultMems.push(toToolResultMemory(photoRes, turnId));
            } catch { /* best-effort: sem fotos o executor cai no honesto "não localizei as fotos", nunca "de qual carro?" */ }
          }
          // ── P0 (F2.26, audit Codex): busca comercial DETERMINÍSTICA. Se há constraint suficiente (bloco atual OU filtro
          //    ATIVO mergeado) e o cérebro NÃO chamou stock_search, o ENGINE executa a busca com o filtro ativo — GARANTE
          //    a ação. Elimina a promessa falsa "vou procurar" sem buscar: a recuperação então lista de verdade OU é honesta
          //    sobre o vazio (nomeando o filtro). Foto/detalhe/institucional NÃO entram aqui (gate por commercialSearchTurn). ──
          // F2.29: usa o escopo EFETIVO (comercial se suficiente; senão o derivado da oferta homogênea). "mais opções" só
          // busca COM escopo — sem escopo recuperável cai no executor de pergunta (abaixo), nunca lista genérico.
          if (llmFirst && (commercialSearchTurn || frame.signals.mentionsMoreOptions) && sufficientForStockSearch(effectiveSearchScope) && !facts.some((f) => f.ok && f.tool === "stock_search")) {
            try {
              const searchCall = enrichStockSearchCall({ tool: "stock_search", input: constraintsToStockInput(effectiveSearchScope) }, {
                popular: frame.signals.mentionsPopular === true || effectiveSearchScope.popular === true,
                moreOptions: frame.signals.mentionsMoreOptions,
                previousVehicleKeys: shownVehicleKeys,  // INC3: conjunto CUMULATIVO apresentado (clampa o excludeKeys)
                constraints: effectiveSearchScope,
                wantsMotorcycle,                       // F2.29: só libera moto se o lead pediu moto explicitamente
                enforceShownClamp: llmFirst,           // INC3: clampa só no central_active
              });
              const startedS = Date.parse(clock.now());
              const searchRes = await withTimeout(runQuery(searchCall), limits.queryTimeoutMs ?? 20_000, "query: stock_search (commercial) exceeded timeout");
              facts.push(searchRes); observations.push(toAgentObservation(searchRes)); toolResultMems.push(toToolResultMemory(searchRes, turnId)); toolTelemetry.push(toToolTelemetry(searchRes, Math.max(0, Date.parse(clock.now()) - startedS)));
            } catch { observations.push({ tool: "stock_search", ok: false, error: { code: "UPSTREAM", message: "tool indisponivel" } }); }
          }
        }
        // Usa a resposta que o cérebro AUTOROU+aterrou (render+validate já feitos no loop). Se nada passou no
        // limite, FALLBACK TÉCNICO DEGRADADO — honesto, responde à pergunta atual; NUNCA lista/menu/muda de assunto/
        // funil; NUNCA promete retorno. JAMAIS chama DecisionLlm.compose. terminalSafe=true (degradação observável).
        composeFacts = [...facts];   // só fatos REAIS resolvem label de foto no commit (identidade não carrega km/cor)
        let effectiveDecision: TurnDecision;
        let composed: RenderedResponse;
        if (authoredComposed && authoredDecision && authoredProposedEffects) {
          effectiveDecision = authoredDecision; composed = authoredComposed; proposedEffects = authoredProposedEffects;
        } else {
          // P0-C: EXECUTOR DETERMINÍSTICO de foto. SÓ com understanding do cérebro (P0-2) + alvo VERIFICADO do assunto
          // (P0-1). Sem understanding OU foto do carro errado -> null (a recuperação pergunta qual; nunca envia errado).
          const detPhoto = buildDeterministicPhotoResponse({ leadMessage, ctx, facts, identities, turnId, photoVU: photoVU(), requireBrain, target: resolveTarget() });
          if (detPhoto) {
            responseSource = "deterministic_photo"; targetResolutionSource = detPhoto.targetSource;
            effectiveDecision = detPhoto.decision; composed = detPhoto.composed; proposedEffects = detPhoto.proposedEffects;
            finalDecision = finalDecision ?? { reasonCode: detPhoto.decision.reasonCode, reasonSummary: "executor determinístico de foto", confidence: 0.8, responsePlan: { guidance: composed.text, draft: null }, proposedEffects: [], memoryMutations: [], stateMutations: [] };
          } else {
            // P0 ROTEAMENTO POR DOMÍNIO: pergunta INSTITUCIONAL com tópico RESOLVIDO nunca vira technical_fallback —
            // responde com os FATOS da tool (endereço/horário), honesto no ausente. Antes da recuperação.
            const detInst = buildInstitutionalResponse({ leadMessage, institutionalObs, ctx, turnId });
            if (detInst) {
              responseSource = "deterministic_institutional";
              effectiveDecision = detInst.decision; composed = detInst.composed; proposedEffects = detInst.proposedEffects;
              finalDecision = finalDecision ?? { reasonCode: "institutional_answer", reasonSummary: "resposta institucional determinística", confidence: 0.85, responsePlan: { guidance: composed.text, draft: null }, proposedEffects: [], memoryMutations: [], stateMutations: [] };
            } else if (disengagedActionable && leadEngagement) {
              // Fase 4 (Evidence H): lead DESENGAJADO sem pedido comercial -> resposta CURTA, sem lista/funil/pressão.
              // Determinística e NÃO-degradada (honesta): nunca empurra venda; deixa a porta aberta.
              const detDiseng = buildDisengagementResponse({ engagement: leadEngagement, ctx, turnId });
              responseSource = "deterministic_institutional";
              effectiveDecision = detDiseng.decision; composed = detDiseng.composed; proposedEffects = detDiseng.proposedEffects;
              finalDecision = finalDecision ?? { reasonCode: "lead_disengaged", reasonSummary: "desinteresse -> resposta curta, sem funil", confidence: 0.85, responsePlan: { guidance: composed.text, draft: null }, proposedEffects: [], memoryMutations: [], stateMutations: [] };
            } else if (moreOptionsNeedsScope && !facts.some((f) => f.ok && f.tool === "stock_search")) {
              // F2.29 (invariante 5): "mais opções" SEM escopo recuperável e SEM busca executada -> PERGUNTA o tipo/faixa.
              // Nunca cai em recovery genérico nem lista aleatória. Aterrado e honesto.
              const detScope = buildMoreOptionsScopeQuestion({ ctx, turnId });
              responseSource = "deterministic_institutional";
              effectiveDecision = detScope.decision; composed = detScope.composed; proposedEffects = detScope.proposedEffects;
              finalDecision = finalDecision ?? { reasonCode: "more_options_needs_scope", reasonSummary: "mais opções sem escopo -> pergunta tipo/faixa", confidence: 0.8, responsePlan: { guidance: composed.text, draft: null }, proposedEffects: [], memoryMutations: [], stateMutations: [] };
            } else {
              // T5: RECUPERAÇÃO CONTEXTUAL — nunca texto genérico ("não consegui confirmar"/"reformule"). Usa
              // TurnUnderstanding + fatos reais (busca->lista aterrada; detalhe->qual; etc.). technical_fallback fica só
              // como MARCADOR interno de degradação (o cérebro falhou); o TEXTO ao lead é sempre contextual/honesto.
              const rec = buildContextualRecovery({ vU: authoritativeVU(), leadMessage, facts, observations, identities, ctx, turnId, constraints: commercialConstraints });
              // Recuperação CONTEXTUAL aterrada -> deterministic_recovery (texto útil, não "visível"); só o default genérico
              // (lastResort) é technical_fallback. Ambas são degradação (o cérebro não autorou).
              responseSource = rec.lastResort ? "technical_fallback" : "deterministic_recovery";
              recoveryReason = repeatedDeny ? `repeated_deny:${rec.recoveryReason}` : rec.recoveryReason;
              composed = rec.composed; proposedEffects = rec.proposedEffects;
              effectiveDecision = rec.decision;
              finalDecision = finalDecision ?? { reasonCode: "contextual_recovery", reasonSummary: rec.recoveryReason.slice(0, 120), confidence: 0.5, responsePlan: { guidance: composed.text, draft: null }, proposedEffects: [], memoryMutations: [], stateMutations: [] };
            }
          }
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
        const degraded = isDegradedSource(responseSource);
        // LLM-FIRST (missão): o engine NÃO gerencia objetivo de funil. `stripAllObjectiveMutations` garante que nenhum
        // objetivo de funil seja persistido (funil = contexto read-only; a LLM decide a condução). Fora do llm_first,
        // `reconcileObjectiveWithQuestion` continua persistindo o objetivo = pergunta REALMENTE enviada (legado).
        if (llmFirst) effectiveDecision = stripAllObjectiveMutations(effectiveDecision);
        else if (sdrPolicy && !degraded) effectiveDecision = reconcileObjectiveWithQuestion({ decision: effectiveDecision, composedText: composed.text, state: contextState, turnId, policy: sdrPolicy });
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
      if (renderedOfferContext) {
        reduced.next.lastRenderedOfferContext = renderedOfferContext;
        // INC3 (F2.30): mantém offers.presentedKeys CUMULATIVO em central_active (llmFirst) — a fonte da verdade do "que o
        // lead JÁ VIU". Só as keys REALMENTE renderizadas na oferta entram (computeRenderedOfferContext lê o
        // vehicle_offer_list exibido). O excludeKeys de "mais opções" é clampado a este conjunto: nunca esconde estoque não
        // mostrado (bug do Compass) e nada já visto reaparece entre rodadas. No legado/shadow o record_offer já faz isso.
        if (llmFirst) {
          const presented = new Set<string>((reduced.next.offers?.presentedKeys ?? []) as string[]);
          for (const it of renderedOfferContext.items) if (typeof it.vehicleKey === "string" && it.vehicleKey.length > 0) presented.add(it.vehicleKey);
          reduced.next.offers = { last: reduced.next.offers?.last ?? null, presentedKeys: [...presented] };
        }
      }
      // F2.26/F2.27/F2.29: persiste o FILTRO ATIVO — SÓ em llmFirst (central_active). Foto/detalhe/institucional preservam.
      // ⭐F2.29 (P0 audit Codex — regressão "sedan -> tem outros?"): a FONTE DE VERDADE é a busca EXECUTADA (filtersUsed),
      // não só o texto do lead. Se uma stock_search rodou (o cérebro OU o engine buscou {tipo:"sedan"} e listou), persiste o
      // ESCOPO REAL — assim "tem outros?" no próximo turno herda tipo/marca/preço/câmbio/anos. Fallback: o filtro do texto.
      const lastStockFact = [...facts].reverse().find((f): f is Extract<QueryResult, { ok: true; tool: "stock_search" }> => f.ok && f.tool === "stock_search");
      const executedScope = lastStockFact ? activeConstraintsFromStockInput(lastStockFact.data.filtersUsed as Record<string, unknown>) : null;
      if (llmFirst) {
        if (executedScope && sufficientForStockSearch(executedScope)) reduced.next.activeSearchConstraints = executedScope;
        else if (isSearchishTurn && (sufficientForStockSearch(commercialConstraints) || commercialCorrections.removedTypes.length > 0)) reduced.next.activeSearchConstraints = commercialConstraints;
      }
      // F2.32 (CTWA): persiste o CONTEXTO do anúncio — a 1ª mensagem traz o externalAdReply; as seguintes herdam do state
      // (recuperação de rajada). Anúncio NOVO (veio na rajada) é carimbado com o turnNumber atual; senão preserva o do state.
      if (llmFirst && effectiveAdContext) {
        reduced.next.adContext = burstAdContext
          ? { ...effectiveAdContext, capturedAtTurn: effectiveAdContext.capturedAtTurn || reduced.next.turnNumber }
          : effectiveAdContext;
      }

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
      const finalVU = authoritativeVU();   // T6: semântica autoritativa do turno (do cérebro OU fallback validado)
      // T6: se houve send_media e o executor não registrou a fonte do alvo (foto AUTORADA pelo cérebro), registra aqui.
      if (targetResolutionSource == null && proposedEffects.some((e) => e.kind === "send_media")) {
        const tr = resolveTarget(); targetResolutionSource = tr.kind === "resolved" ? tr.source : (tr.kind === "ambiguous" ? "ambiguous" : "none");
      }

      const events = [
        makeEvent({ conversationId, turnId, type: "turn_claimed", suffix: "claimed", payload: { eventIds: claimedEventIds }, at: cutoff }),
        // Observabilidade (audit + T6 fonte única): responseSource distingue autoria; understanding = semântica do turno;
        // previous/resolved vehicleKey + targetResolutionSource auditam a precedência de alvo; recoveryReason + feedback
        // por tentativa auditam a recuperação. tools p/ o v3_query_log do central_active.
        makeEvent({ conversationId, turnId, type: "decision_final", suffix: "decision", payload: {
          action: decision.action, reasonCode: decision.reasonCode, effectIds: outbox.map((r) => r.effectId),
          brainMode: singleAuthor ? "central_active" : "central_shadow", brainSteps, responseSource, degraded: isDegradedSource(responseSource), brainRetries,
          brainReason: finalDecision.reasonSummary.slice(0, 160),
          // T6: semântica do turno (fonte única) + resolução de alvo.
          primaryIntent: finalVU.understanding.primaryIntent, subject: finalVU.understanding.subject,
          subjectSource: finalVU.understanding.subjectSource, understandingTrusted: finalVU.trusted,
          understandingFromBrain: lockedU != null,
          evidence: finalVU.understanding.evidence.slice(0, 4).map((e) => ({ capability: e.capability ?? null, quote: e.quote.slice(0, 48) })),
          previousSelectedVehicleKey: contextState.vehicleContext.selected?.key ?? null,
          resolvedVehicleKey: proposedEffects.find((e) => e.kind === "send_media")?.vehicleKey ?? null,
          targetResolutionSource, recoveryReason,
          toolsExecuted: toolTelemetry.map((t) => t.tool), policyFeedback: policyFeedbackLog.slice(0, 5),
          institutionalResolved, droppedSelectKeys,
          // F2.29 (observabilidade do escopo comercial — auditoria do "mais opções herda escopo"): filtro ativo ANTES/DEPOIS,
          // input REAL da stock_search executada, e o escopo herdado por "mais opções" (null se pediu escopo).
          activeSearchConstraintsBefore: contextState.activeSearchConstraints ?? null,
          activeSearchConstraintsAfter: reduced.next.activeSearchConstraints ?? null,
          stockSearchInputExecuted: lastStockFact ? lastStockFact.data.filtersUsed : null,
          moreOptions: baseSignals.mentionsMoreOptions, moreOptionsNeedsScope,
          moreOptionsInheritedScope: baseSignals.mentionsMoreOptions && sufficientForStockSearch(effectiveSearchScope) ? effectiveSearchScope : null,
        }, at: cutoff }),
        makeEvent({ conversationId, turnId, type: "response_composed", suffix: "response", payload: { text: composed.text, terminalSafe, responseSource, degraded: isDegradedSource(responseSource) }, at: cutoff }),
      ];

      // ── TRAVA ANTI-PARCIAL (P0 bloco-do-lead): reconferência ANTES de despachar. Se chegou mensagem NOVA (pending)
      //    enquanto o cérebro pensava, o bloco cresceu — a resposta pronta seria PARCIAL. Devolve o claim e NÃO commita
      //    (logo nada é despachado): o poller reagrupa o bloco completo no próximo tick. Exceção: bloco já starved ->
      //    processa mesmo assim (a msg nova vira o próximo turno), senão uma rajada infinita travaria a conversa. ──
      // Codex F2.24 (P0): o "starved" é medido no CUTOFF (momento do CLAIM), NUNCA no horário pós-cérebro. Um cérebro
      // LENTO (> maxWait) NÃO pode fazer o bloco parecer starved retroativamente e mascarar uma mensagem nova. Invariante:
      // não-starved no cutoff + msg nova durante o processamento => SEMPRE supersede, por mais lento que o cérebro tenha
      // sido; já-starved no cutoff => pode processar mesmo com pending (anti forever-lock).
      const blockOldestMs = inboxRecords.reduce((min, r) => Math.min(min, Date.parse(r.receivedAt)), Number.POSITIVE_INFINITY);
      const blockAgeAtClaimMs = Date.parse(cutoff) - blockOldestMs;
      const newlyPending = await persistence.pendingCount(conversationId);
      if (shouldSupersedeStaleBlock({ newlyPendingCount: newlyPending, blockAgeMs: blockAgeAtClaimMs, maxWaitMs: blockAwaitMaxMs })) {
        await persistence.releaseClaim(claimedEventIds, workerId, turnId);
        return { status: "superseded", turnId, claimedEventIds, pendingCount: newlyPending };
      }

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
        degraded: isDegradedSource(responseSource), institutionalResolved, policyFeedback: policyFeedbackLog, droppedSelectKeys,
        understanding: finalVU.understanding, understandingFromBrain: lockedU != null, targetResolutionSource,
        resolvedVehicleKey: proposedEffects.find((e) => e.kind === "send_media")?.vehicleKey ?? null,
        previousSelectedVehicleKey: contextState.vehicleContext.selected?.key ?? null, recoveryReason,
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
