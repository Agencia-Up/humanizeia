// ============================================================================
// ConversationState versionado — única fonte operacional do turno (Brain/02 §2.1).
// ============================================================================
import type {
  Id, Iso, VehicleType, TransmissionPreference, PaymentMethod, EntityReference, ConversationStage,
  SlotName, ObjectiveType, AnswerKind, SensitiveValueRef,
} from "./types.ts";
import type { PersistedWorkingMemory, PhotoActionDraft } from "./agent-brain.ts";
import { createInitialPersistedWorkingMemory } from "./agent-brain.ts";

export type FunnelSlot<T> = {
  status: "unknown" | "known" | "declined" | "not_applicable";
  value: T | null;
  sourceTurnId?: Id | null;
  confidence: number;
  updatedAt: Iso;
};
export type SensitiveSlot = {
  status: "unknown" | "known" | "declined" | "not_applicable";
  ref: SensitiveValueRef | null; // nunca o valor
  sourceTurnId?: Id | null;
  updatedAt: Iso;
};

export type FunnelSlots = {
  nome: FunnelSlot<string>;
  interesse: FunnelSlot<string>;
  tipoVeiculo: FunnelSlot<VehicleType>;
  faixaPreco: FunnelSlot<{ min?: number; max?: number }>;
  formaPagamento: FunnelSlot<PaymentMethod>;
  entrada: FunnelSlot<number>;
  possuiTroca: FunnelSlot<boolean>;
  diaHorario: FunnelSlot<string>;
  cpf: SensitiveSlot;
  birthDate: SensitiveSlot;
  parcelaDesejada: FunnelSlot<number>;
  veiculoTroca: FunnelSlot<{ marca?: string; modelo?: string; ano?: number; km?: number; estado?: string }>;
  cidade: FunnelSlot<string>;
  conheceLoja: FunnelSlot<boolean>;
  interesseVisita: FunnelSlot<boolean>;
};

// PLANEJADO: pergunta/oferta aguardando o receipt do effectId (Brain/02 §2.2, Codex r3 #1).
export type PlannedObjective = {
  id: Id;
  activationPlanId: Id; // planId no rascunho de efeitos
  effectId: Id;         // injetado pelo Finalizer: `${turnId}:${activationPlanId}`
  type: ObjectiveType;
  slot?: SlotName | null;
  plannedInTurnId: Id;
  expectedAnswerKinds: AnswerKind[];
};

// ENTREGUE: só existe após o receipt do effectId.
export type PendingObjective = {
  id: Id;
  type: ObjectiveType;
  slot?: SlotName | null;
  askedAt: Iso; // = momento do receipt
  askedInTurnId: Id;
  deliveredByEffectId: Id;
  deliveryLevel: "accepted" | "delivered";
  expectedAnswerKinds: AnswerKind[];
  status: "pending" | "satisfied" | "declined" | "superseded";
  attempts: number;
  deferrals?: number; // item 5: quantas vezes o slot foi DEFERIDO (lead falou de outra coisa) — limite tipado.
};

export type OfferRecord = {
  offerId: Id;
  tipo?: VehicleType | null;
  precoMax?: number | null;
  vehicleKeys: string[];
  at: Iso;
};
export type OfferMemory = { last?: OfferRecord | null; presentedKeys: string[] };
export type VehicleContext = {
  focus?: EntityReference | null;     // veículo APRESENTADO (presentedVehicleFocus, após outcome/entrega)
  selected?: EntityReference | null;  // ESCOLHA EXPLÍCITA do lead (selectedVehicleFocus, fato inbound no commit) — item 1 Codex
};
export type PhotoLedger = { sentByVehicle: Record<string, string[]> }; // vehicleKey -> photoIds confirmados
export type RejectedMemory = { modelos: string[] };
export type ConversationTurn = { role: "lead" | "agent"; text: string; at: Iso };

export type FollowupCycle = {
  anchorEffectId: Id;
  anchorAt: Iso;
  sentStages: Array<1 | 2 | 3>;
  plannedStage: 1 | 2 | 3 | null;
  lastSentAt: Iso | null;
};

// F2.7.12: memória OPERACIONAL da última lista renderizada (vehicle_offer_list), p/ resolver
// referência ORDINAL ("foto do 3") de forma estruturada — SEM parse de texto, SEM depender do
// callback delivered. NÃO é o ledger oficial de oferta entregue (offers.last); é só contexto.
export type RenderedOfferItem = {
  ordinal: number;            // 1-based, na ordem renderizada
  vehicleKey: string;
  marca?: string | null;
  modelo?: string | null;
  ano?: number | null;
  // R13 Inc2/G: preço aterrado da oferta (para grounding de MEMÓRIA: um preço já ofertado pode ser citado num
  // turno posterior sem re-consultar). Aditivo/opcional.
  preco?: number | null;
  cor?: string | null;
  cambio?: string | null;
  // F2.29: tipo aterrado (classificado do fato) — permite DERIVAR escopo mínimo p/ "mais opções" quando a oferta é
  // HOMOGÊNEA e não há activeSearchConstraints persistido (invariante 3). Aditivo/opcional.
  tipo?: VehicleType | null;
};
export type LastRenderedOfferContext = {
  sourceTurnId: Id;
  createdAt: Iso;
  items: RenderedOfferItem[];
};

// P0 (F2.26): FILTRO DE BUSCA ATIVO acumulado ao longo dos turnos (o lead refina a MESMA intenção de estoque em turnos
// separados). Mergeado de forma conservadora (cada dimensão do bloco atual substitui a antiga; ausente preserva). SÓ é
// atualizado em turno de BUSCA (foto/detalhe/institucional não tocam). Tipo do DOMÍNIO; o engine (commercial-constraints)
// reusa esta forma. modelos[] cobre "Palio ou Gol".
export type ActiveSearchConstraints = {
  marca?: string;
  modelos?: string[];
  tipo?: VehicleType;
  precoMax?: number;
  cambio?: TransmissionPreference;
  hibrido?: boolean;
  popular?: boolean;
  anos?: number[];   // F2.28: anos RÍGIDOS ("13/14/15" -> [2013,2014,2015]; "2013 a 2015" -> range). Filtro duro.
};

// F2.32 (CTWA/Facebook Ads): CONTEXTO de anúncio Click-to-WhatsApp. É CONTEXTO da conversa, NÃO resposta do lead. Vem
// sanitizado do externalAdReply do Meta (bridge). Persiste no state; herda em rajada (mensagens seguintes sem referral).
// O ENGINE resolve o veículo do anúncio a partir do texto e dos fatos semânticos extraídos da imagem. O resultado visual
// é somente contexto factual para a LLM; o turno atual e correções do lead SEMPRE vencem o anúncio.
export type AdContext = {
  adId: string | null;          // externalAdReply.sourceID (ad_id do Meta — sinal determinístico p/ futura Layer 0)
  source: string | null;        // conversionSource (FB_Ads) OU host (facebook/instagram/fb.me)
  sourceUrl: string | null;     // externalAdReply.sourceURL (fb.me/…)
  title: string | null;         // externalAdReply.title
  body: string | null;          // externalAdReply.body
  greeting: string | null;      // externalAdReply.greetingMessageBody (saudação — costuma ser genérica)
  imageUrls: string[];          // [originalImageURL, thumbnailURL]
  vehicleQuery?: string | null; // leitura semântica da arte, sem autoridade de intent/tool/resposta
  vehicleType?: string | null;
  summary?: string | null;
  confidence?: number;
  semanticSource?: "text" | "image" | "mixed" | null;
  capturedAtTurn: number;       // turnNumber quando capturado (herança/expiração em rajada)
};

export type ConversationState = {
  schemaVersion: number;
  version: number; // CAS
  conversationId: Id;
  tenantId: Id;
  agentId: Id;
  leadId?: Id | null;
  turnNumber: number;
  stage: ConversationStage;            // ENTREGUE: só avança via EffectOutcome
  currentObjective?: PendingObjective | null;  // ATIVO só após receipt
  plannedObjectives: PlannedObjective[];        // PLANEJADO
  slots: FunnelSlots;
  vehicleContext: VehicleContext;      // foco apresentado (após entrega)
  offers: OfferMemory;
  lastRenderedOfferContext: LastRenderedOfferContext | null; // memória operacional p/ referência ordinal
  activeSearchConstraints?: ActiveSearchConstraints | null; // F2.26: filtro de busca acumulado (merge conservador entre turnos)
  adContext?: AdContext | null;        // F2.32: contexto do anúncio CTWA (persiste + herda em rajada; turno atual sempre vence)
  moreOptionsExhausted?: number; // R10-4: nº de esgotamentos consecutivos de "mais opções" (progressão; reset=0 em nova oferta)
  searchPreferences?: { transmission: TransmissionPreference | null };
  photoLedger: PhotoLedger;
  rejected: RejectedMemory;
  recentTurns: ConversationTurn[];
  followupCycle?: FollowupCycle | null;
  // Handoff concluído ou planejado suspende o follow-up. Uma nova fala do
  // lead posterior a este instante reativa a conversa e permite novo ciclo.
  followupSuspendedAt?: Iso | null;
  // ⭐R8 (Codex 2026-07-15): OPT-OUT DURÁVEL. Timestamp do 1º desinteresse EXPLÍCITO do lead ("me tira da lista", "pare de
  // mandar mensagens", "não me interessa", "não quero comprar" — sinal not_interested). Persiste no state e faz o follow-up
  // (evaluateFollowup) PARAR de re-armar T1/T2/T3 mesmo quando o handoff NÃO é plannable (leadId null / vendedor ausente).
  // NÃO é stage=closed. Idempotente: setado uma vez, turnos posteriores NÃO limpam nem reabrem. Aditivo/opcional (retrocompat).
  optedOutAt?: Iso | null;
  appliedEffectIds: string[];          // idempotência do EffectOutcomeCommit (Codex r3 #2) — fase DELIVERED (estado/ledger)
  // R13 Inc2/B item 2 (Codex): idempotência INDEPENDENTE da fase ACCEPTED (WorkingMemory lastPhotoAction). Separada
  // de appliedEffectIds/outcomeAppliedAt (que governam a fase delivered): um único marcador NÃO pode impedir a fase
  // delivered posterior. Aditivo/opcional p/ retrocompat com estados antigos (default []).
  appliedAcceptedEffectIds?: string[];
  // R13 Inc2/B item 2: draft accepted-safe da ação de foto capturado no COMMIT do turno (effectId -> PhotoActionDraft
  // com o sourceTurnNumber exato). Promovido à WorkingMemory.lastPhotoAction só no receipt accepted (newer-wins).
  pendingPhotoActions?: Record<string, PhotoActionDraft>;
  // R13 Inc2/B (Codex): WorkingMemory PERSISTIDA dentro do MESMO state JSONB (mesma tx CAS do turno; receipt no
  // EffectOutcomeCommit). Sessão isolada por tenantId+agentId+conversationId (já são chaves do estado). Opcional
  // p/ retrocompat com estados antigos — carregada via loadPersistedWorkingMemory (fail-closed).
  workingMemory?: PersistedWorkingMemory;
  updatedAt: Iso;
};

function unknownSlot<T>(now: Iso): FunnelSlot<T> {
  return { status: "unknown", value: null, confidence: 0, updatedAt: now };
}

export function createInitialState(args: {
  conversationId: Id; tenantId: Id; agentId: Id; leadId?: Id | null; now?: Iso;
}): ConversationState {
  const now = args.now ?? new Date(0).toISOString();
  return {
    schemaVersion: 1,
    version: 0,
    conversationId: args.conversationId,
    tenantId: args.tenantId,
    agentId: args.agentId,
    leadId: args.leadId ?? null,
    turnNumber: 0,
    stage: "greeting",
    currentObjective: null,
    plannedObjectives: [],
    slots: {
      nome: unknownSlot(now),
      interesse: unknownSlot(now),
      tipoVeiculo: unknownSlot(now),
      faixaPreco: unknownSlot(now),
      formaPagamento: unknownSlot(now),
      entrada: unknownSlot(now),
      possuiTroca: unknownSlot(now),
      diaHorario: unknownSlot(now),
      cpf: { status: "unknown", ref: null, updatedAt: now },
      birthDate: { status: "unknown", ref: null, updatedAt: now },
      parcelaDesejada: unknownSlot(now),
      veiculoTroca: unknownSlot(now),
      cidade: unknownSlot(now),
      conheceLoja: unknownSlot(now),
      interesseVisita: unknownSlot(now),
    },
    vehicleContext: { focus: null, selected: null },
    offers: { last: null, presentedKeys: [] },
    lastRenderedOfferContext: null,
    activeSearchConstraints: null,
    adContext: null,
    searchPreferences: { transmission: null },
    photoLedger: { sentByVehicle: {} },
    rejected: { modelos: [] },
    recentTurns: [],
    followupCycle: null,
    followupSuspendedAt: null,
    appliedEffectIds: [],
    appliedAcceptedEffectIds: [],
    pendingPhotoActions: {},
    workingMemory: createInitialPersistedWorkingMemory(),
    updatedAt: now,
  };
}
