// ============================================================================
// agent-brain.ts — R13-S1 (contratos do agente central, caminho SHADOW). REVISADO pós-auditoria Codex.
//
// Correções da auditoria (4 P0 + 2 P1):
//  P0-1 AUTORIDADE TEMPORAL: duas uniões de mutação — DecisionWorkingMemoryMutation (só fatos do inbound/decisão,
//       no commit) e EffectOutcomeWorkingMemoryMutation (só fatos confirmados por RECEIPT). `mark_photo_action_accepted`
//       existe SÓ na 2ª união e carrega effectId; a LLM (AgentBrainDecision) NÃO pode propor outcome mutation.
//  P0-2 EFEITOS PROPOSTOS: AgentBrainDecision.proposedEffects usa ProposedEffectPlan[] (a LLM NÃO cria effectId;
//       só o Finalizer materializa `${turnId}:${planId}` e valida ordem/dependências/duplicidade).
//  P0-3 OBSERVAÇÃO FACTUAL: ToolTelemetry (sanitizada, p/ log) SEPARADA de AgentToolObservation (fatos estruturados
//       que o cérebro usa p/ decidir), união discriminada por tool e ligada ao QueryOutputMap existente.
//  P0-4 FONTE ÚNICA DA VERDADE: funnel/selectedVehicle/lastOffer são CANÔNICOS no ConversationState e entram como
//       VIEW derivada READ-ONLY (CanonicalWorkingMemoryView) — nunca graváveis pela LLM (removido update_funnel/
//       set_selected_vehicle/set_last_offer). A parte PERSISTIDA (PersistedWorkingMemory) é só o que a WM É dona.
//  P1-6 IDENTIDADE ESTÁVEL: UnansweredQuestion e Commitment têm id estável + createdTurnId/resolvedTurnId/status;
//       resolve/update por ID (nunca por texto).
//
// Matriz de propriedade canônica (autoridade gravável ÚNICA por campo) — ver Brain/01-STATUS + handoff R13-S1.
// ============================================================================
import type { DecisionMutation, ProposedEffectPlan, QueryCall, QueryOutputMap, ResponseDraft, TurnRelation } from "./decision.ts";
import type { SlotName, Iso } from "./types.ts";

export const WORKING_MEMORY_SCHEMA_VERSION = 1 as const;

// ── Enums fechados (validados em runtime pelo reducer/loader) ────────────────────────────────────────────────
export const TOPIC_ORIGINS = ["lead_message", "agent_offer", "recall", "carryover"] as const;
export type TopicOrigin = (typeof TOPIC_ORIGINS)[number];
export const LEAD_INTENT_KINDS = [
  "discover_stock", "more_options", "vehicle_detail", "photo_request", "photo_memory_question",
  "institutional_question", "funnel_answer", "buy_now", "objection", "greeting", "smalltalk", "other",
] as const;
export type LeadIntentKind = (typeof LEAD_INTENT_KINDS)[number];
// P0 (audit trava de contexto): a INTENÇÃO do TURNO ATUAL, derivada SÓ do bloco corrente — separada da memória
// (activeTopic/currentLeadIntent podem estar velhos). A decisão prioriza isto sobre a memória. "search" = qualquer
// busca comercial nova (tipo/modelo/orçamento/popular/mais opções).
export const CURRENT_TURN_INTENTS = ["search", "photo_request", "photo_memory", "institutional", "other"] as const;
export type CurrentTurnIntent = (typeof CURRENT_TURN_INTENTS)[number];
export const QUESTION_KINDS = ["price", "detail", "institutional", "photo_memory", "availability", "other"] as const;
export type QuestionKind = (typeof QUESTION_KINDS)[number];
export const COMMITMENT_STATUSES = ["open", "fulfilled", "cancelled"] as const;
export type CommitmentStatus = (typeof COMMITMENT_STATUSES)[number];
export const AGENT_ACTION_KINDS = ["reply", "offer", "send_photos", "answer_detail", "answer_institutional", "ask_funnel", "clarify", "handoff", "none"] as const;
export type AgentActionKind = (typeof AGENT_ACTION_KINDS)[number];

// ── Registros com IDENTIDADE ESTÁVEL (P1-6) ─────────────────────────────────────────────────────────────────
export type ActiveTopic = { readonly topic: string; readonly sinceTurnId: string; readonly origin: TopicOrigin };
export type LeadIntent = { readonly intent: LeadIntentKind; readonly confidence: number; readonly evidence: readonly string[] };
export type UnansweredQuestion = {
  readonly id: string;                 // estável (o engine gera determinístico por turno)
  readonly text: string;
  readonly kind: QuestionKind;
  readonly createdTurnId: string;
  readonly resolvedTurnId: string | null;
  readonly status: "open" | "answered";
};
export type Commitment = {
  readonly id: string;                 // estável
  readonly text: string;
  readonly status: CommitmentStatus;
  readonly createdTurnId: string;
  readonly resolvedTurnId: string | null;
};

// ACCEPTED-SAFE: registra a ação de foto que o provider ACEITOU (receipt). NÃO é entrega/leitura (photoLedger
// canônico segue no ConversationState). Escrita SÓ por EffectOutcomeWorkingMemoryMutation (após receipt).
// A.1 (Codex): a MUTAÇÃO carrega um DRAFT SEM acceptedAt (pré-receipt); o EffectOutcomeCommit preenche
// acceptedAt EXCLUSIVAMENTE com result.receipt.at. Assim a LLM/decisão nunca fabrica o timestamp de aceite.
export type PhotoActionDraft = {
  readonly vehicleKey: string;
  readonly label: string;
  readonly photoIds: readonly string[];
  readonly effectId: string;           // liga ao receipt; triple-check effectId; mismatch rejeita atomicamente
  // Correção 1 (Codex): a RECÊNCIA é semântica, pelo TURNO da ação conversacional — não pelo horário do callback.
  readonly sourceTurnId: string;
  readonly sourceTurnNumber: number;   // ação de turno MAIOR vence, mesmo com receipt.at menor
};
export type PhotoActionMemory = PhotoActionDraft & { readonly acceptedAt: Iso };

// Correção 2 (Codex): SEM summary livre do caller/LLM. Estrutura sanitizada criada pelo ENGINE: tool, status,
// itemCount e factKeys (allowlist de chaves não-sensíveis). CRM NUNCA persiste nome/telefone/CPF/nascimento/payload.
export type ToolResultStatus = "ok" | "not_found" | "error";
export type ToolResultMemory = {
  readonly tool: string;
  readonly status: ToolResultStatus;
  readonly turnId: string;
  readonly itemCount?: number;
  readonly factKeys?: readonly string[];   // ex.: vehicleKeys; nunca PII
};
export type AgentActionMemory = { readonly kind: AgentActionKind; readonly turnId: string };
export type AnsweredQuestionMemory = { readonly question: string; readonly answerSummary: string; readonly turnId: string };

// ── VIEW canônica DERIVADA (read-only) do ConversationState (P0-4) — nunca gravável pela LLM ─────────────────
export type FunnelView = {
  readonly known: readonly SlotName[];
  readonly declined: readonly SlotName[];
  readonly deferred: readonly SlotName[];
  readonly suggestedObjective: SlotName | null;
};
export type SelectedVehicleView = { readonly vehicleKey: string; readonly label: string } | null;
export type OfferView = { readonly vehicleKeys: readonly string[]; readonly turnId: string } | null;

export type CanonicalWorkingMemoryView = {
  readonly funnel: FunnelView;             // canônico: ConversationState.slots/currentObjective
  readonly selectedVehicle: SelectedVehicleView;   // canônico: ConversationState.vehicleContext.selected
  readonly lastOffer: OfferView;           // canônico: ConversationState.lastRenderedOfferContext
};

// ── PERSISTIDO: só o que a WorkingMemory É a autoridade gravável (dentro do state JSONB, mesmo CAS do turno) ──
// ⭐SEM (invariante 3): pergunta de SLOT que a ULTIMA resposta do agente fez + a ultima resposta RESOLVIDA -
// rastreadas na WM pelo ENGINE (infra de memoria, nao decisao da LLM). Uma negacao/afirmacao curta do lead so
// pode resolver o slot da pergunta pendente registrada.
export type PendingAgentQuestionMemory = { readonly slot: string; readonly sinceTurnId: string };
export type ResolvedSlotAnswerMemory = { readonly slot: string; readonly turnId: string };
export type PersistedWorkingMemory = {
  readonly schemaVersion: typeof WORKING_MEMORY_SCHEMA_VERSION;
  readonly activeTopic: ActiveTopic | null;
  readonly currentLeadIntent: LeadIntent | null;
  readonly unansweredLeadQuestions: readonly UnansweredQuestion[];
  readonly lastPhotoAction: PhotoActionMemory | null;   // escrita SÓ por EffectOutcomeCommit (accepted)
  readonly lastToolResults: readonly ToolResultMemory[];
  readonly commitments: readonly Commitment[];
  readonly conversationSummary: string;
  readonly lastAgentAction: AgentActionMemory | null;
  readonly lastAnsweredLeadQuestion: AnsweredQuestionMemory | null;
  readonly pendingAgentQuestion: PendingAgentQuestionMemory | null;    // ⭐SEM: escrita SO pelo engine (sistema)
  readonly lastResolvedSlotAnswer: ResolvedSlotAnswerMemory | null;    // ⭐SEM: escrita SO pelo engine (sistema)
};

// Visão completa que o cérebro recebe = persistido (WM-owned) + view canônica derivada (read-only).
export type WorkingMemoryV1 = PersistedWorkingMemory & CanonicalWorkingMemoryView;

// Inicial da parte PERSISTIDA (no domínio p/ evitar ciclo domain↔engine; usada por createInitialState).
export function createInitialPersistedWorkingMemory(): PersistedWorkingMemory {
  return {
    schemaVersion: WORKING_MEMORY_SCHEMA_VERSION,
    activeTopic: null, currentLeadIntent: null, unansweredLeadQuestions: [], lastPhotoAction: null,
    lastToolResults: [], commitments: [], conversationSummary: "", lastAgentAction: null, lastAnsweredLeadQuestion: null,
    pendingAgentQuestion: null, lastResolvedSlotAnswer: null,
  };
}

// ── Mutações DE DECISÃO (commit) — a LLM propõe; reducer é a única autoridade. SEM funnel/selected/offer/foto ─
// A.2 (Codex): `add_tool_result` NÃO é proposta pela LLM (virou SystemWorkingMemoryMutation, aplicada pelo engine
// só com o resultado REALMENTE executado+autorizado). A.3: TODA mutação carrega turnId/sourceTurnId (inclui intent).
export type DecisionWorkingMemoryMutation =
  | { readonly op: "set_active_topic"; readonly topic: string; readonly origin: TopicOrigin; readonly turnId: string }
  | { readonly op: "set_lead_intent"; readonly intent: LeadIntentKind; readonly confidence: number; readonly evidence: readonly string[]; readonly turnId: string }
  | { readonly op: "add_unanswered_question"; readonly question: UnansweredQuestion }
  | { readonly op: "resolve_unanswered_question"; readonly id: string; readonly resolvedTurnId: string }
  | { readonly op: "add_commitment"; readonly commitment: Commitment }
  | { readonly op: "update_commitment"; readonly id: string; readonly status: CommitmentStatus; readonly resolvedTurnId: string }
  | { readonly op: "set_conversation_summary"; readonly summary: string; readonly turnId: string }
  | { readonly op: "set_last_agent_action"; readonly action: AgentActionMemory }
  | { readonly op: "set_last_answered_question"; readonly answered: AnsweredQuestionMemory };

// ── Mutação de SISTEMA (A.2) — aplicada SÓ pelo ENGINE (determinística), nunca pela LLM. Só resultado de tool
//    REALMENTE executada+autorizada alimenta lastToolResults (summary sanitizado+limitado ANTES de persistir).
export type SystemWorkingMemoryMutation =
  | { readonly op: "record_tool_result"; readonly result: ToolResultMemory }
  // ⭐SEM (invariantes 3/4 - reconciliacao de INFRA pos-entendimento aceito; a LLM nao propoe):
  | { readonly op: "set_pending_agent_question"; readonly question: PendingAgentQuestionMemory | null; readonly turnId: string }
  | { readonly op: "set_resolved_slot_answer"; readonly answer: ResolvedSlotAnswerMemory; readonly turnId: string }
  | { readonly op: "reconcile_turn_semantics"; readonly topic: string | null; readonly intent: LeadIntentKind | null; readonly turnId: string };

// ── Mutação de OUTCOME (só após receipt) — aplicada SÓ pelo fluxo commitEffectOutcome. `mark_photo_action_accepted`
//    é EXCLUSIVA daqui (P0-1). A LLM não tem como propô-la. Carrega DRAFT (sem acceptedAt): o commit preenche
//    acceptedAt = result.receipt.at (A.1).
export type EffectOutcomeWorkingMemoryMutation =
  | { readonly op: "mark_photo_action_accepted"; readonly action: PhotoActionDraft };

export type WorkingMemoryRejection = { readonly mutation: DecisionWorkingMemoryMutation | SystemWorkingMemoryMutation | EffectOutcomeWorkingMemoryMutation; readonly reason: string };
export type WorkingMemoryReducerResult =
  | { readonly ok: true; readonly next: PersistedWorkingMemory }
  | { readonly ok: false; readonly rejected: readonly WorkingMemoryRejection[] };  // rejeição ATÔMICA do lote inteiro

// Diagnóstico tipado do loader (fail-closed por campo — P0-5).
export type WorkingMemoryLoadDiagnostic = { readonly field: string; readonly reason: string };

// ── TurnFrame ───────────────────────────────────────────────────────────────────────────────────────────────
export type FrameTranscriptTurn = { readonly role: "lead" | "agent"; readonly text: string };
// Sinais determinísticos (regex/léxico) que ENRIQUECEM o frame. NUNCA escolhem a ação — só evidência.
export type FrameSignals = {
  readonly mentionsPhoto: boolean;
  readonly mentionsStore: boolean;
  readonly mentionsMoreOptions: boolean;
  readonly mentionsPopular?: boolean;
  readonly mentionsVehicleType: string | null;
  readonly isMemoryQuestion: boolean;
  readonly relation: TurnRelation;
  // P0 (audit trava de contexto): intenção do TURNO ATUAL (só do bloco corrente). A decisão a prioriza sobre a
  // memória; o engine limpa activeTopic/currentLeadIntent velhos de foto quando currentTurnIntent === "search".
  readonly currentTurnIntent?: CurrentTurnIntent;
  // INC2 (P0): no canal WhatsApp o telefone de contato JÁ é conhecido pelo envelope — o cérebro NÃO deve pedir telefone.
  readonly contactPhoneKnown?: boolean;
  // F2.32 (CTWA): o lead veio de um ANÚNCIO cujo veículo (resolvido do texto, aterrado) é este label. CONTEXTO, não
  // resposta do lead — o turno atual e correções vencem. Não pergunte "qual modelo?" se o anúncio já deixou claro.
  readonly adVehicle?: string | null;
  // Fix B (audit CTWA): o lead veio de um anúncio GENÉRICO (sem veículo específico) e ainda não disse o que quer. A
  // ABERTURA deve ser DESCOBERTA comercial (modelo/tipo/faixa), NÃO pedir nome/dado de contato.
  readonly adGenericEntry?: boolean;
  // PARTE A (missão abertura SDR): PRIMEIRO contato SEM anúncio e SEM alvo comercial ("Boa tarde" cru). A ABERTURA deve
  // cumprimentar, apresentar-se conforme o prompt e fazer DESCOBERTA comercial (modelo/tipo/faixa) — NUNCA começar
  // pedindo nome/telefone. Complementa adGenericEntry (que exige anúncio); cobre a "porta fria".
  readonly firstContactNoCommercialTarget?: boolean;
  // PARTE A (missão): ENTRADA por anúncio de veículo ESPECÍFICO. Na abertura, fale do veículo do anúncio e ofereça
  // fotos/detalhes/condições (acolhedor), em vez de despejar uma lista crua ou pedir dados pessoais.
  readonly specificAdEntry?: boolean;
  // Semântica contextual read-only: não escolhe ação, apenas evita que a LLM ignore o ato atual por causa do funil pendente.
  readonly disengagementOnly?: boolean;  // agradecimento/despedida sem pedido novo no mesmo bloco
  readonly acceptedPhotoOffer?: boolean; // afirmação curta aceitou a última pergunta única de envio de fotos
  readonly selectedOfferThisTurn?: boolean; // bloco atual seleciona item/modelo da última oferta; acolher antes do funil
  readonly handoffAvailable?: boolean;
  readonly followupStage?: 1 | 2 | 3;
};
export type TurnFrame = {
  readonly turnId: string;
  readonly now: Iso;
  readonly block: string;
  readonly portalPromptSha256: string;   // prova do prompt (integral vai só no binding do modelo)
  readonly workingMemory: WorkingMemoryV1;   // persistido + view canônica derivada
  readonly recentTranscript: readonly FrameTranscriptTurn[];
  readonly conversationContext: ConversationContext;
  readonly currentTurnFacts: CurrentTurnFacts;
  readonly signals: FrameSignals;
};

// ── Observação factual das tools (P0-3) — SEPARADA da telemetria ────────────────────────────────────────────
// Read-only facts projected from committed conversation state. This is context
// for the LLM, never a second decision maker.
export type ConversationContextOfferItem = {
  readonly ordinal: number;
  readonly vehicleKey: string;
  readonly marca: string | null;
  readonly modelo: string | null;
  readonly ano: number | null;
  readonly cor: string | null;
  readonly preco: number | null;
  readonly cambio: string | null;
  readonly tipo: string | null;
};

export type ConversationContext = {
  readonly lastAgentMessage: string | null;
  readonly pendingAgentQuestion: { readonly slot: string; readonly sinceTurnId: string } | null;
  readonly selectedVehicle: { readonly vehicleKey: string; readonly label: string } | null;
  readonly lastVisibleOffer: { readonly sourceTurnId: string; readonly items: readonly ConversationContextOfferItem[] } | null;
  readonly lastResolvedSlotAnswer: { readonly slot: string; readonly turnId: string } | null;
  readonly conversationSummary: string | null;
};

// Facts extracted from the CURRENT inbound block before the LLM is asked to
// author a reply. They are read-only context: they improve understanding of
// fragmented answers without choosing an intent, tool, effect, or reply.
export type CurrentTurnFact = {
  readonly slot: string;
  readonly kind: "value" | "declined" | "sensitive_ref";
  readonly value?: string | number | boolean | { readonly min?: number; readonly max?: number } | {
    readonly marca?: string;
    readonly modelo?: string;
    readonly ano?: number;
    readonly km?: number;
    readonly estado?: string;
  };
};

export type CurrentTurnFacts = {
  readonly expectedAnswer: { readonly slot: string | null; readonly lastAgentQuestion: string | null };
  readonly extracted: readonly CurrentTurnFact[];
  // A factual match between terms literally written in this block and the
  // last rendered offer. It is not an intent classification or an action.
  readonly offerReference: {
    readonly status: "unique" | "ambiguous";
    readonly candidateVehicleKeys: readonly string[];
    readonly matchedBy: readonly ("marca" | "modelo" | "ano" | "cor")[];
  } | null;
};

export type StoreInfoFact = { readonly topic: "address" | "hours" | "unit"; readonly value: string; readonly source: string };
// União discriminada por tool, ligada ao QueryOutputMap existente (tenant_business_info é local até o inc2).
export type AgentToolObservation =
  | { readonly tool: "stock_search"; readonly ok: true; readonly data: QueryOutputMap["stock_search"] }
  | { readonly tool: "vehicle_details"; readonly ok: true; readonly data: QueryOutputMap["vehicle_details"] }
  | { readonly tool: "vehicle_photos_resolve"; readonly ok: true; readonly data: QueryOutputMap["vehicle_photos_resolve"] }
  | { readonly tool: "crm_read"; readonly ok: true; readonly data: QueryOutputMap["crm_read"] }
  | { readonly tool: "tenant_business_info"; readonly ok: true; readonly data: StoreInfoFact }
  | { readonly tool: string; readonly ok: false; readonly error: { readonly code: string; readonly message: string } };

// Telemetria SANITIZADA (para log/trace): metadados, nunca payload bruto/PII.
export type ToolTelemetry = {
  readonly tool: string;
  readonly ok: boolean;
  readonly ms: number;
  readonly itemCount?: number;
  readonly keys?: readonly string[];
};

// ── AgentBrainDecision + Step + Port ────────────────────────────────────────────────────────────────────────
export type AgentResponsePlan = { readonly guidance: string; readonly draft?: ResponseDraft | null };
export type AgentBrainDecision = {
  readonly reasonCode: string;
  readonly reasonSummary: string;
  readonly confidence: number;
  readonly responsePlan: AgentResponsePlan;
  readonly proposedEffects: readonly ProposedEffectPlan[];             // P0-2: sem effectId (Finalizer materializa)
  readonly memoryMutations: readonly DecisionWorkingMemoryMutation[];  // P0-1: só mutações de DECISÃO (WorkingMemory)
  // R13-Inc2/B item 4 (Codex): o cérebro PODE propor fatos do estado canônico (slots/objetivos/foco). O reducer
  // (state-reducer.applyDecision) é a ÚNICA autoridade de escrita; o Finalizer é a autoridade dos effectIds; a
  // LLM apenas PROPÕE. Aditivo/opcional — decisões que não mexem no estado omitem o campo.
  readonly stateMutations?: readonly DecisionMutation[];
};

// ── Superfície de ferramentas do caminho CENTRAL ──────────────────────────────────────────────────────────────
// tenant_business_info é uma QueryTool LOCAL ao caminho central (não entra no QueryCall do kernel p/ não rippar o
// decision.ts do v2/kernel). O cérebro pode pedir os 4 QueryCall do kernel OU tenant_business_info.
export const BUSINESS_INFO_TOPICS = ["address", "hours", "unit"] as const;
export type BusinessInfoTopic = (typeof BUSINESS_INFO_TOPICS)[number];
export type TenantBusinessInfoCall = { readonly tool: "tenant_business_info"; readonly input: { readonly topic: BusinessInfoTopic } };
export type CentralQueryCall = QueryCall | TenantBusinessInfoCall;

// ── TurnUnderstanding (P0 fonte única): a SEMÂNTICA do bloco atual, produzida pelo cérebro NO MESMO CICLO (sem
//    chamada extra). É a AUTORIDADE ÚNICA do turno — precede activeTopic/currentLeadIntent/lastPhotoAction/
//    selectedVehicle/última oferta. O engine VALIDA que cada evidence.quote existe no bloco atual (anti-alucinação),
//    mas NÃO re-decide a conversa por lista de frases. Substitui a semântica espalhada em regex (isPhotoRequestBlock/
//    deriveCurrentTurnIntent/...). Memória = contexto e resolução de pronome, nunca autoridade acima do pedido atual.
export const PRIMARY_INTENTS = [
  "search_stock", "request_photos", "recall_photos", "select_vehicle", "vehicle_detail",
  "institutional", "financing", "visit", "smalltalk", "other",
  "trade_in", // Missão P0 (audit Codex): resposta à pergunta de TROCA — o carro é do lead, NÃO busca de estoque.
  // ⭐AUTORIDADE (audit Codex): o lead CONTESTA/CORRIGE algo que o AGENTE disse ("Corolla não é um sedan? pq disse que
  // não tinha?"). É conversa (reparo), NUNCA busca — mesmo citando modelo/tipo. A LLM reconhece, corrige e conduz.
  "conversation_repair",
  // ⭐MISSÃO PII (P0-B): pedido EXPLÍCITO de humano/vendedor/atendente é um ATO AUTÔNOMO — vence o funil e
  // NÃO exige CPF/nascimento/qualificação. Evidence obrigatória no bloco atual. A LLM agradece, anuncia a
  // transição e propõe {kind:"handoff", reason:"explicit_human_request"} no MESMO final (saga resolve vendedor).
  "request_human",
  // Resposta do lead com CPF/data de nascimento ja tokenizados no ingest.
  // O cerebro acolhe o dado sem repetir o valor; memoria de visita ou
  // financiamento nao pode transformar esse bloco em outro ato.
  "sensitive_data",
] as const;
export type PrimaryIntent = (typeof PRIMARY_INTENTS)[number];
// Capacidades que o turno PEDE (o engine só autoriza a que tem evidência no bloco).
// "handoff" (MISSÃO PII P0-B): o turno PEDE transferência humana — capability semântica, evidência no bloco.
export const TURN_CAPABILITIES = ["stock_search", "send_photos", "vehicle_details", "institutional_info", "recall", "select", "handoff"] as const;
export type TurnCapability = (typeof TURN_CAPABILITIES)[number];
export const TURN_SUBJECT_KINDS = ["explicit_model", "ordinal_from_last_offer", "offer_reference", "selected_vehicle", "vehicle_type", "budget", "none"] as const;
export type TurnSubjectKind = (typeof TURN_SUBJECT_KINDS)[number];
// De onde vem o subject: escrito no turno atual, herdado da memória, ou inferido/corrigido pelo cérebro (typo kiks→Kicks).
export const SUBJECT_SOURCES = ["current_turn", "memory", "inference", "none"] as const;
export type SubjectSource = (typeof SUBJECT_SOURCES)[number];
export type TurnUnderstandingEvidence = { readonly capability?: TurnCapability; readonly quote: string };
export type TurnUnderstanding = {
  readonly primaryIntent: PrimaryIntent;
  readonly requestedCapabilities: readonly TurnCapability[];
  readonly subject: TurnSubjectKind;
  readonly subjectValue: string | null;    // modelo citado / número do ordinal / tipo / faixa — texto BRUTO p/ resolver alvo
  readonly subjectSource: SubjectSource;
  readonly evidence: readonly TurnUnderstandingEvidence[];   // cada quote TEM de existir no bloco atual
  readonly isTopicChange: boolean;
  readonly answeredLeadQuestions: readonly string[];
};

export type AgentBrainStep =
  // understanding: OPCIONAL no tipo (adapters antigos/estágios), mas o engine trata o VALIDADO como autoridade e cai
  // num fallback determinístico só quando ausente. Emitido em query|final (o engine usa o último não-nulo).
  | { readonly kind: "query"; readonly call: CentralQueryCall; readonly understanding?: TurnUnderstanding }
  | { readonly kind: "final"; readonly decision: AgentBrainDecision; readonly understanding?: TurnUnderstanding };

export interface AgentBrainPort {
  // frame + observações factuais das tools já executadas -> próximo passo (query|final). Loop limitado no engine;
  // cada query autorizada por chamada (POL-STATE-011). As observações são AgentToolObservation (fatos), não texto.
  proposeNextStep(frame: TurnFrame, observations: readonly AgentToolObservation[]): Promise<AgentBrainStep>;
}
