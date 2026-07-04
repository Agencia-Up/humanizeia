// ============================================================================
// Contratos de DECISÃO: mutações, query loop, efeitos, decisão final, política.
// Brain/02 §2.4–2.8 (com correções r2/r3/Fase 1.5).
// ============================================================================
import type {
  Id, VehicleType, TransmissionPreference, PaymentMethod, EntityReference, VehicleFact, ConversationStage,
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
  // item 5 (Codex): o slot pendente foi DEFERIDO neste turno (o lead falou de outra coisa) — incrementa o
  // contador de deferimentos do objetivo pendente. Limite tipado no conductor evita fixação e stall.
  | { op: "defer_objective"; objectiveId: Id }
  | { op: "add_rejected"; modelo: string }
  | { op: "set_planned_objective"; planned: PlannedObjective }
  | { op: "append_lead_turn"; turn: ConversationTurn }
  // item 1 (Codex): ESCOLHA explícita do lead (ordinal da lista ou modelo/vehicleKey citado). Fato INBOUND
  // aplicado no COMMIT da decisão (não depende de receipt). Substitui o selectedVehicleFocus anterior.
  | { op: "select_vehicle_focus"; vehicle: EntityReference; sourceTurnId: Id }
  // item F-3 (Codex): LIMPA o selectedVehicleFocus (nova intenção explícita de veículo, busca ambígua ou
  // sem resultado). Aplicado ANTES de uma nova seleção — foco obsoleto nunca é reutilizado.
  | { op: "clear_vehicle_focus"; sourceTurnId: Id }
  // R10-4 (Codex): progressão de "mais opções esgotadas". Incrementa a cada esgotamento; reset=0 em nova oferta.
  | { op: "set_more_options_exhausted"; value: number }
  | { op: "set_search_transmission"; value: TransmissionPreference | null; sourceTurnId: Id };

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
    // F2.7.7: TODOS os modelos citados no bloco (ex.: "onix ou argo" -> ["onix","argo"]).
    // Aditivo: `model` segue p/ compat; `models` permite responder o bloco inteiro.
    models?: string[];
    price?: number;
  };
};

// ── Query loop (read-only) — Codex #4/r3 #6 ─────────────────────────────────
export type QueryInputMap = {
  stock_search: { tipo?: VehicleType; cambio?: TransmissionPreference; precoMax?: number; modelo?: string; popular?: boolean; broad?: boolean; excludeKeys?: string[] };
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

// 1A.4: um termo de TIPO (suv/sedan/hatch/picape) NUNCA é `modelo`. Se o proponente (LLM) o colocar em
// `modelo`, movemos para `tipo` e removemos de `modelo` — evita stock_search({modelo:"suv"}) que zera a
// busca com estoque real. Aplicado no DECODE da proposta e no runner (defesa em profundidade). Modelo real
// (onix/hb20/...) fica intacto. Função PURA.
// Item 6 (Codex): conflito tipo-em-modelo vs `tipo` explícito DIVERGENTE FALHA FECHADO (não vira o outro
// tipo silenciosamente) — o chamador rejeita a query (decode) ou devolve VALIDATION (runner).
const STOCK_TYPE_WORDS: Readonly<Record<string, VehicleType>> = {
  suv: "suv", suvs: "suv", sedan: "sedan", sedans: "sedan", hatch: "hatch", hatchback: "hatch", hatchbacks: "hatch",
  picape: "pickup", picapes: "pickup", pickup: "pickup", pickups: "pickup", caminhonete: "pickup", caminhonetes: "pickup",
};
export type StockInputNormalization =
  | { readonly ok: true; readonly input: QueryInputMap["stock_search"] }
  | { readonly ok: false; readonly conflict: string };
export function normalizeStockSearchInput(input: QueryInputMap["stock_search"]): StockInputNormalization {
  if (typeof input.modelo !== "string") return { ok: true, input };
  const key = input.modelo.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const asType = STOCK_TYPE_WORDS[key];
  if (!asType) return { ok: true, input };
  if (input.tipo != null && input.tipo !== asType) {
    return { ok: false, conflict: `modelo '${input.modelo}' (tipo ${asType}) conflita com tipo '${input.tipo}'` };
  }
  const { modelo: _drop, ...rest } = input;
  return { ok: true, input: { ...rest, tipo: asType } };
}

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
  // F-4 (Codex): vehicle_ref suporta ATRIBUTOS (ano/km/câmbio/cor) — o valor vem do VehicleFact EXATO no
  // renderer (fail-closed se ausente). Preço continua SÓ por money_ref. Atributo em texto livre é proibido.
  | { type: "vehicle_ref"; vehicleKey: string; field: "marca" | "modelo" | "ano" | "km" | "cambio" | "cor" }
  | { type: "money_ref"; role: MoneyRole; source: MoneySourceRef }
  // F2.7.5: lista de oferta renderizada DETERMINISTICAMENTE (numerada, BRL, km) a partir
  // dos QueryResults. O modelo so escolhe os vehicleKeys; o sistema formata.
  | { type: "vehicle_offer_list"; vehicleKeys: string[] };

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
