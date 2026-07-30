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
import type { Clock, Persistence, UnitOfWork } from "../domain/ports.ts";
import type { TurnContextPreparer, QueryLoopLimits } from "../domain/context.ts";
import type { TurnContext } from "../domain/context.ts";
import { createInitialState } from "../domain/conversation-state.ts";
import type { ConversationState } from "../domain/conversation-state.ts";
import type {
  DecisionMutation, ProposedDecision, ProposedEffectPlan, QueryCall, QueryResult, TurnAction, TurnDecision, ResponseDraft,
} from "../domain/decision.ts";
import { stockSearchGroundableVehicles } from "../domain/decision.ts";
import type {
  AgentBrainPort, AgentBrainDecision, AgentBrainStep, AgentToolObservation, CentralQueryCall, PersistedWorkingMemory,
  PhotoActionDraft, ToolResultMemory, ToolTelemetry, WorkingMemoryV1, BusinessInfoTopic, CurrentTurnIntent, FrameSignals,
  TurnUnderstanding, SystemWorkingMemoryMutation, LeadIntentKind, TurnFrame,
} from "../domain/agent-brain.ts";
import {
  validateTurnUnderstanding, deriveFallbackUnderstanding, authorizesPhotoSend, isPhotoRecall, isStockSearchTurn, isStoreInfoTurn, isShortAffirmationBlock,
  resolveTurnTarget, reconcileUnderstanding, targetAcceptsKey, denyFingerprint, isPhotoDeclined,
  toolCapabilityAuthorized, authorizesPhotoByResolvedTarget, leadRequestsPhoto, acceptsAgentPhotoOffer, requestsHuman, leadRequestsHumanExplicitly, humanRequestDecisionFeedback, commercialToolAllowedForHumanRequest, sensitiveAnswerCompletenessFeedback, sensitiveReferenceLeakFeedback,
  understandingAuthorityFeedback, hasActiveVisitContext, hasActiveCommercialSubject,
  type ValidatedUnderstanding, type TargetResolution, type TargetResolutionSource, type KnownVehicleModel, type TurnValidationContext,
} from "./turn-understanding.ts";
import { shouldSupersedeStaleBlock, DEFAULT_DEBOUNCE_CONFIG } from "./debounce-policy.ts";
import {
  adFingerprintOf, buildOperationalContext, buildGroundedFleet, carryForwardProof, compactGroundedFleet, deriveSendMediaAvailability,
  evaluateAdIdentityProof, resolveAdConfirmation, type AdIdentityProof, type GroundedVehicleRef, type VehicleTargetRuntimeFacts,
} from "../domain/operational-context.ts";
import { detectCommercialConstraints, sufficientForStockSearch, canonicalBrand, describeConstraints, mergeActiveConstraints, constraintsToStockInput, detectCorrections, activeConstraintsFromStockInput, mentionsMotorcycle, deriveScopeFromHomogeneousOffer, detectSimilarityIntent, relaxToSimilar, type RelaxKind, type CommercialConstraints } from "./commercial-constraints.ts";
import { applyMonetarySemanticsToCurrentConstraints, sanitizeStockSearchInputMoney } from "./monetary-semantics.ts";
import { selectPhotos } from "./photo-selection.ts";
import { resolveVehicleTypeFromTaxonomy } from "../adapters/read/vehicle-taxonomy.ts";
import { detectDisengagement, detectExplicitOptOut, type LeadEngagement } from "./lead-intent.ts";
import { extractAdVehicleConstraints, adHasVehicle, refersToAd, isBareGreeting, resolveAdCandidateKeys, resolveAdFocusedVehicle, asksAdAlternatives, buildAdDeclaredVehicleIdentity, buildAdIdentityTarget, type AdFocusedVehicle } from "./ad-context.ts";
import type { AdContext } from "../domain/conversation-state.ts";
import type { ClaimExtractor } from "../domain/decision.ts";
import type { TenantAgentRef } from "../domain/read-ports.ts";
import type { InboxRecord, OutboxRecord, ProviderCapability } from "../domain/effect-intent.ts";
import type { Id, JsonValue, VehicleFact, RememberedVehicleIdentity } from "../domain/types.ts";
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
import { buildHandoffChain } from "./handoff-plan.ts";

// MISSÃO PII (P0-C): shape do diagnóstico do precheck de handoff — módulo testável handoff-precheck.ts.
import type { HandoffPrecheckDiag } from "./handoff-precheck.ts";
export type { HandoffPrecheckDiag } from "./handoff-precheck.ts";
import { computeRenderedOfferContext } from "./offer-context.ts";
import { focusInvalidationMutations, isNewSearchTurn } from "./vehicle-focus.ts";
import { extractLeadSlots, resolveSelectedVehicle, inferredQuestionSlot, lastAgentQuestionText, questionSlotFromAgentText, statesTradeVehiclePossession, isAnswerToFinancialQuestion, isFinancialValueDuringSelectedFinancing } from "./lead-extraction.ts";
import { filterBrainSlotMutations, type DroppedSlotMutation } from "./slot-provenance.ts";
import { safeCommitSlots } from "./conversation-engine.ts";
import { isSdrHandoffReadyForIntent, reconcileObjectiveWithQuestion, stripAllObjectiveMutations, type SdrQualificationPolicy } from "./sdr-conductor.ts";
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
import { assertReplayWiring, isLegacyReplayEnabled, assertLegacyAuthoringAuthorized } from "./legacy/legacy-replay.ts";
import {
  authoredPresentsVehicles,
  buildDeterministicPhotoResponse,
  buildDisengagementResponse,
  buildInstitutionalResponse,
  buildMoreOptionsScopeQuestion,
  buildRelaxedOfferResponse,
  capPhotoEffects,
} from "./legacy/legacy-commercial-authors.ts";
import {
  loadPersistedWorkingMemory, deriveCanonicalViews, applyDecisionWorkingMemoryMutations,
  applySystemWorkingMemoryMutations, isValidPhotoActionDraft,
  toAgentObservation, toToolResultMemory, toToolTelemetry,
} from "./working-memory.ts";
import type { TenantBusinessInfoSource } from "./tenant-business-info.ts";
import { resolveTenantBusinessInfo, businessInfoToolResultMemory } from "./tenant-business-info.ts";
import { invalidBrazilGreeting } from "./channel-time.ts";
import { responseAuthorityProfile, type ResponseAuthorityMode } from "./response-authority.ts";
import { groundProposedMediaEffects } from "./media-effect-grounding.ts";
import { applyAcceptedPhotoActionOutcome, reconcileAcceptedPhotoOutcomes } from "./photo-outcome.ts";
import { sanitizeOutgoingText } from "./outgoing-text-sanitizer.ts";
import {
  aggregateLeadMessage,
  adContextFromInbox,
  deriveProposedAction,
  ensureSendMessage,
  isKernelQueryCall,
  leadNameHintFromInbox,
  makeEvent,
} from "./central-turn-io.ts";
import { buildRememberedIdentities, canonicalVehicleLabel, groundNamedVehicles, parseLabel } from "./vehicle-label.ts";
export { applyAcceptedPhotoActionOutcome, reconcileAcceptedPhotoOutcomes } from "./photo-outcome.ts";
export { sanitizeOutgoingText } from "./outgoing-text-sanitizer.ts";

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
  // ⭐Valor REAL do follow-up comercial automatizado (worker T1/T2/T3) para este tenant. Entra no contexto
  // operacional como FATO. Ausente = `null` (desconhecido): a LLM nunca recebe `false` presumido, porque dizer
  // que não existe follow-up quando ele existe é tão errado quanto o contrário.
  readonly automatedLeadFollowupEnabled?: boolean;
  // ⭐Disponibilidade OPERACIONAL de mídia: existe rota/dispatcher de `send_media` E infraestrutura de fotos neste
  // root. NÃO confundir com `providerCapability.send_media` (idempotent|queryable|none), que descreve reconciliação
  // do efeito e vale "none" em produção mesmo com o envio funcionando. Ausente = desconhecido (null no contexto).
  readonly mediaDeliveryAvailable?: boolean;
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
  /** Configuração estruturada do cliente; contexto para a LLM, não decisão da engine. */
  readonly tenantPolicies?: unknown;
  readonly brainMaxSteps?: number;                       // teto de passos de ferramenta do cérebro (default 4)
  readonly allowedTools?: ReadonlySet<string> | readonly string[];
  readonly providerCapability?: Partial<Record<OutboxRecord["kind"], ProviderCapability>>;
  // AUTORIA ÚNICA (audit): quando true, o cérebro AUTORA um ResponseDraft e o engine RENDERIZA aterrado (sem 2º
  // LLM/compose); deny volta ao MESMO cérebro; esgotou -> fallback técnico honesto. central_active liga isto.
  readonly singleAuthor?: boolean;
  // LLM-FIRST (missão SDR real): quando true, o engine NÃO gerencia objetivo de funil (nada de
  // reconcileObjectiveWithQuestion) — o funil vira contexto read-only e o CÉREBRO decide a próxima pergunta/condução.
  // Permanecem apenas fronteiras objetivas: schema/refs estruturadas, proveniência de chaves, mídia e efeitos
  // executáveis, allowlist e vazamento de identificador interno. CPF-timing, quantidade de perguntas, estilo e
  // condução comercial pertencem ao prompt/LLM. central_active liga isto; legado mantém false.
  readonly llmFirst?: boolean;
  // F7-6 (Fase 7) — OPT-IN EXPLÍCITO do ramo LEGADO de autoria comercial determinística (foto/institucional/
  // desengajamento/mais-opções/recuperação/recall). Só vale em replay/offline autorizado (ex.: F2.13). Default false.
  // Produção (central_active/central_shadow, ambos llmFirst=true) NUNCA liga isto -> nenhum deterministic_*. Ver
  // legacy/legacy-replay.ts para a política e as invariantes (fiação + saída) aplicadas fail-closed no engine.
  readonly legacyCommercialReplay?: boolean;
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
// ⭐RD1-2 (observabilidade): classifica feedback de validação em categoria (só p/ auditoria — nunca controla nada).
// A taxonomia também cobre o replay legado; no central_active só podem rejeitar violações estruturadas/operacionais
// objetivas (schema, refs/chaves, mídia/efeitos executáveis e identificadores internos). PURO, best-effort.
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
// ⭐F7-2 (observabilidade anti retry-storm): categoria CURTA por retry/nudge do loop do cérebro, derivada do CODE (e da
// mensagem quando o code é ambíguo) da observação de CONTROLE empurrada antes de cada continue/break. É SÓ relato —
// NÃO altera decisão, caps nem grounding. Usada para surfaçar retryReasons/retryReasonCounts no decision_final e no
// CentralTurnResult (diagnóstico de "por que o turno gastou passos"), sem depender de instrumentar cada call site.
function classifyRetryReason(code: string, message: string): string {
  switch (code) {
    case "UNDERSTANDING_REQUIRED":
    case "UNDERSTANDING_INCOMPLETE":
    case "UNDERSTANDING_CONFLICT":
    case "REQUIRED_TURN_UNDERSTANDING":
    case "FINAL_UNDERSTANDING_REJECTED":
      return "understanding_required";
    case "UNDERSTANDING_STALE":
      return "understanding_stale";
    case "DUP_STOCK_SEARCH":
    case "DUP_TOOL":
    case "DUP_PHOTO_RESOLVE":
      return "dup_tool";
    case "PHOTO_TARGET_MISMATCH":
      return "photo_target_mismatch";
    case "TOOL_AUTHORITY_REJECTED":
      return "tool_authority_rejected";
    case "FINAL_AUTHORSHIP_REQUIRED":
      return "final_authorship_required";
    case "FINAL_TOOL_FORBIDDEN":
      return "final_tool_forbidden";
    case "REQUIRED_TOOL_MISSING":
    case "FINAL_REQUIRED_TOOL_MISSING":
      return /mais op[çc]/i.test(message) ? "more_options_scope" : "required_tool_missing";
    case "RESPONSE_REJECTED":
    case "FINAL_RESPONSE_REJECTED":
      return classifyDenyCategory(message) === "grounding" ? "grounding_deny" : "response_rejected";
    case "FORBIDDEN":
      if (/atendimento humano/i.test(message)) return "human_request_block";
      if (/\bcpf\b|data de nasc|sens[íi]vel/i.test(message)) return "sensitive_data_block";
      if (/allowlist/i.test(message)) return "tool_forbidden";
      if (/ato atual|ato que voc[êe]|n[ãa]o [ée] compat/i.test(message)) return "non_commercial_act";
      return "policy_denied";
    case "UPSTREAM":
      return "tool_upstream";
    case "VALIDATION":
      return "tool_validation";
    default:
      return code.toLowerCase();
  }
}
function isDegradedResponse(src: ResponseSource, recoveryReason: string | null): boolean {
  void recoveryReason;
  if (isDegradedSource(src)) return true;
  return false;
}

// ⭐FASE 1 (diagnóstico observável): quando o cérebro NÃO autora um final (fallback técnico OU fallback factual da
// FASE 3), classifica a CAUSA para o relatório do turno. Sanitizado (só rótulo enum). Diferencia o que a missão pediu:
// falha REAL de provedor × resposta válida rejeitada × tool negada por evidência × grounding × esgotamento de retry.
export type DegradationKind =
  | "none"                     // o cérebro autorou (brain_final/brain_retry) OU não é central_active
  | "provider_transport"       // falha REAL de transporte: HTTP 5xx/429, timeout, erro de rede
  | "protocol_adherence"       // ⭐Item 7: provedor RESPONDEU (2xx ou 4xx), mas o modelo produziu output que não bate no
                               //   contrato — JSON malformado, shape inválido, ou request rejeitada (4xx). É o gatilho real
                               //   das "instabilidades"; a correção é json_schema/tool-calling, NÃO retry de transporte.
  | "tool_disallowed"          // ⭐Item 7: modelo emitiu query com tool fora do allowlist / shape de call inválido (2xx). Falha SEMÂNTICA do modelo, não transporte.
  | "tool_denied_no_evidence"  // ação pedida sem understanding/evidência do bloco -> tool não autorizada
  | "grounding_rejected"       // fato inventado (km/cor/preço/disponibilidade fora do catálogo) barrado
  | "response_rejected"        // resposta do cérebro rejeitada por completude/política (não-grounding)
  | "retry_exhausted";         // esgotou tentativas sem causa dominante clara
// ⭐Item 7 (Codex): NÃO rotular tudo como provider_transport. O reasonSummary do #safeFinal distingue a causa; aqui a
// mapeamos. HTTP 5xx/429/timeout/rede = transporte REAL; HTTP 4xx / JSON inválido / shape inválido = aderência de
// protocolo (o provedor respondeu, o output/request não conforma); tool fora do allowlist = falha semântica do modelo.
function classifyProviderFallback(reason: string | null): "provider_transport" | "protocol_adherence" | "tool_disallowed" {
  const r = (reason ?? "").toLowerCase();
  if (r.includes("tool fora do allowlist") || r.includes("query inv")) return "tool_disallowed";
  if (r.includes("json inv") || r.includes("shape inv")) return "protocol_adherence";
  const httpMatch = r.match(/http\s+(\d{3})/);
  if (httpMatch) {
    const status = Number(httpMatch[1]);
    if (status === 429 || status >= 500) return "provider_transport";
    if (status >= 400) return "protocol_adherence";   // 4xx = request rejeitada pelo contrato, não transporte caído
  }
  return "provider_transport";   // timeout / erro de rede / transporte cru
}
function classifyDegradation(args: {
  readonly llmFirst: boolean;
  readonly responseSource: ResponseSource;
  readonly providerFallbackSeen: boolean;
  readonly providerFallbackReason: string | null;
  readonly policyFeedbackLog: readonly string[];
  readonly observations: readonly AgentToolObservation[];
}): DegradationKind {
  if (!args.llmFirst) return "none";
  // O cérebro autorou (mesmo após um hiccup transitório que o retry/backoff recuperou) -> não é degradação.
  if (args.responseSource === "brain_final" || args.responseSource === "brain_retry") return "none";
  // O #safeFinal foi acionado: distingue transporte real × aderência de protocolo × tool inválida (não mascara mais).
  if (args.providerFallbackSeen) return classifyProviderFallback(args.providerFallbackReason);
  const obsCodes = args.observations.filter((o) => !o.ok).map((o) => o.error.code);
  if (obsCodes.includes("UNDERSTANDING_REQUIRED") || obsCodes.includes("REQUIRED_TURN_UNDERSTANDING")) return "tool_denied_no_evidence";
  const denyCats = args.policyFeedbackLog.map((f) => classifyDenyCategory(f));
  if (denyCats.includes("grounding")) return "grounding_rejected";
  if (args.policyFeedbackLog.length > 0) return "response_rejected";
  return "retry_exhausted";
}

// moreOptionsSearch chega gateado pela necessidade factual declarada pela LLM. O ato conversacional permanece
// independente: contestação, financiamento ou troca podem consultar estoque quando o bloco atual realmente o pede.
// Slots monetários do LEAD (fonte única: extractLeadSlots é autoritativo sobre a LLM — F2.40; a validationState
// projeta ESTES slots do turno para render/validate enxergarem — F2.43/audit Codex).
const VALIDATION_FINANCIAL_SLOTS = new Set(["entrada", "parcelaDesejada", "faixaPreco"]);
// ── AD-1 (2026-07-18): o requisito de tool é TIPADO, não uma string solta.
//
// DEFEITO CORRIGIDO (livelock de produção): o caller derivava o RÓTULO da observação de falha E o CONTADOR anti-loop de
// `!frame.signals.mentionsStore` — uma PALAVRA do texto do lead — sem nenhuma relação com QUAL das três pernas abaixo
// realmente falhou. Consequências medidas:
//   (a) a perna institucional não incrementava contador NENHUM -> repetia até esgotar brainMaxSteps -> "instabilidade";
//   (b) pior: a palavra "loja" no bloco DESLIGAVA o cap anti-loop da perna de ESTOQUE e de "mais opções" (contaminação
//       cruzada) — "Vcs tem na loja uma HRV?" caía exatamente nesse cruzamento.
// Devolvendo `{ tool, feedback }`, rótulo e contador passam a nascer do REQUISITO QUE FALTOU. PURO.
type MissingToolRequirement = { readonly tool: "stock_search" | "tenant_business_info"; readonly feedback: string };

function requiredToolBeforeFinal(frame: ReturnType<typeof buildTurnFrame>, observations: readonly AgentToolObservation[], searchTurn: boolean, moreOptionsNeedsScope: boolean, moreOptionsSearch: boolean, storeInfoTurn: boolean): MissingToolRequirement | null {
  const wasObserved = (tool: string) => observations.some((observation) =>
    observation.tool === tool && (observation.ok || observation.error.code !== "REQUIRED_TOOL_MISSING"));
  // Uma necessidade factual de estoque declarada e validada no bloco atual exige a consulta antes do final. Isso vale
  // independentemente do ato conversacional principal (busca, seleção, negociação, financiamento etc.).
  if (searchTurn && !wasObserved("stock_search")) {
    return { tool: "stock_search", feedback: "Você declarou stock_search como necessidade factual deste bloco, com evidência literal, mas ainda não executou a consulta. Chame stock_search com os critérios realmente pedidos antes de finalizar. Preserve o papel semântico dos valores: somente search_budget vira precoMax." };
  }
  // "mais opções" exige nova busca — MAS só quando há ESCOPO recuperável (F2.29). Sem escopo (nem filtro ativo, nem
  // oferta homogênea derivável) NÃO se força busca genérica: o engine PERGUNTA o escopo (executor determinístico). Forçar
  // uma busca sem filtro devolveria lista genérica (o bug do print: "tem outros?" -> carros baratos aleatórios + moto).
  if (moreOptionsSearch && !wasObserved("stock_search") && !moreOptionsNeedsScope) {
    return { tool: "stock_search", feedback: "O lead pediu mais opções. Execute stock_search com os filtros atuais e excludeKeys da última oferta antes da resposta final." };
  }
  // ⭐AD-1: `storeInfoTurn` é AUTORIDADE SEMÂNTICA (ato institucional declarado pela LLM com evidência do bloco atual),
  // não mais o regex `mentionsStore`. "Vcs tem na loja uma HRV?" é ato de ESTOQUE: cai na perna de cima, nunca aqui.
  // O feedback nomeia os tópicos ATENDÍVEIS — um deny que não diz o que satisfaz é um pedido impossível.
  if (storeInfoTurn && !wasObserved("tenant_business_info")) {
    return { tool: "tenant_business_info", feedback: "Você declarou um ato institucional (informação da LOJA). Execute tenant_business_info com o topic correspondente — address, hours ou unit — antes da resposta final. Se o que o cliente quer não é nenhum desses três (por exemplo, disponibilidade de um carro), então o ato NÃO é institucional: reemita o understanding com o ato correto e use a tool desse ato." };
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
      // ⭐FASE 1 (diagnóstico observável): CAUSA da degradação quando o cérebro não autora (sanitizado, enum);
      // providerFallbackReason = motivo sanitizado do provedor (≤120 chars, sem prompt/PII) quando houve falha real.
      degradationKind: DegradationKind;
      providerFallbackReason: string | null;
      institutionalResolved: readonly { readonly topic: string; readonly status: "ok" | "not_configured" | "failure" }[];
      policyFeedback: readonly string[];   // feedbacks de deny devolvidos ao cérebro no turno (observabilidade)
      // ⭐F7-2 (observabilidade anti retry-storm): motivo CURTO de cada retry/nudge do loop do cérebro (ordem de ocorrência)
      // e a contagem por categoria. Só relato — nunca controla decisão/caps.
      retryReasons?: readonly string[];
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

// ── Enforcement determinístico de invariantes (Brain/11 §5: validador/executor; NÃO conduz o assunto) ──────────
// PEDIDO de foto AGORA (imperativo) — distinto de PERGUNTA de memória ("qual carro pedi fotos?").
const PHOTO_MEMORY_Q_RX = /\b(qual|que|quais)\b[^?]*\b(foto|carro|ve[ií]culo|modelo)\b[^?]*\b(pedi|pediu|mandei|mostrei|recebi)\b/;
/**
 * Projeta o mesmo alvo canonico usado pelas guardas de detalhes/midia para o
 * contexto factual da LLM. Nao resolve novamente, nao escolhe tool e nao
 * promove identidade de anuncio. Ambiguidade permanece ambiguidade.
 */
function projectTargetResolution(target: TargetResolution): VehicleTargetRuntimeFacts {
  if (target.kind === "resolved") {
    return {
      status: "resolved",
      vehicleKey: target.vehicleKey,
      candidateVehicleKeys: [...new Set(target.candidateVehicleKeys)],
      source: target.source,
      subjectModel: target.subjectModel,
    };
  }
  if (target.kind === "ambiguous") {
    return {
      status: "ambiguous",
      vehicleKey: null,
      candidateVehicleKeys: [...new Set(target.candidateVehicleKeys)],
      source: "ambiguous",
      subjectModel: target.subjectModel,
    };
  }
  return {
    status: target.kind,
    vehicleKey: null,
    candidateVehicleKeys: [],
    source: null,
    subjectModel: target.subjectModel,
  };
}

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
// ⭐Exportado para o TESTE DE CONTRATO da autoridade factual única (F2.70 seção H). O teste amarra esta função,
// `targetAcceptsKey` e a validação de capability à MESMA chave — foi a divergência entre elas que produziu o deny
// que afirmava "nenhum veículo aterrado" logo após a tool aterrar o veículo.
export function knownVehicleKeysForTest(facts: readonly QueryResult[], identities: readonly RememberedVehicleIdentity[], state: ConversationState): Set<string> {
  return knownVehicleKeys(facts, identities, state);
}
function knownVehicleKeys(facts: readonly QueryResult[], identities: readonly RememberedVehicleIdentity[], state: ConversationState): Set<string> {
  const keys = new Set<string>();
  for (const f of facts) {
    if (!f.ok) continue;
    // F2.76: candidatos de família são veículos REAIS e REFERENCIÁVEIS pela LLM (a exigência de listar segue só em `items`).
    if (f.tool === "stock_search") for (const v of stockSearchGroundableVehicles(f.data)) keys.add(v.vehicleKey);
    if (f.tool === "vehicle_details") keys.add(f.data.vehicle.vehicleKey);
    // ⭐CORREÇÃO (smoke real 19/07, auditoria Codex): um `vehicle_photos_resolve` BEM-SUCEDIDO aterra o vehicleKey
    // tanto quanto uma busca ou um detalhe — o fato veio da MESMA fonte. Faltava esta linha, e a guarda de
    // proveniência que eu adicionei hoje passou a negar a foto DEPOIS de já ter resolvido a foto: a LLM tomou
    // VEHICLE_KEY_NOT_GROUNDED e repetiu a tool 3x. Só deu certo porque ela insistiu — o contrato estava errado.
    if (f.tool === "vehicle_photos_resolve") keys.add(f.data.vehicleKey);
  }
  for (const id of identities) keys.add(id.vehicleKey);
  if (state.vehicleContext.selected?.key) keys.add(state.vehicleContext.selected.key);
  for (const it of state.lastRenderedOfferContext?.items ?? []) keys.add(it.vehicleKey);
  for (const it of state.groundedVehicles ?? []) keys.add(it.vehicleKey);
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
function sanitizePolicyFeedback(
  verdicts: readonly { policyId?: string; outcome: string; violations?: readonly string[] }[],
  authorityMode: ResponseAuthorityMode,
): string {
  const msg = verdicts.filter((v) => v.outcome === "deny").flatMap((v) => v.violations ?? [v.policyId ?? "regra"]).join("; ").slice(0, 200);
  if (authorityMode === "central_active") {
    return `A saida foi rejeitada por uma contradicao estrutural ou factual verificavel (${msg}). Corrija somente essa contradicao usando os fatos estruturados deste turno. O prompt do portal continua sendo a unica autoridade sobre redacao, perguntas, funil e conducao comercial.`;
  }
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
    // Compatibilidade legado/replay: constraints comerciais do turno podem preencher
    // lacunas somente quando `llmOwnsFilters` é falso. No central_active a chamada
    // direta da LLM permanece intacta, exceto por proteções objetivas documentadas
    // abaixo (como impedir que excludeKeys esconda veículos nunca apresentados).
    readonly constraints?: CommercialConstraints;
    // F2.29: o lead pediu MOTO explicitamente -> libera moto na busca (default do estoque é EXCLUIR moto de lista de carro).
    readonly wantsMotorcycle?: boolean;
    // INC3 (F2.30): clampa o excludeKeys ao APRESENTADO (só central_active/llmFirst; shadow/legado mantém a união antiga).
    readonly enforceShownClamp?: boolean;
    // Fronteira LLM-first: numa chamada DIRETA do cérebro, os filtros comerciais
    // executados são exatamente os que ele declarou. A engine ainda pode remover
    // excludeKeys não apresentados (proteção objetiva contra ocultar estoque), mas
    // não acrescenta marca/modelo/tipo/ano/preço/câmbio/combustível/popular/moto
    // vindos de memória, regex ou anúncio. O preenchimento de lacunas permanece
    // apenas para os caminhos legado/replay que ainda dependem desta compatibilidade.
    readonly llmOwnsFilters?: boolean;
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
    const excludeList = !options.llmOwnsFilters && options.moreOptions ? [...shown] : brainExcludes;
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
  const c = options.llmOwnsFilters ? undefined : options.constraints;
  const filled: Partial<QueryCall["input"]> = {};
  if (c) {
    if (call.input.marca == null && c.marca) (filled as { marca?: string }).marca = canonicalBrand(c.marca);
    if (call.input.modelo == null && call.input.modelos == null && c.modelos && c.modelos.length > 0) {
      // ⭐F2.76 def#1: preenche multi-modelo como ALTERNATIVAS tipadas (modelos[]); modelo único em `modelo`. Sem broad.
      if (c.modelos.length > 1) (filled as { modelos?: string[] }).modelos = [...c.modelos];
      else (filled as { modelo?: string }).modelo = c.modelos[0];
    }
    if (call.input.tipo == null && c.tipo) (filled as { tipo?: typeof c.tipo }).tipo = c.tipo;
    if (call.input.precoMax == null && c.precoMax != null) (filled as { precoMax?: number }).precoMax = c.precoMax;
    if (call.input.cambio == null && c.cambio) (filled as { cambio?: typeof c.cambio }).cambio = c.cambio;
    // F2.79: propulsao ativa preenche LACUNA da chamada (valor explicito do cerebro sempre vence).
    if (call.input.combustivel == null && c.combustivel) (filled as { combustivel?: typeof c.combustivel }).combustivel = c.combustivel;
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
    ...(!options.llmOwnsFilters && (options.popular || c?.popular) ? { popular: true } : {}),
    ...(excludeKeys ? { excludeKeys } : {}),
    // F2.29: só libera moto se o lead pediu moto OU o cérebro já marcou includeMotorcycles. Senão, DEFAULT exclui.
    ...((!options.llmOwnsFilters && options.wantsMotorcycle) || call.input.includeMotorcycles === true ? { includeMotorcycles: true } : {}),
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
  readonly adVehicleIdentity?: string | null;        // identidade declarada do anúncio; não prova estoque/chave, mas permite à LLM aterrar o pedido de foto
  readonly searchExpectedThisTurn?: boolean;         // Missão P0 INC1/A: turno comercial/busca -> proíbe promessa "vou buscar" sem stock_search
  readonly noCommercialContextYet?: boolean;         // Missão P0 INC2/F: sem intenção comercial ainda -> não pedir nome (nem sobrenome)
  readonly advancedThisTurn?: boolean;               // LLM-first: o lead deu um slot novo neste turno (ex.: o nome) -> reperguntar o não-respondido é condução
  readonly disengagementOnly?: boolean;              // agradecimento/despedida sem novo pedido acionável -> não reabre o funil
  readonly financialAnswerSlot?: "formaPagamento" | "entrada" | "parcelaDesejada" | null;
  // HF-1 (2026-07-11): transferência EXECUTÁVEL neste turno (flag ON + vendedor ativo disponível + CRM
  // vinculado + transfer.enabled do portal). Promessa de consultor exige ISTO **e** o effect handoff proposto.
  readonly handoffPlannable?: boolean;
  /**
   * Read-only readiness fact calculated from the portal qualification view.
   * The brain still chooses whether to hand off; this flag only prevents an
   * executable `qualified_handoff` effect when the configured qualification
   * is factually incomplete.
   */
  readonly qualifiedHandoffReadyFor?: (primaryIntent: string | null) => boolean;
  readonly humanRequested?: boolean;
  readonly sensitiveAnswerKinds?: readonly ("cpf" | "birthDate")[];
  readonly photoRecallLabel?: string | null;            // memória factual: a LLM precisa nomear o veículo lembrado
  readonly proposedPrimaryIntent?: string | null;       // candidato da LLM usado só por validadores de segurança, nunca autoriza tool/efeito
}): SingleAuthorResult {
  const draft = args.finalDecision.responsePlan.draft;
  // ⭐RD1-2 (2026-07-13, autoria-LLM exclusiva): em central_active (requireBrain/llmFirst) as guardas de ESTILO/QUALIDADE
  // NÃO negam mais o draft no central_active: o prompt do portal conduz a conversa e a LLM recebe fatos tipados antes da geração.
  // Aqui elas ficam ativas SÓ no legado/replay (!requireBrain), preservando o contrato antigo. No central_active
  // ficam HARD apenas contradições verificáveis por estrutura: refs/chaves, efeito executável, alvo de mídia e vazamento
  // sensível. A engine não reinterpreta a prosa comercial depois da autoria.
  const authorityMode: ResponseAuthorityMode = args.requireBrain ? "central_active" : "legacy_strict";
  const authority = responseAuthorityProfile(authorityMode);
  const applyLegacyStyleGuards = authority.conversationalTextVeto;
  if (!draft || draft.parts.length === 0) {
    if (applyLegacyStyleGuards && args.disengagementOnly) {
      return { ok: false, feedback: "DESPEDIDA ISOLADA: seu draft veio ausente ou malformado. Devolva FINAL com draft.parts contendo EXATAMENTE UMA part {\"type\":\"text\",\"content\":\"<despedida curta e cordial>\"}. O content não pode ter pergunta, tool, coleta de nome/troca/entrada/parcela/visita nem promessa de transferência." };
    }
    const structuralHint = args.finalDecision.reasonSummary.startsWith("draft_invalid:")
      ? ` Motivo estrutural detectado na sua saída anterior: ${args.finalDecision.reasonSummary.slice("draft_invalid:".length).trim()}.`
      : "";
    const feedback = applyLegacyStyleGuards
      ? `Devolva 'draft' com parts estruturadas (text/message_break/vehicle_ref/money_ref/vehicle_offer_list). Não escreva km/cor/câmbio/ano/preço em texto livre.${structuralHint}`
      : `Saída estruturada inválida. Devolva FINAL com 'draft.parts' não vazio usando apenas parts suportadas (text/message_break/vehicle_ref/money_ref/vehicle_offer_list). A redação e a condução continuam sendo suas e devem seguir o prompt do portal.${structuralHint}`;
    return { ok: false, feedback };
  }
  // A abertura continua sendo autoria da LLM. RD1-2: em central_active a APRESENTAÇÃO é ADVISORY (o prompt do portal +
  // a apresentação pertence ao prompt do portal); o engine não nega mais a omissão. Guarda legada só no replay.
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
  // O replay legado preserva a autorização semântica histórica. No
  // central_active, a proposta explícita da LLM é a autoridade da decisão; a
  // engine valida somente se o efeito é factual e executável mais abaixo.
  const acceptedPhotoAuthorized = args.photoVU?.fromBrain === true
    && args.photoVU.trusted
    && args.photoVU.understanding.primaryIntent === "request_photos"
    && args.photoVU.understanding.requestedCapabilities.includes("send_photos")
    && authorizesPhotoByResolvedTarget(args.target, args.leadMessage, args.ctx.state, args.photoVU);
  // A resposta a "de qual carro você quer as fotos?" pode ser semanticamente uma
  // seleção ("o número 1") ou apenas o modelo ("T-Cross"). A LLM continua dona
  // desse ato; a pergunta pendente só autoriza o efeito factual do alvo resolvido.
  const pendingPhotoTargetAuthorized = args.photoVU?.fromBrain === true
    && args.photoVU.trusted
    && authorizesPhotoByResolvedTarget(args.target, args.leadMessage, args.ctx.state, args.photoVU);
  // Fonte exclusiva do pós-requisito operacional em central_active: a
  // capability que a própria LLM declarou COM evidência própria de foto no
  // bloco do lead. Reaproveitar a mesma função que autoriza o efeito evita
  // transformar uma oferta proativa ("quer fotos?") em obrigação de
  // prefetch. Autorizações contextuais nunca passam a obrigar a tool.
  const photoCapabilityDeclaredNow = authorizesPhotoSend(args.photoVU, args.leadMessage, args.requireBrain);
  // Coerencia entre dois campos autorados pela propria LLM. Isto nao infere
  // pedido por regex nem escolhe uma tool: apenas impede que o mesmo resultado
  // declare `request_photos` como ato principal e, ao mesmo tempo, encerre a
  // midia como `none`. Recusa/adiamento explicito continua fora deste contrato.
  const photoIntentDeclaredNow = args.requireBrain
    && args.photoVU?.fromBrain === true
    && args.photoVU.trusted
    && args.photoVU.understanding.primaryIntent === "request_photos"
    && !isPhotoDeclined(args.leadMessage);
  const photoAuthorized = authorizesPhotoSend(args.photoVU, args.leadMessage, args.requireBrain)
    || acceptedPhotoAuthorized
    || pendingPhotoTargetAuthorized;
  const photoRecall = isPhotoRecall(args.photoVU);
  if (applyLegacyStyleGuards && args.target.kind === "conflict" && sendMediaKeys.length > 0) {
    return { ok: false, feedback: "Seu 'understanding.subjectValue' NÃO corresponde ao modelo que o cliente ESCREVEU no bloco. O modelo do texto do cliente é a AUTORIDADE — corrija subject/subjectValue para ele antes de qualquer ação e NÃO envie foto de outro carro." };
  }
  if (applyLegacyStyleGuards && !photoAuthorized && sendMediaKeys.length > 0) {
    return { ok: false, feedback: PHOTO_NOT_REQUESTED_FEEDBACK };
  }
  // Um alvo positivamente resolvido é uma prova objetiva. Nesse único caso a
  // engine bloqueia uma proposta para chave divergente. Ausência, conflito ou
  // ambiguidade de metadado não provam que a tool escolhida pela LLM está
  // errada; a própria resolução factual da mídia será a autoridade.
  if (applyLegacyStyleGuards && args.target.kind === "resolved" && sendMediaKeys.some((key) => !targetAcceptsKey(args.target, key))) {
    const label = canonicalVehicleLabel(args.target.vehicleKey, args.facts, args.identities, args.ctx.state);
    return {
      ok: false,
      feedback: `O efeito send_media aponta para outro veículo. A chave factual do alvo resolvido é '${args.target.vehicleKey}'${label ? ` (${label})` : ""}. Resolva e envie somente a mídia dessa chave.`,
    };
  }
  const groundedMedia = groundProposedMediaEffects(args.finalDecision.proposedEffects, args.facts);
  if (!groundedMedia.ok) return { ok: false, feedback: groundedMedia.feedback };
  const photoSafeEffects = groundedMedia.effects;
  // A LLM é a autoridade do ato e do motivo de transferência. A engine não
  // reclassifica `qualified_handoff` para `explicit_human_request` por regex ou
  // por uma segunda interpretação do bloco; ela somente valida abaixo se o
  // efeito proposto pode ser executado neste turno.
  const brainEffects = photoSafeEffects;
  const proposedEffects = ensureSendMessage(brainEffects);
  const proposedHandoff = proposedEffects.some((effect) => effect.kind === "handoff" || effect.kind === "notify_seller");
  if (authority.executableEffectVeto && proposedHandoff && args.handoffPlannable !== true) {
    return {
      ok: false,
      feedback: "O efeito de transferência proposto não está executável neste turno. Reemita o FINAL sem esse efeito e responda conforme o prompt do portal; não afirme que a transferência aconteceu.",
    };
  }
  const proposedQualifiedHandoff = proposedEffects.some((effect) => effect.kind === "handoff" && effect.reason === "qualified_handoff");
  // No readiness callback means central_active has deliberately delegated the
  // commercial qualification decision to the portal prompt/LLM. In that mode
  // the engine must not treat an absent internal SDR policy as a negative fact.
  // A callback is supplied only by the legacy/replay path, where it remains a
  // factual safety gate for the old objective machinery.
  const qualifiedHandoffReady = args.qualifiedHandoffReadyFor == null
    || args.qualifiedHandoffReadyFor(args.proposedPrimaryIntent ?? null) === true;
  if (args.requireBrain && authority.commercialPolicyVeto && proposedQualifiedHandoff && args.humanRequested !== true && !qualifiedHandoffReady) {
    return {
      ok: false,
      feedback: "Você propôs uma transferência qualificada, mas a qualificação configurada no portal ainda não está completa. Não transfira por apenas reconhecer interesse ou troca: continue você atendendo o ato atual e faça a próxima pergunta natural do atendimento. Só use reason=qualified_handoff quando os dados exigidos pelo funil já estiverem conhecidos.",
    };
  }
  // A LLM também é autora das mutações de foco. A validação factual acontece
  // uma única vez em canonicalizeSelectMutations, que elimina chaves
  // inexistentes sem exigir uma segunda classificação semântica do mesmo ato.
  const rawStateMutations = args.finalDecision.stateMutations ?? [];
  const stateMutations = rawStateMutations;
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
  // Uma consulta bem-sucedida disponibiliza fatos; ela não obriga a LLM a
  // listar, citar ou escolher um veículo naquele mesmo texto. As guardas de
  // grounding abaixo continuam rejeitando qualquer atributo/valor inventado.
  // Assim, a engine valida o que foi afirmado sem prescrever a condução.
  // postQuery valida a decisão conforme a fronteira explícita. No central_active
  // só contradições estruturais (por exemplo, uma chave fora dos fatos) podem
  // negar; preferências comerciais como teto de preço pertencem ao portal/LLM.
  const post = PolicyEngine.postQuery(proposal, realFacts, args.ctx, authorityMode);
  if (hasDeny(post)) return { ok: false, feedback: sanitizePolicyFeedback(post, authorityMode) };
  const decision0 = finalize(args.turnId, proposal, post, realFacts);
  // Render: identidade só NOMEIA (marca/modelo/ano); km/cor/câmbio/preço só do fato REAL do MESMO vehicleKey.
  let composed: RenderedResponse;
  try {
    composed = { draft, text: ResponseRenderer.render(draft, renderFacts, args.ctx.state, args.identities) };
  } catch (err) {
    if (applyLegacyStyleGuards && args.selectionTurn) return { ok: false, feedback: SELECTION_ATTR_FEEDBACK };
    return { ok: false, feedback: `Uma parte estruturada cita um FATO ausente/não consultado (${String((err as Error)?.message ?? err).slice(0, 140)}). Chame vehicle_details do vehicleKey antes de usar essa referência estruturada, ou remova a afirmação até obter o fato.` };
  }
  // Bytes de controle são ruído de transporte, não uma decisão conversacional.
  // Limpe-os antes das validações para que uma resposta factual válida não
  // consuma retries nem termine em technical_fallback. Se só havia ruído, o
  // draft continua inválido e volta ao mesmo cérebro para nova autoria.
  composed = { ...composed, text: sanitizeOutgoingText(composed.text) };
  if (!composed.text.trim()) {
    return { ok: false, feedback: "A resposta ficou sem conteúdo publicável após a normalização técnica. Reemita uma resposta textual válida." };
  }
  if (applyLegacyStyleGuards) {
    const greetingFeedback = invalidBrazilGreeting(composed.text, args.ctx.now);
    if (greetingFeedback) return { ok: false, feedback: greetingFeedback };
  }
  // Continuidade factual da oferta: a memÃ³ria estruturada pode renderizar
  // novamente itens antigos para referÃªncias legÃ­timas, mas nÃ£o autoriza a
  // LLM a reenviar a lista inteira quando nenhuma busca nova ocorreu. O engine
  // apenas reconhece as identidades jÃ¡ visÃ­veis e devolve feedback; nÃ£o escreve
  // a resposta nem escolhe o prÃ³ximo assunto.
  if (applyLegacyStyleGuards && rememberedOfferItems.length >= 2) {
    const renderedComparable = normalizeText(composed.text);
    const rememberedLabels = [...new Set(rememberedOfferItems
      .map((vehicle) => normalizeText([vehicle.marca, vehicle.modelo].filter(Boolean).join(" ")))
      .filter((label) => label.length >= 3))];
    if (rememberedLabels.length >= 2 && rememberedLabels.every((label) => renderedComparable.includes(label))) {
      return { ok: false, feedback: "A resposta renderizada repete todos os veiculos da ultima lista visivel. Mesmo que uma consulta tenha ocorrido, o conjunto mostrado nao mudou. Nao reenumere os mesmos carros; responda apenas como o criterio atual afeta as opcoes ja enviadas e mostre lista somente quando houver resultado visivelmente diferente." };
    }
  }
  // LLM-first: memória pode aterrar QUAL veículo recebeu fotos, mas nunca escreve a resposta pelo cérebro.
  // Se a LLM ignorar o label lembrado, o engine devolve o fato e ela reautora. O override textual
  // deterministic_recall fica restrito ao caminho legado.
  if (applyLegacyStyleGuards && args.photoRecallLabel
      && isPhotoMemoryQuestionBlock(args.leadMessage)
      && !proposedEffects.some((effect) => effect.kind === "send_media")
      && !mentionsLabel(composed.text, args.photoRecallLabel)) {
    return { ok: false, feedback: `O cliente perguntou de QUAL carro eram as fotos. O fato de memória aterrado é: "${args.photoRecallLabel}". Responda você mesmo nomeando esse veículo, sem reenviar mídia e sem expor chave interna.` };
  }
  // RD1-2: acolher entrada/parcela pertence ao prompt do portal e à autoria da LLM;
  // guarda legada só no replay. Em central_active a LLM acolhe seguindo o advisory + o prompt do portal.
  if (applyLegacyStyleGuards && args.financialAnswerSlot === "entrada" && !/\bentrada\b/i.test(normalizeText(composed.text))) {
    return { ok: false, feedback: "O cliente acabou de responder sobre ENTRADA. Acolha explicitamente essa resposta antes de avançar; não a ignore nem volte a outro ponto. Você continua livre para escolher UMA próxima pergunta útil." };
  }
  if (applyLegacyStyleGuards && args.financialAnswerSlot === "parcelaDesejada" && !/\bparcela\w*\b/i.test(normalizeText(composed.text))) {
    return { ok: false, feedback: "O cliente acabou de informar a PARCELA mensal desejada. Acolha explicitamente a parcela antes de avançar; não repita apenas a entrada. Você continua livre para escolher UMA próxima pergunta útil." };
  }
  // T2: mesmo sem send_media/reasonCode, o TEXTO não pode PROMETER foto num turno que não autoriza foto (e não é recall,
  // que legitimamente NOMEIA a foto lembrada). Guarda de OUTPUT (não classifica o turno) — a autoridade é photoAuthorized.
  if (applyLegacyStyleGuards && !photoAuthorized && !photoRecall && textPromisesPhoto(composed.text)) {
    return { ok: false, feedback: PHOTO_NOT_REQUESTED_FEEDBACK };
  }
  // PII/UX safety: identidade não pode virar barreira de entrada para um ato
  // que a própria LLM classificou como substantivo. Esta é uma validação
  // genérica da autoria, não um roteador de assunto: o mesmo cérebro recebe
  // feedback e escolhe como tratar o ato atual sem pedir cadastro primeiro.
  // A ordem entre entregar valor, pedir identidade e avancar o funil pertence
  // ao prompt do portal e a autoria da LLM. O engine nao rejeita uma resposta
  // apenas porque ela pergunta o nome durante um ato comercial: isso era uma
  // policy de conducao concorrente. Grounding, PII sensivel e efeitos seguem
  // validados pelas guardas factuais abaixo.
  // Continuidade global: quando a LLM declarou um ato substantivo atual,
  // uma pergunta institucional herdada nao pode substituir a resposta a
  // esse ato. A engine nao escolhe o novo assunto; apenas devolve a
  // incoerencia para a mesma LLM reescrever.
  // Somente a understanding desta autoria pode ativar esta validação. A
  // memória aceita é contexto e não deve transformar uma foto/seleção atual
  // em um bloqueio herdado de busca.
  const continuityIntent = args.proposedPrimaryIntent ?? null;
  const institutionalQuestionDisplacedCurrentAct = applyLegacyStyleGuards
    && typeof continuityIntent === "string"
    && new Set(["financing", "trade_in"]).has(continuityIntent)
    && isServiceOrInstitutionalQuestion(composed.text)
    && !isServiceOrInstitutionalQuestion(args.leadMessage);
  if (institutionalQuestionDisplacedCurrentAct) {
    return { ok: false, feedback: `Sua resposta retomou uma pergunta institucional antiga enquanto o ato atual declarado foi '${continuityIntent}'. Responda primeiro ao bloco atual e preserve a continuidade factual; nao copie a pergunta pendente da memoria nem escolha outro assunto para a proxima pergunta.` };
  }
  const sensitiveFeedback = authority.sensitiveLeakVeto
    ? (args.requireBrain
      ? sensitiveReferenceLeakFeedback(composed.text)
      : sensitiveAnswerCompletenessFeedback(args.sensitiveAnswerKinds ?? [], composed.text))
    : null;
  if (sensitiveFeedback) return { ok: false, feedback: sensitiveFeedback };
  const humanFeedback = applyLegacyStyleGuards
    ? humanRequestDecisionFeedback({
      requested: args.humanRequested === true,
      handoffPlannable: args.handoffPlannable === true,
      proposedEffectKinds: proposedEffects.map((effect) => effect.kind),
      composedText: composed.text,
    })
    : null;
  if (humanFeedback) return { ok: false, feedback: humanFeedback };
  // A LLM-declared disengagement is an operationally relevant decision. The
  // engine does not infer it from a phrase; it only requires the LLM to carry
  // the executable handoff act when that capability is actually available.
  const disengagementIntent = args.requireBrain && args.proposedPrimaryIntent === "disengagement";
  const disengagementHandoffProposed = proposedEffects.some((effect) => effect.kind === "handoff" || effect.kind === "notify_seller");
  // ⭐AD-6 (2026-07-19) — REGRA REMOVIDA, não refinada.
  //
  // Aqui existia um deny: "você declarou encerramento e a transferência está disponível, então INCLUA o efeito
  // handoff com reason=qualified_handoff". Dois defeitos, um em cima do outro:
  //   1. `qualified_handoff` é NEGADO pelo gate de efeito quando a qualificação não está completa — e quem só
  //      agradece e se despede é exatamente o caso não-qualificado. O engine exigia o único motivo que ele mesmo
  //      proibia. Medido em produção (19/07, lead 24 99827-5607, "Ok. Obrigado."): 4 denies idênticos -> fallback.
  //   2. Mais fundo: transferir ao encerrar é REGRA DE NEGÓCIO, não invariante de fato ou segurança. Um turno sem
  //      pendência factual e sem efeito necessário — "Perfeito, fico à disposição" — tem de poder FECHAR.
  //      Transformar essa preferência em deny é o que engessou o v2: o engine decidindo conduta comercial.
  //
  // A disponibilidade de transferência continua chegando à LLM como FATO no contexto, e o protocolo já descreve
  // quando `handoff_after_closure` cabe. Se ela escolher não transferir, perdemos uma transferência — não a
  // conversa inteira. Perder o lead num "Tive uma instabilidade" é estritamente pior do que não transferir.
  void disengagementIntent; void disengagementHandoffProposed;
  // ⭐Codex P0 (rodada 2): PROMESSA/OFERTA de transferência a consultor/vendedor SEM efeito real materializado
  // (handoff/notify_seller inexistentes nesta fase) é mentira operacional — mesmo padrão do textPromisesPhoto.
  // A LLM reescreve conduzindo ELA MESMA. Quando a Fase 3 materializar o handoff, a promessa passa a exigir o
  // EFEITO correspondente no plano (o predicado já checa proposedEffects).
  if (applyLegacyStyleGuards && promisesHumanHandoff(composed.text)) {
    const handoffProposed = proposedEffects.some((e) => e.kind === "handoff" || e.kind === "notify_seller");
    // HF-1: promessa de consultor SÓ passa com o plano EXECUTÁVEL no MESMO turno = effect handoff proposto
    // E transferência plannable (flag+vendedor+vínculo+portal). Qualquer outra combinação = deny + reescrita
    // pela MESMA LLM (nunca texto do engine).
    if (!handoffProposed && args.handoffPlannable === true) {
      return { ok: false, feedback: "Você prometeu/ofereceu ENCAMINHAR para consultor/vendedor, mas NÃO incluiu o efeito de transferência neste turno. Se transferir é o próximo passo (cliente pediu humano OU a qualificação está completa), inclua nos effects: {\"kind\":\"handoff\",\"reason\":\"explicit_human_request\"|\"qualified_handoff\"}. Senão, reescreva SEM prometer transferência e continue VOCÊ conduzindo." };
    }
    if (!handoffProposed || args.handoffPlannable !== true) {
      if (args.humanRequested !== true) {
        // ⭐DEGRAU 1 (2026-07-18): o texto antigo dizia "sem o cliente pedir humano", ENSINANDO que transferência só é
        // legítima quando o lead pede — o que é falso (qualified_handoff é decisão da LLM e não depende de pedido).
        // Nos dois casos que chegam aqui handoffPlannable !== true, então a causa REAL é a transferência não estar
        // executável neste turno. O feedback agora diz isso, sem desensinar a decisão autônoma.
        return { ok: false, feedback: "Você ofereceu/mencionou transferência, mas ela NÃO está executável neste turno (sem vendedor/vínculo disponível agora). Transferir também é decisão SUA quando a qualificação está completa — o problema aqui não é faltar pedido do cliente, é a transferência estar indisponível. Não fale de indisponibilidade nem prometa consultor: continue VOCÊ atendendo e responda ao ato atual com UMA próxima pergunta natural." };
      }
      // MISSÃO PII (invariantes 9/10): a indisponibilidade REAL exige TRANSPARÊNCIA — nunca esconder o pedido
      // do cliente nem convertê-lo em coleta de dados. PROIBIDO condicionar a transferência a CPF/qualificação.
      return { ok: false, feedback: "A transferência NÃO pode ser executada neste momento (indisponibilidade real do sistema — o motivo técnico fica registrado). Reescreva com TRANSPARÊNCIA: reconheça o pedido do cliente, diga com honestidade que não consegue transferir AGORA e ofereça uma alternativa (continuar ajudando por aqui / registrar o pedido para a equipe retornar). PROIBIDO: condicionar a transferência a CPF ou qualquer outro dado, fingir que a transferência está em andamento, ou ignorar o pedido voltando ao funil de qualificação." };
    }
  }
  // Compatibilidade legada: o replay ainda classifica alegações textuais de
  // agendamento. No `central_active`, porém, esta leitura lexical NÃO pode
  // rejeitar a autoria. O limite operacional verdadeiro chega antes da geração
  // em `operationalContext.capabilities.appointmentBooking=false`; interpretar
  // a prosa depois da LLM exigiria exceções linguísticas e recriaria os mesmos
  // falsos bloqueios já removidos das promessas e alegações de combustível.
  // Um agendamento só poderá voltar a ser validado no ativo quando existir um
  // efeito estruturado e executável correspondente — nunca por regex de texto.
  if (authority.lexicalGroundingVeto && promisesVisitScheduled(composed.text)) {
    return { ok: false, feedback: "Voce afirmou que a visita esta AGENDADA/MARCADA/CONFIRMADA, mas este turno nao possui capacidade nem efeito que reserve horario; nem uma transferencia comprova agendamento. Reescreva sem afirmar reserva: ACOLHA somente o dia/horario informado como preferencia. Se houver um efeito handoff executavel no plano, voce pode comunicar o encaminhamento, mas nao a confirmacao da visita." };
  }
  // ⭐RD1-2 (Codex #2): a guarda de "pergunta dupla de ação" foi REMOVIDA do central_active — ela banía até a alternativa
  // curta e relacionada do MESMO veículo ("quer as fotos ou prefere ver as condições dele?"), que é natural. O advisory
  // no central_active, o prompt do portal e a LLM decidem quantas perguntas e qual é o próximo passo.
  // P0-2 (audit): a resposta ao lead NUNCA pode conter LITERALMENTE uma vehicleKey conhecida (chave/código interno).
  const slotClaimFeedback = applyLegacyStyleGuards ? factualSlotClaimFeedback(composed.text, args.ctx.state) : null;
  if (slotClaimFeedback) return { ok: false, feedback: slotClaimFeedback };
  for (const k of knownVehicleKeys(realFacts, args.identities, args.ctx.state)) {
    if (composed.text.includes(k)) return { ok: false, feedback: `Você escreveu a chave interna do veículo ("${k}") na resposta. Use o NOME do carro (marca modelo ano), NUNCA a chave/código interno.` };
  }
  // Valida contra fatos REAIS (identidade de memória NÃO aterra atributo/oferta).
  // Validate against the same structured facts used by the renderer. The last
  // rendered offer is accepted conversation data, not free-form memory. Rules
  // requiring a query in the current turn still use realFacts above.
  // ⭐RD1-2: em central_active as POL lexicais/comerciais (telefone, perguntas, reask, CPF-timing e leitura de
  // afirmações em prosa) NÃO negam. Só referências estruturadas e limites operacionais objetivos permanecem hard.
  const gv = PolicyEngine.validateResponse(composed, renderFacts, decision0, args.ctx, authorityMode);
  if (hasDeny(gv)) return { ok: false, feedback: args.selectionTurn ? SELECTION_ATTR_FEEDBACK : sanitizePolicyFeedback(gv, authorityMode) };
  // RD1-2: o "gancho SDR" após institucional pertence ao prompt do portal; guarda legada só no replay.
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
  // RD1-2: a forma da DESPEDIDA e qualquer menção textual de transferência pertencem ao prompt do portal e à LLM;
  // esta guarda lexical existe somente no replay legado. No ativo, apenas o efeito handoff estruturado é validado.
  if (applyLegacyStyleGuards && args.disengagementOnly && (hasQuestion(composed.text) || promisesHumanHandoff(composed.text)
      || asksLeadName(composed.text) || asksLeadSurname(composed.text))) {
    if (process.env.PEDRO_V3_DENY_DEBUG) console.error(`[DENY_DEBUG_DISENGAGEMENT_TEXT] ${composed.text.slice(0, 500)}`);
    return { ok: false, feedback: "DESPEDIDA: o cliente apenas agradeceu/encerrou e NÃO fez um novo pedido. Não reabra qualificação, não faça pergunta e não repita transferência. Reescreva você mesmo uma despedida curta e cordial, deixando a loja à disposição. Se o bloco também trouxesse um pedido novo, ele teria prioridade — não é o caso deste turno." };
  }
  // Missão P0 INC2/F: NUNCA peça SOBRENOME / nome completo — o primeiro nome basta e só mais adiante. deny SEMPRE (o carro
  // é o assunto, não cadastro). O cérebro RE-AUTORA avançando a intenção comercial.
  // RD1-2: pedir ou não sobrenome é decisão do prompt do portal; guarda legada só no replay.
  if (applyLegacyStyleGuards && asksLeadSurname(composed.text)) {
    return { ok: false, feedback: "NÃO peça sobrenome nem nome completo — nunca nessa fase; o primeiro nome já basta. Em vez de coletar cadastro, avance a conversa: pergunte o que ele procura, ofereça opções, ou trate condições/visita." };
  }
  // PARTE A (missão abertura SDR) + Missão P0 INC2/F: NÃO peça o NOME antes de haver intenção comercial — abertura sem alvo
  // (1º contato/anúncio genérico) OU ainda sem NENHUM contexto comercial (sem interesse/tipo/faixa, sem carro ofertado/
  // selecionado). Se pediu nome sem descoberta (e sem listar/enviar carro) -> deny + feedback (o cérebro RE-AUTORA). INC2:
  // "Sim, conheço" não deve virar pedido de nome. Telefone já é barrado por POL-PHONE-KNOWN.
  // RD1-2: a ordem entre descoberta e nome vem do prompt do portal; guardas legadas só no replay.
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
  // memória tipada do turno); guardas legadas só no replay.
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
  // RD1-2: a condução de pagamento vem do prompt do portal e da LLM; guarda legada só no replay.
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
  // RD1-2: o anúncio chega como identidade factual; a forma de conduzir vem do prompt do portal. Guarda legada só no replay.
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
  if (applyLegacyStyleGuards && args.searchExpectedThisTurn
      && !args.facts.some((f) => f.ok && f.tool === "stock_search")
      && !proposedEffects.some((e) => e.kind === "send_media")
      && textPromisesSearch(composed.text)) {
    return { ok: false, feedback: "Você PROMETEU buscar mas NÃO chamou stock_search neste turno. Você já tem filtro suficiente — chame stock_search AGORA (com marca/modelo/tipo/preço/câmbio que o cliente informou) e responda com a lista no MESMO turno. NUNCA diga 'vou buscar/procurar/verificar' sem executar a busca antes." };
  }
  // COMPLETUDE (prompt-first): a resposta não pode IGNORAR um pedido explícito (horário/endereço/unidade/foto). Grounding
  // ok mas pediu horário e respondeu só endereço -> feedback ao MESMO cérebro (retry). Não reescreve, não decide o assunto.
  // P0 (RESOLUÇÃO ÚNICA): foto pedida = semântica do cérebro OU ordinal resolvido + pedido explícito ("foto do segundo").
  // Sem isto, quando o cérebro rotula "foto do segundo" só como seleção, ele podia ignorar a foto e passar batido.
  const incomplete = turnCompletenessFeedback({
    authorityMode,
    leadMessage: args.leadMessage,
    composed,
    institutionalObs: args.institutionalObs ?? new Map(),
    proposedEffects,
    // Em llmFirst, a semântica aceita do bloco atual vence um objetivo antigo.
    // Quando a própria LLM declarou send_photos, o objetivo pendente não
    // pode tornar opcional justamente a completude desse pedido. Replay legado
    // não possui essa autoridade semântica e preserva o contrato anterior.
    pendingObjective: args.ctx.state.currentObjective?.status === "pending"
      && !(args.requireBrain && (photoCapabilityDeclaredNow || photoIntentDeclaredNow)),
    photoRequested: args.requireBrain
      ? photoCapabilityDeclaredNow
      : photoAuthorized || authorizesPhotoByResolvedTarget(args.target, args.leadMessage, args.ctx.state, args.photoVU) || leadRequestsPhoto(args.leadMessage),
    photoIntentDeclared: photoIntentDeclaredNow,
    photoTargetKind: args.target.kind,
    // `selected_vehicle` sem seleção inequívoca diante de uma lista com
    // 2+ itens é uma ambiguidade estrutural, ainda que o resolvedor termine
    // em `none` por não haver ordinal/modelo no bloco. Repetir stock_search
    // não escolhe qual unidade o lead quis; somente a conversa pode fazê-lo.
    photoTargetAmbiguous: args.target.kind === "ambiguous"
      || (args.target.kind === "none"
        && args.photoVU?.understanding.subject === "selected_vehicle"
        && (args.ctx.state.lastRenderedOfferContext?.items.length ?? 0) > 1),
    photoTargetResolved: args.target.kind === "resolved",
    photoLookupStatus: photoLookupStatus(args.facts, args.target),
    adVehicleIdentity: args.adVehicleIdentity ?? null,
  });
  if (incomplete) return { ok: false, feedback: incomplete };
  // ⭐A GUARDA DE PROMESSA FOI REMOVIDA (decisão do dono + auditoria, 25/07). Ela lia a FRASE do agente para decidir
  // se havia promessa — e o falso positivo "esse Compass vai CHAMAR A ATENÇÃO" provou que esse caminho exige exceção
  // atrás de exceção. Interpretar linguagem comercial DEPOIS da LLM, para decidir se o engine gostou da resposta, é
  // exatamente o engessamento que o v3 existe para não repetir.
  // O limite operacional chega ANTES da geração, como capability tipada em `operationalContext`: a LLM sabe
  // o que o turno executa e que não existe tarefa individual de callback/verificação posterior. A cadência
  // T1/T2/T3 é independente e não cumpre uma promessa feita neste turno. A LLM decide o desfecho.
  // `future-commitment.ts` continua existindo, mas só para TELEMETRIA e avaliação offline.
  // ⭐RD1-2 (Codex): a ANTI-REPETIÇÃO comercial deixou de ser deny no central_active; a LLM recebe memória tipada e
  // decide como usar o que já sabe. Não há mais deny de repetição no
  // central_active; a LLM conduz a conversa seguindo o prompt do portal. (Guarda no legado:
  // o replay não precisa dela — o contrato antigo não a exercitava fora de requireBrain.)
  return { ok: true, decision: decision0, composed, proposedEffects };
}

// `understanding` é metadado semântico auxiliar, não uma segunda autorização
// da resposta. Se o metadado do MESMO final não for confiável, preservamos o
// texto e os efeitos (que possuem validadores factuais próprios), mas descartamos
// mutações de memória/estado e lacunas derivadas dele. Assim um rótulo ruim não
// derruba a conversa nem contamina o turno seguinte.
function withoutUntrustedSemanticPayload(decision: AgentBrainDecision): AgentBrainDecision {
  if (decision.memoryMutations.length === 0
      && (decision.stateMutations?.length ?? 0) === 0
      && (decision.knowledgeGaps?.length ?? 0) === 0) return decision;
  return {
    ...decision,
    memoryMutations: [],
    stateMutations: [],
    knowledgeGaps: [],
  };
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
// SÓ ENVIO ATIVO/promessa assertiva de foto — NUNCA uma OFERTA interrogativa ("quer que eu te envie
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
// O texto nunca prova a ausência de fotos. A prova vem exclusivamente do
// resultado de `vehicle_photos_resolve` para o alvo resolvido neste turno.
// Isso impede que uma frase plausível como "não tenho fotos" esconda uma
// consulta que a LLM deixou de fazer.
type PhotoLookupStatus = "not_queried" | "available" | "empty" | "failed";
function photoLookupStatus(facts: readonly QueryResult[], target: TargetResolution): PhotoLookupStatus {
  if (target.kind !== "resolved") return "not_queried";
  const result = [...facts].reverse().find(
    (fact): fact is Extract<QueryResult, { tool: "vehicle_photos_resolve" }> => (
      fact.tool === "vehicle_photos_resolve"
      && (!fact.ok || fact.data.vehicleKey === target.vehicleKey)
    ),
  );
  if (!result) return "not_queried";
  if (!result.ok) return "failed";
  return result.data.photoIds.length > 0 ? "available" : "empty";
}
// Promessa operacional de terceiros sem efeito real no mesmo turno. O agente
// pode dizer que enviou fotos somente quando o plano contém send_media; não
// pode deslocar a execução para uma equipe futura e deixar o lead no vácuo.
// Isto é validação factual da autoria da LLM, não escolha de assunto nem texto
// de recuperação produzido pela engine.
const PHOTO_EXTERNAL_PROMISE_RX = /\b(?:vou|irei|vamos)\b[^.?!]{0,100}\b(?:pedir|solicitar|confirmar|verificar)\b[^.?!]{0,100}\b(?:equipe|consultor|vendedor|time)\b[^.?!]{0,80}\b(?:enviar|mandar)\b|\b(?:equipe|consultor|vendedor|time)\b[^.?!]{0,70}\b(?:vai|ira)\b[^.?!]{0,40}\b(?:enviar|mandar)\b/;
const PHOTO_ORDINAL_CLARIFY_RX = /\b(?:qual|quais|numero|n[uú]mero|op[cç][aã]o|item|lista|primeir|segund|terceir|quart|quint)\b/;
function photoOperationalPostcondition(args: {
  readonly pendingObjective: boolean;
  readonly photoRequested: boolean;
  readonly photoIntentDeclared: boolean;
  readonly photoTargetKind: TargetResolution["kind"];
  readonly photoTargetAmbiguous: boolean;
  readonly photoTargetResolved: boolean;
  readonly photoLookupStatus: PhotoLookupStatus;
  readonly proposedEffects: readonly ProposedEffectPlan[];
  readonly adVehicleIdentity?: string | null;
}): string | null {
  const sentMedia = args.proposedEffects.some((effect) => effect.kind === "send_media");
  const currentPhotoAct = args.photoIntentDeclared || args.photoRequested;

  // `send_media` já atravessou `groundProposedMediaEffects` antes desta
  // pós-condição. Essa é a autoridade factual única: a mesma vehicleKey precisa
  // ter um resultado inequívoco de vehicle_photos_resolve, fotos não vazias e
  // snapshot coerente. Revalidar o efeito pelo alvo conversacional criava uma
  // segunda autoridade e bloqueava mídia correta quando a lista anterior tinha
  // alternativas. A LLM escolhe a chave; o grounding factual valida e encerra.
  if (sentMedia) {
    return null;
  }

  // Um objetivo antigo não obriga uma nova ação. Porém, quando a própria LLM
  // reconheceu request_photos no bloco atual, esse ato atual vence a memória e
  // precisa terminar de modo coerente com os fatos do turno.
  if ((args.pendingObjective && !args.photoIntentDeclared) || !currentPhotoAct) return null;

  // Ambiguidade real admite esclarecimento. A engine não escolhe um veículo e
  // não força uma consulta incapaz de resolver a escolha do lead.
  if (args.photoTargetAmbiguous || args.photoTargetKind === "conflict") return null;
  if (!args.photoTargetResolved) {
    if (!args.adVehicleIdentity) return null;
    return `O understanding reconheceu request_photos para o anúncio "${args.adVehicleIdentity}", mas ainda não existe uma vehicleKey inequívoca e aterrada. Para atender o pedido, use stock_search com a identidade atual do anúncio; se a identidade realmente for insuficiente, esclareça o alvo sem afirmar envio ou indisponibilidade.`;
  }
  if (args.photoLookupStatus === "not_queried") {
    return "O understanding reconheceu request_photos para um veículo resolvido, mas vehicle_photos_resolve ainda não foi executada neste turno. Consulte a tool com a vehicleKey aterrada antes do FINAL; se o pedido foi classificado incorretamente, corrija o understanding sem prometer envio.";
  }
  if (args.photoLookupStatus === "available") {
    return "vehicle_photos_resolve retornou fotos para o pedido atual, mas o FINAL não materializou send_media. Inclua send_media para a mesma vehicleKey ou corrija o understanding se não se tratava de um pedido de fotos; não afirme envio sem o efeito.";
  }
  // `empty` e `failed` são resultados reais. A LLM continua autora da resposta
  // honesta; a engine não escolhe nem redige o que dizer.
  return null;
}
function turnCompletenessFeedback(args: {
  readonly authorityMode: ResponseAuthorityMode;
  readonly leadMessage: string;
  readonly composed: RenderedResponse;
  readonly institutionalObs: ReadonlyMap<BusinessInfoTopic, AgentToolObservation>;
  readonly proposedEffects: readonly ProposedEffectPlan[];
  readonly pendingObjective: boolean;   // objetivo antigo ainda aplicável; request_photos aceito no bloco atual sempre vence
  readonly photoRequested: boolean;     // T2 (fonte única): o turno autoriza foto pela semântica (não regex de frase)
  readonly photoIntentDeclared: boolean; // ato atual autorado: request_photos exige cadeia factual ou esclarecimento real
  readonly photoTargetKind: TargetResolution["kind"];
  readonly photoTargetAmbiguous: boolean;
  readonly photoTargetResolved: boolean;
  readonly photoLookupStatus: PhotoLookupStatus;
  readonly adVehicleIdentity?: string | null;
}): string | null {
  const authority = responseAuthorityProfile(args.authorityMode);
  const photoOperationalFeedback = photoOperationalPostcondition(args);
  if (photoOperationalFeedback) return photoOperationalFeedback;
  // No fluxo ativo, completude conversacional e escolha de tool pertencem à
  // LLM. O pós-requisito estrutural acima só valida a capability send_photos
  // que ela própria declarou necessária agora; abaixo dele não existe segunda
  // autorização por texto.
  if (!authority.conversationalTextVeto) return null;
  const normResp = normalizeText(args.composed.text);
  // Institucional: cada tópico PEDIDO tem que aparecer na resposta (valor ou ausência honesta), senão foi ignorado.
  if (authority.conversationalTextVeto) {
    for (const topic of institutionalTopicsRequested(args.leadMessage)) {
      if (respondsInstitutionalTopic(normResp, topic, args.institutionalObs.get(topic))) continue;
      return `O cliente pediu ${INST_TOPIC_LABEL[topic]} NESTE turno e a sua resposta não trouxe isso (respondeu outro assunto no lugar). Responda ${INST_TOPIC_LABEL[topic]} usando o dado do seu prompt/tenant_business_info — ou, se realmente não houver, diga honestamente que não tem essa informação. Se ele pediu MAIS de uma coisa no mesmo turno (ex.: horário E foto), responda TODAS, não só uma.`;
    }
  }
  // Foto: a LLM escolhe a tool e autora a resposta. A engine somente valida
  // fatos e efeitos: sem consulta não há base para afirmar ausência; havendo
  // fotos, o efeito send_media precisa estar no mesmo turno. Resultado vazio
  // ou falha real ficam disponíveis para a LLM responder com honestidade.
  // CEDE quando há objetivo PENDENTE: uma policy de prioridade (ex.: POL-TRACK-001, responder pagamento não vira foto)
  // pode ter legitimamente redirecionado o turno — não reexigir a foto que a policy acabou de barrar.
  const sentMedia = args.proposedEffects.some((e) => e.kind === "send_media");
  if (!args.pendingObjective && args.photoRequested && !sentMedia) {
    if (authority.conversationalTextVeto && PHOTO_EXTERNAL_PROMISE_RX.test(normResp)) {
      return "O cliente pediu FOTO neste turno, mas a resposta prometeu que uma equipe/consultor enviaria depois. Essa promessa não é um efeito executável: chame vehicle_photos_resolve para o carro certo e, se houver fotos, inclua send_media com os photoIds no mesmo turno. NÃO prometa envio futuro.";
    }
    if (!args.photoTargetResolved) {
      if (!authority.conversationalTextVeto) return null;
      if (PHOTO_ORDINAL_CLARIFY_RX.test(normResp)) return null;
      return "O cliente pediu FOTO, mas o veículo ainda não está resolvido de forma inequívoca. Pergunte qual carro ele quer ver; não escolha uma opção por conta própria e não afirme que as fotos estão indisponíveis.";
    }
    if (args.photoLookupStatus === "not_queried") {
      return "O cliente pediu FOTO de um veículo já resolvido, mas vehicle_photos_resolve ainda não foi consultada neste turno. Chame essa tool com a vehicleKey do alvo e responda usando o resultado real; não afirme ausência sem consultar.";
    }
    if (args.photoLookupStatus === "available") {
      return "vehicle_photos_resolve encontrou fotos do veículo pedido. Inclua send_media com a mesma vehicleKey e os photoIds retornados no mesmo turno; não diga que as fotos estão indisponíveis.";
    }
    // `empty` e `failed` são fatos reais observáveis. A LLM continua dona do
    // texto e pode explicar a indisponibilidade sem a engine redigir por ela.
    return null;
  }
  if (authority.conversationalTextVeto
      && !args.pendingObjective
      && args.photoRequested
      && parseOrdinal(args.leadMessage) != null
      && !args.proposedEffects.some((e) => e.kind === "send_media")
      && !PHOTO_ORDINAL_CLARIFY_RX.test(normResp)) {
    return "O cliente pediu FOTO por uma referencia ordinal (ex.: primeiro/segundo/item 2), mas nao ha item resolvido para enviar. Responda explicitamente que nao ha uma lista/item ordinal valido neste contexto OU pergunte qual carro ele quer, mencionando o ordinal/lista. Nao repita apenas a busca anterior.";
  }
  return null;
}

// ╔══════════════════════════════════════════════════════════════════════════════════════════════════════════════╗
// ║ F7-6 — LEGACY REPLAY-ONLY: AUTORIA COMERCIAL DETERMINÍSTICA (foto / institucional / desengajamento / mais-      ║
// ║ opções / recuperação / recall). ⚠️ NUNCA roda em produção (central_active/central_shadow, llmFirst=true).       ║
// ║ Só é alcançada quando `legacyReplayEnabled` (opt-in `legacyCommercialReplay=true` em harness de replay/offline). ║
// ║ Fonte da política + invariantes fail-closed: src/engine/legacy/legacy-replay.ts. Cada função abaixo produz um    ║
// ║ responseSource deterministic_*, bloqueado pela invariante de saída em qualquer modo de produção. Relocação      ║
// ║ física destes corpos p/ o módulo legacy/ é follow-up cosmético (o isolamento comportamental já é definitivo).   ║
// ╚══════════════════════════════════════════════════════════════════════════════════════════════════════════════╝

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
    marca: s(input.marca), modelo: s(input.modelo), modelos: arr(input.modelos), tipo: s(input.tipo),
    precoMax: typeof input.precoMax === "number" ? input.precoMax : null,
    precoMin: typeof input.precoMin === "number" ? input.precoMin : null,
    cambio: s(input.cambio), combustivel: s(input.combustivel), anos: arr(input.anos), popular: input.popular === true,
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
const HANDOFF_PROMISE_VERB_RX = /\b(?:chamar|chamo|chamando|acionar|aciono|encaminh\w*|transferir|transfiro|direcionar|direciono|repassar|repasso)\b|\bpassar\s+(?:(?:seu|o\s+seu|teu|o)\s+(?:contato|numero)|(?:essas?|as|os)\s+(?:informacoes|dados|condicoes))\b|\bvai\s+(?:te\s+)?(?:atender|chamar|entrar\s+em\s+contato)\b|\bentrar[a]?\s+em\s+contato\b/;
export function promisesHumanHandoff(text: string): boolean {
  for (const sentence of text.split(/(?<=[.!?\n])/)) {
    const n = normalizeText(sentence);
    if (HANDOFF_PERSON_RX.test(n) && HANDOFF_PROMISE_VERB_RX.test(n)) return true;
  }
  return false;
}
const VISIT_SCHEDULED_PROMISE_RX = /\b(?:vou|irei)\s+agendar\s+(?:a\s+|sua\s+)?visita\b|\b(?:agendei|marquei)\s+(?:a\s+|sua\s+)?visita\b|\bagendo\s+(?:a\s+|sua\s+)?visita\b|\b(?:visita|horario)\b.{0,20}\b(?:esta|ficou|foi)\s+(?:agendad[oa]|marcad[oa]|confirmad[oa])\b|\bvisita\s+(?:ja\s+)?(?:agendad[oa]|marcad[oa]|confirmad[oa])\b|\b(?:anotei|registrei|reservei|confirmei)\s+(?:a\s+|sua\s+)?visita\b|\bvisita\s+anotad[oa]\b/;
// ⭐P0-B: a alternativa SOLTA `(esta|ficou) anotad[oa]` foi REMOVIDA. Ela capturava o ACOLHIMENTO de uma preferência de
// dia/horário ("amanhã de manhã está anotado"), que por contrato NÃO exige efeito nenhum — o resultado era um deny sem
// saída num turno legítimo. O detector agora mira só a AFIRMAÇÃO de visita confirmada/agendada (inclusive "visita
// anotada", que segue coberta acima).
export function promisesVisitScheduled(text: string): boolean {
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
    // F2.76 def#2: turno com CANDIDATO DE FAMÍLIA (versão exata ausente, modelo-base existe) — NUNCA afirmar ausência.
    const hasGroundableFamily = factsArr.some((f) => f.ok && f.tool === "stock_search" && f.data.items.length === 0 && (f.data.familyCandidates?.length ?? 0) > 0);
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
    // ⭐F2.76 def#2 + LLM-first (regra P0 do dono): com CANDIDATO DE FAMÍLIA o engine NÃO afirma ausência E NÃO escreve
    // prosa comercial sobre o candidato — APRESENTAR o candidato é ato exclusivo da LLM (ela decide e confirma a versão).
    // Aqui só SUPRIMIMOS a afirmação de vazio; sem autoria da LLM o turno cai na degradação observável genérica do fim
    // desta função (technical_fallback), que não promete retorno nem inventa oferta.
    if (stockRanOk && !hasGroundableFamily) return plain(emptySearchConductingText(desc), "clarify", "recovery_stock_empty", "busca executada com 0 itens -> honesto nomeando o filtro + condução específica (ampliar faixa / outro modelo-tipo)");
    if (stockFailed) return plain("Tive uma instabilidade pra puxar o estoque agora. Me confirma o modelo que você procura que eu já verifico?", "clarify", "recovery_stock_failed", "tool de busca falhou -> indisponibilidade temporária");
    if (!hasGroundableFamily) return plain("Qual modelo ou tipo de carro você procura? Já busco no nosso estoque pra você.", "clarify", "recovery_stock_not_run", "nenhuma busca executada -> não afirma ausência, pergunta específica");
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
  // CENTRAL_ACTIVE AUTHORITY BOUNDARY:
  // the portal prompt owns commercial conduction, funnel questions and qualification.
  // Keep the configured SDR policy available only to the legacy/replay path, where it
  // is part of the old deterministic objective bookkeeping. In llmFirst, the engine
  // may validate factual safety and effect executability, but must not turn portal
  // policy into an extra question, objective, or handoff decision.
  const engineSdrPolicy = args.llmFirst === true ? undefined : sdrPolicy;

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
      // F7-6: ramo LEGADO de autoria comercial determinística SÓ roda sob opt-in explícito de replay/offline.
      // Produção (central_active/central_shadow, ambos llmFirst=true) nunca liga a flag -> legacyReplayEnabled=false.
      const legacyCommercialReplay = args.legacyCommercialReplay ?? false;
      assertReplayWiring(llmFirst, legacyCommercialReplay);   // fiação: llmFirst + replay é bug de composição (falha alto)
      const legacyReplayEnabled = isLegacyReplayEnabled(llmFirst, legacyCommercialReplay);
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
      // Identity declared by the ad and exact proof are separate from "this vehicle exists". Old states without a
      // typed proof remain unknown; a rendered family candidate can never silently become the advertised trim.
      // The tenant catalog complements the finite market taxonomy. Without
      // this structured fallback, a catalogued model unknown to the taxonomy
      // could be found repeatedly by stock_search but never become the exact
      // ad target, trapping photo/detail turns in a grounding retry loop.
      const adIdentityTarget = llmFirst ? buildAdIdentityTarget(effectiveAdContext, adConstraints) : null;
      // The ad declaration is a weaker, independent authority: it lets the LLM name exactly what the structured
      // ad payload named even when a finite taxonomy does not know that model. It never confirms stock or attributes.
      const adDeclaredIdentity = llmFirst ? buildAdDeclaredVehicleIdentity(effectiveAdContext) : null;
      const currentAdFingerprint = adFingerprintOf({ adId: effectiveAdContext?.adId ?? null, identity: adIdentityTarget?.identity ?? null });
      const carriedAdProof = carryForwardProof(contextState.adIdentityProof ?? null, currentAdFingerprint);
      const initialGroundedKeys = [...new Set([
        ...(contextState.groundedVehicles ?? []).map((it) => it.vehicleKey),
        ...(contextState.lastRenderedOfferContext?.items ?? []).map((it) => it.vehicleKey),
      ])];
      const initialAdConfirmation = resolveAdConfirmation({
        proof: carriedAdProof,
        groundedKeys: initialGroundedKeys,
      });
      const adReferenceKey = initialAdConfirmation.vehicleKey;
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
      let frame = buildTurnFrame({ turnId, now: cutoff, block: leadMessage, portalPromptSha256, workingMemory: wmForFrame, interpretation: prepared.interpretation, state: contextState, currentTurnFacts, extractedSlotMutations: extractedSlots, currentTurnIntent, adVehicleHint, adImageUrls: effectiveAdContext?.imageUrls ?? [], adGenericEntry: isOpeningTurn && adGenericEntry, firstContactNoCommercialTarget, specificAdEntry, disengagementOnly: llmFirst ? false : disengagedActionable, acceptedPhotoOffer: acceptsAgentPhotoOffer(leadMessage, contextState), selectedOfferThisTurn: false, handoffAvailable: handoffCapabilityAvailable, catalog: prepared.tenantCatalog });
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
      // ⭐CONTEXTO OPERACIONAL VERIFICADO, RECALCULADO A CADA PASSO (25/07). O frame base é montado ANTES do loop;
      // se ele carregasse o contexto congelado, o passo seguinte a uma busca continuaria afirmando que o estoque
      // não foi consultado — mentira estrutural. Aqui é DADO tipado (ver `operational-context.ts`): estado da
      // consulta, capacidades reais e o que o anúncio declarou. Nenhuma instrução: a LLM lê e decide.
      const executionFailures: string[] = [];   // só EXECUÇÃO real que falhou — nunca rejeição de controle do engine
      // ⭐AUTORIDADE ÚNICA DE GROUNDING do frame: ofertas estruturadas anteriores + items E familyCandidates de TODAS
      // as stock_search ok do turno + vehicle_details + vehicle_photos_resolve. UM conjunto só, usado tanto para
      // RESOLVER a chave do anúncio quanto para CONFIRMAR a disponibilidade. Antes eram duas montagens diferentes:
      // a segunda busca do turno apagava uma confirmação verdadeira e a oferta do turno anterior nem contava.
      const groundedFleet = (): GroundedVehicleRef[] => buildGroundedFleet({
        previousGroundedVehicles: contextState.groundedVehicles ?? [],
        previousOfferItems: contextState.lastRenderedOfferContext?.items ?? [],
        facts,
      });
      const adProofNow = (): AdIdentityProof | null => {
        const evaluation = evaluateAdIdentityProof({ target: adIdentityTarget, adFingerprint: currentAdFingerprint, facts });
        // No ad-targeted stock observation in this turn preserves a valid proof for the same ad. A fresh targeted
        // result (including none/ambiguous/family-only) is newer evidence and therefore replaces or invalidates it.
        return evaluation.status === "not_observed" ? carriedAdProof : evaluation.proof;
      };
      const adConfirmationNow = () => resolveAdConfirmation({
        proof: adProofNow(),
        groundedKeys: groundedFleet().map((v) => v.vehicleKey),
      });
      const frameNow = (): TurnFrame => {
        const fleet = groundedFleet();
        const adConfirmation = resolveAdConfirmation({ proof: adProofNow(), groundedKeys: fleet.map((v) => v.vehicleKey) });
        return {
        ...frame,
        operationalContext: buildOperationalContext({
          facts,
          executionFailures,
          groundedVehicleKeys: fleet.map((v) => v.vehicleKey),
          searchMemory: {
            activeFilters: contextState.activeSearchConstraints ?? {},
            shownVehicleKeys,
          },
          capabilities: {
            sendMessage: true,
            // ⚠️`ProviderCapability` (idempotent|queryable|none) descreve RECONCILIAÇÃO, não disponibilidade — em
            // produção o root passa "none" e a mídia SAI do mesmo jeito. Usá-la aqui dizia `sendMedia:false` para
            // agentes que enviam foto, e a LLM deixaria de mandar por acreditar num fato falso. A disponibilidade é
            // OPERACIONAL e vem do root (rota de mídia + infra de fotos), cruzada com a tool permitida ao perfil.
            // Ausente = null (desconhecido): nunca `false` presumido.
            sendMedia: deriveSendMediaAvailability({
              mediaDeliveryAvailable: args.mediaDeliveryAvailable,
              photosToolAllowed: allowed.has("vehicle_photos_resolve"),
            }),
            handoff: handoffCapabilityAvailable,
            // Valor REAL da configuração do tenant; `null` = não informado a este turno (nunca presumir false).
            automatedLeadFollowupEnabled: args.automatedLeadFollowupEnabled ?? null,
          },
          ad: {
            identity: adDeclaredIdentity?.label ?? adIdentityTarget?.identity ?? adVehicleHint ?? null,
            confidence: effectiveAdContext?.confidence ?? null,
            referenceKey: adConfirmation.vehicleKey,
          },
          // Projeta exatamente a mesma resolucao canonica usada pelas guardas
          // de detalhe e midia. Este eixo responde "qual veiculo e o alvo
          // inequivoco do bloco?"; ele nao promove nem substitui a prova
          // estrita da versao anunciada (`ad.inventoryConfirmed`).
          target: projectTargetResolution(resolveTargetWithAd()),
        }),
        };
      };
      let finalDecision: AgentBrainDecision | null = null;
      let brainSteps = 0;
      // AUTORIA ÚNICA (audit): singleAuthor/llmFirst já declarados acima (perto do currentTurnIntent) p/ o gate do filtro comercial.
      const identities = buildRememberedIdentities(contextState); // identidade LEMBRADA (marca/modelo/ano) — só p/ NOMEAR
      // P0-sel (missão): o lead está SELECIONANDO um veículo da última lista/foco ("gostei do segundo", "esse", ordinal)?
      // Numa seleção o cérebro pode dar um final NATURAL sem vehicle_details (citar atributo é barrado no validate, com
      // feedback específico "acolha a escolha, não cite atributo sem vehicle_details").
      // Label ATERRADO do carro escolhido (do offer context) — vai no FEEDBACK à LLM (fato), NUNCA numa resposta escrita pelo engine.
      const authoringContext = (): TurnContext => ({
        ...ctx,
        state: contextState,
        acceptedPrimaryIntent: (llmFirst && brainVU()) ? brainVU()!.understanding.primaryIntent : undefined,
        declaredVehicleIdentities: adDeclaredIdentity ? [adDeclaredIdentity] : undefined,
      });
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
      // Understanding é metadado auxiliar da autoria, não a própria resposta.
      // Metadado inválido é descartado sem virar deny; fatos, referências e
      // efeitos continuam passando por seus validadores objetivos.
      let understandingMetadataDropped = 0;
      const understandingMetadataDropIssues: string[] = [];
      const noteUnderstandingMetadataDrop = (stage: "proposal" | "final_authorship", validation: ValidatedUnderstanding): void => {
        understandingMetadataDropped += 1;
        const semanticIssues = validation.semanticIssues ?? [];
        const issues = semanticIssues.length > 0
          ? semanticIssues
          : ["understanding sem evidencia valida no bloco atual"];
        for (const issue of issues) {
          if (understandingMetadataDropIssues.length >= 6) break;
          understandingMetadataDropIssues.push(`${stage}: ${issue}`.slice(0, 180));
        }
      };
      // ⭐FASE 1 (diagnóstico observável): distingue a CAUSA de uma degradação de fallback. Falha REAL de provedor
      // (HTTP/timeout/JSON/shape) chega de dois jeitos: (a) o adapter captura e devolve um final marcado
      // reasonCode="brain_fallback" (#safeFinal), (b) withTimeout estoura e o loop faz catch{break}. Ambos setam
      // providerFallbackSeen — o motivo já é sanitizado no adapter (≤120 chars, sem prompt/PII). Isso separa
      // "provedor caiu" de "resposta válida rejeitada por política/grounding/evidência" no relatório do turno.
      let providerFallbackSeen = false;
      let providerFallbackReason: string | null = null;
      const noteBrainStep = (s: AgentBrainStep): AgentBrainStep => {
        if (s.kind === "final" && s.decision.reasonCode === "brain_fallback") {
          providerFallbackSeen = true;
          providerFallbackReason = s.decision.reasonSummary?.slice(0, 120) ?? "brain_fallback";
        }
        return s;
      };
      // O understanding confiável alimenta memória e telemetria. Ele não é
      // pré-condição duplicada para uma tool ou efeito escolhido pela LLM:
      // essas operações têm autoridade e validação factuais próprias.
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
        // ⭐P0-A: assunto comercial ESTRUTURADO ativo (veículo selecionado / oferta renderizada / veículo do anúncio).
        // Dá sentido comercial a um horário no 1º pedido de visita ("Consigo ver amanhã de manhã?") SEM exigir que uma
        // visita já estivesse ativa. Só estado tipado — nenhuma palavra do bloco entra nesta decisão.
        commercialSubjectActive: hasActiveCommercialSubject({
          selectedVehicleKey: contextState.vehicleContext.selected?.key ?? null,
          renderedOfferCount: contextState.lastRenderedOfferContext?.items.length ?? 0,
          adVehicleKey: adConfirmationNow().vehicleKey ?? null,
        }),
        tenantPolicies: args.tenantPolicies,
      };
      const brainVU = (): ValidatedUnderstanding | null => (lockedU ? validateTurnUnderstanding(lockedU, leadMessage, true, turnValidationContext) : null);
      const trustedLockedUnderstanding = (): TurnUnderstanding | null => brainVU()?.trusted === true ? lockedU : null;
      const acceptedBrainPrimaryIntent = (): TurnUnderstanding["primaryIntent"] | null => {
        const validated = brainVU();
        return validated?.trusted === true ? validated.understanding.primaryIntent : null;
      };
      const authoritativeVU = (): ValidatedUnderstanding => brainVU() ?? validateTurnUnderstanding(fallbackUnderstanding, leadMessage, false, turnValidationContext);
      // ATO CONVERSACIONAL e NECESSIDADE FACTUAL são eixos independentes. A LLM pode selecionar um veículo, negociar,
      // tratar financiamento/troca ou reparar uma conversa e, no mesmo bloco, precisar confirmar preço/disponibilidade.
      // A engine não renomeia o ato: apenas valida capability + evidência literal e garante que o fato pedido seja obtido.
      const brainNeedsStockFact = (): boolean => isStockSearchTurn(brainVU());
      // ⭐F2.75 (incidente Icom anúncio Peugeot 2008 -> "todos os automáticos, do menor preço"): TROCA DE DIREÇÃO é
      // AUTORIDADE SEMÂNTICA da LLM (understanding.isTopicChange), NÃO heurística por filtro (não é "se mencionou câmbio").
      // Quando o lead AMPLIA/SUBSTITUI/REJEITA o alvo anterior, a busca parte SÓ dos critérios do BLOCO ATUAL
      // (currentConstraints) — o engine NÃO herda/injeta marca/modelo/tipo/ano/preço do anúncio/activeSearchConstraints
      // (enrichStockSearchCall só PREENCHE LACUNAS; passando o escopo do-turno, o valor antigo não reentra como fill).
      // Refinamento normal (isTopicChange=false, ex.: "até 60 mil") preserva o merge aditivo. isShortAffirmationBlock
      // impede que "isso"/"pode ser" marcado por engano zere o escopo. `broad` NÃO é reset — e desde a F2.76 ele é INERTE
      // na dimensão modelo (alternativas vêm de `modelos[]`; nunca reintroduzir OR-de-token).
      const topicChangeThisTurn = (): boolean => llmFirst && brainVU()?.understanding.isTopicChange === true && !isShortAffirmationBlock(leadMessage);
      // O extrator legado ainda encontra números, mas a função comercial do valor vem da LLM. Somente search_budget
      // limita estoque; proposta, entrada, parcela, renda, troca e financiamento permanecem fatos da negociação.
      // Metadado incompleto/inválido não derruba o turno e, nos adapters de produção, não autoriza teto lexical.
      const currentConstraintsForTurn = (): CommercialConstraints => applyMonetarySemanticsToCurrentConstraints(
        currentConstraints,
        leadMessage,
        brainVU()?.understanding,
      );
      const commercialConstraintsForTurn = (): CommercialConstraints => {
        const current = currentConstraintsForTurn();
        // Também saneia a base persistida quando ela contém exatamente o valor
        // que o bloco atual classificou como negociação. Isso cura estados já
        // contaminados sem apagar um orçamento anterior de valor diferente.
        const semanticBase = applyMonetarySemanticsToCurrentConstraints(
          searchBase,
          leadMessage,
          brainVU()?.understanding,
        );
        // A necessidade da tool não concede autoridade para herdar escopo.
        // Herança continua dependendo de contexto/filtro comercial validado;
        // caso contrário uma nova chamada proposta pela LLM seria contaminada
        // por marca/tipo/preço de uma busca anterior.
        const merged = (llmFirst && isSearchishTurn)
          ? mergeActiveConstraints(semanticBase, current, commercialCorrections)
          : current;
        const relaxed = (llmFirst && similarityTurn) ? relaxToSimilar(merged, !!current.cambio) : merged;
        return (adExactFocusTurn && (!relaxed.anos || relaxed.anos.length === 0))
          ? { ...relaxed, anos: [adFocus!.ano!] }
          : relaxed;
      };
      const searchScopeThisTurn = (): CommercialConstraints => topicChangeThisTurn()
        ? currentConstraintsForTurn()
        : commercialConstraintsForTurn();
      const effectiveSearchScopeThisTurn = (): CommercialConstraints => { const base = searchScopeThisTurn(); return sufficientForStockSearch(base) ? base : (moreOptionsDerivedScope ?? base); };
      // Observabilidade (contrato Codex #7): input PROPOSTO pela LLM vs EXECUTADO — prova que o engine não reinjetou filtro antigo.
      const stockProposedVsExecuted: Array<{ readonly proposed: unknown; readonly executed: unknown; readonly topicChange: boolean; readonly source: "brain_loop" }> = [];
      // ⭐AD-1: quem exige tenant_business_info é o ATO institucional declarado pela LLM (com evidência do bloco atual),
      // não o regex mentionsStore. No legado (!llmFirst) o sinal léxico continua valendo — nada muda lá.
      //
      // ⚠️ SATISFAZIBILIDADE (regressão pega pela F2.22 [G] "qual o instagram de vocês?"): o ato institucional SOZINHO
      // não basta para exigir a tool. tenant_business_info só atende três tópicos (address|hours|unit); "instagram",
      // "telefone", "whatsapp" são institucionais e NÃO têm tópico atendível. Exigir a tool ali recria exatamente o
      // pedido impossível que esta missão veio matar — a LLM não teria argumento válido para chamá-la.
      // Por isso o requisito exige DUAS coisas: AUTORIDADE (a LLM declarou o ato) E SATISFAZIBILIDADE (existe pelo menos
      // um tópico que a tool sabe responder). Sem tópico atendível, a LLM responde a ausência honestamente, sem tool.
      const brainStoreInfoAct = (): boolean => (llmFirst
        ? (isStoreInfoTurn(brainVU()) && institutionalTopicsRequested(leadMessage).length > 0)
        : frame.signals.mentionsStore === true);
      // Um ato conversacional só bloqueia a recuperação determinística de "mais opções" quando a própria LLM NÃO pediu
      // fato de estoque neste bloco. O rótulo do ato sozinho nunca cancela uma capability factual validada.
      const purelyConversationalActDeclared = (): boolean => lockedU != null && !brainNeedsStockFact()
        && (lockedU.primaryIntent === "conversation_repair" || lockedU.primaryIntent === "financing" || lockedU.primaryIntent === "trade_in" || lockedU.primaryIntent === "smalltalk");
      // key -> {marca,modelo} ESTRUTURADO (audit Codex P0): SÓ de fontes com modelo estruturado confiável — VehicleFact
      // (stock_search/vehicle_details), oferta e identidade. NUNCA `selected.label` (texto livre; não infere modelo
      // aproximado). A identidade do modelo é EXATA (catalog-utils.modelIdentityMatches), nunca substring.
      const buildKnownModels = (): Map<string, KnownVehicleModel> => {
        const m = new Map<string, KnownVehicleModel>();
        for (const f of facts) { if (!f.ok) continue; if (f.tool === "stock_search") for (const v of stockSearchGroundableVehicles(f.data)) m.set(v.vehicleKey, { marca: v.marca ?? null, modelo: v.modelo ?? null, ano: v.ano ?? null }); if (f.tool === "vehicle_details") m.set(f.data.vehicle.vehicleKey, { marca: f.data.vehicle.marca ?? null, modelo: f.data.vehicle.modelo ?? null, ano: f.data.vehicle.ano ?? null }); }
        for (const it of contextState.lastRenderedOfferContext?.items ?? []) m.set(it.vehicleKey, { marca: it.marca ?? null, modelo: it.modelo ?? null, ano: it.ano ?? null });
        for (const it of contextState.groundedVehicles ?? []) m.set(it.vehicleKey, { marca: it.marca ?? null, modelo: it.modelo ?? null, ano: it.ano ?? null });
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
        const currentAdReferenceKey = adConfirmationNow().vehicleKey;
        if (currentAdReferenceKey && !currentHasVehicle && ((baseSignals.mentionsPhoto === true && !isPhotoDeclined(leadMessage)) || pronounDetailTurn || refersToAd(leadMessage))) {
          return { kind: "resolved", vehicleKey: currentAdReferenceKey, source: "ad_reference", candidateVehicleKeys: [currentAdReferenceKey], subjectModel: adConstraints.modelos?.[0] ?? null };
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
      // Read-only portal fact: qualified_handoff is executable only after the
      // configured qualification view is complete. The LLM remains the sole
      // author of the decision and reply; this is only an effect-safety gate.
      const qualifiedHandoffReadyFor = engineSdrPolicy == null
        ? undefined
        : (primaryIntent: string | null): boolean => isSdrHandoffReadyForIntent(contextState, engineSdrPolicy, primaryIntent);
      const photoVU = (): ValidatedUnderstanding | null => (llmFirst ? brainVU() : authoritativeVU());
      const brainAuthorizesResolvedPhotoAct = (target: TargetResolution): boolean => {
        const v = photoVU();
        return v?.fromBrain === true
          && v.trusted
          && v.understanding.primaryIntent === "request_photos"
          && v.understanding.requestedCapabilities.includes("send_photos")
          && v.validEvidence.length > 0
          && authorizesPhotoByResolvedTarget(target, leadMessage, contextState, v);
      };
      const currentPhotoActAuthorized = (target: TargetResolution): boolean =>
        authorizesPhotoSend(photoVU(), leadMessage, requireBrain)
        || brainAuthorizesResolvedPhotoAct(target);
      const seenDenyFingerprints = new Set<string>();               // deny repetido -> recupera já (não gasta tentativas)
      let repeatedDeny = false;
      const seenToolSigs = new Set<string>();
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
      // Missão P0 (audit Codex smoke): CAP legado anti-loop de stock_search repetido. No central_active, a repetição
      // idempotente encerra a fase de tools imediatamente, sem deny e sem nova observação; a mesma LLM recebe a autoria
      // final com o resultado original ainda disponível. O contador abaixo existe apenas para replay legado.
      let dupStockLoopCount = 0;
      const DUP_STOCK_LOOP_CAP = 3;
      // ⭐AD-1: trava ÚNICA do requiredToolBeforeFinal, válida para TODAS as pernas (estoque, mais-opções, institucional).
      // Antes só a perna de estoque tinha contador; a institucional repetia até esgotar o turno inteiro.
      let requiredToolLoopCount = 0;
      const REQUIRED_TOOL_LOOP_CAP = 2;
      // ⭐AD-2: trava da guarda de proveniência de vehicleKey (chave inventada nunca vira loop infinito).
      let keyProvenanceLoopCount = 0;
      const KEY_PROVENANCE_LOOP_CAP = 2;
const PROVENANCE_RETRY_CAP = 2;   // ⭐SEM inv.1: retries bounded p/ evidence fora do bloco atual  // 1 busca real + até 2 nudges "finalize" antes de sair do loop (bound de custo/latência)
      // Missão P0 (audit Codex smoke real T7): MESMO cap para vehicle_details. "gostei do segundo" = SELEÇÃO; o cérebro às
      // vezes tenta vehicle_details sem ter a vehicleKey (a rejeição do gate não é execução) — sem cap loopava 6x → fallback.
      let dupDetailLoopCount = 0;
      // A resolução de fotos também é idempotente por (tool,args). Depois de uma consulta real, a LLM recebe o fato e deve
      // finalizar. Repetições viram feedback de resposta e têm teto, evitando gastar os 6 passos e cair em recovery.
      let dupPhotoLoopCount = 0;
      // ⭐F7-1 (Codex): dedup de EXECUÇÃO por tool+input p/ TODAS as tools, POR TURNO — o invariante "a mesma tool+input
      // nunca executa 2x no turno" fica garantido no chokepoint de EXECUÇÃO (não só na checagem de proposta). A 2ª chamada
      // idêntica devolve o FATO já obtido, sem tocar o adapter. stock_search mantém o fingerprint SEMÂNTICO (relaxamento);
      // as demais usam tool+input byte-exato. (tenant_business_info já é idempotente por tópico em resolveInstitutional.)
      const toolExecCache = new Map<string, QueryResult>();
      let duplicateToolCallsBlocked = 0;
      // ⭐F2.81 (prioridade 4): resultado indexado pela assinatura da chamada PROPOSTA (não da enriquecida) — é essa a
      // chave que a repetição do cérebro apresenta. Guarda sucesso E erro: reentregar um NOT_FOUND real é infinitamente
      // mais acionável do que um DUP_TOOL dizendo "use o fato" quando fato nenhum existe.
      const resultBySig = new Map<string, QueryResult>();
      let duplicateToolCallsServedFromCache = 0;
      let dupOtherLoopCount = 0;
      // A cache hit is not a new operational action: no adapter runs and no
      // fact is added. Keep `brainSteps` as the real LLM-call counter, but let
      // one idempotent reuse extend the tool window by one call. This prevents
      // a no-op at the boundary from pushing the LLM's next legitimate tool
      // into final authorship (where tools are closed). The credit is bounded
      // and does not choose what the next action will be.
      const IDEMPOTENT_REUSE_STEP_CREDIT_CAP = 1;
      let idempotentReuseStepCredits = 0;
      const grantIdempotentReuseStepCredit = (): void => {
        if (idempotentReuseStepCredits < IDEMPOTENT_REUSE_STEP_CREDIT_CAP) idempotentReuseStepCredits += 1;
      };
      // O reuso idempotente precisa produzir uma mudança de estado observável
      // para a LLM sem duplicar a observação canônica nem criar um deny. O
      // marcador vive por exatamente um passo do cérebro; depois é limpo.
      let lastToolReuse: NonNullable<TurnFrame["toolControl"]>["lastReuse"] = null;
      // A autoria final sempre teve duas chamadas extras, mas ambas fechavam
      // todas as tools. Isso criava uma armadilha: se a própria LLM percebesse
      // no primeiro desses passos que ainda faltava uma consulta legítima, a
      // engine recusava a decisão correta com FINAL_TOOL_FORBIDDEN. Reserve uma
      // dessas mesmas chamadas para conclusão ainda com a janela operacional
      // aberta. O orçamento total não aumenta (1 chamada aberta + 1 autoria
      // fechada substituem as 2 autorias fechadas), e nenhuma tool é escolhida
      // pela engine: allowlist, autoridade, policy e grounding seguem iguais.
      const OPEN_TOOL_COMPLETION_RESERVE = singleAuthor && llmFirst ? 1 : 0;
      const FINAL_AUTHORSHIP_RETRY_CAP = singleAuthor && llmFirst ? 1 : 2;
      const toolWindowLimit = (): number => (
        brainMaxSteps + idempotentReuseStepCredits + OPEN_TOOL_COMPLETION_RESERVE
      );
      const duplicateLoopReachedCap = (tool: CentralQueryCall["tool"]): boolean => {
        if (tool === "stock_search") return ++dupStockLoopCount >= 2;
        if (tool === "vehicle_details") return ++dupDetailLoopCount >= 2;
        if (tool === "vehicle_photos_resolve") return ++dupPhotoLoopCount >= 2;
        return ++dupOtherLoopCount >= 2;
      };
      const runQueryDedup = async (call: QueryCall): Promise<QueryResult> => {
        if (call.tool === "stock_search") {
          const fp = stockSearchFingerprint(call.input as Record<string, unknown>);
          const cached = stockSearchCache.get(fp);
          if (cached) { duplicateStockCallsBlocked += 1; return cached; }
          const res = await runQuery(call);
          stockSearchCache.set(fp, res);
          stockFingerprintsExecuted.push(fp);
          return res;
        }
        const sig = toolCallSignature(call as CentralQueryCall);
        const cached = toolExecCache.get(sig);
        if (cached) { duplicateToolCallsBlocked += 1; return cached; }
        const res = await runQuery(call);
        toolExecCache.set(sig, res);
        return res;
      };
      for (; brainSteps < toolWindowLimit(); brainSteps++) {
        let step;
        let stepUnderstandingTrusted = false;
        try {
          const currentFrame = {
            ...frameNow(),
            toolControl: { lastReuse: lastToolReuse },
          } satisfies TurnFrame;
          // `currentFrame` conserva o valor para esta chamada; a próxima só o
          // verá novamente se houver outro reuso real do cache.
          lastToolReuse = null;
          step = noteBrainStep(await withTimeout(brain.proposeNextStep(currentFrame, observations), limits.proposeTimeoutMs ?? 30_000, "propose: agent brain step exceeded timeout"));
        } catch (err) {
          // falha técnica do cérebro (timeout/transporte) -> sai do loop -> fallback seguro (nunca silêncio).
          // FASE 1: registra a causa de provedor sanitizada p/ o diagnóstico (não vira "resposta rejeitada por política").
          providerFallbackSeen = true;
          providerFallbackReason = providerFallbackReason ?? `brain propose timeout/transport: ${String((err as Error)?.message ?? err).slice(0, 80)}`;
          break;
        }
        // `understanding` descreve o ato, mas não é uma segunda autorização da
        // resposta/tool escolhida pela mesma LLM. Quando válido, alimenta
        // memória e telemetria; quando inválido, é descartado sem consumir um
        // retry. Tool, draft e efeitos seguem para seus validadores objetivos.
        if (step.understanding) {
          const previousTrustedUnderstanding = trustedLockedUnderstanding();
          const candidate = reconcileUnderstanding(previousTrustedUnderstanding, step.understanding, leadMessage, {
            acceptedPhotoOffer: acceptsAgentPhotoOffer(leadMessage, contextState),
            allowCurrentEvidenceCorrection: observations.some((observation) => observation.tool === "response" && !observation.ok),
          });
          const candidateValidation = validateTurnUnderstanding(candidate, leadMessage, true, turnValidationContext);
          if (llmFirst && !candidateValidation.trusted) {
            noteUnderstandingMetadataDrop("proposal", candidateValidation);
            lockedU = previousTrustedUnderstanding;
          } else {
            lockedU = candidate;
            stepUnderstandingTrusted = candidateValidation.trusted;
          }
        }
        if (step.kind === "final") {
          if (singleAuthor && !llmFirst) {
            // audit institucional: garante UMA observação TERMINAL por tópico pedido no bloco ANTES de qualquer
            // requisito (evita o loop do requiredToolBeforeFinal.mentionsStore + do próprio cérebro). Resolve
            // DETERMINISTICAMENTE (cache -> nunca repete a mesma chamada; NOT_CONFIGURED terminal -> sem loop/fallback).
            // Depois o cérebro responde os fatos disponíveis e informa honestamente os ausentes.
            const missingInst = institutionalTopicsRequested(leadMessage).filter((t) => !institutionalObs.has(t));
            if (missingInst.length > 0) {
              for (const topic of missingInst) await resolveInstitutional(topic);
              if (brainSteps + 1 < toolWindowLimit()) continue; else break;
            }
          }
          // Metadado semântico rejeitado já foi excluído acima. Não há uma
          // segunda rodada lexical de proveniência: ela só repetia a análise da
          // própria LLM e transformava uma resposta válida em retry/fallback.
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
          // central_active does not convert semantic metadata into a mandatory
          // query. The LLM receives verified operational context and owns the
          // decision to read; structured claims/effects without facts still
          // fail at the renderer/materializer boundary. Legacy replay keeps the
          // old precondition for compatibility.
          const missingTool = llmFirst ? null : requiredToolBeforeFinal(
            frame,
            observations,
            // A ferramenta comercial só é exigida quando a própria LLM
            // declarou o ato atual como busca de estoque. Extratores do turno
            // continuam sendo fatos/enriquecimento, nunca autoridade paralela.
            brainNeedsStockFact(),
            moreOptionsNeedsScope,
            frame.signals.mentionsMoreOptions === true && brainNeedsStockFact(),
            brainStoreInfoAct(),
          );
          if (missingTool && brainSteps + 1 < toolWindowLimit()) {
            // A engine exige consistência com o ato que a própria LLM declarou, mas
            // nunca executa estoque por retomada, anúncio, memória ou regex.
            // ⭐AD-1: rótulo e contador vêm do REQUISITO QUE FALTOU (missingTool.tool), nunca de uma palavra do bloco.
            // A observação sai SEMPRE como tool:"response" — assim o deny jamais se auto-satisfaz em wasObserved()
            // (que exclui REQUIRED_TOOL_MISSING), e o único jeito de sair do requisito é a LLM chamar a tool de verdade.
            observations.push({ tool: "response", ok: false, error: { code: "REQUIRED_TOOL_MISSING", message: missingTool.feedback } });
            if (missingTool.tool === "stock_search") duplicateStockCallsBlocked += 1;
            // ⭐AD-1: TODA perna tem trava. Antes só a de estoque contava, e a palavra "loja" desligava até essa.
            if (++requiredToolLoopCount >= REQUIRED_TOOL_LOOP_CAP) break;
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
            // O central_active não cria uma segunda autoridade lexical depois
            // que a LLM já classificou o turno. Uma referência estruturada sem
            // fato será rejeitada pelo renderer/grounding logo abaixo; texto
            // natural não pode forçar vehicle_details por regex. O requisito
            // antecipado permanece apenas no replay legado.
            const needDetail = !llmFirst && llmChoseVehicleDetail
              ? requireVehicleDetailBeforeFinal(frame, observations, detailTarget)
              : null;
            // P0-2 (exceção sistêmica TIPADA): necessidade de grounding do engine AUTORIZA vehicle_details do key selecionado
            // (separada da intenção da LLM). Registra o key p/ o gate de tool liberar a consulta de aterramento.
            if (needDetail) { const detailKey = detailTarget.kind === "resolved" ? detailTarget.vehicleKey : frame.workingMemory.selectedVehicle?.vehicleKey; if (detailKey) systemDetailKeys.add(detailKey); }
            if (needDetail && brainSteps + 1 < toolWindowLimit()) { observations.push({ tool: "vehicle_details", ok: false, error: { code: "REQUIRED_TOOL_MISSING", message: needDetail } }); continue; }
            if (needDetail) break;
            // Renderiza+valida a autoria do cérebro AQUI. Deny/fato ausente -> feedback tipado ao MESMO cérebro
            // (retry) enquanto houver passo; senão sai do loop -> fallback técnico honesto pós-loop.
            // ⭐AUTORIDADE: a expectativa de busca soma a SEMÂNTICA da própria LLM (declarou capability de busca) ao contexto
            // (anúncio/similaridade/retomada) — prometer "vou buscar" sem executar continua proibido nesses casos.
          const acceptedStepDecision = llmFirst && !stepUnderstandingTrusted
            ? withoutUntrustedSemanticPayload(step.decision)
            : step.decision;
          const authored = authorFromBrainDraft({ finalDecision: acceptedStepDecision, leadMessage, facts, identities, ctx: authoringContext(), proposedPrimaryIntent: acceptedBrainPrimaryIntent(), turnId, selectionTurn: acceptedSelectionTurn(), institutionalObs, photoVU: photoVU(), requireBrain, target: resolveTargetWithAd(), openingNeedsDiscovery: isOpeningTurn && (adGenericEntry || firstContactNoCommercialTarget), openingNeedsIntroduction: isOpeningTurn && firstContactNoCommercialTarget, specificAdVehicle: specificAdEntry ? (adVehicleHint ?? null) : null, adVehicleIdentity: adVehicleHint ?? null, searchExpectedThisTurn: llmFirst && brainNeedsStockFact(), noCommercialContextYet, advancedThisTurn: leadAdvancedThisTurn, disengagementOnly: false, financialAnswerSlot: null, handoffPlannable, qualifiedHandoffReadyFor, humanRequested: requestsHuman(brainVU()) || leadRequestsHumanExplicitly(leadMessage), sensitiveAnswerKinds, photoRecallLabel: persisted0.lastPhotoAction?.label ?? null });
            if (authored.ok) {
              finalDecision = acceptedStepDecision; authoredDecision = authored.decision; authoredComposed = authored.composed; authoredProposedEffects = authored.proposedEffects;
              responseSource = brainRetries === 0 ? "brain_final" : "brain_retry";
              break;
            }
            brainRetries += 1;
            if (process.env.PEDRO_V3_DENY_DEBUG) console.error(`[DENY_DEBUG] ${authored.feedback}`);
            // A engine descreve somente a contradicao objetiva encontrada. Ela
            // nao reclassifica o ato, nao escolhe pergunta, nao prescreve funil
            // e nao ensina uma estrategia comercial paralela ao prompt do portal.
            const effFeedback = llmFirst
              ? `Violacao objetiva da saida estruturada/factual: ${authored.feedback} Corrija somente essa violacao usando os fatos e o operationalContext deste turno. O prompt do portal continua sendo a unica autoridade sobre redacao, perguntas, funil e conducao comercial.`
              : authored.feedback;
            policyFeedbackLog.push(effFeedback);
            // Um mesmo erro objetivo ganha uma correcao; repetir exatamente o
            // mesmo erro encerra o loop e segue para a autoria final neutra.
            // O fingerprint usa o erro original, sem prefixos constantes.
            const fp = denyFingerprint(authored.feedback);
            if (seenDenyFingerprints.has(fp)) { repeatedDeny = true; break; }
            seenDenyFingerprints.add(fp);
            if (brainSteps + 1 < toolWindowLimit()) {
              const currentTurnAnchor = `REVISAO DO MESMO TURNO: o bloco atual do lead e "${leadMessage.slice(0, 280)}". Esta mensagem e feedback de validacao tecnica, nao uma nova ordem comercial.`;
              const retryFeedback = `${currentTurnAnchor}\n${effFeedback}`;
              observations.push({ tool: "response", ok: false, error: { code: "RESPONSE_REJECTED", message: retryFeedback } });
              continue;
            }
            break;
          }
          finalDecision = llmFirst && !stepUnderstandingTrusted
            ? withoutUntrustedSemanticPayload(step.decision)
            : step.decision;
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
        if (!llmFirst && !commercialToolAllowedForHumanRequest(brainVU(), call.tool)) {
          observations.push({ tool: "response", ok: false, error: {
            code: "FORBIDDEN",
            message: "O cliente pediu atendimento humano neste bloco. Nao use ferramenta comercial nem continue o funil; finalize reconhecendo o pedido e proponha handoff quando o precheck permitir.",
          } });
          continue;
        }
        if (!llmFirst && sensitiveAnswerTurn && (call.tool === "stock_search" || call.tool === "vehicle_details" || call.tool === "vehicle_photos_resolve")) {
          observations.push({ tool: "response", ok: false, error: {
            code: "FORBIDDEN",
            message: "O cliente acabou de responder com CPF ou data de nascimento validada. Nao use ferramenta comercial; confirme o recebimento sem repetir o valor/ref e conduza a conversa.",
          } });
          continue;
        }
        // A direct QueryCall is a read chosen by the LLM, not a visible effect.
        // Do not demand a duplicate capability/evidence authorization here.
        // The hard boundaries below remain objective: key provenance, photo
        // target, allowlist, input/schema validation and factual query policy.
        // ── ⭐AD-2 (2026-07-18): PROVENIÊNCIA DA vehicleKey. A lacuna central do incidente do anúncio. ──────────────
        //
        // INCIDENTE (18/07 15:38, lead 12 98819-0301, anúncio "Ford EcoSport SE 1.5 2020" com confiança 1.0): o
        // adContext resolveu certo e o engine até gravou as constraints (marca=ford, modelo=EcoSport, ano=2020).
        // Mas o anúncio chega à LLM como TEXTO, e nada no contrato dizia de onde nasce uma vehicleKey. A LLM fez o
        // esperado: INVENTOU uma chave a partir do texto e chamou vehicle_details -> not_found -> repetiu 3x
        // (dup_tool) -> grounding_deny -> deflexão "Vou confirmar os detalhes desse veículo com o consultor".
        // Nenhum stock_search rodou no turno inteiro.
        //
        // INVARIANTE: uma vehicleKey só EXISTE se veio de uma tool desta conversa (stock_search/vehicle_details),
        // da última oferta renderizada, da seleção ativa ou de uma identidade lembrada. Chave que não está nesse
        // conjunto NÃO EXECUTA — vira feedback com o CONJUNTO ADMISSÍVEL para a MESMA LLM decidir de novo.
        //
        // Isto NÃO é o engine escolhendo assunto nem executando busca: a LLM continua decidindo tudo. O efeito
        // colateral desejado é que, sem chave aterrada, o único caminho para falar do carro do anúncio passa a ser
        // stock_search — a LLM chega lá sozinha, porque é a única porta que existe. Exceção preservada:
        // systemDetailKeys (vehicle_details que o PRÓPRIO engine exigiu para grounding).
        if (llmFirst && (call.tool === "vehicle_details" || call.tool === "vehicle_photos_resolve")) {
          const rawInput = call.input as { vehicleRef?: { key?: unknown }; vehicleKey?: unknown };
          const requestedKey = typeof rawInput.vehicleRef?.key === "string"
            ? rawInput.vehicleRef.key
            : (typeof rawInput.vehicleKey === "string" ? rawInput.vehicleKey : null);
          const grounded = knownVehicleKeys(facts, identities, contextState);
          if (requestedKey && !grounded.has(requestedKey) && !systemDetailKeys.has(requestedKey)) {
            const admissiveis = [...grounded]
              .map((k) => { const l = canonicalVehicleLabel(k, facts, identities, contextState); return l ? `${k} (${l})` : k; })
              .slice(0, 8).join(" | ");
            const saida = grounded.size > 0
              ? `As chaves válidas AGORA são: ${admissiveis}. Use uma delas, ou rode stock_search se o carro certo não estiver nessa lista.`
              : `NENHUM veículo foi localizado nesta conversa ainda, então não existe chave válida. Rode stock_search com marca/modelo/ano (o anúncio, quando houver, está em sourceContext) e use a chave que a busca retornar.`;
            observations.push({ tool: "response", ok: false, error: {
              code: "VEHICLE_KEY_NOT_GROUNDED",
              message: `A vehicleKey '${requestedKey}' não veio de nenhuma consulta desta conversa — chaves internas NUNCA podem ser deduzidas do texto do anúncio, do catálogo de nomes ou do histórico. ${saida}`,
            } });
            if (++keyProvenanceLoopCount >= KEY_PROVENANCE_LOOP_CAP) break;
            continue;
          }
        }
        // Proíbe loop idêntico: mesma tool + mesmos args -> devolve o fato já obtido (nunca reexecuta).
        // The brain owns the tool decision, but a photo query cannot contradict the
        // uniquely grounded subject of this turn. Reject before touching the adapter
        const sig = toolCallSignature(call);
        if (seenToolSigs.has(sig)) {
          // ⭐F2.81 (missão P0, prioridade 4): REUSO ESTRITO DO RESULTADO JÁ EXECUTADO — uma regra só, para TODAS as
          // tools. Repetir a MESMA chamada é idempotente: o certo é DEVOLVER o resultado que ela já produziu, sem
          // reexecutar o adapter e SEM deny. O contrato antigo era por tool e devolvia ERRO (DUP_TOOL/DUP_STOCK_SEARCH):
          //   • quando a 1ª chamada FALHOU (incidente Mônaco: vehicle_details com chave fabricada -> NOT_FOUND), o
          //     DUP_TOOL dizia "use o fato que a ferramenta retornou" — mas NÃO HAVIA fato. Mensagem inacionável: a
          //     LLM repetia, colecionava dup_tool e o turno morria em deflexão. Devolver o NOT_FOUND real informa a
          //     causa e ela corrige o alvo.
          //   • quando a 1ª chamada deu certo, repreender quem repete uma consulta idempotente é regra de conduta
          //     disfarçada de segurança — o fato existe, basta entregá-lo de novo.
          // O teto anti-loop continua: o resultado é reentregue UMA vez por tool; na insistência o loop sai para a
          // autoria final (nunca queima o orçamento de passos).
          const cachedResult = resultBySig.get(sig)
            ?? (call.tool === "vehicle_photos_resolve" ? facts.find((f) => f.ok && f.tool === "vehicle_photos_resolve") : undefined);
          if (llmFirst) {
            duplicateToolCallsBlocked += 1;
            if (call.tool === "stock_search") duplicateStockCallsBlocked += 1;
            if (cachedResult) {
              duplicateToolCallsServedFromCache += 1;
              const reachedCap = duplicateLoopReachedCap(call.tool);
              if (!reachedCap) {
                lastToolReuse = { tool: call.tool, ok: cachedResult.ok, mode: "cache_reuse" };
                grantIdempotentReuseStepCredit();
                // O fato original continua uma única vez em `observations`.
                // A fase de tools permanece aberta para a LLM decidir se
                // finaliza ou se chama outra tool necessária ao mesmo ato.
                continue;
              }
            }
            // Sem resultado executado, ou após repetição patológica, encerra o
            // loop de forma limitada. Nenhum adapter é reexecutado.
            break;
          }
          const dupCap = (): boolean => {
            if (call.tool === "stock_search") { duplicateStockCallsBlocked += 1; return ++dupStockLoopCount >= 2; }
            if (call.tool === "vehicle_details") return ++dupDetailLoopCount >= 2;
            if (call.tool === "vehicle_photos_resolve") return ++dupPhotoLoopCount >= 2;
            return ++dupOtherLoopCount >= 2;
          };
          if (cachedResult) {
            // O resultado JÁ ESTÁ nas observações desde a execução real (`observations` acumula o turno inteiro), então
            // reempurrá-lo não informaria nada e INFLARIA a contagem de tools — que é o sinal de retry-storm (F2.39
            // [IN-4]). O que a repetição recebe é uma mensagem de controle DERIVADA DO RESULTADO REAL: ela nunca afirma
            // um fato que não existe. Era exatamente essa a mentira do incidente ("use o fato que a ferramenta
            // retornou" depois de um NOT_FOUND). Sucesso -> "o resultado está aí, finalize"; erro -> o erro REAL.
            duplicateToolCallsServedFromCache += 1;
            if (call.tool === "vehicle_photos_resolve") {
              // ⭐Contrato já aprovado na auditoria de 19/07 (F2.70 [G2]) e PRESERVADO aqui: a resolução de fotos
              // devolve o resultado e NENHUM deny. Ela é a única cujo resultado o cérebro precisa ter EM MÃOS para
              // montar o send_media — reentregá-lo é o caminho direto, e a contagem de fotos não é o sinal de
              // retry-storm que a de busca é. Assimetria INTENCIONAL, não esquecimento.
              observations.push(toAgentObservation(cachedResult));
              if (dupCap()) break;
              continue;
            }
            const dupCode = call.tool === "stock_search" ? "DUP_STOCK_SEARCH" : "DUP_TOOL";
            const dupMsg = cachedResult.ok
              ? `Esta chamada EXATA de '${call.tool}' já foi executada neste turno e o RESULTADO está nas suas observações. Use esse resultado e finalize AGORA — não repita a mesma chamada.`
              : `Esta chamada EXATA de '${call.tool}' já foi executada neste turno e FALHOU (${cachedResult.error.code}: ${cachedResult.error.message}). Repetir igual não muda nada: use um alvo/filtro DIFERENTE ou conclua o turno com honestidade sobre o que não conseguiu confirmar.`;
            observations.push({ tool: "response", ok: false, error: { code: dupCode, message: dupMsg } });
            if (dupCap()) break;
            continue;
          }
          // Sem resultado em cache: a chamada anterior nem chegou a executar (bloqueada por autoridade/policy). Aqui o
          // feedback é honesto — não afirma que existe um fato — e diz o que fazer: mudar o alvo/input ou concluir.
          observations.push({ tool: "response", ok: false, error: { code: "DUP_TOOL", message: `Você repetiu exatamente a mesma chamada de '${call.tool}' e a anterior NÃO produziu resultado neste turno. Repetir igual não vai mudar nada: ou chame com um alvo/filtro DIFERENTE, ou conclua o turno com o que você já tem, com honestidade sobre o que não conseguiu confirmar.` } });
          if (dupCap()) break;
          continue;
        }
        seenToolSigs.add(sig);
        if (call.tool === "tenant_business_info") {
          // resolveInstitutional dedup por tópico (1x); repetição do MESMO tópico devolve o cache (nunca reexecuta).
          await resolveInstitutional(call.input.topic);
          continue;
        }
        if (!isKernelQueryCall(call)) { observations.push({ tool: (call as { tool: string }).tool, ok: false, error: { code: "VALIDATION", message: "tool desconhecida" } }); continue; }
        // A LLM declarou o papel semântico dos valores do bloco. Se um valor de negociação foi copiado por engano para
        // precoMax, removemos somente esse campo da chamada atual; o enriquecimento abaixo ainda preserva qualquer teto
        // válido herdado do anúncio/escopo. Não há classificação textual nem regra por frase nesta camada.
        const semanticallyScopedCall: QueryCall = call.tool === "stock_search"
          ? { ...call, input: sanitizeStockSearchInputMoney(call.input, leadMessage, brainVU()?.understanding) }
          : call;
        // AUTORIZAÇÃO POR CHAMADA (POL-STATE-011): a policy VALIDA (allow/deny), nunca escolhe o assunto.
        const verdict = PolicyEngine.authorizeQuery(semanticallyScopedCall, ctx, facts);
        if (verdict.outcome !== "allow") {
          observations.push({ tool: semanticallyScopedCall.tool, ok: false, error: { code: "FORBIDDEN", message: verdict.violations?.join(";") ?? "query negada" } });
          continue;
        }
        // P0-4 (audit): "mais opções" -> o ENGINE enriquece excludeKeys com a UNIÃO das keys da última oferta (não
        // depende de a LLM lembrar); preserva tipo/câmbio/teto. A chamada EXECUTADA (não só a proposta) carrega os excludes.
        const execCall = enrichStockSearchCall(semanticallyScopedCall, {
          popular: frame.signals.mentionsPopular === true,
          moreOptions: frame.signals.mentionsMoreOptions,
          previousVehicleKeys: shownVehicleKeys,  // INC3: conjunto CUMULATIVO apresentado (clampa o excludeKeys do cérebro)
          constraints: searchScopeThisTurn(),   // ⭐F2.75: escopo DO TURNO (troca de direção não herda anúncio); só preenche lacunas
          wantsMotorcycle,                       // F2.29: só libera moto se o lead pediu moto explicitamente
          enforceShownClamp: llmFirst,           // INC3: clampa só no central_active; shadow/legado mantém a união antiga
          llmOwnsFilters: llmFirst,               // chamada direta: memória/regex/anúncio nunca acrescentam filtros omitidos pela LLM
        });
        if (call.tool === "stock_search") stockProposedVsExecuted.push({ proposed: call.input, executed: execCall.input, topicChange: topicChangeThisTurn(), source: "brain_loop" });
        // Missão P0 (audit Codex smoke): DEDUP SEMÂNTICO NO LOOP. Se ESTA busca (filtro ENRIQUECIDO) já foi executada neste
        // turno, NÃO re-observa como stock_search (é aqui, no push de toAgentObservation abaixo, que o relatório contava 7x) —
        // empurra feedback de controle (tool:"response") p/ o cérebro FINALIZAR com o resultado que já tem. Relaxamento real =
        // fingerprint diferente = passa e executa. + cap anti-loop. NÃO é if-por-frase (é igualdade de filtro normalizado).
        if (execCall.tool === "stock_search" && stockSearchCache.has(stockSearchFingerprint(execCall.input as Record<string, unknown>))) {
          // ⭐F2.81 (prioridade 4): mesmo tratamento do reuso estrito — o resultado já obtido continua valendo e NENHUM
          // deny é empurrado. O texto antigo ("você já buscou e tem o resultado em mãos, liste os carros encontrados")
          // era MENTIRA quando a 1ª busca falhou (o cache guarda erro também): mandava listar carros que não existiam.
          // O resultado real (sucesso ou erro) já está nas observações desde a execução; reempurrá-lo inflaria a
          // contagem de buscas do turno, que é o sinal de retry-storm. Só conta e respeita o teto.
          const cachedStock = stockSearchCache.get(stockSearchFingerprint(execCall.input as Record<string, unknown>));
          duplicateStockCallsBlocked += 1;
          if (cachedStock) { duplicateToolCallsServedFromCache += 1; resultBySig.set(sig, cachedStock); }
          if (llmFirst) {
            const reachedCap = duplicateLoopReachedCap("stock_search");
            if (cachedStock && !reachedCap) {
              lastToolReuse = { tool: "stock_search", ok: cachedStock.ok, mode: "cache_reuse" };
              grantIdempotentReuseStepCredit();
              // Igualdade semântica (ex.: `SUV` vs `suv`) também é reuso
              // idempotente: mantém a fase aberta e não duplica observações.
              continue;
            }
            break;
          }
          observations.push({ tool: "response", ok: false, error: { code: "DUP_STOCK_SEARCH", message: cachedStock && !cachedStock.ok
            ? `Esta busca já foi executada neste turno e FALHOU (${cachedStock.error.code}: ${cachedStock.error.message}). Repetir o mesmo filtro não muda nada: mude o filtro ou responda com honestidade que não conseguiu consultar o estoque agora.`
            : "Você JÁ buscou esse estoque neste turno e o resultado está nas suas observações. Finalize AGORA respondendo ao cliente com esse resultado — NÃO chame stock_search de novo." } });
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
          const timeoutRes = { ok: false, tool: call.tool, error: { code: "UPSTREAM", message: "tool indisponivel" } } as QueryResult;
          resultBySig.set(sig, timeoutRes);   // F2.81: repetir a mesma chamada que estourou devolve o MESMO erro, sem novo custo
          executionFailures.push(call.tool);  // execução REAL que falhou (timeout) — entra no contexto operacional
          observations.push(toAgentObservation(timeoutRes));
          continue;
        }
        if (!res.ok) executionFailures.push(call.tool);   // o adapter respondeu com erro: falha REAL da fonte
        resultBySig.set(sig, res);
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
        // Em central_active a engine não escolhe nem executa a tool de fotos.
        // `authorFromBrainDraft` valida o contrato factual: a própria LLM chama
        // vehicle_photos_resolve e, havendo fotos, propõe send_media. O caminho
        // determinístico de replay permanece isolado no bloco !llmFirst abaixo.
        // Resolução factual única por ordinal: a engine consulta photoIds do item exato uma
        // única vez. Ela não escreve "aqui estão" nem escolhe o próximo passo; a autoria final
        // pertence à LLM, alimentada pelo mesmo resolveTarget usado por seleção e memória.
        if (!authoredComposed && !llmFirst) {
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
            "As tools desta passagem ja foram encerradas; nao proponha nova consulta neste passo.",
            "Use somente as observacoes e o operationalContext verificados neste turno.",
            "Nao invente fatos, referencias, chaves internas nem efeitos sem suporte estrutural.",
            "O prompt do portal continua sendo a unica autoridade sobre redacao, perguntas, funil e conducao comercial.",
            "Devolva kind=final com draft.parts estruturado e, se propuser efeito, use somente recursos aterrados.",
          ].join(" ");
          observations.push({ tool: "response", ok: false, error: { code: "FINAL_AUTHORSHIP_REQUIRED", message: finalContext } });

          for (let attempt = 0; attempt < FINAL_AUTHORSHIP_RETRY_CAP; attempt++) {
            finalAuthorshipAttempts += 1;
            brainSteps += 1;
            let finalStep;
            let finalStepUnderstandingTrusted = false;
            try {
              finalStep = noteBrainStep(await withTimeout(brain.proposeNextStep(frameNow(), observations), limits.proposeTimeoutMs ?? 30_000, "propose: final LLM authorship exceeded timeout"));
            } catch (err) {
              providerFallbackSeen = true;
              providerFallbackReason = providerFallbackReason ?? `brain authorship timeout/transport: ${String((err as Error)?.message ?? err).slice(0, 80)}`;
              break;
            }
            if (finalStep.understanding) {
              const previousTrustedUnderstanding = trustedLockedUnderstanding();
              const candidate = reconcileUnderstanding(previousTrustedUnderstanding, finalStep.understanding, leadMessage, {
                acceptedPhotoOffer: acceptsAgentPhotoOffer(leadMessage, contextState),
                allowCurrentEvidenceCorrection: observations.some((observation) => observation.tool === "response" && !observation.ok),
              });
              const validation = validateTurnUnderstanding(candidate, leadMessage, true, turnValidationContext);
              if (llmFirst && !validation.trusted) {
                noteUnderstandingMetadataDrop("final_authorship", validation);
                lockedU = previousTrustedUnderstanding;
              } else {
                lockedU = candidate;
                finalStepUnderstandingTrusted = validation.trusted;
              }
            }
            if (finalStep.kind !== "final") {
              observations.push({ tool: "response", ok: false, error: { code: "FINAL_TOOL_FORBIDDEN", message: "As tools deste turno ja foram resolvidas. Nao consulte novamente; escreva agora a resposta final com os fatos disponiveis." } });
              continue;
            }
            // A autoria final nao pode contornar o contrato de tool. Se a LLM
            // declarou um ato que exige fatos atuais, a mesma LLM precisa
            // chamar a tool; a passagem de autoria sem novas tools nao pode
            // transformar uma promessa sem consulta em resposta aceita.
            const finalMissingTool = llmFirst ? null : requiredToolBeforeFinal(
              frame,
              observations,
              brainNeedsStockFact(),
              moreOptionsNeedsScope,
              frame.signals.mentionsMoreOptions === true && brainNeedsStockFact(),
              brainStoreInfoAct(),
            );
            if (finalMissingTool) {
              observations.push({ tool: "response", ok: false, error: { code: "FINAL_REQUIRED_TOOL_MISSING", message: finalMissingTool.feedback } });
              // ⭐AD-1 (contradição PROÍBE-E-EXIGE): neste estágio a LLM está PROIBIDA de chamar tool (o contexto diz
              // "não chame nenhuma nova tool nesta passagem" e o guard FINAL_TOOL_FORBIDDEN acima rejeita qualquer
              // passo de tool). Insistir aqui é pedir uma ação impossível — não existe resposta da LLM que satisfaça o
              // requisito. Registramos a observação (diagnóstico) e SAÍMOS, deixando o turno cair na recuperação
              // contextual honesta, que nomeia o que faltou. `continue` aqui só queimava as tentativas até
              // "Tive uma instabilidade".
              break;
            }
            const acceptedFinalDecision = llmFirst && !finalStepUnderstandingTrusted
              ? withoutUntrustedSemanticPayload(finalStep.decision)
              : finalStep.decision;
            const authored = authorFromBrainDraft({ finalDecision: acceptedFinalDecision, leadMessage, facts, identities, ctx: authoringContext(), proposedPrimaryIntent: acceptedBrainPrimaryIntent(), turnId, selectionTurn: acceptedSelectionTurn(), institutionalObs, photoVU: photoVU(), requireBrain, target: resolveTargetWithAd(), openingNeedsDiscovery: isOpeningTurn && (adGenericEntry || firstContactNoCommercialTarget), openingNeedsIntroduction: isOpeningTurn && firstContactNoCommercialTarget, specificAdVehicle: specificAdEntry ? (adVehicleHint ?? null) : null, adVehicleIdentity: adVehicleHint ?? null, searchExpectedThisTurn: false, noCommercialContextYet, advancedThisTurn: leadAdvancedThisTurn, disengagementOnly: false, financialAnswerSlot: null, handoffPlannable, qualifiedHandoffReadyFor, humanRequested: requestsHuman(brainVU()) || leadRequestsHumanExplicitly(leadMessage), sensitiveAnswerKinds, photoRecallLabel: persisted0.lastPhotoAction?.label ?? null });
            if (authored.ok) {
              finalDecision = acceptedFinalDecision;
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
        } else if (!legacyReplayEnabled) {
          // ⭐Itens 2/3/4 (Codex) + F7-6: PRODUÇÃO (llmFirst=central_active/central_shadow) E QUALQUER chamador não-llmFirst
          // SEM opt-in de replay caem AQUI. O INSTITUCIONAL é decidido pela LLM — ela chama tenant_business_info, recebe o
          // fato e REDIGE a resposta (smoke gpt-4.1-mini: brain_final "Nossa loja fica na Av..."). A engine NÃO escreve
          // endereço/horário/comercial como autor determinístico. Quando a LLM não autora, o ÚNICO piso é a nota de
          // indisponibilidade técnica. Dois desfechos possíveis: resposta autorada pela LLM OU nota curta de outage —
          // NUNCA um responseSource deterministic_* (garantido pela invariante de saída após este bloco).
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
            } else if (moreOptionsNeedsScope && !purelyConversationalActDeclared() && !facts.some((f) => f.ok && f.tool === "stock_search")) {
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
              const rec = buildContextualRecovery({ vU: authoritativeVU(), leadMessage, facts, observations, identities, ctx, turnId, constraints: searchScopeThisTurn(), adVehicleLabel: adExactFocusTurn ? (adVehicleHint ?? null) : null });
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
        // O central_active não julga nem edita a quantidade de perguntas depois da
        // autoria. O trim permanece exclusivamente no legado (replay autorizado).
        if (legacyReplayEnabled) {
          const trimmedText = trimToOneQuestion(composed.text);
          if (trimmedText !== composed.text) composed = { ...composed, text: trimmedText };
        }
        // Recall determinístico de foto (invariante 8): pergunta de MEMÓRIA de foto SEMPRE nomeia o veículo lembrado.
        // O label é FATO de memória (grounded por construção) -> responde MESMO se o cérebro não autorou. NÃO é
        // degradação: marca responseSource=deterministic_recall. F7-6: é fonte deterministic_* -> SÓ no replay legado
        // autorizado (nunca em produção/llmFirst; garantido também pela invariante de saída abaixo).
        const recalledLabel = persisted0.lastPhotoAction?.label ?? null;
        if (legacyReplayEnabled && recalledLabel && isPhotoMemoryQuestionBlock(leadMessage) && !effectiveDecision.effectPlan.some((p) => p.kind === "send_media") && !mentionsLabel(composed.text, recalledLabel)) {
          const recall = `Você pediu as fotos do ${recalledLabel}. Quer que eu te passe mais detalhes dele?`;
          composed = { draft: { parts: [{ type: "text", content: recall }] }, text: recall };
          responseSource = "deterministic_recall";
        }
        // F7-6 INVARIANTE DE SAÍDA (fail-closed): um responseSource deterministic_* comercial só pode existir sob replay
        // legado autorizado. Em central_active/central_shadow (llmFirst) OU em qualquer chamador não-llmFirst sem opt-in,
        // isto DEVE ser impossível (o ramo determinístico está gateado em legacyReplayEnabled). A checagem é a rede de
        // segurança contra regressão: se um caminho futuro voltar a escrever deterministic_* fora do replay, estoura aqui.
        assertLegacyAuthoringAuthorized(responseSource, { llmFirst, legacyCommercialReplay });
        // Em llmFirst não existe abertura comercial escrita pelo engine. A
        // identidade e a descoberta são validadas durante a autoria e reescritas
        // pelo próprio cérebro. Se ele não convergir, a falha permanece técnica e
        // observável; nunca aparece uma segunda personalidade determinística.
        degraded = isDegradedResponse(responseSource, recoveryReason);
        // LLM-FIRST (missão): o engine NÃO gerencia objetivo de funil. `stripAllObjectiveMutations` garante que nenhum
        // objetivo de funil seja persistido (funil = contexto read-only; a LLM decide a condução). Fora do llm_first,
        // `reconcileObjectiveWithQuestion` continua persistindo o objetivo = pergunta REALMENTE enviada (legado).
        if (llmFirst) effectiveDecision = stripAllObjectiveMutations(effectiveDecision);
        else if (engineSdrPolicy && !degraded) effectiveDecision = reconcileObjectiveWithQuestion({ decision: effectiveDecision, composedText: composed.text, state: contextState, turnId, policy: engineSdrPolicy });
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
        if (engineSdrPolicy && !terminalSafe) {
          effectiveDecision = reconcileObjectiveWithQuestion({ decision: effectiveDecision, composedText: composed.text, state: contextState, turnId, policy: engineSdrPolicy });
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
      if (adExactFocusTurn && executedScope && executedScope.anos && (!currentConstraintsForTurn().anos || currentConstraintsForTurn().anos!.length === 0)) {
        const { anos: _adYear, ...rest } = executedScope;
        executedScope = rest;
      }
      if (llmFirst) {
        if (executedScope && sufficientForStockSearch(executedScope)) reduced.next.activeSearchConstraints = executedScope;
        else {
          // ⭐F2.75: num turno de TROCA DE DIREÇÃO sem busca executada, persiste o escopo NOVO (currentConstraints via
          // searchScopeThisTurn), não o mergeado velho do anúncio — assim o próximo "tem outros?" herda o estreito novo (aceite 8).
          const fallbackScope = searchScopeThisTurn();
          if (isSearchishTurn && (sufficientForStockSearch(fallbackScope) || commercialCorrections.removedTypes.length > 0)) reduced.next.activeSearchConstraints = fallbackScope;
        }
      }
      // F2.32 (CTWA): persiste o CONTEXTO do anúncio — a 1ª mensagem traz o externalAdReply; as seguintes herdam do state
      // (recuperação de rajada). Anúncio NOVO (veio na rajada) é carimbado com o turnNumber atual; senão preserva o do state.
      if (llmFirst && effectiveAdContext) {
        reduced.next.adContext = burstAdContext
          ? { ...effectiveAdContext, capturedAtTurn: effectiveAdContext.capturedAtTurn || reduced.next.turnNumber }
          : effectiveAdContext;
      }
      // Proof belongs to this exact ad and survives independently from the last rendered list. A new/ambiguous/
      // failed exact observation clears it; old states without the field stay unknown rather than guessed.
      reduced.next.adIdentityProof = llmFirst && effectiveAdContext ? adProofNow() : null;
      // A existencia factual precisa atravessar o turno mesmo quando a LLM apresentou
      // um unico veiculo em texto natural. A prova de identidade do anuncio continua
      // separada: persistir esta chave nunca promove family_candidate para versao exata.
      if (llmFirst) {
        reduced.next.groundedVehicles = compactGroundedFleet(groundedFleet(), [
          adProofNow()?.vehicleKey ?? "",
          contextState.vehicleContext.selected?.key ?? "",
          ...renderedItems.map((it) => it.vehicleKey),
        ].filter(Boolean));
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
      // A engine nunca origina uma transferência no fluxo ativo. Opt-out é
      // persistido como fato de compliance e pode suspender a cadência, mas não
      // é convertido silenciosamente em handoff. A cadeia abaixo apenas
      // materializa um efeito que a própria LLM propôs.
      const silentDisengagementHandoff = false;
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
      });
      if (handoffChain.planned && reduced.next.followupSuspendedAt == null) reduced.next.followupSuspendedAt = cutoff;
      // Uma despedida aceita pela semântica da LLM encerra a cadência deste
      // ciclo mesmo antes de o funil chegar a handoff/closed. Não inferimos por
      // frase e não alteramos a autoria: apenas persistimos a decisão semântica
      // já validada. Uma nova fala posterior do lead reativa o ciclo.
      const acceptedIntentForFollowup = acceptedBrainPrimaryIntent();
      if (acceptedIntentForFollowup === "disengagement" && reduced.next.followupSuspendedAt == null) {
        reduced.next.followupSuspendedAt = cutoff;
      }
      const decisionForOutbox = { ...decisionWithCrm, effectPlan: handoffChain.effectPlan };
      const handoffGraphViolations = validateEffectPlans(decisionForOutbox.effectPlan);
      if (handoffGraphViolations.length > 0) {
        throw new Error(`central: invalid post-finalizer handoff graph: ${handoffGraphViolations.join("; ")}`);
      }

      // T1 (audit Codex smoke): SANITIZA control chars do texto de saída num chokepoint ÚNICO — cobre o send_message
      // (materializeEffectPlans), o composedText do resultado e o evento response_composed. O LLM às vezes emite U+001F etc.
      const outComposed = { ...composed, text: sanitizeOutgoingText(composed.text) };
      const outbox = materializeEffectPlans(decisionForOutbox, outComposed, {
        conversationId,
        createdAt: cutoff,
        providerCapability,
        assistantTurnAuthoring: responseSource === "technical_fallback"
          ? "technical_fallback"
          : (responseSource === "brain_final" || responseSource === "brain_retry")
            ? "llm"
            : "system",
      });

      // Observabilidade institucional (audit): status TERMINAL por tópico resolvido no turno.
      const institutionalResolved = [...institutionalObs.entries()].map(([topic, obs]) => ({
        topic, status: (obs.ok ? "ok" : (obs.error.code === "NOT_CONFIGURED" ? "not_configured" : "failure")) as "ok" | "not_configured" | "failure",
      }));
      const finalVU = authoritativeVU();   // T6: semântica autoritativa do turno (do cérebro OU fallback validado)
      // Apenas understanding validada da LLM ganha autoridade persistente.
      // Quando o metadado foi descartado, a telemetria usa o fallback descritivo
      // sem atribuir a ele poder sobre efeitos, memória ou follow-up.
      const authoritativeUnderstanding: TurnUnderstanding = finalVU.understanding;
      const understandingFromBrain = lockedU != null;
      const understandingAuthority = finalVU.fromBrain
        ? (finalVU.trusted ? "trusted" : "brain_untrusted")
        : "fallback";
      // T6: se houve send_media e o executor não registrou a fonte do alvo (foto AUTORADA pelo cérebro), registra aqui.
      if (targetResolutionSource == null && proposedEffects.some((e) => e.kind === "send_media")) {
        const tr = resolveTargetWithAd(); targetResolutionSource = tr.kind === "resolved" ? tr.source : (tr.kind === "ambiguous" ? "ambiguous" : "none");
      }

      // ⭐FASE 1 (diagnóstico observável): CAUSA sanitizada da degradação (provedor × rejeição × evidência × grounding
      // × esgotamento). Diferencia "provedor caiu" de "resposta rejeitada" — o cerne do que a missão pediu no relatório.
      const degradationKind = classifyDegradation({ llmFirst, responseSource, providerFallbackSeen, providerFallbackReason, policyFeedbackLog, observations });
      // ⭐F7-2 (observabilidade anti retry-storm): deriva o MOTIVO de cada retry/nudge a partir das observações de CONTROLE
      // (!ok) empurradas no loop do cérebro — cada uma precede um continue/break. Só relato: não muda decisão/caps. Ordem =
      // ocorrência; retryReasonCounts agrega por categoria para ver a causa dominante do gasto de passos do turno.
      const retryReasons = observations.filter((o) => !o.ok).map((o) => classifyRetryReason(o.error.code, o.error.message));
      const retryReasonCounts: { [k: string]: number } = {};
      for (const r of retryReasons) retryReasonCounts[r] = (retryReasonCounts[r] ?? 0) + 1;
      const events = [
        makeEvent({ conversationId, turnId, type: "turn_claimed", suffix: "claimed", payload: { eventIds: claimedEventIds }, at: cutoff }),
        // Observabilidade (audit + T6 fonte única): responseSource distingue autoria; understanding = semântica do turno;
        // previous/resolved vehicleKey + targetResolutionSource auditam a precedência de alvo; recoveryReason + feedback
        // por tentativa auditam a recuperação. tools p/ o v3_query_log do central_active.
        makeEvent({ conversationId, turnId, type: "decision_final", suffix: "decision", payload: {
          action: decision.action, reasonCode: decision.reasonCode, effectIds: outbox.map((r) => r.effectId),
          brainMode: singleAuthor ? "central_active" : "central_shadow", contextEnvelopeVersion: 1, brainSteps, responseSource, degraded, brainRetries, finalAuthorshipAttempts,
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
          primaryIntent: authoritativeUnderstanding.primaryIntent, subject: authoritativeUnderstanding.subject,
          subjectSource: authoritativeUnderstanding.subjectSource, understandingTrusted: finalVU.trusted,
          understandingFromBrain, understandingAuthority,
          evidence: authoritativeUnderstanding.evidence.slice(0, 4).map((e) => ({ capability: e.capability ?? null, quote: e.quote.slice(0, 48) })),
          previousSelectedVehicleKey: contextState.vehicleContext.selected?.key ?? null,
          resolvedVehicleKey: proposedEffects.find((e) => e.kind === "send_media")?.vehicleKey ?? null,
          targetResolutionSource, recoveryReason,
          // FASE 1: causa da degradação + motivo sanitizado do provedor (só quando houve falha real de transporte/JSON).
          degradationKind, providerFallbackReason: providerFallbackSeen ? providerFallbackReason : null,
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
          // ⭐F7-2 (anti retry-storm): motivo curto dos retries do turno (top ~8, em ordem) + contagem por categoria.
          retryReasons: retryReasons.slice(0, 8), retryReasonCounts,
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
          // Metadado auxiliar descartado nao e hard deny nem retry e jamais
          // autoriza efeito. Serve apenas para medir deriva sem punir a autoria.
          understandingMetadataDropped,
          understandingMetadataDropIssues: understandingMetadataDropIssues.slice(0, 6),
          // F2.29 (observabilidade do escopo comercial — auditoria do "mais opções herda escopo"): filtro ativo ANTES/DEPOIS,
          // input REAL da stock_search executada, e o escopo herdado por "mais opções" (null se pediu escopo).
          activeSearchConstraintsBefore: contextState.activeSearchConstraints ?? null,
          activeSearchConstraintsAfter: reduced.next.activeSearchConstraints ?? null,
          stockSearchInputExecuted: lastStockFact ? lastStockFact.data.filtersUsed : null,
          stockSearchProposedVsExecuted: JSON.parse(JSON.stringify(stockProposedVsExecuted.slice(-4))),   // ⭐F2.75 (Codex #7): proposto pela LLM vs executado (JSON puro)
          topicChangeReset: topicChangeThisTurn(),                            // ⭐F2.75: o turno soltou o escopo do anúncio/ativo?
          moreOptions: baseSignals.mentionsMoreOptions, moreOptionsNeedsScope,
          moreOptionsInheritedScope: baseSignals.mentionsMoreOptions && sufficientForStockSearch(effectiveSearchScopeThisTurn()) ? effectiveSearchScopeThisTurn() : null,
          // Missão P0 (doc 2): observabilidade de latência/retry. turnLatencyMs = tempo de parede do turno (RealClock em prod);
          // toolMs = soma do tempo das tools; firstFailureReason = 1º feedback/rejeição (por que houve retry). attempts=brainRetries.
          turnLatencyMs: Math.max(0, Date.parse(clock.now()) - turnStartMs),
          toolMs: toolTelemetry.reduce((sum, t) => sum + (t.ms ?? 0), 0),
          firstFailureReason: policyFeedbackLog[0] ? policyFeedbackLog[0].slice(0, 140) : null,
          // Missão P0 INC3/1/2: intenção do turno p/ auditoria de troca vs busca vs abertura.
          tradeInAnswerTurn, resumeSearchTurn, searchExpectedThisTurn: brainNeedsStockFact(), pendingQuestionSlot, tradeBuyTurn, financialAnswerTurn,
          // Missão P0 (audit Codex): separação compra/troca + dedup de busca.
          buyConstraints: tradeBuyTurn ? buyConstraints : null,
          interesseBefore: contextState.slots.interesse.value ?? null,
          interesseAfter: reduced.next.slots.interesse.value ?? null,
          veiculoTrocaAfter: reduced.next.slots.veiculoTroca.value ?? null,
          stockSearchFingerprintsExecuted: stockFingerprintsExecuted.length,
          duplicateStockCallsBlocked,
          // F2.81: quantas repetições foram atendidas REUSANDO o resultado já obtido (nenhuma reexecutou o adapter).
          duplicateToolCallsServedFromCache,
          duplicateToolCallsBlocked,
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
        degraded, degradationKind, providerFallbackReason: providerFallbackSeen ? providerFallbackReason : null,
        institutionalResolved, policyFeedback: policyFeedbackLog, retryReasons, droppedSelectKeys,
        understanding: authoritativeUnderstanding, understandingFromBrain, targetResolutionSource,
        resolvedVehicleKey: proposedEffects.find((e) => e.kind === "send_media")?.vehicleKey ?? null,
        previousSelectedVehicleKey: contextState.vehicleContext.selected?.key ?? null, recoveryReason,
      };
    } catch (err) {
      await persistence.releaseClaim(claimedEventIds, workerId, turnId);
      return { status: "commit_failed", turnId, claimedEventIds, reason: err instanceof Error ? err.message : String(err) };
    }
  });
}
