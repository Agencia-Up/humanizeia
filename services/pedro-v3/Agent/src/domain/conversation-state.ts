// ============================================================================
// ConversationState versionado — única fonte operacional do turno (Brain/02 §2.1).
// ============================================================================
import type {
  Id, Iso, VehicleType, PaymentMethod, EntityReference, ConversationStage,
  SlotName, ObjectiveType, AnswerKind, SensitiveValueRef,
} from "./types.ts";

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
};

export type OfferRecord = {
  offerId: Id;
  tipo?: VehicleType | null;
  precoMax?: number | null;
  vehicleKeys: string[];
  at: Iso;
};
export type OfferMemory = { last?: OfferRecord | null; presentedKeys: string[] };
export type VehicleContext = { focus?: EntityReference | null };
export type PhotoLedger = { sentByVehicle: Record<string, string[]> }; // vehicleKey -> photoIds confirmados
export type RejectedMemory = { modelos: string[] };
export type ConversationTurn = { role: "lead" | "agent"; text: string; at: Iso };

// F2.7.12: memória OPERACIONAL da última lista renderizada (vehicle_offer_list), p/ resolver
// referência ORDINAL ("foto do 3") de forma estruturada — SEM parse de texto, SEM depender do
// callback delivered. NÃO é o ledger oficial de oferta entregue (offers.last); é só contexto.
export type RenderedOfferItem = {
  ordinal: number;            // 1-based, na ordem renderizada
  vehicleKey: string;
  marca?: string | null;
  modelo?: string | null;
  ano?: number | null;
};
export type LastRenderedOfferContext = {
  sourceTurnId: Id;
  createdAt: Iso;
  items: RenderedOfferItem[];
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
  photoLedger: PhotoLedger;
  rejected: RejectedMemory;
  recentTurns: ConversationTurn[];
  appliedEffectIds: string[];          // idempotência do EffectOutcomeCommit (Codex r3 #2)
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
      parcelaDesejada: unknownSlot(now),
      veiculoTroca: unknownSlot(now),
      cidade: unknownSlot(now),
      conheceLoja: unknownSlot(now),
      interesseVisita: unknownSlot(now),
    },
    vehicleContext: { focus: null },
    offers: { last: null, presentedKeys: [] },
    lastRenderedOfferContext: null,
    photoLedger: { sentByVehicle: {} },
    rejected: { modelos: [] },
    recentTurns: [],
    appliedEffectIds: [],
    updatedAt: now,
  };
}
