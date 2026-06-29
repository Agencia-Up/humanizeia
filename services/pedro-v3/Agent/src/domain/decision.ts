// ============================================================================
// Contratos de DECISÃO: mutações, query loop, efeitos, decisão final, política.
// Brain/02 §2.4–2.8 (com correções r2/r3/Fase 1.5).
// ============================================================================
import type {
  Id, VehicleType, PaymentMethod, EntityReference, VehicleFact, ConversationStage,
  SlotName, ObjectiveType, SensitiveValueRef, Redacted, JsonValue, RedactedText,
} from "./types.ts";
import type { PlannedObjective, OfferRecord, ConversationTurn } from "./conversation-state.ts";

// ── Ações ───────────────────────────────────────────────────────────────────
export type TurnAction =
  | "reply" | "clarify" | "collect_slot" | "search_stock" | "send_photos"
  | "answer_vehicle_question" | "schedule_visit" | "handoff" | "close" | "no_op";

// ── Mutações de DECISÃO (fatos do inbound, no commit) — Codex r3 #1 ──────────
export type SlotMutation =
  | { op: "set_slot"; slot: "nome"; value: string; confidence: number; sourceTurnId: Id }
  | { op: "set_slot"; slot: "interesse"; value: string; confidence: number; sourceTurnId: Id }
  | { op: "set_slot"; slot: "tipoVeiculo"; value: VehicleType; confidence: number; sourceTurnId: Id }
  | { op: "set_slot"; slot: "faixaPreco"; value: { min?: number; max?: number }; confidence: number; sourceTurnId: Id }
  | { op: "set_slot"; slot: "formaPagamento"; value: PaymentMethod; confidence: number; sourceTurnId: Id }
  | { op: "set_slot"; slot: "entrada"; value: number; confidence: number; sourceTurnId: Id }
  | { op: "set_slot"; slot: "possuiTroca"; value: boolean; confidence: number; sourceTurnId: Id }
  | { op: "set_slot"; slot: "diaHorario"; value: string; confidence: number; sourceTurnId: Id }
  | { op: "set_slot_ref"; slot: "cpf"; ref: SensitiveValueRef; sourceTurnId: Id }
  | { op: "set_slot"; slot: "parcelaDesejada"; value: number; confidence: number; sourceTurnId: Id }
  | { op: "set_slot"; slot: "veiculoTroca"; value: { marca?: string; modelo?: string; ano?: number; km?: number; estado?: string }; confidence: number; sourceTurnId: Id }
  | { op: "set_slot"; slot: "cidade"; value: string; confidence: number; sourceTurnId: Id }
  | { op: "set_slot"; slot: "conheceLoja"; value: boolean; confidence: number; sourceTurnId: Id }
  | { op: "set_slot"; slot: "interesseVisita"; value: boolean; confidence: number; sourceTurnId: Id };

export type DecisionMutation =
  | SlotMutation
  | { op: "resolve_objective"; objectiveId: Id; status: "satisfied" | "declined" }
  | { op: "supersede_objective"; objectiveId: Id }
  | { op: "add_rejected"; modelo: string }
  | { op: "set_planned_objective"; planned: PlannedObjective }
  | { op: "append_lead_turn"; turn: ConversationTurn };

// ── Mutações de OUTCOME (após receipt) — Codex r3 #1 ─────────────────────────
export type EffectOutcomeMutation =
  | { op: "activate_objective"; effectId: Id; plannedObjectiveId: Id }
  | { op: "mark_message_delivered"; effectId: Id; messageId: string }
  | { op: "record_offer"; effectId: Id; offer: OfferRecord }
  | { op: "set_presented_vehicle_focus"; effectId: Id; vehicle: EntityReference }
  | { op: "mark_photos_sent"; effectId: Id; vehicleKey: string; photoIds: string[] }
  | { op: "advance_stage"; effectId: Id; stage: ConversationStage }
  | { op: "mark_handoff_completed"; effectId: Id; sellerId: string }
  | { op: "append_assistant_turn"; effectId: Id; turn: ConversationTurn };

// ── TurnInterpreter / TurnRelation ──────────────────────────────────────────
export type TurnRelation =
  | "answers_pending"
  | "direction_change"
  | "continues_offer"
  | "asks_vehicle_detail"
  | "ambiguous"
  | "unrelated";

export type TurnInterpretation = {
  relation: TurnRelation;
  intentSummary?: string;
  extractedEntities?: {
    model?: string;
    price?: number;
  };
};

// ── Query loop (read-only) — Codex #4/r3 #6 ─────────────────────────────────
export type QueryInputMap = {
  stock_search: { tipo?: VehicleType; precoMax?: number; modelo?: string; broad?: boolean; excludeKeys?: string[] };
  vehicle_details: { vehicleKey: string };
  vehicle_photos_resolve: { vehicleRef: EntityReference };
  crm_read: { leadId: string };
};
export type QueryOutputMap = {
  stock_search: { items: VehicleFact[]; filtersUsed: Record<string, JsonValue> };
  vehicle_details: { vehicle: VehicleFact };
  vehicle_photos_resolve: { vehicleKey: string; ambiguous: boolean; photoIds: string[] };
  crm_read: { leadId: string; name?: string | null };
};
export type QueryName = keyof QueryInputMap;
export type QueryCall = { [N in QueryName]: { tool: N; input: QueryInputMap[N] } }[QueryName];

export type QueryResult = {
  [N in QueryName]:
    | { ok: true; tool: N; data: QueryOutputMap[N]; source: string }
    | { ok: false; tool: N; error: ToolError }
}[QueryName];

export type ToolError = { code: "TIMEOUT" | "NOT_FOUND" | "UPSTREAM" | "VALIDATION" | "FORBIDDEN"; message: string; retryable: boolean };

// ── Effect plans (união semântica) — Codex r3 #4 + outcomes r3.5 #2 ─────────
export type EffectKind = "send_message" | "send_media" | "crm_write" | "schedule_visit" | "handoff" | "notify_seller";
export type EffectPlanBase = {
  planId: Id;
  effectId: Id; // exato: turnId:planId
  order: number;
  dependsOn?: Id[];
  onSuccess: EffectOutcomeMutation[]; // o que aplicar no estado ao receber receipt
};
export type SendMessagePlan = EffectPlanBase & { kind: "send_message" };
export type SendMediaPlan = EffectPlanBase & { kind: "send_media"; vehicleKey: string; photoIds: string[] };
export type CrmWritePlan = EffectPlanBase & { kind: "crm_write"; leadId: string; fields: Record<string, JsonValue> };
export type SchedulePlan = EffectPlanBase & { kind: "schedule_visit"; leadId: string; slot: string };
export type HandoffPlan = EffectPlanBase & { kind: "handoff"; leadId: string; sellerId: string };
export type NotifySellerPlan = EffectPlanBase & { kind: "notify_seller"; sellerId: string; reason: string };
export type EffectPlan = SendMessagePlan | SendMediaPlan | CrmWritePlan | SchedulePlan | HandoffPlan | NotifySellerPlan;

export const COMMERCIAL_EFFECT_KINDS: EffectKind[] = ["send_media", "crm_write", "schedule_visit", "handoff", "notify_seller"];

// ── Receipts / EffectResult discriminado — Codex r3.5 #4 ────────────────────
export type ReceiptLevel = "accepted" | "delivered";
export type EffectReceipt = {
  effectId: Id; level: ReceiptLevel; providerMessageId?: string;
  perItem?: { photoId: string; status: "succeeded" | "failed" }[];
  at: string;
};
export type EffectResult =
  | { status: "succeeded"; effectId: Id; receipt: EffectReceipt }
  | { status: "failed"; effectId: Id; error: ToolError }
  | { status: "outcome_uncertain"; effectId: Id; metadata: Redacted<{ [k: string]: JsonValue }> };

// ── Política / decisão ──────────────────────────────────────────────────────
export type PolicyVerdict = {
  policyId: string;
  outcome: "allow" | "deny";
  requirements?: SlotName[];
  violations?: string[];
  detail?: string;
};

export type ResponsePlan = { guidance: string; };

export type ProposedEffectPlan =
  | (Omit<SendMessagePlan, "effectId"> & { effectId?: Id })
  | (Omit<SendMediaPlan, "effectId"> & { effectId?: Id })
  | (Omit<CrmWritePlan, "effectId"> & { effectId?: Id })
  | (Omit<SchedulePlan, "effectId"> & { effectId?: Id })
  | (Omit<HandoffPlan, "effectId"> & { effectId?: Id })
  | (Omit<NotifySellerPlan, "effectId"> & { effectId?: Id });

export type ProposedDecision = {
  proposedAction: TurnAction;
  target?: EntityReference | null;
  facts: DecisionMutation[];          // fatos do inbound (commit)
  proposedEffects: ProposedEffectPlan[];      // planos de efeito (sem payload materializado)
  nextPlanned?: PlannedObjective | null;
  responsePlan: ResponsePlan;
  reasonCode: string; reasonSummary: string; confidence: number;
};

export type TurnDecision = {
  turnId: Id;
  action: TurnAction;
  target?: EntityReference | null;
  reasonCode: string; reasonSummary: string; confidence: number;
  decisionMutations: DecisionMutation[];
  effectPlan: EffectPlan[];
  responsePlan: ResponsePlan;
  policyChecks: PolicyVerdict[];
};

export type DecisionStep =
  | { kind: "query"; call: QueryCall }
  | { kind: "final"; proposal: ProposedDecision };

// ── TenantCatalog — entradas estruturadas (Fase 1.5) ────────────────────────
export type CatalogEntry = {
  vehicleKey: string;    // ex: "jeep|renegade|2024"
  brand: string;         // ex: "Jeep"
  model: string;         // ex: "Renegade"
  aliases: string[];     // ex: ["renegade sport", "renegade 1.3"]
};

export type TenantCatalog = {
  entries: CatalogEntry[];
};

// ── ClaimExtractor — interface injetada para detecção de alegações (Fase 1.5) ─
export type AutomotiveClaim = {
  kind: "brand" | "model" | "brand_model";
  text: string;           // fragmento original extraído
  normalized: string;     // normalizado para comparação
};

export interface ClaimExtractor {
  extractClaims(text: string): AutomotiveClaim[];
}

// ── MoneyRole × MoneySource (Fase 1.4/1.5: matriz estrita) ──────────────────
export type MoneyRole = "vehicle_price" | "down_payment" | "installment" | "budget";

export type MoneySourceRef =
  | { kind: "vehicle_fact"; vehicleKey: string }
  | { kind: "slot_value"; slotName: SlotName };

// ── ResponseDraft / ResponsePart (Fase 1.5: "preco" removido de vehicle_ref) ──
export type ResponsePart =
  | { type: "text"; content: string }
  | { type: "vehicle_ref"; vehicleKey: string; field: "marca" | "modelo" | "ano" }
  | { type: "money_ref"; role: MoneyRole; source: MoneySourceRef };

export type ResponseDraft = {
  parts: ResponsePart[];
};

export type RenderedResponse = {
  draft: ResponseDraft;
  text: string;
};

// ── Ações comerciais que exigem grounding total em TextPart (Fase 1.5) ──────
export const COMMERCIAL_ACTIONS: readonly TurnAction[] = [
  "search_stock", "send_photos", "answer_vehicle_question",
] as const;
