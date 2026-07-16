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
  TurnUnderstanding, SystemWorkingMemoryMutation, LeadIntentKind,
} from "../domain/agent-brain.ts";
import {
  validateTurnUnderstanding, deriveFallbackUnderstanding, authorizesPhotoSend, isPhotoRecall, isStockSearchTurn,
  resolveTurnTarget, reconcileUnderstanding, targetAcceptsKey, denyFingerprint, isPhotoDeclined,
  toolCapabilityAuthorized, selectAuthorized, authorizesPhotoByResolvedTarget, leadRequestsPhoto, acceptsAgentPhotoOffer, requestsHuman, leadRequestsHumanExplicitly, humanRequestDecisionFeedback, commercialToolAllowedForHumanRequest, sensitiveAnswerCompletenessFeedback,
  understandingAuthorityFeedback, hasActiveVisitContext,
  type ValidatedUnderstanding, type TargetResolution, type TargetResolutionSource, type KnownVehicleModel, type TurnValidationContext,
} from "./turn-understanding.ts";
import { shouldSupersedeStaleBlock, DEFAULT_DEBOUNCE_CONFIG } from "./debounce-policy.ts";
import { detectCommercialConstraints, sufficientForStockSearch, canonicalBrand, describeConstraints, mergeActiveConstraints, constraintsToStockInput, detectCorrections, activeConstraintsFromStockInput, mentionsMotorcycle, deriveScopeFromHomogeneousOffer, detectSimilarityIntent, relaxToSimilar, type RelaxKind, type CommercialConstraints } from "./commercial-constraints.ts";
import { selectPhotos } from "./photo-selection.ts";
import { resolveVehicleTypeFromTaxonomy } from "../adapters/read/vehicle-taxonomy.ts";
import { detectDisengagement, detectExplicitOptOut, type LeadEngagement } from "./lead-intent.ts";
import { extractAdVehicleConstraints, adHasVehicle, refersToAd, isBareGreeting, sanitizeAdContext, resolveAdReferenceKey, resolveAdCandidateKeys, resolveAdFocusedVehicle, asksAdAlternatives, type AdFocusedVehicle } from "./ad-context.ts";
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
import { finalize, validateEffectPlans } from "./finalizer.ts";
import { applyDecision } from "./state-reducer.ts";
import { materializeEffectPlans } from "./effect-materializer.ts";
import { buildCrmWritePlan } from "./crm-write.ts";
import { buildHandoffChain, forcedSilentDisengagementReason } from "./handoff-plan.ts";

// MISSÃO PII (P0-C): shape do diagnóstico do precheck de handoff — módulo testável handoff-precheck.ts.
import type { HandoffPrecheckDiag } from "./handoff-precheck.ts";
export type { HandoffPrecheckDiag } from "./handoff-precheck.ts";
import { computeRenderedOfferContext } from "./offer-context.ts";
import { focusInvalidationMutations, isNewSearchTurn } from "./vehicle-focus.ts";
import { extractLeadSlots, resolveSelectedVehicle, inferredQuestionSlot, lastAgentQuestionText, questionSlotFromAgentText, statesTradeVehiclePossession, isAnswerToFinancialQuestion, isFinancialValueDuringSelectedFinancing } from "./lead-extraction.ts";
import { filterBrainSlotMutations, type DroppedSlotMutation } from "./slot-provenance.ts";
import { safeCommitSlots } from "./conversation-engine.ts";
import { reconcileObjectiveWithQuestion, stripAllObjectiveMutations, type SdrQualificationPolicy } from "./sdr-conductor.ts";
import { buildTurnFrame, buildFrameSignals } from "./turn-frame-builder.ts";
import { buildCurrentTurnFacts } from "./current-turn-facts.ts";
import {
  assertToolExecutionAuthority,
  capabilityForTool,
  toToolAuthorityRecord,
  type ToolAuthorityRecord,
  type ToolExecutionAuthority,
} from "./tool-authority.ts";
import { institutionalTopicsRequested, mentionsContact } from "./turn-domain.ts";
import { normalizeText } from "./catalog-utils.ts";
import { parseOrdinal } from "./ordinal.ts";
import {
  loadPersistedWorkingMemory, deriveCanonicalViews, applyDecisionWorkingMemoryMutations,
  applySystemWorkingMemoryMutations, applyEffectOutcomeToWorkingMemory, isValidPhotoActionDraft,
  toAgentObservation, toToolResultMemory, toToolTelemetry,
} from "./working-memory.ts";
import type { TenantBusinessInfoSource } from "./tenant-business-info.ts";
import { resolveTenantBusinessInfo, businessInfoToolResultMemory } from "./tenant-business-info.ts";
import { invalidBrazilGreeting } from "./channel-time.ts";

// ── Flag de modo ─────────────────────────────────────────────────────────────────────────────────────────────
export type BrainMode = "off" | "central_shadow" | "central_active";
export function readBrainMode(env: Record<string, string | undefined> = process.env): BrainMode {
  const value = env.PEDRO_V3_BRAIN_MODE?.trim();
  return value === "central_shadow" || value === "central_active" ? value : "off";
}
export function isCentralShadowMode(env: Record<string, string | undefined> = process.env): boolean {
  return readBrainMode(env) === "central_shadow";
}

export const DEFAULT_ALLOWED_TOOLS = ["stock_search", "vehicle_details", "vehicle_photos_resolve", "tenant_business_info", "crm_read", "knowledge_search"] as const;

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
  // FASE 1 CRM (missão 2026-07-09): liga o effect crm_write determinístico do chokepoint. Default OFF —
  // fail-closed: sem flag OU sem leadId, nenhum effect de CRM nasce. Nunca fala com o lead.
  readonly crmWriteEnabled?: boolean;
  // HF-1 (2026-07-11): transferência do turno. enabled = flag PEDRO_V3_HANDOFF do root; available = pré-check
  // de vendedor ativo (root, evita promessa falsa); agentName/leadPhone/leadDisplayName/nowLocal alimentam
  // briefing/etiquetas (puros). Ausente = comportamento atual (zero handoff, deny de promessa intacto).
  readonly handoff?: {
    readonly enabled: boolean;
    readonly available: boolean;
    readonly agentName: string;
    readonly leadPhone: string | null;
    readonly leadDisplayName?: string | null;
    readonly nowLocal?: string;
    // MISSÃO PII (P0-C): diagnóstico estruturado do precheck (sem PII/segredo) — vai INTEIRO no decision_final.
    readonly precheck?: HandoffPrecheckDiag;
  };
  // Opção A (bloqueio leadId 2026-07-10): true SÓ no turno do 1º VÍNCULO lead↔conversa — o crm_write
  // sincroniza o SNAPSHOT acumulado (stateBefore=null), não o delta do turno. Turnos anteriores sem
  // vínculo (falha transitória de resolução / flag recém-ligada) não perdem nome/interesse/troca/entrada.
  readonly crmBootstrapSync?: boolean;
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

export type ResponseSource = "brain_final" | "brain_retry" | "deterministic_recall" | "deterministic_photo" | "deterministic_institutional" | "deterministic_recovery" | "deterministic_discovery" | "deterministic_conduct" | "technical_fallback" | "legacy_compose";
// Os responseSource determinísticos permanecem no contrato por compatibilidade com legacy/shadow.
// No central_active (llmFirst), somente brain_final/brain_retry podem produzir conversa visível;
// technical_fallback é exclusivamente uma falha operacional do provedor, sem condução comercial.
const DEGRADED_SOURCES: ReadonlySet<ResponseSource> = new Set(["technical_fallback"]);
function isDegradedSource(src: ResponseSource): boolean { return DEGRADED_SOURCES.has(src); }
// ⭐RD1-2 (observabilidade): classifica o feedback de um deny HARD em categoria (só p/ auditoria — nunca controla nada).
// No central_active só sobram denies de FATO/EFEITO/PII/pedido-explícito; o estilo virou advisory. PURO, best-effort.
export type HardDenyCategory = "grounding" | "tool_safety" | "effect_safety" | "pii" | "explicit_request" | "structural" | "other";
function classifyDenyCategory(feedback: string): HardDenyCategory {
  const f = feedback.toLowerCase();
  if (/\bcpf\b|sens[ií]vel|data de nasc/.test(f)) return "pii";
  if (/transfer[êe]nc|consultor|vendedor|handoff|visita ser[áa]|agendad/.test(f)) return "effect_safety";
  if (/foto|m[íi]dia|send_media|imagem/.test(f)) return "tool_safety";
  if (/chave interna|fato ausente|n[ãa]o consultad|atributo|km\/cor|vehicle_details|aterrad|acima do teto|fora do cat[áa]logo/.test(f)) return "grounding";
  if (/buscou o estoque|vehicle_offer_list|hor[áa]rio|endere[çc]o|ignorar um pedido|pedido expl[íi]cito|mostre a lista/.test(f)) return "explicit_request";
  if (/draft|parts estruturadas|malformad|corromp/.test(f)) return "structural";
  return "other";
}
function isDegradedResponse(src: ResponseSource, recoveryReason: string | null): boolean {
  void recoveryReason;
  if (isDegradedSource(src)) return true;
  return false;
}

// T1 (audit Codex smoke): o LLM às vezes emite BYTES DE CONTROLE no texto (ex.: U+001F). Remove C0 (mantém \t \n \r), DEL
// e o replacement char U+FFFD — nunca vão pro WhatsApp/CRM. NÃO mexe em espaços/quebras (preserva a formatação da lista).
function stripControlChars(text: string): string {
  let out = "";
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 0;
    if ((c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) || c === 0x7f || c === 0xfffd) continue;
    out += ch;
  }
  return out;
}
// Encoding guard: corrupted model/provider text can contain control chars
// embedded in normal words. Detect before stripping so the brain can rewrite.
function hasCorruptedControlChars(text: string): boolean {
  for (const ch of text) { const c = ch.codePointAt(0) ?? 0; if ((c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) || c === 0x7f || c === 0xfffd) return true; } return false;
}

function repairVisibleLatin1Escapes(text: string): string {
  if (!/(?:ðŸ|Voceaa|Taubate9|\bje1\b|\p{L}(?:eaa|e7|e9|e1|e0|e2|e3|f3|f4|f5)\b)/u.test(text)) return text;
  return text
    .replace(/ðŸ.{0,2}/g, "")
    .replace(/eaa/g, "ê")
    .replace(/e7/g, "ç")
    .replace(/e9/g, "é")
    .replace(/e1/g, "á")
    .replace(/e0/g, "à")
    .replace(/e2/g, "â")
    .replace(/e3/g, "ã")
    .replace(/f3/g, "ó")
    .replace(/f4/g, "ô")
    .replace(/f5/g, "õ");
}
export function sanitizeOutgoingText(text: string): string {
  return repairVisibleLatin1Escapes(stripControlChars(text))
    .replace(/(\p{Extended_Pictographic})(?=\p{L})/gu, "$1 ")
    .normalize("NFC");
}

// ⭐Hardening (audit Codex): moreOptionsSearch chega JÁ GATEADO pelo caller ("mais opções" só exige busca quando o ato
// declarado pela LLM NÃO é conversacional — contestação/financiamento/troca/smalltalk vencem o regex).
// Slots monetários do LEAD (fonte única: extractLeadSlots é autoritativo sobre a LLM — F2.40; a validationState
// projeta ESTES slots do turno para render/validate enxergarem — F2.43/audit Codex).
const VALIDATION_FINANCIAL_SLOTS = new Set(["entrada", "parcelaDesejada", "faixaPreco"]);
function requiredToolBeforeFinal(frame: ReturnType<typeof buildTurnFrame>, observations: readonly AgentToolObservation[], searchTurn: boolean, moreOptionsNeedsScope: boolean, moreOptionsSearch: boolean): string | null {
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
  if (moreOptionsSearch && !wasObserved("stock_search") && !moreOptionsNeedsScope) {
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
      toolAuthorities: ToolAuthorityRecord[];
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
// ⭐SEM inv.7: hint de NOME do WhatsApp (pushName sanitizado no bridge) — viaja no raw do inbox; a validação de
// nome real (isRealLeadName) acontece no builder do CRM. Lê o MAIS RECENTE presente no bloco.
function leadNameHintFromInbox(records: InboxRecord[]): string | null {
  for (let i = records.length - 1; i >= 0; i--) {
    const raw = records[i]?.raw as Record<string, unknown> | undefined;
    const hint = raw?.leadNameHint;
    if (typeof hint === "string" && hint.trim().length >= 2) return hint.trim().slice(0, 60);
  }
  return null;
}
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
const PHOTO_MORE_REQUEST_RX = /\b(?:tem\s+)?(?:mais|outr[ao]s?)\s+(?:fotos?|imagens?|midias?|fotografias?)\b|\b(?:fotos?|imagens?)\s+(?:a\s+)?mais\b/;
const PHOTO_REQUEST_RX = /\b(manda|mandar|mande|envia|enviar|envie|mostra|mostrar|mostre|me\s+ve|quero\s+ver|posso\s+ver|ver\s+as?)\b[^?]*\bfotos?\b|\bfotos?\s+d(o|a|e|esse|essa|ele|ela|aquele)\b|\bfoto\s+d(a|o)\s+(primeir|segund|terceir|quart)/;
function isPhotoRequestBlock(text: string): boolean {
  const n = normalizeText(text);
  if (PHOTO_MEMORY_Q_RX.test(n)) return false;   // pergunta de memória NUNCA é pedido de envio
  return PHOTO_MORE_REQUEST_RX.test(n) || PHOTO_REQUEST_RX.test(n);
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
  readonly beforeExecute?: (vehicleKey: string) => void;
  readonly onExecuted?: (result: QueryResult, ms: number) => void;
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
      args.beforeExecute?.(vehicleKey);
      const started = Date.now();
      const res = await withTimeout(args.runQuery({ tool: "vehicle_details", input: { vehicleKey } }), args.timeoutMs, "query: ground vehicle_details");
      args.onExecuted?.(res, Math.max(0, Date.now() - started));
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
  return `Resposta REJEITADA pela validação (${msg}). Corrija: afirme km/cor/câmbio/ano/preço só via vehicle_ref/money_ref do vehicleKey EXATO já consultado por vehicle_details; no máximo UMA pergunta; não repita dado já conhecido. Se o slot que você ia perguntar JÁ é conhecido (o cliente pode ter acabado de responder — veja o funil), ACOLHA o valor conhecido e avance com UMA pergunta sobre o PRÓXIMO passo que ainda falta.`;
}

// buildContextualRecovery é compatibilidade exclusiva do legado. No central_active, um draft negado
// volta ao mesmo cérebro com fatos+feedback; se a autoria final falhar, sai apenas a indisponibilidade
// operacional observável. A engine nunca assume a conversa comercial.

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
    // P0-B (audit Codex smoke): turno de SIMILARIDADE ("algo parecido") -> a busca ignora modelo/marca do cérebro e roda
    // só por tipo/preço (constraints já relaxado). Mercado por TIPO, não preso ao modelo do anúncio.
    // FOCO EXATO do anúncio (missão P0): o lead pediu ALTERNATIVA do carro do anúncio ("tem outro Compass?", "outro ano",
    // "mais barato") e NÃO citou ano próprio -> remove o ANO da chamada EXECUTADA (nunca fica preso no ano do anúncio).
    // Preserva modelo/marca/excludeKeys. É a chamada que VAI RODAR — não depende de retry.
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
  // P0-B (SIMILARIDADE): a busca sai SÓ do escopo relaxado (tipo/preço/câmbio/popular) — IGNORA modelo/marca/anos que o
  // cérebro tenha posto. "Algo parecido" nunca fica preso no modelo do anúncio; busca por TIPO no mercado.
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
    if (call.input.hibrido == null && c.hibrido) (filled as { hibrido?: boolean }).hibrido = true;
    // FOCO EXATO do anúncio (missão P0): preenche o ANO quando o turno tem um (do anúncio específico OU do lead). Assim a
    // busca do cérebro que omitiu o ano ainda resolve o veículo EXATO (ex.: Compass 2019, não 2017). Rígido (F2.28).
    if (call.input.anos == null && c.anos && c.anos.length > 0) (filled as { anos?: number[] }).anos = [...c.anos];
  }
  // INC3: DROPA o excludeKeys ORIGINAL do cérebro (nunca passa verbatim) — só entra o CLAMPADO (ou nada).
  const { excludeKeys: _brainExcludeDropped, ...restInput } = call.input;
  const mergedInput: QueryCall["input"] = {
    ...restInput,
    ...filled,
    ...(options.popular || c?.popular ? { popular: true } : {}),
    ...(excludeKeys ? { excludeKeys } : {}),
    // F2.29: só libera moto se o lead pediu moto OU o cérebro já marcou includeMotorcycles. Senão, DEFAULT exclui.
    ...(options.wantsMotorcycle || call.input.includeMotorcycles === true ? { includeMotorcycles: true } : {}),
  };
  // FOCO EXATO do anúncio (missão P0): alternativa pedida + sem ano do lead -> o ANO (do anúncio, seja do cérebro ou do
  // filled) SAI da chamada EXECUTADA. Preserva modelo/marca/excludeKeys. Não depende de retry.
  return { ...call, input: mergedInput };
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
  readonly openingNeedsDiscovery?: boolean;          // PARTE A (missão): abertura sem alvo -> discovery, não pedir nome/telefone
  readonly openingNeedsIntroduction?: boolean;       // primeiro contato sem anúncio -> identidade do prompt + discovery
  readonly specificAdVehicle?: string | null;        // PARTE A (missão P0): entrada por anúncio ESPECÍFICO -> abertura DEVE falar do veículo
  readonly searchExpectedThisTurn?: boolean;         // Missão P0 INC1/A: turno comercial/busca -> proíbe promessa "vou buscar" sem stock_search
  readonly noCommercialContextYet?: boolean;         // Missão P0 INC2/F: sem intenção comercial ainda -> não pedir nome (nem sobrenome)
  readonly advancedThisTurn?: boolean;               // LLM-first: o lead deu um slot novo neste turno (ex.: o nome) -> reperguntar o não-respondido é condução
  readonly disengagementOnly?: boolean;              // agradecimento/despedida sem novo pedido acionável -> não reabre o funil
  readonly financialAnswerSlot?: "formaPagamento" | "entrada" | "parcelaDesejada" | null;
  // HF-1 (2026-07-11): transferência EXECUTÁVEL neste turno (flag ON + vendedor ativo disponível + CRM
  // vinculado + transfer.enabled do portal). Promessa de consultor exige ISTO **e** o effect handoff proposto.
  readonly handoffPlannable?: boolean;
  readonly humanRequested?: boolean;
  readonly sensitiveAnswerKinds?: readonly ("cpf" | "birthDate")[];
  readonly photoRecallLabel?: string | null;            // memória factual: a LLM precisa nomear o veículo lembrado
  readonly proposedPrimaryIntent?: string | null;       // candidato da LLM usado só por validadores de segurança, nunca autoriza tool/efeito
}): SingleAuthorResult {
  const draft = args.finalDecision.responsePlan.draft;
  // ⭐RD1-2 (2026-07-13, autoria-LLM exclusiva): em central_active (requireBrain/llmFirst) as guardas de ESTILO/QUALIDADE
  // NÃO negam mais o draft — viraram ADVISORY (orientação ANTES da geração, ver deriveTurnAdvisoryContext/buildTurnAdvisories).
  // Aqui elas ficam ativas SÓ no legado/replay (!requireBrain), preservando o contrato antigo. As guardas de FATO/EFEITO/PII
  // (grounding, foto/mídia, transferência/visita, CPF, chave interna, completude de pedido explícito) continuam HARD nos DOIS
  // caminhos. Zero hard-deny de estilo no central_active; a LLM conduz/escreve seguindo o prompt do portal + os advisories.
  const applyLegacyStyleGuards = !args.requireBrain;
  if (!draft || draft.parts.length === 0) {
    if (args.disengagementOnly) {
      return { ok: false, feedback: "DESPEDIDA ISOLADA: seu draft veio ausente ou malformado. Devolva FINAL com draft.parts contendo EXATAMENTE UMA part {\"type\":\"text\",\"content\":\"<despedida curta e cordial>\"}. O content não pode ter pergunta, tool, coleta de nome/troca/entrada/parcela/visita nem promessa de transferência." };
    }
    const structuralHint = args.finalDecision.reasonSummary.startsWith("draft_invalid:")
      ? ` Motivo estrutural detectado na sua saída anterior: ${args.finalDecision.reasonSummary.slice("draft_invalid:".length).trim()}.`
      : "";
    return { ok: false, feedback: `Devolva 'draft' com parts estruturadas (text/vehicle_ref/money_ref/vehicle_offer_list). Não escreva km/cor/câmbio/ano/preço em texto livre.${structuralHint}` };
  }
  // A abertura continua sendo autoria da LLM. RD1-2: em central_active a APRESENTAÇÃO é ADVISORY (o prompt do portal +
  // buildTurnAdvisories orientam a se apresentar); o engine não nega mais a omissão. Guarda legada só no replay.
  if (applyLegacyStyleGuards && args.openingNeedsIntroduction) {
    const openingText = draft.parts.filter((part) => part.type === "text").map((part) => part.content).join(" ");
    if (!mentionsSelfIntroduction(openingText)) {
      return { ok: false, feedback: "PRIMEIRO CONTATO: você cumprimentou, mas não se apresentou. Reescreva a abertura conforme a identidade e personalidade do PROMPT DO PORTAL: diga quem você é e de qual loja fala, e faça UMA pergunta curta de descoberta comercial (modelo, tipo de carro ou faixa de preço). Não peça nome, telefone, troca ou entrada." };
    }
  }
  // P0-sel (missão): numa SELEÇÃO, quando o grounding falha (o cérebro citou km/cor/câmbio/preço sem vehicle_details), o
  // feedback é ESPECÍFICO — acolha a escolha e ofereça o próximo passo, NÃO cite atributo sem consultar. (Sem isto o
  // cérebro insistia em descrever o carro e degradava em technical_fallback.)
  const SELECTION_ATTR_FEEDBACK = "O cliente está SELECIONANDO um carro. Responda em FINAL, sem ferramenta: acolha a escolha pelo nome canônico e faça UMA pergunta curta oferecendo as fotos. NÃO envie fotos ainda e NÃO cite km/cor/câmbio/preço/ano sem vehicle_details.";
  const sendMediaKeys = args.finalDecision.proposedEffects.filter((e) => e.kind === "send_media").map((e) => e.vehicleKey).filter((k): k is string => typeof k === "string" && k !== "");
  // P0-2 (audit Codex): em llmFirst, send_media exige understanding VÁLIDO DO CÉREBRO. Sem ele -> REQUIRED_TURN_UNDERSTANDING
  // (retry); o fallback regex NUNCA autoriza mídia na produção.
  if (args.requireBrain && sendMediaKeys.length > 0 && !(args.photoVU?.fromBrain && args.photoVU.trusted)) {
    return { ok: false, feedback: "Para ENVIAR foto (send_media) você precisa declarar no MESMO passo um 'understanding' válido com requestedCapabilities incluindo 'send_photos' e uma evidence citando o TRECHO do bloco onde o cliente pediu foto. Sem isso, não envie mídia." };
  }
  // T2 (fonte única): a AUTORIDADE de enviar foto é a SEMÂNTICA (authorizesPhotoSend: capability send_photos com
  // evidência PRÓPRIA que menciona foto, sem negação, não é memória) — nunca regex de frase. Recall nunca envia mídia.
  const acceptedPhotoAuthorized = args.photoVU?.fromBrain === true
    && args.photoVU.trusted
    && args.photoVU.understanding.primaryIntent === "request_photos"
    && args.photoVU.understanding.requestedCapabilities.includes("send_photos")
    && authorizesPhotoByResolvedTarget(args.target, args.leadMessage, args.ctx.state);
  // A resposta a "de qual carro você quer as fotos?" pode ser semanticamente uma
  // seleção ("o número 1") ou apenas o modelo ("T-Cross"). A LLM continua dona
  // desse ato; a pergunta pendente só autoriza o efeito factual do alvo resolvido.
  const pendingPhotoTargetAuthorized = args.photoVU?.fromBrain === true
    && args.photoVU.trusted
    && authorizesPhotoByResolvedTarget(args.target, args.leadMessage, args.ctx.state);
  const photoAuthorized = authorizesPhotoSend(args.photoVU, args.leadMessage, args.requireBrain)
    || acceptedPhotoAuthorized
    || pendingPhotoTargetAuthorized;
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
  const photoSafeEffects = photoAuthorized ? args.finalDecision.proposedEffects : args.finalDecision.proposedEffects.filter((e) => e.kind !== "send_media");
  // O pedido humano explícito do bloco atual é a autoridade do motivo da
  // transferência. Alguns modelos propõem corretamente o efeito, mas o rotulam
  // como `qualified_handoff`; isso não pode transformar um pedido de atendente
  // em coleta obrigatória de nome. O engine não cria o efeito nem escreve a
  // resposta: apenas canonicaliza a semântica do efeito que a LLM propôs.
  const brainEffects = args.humanRequested === true
    ? photoSafeEffects.map((effect) => effect.kind === "handoff" ? { ...effect, reason: "explicit_human_request" } : effect)
    : photoSafeEffects;
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
  // O renderer precisa materializar novamente uma oferta que o próprio agente já mostrou (por exemplo, para
  // perguntar de qual dos dois Onix o lead quer fotos). Isso não é uma nova consulta nem um fato inferido: são os
  // itens estruturados do último vehicle_offer_list efetivamente renderizado. Mantemos esses fatos separados dos
  // QueryResults do turno para que eles não acionem regras de "busca acabou de retornar itens".
  const rememberedOfferItems: VehicleFact[] = (args.ctx.state.lastRenderedOfferContext?.items ?? []).flatMap((item) => {
    if (typeof item.ano !== "number" || typeof item.preco !== "number" || !item.tipo) return [];
    return [{
      vehicleKey: item.vehicleKey,
      marca: item.marca ?? "",
      modelo: item.modelo ?? "",
      ano: item.ano,
      preco: item.preco,
      cor: item.cor ?? undefined,
      cambio: item.cambio ?? undefined,
      tipo: item.tipo,
    }];
  });
  const renderFacts: QueryResult[] = rememberedOfferItems.length > 0
    ? [...realFacts, { ok: true, tool: "stock_search", data: { items: rememberedOfferItems, filtersUsed: {} }, source: "rendered_offer_memory" }]
    : realFacts;
  // P0-3 (audit): busca com RESULTADOS deve RESPONDER, não pedir autorização. Se o turno tem itens de stock_search e o
  // draft NÃO traz vehicle_offer_list (nem send_media de um carro específico) -> deny + feedback ao MESMO cérebro. A LLM
  // segue autora da introdução/CTA; o engine só exige que a pergunta atual (disponibilidade) seja respondida com a lista.
  if (realFacts.some((f) => f.ok && f.tool === "stock_search" && f.data.items.length > 0)
      && !draft.parts.some((p) => p.type === "vehicle_offer_list")
      && !proposedEffects.some((e) => e.kind === "send_media")) {
    return { ok: false, feedback: "Turno de LISTAGEM factual: você buscou o estoque e HÁ itens disponíveis. Inclua uma vehicle_offer_list com pelo menos um dos vehicleKeys retornados. A LLM continua autora da introdução e do próximo passo; não escreva a lista ou atributos de estoque manualmente e não chame stock_search novamente." };
  }
  // B3 (audit): postQuery é AUTORIDADE. Se negar (ex.: oferta acima do teto, veículo fora dos fatos), o draft ORIGINAL
  // NÃO pode ser enviado — feedback ao MESMO cérebro; nenhum efeito comercial original sobrevive (o retry re-autora).
  const post = PolicyEngine.postQuery(proposal, realFacts, args.ctx);
  if (hasDeny(post)) return { ok: false, feedback: sanitizePolicyFeedback(post) };
  const decision0 = finalize(args.turnId, proposal, post, realFacts);
  // Render: identidade só NOMEIA (marca/modelo/ano); km/cor/câmbio/preço só do fato REAL do MESMO vehicleKey.
  let composed: RenderedResponse;
  try {
    composed = { draft, text: ResponseRenderer.render(draft, renderFacts, args.ctx.state, args.identities) };
  } catch (err) {
    if (args.selectionTurn) return { ok: false, feedback: SELECTION_ATTR_FEEDBACK };
    return { ok: false, feedback: `Uma parte cita um FATO ausente/não consultado (${String((err as Error)?.message ?? err).slice(0, 140)}). Chame vehicle_details do vehicleKey ANTES de afirmar km/cor/câmbio/preço, ou diga em text que vai confirmar.` };
  }
  if (args.requireBrain) {
    const greetingFeedback = invalidBrazilGreeting(composed.text, args.ctx.now);
    if (greetingFeedback) return { ok: false, feedback: greetingFeedback };
  }
  // LLM-first: memória pode aterrar QUAL veículo recebeu fotos, mas nunca escreve a resposta pelo cérebro.
  // Se a LLM ignorar o label lembrado, o engine devolve o fato e ela reautora. O override textual
  // deterministic_recall fica restrito ao caminho legado.
  if (args.photoRecallLabel
      && isPhotoMemoryQuestionBlock(args.leadMessage)
      && !proposedEffects.some((effect) => effect.kind === "send_media")
      && !mentionsLabel(composed.text, args.photoRecallLabel)) {
    return { ok: false, feedback: `O cliente perguntou de QUAL carro eram as fotos. O fato de memória aterrado é: "${args.photoRecallLabel}". Responda você mesmo nomeando esse veículo, sem reenviar mídia e sem expor chave interna.` };
  }
  // Corrupted text should be rewritten by the brain, not silently stripped into
  // visible mojibake that can leak to WhatsApp.
  if (hasCorruptedControlChars(composed.text)) {
    return { ok: false, feedback: "Sua resposta veio CORROMPIDA (caracteres de controle/quebrados embutidos — acentos e emoji viraram lixo). Reescreva EXATAMENTE a mesma mensagem em português limpo e correto, com acentuação normal (á é ê ã õ ç) e SEM emojis nem caracteres especiais/de controle." };
  }
  // RD1-2: acolher entrada/parcela é ADVISORY (justAnsweredFinancialSlot em buildTurnAdvisories orienta antes da geração);
  // guarda legada só no replay. Em central_active a LLM acolhe seguindo o advisory + o prompt do portal.
  if (applyLegacyStyleGuards && args.financialAnswerSlot === "entrada" && !/\bentrada\b/i.test(normalizeText(composed.text))) {
    return { ok: false, feedback: "O cliente acabou de responder sobre ENTRADA. Acolha explicitamente essa resposta antes de avançar; não a ignore nem volte a outro ponto. Você continua livre para escolher UMA próxima pergunta útil." };
  }
  if (applyLegacyStyleGuards && args.financialAnswerSlot === "parcelaDesejada" && !/\bparcela\w*\b/i.test(normalizeText(composed.text))) {
    return { ok: false, feedback: "O cliente acabou de informar a PARCELA mensal desejada. Acolha explicitamente a parcela antes de avançar; não repita apenas a entrada. Você continua livre para escolher UMA próxima pergunta útil." };
  }
  // T2: mesmo sem send_media/reasonCode, o TEXTO não pode PROMETER foto num turno que não autoriza foto (e não é recall,
  // que legitimamente NOMEIA a foto lembrada). Guarda de OUTPUT (não classifica o turno) — a autoridade é photoAuthorized.
  if (!photoAuthorized && !photoRecall && textPromisesPhoto(composed.text)) {
    return { ok: false, feedback: PHOTO_NOT_REQUESTED_FEEDBACK };
  }
  // PII/UX safety: identidade não pode virar barreira de entrada para um ato
  // que a própria LLM classificou como substantivo. Esta é uma validação
  // genérica da autoria, não um roteador de assunto: o mesmo cérebro recebe
  // feedback e escolhe como tratar o ato atual sem pedir cadastro primeiro.
  const identityGateIntents = new Set(["search_stock", "request_photos", "recall_photos", "select_vehicle", "vehicle_detail", "institutional", "financing", "visit", "trade_in"]);
  const identityIntent = args.proposedPrimaryIntent ?? args.ctx.acceptedPrimaryIntent ?? null;
  const identityOnlyResponse = args.requireBrain
    && typeof identityIntent === "string"
    && identityGateIntents.has(identityIntent)
    && asksLeadName(composed.text)
    && !proposedEffects.some((effect) => effect.kind === "send_media" || effect.kind === "handoff" || effect.kind === "notify_seller")
    && !draft.parts.some((part) => part.type === "vehicle_offer_list" || part.type === "vehicle_ref" || part.type === "money_ref");
  if (identityOnlyResponse) {
    return { ok: false, feedback: `Você classificou o bloco atual como '${identityIntent}', mas sua resposta usa nome/identidade como barreira antes de tratar esse ato. Responda primeiro ao pedido atual e, se faltar informação, escolha uma pergunta relevante para esse ato conforme o portal. Só peça identidade depois se ela for realmente necessária; não escolha a próxima pergunta pelo engine.` };
  }
  // Continuidade global: quando a LLM declarou um ato substantivo atual,
  // uma pergunta institucional herdada nao pode substituir a resposta a
  // esse ato. A engine nao escolhe o novo assunto; apenas devolve a
  // incoerencia para a mesma LLM reescrever.
  // Somente a understanding desta autoria pode ativar esta validação. A
  // memória aceita é contexto e não deve transformar uma foto/seleção atual
  // em um bloqueio herdado de busca.
  const continuityIntent = args.proposedPrimaryIntent ?? null;
  const institutionalQuestionDisplacedCurrentAct = args.requireBrain
    && typeof continuityIntent === "string"
    && new Set(["financing", "trade_in"]).has(continuityIntent)
    && isServiceOrInstitutionalQuestion(composed.text)
    && !isServiceOrInstitutionalQuestion(args.leadMessage);
  if (institutionalQuestionDisplacedCurrentAct) {
    return { ok: false, feedback: `Sua resposta retomou uma pergunta institucional antiga enquanto o ato atual declarado foi '${continuityIntent}'. Responda primeiro ao bloco atual e preserve a continuidade factual; nao copie a pergunta pendente da memoria nem escolha outro assunto para a proxima pergunta.` };
  }
  const sensitiveFeedback = sensitiveAnswerCompletenessFeedback(args.sensitiveAnswerKinds ?? [], composed.text);
  if (sensitiveFeedback) return { ok: false, feedback: sensitiveFeedback };
  const humanFeedback = humanRequestDecisionFeedback({
    requested: args.humanRequested === true,
    handoffPlannable: args.handoffPlannable === true,
    proposedEffectKinds: proposedEffects.map((effect) => effect.kind),
    composedText: composed.text,
  });
  if (humanFeedback) return { ok: false, feedback: humanFeedback };
  // A LLM-declared disengagement is an operationally relevant decision. The
  // engine does not infer it from a phrase; it only requires the LLM to carry
  // the executable handoff act when that capability is actually available.
  const disengagementIntent = args.requireBrain && args.proposedPrimaryIntent === "disengagement";
  const disengagementHandoffProposed = proposedEffects.some((effect) => effect.kind === "handoff" || effect.kind === "notify_seller");
  if (disengagementIntent && args.handoffPlannable === true && !disengagementHandoffProposed) {
    return { ok: false, feedback: "Voce declarou que o bloco atual encerra o atendimento por desinteresse. Como a transferencia esta disponivel, inclua no mesmo final o efeito handoff com reason=qualified_handoff. A engine canonicaliza o motivo operacional e suspende o follow-up; nao reabra o funil nem colete dados." };
  }
  // ⭐Codex P0 (rodada 2): PROMESSA/OFERTA de transferência a consultor/vendedor SEM efeito real materializado
  // (handoff/notify_seller inexistentes nesta fase) é mentira operacional — mesmo padrão do textPromisesPhoto.
  // A LLM reescreve conduzindo ELA MESMA. Quando a Fase 3 materializar o handoff, a promessa passa a exigir o
  // EFEITO correspondente no plano (o predicado já checa proposedEffects).
  if (args.requireBrain && promisesHumanHandoff(composed.text)) {
    const handoffProposed = proposedEffects.some((e) => e.kind === "handoff" || e.kind === "notify_seller");
    // HF-1: promessa de consultor SÓ passa com o plano EXECUTÁVEL no MESMO turno = effect handoff proposto
    // E transferência plannable (flag+vendedor+vínculo+portal). Qualquer outra combinação = deny + reescrita
    // pela MESMA LLM (nunca texto do engine).
    if (!handoffProposed && args.handoffPlannable === true) {
      return { ok: false, feedback: "Você prometeu/ofereceu ENCAMINHAR para consultor/vendedor, mas NÃO incluiu o efeito de transferência neste turno. Se transferir é o próximo passo (cliente pediu humano OU a qualificação está completa), inclua nos effects: {\"kind\":\"handoff\",\"reason\":\"explicit_human_request\"|\"qualified_handoff\"}. Senão, reescreva SEM prometer transferência e continue VOCÊ conduzindo." };
    }
    if (!handoffProposed || args.handoffPlannable !== true) {
      if (args.humanRequested !== true) {
        return { ok: false, feedback: "Voce mencionou/propôs transferência sem o cliente pedir humano e sem um handoff executável. Nao fale de indisponibilidade nem de transferência: continue VOCE atendendo e responda ao ato atual do cliente com UMA proxima pergunta natural." };
      }
      // MISSÃO PII (invariantes 9/10): a indisponibilidade REAL exige TRANSPARÊNCIA — nunca esconder o pedido
      // do cliente nem convertê-lo em coleta de dados. PROIBIDO condicionar a transferência a CPF/qualificação.
      return { ok: false, feedback: "A transferência NÃO pode ser executada neste momento (indisponibilidade real do sistema — o motivo técnico fica registrado). Reescreva com TRANSPARÊNCIA: reconheça o pedido do cliente, diga com honestidade que não consegue transferir AGORA e ofereça uma alternativa (continuar ajudando por aqui / registrar o pedido para a equipe retornar). PROIBIDO: condicionar a transferência a CPF ou qualquer outro dado, fingir que a transferência está em andamento, ou ignorar o pedido voltando ao funil de qualificação." };
    }
  }
  if (args.requireBrain && promisesVisitScheduled(composed.text)) {
    const schedulingEffect = proposedEffects.some((effect) => effect.kind === "schedule_visit" || effect.kind === "handoff");
    if (!schedulingEffect) {
      return { ok: false, feedback: "Voce afirmou que a visita sera/foi agendada, mas nao existe efeito executavel de agendamento neste turno. Nao prometa uma acao que nao ocorreu: reconheca o dia informado e continue VOCE combinando o proximo dado necessario, como o horario, com UMA pergunta." };
    }
  }
  // ⭐RD1-2 (Codex #2): a guarda de "pergunta dupla de ação" foi REMOVIDA do central_active — ela banía até a alternativa
  // curta e relacionada do MESMO veículo ("quer as fotos ou prefere ver as condições dele?"), que é natural. O advisory
  // (buildTurnAdvisories) orienta a não empilhar perguntas INDEPENDENTES; a LLM decide o próximo passo.
  // P0-2 (audit): a resposta ao lead NUNCA pode conter LITERALMENTE uma vehicleKey conhecida (chave/código interno).
  const slotClaimFeedback = factualSlotClaimFeedback(composed.text, args.ctx.state);
  if (args.requireBrain && slotClaimFeedback) return { ok: false, feedback: slotClaimFeedback };
  for (const k of knownVehicleKeys(realFacts, args.identities, args.ctx.state)) {
    if (composed.text.includes(k)) return { ok: false, feedback: `Você escreveu a chave interna do veículo ("${k}") na resposta. Use o NOME do carro (marca modelo ano), NUNCA a chave/código interno.` };
  }
  // Valida contra fatos REAIS (identidade de memória NÃO aterra atributo/oferta).
  // Validate against the same structured facts used by the renderer. The last
  // rendered offer is accepted conversation data, not free-form memory. Rules
  // requiring a query in the current turn still use realFacts above.
  // ⭐RD1-2: em central_active (requireBrain) as POL de ESTILO (telefone/uma-pergunta/reask de slot) NÃO negam — viraram
  // advisory. As POL de FATO/PII (grounding, POL-CPF-TIMING) seguem HARD; o grounding é sempre avaliado (sem retorno-cedo de estilo).
  const gv = PolicyEngine.validateResponse(composed, renderFacts, decision0, args.ctx, args.requireBrain === true);
  if (hasDeny(gv)) return { ok: false, feedback: args.selectionTurn ? SELECTION_ATTR_FEEDBACK : sanitizePolicyFeedback(gv) };
  // RD1-2: o "gancho SDR" após institucional é ADVISORY (institutionalHookNeeded em buildTurnAdvisories); guarda legada só no replay.
  if (applyLegacyStyleGuards && isServiceOrInstitutionalQuestion(args.leadMessage)
      && hasCommercialConversationContext(args.ctx.state)
      && !ATTR_QUESTION_RX.test(normalizeText(args.leadMessage))
      && !leadRequestsPhoto(args.leadMessage)
      && detectDisengagement(args.leadMessage) == null
      && !hasQuestion(composed.text)
      && !draft.parts.some((p) => p.type === "vehicle_offer_list")
      && !proposedEffects.some((e) => e.kind === "send_media")) {
    return { ok: false, feedback: "Responda a duvida do cliente e conduza como SDR com UMA pergunta curta ligada ao contexto atual (fotos, detalhes, condicoes, visita ou proximo passo do carro em conversa). Nao pare seco depois da resposta." };
  }
  // RD1-2: a forma da DESPEDIDA (sem pergunta/nome/reabrir funil) é ADVISORY (disengagementOnly em buildTurnAdvisories);
  // guarda legada só no replay. A promessa de transferência numa despedida continua barrada pela guarda HARD de handoff acima.
  if (applyLegacyStyleGuards && args.disengagementOnly && (hasQuestion(composed.text) || promisesHumanHandoff(composed.text)
      || asksLeadName(composed.text) || asksLeadSurname(composed.text))) {
    if (process.env.PEDRO_V3_DENY_DEBUG) console.error(`[DENY_DEBUG_DISENGAGEMENT_TEXT] ${composed.text.slice(0, 500)}`);
    return { ok: false, feedback: "DESPEDIDA: o cliente apenas agradeceu/encerrou e NÃO fez um novo pedido. Não reabra qualificação, não faça pergunta e não repita transferência. Reescreva você mesmo uma despedida curta e cordial, deixando a loja à disposição. Se o bloco também trouxesse um pedido novo, ele teria prioridade — não é o caso deste turno." };
  }
  // Missão P0 INC2/F: NUNCA peça SOBRENOME / nome completo — o primeiro nome basta e só mais adiante. deny SEMPRE (o carro
  // é o assunto, não cadastro). O cérebro RE-AUTORA avançando a intenção comercial.
  // RD1-2: "não peça sobrenome" é ADVISORY (needsDiscovery em buildTurnAdvisories já orienta "não peça sobrenome nem nome completo"); guarda legada só no replay.
  if (applyLegacyStyleGuards && asksLeadSurname(composed.text)) {
    return { ok: false, feedback: "NÃO peça sobrenome nem nome completo — nunca nessa fase; o primeiro nome já basta. Em vez de coletar cadastro, avance a conversa: pergunte o que ele procura, ofereça opções, ou trate condições/visita." };
  }
  // PARTE A (missão abertura SDR) + Missão P0 INC2/F: NÃO peça o NOME antes de haver intenção comercial — abertura sem alvo
  // (1º contato/anúncio genérico) OU ainda sem NENHUM contexto comercial (sem interesse/tipo/faixa, sem carro ofertado/
  // selecionado). Se pediu nome sem descoberta (e sem listar/enviar carro) -> deny + feedback (o cérebro RE-AUTORA). INC2:
  // "Sim, conheço" não deve virar pedido de nome. Telefone já é barrado por POL-PHONE-KNOWN.
  // RD1-2: "descoberta antes do nome" na abertura é ADVISORY (needsDiscovery/isFirstContact em buildTurnAdvisories); guardas legadas só no replay.
  if (applyLegacyStyleGuards && (args.openingNeedsDiscovery || args.noCommercialContextYet)
      && !proposedEffects.some((e) => e.kind === "send_media")
      && !draft.parts.some((p) => p.type === "vehicle_offer_list")
      && asksLeadName(composed.text)
      && !mentionsCommercialDiscovery(composed.text)) {
    return { ok: false, feedback: "O cliente ainda NÃO disse o que procura. NÃO peça o nome agora — primeiro entenda a intenção comercial: pergunte o que ele procura (um modelo, um TIPO de carro — SUV/sedan/hatch/picape — ou uma FAIXA de preço). O nome vem depois, com naturalidade, quando já houver interesse." };
  }
  if (applyLegacyStyleGuards && args.openingNeedsDiscovery
      && !proposedEffects.some((e) => e.kind === "send_media")
      && !draft.parts.some((p) => p.type === "vehicle_offer_list")
      && !mentionsCommercialDiscovery(composed.text)) {
    return { ok: false, feedback: "ABERTURA SEM ALVO COMERCIAL: cumprimente e se apresente conforme o PROMPT DO PORTAL, mas a sua unica pergunta precisa descobrir o que o cliente procura (modelo, tipo de carro ou faixa de preco). Nao troque a descoberta por cidade, loja, nome, telefone, troca ou pagamento." };
  }
  // Missão P0 (audit Codex smoke real T8): NUNCA repergunte o NOME quando ele JÁ está conhecido (o lead já se apresentou). E
  // NUNCA peça nome num turno de PAGAMENTO/condições/financiamento — pagamento avança a QUALIFICAÇÃO (troca/entrada/parcela/
  // simulação), não coleta cadastro. Deny + feedback -> o cérebro RE-AUTORA conduzindo, sem pedir nome.
  // RD1-2: "não reperguntar nome conhecido" e "pagamento não é cadastro" são ADVISORY (knownName/paymentTurnWithChosenCar/
  // knownFunnelSlots em buildTurnAdvisories); guardas legadas só no replay.
  if (applyLegacyStyleGuards && asksLeadName(composed.text)) {
    if (args.ctx.state.slots.nome.status === "known") {
      const known = args.ctx.state.slots.nome.value;
      return { ok: false, feedback: `Você JÁ sabe o nome do cliente${typeof known === "string" && known ? ` (${known})` : ""}. NÃO pergunte o nome de novo — use-o e siga a conversa (o que ele procura, opções, condições ou visita).` };
    }
    if (isPaymentTurn(args.leadMessage)) {
      // ⭐F2.43 (varredura exige-e-proíbe, fase): o veto vale ENQUANTO a qualificação financeira está incompleta.
      // Com troca+entrada+parcela CONHECIDAS, o portal ainda pode orientar a
      // coleta opcional do nome para enriquecer o CRM. Isso nunca condiciona o
      // handoff: canal e leadId já identificam operacionalmente o contato.
      const sl = args.ctx.state.slots;
      const qualificationDone = sl.possuiTroca.status === "known" && sl.entrada.status === "known" && sl.parcelaDesejada.status === "known";
      if (!qualificationDone) {
        return { ok: false, feedback: "O cliente pediu as CONDIÇÕES DE PAGAMENTO. NÃO peça o nome — pagamento não é cadastro. Avance a qualificação financeira perguntando UMA coisa por vez (não empilhe): comece pela TROCA (tem carro para dar na troca?), senão ENTRADA, senão PARCELA mensal — só UMA pergunta." };
      }
    }
  }
  // ⭐T8 (audit Codex, LLM-first): turno de PAGAMENTO com veículo JÁ ESCOLHIDO (selecionado OU há oferta na última lista) ->
  // o agente CONDUZ o financiamento do carro selecionado; NUNCA volta para a DESCOBERTA ("o que você procura?/que tipo?").
  // Draft vira discovery -> deny + feedback (a LLM RE-AUTORA conduzindo). O engine NÃO escreve a resposta.
  // RD1-2: "pagamento não volta à descoberta" é ADVISORY (paymentTurnWithChosenCar em buildTurnAdvisories); guarda legada só no replay.
  if (applyLegacyStyleGuards && isPaymentTurn(args.leadMessage)
      && (args.ctx.state.vehicleContext.selected?.key != null || (args.ctx.state.lastRenderedOfferContext?.items?.length ?? 0) > 0)
      && asksDiscoveryQuestion(composed.text)) {
    const sel = args.ctx.state.vehicleContext.selected;
    const selLabel = sel?.label && sel.label !== sel.key ? sel.label : "o veículo que ele já escolheu";
    return { ok: false, feedback: `O cliente pediu as CONDIÇÕES DE PAGAMENTO de ${selLabel} — ele JÁ escolheu o carro. NÃO volte para a descoberta ("o que você procura"/"que tipo"). CONDUZA o financiamento perguntando UMA coisa por vez (não empilhe): TROCA, ou ENTRADA, ou PARCELA mensal — só UMA. NÃO afirme valores específicos (pergunte-os).` };
  }
  // ── MISSÃO P0 (Financial Question Context, caso F): NUNCA empilhe DUAS perguntas financeiras no mesmo texto ("tem
  //    entrada ou vai financiar?"). Em pagamento pergunte UMA dimensão por vez. Deny + feedback -> o cérebro RE-AUTORA
  //    com UMA pergunta (o engine NÃO escreve a resposta). Ordem SDR sugerida: troca -> entrada -> parcela.
  // RD1-2: "uma pergunta financeira por vez" é ADVISORY (advisory geral "no máximo UMA pergunta acionável"); guarda legada só no replay.
  if (applyLegacyStyleGuards && financialDimensionsAsked(composed.text).size > 1) {
    return { ok: false, feedback: "Você empilhou DUAS perguntas financeiras no mesmo texto (ex.: entrada E financiamento/parcela). Em pagamento pergunte UMA coisa por vez: escolha a MAIS importante agora — nesta ordem, se ainda não sabe: carro na TROCA, senão valor de ENTRADA, senão PARCELA mensal confortável — e REMOVA a outra pergunta. Acolha o que ele já disse antes de perguntar." };
  }
  // PARTE A (missão P0): ENTRADA por anúncio ESPECÍFICO — a abertura DEVE reconhecer/conduzir o VEÍCULO do anúncio (não uma
  // saudação genérica pedindo nome/telefone/cidade/loja). INVARIANTE (o engine NÃO escreve a resposta, só NEGA): se o draft
  // não mostra/lista/oferece o veículo E não cita a marca/modelo do anúncio conduzindo sobre ele -> deny + feedback (o
  // cérebro RE-AUTORA). Aceita: send_media/vehicle_offer_list, OU citar o veículo + conduzir (foto/detalhe/condição/
  // disponibilidade/pergunta sobre ele).
  // RD1-2: reconhecer/conduzir o veículo do ANÚNCIO é ADVISORY (adVehicleLabel em buildTurnAdvisories orienta antes da geração); guarda legada só no replay.
  if (applyLegacyStyleGuards && args.specificAdVehicle) {
    const showsVehicle = proposedEffects.some((e) => e.kind === "send_media") || draft.parts.some((p) => p.type === "vehicle_offer_list");
    const acknowledgesAndConducts = mentionsAdVehicle(composed.text, args.specificAdVehicle) && conductsAboutAdVehicle(composed.text);
    if (!showsVehicle && !acknowledgesAndConducts) {
      return { ok: false, feedback: `O cliente CHEGOU por um anúncio do ${args.specificAdVehicle}. NÃO abra com saudação genérica nem peça nome/telefone/cidade/loja: RECONHEÇA o ${args.specificAdVehicle} do anúncio e CONDUZA sobre ELE — cite a marca/modelo e ofereça fotos, detalhes, condições ou confirme a disponibilidade desse veículo.` };
    }
  }
  // Missão P0 INC1/A: em turno COMERCIAL/BUSCA (ou retomada "cadê?"), PROIBIDO prometer buscar ("vou buscar/procurar/
  // verificar/já busco") sem ter chamado stock_search NESTE turno. Prometeu e não buscou -> deny + feedback (chama a tool
  // AGORA, nunca "busco depois"). Guarda de OUTPUT (o texto ao lead), como textPromisesPhoto.
  if (args.searchExpectedThisTurn
      && !args.facts.some((f) => f.ok && f.tool === "stock_search")
      && !proposedEffects.some((e) => e.kind === "send_media")
      && textPromisesSearch(composed.text)) {
    return { ok: false, feedback: "Você PROMETEU buscar mas NÃO chamou stock_search neste turno. Você já tem filtro suficiente — chame stock_search AGORA (com marca/modelo/tipo/preço/câmbio que o cliente informou) e responda com a lista no MESMO turno. NUNCA diga 'vou buscar/procurar/verificar' sem executar a busca antes." };
  }
  // COMPLETUDE (prompt-first): a resposta não pode IGNORAR um pedido explícito (horário/endereço/unidade/foto). Grounding
  // ok mas pediu horário e respondeu só endereço -> feedback ao MESMO cérebro (retry). Não reescreve, não decide o assunto.
  // P0 (RESOLUÇÃO ÚNICA): foto pedida = semântica do cérebro OU ordinal resolvido + pedido explícito ("foto do segundo").
  // Sem isto, quando o cérebro rotula "foto do segundo" só como seleção, ele podia ignorar a foto e passar batido.
  const incomplete = turnCompletenessFeedback({ leadMessage: args.leadMessage, composed, institutionalObs: args.institutionalObs ?? new Map(), proposedEffects, pendingObjective: args.ctx.state.currentObjective?.status === "pending", photoRequested: photoAuthorized || authorizesPhotoByResolvedTarget(args.target, args.leadMessage, args.ctx.state) || leadRequestsPhoto(args.leadMessage), photoTargetResolved: args.target.kind === "resolved" });
  if (incomplete) return { ok: false, feedback: incomplete };
  // ⭐RD1-2 (Codex): a ANTI-REPETIÇÃO de slot conhecido virou ADVISORY (buildTurnAdvisories: knownName/knownFunnelSlots +
  // "se o cliente já respondeu, reconheça e siga — não repita a mesma pergunta"). Não há mais deny de repetição no
  // central_active; a LLM conduz sem reperguntar o que já sabe, seguindo as orientações do turno. (Guarda no legado:
  // o replay não precisa dela — o contrato antigo não a exercitava fora de requireBrain.)
  return { ok: true, decision: decision0, composed, proposedEffects };
}

// B2 (audit): para pergunta de ATRIBUTO do veículo SELECIONADO, o turno EXIGE um vehicle_details BEM-SUCEDIDO do MESMO
// vehicleKey antes do final. Sem esse fato -> mensagem que força a consulta (o cérebro devolve query). Detalhe de OUTRO
// vehicleKey NÃO satisfaz. Sem veículo selecionado -> null (o cérebro pede esclarecimento; nunca consulta arbitrário).
// P0-sel (missão): SÓ exige detalhe quando o lead REALMENTE pergunta um atributo (km/cor/câmbio/preço/ano/consumo/...).
// Uma SELEÇÃO ("gostei do segundo", "esse") pode vir classificada como asks_vehicle_detail pelo preparer — mas sem
// pergunta de atributo NÃO deve forçar vehicle_details (o cérebro acolhe a escolha; citar atributo é barrado no validate).
const ATTR_QUESTION_RX = /\bkm\b|quilometr|rodad|\bcor\b|\bcambio\b|c[aâ]mbio|autom[aá]tic|\bmanual\b|\bpre[çc]o\b|\bvalor\b|quanto\s+(?:custa|sai|fica|e)\b|\bano\b|\bconsumo\b|\bmotor\b|\bversao\b|vers[aã]o|\bopcionais\b|\bcompleto\b|quantos?\s+(?:km|quilometr)/;
function requireVehicleDetailBeforeFinal(frame: ReturnType<typeof buildTurnFrame>, observations: readonly AgentToolObservation[], target: TargetResolution): string | null {
  if (!ATTR_QUESTION_RX.test(normalizeText(frame.block))) return null;   // seleção pura -> não força detalhe
  const targetKey = target.kind === "resolved" ? target.vehicleKey : (frame.workingMemory.selectedVehicle?.vehicleKey ?? null);
  if (!targetKey) return null;
  const selectedKey = targetKey;
  const hasDetail = observations.some((o) => o.tool === "vehicle_details" && o.ok && o.data.vehicle.vehicleKey === targetKey);
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
const PHOTO_NOT_REQUESTED_FEEDBACK = "O cliente NÃO pediu fotos neste turno. NÃO use vehicle_photos_resolve, send_media nem reasonCode de envio. Preserve o ATO que você mesmo identificou: seleção deve ser acolhida em FINAL com UMA pergunta oferecendo fotos; busca só usa stock_search quando o ato realmente for search_stock; conversa/financiamento respondem sem tool de foto.";

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
const PHOTO_ORDINAL_CLARIFY_RX = /\b(?:qual|quais|numero|n[uú]mero|op[cç][aã]o|item|lista|primeir|segund|terceir|quart|quint)\b/;
function turnCompletenessFeedback(args: {
  readonly leadMessage: string;
  readonly composed: RenderedResponse;
  readonly institutionalObs: ReadonlyMap<BusinessInfoTopic, AgentToolObservation>;
  readonly proposedEffects: readonly ProposedEffectPlan[];
  readonly pendingObjective: boolean;   // objetivo pendente (ex.: pagamento) -> policy pode ter prioridade sobre a foto
  readonly photoRequested: boolean;     // T2 (fonte única): o turno autoriza foto pela semântica (não regex de frase)
  readonly photoTargetResolved: boolean;
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
      && !PHOTO_HONEST_ABSENCE_RX.test(normResp)
      && !(!args.photoTargetResolved && PHOTO_ORDINAL_CLARIFY_RX.test(normResp))) {
    return "O cliente pediu FOTO neste turno e a resposta não enviou (send_media) nem disse honestamente que não localizou. Resolva vehicle_photos_resolve do carro certo e inclua send_media com os photoIds — ou diga que não encontrou as fotos. NÃO responda só outro assunto ignorando o pedido de foto.";
  }
  if (!args.pendingObjective
      && args.photoRequested
      && parseOrdinal(args.leadMessage) != null
      && !args.proposedEffects.some((e) => e.kind === "send_media")
      && !PHOTO_ORDINAL_CLARIFY_RX.test(normResp)) {
    return "O cliente pediu FOTO por uma referencia ordinal (ex.: primeiro/segundo/item 2), mas nao ha item resolvido para enviar. Responda explicitamente que nao ha uma lista/item ordinal valido neste contexto OU pergunte qual carro ele quer, mencionando o ordinal/lista. Nao repita apenas a busca anterior.";
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
  readonly adCandidateKeys: readonly string[];       // Fix C: candidatos do anúncio (>1 -> pergunta qual, lista só eles)
}): { decision: TurnDecision; composed: RenderedResponse; proposedEffects: ProposedEffectPlan[]; targetSource: TargetResolutionSource } | null {
  // P0-2: em llmFirst sem cérebro NÃO envia — EXCETO alvo resolvido (ordinal/anúncio/seleção/modelo) + pedido de foto (grounding
  // máximo; nunca "foto solta"), OU conjunto CANDIDATO do anúncio (>1) + pedido de foto (aí pergunta QUAL, não escolhe errado).
  if (!authorizesPhotoSend(args.photoVU, args.leadMessage, args.requireBrain) && !authorizesPhotoByResolvedTarget(args.target, args.leadMessage, args.ctx.state) && !(args.adCandidateKeys.length > 1 && leadRequestsPhoto(args.leadMessage))) return null;
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
    // Fix C: pedido de foto do anúncio com >1 CANDIDATO (ex.: 2 Onix 2025) -> lista SÓ os candidatos do anúncio e pergunta
    // qual, NUNCA re-lista o estoque todo nem escolhe errado. Aterrado nos itens já ofertados (marca/modelo/ano/preço reais).
    const candItems = (state.lastRenderedOfferContext?.items ?? []).filter((it) => args.adCandidateKeys.includes(it.vehicleKey));
    if (candItems.length > 1) {
      const lines = candItems.slice(0, 4).map((it, i) => { const lbl = [it.marca, it.modelo, it.ano].filter(Boolean).join(" "); const price = typeof it.preco === "number" && it.preco > 0 ? ` — R$ ${it.preco.toLocaleString("pt-BR")}` : ""; return `${i + 1}. ${lbl}${price}`; });
      const text = `Do anúncio, temos essas opções:\n${lines.join("\n")}\nDe qual você quer as fotos? Me diz o número ou o ano.`;
      return build(ensureSendMessage([]), text, "clarify", "photo_clarify_ad_candidates", "pedido de foto do anúncio com >1 candidato -> lista só os candidatos do anúncio", 0.6, "ambiguous");
    }
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
    // PARTE B (missão): anexa mark_photos_sent para o photoLedger ACUMULAR os IDs enviados (dedup durável de "manda mais").
    // Os photoIds aqui são o conjunto completo; a CURADORIA (cap 5 + dedup) é aplicada 1x no chokepoint capPhotoEffects,
    // que reescreve ESTE onSuccess para os IDs realmente enviados. (Antes era onSuccess:[] e o ledger não populava.)
    const media: ProposedEffectPlan = { kind: "send_media", planId: "photos", order: 1, onSuccess: [{ op: "mark_photos_sent", effectId: "x", vehicleKey: targetKey, photoIds: [...photos.data.photoIds] }], vehicleKey: targetKey, photoIds: [...photos.data.photoIds] };
    const text = label ? `Aqui estão as fotos do ${label}. Quer que eu te passe mais detalhes dele?` : "Aqui estão as fotos que você pediu. Quer que eu te passe mais detalhes desse carro?";
    return build(ensureSendMessage([media]), text, "send_photos", "send_vehicle_photos", "executor determinístico de foto (alvo do assunto + photoIds reais)", 0.9, target.source);
  }
  const text = label ? `Não localizei as fotos do ${label} agora. Quer que eu te passe os detalhes dele por aqui?` : "Não localizei as fotos desse carro agora. Quer que eu te passe os detalhes dele por aqui?";
  return build(ensureSendMessage([]), text, "clarify", "photo_unavailable", "alvo resolvido mas sem photoIds do assunto", 0.4, target.source);
}

// ── PARTE B (missão): CURADORIA de fotos no chokepoint ÚNICO da decisão finalizada. Limita o payload de send_media a
//    até 5 fotos com DIVERSIDADE (photo-selection) e remove as JÁ ENVIADAS (dedup durável: photoLedger ∪ lastPhotoAction
//    do MESMO veículo). NÃO muda a decisão do cérebro (mesmo carro, mesma fala) — só seleciona melhor o payload de mídia.
//    Reescreve também o onSuccess mark_photos_sent para os IDs REALMENTE enviados (ledger consistente). PURO. ───────────
type LastPhotoWM = { readonly lastPhotoAction?: { readonly vehicleKey: string; readonly photoIds: readonly string[] } | null };
function photoIdsAlreadySent(state: ConversationState, wm: LastPhotoWM, vehicleKey: string): string[] {
  const ledger = state.photoLedger?.sentByVehicle?.[vehicleKey] ?? [];
  const last = (wm.lastPhotoAction && wm.lastPhotoAction.vehicleKey === vehicleKey) ? wm.lastPhotoAction.photoIds : [];
  return [...new Set([...ledger, ...last])];
}
function capPhotoEffects(decision: TurnDecision, state: ConversationState, wm: LastPhotoWM): TurnDecision {
  if (!decision.effectPlan.some((p) => p.kind === "send_media")) return decision;
  const newPlan: (typeof decision.effectPlan)[number][] = [];
  for (const p of decision.effectPlan) {
    if (p.kind !== "send_media" || !p.photoIds || p.photoIds.length === 0) { newPlan.push(p); continue; }
    const sent = photoIdsAlreadySent(state, wm, p.vehicleKey);
    const sel = selectPhotos({ availablePhotoIds: p.photoIds, alreadySentPhotoIds: sent });
    if (sel.selectedPhotoIds.length === 0) continue;   // tudo já enviado -> NÃO reenvia (drop; não manda 0 nem repete)
    if (sel.selectedPhotoIds.length === p.photoIds.length) { newPlan.push(p); continue; }   // nada a recortar/dedupar
    const onSuccess = (p.onSuccess ?? []).map((op) => op.op === "mark_photos_sent" ? { ...op, photoIds: [...sel.selectedPhotoIds] } : op);
    newPlan.push({ ...p, photoIds: [...sel.selectedPhotoIds], onSuccess });
  }
  return { ...decision, effectPlan: newPlan };
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

// ── Fix A (audit CTWA — condução SDR): resposta de RECUPERAÇÃO por RELAXAMENTO. A busca EXATA zerou; o engine já rodou a
//    cascata (async) e achou itens REAIS num filtro relaxado. Aqui monta a resposta que CONDUZ: nomeia o filtro original que
//    não achou + apresenta a lista relaxada ATERRADA + uma pergunta única. Nunca "quer que eu veja outras opções?" solto. PURO. ──
// Fix A: a autoria do cérebro JÁ apresenta veículo (lista de oferta OU foto)? Se sim, não sobrepõe com o relaxamento. PURO.
function authoredPresentsVehicles(composed: RenderedResponse | null, effects: readonly ProposedEffectPlan[] | null): boolean {
  if (effects?.some((e) => e.kind === "send_media")) return true;
  return (composed?.draft?.parts ?? []).some((p) => (p as { type?: string }).type === "vehicle_offer_list");
}
const RELAX_LEADIN: Record<RelaxKind, string> = {
  same_type_in_range: "eu não encontrei agora, mas nessa faixa achei estas opções pra você",
  drop_ceiling: "eu não encontrei exatamente nessa faixa, mas tenho estas bem próximas, um pouco acima",
  same_brand_in_range: "eu não encontrei, mas nessa faixa tenho outras opções da mesma marca",
  same_type: "eu não encontrei nessa faixa, mas tenho estas do mesmo tipo",
  in_range: "eu não encontrei, mas nessa faixa tenho estas opções",
};
function buildRelaxedOfferResponse(args: {
  readonly zeroedDesc: string;
  readonly kind: RelaxKind;
  readonly items: readonly VehicleFact[];
  readonly facts: readonly QueryResult[];
  readonly identities: readonly RememberedVehicleIdentity[];
  readonly ctx: TurnContext;
  readonly turnId: string;
}): { decision: TurnDecision; composed: RenderedResponse; proposedEffects: ProposedEffectPlan[] } {
  const keys = args.items.slice(0, 4).map((v) => v.vehicleKey);
  const lead = args.zeroedDesc ? `${args.zeroedDesc} ${RELAX_LEADIN[args.kind]}:` : `Não achei exatamente isso, mas ${RELAX_LEADIN[args.kind]}:`;
  const draft: ResponseDraft = { parts: [{ type: "text", content: lead }, { type: "vehicle_offer_list", vehicleKeys: keys }, { type: "text", content: "Quer que eu te mostre as fotos ou os detalhes de alguma?" }] };
  const factsArr = [...args.facts];
  const text = ResponseRenderer.render(draft, factsArr, args.ctx.state, args.identities);
  const pe = ensureSendMessage([]);
  const prop: ProposedDecision = { proposedAction: "reply", facts: [], proposedEffects: pe, responsePlan: { guidance: text }, reasonCode: "recovery_relaxed_offer", reasonSummary: `busca vazia -> relaxamento ${args.kind} com itens reais`, confidence: 0.7 };
  const decision = finalize(args.turnId, prop, PolicyEngine.postQuery(prop, factsArr, args.ctx), factsArr);
  return { decision, composed: { draft, text }, proposedEffects: pe };
}

// ── Fix B (audit CTWA — condução SDR): ABERTURA por anúncio genérico. Detectores + resposta de DESCOBERTA. ──
// O texto ABRE pedindo o NOME/dado de contato do lead (abertura burocrática de formulário)? PURO.
const ASKS_LEAD_NAME_RX = /\b(?:qual|quais|como)\b[^?]*\b(?:seu|teu|o\s+seu)\s+nome\b|\bseu\s+nome\b\s*\??$|\bcomo\s+(?:voce|vc|tu|o\s+senhor|a\s+senhora)\s+se\s+chama|\bme\s+(?:diz|fala|informa|passa|dizer)\b[^?]*\bnome\b|\bpode\s+me\s+(?:dizer|passar|informar|falar)\b[^?]*\bnome\b|\bcom\s+quem\s+(?:eu\s+)?(?:falo|estou\s+falando)\b|\bqual\s+(?:e\s+)?o\s+seu\s+nome\b/;
function asksLeadName(text: string): boolean { return ASKS_LEAD_NAME_RX.test(normalizeText(text)); }
// Missão P0 (audit Codex smoke real T8): o BLOCO do lead é sobre CONDIÇÕES DE PAGAMENTO / financiamento? Nesse turno o
// agente NÃO deve pedir nome (é qualificação financeira, não cadastro). PURO. normalizeText remove acentos.
const PAYMENT_TURN_RX = /\bcondic[oõ]?es?\b|\bpagament|\bfinanci|\bparcel|\bentrada\b|\ba\s+vista\b|\bconsorci|\bcontemplad|\bcarta\s+de\s+credito|\bsimul(?:ar|acao|e)\b/;
function isPaymentTurn(leadMessage: string): boolean { return PAYMENT_TURN_RX.test(normalizeText(leadMessage)); }
// Missão P0 (audit Codex T8): o draft está PERGUNTANDO a DESCOBERTA ("o que você procura?", "que tipo?", "me conta mais do
// que procura", "qual faixa?")? NARROW (não pega "opções de financiamento"). PURO. normalizeText remove acentos.
const ASKS_DISCOVERY_RX = /\bo\s+que\s+(?:voce|vc|tu|o\s+senhor|a\s+senhora)\s+(?:procur|busc|quer|deseja|precis|ta\s+buscando)|\bque\s+tipo\s+de\s+(?:carro|veiculo)\b|\bqual\s+(?:modelo|tipo)\b[^?]*\b(?:procur|quer|interess|busc)|\bme\s+conta\s+(?:um\s+pouco\s+)?mais\s+do\s+que\s+voce\s+(?:procur|busc)|\bqual\s+(?:a\s+)?faixa\s+de\s+(?:preco|valor)\b/;
function asksDiscoveryQuestion(text: string): boolean { return ASKS_DISCOVERY_RX.test(normalizeText(text)); }
// ── MISSÃO P0 (Financial Question Context, caso F): quantas DIMENSÕES financeiras DISTINTAS o texto PERGUNTA (só nas
//    sentenças interrogativas, p/ um statement "com entrada zero." não contar). Dimensões: entrada / parcela / troca /
//    forma de pagamento. "à vista ou financiado?" = 1 dimensão (pagamento, 2 opções). "tem entrada ou vai financiar?" =
//    2 dimensões (entrada + pagamento) = pergunta DUPLA. Invariante p/ "uma pergunta financeira por vez". PURO.
function financialDimensionsAsked(text: string): Set<string> {
  const dims = new Set<string>();
  // Separa por FIM DE FRASE (. ! ?) e mantém só as sentenças INTERROGATIVAS. Assim um acolhimento ("Com essa parcela
  // dá pra montar um plano.") NÃO conta — só o que está de fato sendo PERGUNTADO ("Você tem carro na troca?").
  const qClauses = text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s.endsWith("?"));
  const scope = normalizeText(qClauses.join(" "));
  if (!scope) return dims;
  if (/\bentrada\b/.test(scope)) dims.add("entrada");
  if (/\bparcela\b|\bmensal|\bprestac/.test(scope)) dims.add("parcela");
  if (/\btroca\b/.test(scope)) dims.add("troca");
  if (/\bfinanci|\ba\s+vista\b|\bconsorci/.test(scope)) dims.add("pagamento");
  return dims;
}
// Missão P0 INC2/F: o texto pede SOBRENOME / nome completo? (nunca deve, nessa fase). PURO.
const ASKS_SURNAME_RX = /\bsobrenome\b|\bnome\s+completo\b|\bnome\s+e\s+sobrenome\b/;
function asksLeadSurname(text: string): boolean { return ASKS_SURNAME_RX.test(normalizeText(text)); }
// Missão P0 INC1/A: o texto PROMETE buscar/verificar sem executar a tool ("vou buscar/procurar/verificar/já busco/deixa
// eu ver/já te trago as opções"). É a promessa vazia que a missão proíbe quando há filtro suficiente e nenhuma busca. PURO.
const SEARCH_PROMISE_RX = /\b(?:vou|irei|vamos|ja|deixa\s+eu|deixe?\s+me|posso)\s+(?:ja\s+)?(?:buscar|procurar|verificar|conferir|checar|olhar|ver|pesquisar|dar\s+uma\s+olhada|te\s+trazer|trazer|levantar|separar)\b|\bja\s+(?:busco|procuro|verifico|confiro|te\s+trago|te\s+mostro)\b|\bvou\s+ver\s+(?:as\s+)?opcoes\b|\bja\s+te\s+(?:trago|mostro|passo)\s+(?:as\s+)?opcoes\b/;
function textPromisesSearch(text: string): boolean { return SEARCH_PROMISE_RX.test(normalizeText(text)); }
// Missão P0 INC1/B: o lead pede o RESULTADO de uma busca prometida/pendente ("cadê?/e aí?/achou?/me mostra/manda/e então").
// Sem constraint comercial próprio no bloco — é retomada, não busca nova. PURO.
const RESUME_SEARCH_RX = /^\s*(?:cad[eê]|e\s+a[ií]|e\s+entao|entao\??|achou|encontrou|kd|show|manda(?:\s+(?:a[ií]|ver|entao))?|me\s+mostra|mostra(?:\s+(?:a[ií]|entao))?|e\s+ai\s+achou|beleza\??)[\s!?.]*$/;
function wantsResumeSearch(block: string): boolean { return RESUME_SEARCH_RX.test(normalizeText(block)); }
// Missão P0 E: intenção EXPLÍCITA de COMPRA (vira busca mesmo com pergunta de troca pendente): "quero comprar X", "tem X?",
// "procuro/busco X", "quero um/uma X". NÃO casa "tenho" (posse=troca). PURO.
const EXPLICIT_BUY_RX = /\bquero\s+comprar\b|\bprocuro\b|\bbusco\b|\bto\s+procurando\b|\bestou\s+procurando\b|\bgostaria\s+de\s+(?:comprar|ver)\b|\btem\s+\w|\bquero\s+(?:um|uma|ver|comprar)\b|\bme\s+mostra\b|\bmostra\s+(?:um|uma|as|os)\b/;
function hasExplicitBuyIntent(block: string): boolean { return EXPLICIT_BUY_RX.test(normalizeText(block)); }
// Missão P0 (audit Codex): o verbo de COMPRA (quero/procuro/busco/prefiro/gostaria) separa o ALVO DE COMPRA do veículo de
// TROCA no MESMO bloco. buyClauseOf devolve o trecho A PARTIR do verbo de compra -> "tenho um Onix para troca, mas quero
// SUV" => "quero SUV" (o filtro de busca é SUV; o Onix é troca, capturado à parte). Sem verbo -> bloco inteiro. Verbos sem
// acento (case-insensitive no ORIGINAL, sem depender de normalizeText que muda índices). PURO.
const BUY_VERB_ORIG_RX = /\b(quero|procuro|busco|prefiro|gostaria\s+de|estou\s+procurando|to\s+procurando)\b/i;
function buyClauseOf(block: string): string { const m = BUY_VERB_ORIG_RX.exec(block); return m ? block.slice(m.index) : block; }
// Missão P0 (audit Codex smoke): FINGERPRINT normalizado de uma stock_search (marca/modelo/tipo/preço/câmbio/anos/popular/
// moto/excludeKeys/broad). Buscas semanticamente EQUIVALENTES têm o mesmo fingerprint -> executam 1x por turno (dedup).
// Relaxamento REAL de filtros gera fingerprint DIFERENTE (é uma busca de verdade), então não é bloqueado. PURO.
function stockSearchFingerprint(input: Record<string, unknown>): string {
  const s = (v: unknown): string => (typeof v === "string" ? normalizeText(v) : "");
  const arr = (v: unknown): (string | number)[] => Array.isArray(v) ? [...v].map((x) => (typeof x === "number" ? x : normalizeText(String(x)))).sort() : [];
  return JSON.stringify({
    marca: s(input.marca), modelo: s(input.modelo), tipo: s(input.tipo),
    precoMax: typeof input.precoMax === "number" ? input.precoMax : null,
    precoMin: typeof input.precoMin === "number" ? input.precoMin : null,
    cambio: s(input.cambio), anos: arr(input.anos), popular: input.popular === true,
    includeMotorcycles: input.includeMotorcycles === true, excludeKeys: arr(input.excludeKeys), broad: input.broad === true,
  });
}
// O texto JÁ faz descoberta comercial (modelo/tipo/faixa/procura/opções)? Se sim, não precisa do backstop. PURO.
const COMMERCIAL_DISCOVERY_RX = /\bmodelo\b|\bsuv\b|\bsedan\b|\bhatch\b|\bpicape\b|\bpickup\b|\btipo\s+de\s+(?:carro|veiculo)\b|\bfaixa\s+de\s+(?:preco|valor)\b|\bprocur\w+\b|\bopcoes\b|\bopcao\b|\bque\s+(?:tipo|carro|modelo)\b|\b(?:ta|esta)\s+buscando\b|\bpensando\s+em\b|\borcamento\b/;
function mentionsCommercialDiscovery(text: string): boolean { return COMMERCIAL_DISCOVERY_RX.test(normalizeText(text)); }
function mentionsSelfIntroduction(text: string): boolean {
  const norm = normalizeText(text);
  return /\b(?:eu\s+sou|me\s+chamo|aqui\s+(?:e|quem\s+fala\s+e)|sou\s+(?:o|a)\s+)\b/.test(norm);
}
function isInitialGreetingOnly(text: string): boolean {
  return /^(?:oi|ola|bom\s+dia|boa\s+tarde|boa\s+noite|tudo\s+bem|como\s+vai)[\s!?,.]*$/.test(normalizeText(text));
}
// ── PARTE A (missão P0): ENTRADA por anúncio ESPECÍFICO. A resposta menciona a marca/modelo do veículo do anúncio? PURO.
//    O label do anúncio (ex.: "Jeep Compass") vem aterrado do engine (adVehicleHint). Considera qualquer token >=3 do label.
function mentionsAdVehicle(text: string, adVehicleLabel: string): boolean {
  const t = normalizeText(text);
  const tokens = normalizeText(adVehicleLabel).split(/[\s/]+/).filter((w) => w.length >= 3);
  return tokens.some((tok) => t.includes(tok));
}
// A resposta CONDUZ sobre o veículo do anúncio (oferece foto/detalhe/condição/disponibilidade/financiamento/continuidade)?
const AD_CONDUCT_RX = /\bfoto|\bimagem|\bdetalhe|\bcondi[cç]|\bdispon|\bfinanc|\bparcel|\bvalor|\bpre[cç]|\bagenda|\bvisit|\btest|\bficha|\bvers[aã]o|\binteress|\bgost|\bmostr|\bcombina|\bpronta?\s+entrega/;
function conductsAboutAdVehicle(text: string): boolean { const t = normalizeText(text); return AD_CONDUCT_RX.test(t) || t.includes("?"); }
// Backstop: substitui uma abertura que pede NOME por uma DESCOBERTA comercial acolhedora (modelo/tipo/faixa) — SDR humano,
// não formulário. UMA pergunta. PURO.
function hasCommercialConversationContext(state: ConversationState): boolean {
  return state.vehicleContext.selected?.key != null || (state.lastRenderedOfferContext?.items?.length ?? 0) > 0;
}
const HANDOFF_TEXT_RX = /\b(?:consultor|vendedor|transfer|transferir|encaminh|chamar|chamei|passar|continuidade)\b/;
function isHandoffLikeText(text: string): boolean { return HANDOFF_TEXT_RX.test(normalizeText(text)); }
function lastAgentAnnouncedHandoff(state: ConversationState): boolean {
  return [...(state.recentTurns ?? [])].reverse().filter((t) => t.role === "agent").slice(0, 3).some((t) => isHandoffLikeText(t.text));
}
// ⭐Codex P0 (smokes reais): PROMESSA/OFERTA de encaminhar a consultor/vendedor — exige pessoa + verbo de
// transferência na MESMA sentença (mais precisa que isHandoffLikeText, que serve a outro guard). Pós-normalize.
const HANDOFF_PERSON_RX = /\b(?:consultor(?:a)?|vendedor(?:a)?|especialista|atendente|equipe)\b/;
const HANDOFF_PROMISE_VERB_RX = /\b(?:chamar|chamo|chamando|acionar|aciono|encaminh\w*|transferir|transfiro|direcionar|direciono|repassar|repasso)\b|\bpassar\s+(?:seu|o\s+seu|teu|o)\s+(?:contato|numero)\b|\bvai\s+(?:te\s+)?(?:atender|chamar|entrar\s+em\s+contato)\b|\bentrar[a]?\s+em\s+contato\b/;
export function promisesHumanHandoff(text: string): boolean {
  for (const sentence of text.split(/(?<=[.!?\n])/)) {
    const n = normalizeText(sentence);
    if (HANDOFF_PERSON_RX.test(n) && HANDOFF_PROMISE_VERB_RX.test(n)) return true;
  }
  return false;
}
const VISIT_SCHEDULED_PROMISE_RX = /\b(?:vou|irei)\s+agendar\s+(?:a\s+|sua\s+)?visita\b|\b(?:agendei|marquei)\s+(?:a\s+|sua\s+)?visita\b|\bagendo\s+(?:a\s+|sua\s+)?visita\b|\b(?:visita|horario)\b.{0,20}\b(?:esta|ficou|foi)\s+agendad[oa]\b|\bvisita\s+(?:ja\s+)?(?:agendad[oa]|marcad[oa])\b|\b(?:agendad[oa]|marcad[oa])\s+(?:para|na|no)\b|\b(?:anotei|registrei|reservei|confirmei)\s+(?:a\s+|sua\s+)?visita\b|\bvisita\s+anotad[oa]\b|\b(?:esta|ficou)\s+anotad[oa]\b/;
function promisesVisitScheduled(text: string): boolean {
  return VISIT_SCHEDULED_PROMISE_RX.test(normalizeText(text));
}
// ⭐Codex P0: pergunta DUPLA de AÇÃO ("quer as fotos ou prefere as condições?") — um "sim" fica ambíguo
// (incidente real T4). Disjuntiva de ATRIBUTO ("manual ou automático?") segue permitida. Termos pós-normalize.
const DOUBLE_ACTION_TERM_RX = /\bfotos?\b|\bimagens?\b|\bdetalhes?\b|\bcondic\w*\b|\bsimulac\w*\b|\bvalores\b|\bprecos?\b|\bvisita\b|\bagendar\b|\bproposta\b|\bconsultor\b|\bvendedor\b/g;
export function hasDoubleActionQuestion(text: string): boolean {
  for (const sentence of text.split(/(?<=[.!?\n])/)) {
    if (!sentence.trim().endsWith("?")) continue;
    const n = normalizeText(sentence);
    if (!/\bou\b/.test(n)) continue;
    const terms = new Set((n.match(DOUBLE_ACTION_TERM_RX) ?? []).map((t) => t.replace(/s$/, "")));
    if (terms.size >= 2) return true;
  }
  return false;
}
const SERVICE_OR_INSTITUTIONAL_RX = /\b(?:garantia|procedencia|documenta[cç]ao|documentos?|laudo|revis[aã]o|ipva|licenciad|blindad|seguro|chave\s+reserva|manual|recibo)\b/;
function factualSlotClaimFeedback(text: string, state: ConversationState): string | null {
  const clauses = text.split(/(?<=[.!?\n])/)
    .filter((sentence) => !sentence.trim().endsWith("?"))
    .map((sentence) => normalizeText(sentence))
    .filter(Boolean);
  const saysNoTrade = clauses.some((clause) => /\b(?:sem|nao\s+(?:tem|possui))\b.{0,25}\b(?:carro|veiculo)\b.{0,20}\btroca\b|\bnao\s+possui\s+troca\b/.test(clause));
  const saysHasTrade = clauses.some((clause) => /\b(?:tem|possui)\b.{0,25}\b(?:carro|veiculo)\b.{0,20}\btroca\b/.test(clause)) && !saysNoTrade;
  const trade = state.slots.possuiTroca;
  if (trade.status !== "known" && (saysNoTrade || saysHasTrade)) return "Você AFIRMOU se o cliente possui carro para troca, mas esse slot ainda está DESCONHECIDO. Não invente nem conclua; remova a afirmação. Você pode perguntar sobre troca em outro turno apropriado, mas não declare a resposta pelo cliente.";
  if (trade.status === "known" && trade.value === true && saysNoTrade) return "Você afirmou que o cliente NÃO tem troca, mas o fato conhecido é que ele TEM. Corrija sem inventar detalhes.";
  if (trade.status === "known" && trade.value === false && saysHasTrade) return "Você afirmou que o cliente TEM troca, mas o fato conhecido é que ele NÃO tem. Corrija.";
  const entrada = state.slots.entrada;
  const saysHasEntry = clauses.some((clause) =>
    (/\b(?:anotei|anotad[oa]|registrei|registrad[oa]|entendi)\b.{0,35}\b(?:seu\s+valor\s+de|o\s+valor\s+de|sua|uma|a)?\s*entrada\b/.test(clause)
      || /\b(?:voce|cliente)\b.{0,45}\btem\b.{0,25}\bentrada\b/.test(clause))
    && !/\b(?:nao|sem|zero)\b.{0,20}\bentrada\b/.test(clause));
  if (entrada.status === "known" && entrada.value === 0 && saysHasEntry) return "Você afirmou que o cliente TEM entrada, mas ele respondeu que está SEM entrada (entrada=0). Corrija a acolhida e não altere esse fato.";
  const installment = state.slots.parcelaDesejada;
  const saysInstallmentUndefined = clauses.some((clause) => /\b(?:nao\s+(?:tem|definiu|informou|sabe)|sem)\b.{0,35}\b(?:parcela|valor\s+mensal)\b|\bparcela\b.{0,25}\b(?:nao\s+definid|indefinid|nao\s+informad)/.test(clause));
  if (installment.status === "known" && saysInstallmentUndefined) return `Você afirmou que a parcela não foi definida, mas o cliente informou ${installment.value}. Acolha o valor factual e conduza sem contradizê-lo.`;
  return null;
}
function isServiceOrInstitutionalQuestion(text: string): boolean {
  return institutionalTopicsRequested(text).length > 0 || mentionsContact(text) || SERVICE_OR_INSTITUTIONAL_RX.test(normalizeText(text));
}
function hasQuestion(text: string): boolean { return text.includes("?"); }

// ── Fix A+ (audit CTWA, aprovado pelo dono): BECO de busca vazia. O cérebro autora "quer que eu veja/mostre outras opções?"
//    numa busca que zerou SEM alternativa. Detecta o beco + monta uma recuperação HONESTA+CONDUTORA (nomeia o filtro +
//    pergunta específica: ampliar faixa? outro modelo/tipo?) — resposta BOA (deterministic_conduct, não degradada), nunca o
//    beco vago. PURO. ──
const EMPTY_SEARCH_BECO_RX = /quer que eu (veja|procure|busque|mostre|te mostre) (outr|mais|algo|outro)|quer (ver|que eu veja) outras op|outras op(c|ç)oes (pra|para) voce/;
function isEmptySearchBeco(text: string): boolean { return EMPTY_SEARCH_BECO_RX.test(normalizeText(text)); }
// Fix P0-4 (audit condução): texto ÚNICO de condução de busca vazia SEM alternativa real. NOMEIA o filtro que zerou +
// oferece DUAS direções específicas (ampliar a faixa OU trocar modelo/tipo) — nunca o beco vago "quer outras opções?".
// Usado no executor de condução (cérebro autorou beco/não autorou) E no recovery_stock_empty de buildContextualRecovery. PURO.
function emptySearchConductingText(desc: string): string {
  return desc
    ? `Não achei ${desc} no estoque agora. Posso ampliar a faixa de preço ou te mostrar outro modelo ou tipo de carro — o que você prefere?`
    : "Não achei isso no estoque agora. Me diz um modelo, tipo de carro ou faixa de preço que eu já procuro pra você.";
}
function buildEmptySearchConductingRecovery(args: { readonly ctx: TurnContext; readonly turnId: string; readonly desc: string }): { decision: TurnDecision; composed: RenderedResponse; proposedEffects: ProposedEffectPlan[] } {
  const text = emptySearchConductingText(args.desc);
  const pe = ensureSendMessage([]);
  const prop: ProposedDecision = { proposedAction: "clarify", facts: [], proposedEffects: pe, responsePlan: { guidance: text }, reasonCode: "recovery_stock_empty_conduct", reasonSummary: "busca vazia sem alternativa -> honesto nomeando o filtro + pergunta condutora (não beco)", confidence: 0.6 };
  const decision = finalize(args.turnId, prop, PolicyEngine.postQuery(prop, [], args.ctx), []);
  return { decision, composed: { draft: { parts: [{ type: "text", content: text }] }, text }, proposedEffects: pe };
}

// Última linha estritamente OPERACIONAL. Não interpreta o pedido, não lista estoque,
// não conduz funil e não toma decisão comercial. Só pode aparecer quando o provider
// não entregou nenhum final válido mesmo após a passagem final de autoria da LLM.
function buildBrainUnavailableResponse(args: { readonly ctx: TurnContext; readonly turnId: string }): { decision: TurnDecision; composed: RenderedResponse; proposedEffects: ProposedEffectPlan[] } {
  const text = "Tive uma instabilidade para concluir esta resposta agora. Pode me enviar a mensagem novamente em instantes?";
  const proposedEffects = ensureSendMessage([]);
  const proposal: ProposedDecision = {
    proposedAction: "clarify",
    facts: [],
    proposedEffects,
    responsePlan: { guidance: "Falha operacional do provider; nenhuma decisão comercial foi tomada." },
    reasonCode: "brain_unavailable",
    reasonSummary: "provider não produziu final válido após retries",
    confidence: 0.2,
  };
  const decision = finalize(args.turnId, proposal, PolicyEngine.postQuery(proposal, [], args.ctx), []);
  return { decision, composed: { draft: { parts: [{ type: "text", content: text }] }, text }, proposedEffects };
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
  readonly adVehicleLabel?: string | null;         // FOCO EXATO (missão P0 polimento): foco de anúncio + 1 resultado -> nomeia "o ‹veículo› do anúncio"
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
  // DETALHE já consultado: se o cérebro executou vehicle_details do alvo certo e mesmo assim não conseguiu autorar
  // uma resposta válida, recupera usando o FATO real da tool. Não inventa e não volta para pergunta genérica.
  const detailVehicle = factsArr.find((f) => f.ok && f.tool === "vehicle_details")?.data.vehicle ?? null;
  if (detailVehicle && ATTR_QUESTION_RX.test(normalizeText(args.leadMessage))) {
    const n = normalizeText(args.leadMessage);
    const label = canonicalVehicleLabel(detailVehicle.vehicleKey, factsArr, args.identities, state)
      ?? [detailVehicle.marca, detailVehicle.modelo, detailVehicle.ano].filter(Boolean).join(" ");
    const values: string[] = [];
    if (/\bpreco\b|\bvalor\b|quanto\s+(?:custa|sai|fica|e)\b/.test(n)) {
      values.push(detailVehicle.preco > 0 ? `valor de R$ ${detailVehicle.preco.toLocaleString("pt-BR")}` : "valor a confirmar");
    }
    if (/\bkm\b|quilometr|rodad|quantos?\s+(?:km|quilometr)/.test(n)) {
      values.push(detailVehicle.km != null ? `${detailVehicle.km.toLocaleString("pt-BR")} km rodados` : "quilometragem a confirmar");
    }
    if (/\bcor\b/.test(n)) values.push(detailVehicle.cor ? `cor ${detailVehicle.cor}` : "cor a confirmar");
    if (/\bcambio\b|c[aâ]mbio|autom[aá]tic|\bmanual\b/.test(n)) values.push(detailVehicle.cambio ? `câmbio ${detailVehicle.cambio}` : "câmbio a confirmar");
    if (/\bano\b/.test(n)) values.push(`ano ${detailVehicle.ano}`);
    if (values.length === 0) {
      values.push(detailVehicle.preco > 0 ? `valor de R$ ${detailVehicle.preco.toLocaleString("pt-BR")}` : "valor a confirmar");
    }
    return plain(`O ${label} está com ${values.join(", ")}.`, "reply", "recovery_vehicle_detail_fact", "vehicle_details executado -> responde atributo com fato real");
  }
  // NOTA (LLM-first, regra P0 do dono [[pedro-v3-llm-first-no-handler]]): SELEÇÃO ("gostei do segundo") NÃO é respondida por
  // texto comercial do engine. O carro escolhido é entregue à LLM como FATO no FEEDBACK do loop (o label aterrado quando ela
  // tenta vehicle_details numa seleção) e ela REDIGE o acolhimento. Aqui na recuperação (última linha) NÃO se escreve
  // "Ótima escolha…": se a LLM nunca autorar, cai no fallback técnico degradado abaixo (raro, observável). Removido
  // recovery_selection (era handler disfarçado).
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
      // FOCO EXATO do anúncio (missão P0 polimento): 1 resultado do foco do anúncio -> texto SINGULAR nomeando o veículo do
      // anúncio ("Encontrei o Jeep Compass 2019 do anúncio:"), não o genérico plural "estas opções".
      const intro = (itemKeys.length === 1 && args.adVehicleLabel)
        ? `Encontrei o ${args.adVehicleLabel} do anúncio:`
        : "Encontrei estas opções pra você:";
      const draft: ResponseDraft = { parts: [{ type: "text", content: intro }, { type: "vehicle_offer_list", vehicleKeys: itemKeys.slice(0, 6) }, { type: "text", content: "Quer ver as fotos, os detalhes ou as condições?" }] };
      try { return mk(draft, ResponseRenderer.render(draft, factsArr, state, args.identities), "reply", "recovery_offer", "busca com itens -> lista aterrada"); } catch { /* cai no honesto */ }
    }
    // P0: busca EXECUTADA com 0 itens -> honesto NOMEANDO o filtro (nunca "esse modelo"), com alternativa. O executor
    // determinístico (F2.26) garante que um turno comercial SEMPRE tem fato de estoque aqui — nunca uma promessa "vou
    // procurar" sem ação. Sem constraint (fato genérico) mantém o texto padrão.
    const desc = args.constraints ? describeConstraints(args.constraints) : "";
    if (stockRanOk) return plain(emptySearchConductingText(desc), "clarify", "recovery_stock_empty", "busca executada com 0 itens -> honesto nomeando o filtro + condução específica (ampliar faixa / outro modelo-tipo)");
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
  // NOTA (LLM-first, regra P0 do dono [[pedro-v3-llm-first-no-handler]]): turno só-nome ("Douglas") NÃO é respondido por texto
  // do engine ("Prazer, Douglas…"). O nome já entra no frame (funnel.known) + o prompt manda acolher e avançar a descoberta;
  // se a LLM pede nome já conhecido/sobrenome, o guard devolve FEEDBACK e ela reescreve. Removido recovery_name_identified
  // (era handler disfarçado). Sem autoria da LLM, cai no fallback técnico degradado abaixo (raro, observável).
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
      const loadedState = snapshot?.state ?? createInitialState({ conversationId, tenantId, agentId, leadId, now: cutoff });
      // VÍNCULO de identidade CRM (Opção A, infra — não conversa): conversa existente SEM lead vinculado
      // adota o leadId RESOLVIDO pelo composition root (autoridade = banco + ownership do ref; o bridge
      // entrega null). O reducer herda e o commit persiste (v3_commit_turn: p_lead_id = nextState.leadId)
      // — vínculo DURÁVEL, sobrevive a restart. Vínculo existente NUNCA é sobrescrito aqui (mismatch =
      // fail-closed no chokepoint do crm_write; a conversa segue normal).
      const state = (leadId != null && loadedState.leadId == null) ? { ...loadedState, leadId } : loadedState;
      // Isolamento (B item 3): estado carregado precisa pertencer a ESTA conta/agente/conversa. Falha fechado.
      if (state.tenantId !== tenantId || state.agentId !== agentId || state.conversationId !== conversationId) {
        throw new Error(`central: state ownership mismatch (loaded ${state.tenantId}/${state.agentId}/${state.conversationId} != ${tenantId}/${agentId}/${conversationId})`);
      }
      const leadMessage = aggregateLeadMessage(inboxRecords);
      const prepared = await contextPreparer.prepare({ state, turnId, leadMessage, now: cutoff });
      // Bind factual answers before the brain runs. This does not choose the reply; it only projects
      // conservative slot facts (for example, a bare name when the previous accepted question asked for it).
      // Mode is fixed for the whole turn. In LLM-first the engine may extract
      // factual slots, but it may not decide a vehicle-selection act before
      // the brain. Legacy/shadow keeps its historical deterministic behavior.
      const singleAuthor = args.singleAuthor ?? false;
      const llmFirst = args.llmFirst ?? false;
      const extractedSlots = extractLeadSlots({
        leadMessage,
        state,
        interpretation: prepared.interpretation,
        claimExtractor: prepared.claimExtractor,
        turnId,
        allowVehicleSelection: !llmFirst,
      });
      const currentTurnFacts = buildCurrentTurnFacts({ state, extracted: extractedSlots, block: leadMessage });
      const { contextState: ctxState0, committed: safeExtractedSlots } = safeCommitSlots(state, extractedSlots, turnId, cutoff);
      // ⭐Missão P0 (validationState, audit Codex F2.43): o safeCommitSlots é TUDO-OU-NADA — se UMA mutation do lote
      // falhar no preview, TODOS os slots ficam fora do estado que a VALIDAÇÃO enxerga, e o eco do valor do lead
      // ("Tenho 8k" -> "R$ 8.000 anotado!") vira "valor monetário livre" -> deny -> fallback (T9/T10 do smoke).
      // Projeta INDIVIDUALMENTE os slots FINANCEIROS extraídos (fonte autoritativa = extractLeadSlots, nunca a LLM)
      // que ficaram de fora — o renderer (money_ref slot_value) e o isLeadValue enxergam o valor DESTE turno, sem
      // commitar nada (o commit real segue sendo o reducer no fim do turno).
      let contextState = ctxState0;
      if (safeExtractedSlots.length === 0 && extractedSlots.length > 0) {
        for (const m of extractedSlots) {
          if (m.op !== "set_slot" || !VALIDATION_FINANCIAL_SLOTS.has(m.slot)) continue;
          contextState = safeCommitSlots(contextState, [m], turnId, cutoff).contextState;
        }
      }
      // LLM-first (regra P0): o lead contribuiu com um slot NOVO neste turno (ex.: o nome)? Se sim, reperguntar o que ele
      // ainda NÃO respondeu (descoberta) é condução legítima — o anti-repetição (caso 2) não deve trancar a LLM.
      const sensitiveAnswerTurn = safeExtractedSlots.some((m) => m.op === "set_slot_ref");
      const sensitiveAnswerKinds = safeExtractedSlots.flatMap((m) => m.op === "set_slot_ref" && (m.slot === "cpf" || m.slot === "birthDate") ? [m.slot] : []);
      const visitAnswerTurn = safeExtractedSlots.some((m) => m.op === "set_slot" && (
        (m.slot === "interesseVisita" && m.value === true) || m.slot === "diaHorario"
      ));
      const leadAdvancedThisTurn = safeExtractedSlots.some((m) => m.op === "set_slot" || m.op === "set_slot_ref");

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
      // AUTORIA ÚNICA / LLM-first were fixed before extraction so pre-brain
      // helpers obey the same authority contract as the rest of the turn.
      // P0 (LLM-first): constraint comercial DETERMINÍSTICO do bloco atual (marca/modelo/tipo/preçoMax/câmbio/popular).
      // Base de dois invariantes: (1) força stock_search quando o lead deu filtro suficiente e nenhuma busca rodou;
      // (2) enriquece a chamada executada preenchendo lacunas. NÃO decide a resposta — só descreve o filtro do turno.
      const currentConstraintsRaw = detectCommercialConstraints({ block: leadMessage, signals: baseSignals, claimExtractor: prepared.claimExtractor, interpretation: prepared.interpretation });
      // ── Missão P0 (audit Codex): separa o ALVO DE COMPRA do veículo de TROCA no MESMO bloco. Se há pergunta de troca
      //    pendente E o lead expressa COMPRA (verbo de compra + filtro comercial suficiente no TRECHO de compra, OU "tem X?"),
      //    o filtro de BUSCA é o do alvo de compra (buyClause), NÃO o veículo de troca. "tenho X" (posse) sozinho continua
      //    sendo TROCA (não busca). Detecta por INTENÇÃO+constraints, não por regex estreito. ──────────────────────────────
      const pendingQuestionSlot = inferredQuestionSlot(contextState);
      const pendingTradeQuestion = pendingQuestionSlot === "possuiTroca" || pendingQuestionSlot === "veiculoTroca";
      const buyClauseText = buyClauseOf(leadMessage);
      const buyConstraints = buyClauseText !== leadMessage
        ? detectCommercialConstraints({ block: buyClauseText, signals: buildFrameSignals(buyClauseText, prepared.interpretation), claimExtractor: prepared.claimExtractor, interpretation: prepared.interpretation })
        : currentConstraintsRaw;
      const explicitBuyIntent = hasExplicitBuyIntent(leadMessage) || (BUY_VERB_ORIG_RX.test(leadMessage) && sufficientForStockSearch(buyConstraints));
      // Turno de TROCA com COMPRA no mesmo bloco -> o filtro de busca é o do ALVO DE COMPRA (buyClause), nunca o carro de troca.
      // Quando o mesmo bloco declara um carro proprio e, depois, um alvo de
      // compra, a clausula de compra vence mesmo que a pergunta anterior nao
      // tenha sido registrada. O contexto vem do proprio bloco (posse/troca),
      // nao de uma palavra do catalogo: assim "tenho um Onix 2018, quero algo
      // ate 70 mil" jamais usa o Onix da troca como filtro de estoque.
      const tradeContextInBlock = pendingTradeQuestion
        || statesTradeVehiclePossession(leadMessage, prepared.claimExtractor)
        || /\b(?:para|pra|na|de)\s+troca\b/i.test(leadMessage);
      const tradeBuyTurn = llmFirst && tradeContextInBlock && explicitBuyIntent && buyClauseText !== leadMessage && sufficientForStockSearch(buyConstraints);
      const currentConstraints = tradeBuyTurn ? buyConstraints : currentConstraintsRaw;
      // GATE por intenção do turno: NUNCA força busca num turno de FOTO/DETALHE/INSTITUCIONAL. deriveCurrentTurnIntent já
      // dá a precedência certa (foto > institucional > busca). "me manda foto do Onix" = photo_request (não busca) mesmo
      // citando um modelo. Pergunta de ATRIBUTO do veículo ("quanto custa o Onix?", relation asks_vehicle_detail) é DETALHE,
      // não busca — usa a RELATION (não regex de atributo, senão "pode ser automático" viraria detalhe). Só search/other
      // COM constraint comercial do BLOCO ATUAL, e que NÃO seja detalhe, dispara a força.
      // O preparador semântico é a primeira fonte, mas pedidos naturais de
      // atributo como "ver os opcionais" ou "banco de couro" às vezes chegam
      // sem interrogação e ficam relation=ambiguous. Se o bloco atual não traz
      // um NOVO filtro comercial, tratamos esse pedido explícito de atributo
      // como detalhe para que o filtro antigo/anúncio não volte a comandar uma
      // busca. "quero SUV automático" continua busca porque traz filtro atual.
      const isVehicleDetailTurn = baseSignals.relation === "asks_vehicle_detail"
        || (ATTR_QUESTION_RX.test(normalizeText(leadMessage)) && !sufficientForStockSearch(currentConstraintsRaw));
      const leadEngagement: LeadEngagement | null = detectDisengagement(leadMessage);
      // ── Missão P0 INC3/G: TURNO DE RESPOSTA DE TROCA. A última pergunta do agente foi sobre TROCA (possuiTroca/veiculoTroca)
      //    e o lead NÃO está pedindo COMPRA explícita ("tem X?", "quero comprar X") -> o bloco é RESPOSTA DE TROCA: o carro
      //    citado ("tenho um Renegade 2019 86km") é do LEAD, não pedido de estoque. NUNCA vira stock_search. gate llmFirst. ──
      // O contexto semântico de troca já foi resolvido acima a partir da
      // pergunta pendente, posse comprovada ou declaração explícita de troca.
      // Ele deve governar o ato mesmo quando o lead escreve em rajada ou usa
      // "quilômetros" por extenso. O alvo de compra explícito continua vencendo.
      const tradeInAnswerTurn = llmFirst && !explicitBuyIntent && tradeContextInBlock;
      // ── MISSÃO P0 (Financial Question Context): TURNO DE RESPOSTA FINANCEIRA. A última pergunta do agente foi financeira
      //    (parcela/entrada/forma de pagamento) e o lead está RESPONDENDO com valor/negação/pagamento ("até 1200"
      //    respondendo parcela, "tenho não" respondendo entrada) — SEM intenção de COMPRA nova explícita. Isso NUNCA é
      //    busca de estoque: "até 1200" é a PARCELA, não um teto de preço de veículo. Paralelo ao tradeInAnswerTurn (que
      //    cobre troca): bloqueia stock_search/detalhe/foto + é turno de CONDUÇÃO (o cérebro conduz o financiamento do
      //    carro já escolhido). !explicitBuyIntent deixa "na verdade quero Onix até 80 mil" voltar a ser busca. Gate por
      //    intenção do turno: foto/institucional/detalhe do lead NÃO são bloqueados (ele pivotou; segue o fluxo normal).
      const pendingFinancialQuestion = pendingQuestionSlot === "parcelaDesejada" || pendingQuestionSlot === "entrada" || pendingQuestionSlot === "formaPagamento";
      const financialValueInProgress = llmFirst && !explicitBuyIntent && !tradeInAnswerTurn
        && isFinancialValueDuringSelectedFinancing(leadMessage, contextState, prepared.interpretation, prepared.claimExtractor);
      const financialAnswerTurn = llmFirst && !explicitBuyIntent && !tradeInAnswerTurn && ((pendingFinancialQuestion
        && isAnswerToFinancialQuestion(leadMessage, pendingQuestionSlot, prepared.interpretation, prepared.claimExtractor)) || financialValueInProgress)
        && currentTurnIntent !== "photo_request" && currentTurnIntent !== "photo_memory" && currentTurnIntent !== "institutional" && !isVehicleDetailTurn;
      const financialAnswerSlot = financialValueInProgress && !pendingFinancialQuestion ? "parcelaDesejada" : pendingQuestionSlot;
      // ── Missão P0 INC1/B: RETOMADA de busca prometida/pendente ("cadê?/e aí?/achou?/me mostra"). Só vira busca quando há
      //    FILTRO ATIVO suficiente (activeSearchConstraints) -> força a busca com esse filtro, sem reperguntar modelo/tipo. ──
      const resumeSearchTurn = llmFirst && !tradeInAnswerTurn && wantsResumeSearch(leadMessage) && sufficientForStockSearch(contextState.activeSearchConstraints ?? {});
      // ── F2.32 (CTWA/Facebook Ads): o anúncio é CONTEXTO da conversa (não resposta do lead). Vem sanitizado na rajada
      //    (raw.adContext) ou herda do state. O engine resolve o VEÍCULO do anúncio do TEXTO aterrado no catálogo (nunca
      //    inventa) e o usa como SEED do escopo de busca. PRIORIDADE: atual > correção > anúncio > ativo. O anúncio DIRIGE
      //    o turno só se: há veículo no anúncio, o turno NÃO é institucional/desinteresse, e o bloco atual NÃO nomeia um
      //    veículo DIFERENTE (aí o atual/correção vence). Anúncio institucional (sem carro) -> contexto leve, não força busca. ──
      const burstAdContext = adContextFromInbox(inboxRecords);
      const effectiveAdContext: AdContext | null = burstAdContext ?? contextState.adContext ?? null;
      const adConstraints: CommercialConstraints = (llmFirst && effectiveAdContext) ? extractAdVehicleConstraints(effectiveAdContext, prepared.claimExtractor, prepared.interpretation) : {};
      const adVehicle = adHasVehicle(adConstraints);
      // P0-A (audit Codex smoke): REFERÊNCIA EXATA do anúncio — o veículo (dentre os JÁ APRESENTADOS) que casa modelo+ANO do
      // anúncio (match único, aterrado). Alimenta a foto PRONOMINAL ("me manda fotos dele/desse/esse"): o alvo do pedido é
      // esse veículo exato, não uma re-listagem. Sem modelo+ano no anúncio ou 0/>1 matches -> null (cai no "de qual carro?").
      const adReferenceKey = (llmFirst && effectiveAdContext) ? resolveAdReferenceKey(effectiveAdContext, contextState.lastRenderedOfferContext?.items ?? []) : null;
      // Fix C (audit CTWA smoke): conjunto CANDIDATO do anúncio (itens ofertados que casam modelo+ano do anúncio). >1 (ex.:
      // 2 Onix 2025) -> o pedido PRONOMINAL de foto pergunta QUAL desses, listando SÓ os candidatos (não re-lista o estoque).
      const adCandidateKeys = (llmFirst && effectiveAdContext) ? resolveAdCandidateKeys(effectiveAdContext, contextState.lastRenderedOfferContext?.items ?? []) : [];
      const currentHasVehicle = !!(currentConstraints.marca || (currentConstraints.modelos && currentConstraints.modelos.length > 0) || currentConstraints.tipo);
      // Missão P0 INC2/F: SEM contexto comercial ainda = nenhum interesse/tipo/faixa conhecido, nenhum carro ofertado/
      // selecionado, nenhum veículo de anúncio. Nesse estado o agente NÃO pede nome/sobrenome — primeiro entende a intenção.
      const noCommercialContextYet = llmFirst && contextState.slots.interesse.status !== "known" && contextState.slots.tipoVeiculo.status !== "known"
        && contextState.slots.faixaPreco.status !== "known" && contextState.vehicleContext.selected == null
        && (contextState.lastRenderedOfferContext?.items?.length ?? 0) === 0 && !adVehicle;
      const adDrivesTurn = llmFirst && effectiveAdContext != null && adVehicle && currentTurnIntent !== "institutional" && leadEngagement == null && !currentHasVehicle;
      // Fix B (audit CTWA): entrada por anúncio GENÉRICO (sem veículo específico) e o lead AINDA não especificou nada
      // comercial nem selecionou carro -> a abertura deve DESCOBRIR (modelo/tipo/faixa), NUNCA abrir pedindo nome. Sai quando
      // o lead engata (dá modelo/tipo/preço) ou seleciona. Sinal ao cérebro + backstop determinístico (se ele pedir nome).
      const adGenericEntry = llmFirst && effectiveAdContext != null && !adVehicle && currentTurnIntent !== "institutional"
        && leadEngagement == null && !sufficientForStockSearch(currentConstraints) && contextState.vehicleContext.selected == null;
      // PARTE A (missão abertura SDR): turno de ABERTURA = 1ª mensagem (nenhum turno do agente ainda). PURO (do estado).
      const hasConversationArtifact = contextState.lastRenderedOfferContext != null
        || contextState.vehicleContext.selected != null
        || (contextState.offers?.presentedKeys?.length ?? 0) > 0;
      const isOpeningTurn = contextState.turnNumber === 0
        && !(contextState.recentTurns ?? []).some((t) => t.role === "agent")
        && !hasConversationArtifact;
      // PARTE A: PRIMEIRO contato SEM anúncio e SEM alvo comercial ("Boa tarde" cru) -> abrir com DESCOBERTA comercial, nunca
      // pedindo nome/telefone. Complementa adGenericEntry (que exige anúncio): aqui NÃO há anúncio nenhum (porta fria).
      const firstContactNoCommercialTarget = llmFirst && isOpeningTurn && effectiveAdContext == null && !adVehicle
        && isInitialGreetingOnly(leadMessage)
        && currentTurnIntent !== "institutional" && leadEngagement == null && !sufficientForStockSearch(currentConstraints)
        && contextState.vehicleContext.selected == null;
      // PARTE A: ENTRADA por anúncio de veículo ESPECÍFICO -> a abertura fala do veículo do anúncio e oferece
      // fotos/detalhes/condições (o prompt conduz; é só orientação, não força resposta determinística).
      const specificAdEntry = llmFirst && isOpeningTurn && adVehicle && currentTurnIntent !== "institutional"
        && leadEngagement == null && !currentHasVehicle;
      // Turno de ENTRADA/REFERÊNCIA ao anúncio: "esse ainda tem?", saudação curta de entrada, foto/detalhe do anunciado,
      // ou um refino comercial (preço/câmbio) sobre o carro do anúncio -> o anúncio SEED-a a busca deste turno.
      // O texto padrao do Meta ("tenho interesse e queria mais informacoes")
      // nao precisa repetir a palavra anuncio: no primeiro turno, a existencia
      // de um ad especifico ja define o assunto. Sem esta perna o engine exigia
      // que a LLM falasse do carro, mas nao lhe entregava o fato via busca.
      const adEntryTurn = adDrivesTurn && (specificAdEntry || refersToAd(leadMessage) || isBareGreeting(leadMessage) || sufficientForStockSearch(currentConstraints)
        || currentTurnIntent === "photo_request" || currentTurnIntent === "photo_memory" || isVehicleDetailTurn || baseSignals.mentionsPhoto === true);
      // P0-B (audit Codex smoke): "algo parecido/opções semelhantes/outras parecidas" -> turno de SIMILARIDADE: relaxa
      // modelo/marca (do anúncio/ativo) e busca por TIPO. É turno de busca (força a tool) e o filtro é relaxado abaixo.
      const similarityTurn = llmFirst && detectSimilarityIntent(leadMessage) && currentTurnIntent !== "institutional" && leadEngagement == null;
      // ── PARTE (missão P0 CTWA): FOCO EXATO do anúncio ESPECÍFICO. Anúncio específico = veículo SELECIONADO, não filtro
      //    amplo. Na ENTRADA/REFERÊNCIA ao anúncio (adEntryTurn), se o anúncio traz o ANO, a busca filtra por modelo+ANO ->
      //    resolve o veículo EXATO (Compass 2019), nunca lista outros anos de cara. O lead pedindo ALTERNATIVAS ("outro
      //    Compass", "outro ano", "mais barato") NÃO é adEntryTurn (nomeia o modelo -> currentHasVehicle) e ainda é travado
      //    por asksAdAlternatives -> relaxa para o modelo (lista outros). Similaridade/outro veículo já tratados acima.
      const adFocus: AdFocusedVehicle | null = (llmFirst && effectiveAdContext) ? resolveAdFocusedVehicle(effectiveAdContext, prepared.claimExtractor, prepared.interpretation) : null;
      const adExactFocusTurn = llmFirst && adEntryTurn && adFocus?.ano != null && !asksAdAlternatives(leadMessage) && !similarityTurn;
      // FOCO EXATO (missão P0 audit smoke): lead pediu ALTERNATIVA do carro do anúncio ("outro Compass/outro ano/mais
      // barato") e NÃO citou um ano PRÓPRIO -> o ANO sai da chamada EXECUTADA de stock_search (o cérebro às vezes carimba
      // anos=[2019] por ver adVehicle="Jeep Compass 2019"). Se o lead citar ano ("outro Compass 2018"), respeita o dele.
      // ⭐REFATORAÇÃO DE AUTORIDADE (audit Codex — "dois cérebros"): o detector de constraint NÃO autoriza mais busca.
      // A AUTORIDADE da tool é da LLM (TurnUnderstanding: capability stock_search + evidence, via isStockSearchTurn(brainVU())
      // nos pontos de decisão). Sem isto, "Corolla não é um sedan? pq disse que não tinha?" (contestação) virava re-lista:
      // o detector via Corolla/sedan → constraint suficiente → forçava stock_search por cima do entendimento da LLM.
      // Ficam como AUTORIDADE apenas fluxos de CONTEXTO conversacional real (não keyword-do-turno): entrada por anúncio
      // (o anúncio É o assunto), similaridade explícita ("algo parecido") e retomada de busca prometida ("cadê?" com filtro
      // ativo). Troca/financeiro continuam excluindo tudo (o carro/valor é resposta, não pedido).
      // O anúncio só fundamenta uma busca de entrada. Quando o lead está
      // perguntando detalhe/foto de algo já mostrado, reativar o anúncio antigo
      // sequestra o turno atual e pode disparar uma busca relaxada indevida.
      const adNeedsStockGrounding = adEntryTurn
        && !isVehicleDetailTurn
        && currentTurnIntent !== "photo_request"
        && currentTurnIntent !== "photo_memory"
        && adReferenceKey == null
        && contextState.vehicleContext.selected == null;
      const contextualSearchTurn = !financialAnswerTurn && ((!tradeInAnswerTurn && (adNeedsStockGrounding || similarityTurn)) || resumeSearchTurn);
      // Sinal HEURÍSTICO de turno-com-constraint (search/other + filtro suficiente): APENAS enriquecimento/merge do filtro
      // ativo (isSearchishTurn abaixo). NUNCA autoriza/força tool — essa é a mudança de autoridade.
      const constraintishTurn = !financialAnswerTurn && !tradeInAnswerTurn && (currentTurnIntent === "search" || currentTurnIntent === "other") && !isVehicleDetailTurn && sufficientForStockSearch(currentConstraints);
      // Missão P0 INC1/A: turno em que a busca é ESPERADA por CONTEXTO (anúncio/similaridade/retomada) -> proíbe promessa sem
      // tool. A expectativa vinda da PRÓPRIA LLM (capability de busca declarada) é somada no ponto da autoria (brainVU()).
      // Somente o ato aceito da LLM cria expectativa de tool. Contexto, memória e
      // detectores seguem disponíveis para prompt e enriquecimento factual.
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
      // Enriquecimento/merge do filtro ativo: constraint do turno (heurística) AINDA alimenta o merge — só não autoriza tool.
      const isSearchishTurn = contextualSearchTurn || constraintishTurn || baseSignals.mentionsMoreOptions || commercialCorrections.removedTypes.length > 0 || similarityTurn;
      const mergedConstraints: CommercialConstraints = (llmFirst && isSearchishTurn) ? mergeActiveConstraints(searchBase, currentConstraints, commercialCorrections) : currentConstraints;
      // P0-B: SIMILARIDADE relaxa o merge -> só tipo/preço/popular (câmbio só se o LEAD pediu no turno atual). "Algo parecido"
      // nunca fica preso no modelo/marca do anúncio; a recuperação honesta nomeia o TIPO (picapes), não o modelo do anúncio.
      const commercialConstraintsBase: CommercialConstraints = (llmFirst && similarityTurn) ? relaxToSimilar(mergedConstraints, !!currentConstraints.cambio) : mergedConstraints;
      // FOCO EXATO do anúncio: injeta o ANO do anúncio na busca (só na entrada/referência ao anúncio, sem alternativas/
      // similaridade, e se o lead NÃO deu um ano próprio). O ano é RÍGIDO (F2.28) -> resolve o Compass 2019 exato. NÃO é
      // persistido como filtro ativo (ver commit) -> não vaza para "tem outro Compass?"/"quero Onix".
      const commercialConstraints: CommercialConstraints = (adExactFocusTurn && (!commercialConstraintsBase.anos || commercialConstraintsBase.anos.length === 0))
        ? { ...commercialConstraintsBase, anos: [adFocus!.ano!] }
        : commercialConstraintsBase;
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
        ? (adFocus ? [adFocus.marca, adFocus.modelo, adFocus.ano].filter(Boolean).join(" ")
          : ((adConstraints.modelos && adConstraints.modelos.length > 0) ? [adConstraints.marca, adConstraints.modelos.join("/")].filter(Boolean).join(" ") : describeConstraints(adConstraints)))
        : undefined;
      const handoffCapabilityAvailable = args.handoff?.enabled === true && args.handoff.available === true
        && args.crmWriteEnabled === true && leadId != null;
      let frame = buildTurnFrame({ turnId, now: cutoff, block: leadMessage, portalPromptSha256, workingMemory: wmForFrame, interpretation: prepared.interpretation, state: contextState, currentTurnFacts, extractedSlotMutations: extractedSlots, currentTurnIntent, adVehicleHint, adGenericEntry: isOpeningTurn && adGenericEntry, firstContactNoCommercialTarget, specificAdEntry, disengagementOnly: llmFirst ? false : disengagedActionable, acceptedPhotoOffer: acceptsAgentPhotoOffer(leadMessage, contextState), selectedOfferThisTurn: false, handoffAvailable: handoffCapabilityAvailable });
      // O turno do lead já é entregue integralmente ao cérebro. O engine não
      // constrói advisories, próxima pergunta, ordem de funil ou instrução de
      // agendamento para competir com a LLM. Fatos de anúncio, memória,
      // currentTurnFacts e capabilities continuam no frame; a validação ocorre
      // depois da proposta do cérebro.

      // ── LOOP do cérebro: query (autorizada por chamada) | final. Observações FACTUAIS voltam ao MESMO cérebro. ──
      const observations: AgentToolObservation[] = [];
      const facts: QueryResult[] = [];                 // só os 4 QueryCall (grounding comercial)
      const toolResultMems: ToolResultMemory[] = [];   // memória sanitizada das tools executadas
      const toolTelemetry: ToolTelemetry[] = [];
      const toolAuthorities: ToolAuthorityRecord[] = [];
      const recordQueryExecution = (result: QueryResult, ms: number, authority: ToolExecutionAuthority): void => {
        toolTelemetry.push(toToolTelemetry(result, ms));
        // Tool authority is a central_active contract. The legacy/shadow path is
        // kept only for compatibility and has no accepted TurnUnderstanding to
        // prove current-block authority; pretending otherwise would make this
        // telemetry lie. Production llmFirst executions remain fail-closed.
        if (!llmFirst) return;
        assertToolExecutionAuthority(result.tool, authority);
        toolAuthorities.push(toToolAuthorityRecord({ tool: result.tool, authority, ok: result.ok, ms }));
      };
      let finalDecision: AgentBrainDecision | null = null;
      let brainSteps = 0;
      // AUTORIA ÚNICA (audit): singleAuthor/llmFirst já declarados acima (perto do currentTurnIntent) p/ o gate do filtro comercial.
      const identities = buildRememberedIdentities(contextState); // identidade LEMBRADA (marca/modelo/ano) — só p/ NOMEAR
      // P0-sel (missão): o lead está SELECIONANDO um veículo da última lista/foco ("gostei do segundo", "esse", ordinal)?
      // Numa seleção o cérebro pode dar um final NATURAL sem vehicle_details (citar atributo é barrado no validate, com
      // feedback específico "acolha a escolha, não cite atributo sem vehicle_details").
      // Label ATERRADO do carro escolhido (do offer context) — vai no FEEDBACK à LLM (fato), NUNCA numa resposta escrita pelo engine.
      let authoredComposed: RenderedResponse | null = null;
      let authoredDecision: TurnDecision | null = null;
      let authoredProposedEffects: ProposedEffectPlan[] | null = null;
      let responseSource: ResponseSource = singleAuthor ? "technical_fallback" : "legacy_compose";
      let recoveryReason: string | null = null;                     // T6: motivo da recuperação contextual (observabilidade)
      let degraded = false;                                         // Falha técnica/último recurso; lista aterrada não é degradação.
      let targetResolutionSource: TargetResolutionSource | null = null;   // T6: como o alvo do turno foi resolvido
      let brainRetries = 0;
      let finalAuthorshipAttempts = 0;
      const policyFeedbackLog: string[] = [];
      // ── FONTE ÚNICA (audit Codex): SÓ o understanding DO CÉREBRO (fromBrain, evidência⊂bloco) autoriza ação comercial
      //    (send_media/tool/foco). A 1ª compreensão válida TRAVA o assunto (reconcileUnderstanding). O fallback é HINT
      //    conservador só p/ recuperação TEXTUAL — nunca autoriza. `knownModels` verifica o modelo do alvo (P0-1).
      const fallbackUnderstanding = deriveFallbackUnderstanding(leadMessage, baseSignals, prepared.claimExtractor);
      let lockedU: TurnUnderstanding | null = null;                 // base TRAVADA do turno (do cérebro)
      let provenanceRetries = 0;                                    // ⭐SEM inv.1: retries de evidence fora do bloco atual
      let provenanceExhausted = false;                              // ⭐Codex P0: decisão stale descartada integralmente
      let evidenceNormalized = false;                               // ⭐Codex rodada 2: citação mecânica em resposta curta sem ação
      let authorityRetries = 0;
      const AUTHORITY_RETRY_CAP = 3;
      // ⭐P0-A (continuação semântica de agendamento): CONTEXTO de visita em andamento que a validação usa para aceitar um
      // understanding de visit cuja evidência é só TEMPORAL ("pra segunda"/"às 15h"). A MEMÓRIA fornece só a relação
      // (interesseVisita=true / pergunta pendente de agendamento / última pergunta pediu dia-horário); a mensagem atual
      // continua sendo a evidência. NUNCA autoriza tool/effect — só permite validar um understanding coerente do turno.
      const turnValidationContext: TurnValidationContext = {
        visitActive: hasActiveVisitContext({
          interesseVisita: contextState.slots.interesseVisita.status === "known" && contextState.slots.interesseVisita.value === true,
          pendingSchedulingSlot: persisted0.pendingAgentQuestion?.slot ?? null,
          recentTurns: contextState.recentTurns ?? [],
        }),
      };
      const brainVU = (): ValidatedUnderstanding | null => (lockedU ? validateTurnUnderstanding(lockedU, leadMessage, true, turnValidationContext) : null);
      const authoritativeVU = (): ValidatedUnderstanding => brainVU() ?? validateTurnUnderstanding(fallbackUnderstanding, leadMessage, false, turnValidationContext);
      // ⭐AUTORIDADE (audit Codex): o ATO declarado é PEDIDO DE ESTOQUE — primaryIntent=search_stock E capability de busca
      // validada. É o que autoriza o ENGINE a agir (forçar/garantir busca). Capability solta NÃO basta: "quanto custa o
      // Onix?" (vehicle_detail) pode carregar capability de busca sem o ATO ser busca — o engine não força nada nesse caso.
      const brainSearchAct = (): boolean => lockedU?.primaryIntent === "search_stock" && isStockSearchTurn(brainVU());
      // ⭐Hardening (audit Codex): a LLM declarou um ATO CONVERSACIONAL (contestação/financiamento/troca/smalltalk) —
      // nenhum caminho determinístico (nem mentionsMoreOptions) pode forçar/exigir busca por cima dele. Ex.: "Você disse
      // que não tinha outras opções, mas Corolla é sedan?" casa o regex de 'mais opções' mas o ato é conversation_repair.
      const conversationalActDeclared = (): boolean => lockedU != null
        && (lockedU.primaryIntent === "conversation_repair" || lockedU.primaryIntent === "financing" || lockedU.primaryIntent === "trade_in" || lockedU.primaryIntent === "smalltalk");
      // key -> {marca,modelo} ESTRUTURADO (audit Codex P0): SÓ de fontes com modelo estruturado confiável — VehicleFact
      // (stock_search/vehicle_details), oferta e identidade. NUNCA `selected.label` (texto livre; não infere modelo
      // aproximado). A identidade do modelo é EXATA (catalog-utils.modelIdentityMatches), nunca substring.
      const buildKnownModels = (): Map<string, KnownVehicleModel> => {
        const m = new Map<string, KnownVehicleModel>();
        for (const f of facts) { if (!f.ok) continue; if (f.tool === "stock_search") for (const v of f.data.items) m.set(v.vehicleKey, { marca: v.marca ?? null, modelo: v.modelo ?? null, ano: v.ano ?? null }); if (f.tool === "vehicle_details") m.set(f.data.vehicle.vehicleKey, { marca: f.data.vehicle.marca ?? null, modelo: f.data.vehicle.modelo ?? null, ano: f.data.vehicle.ano ?? null }); }
        for (const it of contextState.lastRenderedOfferContext?.items ?? []) m.set(it.vehicleKey, { marca: it.marca ?? null, modelo: it.modelo ?? null, ano: it.ano ?? null });
        for (const id of identities) m.set(id.vehicleKey, { marca: id.marca ?? null, modelo: id.modelo ?? null, ano: id.ano ?? null });
        return m;
      };
      const resolveTarget = (): TargetResolution => resolveTurnTarget({ understanding: brainVU()?.understanding ?? null, leadMessage, state: contextState, claimExtractor: ctx.claimExtractor, knownModels: buildKnownModels() });
      // P0-A (audit Codex smoke): o alvo EXPLÍCITO do turno (ordinal/modelo/selecionado) SEMPRE vence. Só quando NÃO há alvo
      // resolvido, o pedido é PRONOMINAL de foto (sem outro veículo no bloco) e há REFERÊNCIA EXATA do anúncio (modelo+ano
      // aterrado num veículo único) -> o alvo é esse veículo do anúncio (source="ad_reference"). Narrow, grounding máximo.
      const resolveTargetWithAd = (): TargetResolution => {
        const base = resolveTarget();
        if (base.kind === "resolved") return base;
        const normLead = normalizeText(leadMessage);
        const pronounAttributeTurn = /\b(?:ele|dele|desse|deste|esse|este)\b/.test(normLead)
          && ATTR_QUESTION_RX.test(normLead)
          && !currentHasVehicle;
        const pronounDetailTurn = (isVehicleDetailTurn || pronounAttributeTurn) && !currentHasVehicle;
        if (adReferenceKey && !currentHasVehicle && ((baseSignals.mentionsPhoto === true && !isPhotoDeclined(leadMessage)) || pronounDetailTurn || refersToAd(leadMessage))) {
          return { kind: "resolved", vehicleKey: adReferenceKey, source: "ad_reference", candidateVehicleKeys: [adReferenceKey], subjectModel: adConstraints.modelos?.[0] ?? null };
        }
        return base;
      };
      // requireBrain = produção (central_active+llmFirst): só o cérebro autoriza foto. Sem llmFirst (replay/legado) o
      // fallback validado autoriza (mantém a coerência de evidência de foto). photoVU escolhe a fonte por modo.
      const requireBrain = llmFirst;
      const acceptedSelectionRef = () => {
        const v = brainVU();
        if (!v?.trusted) return null;
        // Persistir foco conversacional nao e executar uma tool. A intencao
        // select_vehicle validada pertence ao cerebro e basta para materializar
        // a referencia factual contra a ultima oferta. `selectAuthorized` segue
        // obrigatorio para mutations/effects propostos pela LLM, mas nao pode
        // apagar da memoria uma escolha que ela ja compreendeu corretamente.
        const selects = v.understanding.primaryIntent === "select_vehicle";
        const selectsByPhoto = v.understanding.primaryIntent === "request_photos" && authorizesPhotoSend(v, leadMessage, requireBrain);
        if (!selects && !selectsByPhoto) return null;
        // The brain owns the ACT. Only after it has authoritatively declared a
        // selection may this deterministic resolver ground colloquial model
        // tokens and ordinals against the last rendered offer.
        if (selects) {
          const selected = resolveSelectedVehicle(leadMessage, contextState, prepared.claimExtractor);
          if (selected) {
            const label = canonicalVehicleLabel(selected.key, facts, identities, contextState)
              ?? (selected.label !== selected.key ? selected.label : null);
            if (label) return { kind: "vehicle" as const, key: selected.key, label };
          }
        }
        const target = resolveTargetWithAd();
        if (target.kind !== "resolved") return null;
        const label = canonicalVehicleLabel(target.vehicleKey, facts, identities, contextState);
        return label ? { kind: "vehicle" as const, key: target.vehicleKey, label } : null;
      };
      const acceptedSelectionTurn = (): boolean => brainVU()?.understanding.primaryIntent === "select_vehicle" && acceptedSelectionRef() != null;
      const acceptedSelectionLabel = (): string | null => acceptedSelectionRef()?.label ?? null;
      // HF-1 (2026-07-11): transferência EXECUTÁVEL neste turno = flag ON no root + vendedor ativo DISPONÍVEL
      // (pré-check do root, evita promessa falsa) + regras do portal permitem + CRM vinculável (o handoff exige a
      // linha do lead). Governa o deny de promessa E a montagem da cadeia no chokepoint.
      const handoffPlannable = handoffCapabilityAvailable;
      const photoVU = (): ValidatedUnderstanding | null => (llmFirst ? brainVU() : authoritativeVU());
      const brainAuthorizesResolvedPhotoAct = (target: TargetResolution): boolean => {
        const v = photoVU();
        return v?.fromBrain === true
          && v.trusted
          && v.understanding.primaryIntent === "request_photos"
          && v.understanding.requestedCapabilities.includes("send_photos")
          && v.validEvidence.length > 0
          && authorizesPhotoByResolvedTarget(target, leadMessage, contextState);
      };
      const currentPhotoActAuthorized = (target: TargetResolution): boolean =>
        authorizesPhotoSend(photoVU(), leadMessage, requireBrain)
        || brainAuthorizesResolvedPhotoAct(target);
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
        const authority: ToolExecutionAuthority = {
          principal: "engine_factual",
          source: "engine_institutional_lookup",
          primaryIntent: "institutional",
          capability: "institutional_info",
          currentTurnEvidence: true,
          callSite: "resolveInstitutional",
        };
        assertToolExecutionAuthority("tenant_business_info", authority);
        const started = Date.parse(clock.now());
        const obs = await resolveTenantBusinessInfo(businessInfo, ref, topic);
        institutionalObs.set(topic, obs);
        observations.push(obs);
        toolResultMems.push(businessInfoToolResultMemory(topic, obs.ok, turnId));
        const ms = Math.max(0, Date.parse(clock.now()) - started);
        toolTelemetry.push({ tool: "tenant_business_info", ok: obs.ok, ms });
        toolAuthorities.push(toToolAuthorityRecord({
          tool: "tenant_business_info",
          ok: obs.ok,
          ms,
          authority,
        }));
        return obs;
      };

      const turnStartMs = Date.parse(clock.now());   // Missão P0 (doc 2): observabilidade de latência do turno.
      // Missão P0 (audit Codex smoke): DEDUP de stock_search por fingerprint POR TURNO. Buscas equivalentes (mesmo filtro
      // normalizado) executam 1x — a 2ª+ devolve o FATO já obtido ao cérebro (sem re-executar a tool). Mata o "cadê? rodou
      // stock_search 6x". Relaxamento real (filtro diferente) tem fingerprint diferente e roda. NÃO usa if por frase.
      const stockSearchCache = new Map<string, QueryResult>();
      const stockFingerprintsExecuted: string[] = [];
      let duplicateStockCallsBlocked = 0;
      // Missão P0 (audit Codex smoke): CAP anti-loop de stock_search repetido pelo cérebro (o "cadê? 7x"). Cada repetição
      // SEMÂNTICA vira feedback de controle (tool:"response", NÃO conta como busca no relatório) mandando finalizar; após
      // poucas repetições o loop sai e a recuperação determinística responde. Persiste ENTRE iterações (por isso fora do for).
      let dupStockLoopCount = 0;
      const DUP_STOCK_LOOP_CAP = 3;
const PROVENANCE_RETRY_CAP = 2;   // ⭐SEM inv.1: retries bounded p/ evidence fora do bloco atual  // 1 busca real + até 2 nudges "finalize" antes de sair do loop (bound de custo/latência)
      // Missão P0 (audit Codex smoke real T7): MESMO cap para vehicle_details. "gostei do segundo" = SELEÇÃO; o cérebro às
      // vezes tenta vehicle_details sem ter a vehicleKey (a rejeição do gate não é execução) — sem cap loopava 6x → fallback.
      let dupDetailLoopCount = 0;
      // A resolução de fotos também é idempotente por (tool,args). Depois de uma consulta real, a LLM recebe o fato e deve
      // finalizar. Repetições viram feedback de resposta e têm teto, evitando gastar os 6 passos e cair em recovery.
      let dupPhotoLoopCount = 0;
      // Fase 1 (LLM-first): retries EXTRAS (bounded) para os feedbacks acionáveis de LISTAGEM/MONEY — a LLM insiste em listar/
      // conduzir sem cair no recovery, mas com teto (não gasta todos os passos num cérebro travado). Persiste entre iterações.
      let listMoneyRetries = 0;
      const LIST_MONEY_RETRY_CAP = 4;
      const runQueryDedup = async (call: QueryCall): Promise<QueryResult> => {
        if (call.tool !== "stock_search") return runQuery(call);
        const fp = stockSearchFingerprint(call.input as Record<string, unknown>);
        const cached = stockSearchCache.get(fp);
        if (cached) { duplicateStockCallsBlocked += 1; return cached; }
        const res = await runQuery(call);
        stockSearchCache.set(fp, res);
        stockFingerprintsExecuted.push(fp);
        return res;
      };
      for (; brainSteps < brainMaxSteps; brainSteps++) {
        let step;
        try {
          step = await withTimeout(brain.proposeNextStep(frame, observations), limits.proposeTimeoutMs ?? 30_000, "propose: agent brain step exceeded timeout");
        } catch { break; } // falha técnica do cérebro -> sai do loop -> fallback seguro (nunca silêncio)
        // Em central_active, `understanding` é o contrato de decisão do
        // cérebro para todo turno. Sem ele, o motor não adivinha a intenção
        // nem aceita uma resposta comercial aparentemente plausível: pede ao
        // mesmo modelo que complete o seu próprio output estruturado.
        if (llmFirst && !step.understanding) {
          const feedback = "Seu passo não trouxe understanding. Reemita a decisão com understanding completo, evidence literal do bloco atual e, se precisar de fatos, a tool correspondente. Não invente disponibilidade nem continue um objetivo antigo sem declarar o ato atual.";
          policyFeedbackLog.push(feedback);
          if (authorityRetries < AUTHORITY_RETRY_CAP && brainSteps + 1 < brainMaxSteps) {
            authorityRetries += 1;
            observations.push({ tool: "response", ok: false, error: { code: "UNDERSTANDING_REQUIRED", message: feedback } });
            continue;
          }
          provenanceExhausted = true;
          break;
        }
        // Fonte única: captura+TRAVA o entendimento do turno (a 1ª compreensão válida é a base; refinamento só adiciona fato).
        if (step.understanding) {
          const candidate = reconcileUnderstanding(lockedU, step.understanding, leadMessage, { acceptedPhotoOffer: acceptsAgentPhotoOffer(leadMessage, contextState) });
          const candidateValidation = validateTurnUnderstanding(candidate, leadMessage, true, turnValidationContext);
          const authorityFeedback = understandingAuthorityFeedback(candidateValidation);
          // A busca continua sendo uma decisão do cérebro. Mas, quando ele
          // declara o ato `search_stock`, o próprio contrato exige a
          // capability/evidence que autoriza a tool. Aceitar o rótulo sem esse
          // contrato permite uma resposta que diz "separei opções" sem nunca
          // consultar o estoque. Isto não infere busca por palavras-chave: só
          // pede que a LLM complete a decisão que ela mesma declarou.
          const incompleteSearchAct = candidate.primaryIntent === "search_stock" && !isStockSearchTurn(candidateValidation);
          const understandingFeedback = authorityFeedback
            ?? (incompleteSearchAct
              ? "Você declarou primaryIntent=search_stock, mas não forneceu requestedCapabilities=[\"stock_search\"] com evidence literal do bloco atual. Reemita o understanding e chame stock_search antes de apresentar disponibilidade, lista ou opções."
              : null);
          if (llmFirst && understandingFeedback) {
            policyFeedbackLog.push(understandingFeedback);
            if (authorityRetries < AUTHORITY_RETRY_CAP && brainSteps + 1 < brainMaxSteps) {
              authorityRetries += 1;
              observations.push({ tool: "response", ok: false, error: { code: incompleteSearchAct ? "UNDERSTANDING_INCOMPLETE" : "UNDERSTANDING_CONFLICT", message: understandingFeedback } });
              continue;
            }
            lockedU = null;
            provenanceExhausted = true;
            break;
          }
          lockedU = candidate;
        }
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
          // ⭐SEM (invariante 1 — incidente real "Sim"/"Não"/"Douglas" com evidence da MENSAGEM ANTERIOR): o
          // understanding do turno PRECISA pertencer ao bloco ATUAL. Evidence herdada/inválida -> feedback
          // ESPECÍFICO ao MESMO cérebro (com o bloco atual e a última pergunta do agente) + retry bounded.
          // Esgotado -> o understanding inválido é DESCARTADO (o fallback derivado do próprio bloco vira o
          // hint conservador; nunca autoriza ação). Entendimento de outro turno NUNCA dirige resposta/tool/
          // mutação. Turno TRIVIAL sem evidence nenhuma (smalltalk sem capability/mutação) segue o fluxo antigo —
          // trusted=false já não autoriza nada; o retry só dispara quando há evidence HERDADA ou tentativa de
          // dirigir fato. Validação de proveniência temporal — o cérebro decide o que o bloco significa.
          const staleEvidence = (lockedU?.evidence ?? []).length > 0;   // citou algo e NADA é do bloco = herdada
          const drivesFactual = (step.decision?.stateMutations ?? []).some((m) => m.op === "set_slot")
            || (lockedU?.requestedCapabilities?.length ?? 0) > 0;
          // ⭐Codex rodada 2 (variância do modelo real): em RESPOSTA CURTA ("Sim"/"Não"/"Douglas"/"Até 1200")
          // SEM pedido de ação (zero capabilities) e SEM mutação de slot, a evidência é MECÂNICA por definição —
          // o próprio bloco. NORMALIZA a citação (determinístico, observável) em vez de gastar retries: o cérebro
          // continua 100% dono do SIGNIFICADO; o engine só corrige a citação óbvia. Turnos com AÇÃO declarada
          // (busca/foto/seleção) seguem exigindo evidence própria (o retry prescritivo abaixo).
          if (llmFirst && lockedU != null && !brainVU()!.trusted
              && leadMessage.trim().length <= 30
              && (lockedU.requestedCapabilities?.length ?? 0) === 0
              && !(step.decision?.stateMutations ?? []).some((m) => m.op === "set_slot")) {
            lockedU = { ...lockedU, evidence: [{ capability: null, quote: leadMessage.trim().slice(0, 60) }] } as unknown as TurnUnderstanding;
            evidenceNormalized = true;
          }
          if (llmFirst && lockedU != null && !brainVU()!.trusted && (staleEvidence || drivesFactual)) {
            if (provenanceRetries < PROVENANCE_RETRY_CAP && brainSteps + 1 < brainMaxSteps) {
              provenanceRetries += 1;
              const staleQuote = (lockedU.evidence ?? [])[0]?.quote?.slice(0, 80) ?? "";
              const lastQ = lastAgentQuestionText(contextState).slice(0, 160);
              // ⭐Codex rodada 2: feedback PRESCRITIVO — o modelo copia o JSON literal do quote esperado (o
              // SIGNIFICADO do bloco continua 100% com ele). Sem o exemplo, o gpt-4.1-mini às vezes re-emitia a
              // mesma evidence herdada nos 2 retries e o turno degradava.
              const quoteJson = leadMessage.slice(0, 60).replace(/"/g, "'");
              observations.push({ tool: "response", ok: false, error: { code: "UNDERSTANDING_STALE", message:
                `PROVENIÊNCIA INVÁLIDA: sua understanding.evidence${staleQuote ? ` ("${staleQuote}")` : ""} NÃO está no bloco ATUAL do cliente — NÃO a repita. Bloco ATUAL: "${leadMessage.slice(0, 200)}". Sua última pergunta foi: "${lastQ}". RE-EMITA a decisão com a evidence copiada do bloco atual — use exatamente: "evidence":[{"capability":null,"quote":"${quoteJson}"}] — e responda ao que ESSE bloco significa como resposta à sua última pergunta (ex.: "Não" após pergunta de entrada = sem entrada; um nome = o nome dele).` } });
              continue;
            }
            // ⭐Codex P0 (rodada 2): proveniência ESGOTADA -> a DECISÃO INTEIRA deste step (texto/efeitos/mutações
            // autorados com entendimento de OUTRO turno) é DESCARTADA — nunca renderiza nem envia. Sai do loop sem
            // final; o caminho degradado observável assume (recovery honesto), nunca a resposta stale.
            lockedU = null;
            provenanceExhausted = true;
            break;
          }
          // O detector do bloco atual não executa tool nem decide a resposta. Ele
          // apenas denuncia uma contradição estreita: há um pedido atual de estoque
          // com filtro suficiente, mas a LLM encerrou como "other". A própria LLM
          // recebe o feedback, reavalia o ato e continua dona da tool e da resposta.
          // Atos semânticos explícitos nunca entram aqui.
          // T4 + ⭐AUTORIDADE (audit Codex): a busca é exigida pela SEMÂNTICA do CÉREBRO (isStockSearchTurn(brainVU()) —
          // a LLM declarou a capability de busca com evidence) OU por fluxo de CONTEXTO (anúncio/similaridade/retomada).
          // A perna heurística "constraint suficiente força busca" FOI REMOVIDA: o detector via Corolla/sedan numa
          // CONTESTAÇÃO e forçava re-lista. Se a LLM sub-classificar um pedido real, o certo agora é ela perguntar/explicar
          // (conversa), nunca o engine buscar por keyword — o filtro extraído segue enriquecendo a chamada QUANDO ela busca.
          // Missão P0 (audit Codex smoke): num turno de RESPOSTA DE TROCA o stock_search é PROIBIDO — então o engine também
          // NÃO pode EXIGIR stock_search antes do final (senão contradição proíbe-e-exige, o "obs=8" do relatório).
          // ⭐Missão P0 (exige-e-proíbe, varredura): a perna CONTEXTUAL (anúncio/similaridade/retomada) também respeita o
          // ato conversacional declarado pela LLM (contestação/financiamento/troca/smalltalk) — senão o missingTool EXIGE
          // stock_search que o gate de INTENT CONTRADITÓRIO NEGA (loop). Mesmo helper do hardening F2.41.
          const missingTool = requiredToolBeforeFinal(
            frame,
            observations,
            // A ferramenta comercial só é exigida quando a própria LLM
            // declarou o ato atual como busca de estoque. Extratores do turno
            // continuam sendo fatos/enriquecimento, nunca autoridade paralela.
            llmFirst && brainSearchAct(),
            moreOptionsNeedsScope,
            frame.signals.mentionsMoreOptions === true && brainSearchAct(),
          );
          if (missingTool && brainSteps + 1 < brainMaxSteps) {
            const stockReq = !frame.signals.mentionsStore;
            // A engine exige consistência com o ato que a própria LLM declarou, mas
            // nunca executa estoque por retomada, anúncio, memória ou regex.
            observations.push({ tool: stockReq ? "response" : "tenant_business_info", ok: false, error: { code: "REQUIRED_TOOL_MISSING", message: missingTool } });
            if (stockReq) { duplicateStockCallsBlocked += 1; if (++dupStockLoopCount >= DUP_STOCK_LOOP_CAP) break; }
            continue;
          }
          if (missingTool) break;
          if (singleAuthor) {
            // B2 (audit): pergunta de atributo do SELECIONADO exige vehicle_details bem-sucedido do MESMO key ANTES
            // do final. Sem o fato -> força a consulta (retry); esgotou -> fallback degradado pós-loop.
            // ⭐Missão P0 (TROCA em bloco, incidente Hilux): num turno de RESPOSTA DE TROCA/FINANCEIRA o km/ano/modelo
            // citado descreve o carro DO LEAD (ou responde a pergunta) — NÃO é pergunta de atributo do selecionado.
            // O regex de atributo via "85km rodados" e EXIGIA vehicle_details do Nivus (que o cérebro, certo, não
            // chamava) -> consumia TODOS os passos em silêncio -> recovery_ask_need ("o que você procura?" = regressão
            // à descoberta). Invariante: o engine NUNCA exige uma tool que o contexto do turno proíbe/reinterpreta
            // (mesmo princípio do "proíbe-e-exige" do stock_search acima).
            const detailTarget = resolveTargetWithAd();
            // Grounding de atributo valida o ato escolhido pela LLM; texto com
            // palavras de atributo não pode reclassificar troca/financiamento.
            const llmChoseVehicleDetail = llmFirst
              ? lockedU?.primaryIntent === "vehicle_detail" && brainVU()?.trusted === true
              : !tradeInAnswerTurn && !financialAnswerTurn;
            const needDetail = llmChoseVehicleDetail ? requireVehicleDetailBeforeFinal(frame, observations, detailTarget) : null;
            // P0-2 (exceção sistêmica TIPADA): necessidade de grounding do engine AUTORIZA vehicle_details do key selecionado
            // (separada da intenção da LLM). Registra o key p/ o gate de tool liberar a consulta de aterramento.
            if (needDetail) { const detailKey = detailTarget.kind === "resolved" ? detailTarget.vehicleKey : frame.workingMemory.selectedVehicle?.vehicleKey; if (detailKey) systemDetailKeys.add(detailKey); }
            if (needDetail && brainSteps + 1 < brainMaxSteps) { observations.push({ tool: "vehicle_details", ok: false, error: { code: "REQUIRED_TOOL_MISSING", message: needDetail } }); continue; }
            if (needDetail) break;
            // Renderiza+valida a autoria do cérebro AQUI. Deny/fato ausente -> feedback tipado ao MESMO cérebro
            // (retry) enquanto houver passo; senão sai do loop -> fallback técnico honesto pós-loop.
            // ⭐AUTORIDADE: a expectativa de busca soma a SEMÂNTICA da própria LLM (declarou capability de busca) ao contexto
            // (anúncio/similaridade/retomada) — prometer "vou buscar" sem executar continua proibido nesses casos.
          const authored = authorFromBrainDraft({ finalDecision: step.decision, leadMessage, facts, identities, ctx: { ...ctx, state: contextState, acceptedPrimaryIntent: (llmFirst && brainVU()) ? brainVU()!.understanding.primaryIntent : undefined }, proposedPrimaryIntent: step.understanding?.primaryIntent ?? null, turnId, selectionTurn: acceptedSelectionTurn(), institutionalObs, photoVU: photoVU(), requireBrain, target: resolveTargetWithAd(), openingNeedsDiscovery: isOpeningTurn && (adGenericEntry || firstContactNoCommercialTarget), openingNeedsIntroduction: isOpeningTurn && firstContactNoCommercialTarget, specificAdVehicle: specificAdEntry ? (adVehicleHint ?? null) : null, searchExpectedThisTurn: llmFirst && brainSearchAct(), noCommercialContextYet, advancedThisTurn: leadAdvancedThisTurn, disengagementOnly: false, financialAnswerSlot: null, handoffPlannable, humanRequested: requestsHuman(brainVU()) || leadRequestsHumanExplicitly(leadMessage), sensitiveAnswerKinds, photoRecallLabel: persisted0.lastPhotoAction?.label ?? null });
            if (authored.ok) {
              finalDecision = step.decision; authoredDecision = authored.decision; authoredComposed = authored.composed; authoredProposedEffects = authored.proposedEffects;
              responseSource = brainRetries === 0 ? "brain_final" : "brain_retry";
              break;
            }
            brainRetries += 1;
            if (process.env.PEDRO_V3_DENY_DEBUG) console.error(`[DENY_DEBUG] ${authored.feedback}`);
            // ⭐Fase 1 (LLM-first, regra P0 do dono): deny num turno de CONDUÇÃO comercial vira FEEDBACK ACIONÁVEL para a LLM
            //   REDIGIR (nunca o engine escrever). Dois casos + "keepRetrying" (isento do break de deny-repetido: o certo é a
            //   LLM insistir até acertar, dentro de brainMaxSteps — evita cair em recovery_offer/technical_fallback):
            //   (1) LISTAGEM (comercial/retomada COM itens): entrega as vehicleKeys EXATAS + formato de 3 partes -> a LLM devolve
            //       a vehicle_offer_list (o sistema formata preço/km). (2) MONEY em condução (pagamento/troca): o carro de troca
            //       NÃO tem vehicleKey, então money_ref não conserta -> orienta a NÃO afirmar valores e PERGUNTAR/oferecer.
            // ⭐AUTORIDADE: busca EXECUTADA (autorizada no gate da call — pela LLM ou por contexto) com itens -> o desfecho
            // certo é APRESENTAR o resultado; orienta a LLM a listar. O detector de constraint não participa.
            // ⭐F2.43: inclui a perna de "MAIS OPÇÕES" — a busca executada pelo executor determinístico de mais-opções
            // também precisa do feedback de LISTAGEM (sem ele, o draft sem offer_list caía no fingerprint -> recovery_offer,
            // o engine listando no lugar da LLM). Ato conversacional declarado continua vencendo (repairTurn tem precedência).
            // Uma stock_search observada com itens já é fato de grounding. A
            // validação só exige que a LLM não esconda esse fato; não decide o
            // assunto nem o CTA.
            const listTurn = llmFirst && facts.some((f) => f.ok && f.tool === "stock_search" && f.data.items.length > 0);
            const corruptionDeny = /CORROMPIDA|caracteres de controle/i.test(authored.feedback);
      const conductTurn = llmFirst && (lockedU?.primaryIntent === "financing" || lockedU?.primaryIntent === "trade_in" || sensitiveAnswerTurn);
            const visitGuidanceTurn = llmFirst && (lockedU?.primaryIntent === "visit" || visitAnswerTurn);
            // ⭐MISSÃO FINAL: o backstop determinístico (fala LITERAL do lead pedindo humano) também mantém o retry NO ATO de
            //   atendimento humano — evita que um deny do handoff caia em descoberta quando o entendimento veio fraco.
            const humanGuidanceTurn = llmFirst && (requestsHuman(brainVU()) || leadRequestsHumanExplicitly(leadMessage));
            let effFeedback = authored.feedback;
            let keepRetrying = false;
            // ⭐AUTORIDADE: CONTESTAÇÃO (conversation_repair declarado pela LLM) — a resposta certa é TEXTO simples
            // (reconhecer/corrigir/conduzir); vehicle_offer_list exige fato DO TURNO e aqui não há busca — orienta a LLM.
            const repairTurn = llmFirst && lockedU?.primaryIntent === "conversation_repair";
            // ⭐"mais opções"/busca que voltou VAZIA (todas as stock_search do turno com 0 itens): a resposta certa é a
            // LLM ser HONESTA em texto (sem re-listar os mesmos), nunca o engine escrever (recovery_stock_empty).
            const emptyStockTurn = llmFirst && facts.some((f) => f.ok && f.tool === "stock_search") && !facts.some((f) => f.ok && f.tool === "stock_search" && f.data.items.length > 0);
            if (sensitiveAnswerTurn) {
              effFeedback = `ATO ATUAL = sensitive_data. O cliente acabou de fornecer um dado sensivel validado e armazenado por referencia NESTE bloco. Motivo da rejeicao anterior: ${authored.feedback} Reemita understanding com primaryIntent="sensitive_data", zero capabilities e evidence copiada do bloco atual. Confirme o recebimento SEM repetir valor/token/ref; depois conduza com no maximo UMA pergunta util. Nao use tool comercial, nao volte a perguntar o mesmo dado e nao herde visit/financing da memoria como ato atual.`;
              keepRetrying = true;
            } else if (corruptionDeny) {
              // Encoding corruption is transient; retry with the same intent and
              // an explicit cleanup instruction before any commercial feedback.
              keepRetrying = true;
            } else if (humanGuidanceTurn || visitGuidanceTurn) {
              // Estes atos nao possuem recovery comercial correto: uma falha
              // de forma deve voltar para a mesma LLM, nao encerrar cedo pelo
              // fingerprint e cair em "o que voce procura?". O feedback da
              // validacao continua sendo a autoridade; apenas garantimos as
              // tentativas bounded ja existentes.
              effFeedback = `Mantenha o ATO ATUAL (${lockedU?.primaryIntent ?? "abertura"}) e corrija somente a violacao: ${authored.feedback} Nao volte para descoberta de outro assunto, nao use tool comercial e responda com no maximo UMA pergunta.`;
              keepRetrying = true;
            } else if (llmFirst && (lockedU?.primaryIntent === "vehicle_detail" || isVehicleDetailTurn) && /DUP_TOOL|REQUIRED_TOOL_MISSING.*vehicle_details/i.test(authored.feedback)) {
              // A ferramenta já trouxe o fato disponível. Repetir a consulta
              // não cria opcionais/banco/couro que a fonte não possui e o
              // recovery antigo acabava falando pelo agente. A LLM recebe a
              // instrução semântica para responder a lacuna com honestidade.
              effFeedback = `ATO ATUAL = vehicle_detail. Você JÁ tem os detalhes disponíveis deste carro nas observações. NÃO chame vehicle_details de novo e NÃO abra stock_search. Responda diretamente ao que o cliente perguntou: use apenas os atributos que vieram no fato; se o item específico (opcionais, banco, acessório) não veio, diga com transparência que ele não está confirmado no estoque agora e ofereça UMA ação natural (por exemplo, verificar com a equipe ou enviar fotos). Motivo exato: ${authored.feedback}`;
              keepRetrying = true;
            } else if (repairTurn) {
              effFeedback = `Mantenha o ato que voce declarou (conversation_repair) e corrija somente a violacao: ${authored.feedback} Use os fatos atuais e o prompt do portal para decidir como reconhecer a correcao e conduzir a conversa. Nao use tool sem necessidade e use no maximo UMA pergunta.`;
              keepRetrying = true;
            } else if (listTurn) {
              // ⭐Missão P0 (exige-e-proíbe, teto de preço): o feedback de LISTAGEM só entrega keys que a POL-STOCK-003
              // ACEITA (preço <= teto do lead quando faixaPreco.max é conhecida) — o engine nunca manda listar uma key
              // que a própria policy vai negar. Se TODAS excederem o teto, não é listTurn (cai na condução honesta).
              const priceCeiling = ctx.state.slots.faixaPreco.value?.max ?? null;
              const listKeys: string[] = [];
              for (const f of facts) if (f.ok && f.tool === "stock_search") for (const it of f.data.items) {
                if (priceCeiling != null && typeof it.preco === "number" && it.preco > priceCeiling) continue;
                if (!listKeys.includes(it.vehicleKey) && listKeys.length < 6) listKeys.push(it.vehicleKey);
              }
              if (listKeys.length > 0) {
                effFeedback = `LISTAGEM factual: a stock_search já retornou itens aterrados. Inclua no draft uma vehicle_offer_list usando somente estas vehicleKeys: ${JSON.stringify(listKeys)}. A LLM continua autora do texto de apresentação e do próximo passo; não escreva nomes, preços, km ou outros atributos de estoque em text e não chame stock_search novamente.`;
              } else {
                effFeedback = `A stock_search retornou itens, mas eles não atendem ao teto de preço informado pelo lead. Responda com honestidade usando apenas os fatos disponíveis; a LLM escolhe a formulação e o próximo passo conforme o portal. Não use vehicle_offer_list desses itens, não invente valores e não chame tools novamente.`;
              }
              keepRetrying = true;
            } else if (conductTurn) {
              // CONDUÇÃO (pagamento / avaliação de troca): o ÚNICO desfecho válido é ACOLHER + conduzir com UMA pergunta de
              // avanço. QUALQUER deny aqui (valor em texto livre, atributo de carro sem aterrar, ou volta à descoberta) recebe
              // o mesmo feedback de validação e retry bounded — a LLM redige,
              // o engine só valida e devolve a falha (LLM-first).
              // quando o deny NÃO é exatamente monetário, antes caía direto no break->recovery_ask_need (technical_fallback).
              // ⭐Audit Codex (F2.43 T9/T10): o valor que o CLIENTE informou é ECOÁVEL (aterrado por proveniência) —
              // o feedback NUNCA manda "remover todo valor"; só valores NOVOS/calculados (saldo, total, taxa,
              // simulação) ficam proibidos sem fato real. E quando o deny é de FORMATO (draft ausente/money_ref
              // malformado — rejeição integral do decode), a orientação CONVERGE: UMA parte text simples com o valor
              // do LEAD escrito no texto — NUNCA re-empurra a LLM para o money_ref que ela acabou de errar (era o
              // loop do T9: money_ref malformado -> deny genérico -> money_ref malformado de novo -> fallback).
              // The engine does not choose a missing funnel slot. The LLM
              // receives the validation failure and decides the next natural
              // move from the portal prompt and current facts.
              effFeedback = `Mantenha o ato que voce declarou (${lockedU?.primaryIntent ?? "ato atual"}) e corrija somente a violacao: ${authored.feedback} Use os fatos atuais e o prompt do portal para decidir a resposta e o proximo passo; nao invente dados, nao reabra outro assunto e use no maximo UMA pergunta.`;
              keepRetrying = true;
            } else if (emptyStockTurn) {
              effFeedback = "A busca deste turno voltou VAZIA (com os carros já mostrados excluídos, não há NOVAS opções nesse filtro). Responda com UMA parte text HONESTA: diga que no momento não tem outras opções além das que já mostrou e CONDUZA com UMA pergunta curta (fotos/detalhes/condições de algum dos mostrados, ou se ele quer ampliar o filtro — outro tipo/faixa). NÃO use vehicle_offer_list, NÃO re-liste os mesmos, NÃO escreva R$/km.";
              keepRetrying = true;
            } else if (llmFirst && acceptedSelectionTurn()) {
              // ⭐Missão P0 (varredura exige-e-proíbe, smoke T4): deny em turno de SELEÇÃO ("gostei do segundo") também é
              // ACIONÁVEL (o feedback SELECTION_ATTR_FEEDBACK já diz exatamente o que remover) — sem keepRetrying, a LLM
              // que insiste no atributo cai no fingerprint de deny repetido -> technical_fallback num turno trivial de
              // acolhimento. Mesma mecânica bounded dos demais (a LLM redige; o engine nunca escreve).
              keepRetrying = true;
            }
            policyFeedbackLog.push(effFeedback);
            // T5: fingerprint de deny REPETIDO -> não gasta as tentativas idênticas; sai p/ RECUPERAÇÃO. EXCEÇÃO BOUNDED
            // (keepRetrying): os feedbacks acionáveis de LISTAGEM/MONEY ganham LIST_MONEY_RETRY_CAP tentativas extras (a LLM
            // insiste em listar/conduzir), mas com teto — depois disso conta como deny repetido (não trava o loop inteiro).
            const fp = denyFingerprint(effFeedback);
            if (keepRetrying) {
              if (++listMoneyRetries > LIST_MONEY_RETRY_CAP) { repeatedDeny = true; break; }
            } else {
              if (seenDenyFingerprints.has(fp)) { repeatedDeny = true; break; }
              seenDenyFingerprints.add(fp);
            }
            if (brainSteps + 1 < brainMaxSteps) {
              const currentTurnAnchor = `REVISAO DO MESMO TURNO: o bloco novo do lead e exatamente "${leadMessage.slice(0, 280)}". A ultima fala do agente foi "${(frame.conversationContext.lastAgentMessage ?? "").slice(0, 280)}". A ultima pergunta, se houver, foi "${(frame.currentTurnFacts.expectedAnswer.lastAgentQuestion ?? lastAgentQuestionText(contextState)).slice(0, 220)}". Preserve o ato que voce entendeu neste bloco; esta mensagem e feedback de validacao, nao uma nova ordem comercial.`;
              const retryFeedback = `${currentTurnAnchor}\n${effFeedback}`;
              observations.push({ tool: "response", ok: false, error: { code: "RESPONSE_REJECTED", message: retryFeedback } });
              continue;
            }
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
        // A autoridade continua sendo o entendimento da LLM. Quando ela declarou
        // um pedido humano com evidencia valida, esse ato vence o funil e nenhuma
        // ferramenta comercial pode rodar antes da transferencia.
        // ⭐R7 (audit Codex): o bloqueio de tool comercial no pedido humano também honra o BACKSTOP determinístico
        //   `leadRequestsHumanExplicitly(leadMessage)` — mesma rede de segurança já usada em humanGuidanceTurn (2355),
        //   humanRequested da autoria (2854) e cadeia de handoff (3232). Fecha a assimetria: quando o cérebro classifica
        //   FRACO um pedido humano LITERAL ("quero falar com um vendedor"), a tool comercial não roda naquele turno.
        //   Continua feedback+retry (o engine não redige a transferência).
        if (!commercialToolAllowedForHumanRequest(brainVU(), call.tool)
            || (llmFirst && leadRequestsHumanExplicitly(leadMessage) && COMMERCIAL_TOOLS.has(call.tool))) {
          observations.push({ tool: "response", ok: false, error: {
            code: "FORBIDDEN",
            message: "O cliente pediu atendimento humano neste bloco. Nao use ferramenta comercial nem continue o funil; finalize reconhecendo o pedido e proponha handoff quando o precheck permitir.",
          } });
          continue;
        }
        if (sensitiveAnswerTurn && (call.tool === "stock_search" || call.tool === "vehicle_details" || call.tool === "vehicle_photos_resolve")) {
          observations.push({ tool: "response", ok: false, error: {
            code: "FORBIDDEN",
            message: "O cliente acabou de responder com CPF ou data de nascimento validada. Nao use ferramenta comercial; confirme o recebimento sem repetir o valor/ref e conduza a conversa.",
          } });
          continue;
        }
        // A semântica comercial vem da LLM. Se ela mesma declarou um ato
        // conversacional incompatível com uma tool comercial, rejeitamos a
        // combinação e devolvemos feedback ao mesmo cérebro. O engine não
        // reclassifica o bloco por regex de troca, pagamento ou parcela.
        const llmDeclaredNonCommercialAct = llmFirst && lockedU != null
          && (lockedU.primaryIntent === "conversation_repair" || lockedU.primaryIntent === "financing" || lockedU.primaryIntent === "trade_in" || lockedU.primaryIntent === "smalltalk");
        if (llmDeclaredNonCommercialAct && (call.tool === "stock_search" || call.tool === "vehicle_details" || call.tool === "vehicle_photos_resolve")) {
          duplicateStockCallsBlocked += 1;
          observations.push({ tool: "response", ok: false, error: { code: "FORBIDDEN", message: `Você declarou o ato atual como '${lockedU?.primaryIntent}'. Essa tool comercial não é compatível com o ato que você próprio entendeu. Reavalie o bloco atual; se ele realmente pede estoque/detalhes/fotos, reemita um understanding coerente com evidence literal e capability própria. Caso contrário, responda ao ato atual sem tool.` } });
          if (++dupStockLoopCount >= DUP_STOCK_LOOP_CAP) break;
          continue;
        }
        // P0-2 (audit Codex): AUTORIZAÇÃO TIPADA POR TOOL — cada tool comercial exige a capability PRÓPRIA + evidência
        // própria do CÉREBRO (stock_search->stock_search; vehicle_details->vehicle_details; vehicle_photos_resolve->
        // send_photos). Exceção SISTÊMICA: vehicle_details do key que o engine exigiu p/ grounding (systemDetailKeys).
        // Sem autorização -> rejeita (REQUIRED_TURN_UNDERSTANDING) e o cérebro re-emite. (tenant_business_info isento.)
        const sysDetailOk = call.tool === "vehicle_details" && systemDetailKeys.has(((call.input as { vehicleKey?: string }).vehicleKey) ?? "");
        // Declarar a capability send_photos nao basta para consultar fotos: o
        // bloco atual precisa realmente pedir/aceitar fotos ou responder qual
        // alvo da pergunta pendente. Isto impede prefetch proativo na abertura
        // sem tirar da LLM a liberdade de OFERECER fotos em texto.
        const photoQuerySemanticallyAuthorized = call.tool !== "vehicle_photos_resolve"
          || currentPhotoActAuthorized(resolveTargetWithAd());
        const toolActAuthorized = call.tool === "vehicle_photos_resolve"
          ? (toolCapabilityAuthorized(brainVU(), call.tool) || brainAuthorizesResolvedPhotoAct(resolveTargetWithAd()))
          : toolCapabilityAuthorized(brainVU(), call.tool);
        if (singleAuthor && llmFirst && COMMERCIAL_TOOLS.has(call.tool) && !sysDetailOk
            && (!toolActAuthorized || !photoQuerySemanticallyAuthorized)) {
          const capNeeded = call.tool === "vehicle_photos_resolve" ? "send_photos" : call.tool;
          const capMsg = call.tool === "vehicle_photos_resolve" && !photoQuerySemanticallyAuthorized
            ? "O cliente nao pediu nem aceitou fotos neste bloco. Voce pode OFERECER fotos na resposta, mas nao consulte vehicle_photos_resolve agora. Use essa tool somente quando o pedido/aceite de foto pertencer ao bloco atual ou quando ele responder qual carro quer ver."
            : `Para usar '${call.tool}' inclua NO MESMO passo um 'understanding' com requestedCapabilities contendo '${capNeeded}' e uma evidence (capability '${capNeeded}') citando o TRECHO LITERAL do bloco atual que justifica isso.`;
          // T5 (audit Codex smoke): stock_search SEM understanding válido (ex.: "cadê?" não tem substantivo comercial p/ a
          // evidence) NÃO é execução — empurra como tool:"response" (não infla a contagem de stock_search do smoke) + cap
          // anti-loop. A busca de retomada/comercial roda DETERMINÍSTICA na autoria (não depende de o cérebro autorar evidence).
          if (call.tool === "stock_search") {
            duplicateStockCallsBlocked += 1;
            observations.push({ tool: "response", ok: false, error: { code: "REQUIRED_TURN_UNDERSTANDING", message: capMsg } });
            if (++dupStockLoopCount >= DUP_STOCK_LOOP_CAP) break;
            continue;
          }
          // T7 (LLM-first, audit Codex): numa SELEÇÃO ("gostei do segundo") o cérebro às vezes tenta vehicle_details sem
          // understanding válido (e sem a vehicleKey). A rejeição NÃO é execução (tool:"response") + cap. FEEDBACK ESPECÍFICO:
          // o engine entrega o FATO (o label aterrado do carro escolhido) e orienta — a LLM REDIGE o acolhimento (o engine NÃO
          // escreve a resposta). Seleção não precisa de vehicle_details.
          if (call.tool === "vehicle_details") {
            const selectionLabel = acceptedSelectionLabel();
            const detailMsg = (acceptedSelectionTurn() && selectionLabel)
              ? `O cliente SELECIONOU o ${selectionLabel} (item da última lista). Responda AGORA em FINAL, sem ferramenta: acolha a escolha e faça UMA pergunta oferecendo as fotos. NÃO envie as fotos neste turno.`
              : capMsg;
            observations.push({ tool: "response", ok: false, error: { code: "REQUIRED_TURN_UNDERSTANDING", message: detailMsg } });
            if (++dupDetailLoopCount >= DUP_STOCK_LOOP_CAP) break;
            continue;
          }
          if (call.tool === "vehicle_photos_resolve") {
            const selectionLabel = acceptedSelectionLabel();
            const photoMsg = acceptedSelectionTurn() && selectionLabel
              ? `O cliente apenas SELECIONOU o ${selectionLabel}; ele ainda NÃO pediu fotos. Responda em FINAL, sem ferramenta: acolha a escolha e faça UMA pergunta oferecendo as fotos. A tool só pode ser usada no próximo turno se ele aceitar/pedir.`
              : capMsg;
            observations.push({ tool: "response", ok: false, error: { code: "REQUIRED_TURN_UNDERSTANDING", message: photoMsg } });
            if (++dupPhotoLoopCount >= 2) break;
            continue;
          }
          observations.push({ tool: call.tool, ok: false, error: { code: "REQUIRED_TURN_UNDERSTANDING", message: capMsg } });
          continue;
        }
        // Proíbe loop idêntico: mesma tool + mesmos args -> devolve o fato já obtido (nunca reexecuta).
        // The brain owns the tool decision, but a photo query cannot contradict the
        // uniquely grounded subject of this turn. Reject before touching the adapter
        // so a wrong photo fact never contaminates the observations used on retry.
        // The engine does not rewrite or execute a corrected call: it returns the
        // grounded key and the same brain must decide again.
        if (llmFirst && call.tool === "vehicle_photos_resolve") {
          const input = call.input as { vehicleRef?: { key?: unknown }; vehicleKey?: unknown };
          const requestedKey = typeof input.vehicleRef?.key === "string"
            ? input.vehicleRef.key
            : (typeof input.vehicleKey === "string" ? input.vehicleKey : null);
          const groundedTarget = resolveTargetWithAd();
          if (groundedTarget.kind === "resolved" && requestedKey !== groundedTarget.vehicleKey) {
            const targetLabel = acceptedSelectionLabel();
            observations.push({ tool: "response", ok: false, error: {
              code: "PHOTO_TARGET_MISMATCH",
              message: `A chamada de fotos contradiz o alvo aterrado deste turno. O vehicleKey correto e '${groundedTarget.vehicleKey}'${targetLabel ? ` (${targetLabel})` : ""}. Nao execute nem mencione o outro veiculo. Decida novamente: chame vehicle_photos_resolve com esse vehicleKey e, depois do resultado, responda ao cliente com as fotos.`,
            } });
            if (++dupPhotoLoopCount >= DUP_STOCK_LOOP_CAP) break;
            continue;
          }
        }
        const sig = toolCallSignature(call);
        if (seenToolSigs.has(sig)) {
          if (call.tool === "stock_search") {
            // Repetição BYTE-idêntica de stock_search: NÃO re-observa como busca (senão o relatório conta várias) — empurra
            // feedback de controle (tool:"response") mandando FINALIZAR com o resultado que já tem + cap anti-loop.
            duplicateStockCallsBlocked += 1;
            observations.push({ tool: "response", ok: false, error: { code: "DUP_STOCK_SEARCH", message: "Você JÁ buscou esse estoque neste turno e tem o resultado em mãos. Finalize AGORA respondendo ao cliente com esse resultado (liste os carros encontrados) — NÃO chame stock_search de novo." } });
            if (++dupStockLoopCount >= DUP_STOCK_LOOP_CAP) break;
            continue;
          }
          if (call.tool === "vehicle_details") {
            // T7: repetição byte-idêntica de vehicle_details NÃO re-observa como detalhe (o smoke conta observações) — usa
            // o fato JÁ obtido; feedback de controle (tool:"response") + cap. (O executor de detalhe já roda 1x quando exigido.)
            observations.push({ tool: "response", ok: false, error: { code: "DUP_TOOL", message: "Você já consultou os detalhes desse veículo neste turno; use o fato que a ferramenta retornou (não repita a mesma chamada)." } });
            if (++dupDetailLoopCount >= DUP_STOCK_LOOP_CAP) break;
            continue;
          }
          if (call.tool === "vehicle_photos_resolve") {
            observations.push({ tool: "response", ok: false, error: { code: "DUP_PHOTO_RESOLVE", message: "Você JÁ consultou as fotos deste veículo neste turno e tem o resultado. Finalize AGORA usando esse fato; NÃO chame vehicle_photos_resolve novamente." } });
            if (++dupPhotoLoopCount >= 2) break;
            continue;
          }
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
        // Missão P0 (audit Codex smoke): DEDUP SEMÂNTICO NO LOOP. Se ESTA busca (filtro ENRIQUECIDO) já foi executada neste
        // turno, NÃO re-observa como stock_search (é aqui, no push de toAgentObservation abaixo, que o relatório contava 7x) —
        // empurra feedback de controle (tool:"response") p/ o cérebro FINALIZAR com o resultado que já tem. Relaxamento real =
        // fingerprint diferente = passa e executa. + cap anti-loop. NÃO é if-por-frase (é igualdade de filtro normalizado).
        if (execCall.tool === "stock_search" && stockSearchCache.has(stockSearchFingerprint(execCall.input as Record<string, unknown>))) {
          duplicateStockCallsBlocked += 1;
          observations.push({ tool: "response", ok: false, error: { code: "DUP_STOCK_SEARCH", message: "Você JÁ buscou esse estoque neste turno e tem o resultado em mãos. Finalize AGORA respondendo ao cliente com esse resultado (liste os carros encontrados) — NÃO chame stock_search de novo." } });
          if (++dupStockLoopCount >= DUP_STOCK_LOOP_CAP) break;
          continue;
        }
        const isSystemGroundingCall = execCall.tool === "vehicle_details"
          && systemDetailKeys.has(execCall.input.vehicleKey)
          && !toolCapabilityAuthorized(brainVU(), "vehicle_details");
        const executionAuthority: ToolExecutionAuthority = isSystemGroundingCall ? {
          principal: "engine_safety",
          source: "engine_grounding",
          primaryIntent: lockedU?.primaryIntent ?? null,
          capability: null,
          currentTurnEvidence: true,
          callSite: "required_vehicle_grounding",
        } : {
          principal: "llm",
          source: "llm_tool_call",
          primaryIntent: lockedU?.primaryIntent ?? null,
          capability: capabilityForTool(execCall.tool),
          currentTurnEvidence: brainVU()?.trusted === true,
          callSite: "brain_query_loop",
        };
        // A proposta de tool ainda pertence ao cerebro, mas uma proposta sem
        // autoridade atual nunca pode derrubar o turno inteiro. Ela vira uma
        // observacao de controle para que a propria LLM corrija o entendimento
        // ou conclua sem a tool; o engine nao escolhe outra acao no lugar dela.
        try {
          assertToolExecutionAuthority(execCall.tool, executionAuthority);
        } catch {
          observations.push({ tool: "response", ok: false, error: {
            code: "TOOL_AUTHORITY_REJECTED",
            message: `A tool '${execCall.tool}' nao esta autorizada pelo ato e evidencia do bloco atual. Releia a mensagem atual, reemita understanding coerente e use a tool apenas se ela for realmente necessaria.`,
          } });
          continue;
        }
        const started = Date.parse(clock.now());
        let res: QueryResult;
        try {
          res = await withTimeout(runQueryDedup(execCall), limits.queryTimeoutMs ?? 20_000, `query: ${call.tool} exceeded timeout`);
        } catch {
          observations.push({ tool: call.tool, ok: false, error: { code: "UPSTREAM", message: "tool indisponivel" } });
          continue;
        }
        facts.push(res);
        observations.push(toAgentObservation(res));
        toolResultMems.push(toToolResultMemory(res, turnId));
        recordQueryExecution(res, Math.max(0, Date.parse(clock.now()) - started), executionAuthority);
      }

      // ── AUTORIA: single-author (draft do cérebro, SEM 2º compose) OU legacy (DecisionLlm.compose). ──
      let turnOutput: TurnOutput;
      let proposedEffects: ProposedEffectPlan[];
      let composeFacts: QueryResult[];   // fatos p/ resolver label do veículo (foto) no commit
      if (singleAuthor) {
        // Invariante factual de foto: quando o lead pediu foto e o alvo está inequivocamente
        // aterrado (anúncio/ordinal/seleção/modelo), a engine resolve apenas o FATO photoIds.
        // A decisão e os efeitos visíveis continuam sendo reautorados pela LLM na passagem final.
        // Alvo ambíguo/ausente permanece fail-closed e volta ao cérebro para esclarecimento.
        const photoInvariantTarget = resolveTargetWithAd();
        if (llmFirst && photoInvariantTarget.kind === "resolved" && currentPhotoActAuthorized(photoInvariantTarget)) {
          const invKey = photoInvariantTarget.vehicleKey;
          if (!facts.some((f) => f.ok && f.tool === "vehicle_photos_resolve" && f.data.vehicleKey === invKey)) {
            try {
              const authority: ToolExecutionAuthority = {
                principal: "llm", source: "llm_intent_completion", primaryIntent: lockedU?.primaryIntent ?? null,
                capability: "send_photos", currentTurnEvidence: brainVU()?.trusted === true, callSite: "photo_fact_completion",
              };
              assertToolExecutionAuthority("vehicle_photos_resolve", authority);
              const started = Date.parse(clock.now());
              const invRes = await withTimeout(runQuery({ tool: "vehicle_photos_resolve", input: { vehicleRef: { kind: "vehicle", key: invKey } } }), limits.queryTimeoutMs ?? 20_000, "query: vehicle_photos_resolve (photo invariant) exceeded timeout");
              facts.push(invRes); observations.push(toAgentObservation(invRes)); toolResultMems.push(toToolResultMemory(invRes, turnId));
              recordQueryExecution(invRes, Math.max(0, Date.parse(clock.now()) - started), authority);
            } catch { /* best-effort: sem fato de foto do alvo -> ausência honesta legítima abaixo */ }
          }
          const targetHasPhotos = facts.some((f) => f.ok && f.tool === "vehicle_photos_resolve" && f.data.vehicleKey === invKey && targetAcceptsKey(photoInvariantTarget, f.data.vehicleKey) && f.data.photoIds.length > 0);
          const authoredHasMedia = !!authoredProposedEffects?.some((e) => e.kind === "send_media");
          if (targetHasPhotos && !authoredHasMedia) {
            // O draft contradiz o fato fresco. Descartamos somente o draft; a passagem final da
            // mesma LLM recebe photoIds e decide/redige o send_media aterrado.
            authoredComposed = null; authoredDecision = null; authoredProposedEffects = null; finalDecision = null;
          }
        }
        // Fix C (audit CTWA smoke): pedido de foto + conjunto CANDIDATO do anúncio (>1, ex.: 2 Onix 2025) + alvo NÃO resolvido
        // -> descarta a autoria (que re-lista o estoque todo ou escolhe errado) para o executor PERGUNTAR qual dos candidatos.
        if (llmFirst && adCandidateKeys.length > 1 && leadRequestsPhoto(leadMessage) && resolveTargetWithAd().kind !== "resolved") {
          authoredComposed = null; authoredDecision = null; authoredProposedEffects = null; finalDecision = null;
        }
        // Resolução factual única por ordinal: a engine consulta photoIds do item exato uma
        // única vez. Ela não escreve "aqui estão" nem escolhe o próximo passo; a autoria final
        // pertence à LLM, alimentada pelo mesmo resolveTarget usado por seleção e memória.
        if (!authoredComposed) {
          const photoTarget = resolveTargetWithAd();   // P0-A: inclui a referência EXATA do anúncio p/ foto pronominal
          const wantsPhotoNow = currentPhotoActAuthorized(photoTarget);
          if (wantsPhotoNow && photoTarget.kind === "resolved" && !facts.some((f) => f.ok && f.tool === "vehicle_photos_resolve" && f.data.vehicleKey === photoTarget.vehicleKey)) {
            try {
              const authority: ToolExecutionAuthority = {
                principal: "llm", source: "llm_intent_completion", primaryIntent: lockedU?.primaryIntent ?? null,
                capability: "send_photos", currentTurnEvidence: brainVU()?.trusted === true, callSite: "photo_target_completion",
              };
              assertToolExecutionAuthority("vehicle_photos_resolve", authority);
              const started = Date.parse(clock.now());
              const photoRes = await withTimeout(runQuery({ tool: "vehicle_photos_resolve", input: { vehicleRef: { kind: "vehicle", key: photoTarget.vehicleKey } } }), limits.queryTimeoutMs ?? 20_000, "query: vehicle_photos_resolve (ordinal) exceeded timeout");
              facts.push(photoRes); observations.push(toAgentObservation(photoRes)); toolResultMems.push(toToolResultMemory(photoRes, turnId));
              recordQueryExecution(photoRes, Math.max(0, Date.parse(clock.now()) - started), authority);
            } catch { /* best-effort: a falha vira observação factual para a autoria final da LLM */ }
          }
          // ── P0 (F2.26 + ⭐AUTORIDADE): busca comercial determinística SÓ com AUTORIZAÇÃO real — a LLM declarou busca
          //    (isStockSearchTurn) mas não executou, fluxo de CONTEXTO (anúncio/similaridade/retomada), ou "mais opções"
          //    (ato explícito do lead). O detector de constraint NÃO dispara mais isto: era o robô que re-listava estoque
          //    numa CONTESTAÇÃO ("Corolla não é um sedan?") só porque a frase citava modelo/tipo. ──
          // F2.29: usa o escopo EFETIVO (comercial se suficiente; senão o derivado da oferta homogênea). "mais opções" só
          // busca COM escopo — sem escopo recuperável cai no executor de pergunta (abaixo), nunca lista genérico.
          if (llmFirst && brainSearchAct() && sufficientForStockSearch(effectiveSearchScope) && !facts.some((f) => f.ok && f.tool === "stock_search")) {
            try {
              const searchCall = enrichStockSearchCall({ tool: "stock_search", input: constraintsToStockInput(effectiveSearchScope) }, {
                popular: frame.signals.mentionsPopular === true || effectiveSearchScope.popular === true,
                moreOptions: frame.signals.mentionsMoreOptions,
                previousVehicleKeys: shownVehicleKeys,  // INC3: conjunto CUMULATIVO apresentado (clampa o excludeKeys)
                constraints: effectiveSearchScope,
                wantsMotorcycle,                       // F2.29: só libera moto se o lead pediu moto explicitamente
                enforceShownClamp: llmFirst,           // INC3: clampa só no central_active
              });
              const authority: ToolExecutionAuthority = {
                principal: "llm", source: "llm_intent_completion", primaryIntent: lockedU?.primaryIntent ?? null,
                capability: "stock_search", currentTurnEvidence: brainVU()?.trusted === true, callSite: "search_fact_completion",
              };
              assertToolExecutionAuthority("stock_search", authority);
              const startedS = Date.parse(clock.now());
              const searchRes = await withTimeout(runQueryDedup(searchCall), limits.queryTimeoutMs ?? 20_000, "query: stock_search (commercial) exceeded timeout");
              facts.push(searchRes); observations.push(toAgentObservation(searchRes)); toolResultMems.push(toToolResultMemory(searchRes, turnId));
              recordQueryExecution(searchRes, Math.max(0, Date.parse(clock.now()) - startedS), authority);
            } catch { observations.push({ tool: "stock_search", ok: false, error: { code: "UPSTREAM", message: "tool indisponivel" } }); }
          }
        }
        // No central_active, uma busca vazia volta como fato para a mesma LLM.
        // Somente ela pode decidir se amplia faixa, relaxa filtros ou pergunta ao
        // lead. A cascata determinística permanece restrita ao caminho legado.
        // LLM-FIRST: fatos e efeitos podem ser resolvidos deterministicamente, mas a resposta visivel
        // continua pertencendo ao cerebro. O pos-loop oferece uma ultima janela, sem novas tools, para
        // a MESMA LLM redigir usando apenas as observacoes aterradas. Isto substitui todos os antigos
        // autores comerciais do engine (lista, busca vazia, esclarecimento, institucional e recall).
        if (llmFirst && (!authoredComposed || !authoredDecision || !authoredProposedEffects)) {
          const finalContext = [
            "AUTORIA FINAL OBRIGATORIA: somente voce escreve a resposta visivel ao cliente.",
            "Nao chame nenhuma nova tool nesta passagem; use os fatos e resultados que ja estao nas observacoes.",
            "Responda ao bloco ATUAL e preserve a mudanca de assunto mais recente. Memoria antiga e pergunta pendente sao apenas contexto.",
            "Se houver itens de estoque, apresente somente os itens pertinentes via vehicle_offer_list. Se a busca estiver vazia ou falhou, seja honesto e conduza naturalmente sem inventar disponibilidade.",
            "Se houver fotos resolvidas e o cliente as pediu, proponha send_media do alvo aterrado. Se o alvo for ambiguo, pergunte qual sem escolher por conta propria.",
            "Para fatos institucionais, use apenas a observacao correspondente. Para despedida, identificacao, selecao, pagamento, troca, visita ou pedido humano, acolha o ato atual e avance sem reabrir descoberta.",
            persisted0.lastPhotoAction?.label && isPhotoMemoryQuestionBlock(leadMessage)
              ? `Memoria factual de fotos: o veiculo foi ${persisted0.lastPhotoAction.label}; nomeie-o sem reenviar midia.`
              : "",
            "Use no maximo UMA pergunta curta. Devolva kind=final com draft estruturado e understanding do bloco atual.",
          ].filter(Boolean).join(" ");
          observations.push({ tool: "response", ok: false, error: { code: "FINAL_AUTHORSHIP_REQUIRED", message: finalContext } });

          const FINAL_AUTHORSHIP_RETRY_CAP = 2;
          for (let attempt = 0; attempt < FINAL_AUTHORSHIP_RETRY_CAP; attempt++) {
            finalAuthorshipAttempts += 1;
            brainSteps += 1;
            let finalStep;
            try {
              finalStep = await withTimeout(brain.proposeNextStep(frame, observations), limits.proposeTimeoutMs ?? 30_000, "propose: final LLM authorship exceeded timeout");
            } catch {
              break;
            }
            if (finalStep.understanding) {
              const candidate = reconcileUnderstanding(lockedU, finalStep.understanding, leadMessage, { acceptedPhotoOffer: acceptsAgentPhotoOffer(leadMessage, contextState) });
              const validation = validateTurnUnderstanding(candidate, leadMessage, true, turnValidationContext);
              const authorityFeedback = understandingAuthorityFeedback(validation);
              const staleFinalUnderstanding = !validation.trusted
                && ((candidate.evidence?.length ?? 0) > 0 || (candidate.requestedCapabilities?.length ?? 0) > 0);
              if (authorityFeedback || staleFinalUnderstanding) {
                const feedback = authorityFeedback ?? "A understanding desta resposta final nao pertence ao bloco atual. Reemita evidence copiada do bloco atual e mantenha o ato atual.";
                if (process.env.PEDRO_V3_DENY_DEBUG) console.error(`[FINAL_UNDERSTANDING_DEBUG] ${feedback}`);
                policyFeedbackLog.push(feedback);
                observations.push({ tool: "response", ok: false, error: { code: "FINAL_UNDERSTANDING_REJECTED", message: feedback } });
                continue;
              }
              lockedU = candidate;
            }
            if (finalStep.kind !== "final") {
              observations.push({ tool: "response", ok: false, error: { code: "FINAL_TOOL_FORBIDDEN", message: "As tools deste turno ja foram resolvidas. Nao consulte novamente; escreva agora a resposta final com os fatos disponiveis." } });
              continue;
            }
            const authored = authorFromBrainDraft({ finalDecision: finalStep.decision, leadMessage, facts, identities, ctx: { ...ctx, state: contextState, acceptedPrimaryIntent: (llmFirst && brainVU()) ? brainVU()!.understanding.primaryIntent : undefined }, proposedPrimaryIntent: finalStep.understanding?.primaryIntent ?? null, turnId, selectionTurn: acceptedSelectionTurn(), institutionalObs, photoVU: photoVU(), requireBrain, target: resolveTargetWithAd(), openingNeedsDiscovery: isOpeningTurn && (adGenericEntry || firstContactNoCommercialTarget), openingNeedsIntroduction: isOpeningTurn && firstContactNoCommercialTarget, specificAdVehicle: specificAdEntry ? (adVehicleHint ?? null) : null, searchExpectedThisTurn: false, noCommercialContextYet, advancedThisTurn: leadAdvancedThisTurn, disengagementOnly: false, financialAnswerSlot: null, handoffPlannable, humanRequested: requestsHuman(brainVU()) || leadRequestsHumanExplicitly(leadMessage), sensitiveAnswerKinds, photoRecallLabel: persisted0.lastPhotoAction?.label ?? null });
            if (authored.ok) {
              finalDecision = finalStep.decision;
              authoredDecision = authored.decision;
              authoredComposed = authored.composed;
              authoredProposedEffects = authored.proposedEffects;
              responseSource = "brain_retry";
              break;
            }
            brainRetries += 1;
            if (process.env.PEDRO_V3_DENY_DEBUG) console.error(`[FINAL_AUTHORSHIP_DEBUG] ${authored.feedback}`);
            policyFeedbackLog.push(authored.feedback);
            observations.push({ tool: "response", ok: false, error: { code: "FINAL_RESPONSE_REJECTED", message: authored.feedback } });
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
        } else if (llmFirst) {
          // No central_active, falha de autoria nao promove o engine a atendente. A ultima
          // linha e apenas operacional, sem interpretar o pedido ou conduzir o funil.
          const unavailable = buildBrainUnavailableResponse({ ctx: { ...ctx, state: contextState }, turnId });
          responseSource = "technical_fallback";
          recoveryReason = repeatedDeny ? "brain_unavailable_after_repeated_deny" : "brain_unavailable";
          effectiveDecision = unavailable.decision;
          composed = unavailable.composed;
          proposedEffects = unavailable.proposedEffects;
          finalDecision = finalDecision ?? {
            reasonCode: "brain_unavailable",
            reasonSummary: "provider nao produziu autoria final valida",
            confidence: 0.2,
            responsePlan: { guidance: unavailable.composed.text, draft: null },
            proposedEffects: [], memoryMutations: [], stateMutations: [],
          };
        } else {
          // P0-C: EXECUTOR DETERMINÍSTICO de foto. SÓ com understanding do cérebro (P0-2) + alvo VERIFICADO do assunto
          // (P0-1). Sem understanding OU foto do carro errado -> null (a recuperação pergunta qual; nunca envia errado).
          const detPhoto = buildDeterministicPhotoResponse({ leadMessage, ctx, facts, identities, turnId, photoVU: photoVU(), requireBrain, target: resolveTargetWithAd(), adCandidateKeys });
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
            } else if (moreOptionsNeedsScope && !conversationalActDeclared() && !facts.some((f) => f.ok && f.tool === "stock_search")) {
              // F2.29 (invariante 5): "mais opções" SEM escopo recuperável e SEM busca executada -> PERGUNTA o tipo/faixa.
              // Nunca cai em recovery genérico nem lista aleatória. Aterrado e honesto. ⭐Hardening: ato conversacional
              // declarado pela LLM (contestação etc.) vence o regex de 'mais opções' — a LLM conversa, o executor não roda.
              const detScope = buildMoreOptionsScopeQuestion({ ctx, turnId });
              responseSource = "deterministic_institutional";
              effectiveDecision = detScope.decision; composed = detScope.composed; proposedEffects = detScope.proposedEffects;
              finalDecision = finalDecision ?? { reasonCode: "more_options_needs_scope", reasonSummary: "mais opções sem escopo -> pergunta tipo/faixa", confidence: 0.8, responsePlan: { guidance: composed.text, draft: null }, proposedEffects: [], memoryMutations: [], stateMutations: [] };
            } else {
              // T5: RECUPERAÇÃO CONTEXTUAL — nunca texto genérico ("não consegui confirmar"/"reformule"). Usa
              // TurnUnderstanding + fatos reais (busca->lista aterrada; detalhe->qual; etc.). technical_fallback fica só
              // como MARCADOR interno de degradação (o cérebro falhou); o TEXTO ao lead é sempre contextual/honesto.
              const rec = buildContextualRecovery({ vU: authoritativeVU(), leadMessage, facts, observations, identities, ctx, turnId, constraints: commercialConstraints, adVehicleLabel: adExactFocusTurn ? (adVehicleHint ?? null) : null });
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
        // O central_active valida a quantidade de perguntas durante a autoria. Nao edita
        // silenciosamente o texto da LLM depois da decisao. O trim permanece apenas no legado.
        if (!llmFirst) {
          const trimmedText = trimToOneQuestion(composed.text);
          if (trimmedText !== composed.text) composed = { ...composed, text: trimmedText };
        }
        // Recall determinístico de foto (invariante 8): pergunta de MEMÓRIA de foto SEMPRE nomeia o veículo lembrado.
        // O label é FATO de memória (grounded por construção) -> responde MESMO se o cérebro não autorou. NÃO é
        // degradação: marca responseSource=deterministic_recall (resposta aterrada, não fallback técnico).
        const recalledLabel = persisted0.lastPhotoAction?.label ?? null;
        if (!llmFirst && recalledLabel && isPhotoMemoryQuestionBlock(leadMessage) && !effectiveDecision.effectPlan.some((p) => p.kind === "send_media") && !mentionsLabel(composed.text, recalledLabel)) {
          const recall = `Você pediu as fotos do ${recalledLabel}. Quer que eu te passe mais detalhes dele?`;
          composed = { draft: { parts: [{ type: "text", content: recall }] }, text: recall };
          responseSource = "deterministic_recall";
        }
        // Em llmFirst não existe abertura comercial escrita pelo engine. A
        // identidade e a descoberta são validadas durante a autoria e reescritas
        // pelo próprio cérebro. Se ele não convergir, a falha permanece técnica e
        // observável; nunca aparece uma segunda personalidade determinística.
        degraded = isDegradedResponse(responseSource, recoveryReason);
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
        const groundFacts = await groundNamedVehicles({
          proposedEffects,
          state: contextState,
          facts,
          identities,
          runQuery,
          timeoutMs: limits.queryTimeoutMs ?? 20_000,
          beforeExecute: () => assertToolExecutionAuthority("vehicle_details", {
            principal: "engine_safety",
            source: "engine_grounding",
            primaryIntent: lockedU?.primaryIntent ?? null,
            capability: null,
            currentTurnEvidence: true,
            callSite: "effect_vehicle_grounding",
          }),
          onExecuted: (result, ms) => recordQueryExecution(result, ms, {
            principal: "engine_safety",
            source: "engine_grounding",
            primaryIntent: lockedU?.primaryIntent ?? null,
            capability: null,
            currentTurnEvidence: true,
            callSite: "effect_vehicle_grounding",
          }),
        });
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
        degraded = terminalSafe;
        turnOutput = { decision: effectiveDecision, composed, facts, loopExhausted: false, terminalSafe, steps: brainSteps };
      }
      if (!finalDecision) throw new Error("central: no final decision after authoring");
      // PARTE B (missão): curadoria de fotos (cap 5 + diversidade + dedup) no chokepoint ÚNICO — antes do
      // pendingPhotoActions (registra os IDs enviados) e do materializeEffectPlans (outbox). Só em llmFirst (central_active).
      const decision = llmFirst ? capPhotoEffects(turnOutput.decision, contextState, persisted0) : turnOutput.decision;
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
      // ── ⭐SEM (invariantes 3/4 — INFRA de memória, nunca decisão comercial): reconcilia a WM com o turno ACEITO.
      //    (a) activeTopic/currentLeadIntent refletem o entendimento VÁLIDO (se a LLM setou neste turno, a escolha
      //        dela fica — o reconcile só cobre o default; ela não precisa emitir mutações redundantes);
      //    (b) pendingAgentQuestion registra a pergunta de SLOT que ESTA resposta faz (fonte única
      //        questionSlotFromAgentText sobre o texto AUTORADO do turno);
      //    (c) lastResolvedSlotAnswer registra a pergunta pendente que o bloco RESOLVEU (extração determinística). ──
      {
        const semMuts: SystemWorkingMemoryMutation[] = [];
        const finalSemVU = lockedU != null ? brainVU() : null;
        const llmSetTopic = finalDecision.memoryMutations.some((m) => m.op === "set_active_topic");
        const llmSetIntent = finalDecision.memoryMutations.some((m) => m.op === "set_lead_intent");
        if (llmFirst && finalSemVU?.trusted) {
          const acceptedIntent = sensitiveAnswerTurn
            ? "sensitive_data"
            : visitAnswerTurn
            ? "visit"
            : finalSemVU.understanding.primaryIntent;
          const INTENT_TO_LEAD: Partial<Record<string, LeadIntentKind>> = {
            search_stock: "discover_stock", request_photos: "photo_request", recall_photos: "photo_memory_question",
            vehicle_detail: "vehicle_detail", select_vehicle: "vehicle_detail", institutional: "institutional_question",
            financing: "funnel_answer", trade_in: "funnel_answer", visit: "funnel_answer", sensitive_data: "funnel_answer", smalltalk: "smalltalk",
          };
          const topic = !llmSetTopic && acceptedIntent !== "other" && persistedWM.activeTopic?.topic !== acceptedIntent ? acceptedIntent : null;
          const intent = !llmSetIntent ? INTENT_TO_LEAD[acceptedIntent] ?? null : null;
          if (topic != null || intent != null) semMuts.push({ op: "reconcile_turn_semantics", topic, intent, turnId });
        }
        const askedSlot = questionSlotFromAgentText(composed.text);
        const prevPending = persistedWM.pendingAgentQuestion;
        if ((askedSlot ?? null) !== (prevPending?.slot ?? null)) {
          semMuts.push({ op: "set_pending_agent_question", question: askedSlot ? { slot: askedSlot, sinceTurnId: turnId } : null, turnId });
        }
        if (pendingQuestionSlot != null && (safeExtractedSlots.some((m) => m.op === "set_slot" && m.slot === pendingQuestionSlot)
          || (finalDecision.stateMutations ?? []).some((m) => m.op === "decline_slot" && m.slot === pendingQuestionSlot))) {
          semMuts.push({ op: "set_resolved_slot_answer", answer: { slot: pendingQuestionSlot, turnId }, turnId });
        }
        if (semMuts.length > 0) {
          const rec = applySystemWorkingMemoryMutations(persistedWM, semMuts, { authorizedTurnId: turnId });
          if (rec.ok) persistedWM = rec.next;
        }
      }
      const nextWM = persistedWM;

      // ── Estado: o ENGINE é a única fonte do append_lead_turn; foco invalidado pela AÇÃO do turno. ──
      const renderedOfferContext = computeRenderedOfferContext(
        turnOutput,
        turnId,
        cutoff,
        contextState.lastRenderedOfferContext,
      );
      const renderedItems = renderedOfferContext?.items ?? [];
      const leadTurnMutations: DecisionMutation[] = leadMessage.trim().length > 0 ? [{ op: "append_lead_turn", turn: { role: "lead", text: leadMessage, at: cutoff } }] : [];
      // ── MISSÃO P0 (Financial Question Context): o engine (extractLeadSlots) é a FONTE DE VERDADE dos VALORES monetários
      //    que o LEAD forneceu (entrada/parcela/faixaPreco). Se a extração determinística já atribuiu um slot financeiro
      //    neste turno, DESCARTA a atribuição financeira CONFLITANTE do cérebro — evita "até 1200" virar entrada=1200 por
      //    palpite do LLM (o lead deu uma PARCELA). Slots não-financeiros do cérebro seguem intactos. ────────────────────
      const engineOwnedFinancialSlot = safeExtractedSlots.some((m) => m.op === "set_slot" && VALIDATION_FINANCIAL_SLOTS.has(m.slot));
      const brainNonLeadMutations = decision.decisionMutations.filter((m) => {
        if (m.op === "append_lead_turn") return false;
        if (engineOwnedFinancialSlot && m.op === "set_slot" && VALIDATION_FINANCIAL_SLOTS.has(m.slot)) return false;
        return true;
      });
      // ⭐SEM (invariante 2 — generaliza a autoridade financeira p/ TODO slot factual): mutação set_slot AUTORADA
      // PELA LLM só persiste com PROVENIÊNCIA — extração determinística do bloco cobre o slot (ela vence), valor/
      // objeto presente no bloco atual, ou resposta booleana curta à pergunta pendente aceita — e SEMPRE com
      // understanding VÁLIDO do turno. Inventado (possuiTroca=false do nada, cidade não dita) é DESCARTADO e
      // OBSERVADO (droppedSlotMutations no decision_final). A conversa nunca cai por isso.
      const slotProvenance = filterBrainSlotMutations({
        mutations: brainNonLeadMutations,
        block: leadMessage,
        extractedSlots: new Set(safeExtractedSlots.flatMap((m) => (m.op === "set_slot" || m.op === "set_slot_ref" ? [m.slot as string] : []))),
        pendingSlot: pendingQuestionSlot,
        understandingTrusted: lockedU != null && brainVU()!.trusted,
      });
      const brainStateMutations = slotProvenance.kept;
      const droppedSlotMutations: DroppedSlotMutation[] = slotProvenance.dropped;
      const newSearchExecuted = isNewSearchTurn({
        isPhotoIntent: proposedEffects.some((e) => e.kind === "send_media"),
        relation: prepared.interpretation.relation, renderedItemCount: renderedItems.length, explicitSearchKind: null,
      });
      const focusInvalidation = focusInvalidationMutations(newSearchExecuted, renderedItems, turnId);
      const moreOptionsReset: DecisionMutation[] = (renderedItems.length > 0 && (contextState.moreOptionsExhausted ?? 0) > 0) ? [{ op: "set_more_options_exhausted", value: 0 }] : [];
      // O CÉREBRO aceito decide que o ato atual é seleção; somente depois o resolver determinístico aterra
      // ordinal/modelo na última oferta. Sem esse ato aceito, nenhum token ou memória muda o foco.
      const ordinalRef = acceptedSelectionRef();
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
      // ⭐R8 + R8.1 (Codex 2026-07-15): OPT-OUT DURÁVEL. OPT-OUT GLOBAL INEQUÍVOCO ("me tira da lista", "pare/parar de me
      // mandar", "não quero mais nada", "não quero receber mais mensagens", "pode parar de me chamar", "encerra o contato")
      // persiste um FATO durável no ConversationState p/ o follow-up (evaluateFollowup) PARAR de re-armar T1/T2/T3 mesmo
      // quando o handoff NÃO é plannable (leadId null / vendedor ausente). ⭐R8.1: usa o detector DEDICADO detectExplicitOptOut
      // (não disengagedActionable) — que NÃO é suprimido por filtro comercial/mais-opções ("me tira da lista do SUV até 50 mil"
      // ainda opta) e NÃO confunde REJEIÇÃO DE VEÍCULO com opt-out ("não me interessa esse carro, tem outro?" NÃO opta).
      // IDEMPOTENTE: preserva o 1º timestamp; turnos posteriores NÃO limpam nem reabrem. Evidência = bloco ATUAL; "não"
      // isolado/obrigado/vou pensar NÃO marcam. A LLM continua autora da despedida; a engine só persiste o fato.
      if (detectExplicitOptOut(leadMessage) && reduced.next.optedOutAt == null) {
        reduced.next.optedOutAt = cutoff;
      }
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
      let executedScope = lastStockFact ? activeConstraintsFromStockInput(lastStockFact.data.filtersUsed as Record<string, unknown>) : null;
      // FOCO EXATO do anúncio (missão P0): o ANO injetado pelo anúncio NÃO persiste como filtro ativo (o lead não pediu esse
      // ano). Senão "tem outro Compass?"/"quero Onix" herdariam o ano 2019 e ficariam presos. Persistimos o escopo SEM o ano
      // do anúncio quando o lead não deu ano próprio.
      if (adExactFocusTurn && executedScope && executedScope.anos && (!currentConstraints.anos || currentConstraints.anos.length === 0)) {
        const { anos: _adYear, ...rest } = executedScope;
        executedScope = rest;
      }
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

      // ── FASE 1 CRM (missão 2026-07-09): crm_write DETERMINÍSTICO no chokepoint. O engine grava o que JÁ
      //    COLETOU (slots do estado PÓS-turno, fonte = extração+reducer) — nunca o palpite da LLM, nunca fala
      //    com o lead. Gated (flag + leadId, fail-closed); DELTA por turno (stateBefore=contextState); order
      //    ALTO (o reply/media despacham ANTES — falha de CRM nunca silencia o lead). A política de merge
      //    não-destrutivo (fill-only-if-empty / campo humano intocado) vive no CrmWriteEffectDispatcher. ──────
      // stateBefore = state ORIGINAL do snapshot (o contextState JÁ contém a extração deste turno e zeraria o delta).
      // Opção A (2026-07-10): defesa em profundidade do VÍNCULO — o crm_write só nasce quando o leadId do turno
      // é o MESMO do state (bind feito acima ou vínculo antigo). Divergência (nunca deveria passar pelo root) =
      // fail-closed: zero crm_write, conversa intacta. Bootstrap (1º vínculo) = baseline null -> snapshot completo.
      const crmLeadId = (args.crmWriteEnabled === true && leadId != null && state.leadId === leadId) ? leadId : null;
      const crmPlan = (llmFirst && args.crmWriteEnabled === true && crmLeadId != null)
        ? buildCrmWritePlan({ stateAfter: reduced.next, stateBefore: args.crmBootstrapSync === true ? null : state, adContext: effectiveAdContext, adVehicleLabel: adVehicleHint ?? null, leadId: crmLeadId, turnId, leadNameHint: leadNameHintFromInbox(inboxRecords) })
        : null;
      const decisionWithCrm = crmPlan ? { ...decision, effectPlan: [...decision.effectPlan, crmPlan] } : decision;
      // ── HF-1/HF-3 (missão 2026-07-11): cadeia de TRANSFERÊNCIA no chokepoint (autoria do ENGINE). O cérebro
      //    só propôs o ATO ({kind:"handoff", reason}); aqui removemos qualquer handoff/notify proposto e, quando
      //    plannable (flag+vendedor+CRM vinculado+crm_write do turno), reconstruímos a cadeia executável:
      //    reply (delivered-gate) -> crm_write -> handoff (saga) -> notify_seller. briefing/etiquetas = fatos. ──
      const wmPhoto = reduced.next.workingMemory?.lastPhotoAction ?? null;
      // Encerramento por desinteresse também precisa chegar ao CRM/vendedor, mas
      // sem mudar a despedida já autorada pela LLM. Pedido explícito de humano
      // mantém a precedência e seu motivo próprio; após handoff concluído não
      // abrimos uma nova cadeia.
      const explicitHumanRequest = requestsHuman(brainVU()) || leadRequestsHumanExplicitly(leadMessage);
      const llmDeclaredDisengagement = llmFirst
        && brainVU()?.trusted === true
        && brainVU()?.understanding.primaryIntent === "disengagement";
      const forcedHandoffReason = llmFirst
        ? forcedSilentDisengagementReason({
          // Encaminhamento silencioso e uma acao operacional irreversivel: so
          // desinteresse EXPLICITO a dispara. "Obrigado", "vou pensar" e,
          // principalmente, um "nao" que responde a uma pergunta anterior nao
          // podem encerrar a conversa por inferencia. Esses casos continuam
          // pertencendo a LLM e ao ciclo normal de follow-up.
          // Silent operational handoff is limited to the dedicated explicit
          // opt-out contract. A generic engagement detector must not close or
          // transfer a conversation merely because it sounds negative.
          disengaged: detectExplicitOptOut(leadMessage) || llmDeclaredDisengagement,
          explicitHumanRequest,
          stage: contextState.stage,
        })
        : null;
      const silentDisengagementHandoff = forcedHandoffReason === "silent_disengagement_handoff";
      const currentBlockNormalized = normalizeText(leadMessage);
      const knowledgeGaps = (finalDecision?.knowledgeGaps ?? [])
        .filter((gap) => {
          const quote = normalizeText(gap.quote);
          return quote.length > 0 && currentBlockNormalized.includes(quote);
        })
        .slice(0, 3);
      const handoffChain = buildHandoffChain({
        decision: decisionWithCrm,
        turnId,
        leadId: crmLeadId ?? "",
        stateAfter: reduced.next,
        adContext: effectiveAdContext ?? null,
        adVehicleLabel: adVehicleHint ?? null,
        lastPhotoAction: wmPhoto && typeof wmPhoto.label === "string" && Array.isArray(wmPhoto.photoIds)
          ? { label: wmPhoto.label, photoIds: wmPhoto.photoIds }
          : null,
        agentName: args.handoff?.agentName ?? "Agente",
        leadPhone: args.handoff?.leadPhone ?? null,
        leadDisplayName: args.handoff?.leadDisplayName ?? leadNameHintFromInbox(inboxRecords),
        nowLocal: args.handoff?.nowLocal ?? "",
        knowledgeGaps,
        // CRM pode ja estar sincronizado: ausencia de delta neste turno nao bloqueia
        // um pedido explicito de humano. Se houver crmPlan, ele entra como dependencia.
        plannable: handoffPlannable && crmLeadId != null,
        forcedReason: forcedHandoffReason ?? undefined,
      });
      if (handoffChain.planned && reduced.next.followupSuspendedAt == null) reduced.next.followupSuspendedAt = cutoff;
      const decisionForOutbox = { ...decisionWithCrm, effectPlan: handoffChain.effectPlan };
      const handoffGraphViolations = validateEffectPlans(decisionForOutbox.effectPlan);
      if (handoffGraphViolations.length > 0) {
        throw new Error(`central: invalid post-finalizer handoff graph: ${handoffGraphViolations.join("; ")}`);
      }

      // T1 (audit Codex smoke): SANITIZA control chars do texto de saída num chokepoint ÚNICO — cobre o send_message
      // (materializeEffectPlans), o composedText do resultado e o evento response_composed. O LLM às vezes emite U+001F etc.
      const outComposed = { ...composed, text: sanitizeOutgoingText(composed.text) };
      const outbox = materializeEffectPlans(decisionForOutbox, outComposed, { conversationId, createdAt: cutoff, providerCapability });

      // Observabilidade institucional (audit): status TERMINAL por tópico resolvido no turno.
      const institutionalResolved = [...institutionalObs.entries()].map(([topic, obs]) => ({
        topic, status: (obs.ok ? "ok" : (obs.error.code === "NOT_CONFIGURED" ? "not_configured" : "failure")) as "ok" | "not_configured" | "failure",
      }));
      const finalVU = authoritativeVU();   // T6: semântica autoritativa do turno (do cérebro OU fallback validado)
      // The persisted semantic contract belongs to the validated LLM output.
      // Slot/fact extractors may enrich state, but cannot rewrite its intent.
      const authoritativeUnderstanding: TurnUnderstanding = finalVU.understanding;
      // T6: se houve send_media e o executor não registrou a fonte do alvo (foto AUTORADA pelo cérebro), registra aqui.
      if (targetResolutionSource == null && proposedEffects.some((e) => e.kind === "send_media")) {
        const tr = resolveTargetWithAd(); targetResolutionSource = tr.kind === "resolved" ? tr.source : (tr.kind === "ambiguous" ? "ambiguous" : "none");
      }

      const events = [
        makeEvent({ conversationId, turnId, type: "turn_claimed", suffix: "claimed", payload: { eventIds: claimedEventIds }, at: cutoff }),
        // Observabilidade (audit + T6 fonte única): responseSource distingue autoria; understanding = semântica do turno;
        // previous/resolved vehicleKey + targetResolutionSource auditam a precedência de alvo; recoveryReason + feedback
        // por tentativa auditam a recuperação. tools p/ o v3_query_log do central_active.
        makeEvent({ conversationId, turnId, type: "decision_final", suffix: "decision", payload: {
          action: decision.action, reasonCode: decision.reasonCode, effectIds: outbox.map((r) => r.effectId),
          brainMode: singleAuthor ? "central_active" : "central_shadow", brainSteps, responseSource, degraded, brainRetries, finalAuthorshipAttempts,
          brainReason: finalDecision.reasonSummary.slice(0, 160),
          // ⭐RD1-2 (observabilidade da autoria-LLM exclusiva): quem AUTOROU o final; quantas ORIENTAÇÕES (advisory) foram
          // injetadas antes da geração; quantos denies HARD (fato/efeito/PII/pedido-explícito) dispararam retry + a categoria
          // do 1º; o primaryIntent ACEITO; e se o BLOCO ATUAL venceu a memória (precedência do ato explícito). Zero deny de estilo.
          finalAuthor: (responseSource === "brain_final" || responseSource === "brain_retry") ? "llm_brain" : (responseSource === "technical_fallback" ? "engine_fallback" : "engine_deterministic"),
          advisoriesProvided: 0,
          hardDeniesApplied: policyFeedbackLog.length,
          hardDenyCategory: policyFeedbackLog[0] ? classifyDenyCategory(policyFeedbackLog[0]) : null,
          acceptedPrimaryIntent: authoritativeUnderstanding.primaryIntent,
          currentTurnOverridesMemory: null,
          // T6: semântica do turno (fonte única) + resolução de alvo.
          primaryIntent: authoritativeUnderstanding.primaryIntent, subject: finalVU.understanding.subject,
          subjectSource: finalVU.understanding.subjectSource, understandingTrusted: finalVU.trusted,
          understandingFromBrain: lockedU != null,
          evidence: finalVU.understanding.evidence.slice(0, 4).map((e) => ({ capability: e.capability ?? null, quote: e.quote.slice(0, 48) })),
          previousSelectedVehicleKey: contextState.vehicleContext.selected?.key ?? null,
          resolvedVehicleKey: proposedEffects.find((e) => e.kind === "send_media")?.vehicleKey ?? null,
          targetResolutionSource, recoveryReason,
          toolsExecuted: toolTelemetry.map((t) => t.tool),
          toolAuthorities: toolAuthorities.map((a) => ({
            tool: a.tool,
            principal: a.principal,
            source: a.source,
            primaryIntent: a.primaryIntent,
            capability: a.capability,
            currentTurnEvidence: a.currentTurnEvidence,
            callSite: a.callSite,
            ok: a.ok,
            ms: a.ms,
          })),
          policyFeedback: policyFeedbackLog.slice(0, 5),
          institutionalResolved, droppedSelectKeys,
          // ⭐Missão P0 (fatos frescos vencem snapshot): degradação do catálogo é OBSERVÁVEL, nunca silenciosa.
          catalogEntries: prepared.tenantCatalog.entries.length, catalogDegraded: prepared.catalogDegraded === true,
          // Opção A (vínculo lead↔conversa): auditoria do CRM write por turno — leadId efetivo do plan (null =
          // desligado/mismatch fail-closed), 1º vínculo (bootstrap) e se o turno emitiu crm_write.
          crmWrite: { enabled: args.crmWriteEnabled === true, leadBound: crmLeadId, bootstrapSync: args.crmBootstrapSync === true, planned: crmPlan != null },
          // HF-1/3 (auditoria por turno): plannable (flag+vendedor+vínculo), se a cadeia foi montada, o motivo
          // tipado e por que um handoff proposto foi REMOVIDO (nunca silencioso). P0-C: precheck INTEIRO
          // (flag/crm/lead/config/portal/contagens/motivo/erro sanitizado) — a caixa-preta acabou.
          handoff: { plannable: handoffPlannable, planned: handoffChain.planned, reason: handoffChain.planned ? handoffChain.reason : null, stripped: handoffChain.planned ? null : handoffChain.strippedReason, silentDisengagement: silentDisengagementHandoff, precheck: (args.handoff?.precheck ?? null) as unknown as JsonValue },
          // ⭐SEM (invariantes 1/2 — auditoria por turno): retries de proveniência do understanding + mutações de
          // slot da LLM descartadas por falta de proveniência (o incidente possuiTroca=false fantasma fica visível).
          provenanceRetries, provenanceExhausted, evidenceNormalized, droppedSlotMutations: droppedSlotMutations.slice(0, 6),
          authorityRetries,
          authoritySemanticIssues: brainVU()?.semanticIssues?.slice(0, 4) ?? [],
          // F2.29 (observabilidade do escopo comercial — auditoria do "mais opções herda escopo"): filtro ativo ANTES/DEPOIS,
          // input REAL da stock_search executada, e o escopo herdado por "mais opções" (null se pediu escopo).
          activeSearchConstraintsBefore: contextState.activeSearchConstraints ?? null,
          activeSearchConstraintsAfter: reduced.next.activeSearchConstraints ?? null,
          stockSearchInputExecuted: lastStockFact ? lastStockFact.data.filtersUsed : null,
          moreOptions: baseSignals.mentionsMoreOptions, moreOptionsNeedsScope,
          moreOptionsInheritedScope: baseSignals.mentionsMoreOptions && sufficientForStockSearch(effectiveSearchScope) ? effectiveSearchScope : null,
          // Missão P0 (doc 2): observabilidade de latência/retry. turnLatencyMs = tempo de parede do turno (RealClock em prod);
          // toolMs = soma do tempo das tools; firstFailureReason = 1º feedback/rejeição (por que houve retry). attempts=brainRetries.
          turnLatencyMs: Math.max(0, Date.parse(clock.now()) - turnStartMs),
          toolMs: toolTelemetry.reduce((sum, t) => sum + (t.ms ?? 0), 0),
          firstFailureReason: policyFeedbackLog[0] ? policyFeedbackLog[0].slice(0, 140) : null,
          // Missão P0 INC3/1/2: intenção do turno p/ auditoria de troca vs busca vs abertura.
          tradeInAnswerTurn, resumeSearchTurn, searchExpectedThisTurn: brainSearchAct(), pendingQuestionSlot, tradeBuyTurn, financialAnswerTurn,
          // Missão P0 (audit Codex): separação compra/troca + dedup de busca.
          buyConstraints: tradeBuyTurn ? buyConstraints : null,
          interesseBefore: contextState.slots.interesse.value ?? null,
          interesseAfter: reduced.next.slots.interesse.value ?? null,
          veiculoTrocaAfter: reduced.next.slots.veiculoTroca.value ?? null,
          stockSearchFingerprintsExecuted: stockFingerprintsExecuted.length,
          duplicateStockCallsBlocked,
        }, at: cutoff }),
        makeEvent({ conversationId, turnId, type: "response_composed", suffix: "response", payload: { text: outComposed.text, terminalSafe, responseSource, degraded }, at: cutoff }),
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
        status: "committed", turnId, claimedEventIds, decision, composedText: outComposed.text, terminalSafe,
        facts, outbox, stateVersion: reduced.next.version, workingMemory: nextWM, toolObservations: observations, toolTelemetry, toolAuthorities, brainSteps, responseSource,
        degraded, institutionalResolved, policyFeedback: policyFeedbackLog, droppedSelectKeys,
        understanding: authoritativeUnderstanding, understandingFromBrain: lockedU != null, targetResolutionSource,
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
