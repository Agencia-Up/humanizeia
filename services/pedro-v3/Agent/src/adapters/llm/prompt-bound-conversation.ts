import type { TurnContext } from "../../domain/context.ts";
import type {
  DecisionStep,
  ProposedDecision,
  QueryCall,
  QueryResult,
  ResponseDraft,
  ResponsePart,
  TurnAction,
  TurnDecision,
  TurnInterpretation,
} from "../../domain/decision.ts";
import { normalizeStockSearchInput } from "../../domain/decision.ts";
import type { DecisionLlm } from "../../domain/llm.ts";
import type {
  ModelBinding,
  ModelTurnSnapshot,
  StructuredConversationModel,
  TurnUnderstanding,
} from "../../domain/conversation-model.ts";
import type { TenantRuntimeConfig } from "../../domain/read-ports.ts";
import { applyDecision } from "../../engine/state-reducer.ts";
import { deriveModelContext } from "../../engine/model-context-view.ts";

const ACTIONS = new Set<TurnAction>([
  "reply", "clarify", "collect_slot", "search_stock", "send_photos",
  "answer_vehicle_question", "schedule_visit", "handoff", "close", "no_op",
]);
const RELATIONS = new Set<TurnInterpretation["relation"]>([
  "answers_pending", "direction_change", "continues_offer", "asks_vehicle_detail",
  "ambiguous", "unrelated",
]);
const QUERY_TOOLS = new Set(["stock_search", "vehicle_details", "vehicle_photos_resolve", "crm_read"]);
const EFFECT_KINDS = new Set(["send_message", "send_media", "crm_write", "schedule_visit", "handoff", "notify_seller"]);
const MUTATION_OPS = new Set([
  "set_slot", "set_slot_ref", "resolve_objective", "supersede_objective",
  "add_rejected", "set_planned_objective", "append_lead_turn",
]);
const MONEY_ROLES = new Set(["vehicle_price", "down_payment", "installment", "budget"]);
const SLOT_NAMES = new Set([
  "nome", "interesse", "tipoVeiculo", "faixaPreco", "formaPagamento", "entrada",
  "possuiTroca", "diaHorario", "cpf", "parcelaDesejada", "veiculoTroca", "cidade",
  "conheceLoja", "interesseVisita",
]);
const OBJECTIVE_TYPES = new Set([
  "perguntou_pagamento", "perguntou_troca", "perguntou_dados", "ofereceu_fotos", "ofereceu_opcoes",
]);
const ANSWER_KINDS = new Set(["valor", "negacao", "parcela", "nome", "data", "boolean", "modelo", "afirmacao"]);
const STAGES = new Set(["greeting", "discovery", "offering", "negotiating", "scheduling", "handoff", "closed"]);
const OUTCOME_OPS = new Set([
  "activate_objective", "mark_message_delivered", "record_offer", "set_presented_vehicle_focus",
  "mark_photos_sent", "advance_stage", "mark_handoff_completed", "append_assistant_turn",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isNonEmptyString);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

function immutableCopy<T>(value: T): T {
  return deepFreeze(structuredClone(value));
}

export class ModelOutputError extends Error {
  // `detail` (F2.6R) nomeia QUAL campo do envelope falhou (ex.: "proposedEffects", "responsePlan.guidance"),
  // p/ diagnosticar o desalinhamento prompt<->contrato pelo banco (v3_decisions.reason_summary). So nome de
  // campo/checagem â€” nunca dado do modelo. Diagnostico, nao muda o controle de fluxo (segue terminal-safe).
  constructor(public readonly code:
    | "MODEL_INTERPRETATION_INVALID" | "MODEL_DECISION_INVALID" | "MODEL_RESPONSE_INVALID"
    | "MODEL_INTERPRETATION_FAILURE" | "MODEL_DECISION_FAILURE" | "MODEL_RESPONSE_FAILURE",
    public readonly detail?: string) {
    super(detail ? `${code}:${detail}` : code);
    this.name = "ModelOutputError";
  }
}

export function createModelBinding(config: TenantRuntimeConfig): ModelBinding {
  if (!isNonEmptyString(config.promptText)) throw new ModelOutputError("MODEL_DECISION_INVALID");
  return deepFreeze({
    tenantId: config.tenantId,
    agentId: config.agentId,
    agentName: config.agentName,
    companyName: config.companyName,
    systemPrompt: config.promptText,
    promptSource: config.promptSource,
    promptVersion: config.versionStamp,
    model: config.model,
    temperature: config.temperature,
  });
}

function snapshot(ctx: TurnContext): ModelTurnSnapshot {
  return immutableCopy({
    turnId: ctx.turnId,
    now: ctx.now,
    leadMessage: ctx.leadMessage,
    state: ctx.state,
    tenantCatalog: ctx.tenantCatalog,
    interpretation: ctx.interpretation,
    // F2.7.4 (E): contexto explicito (transcript/ultima fala/ja apresentado/fatos/objetivo/interesse)
    // derivado de forma PURA do estado+interpretacao â€” o modelo nao precisa garimpar o state cru.
    context: deriveModelContext(ctx.state, ctx.interpretation, { leadMessage: ctx.leadMessage, claimExtractor: ctx.claimExtractor }),
  });
}

function decodeInterpretation(value: unknown): TurnInterpretation {
  if (!isRecord(value) || !RELATIONS.has(value.relation as TurnInterpretation["relation"])) {
    throw new ModelOutputError("MODEL_INTERPRETATION_INVALID");
  }
  if (value.intentSummary !== undefined && typeof value.intentSummary !== "string") {
    throw new ModelOutputError("MODEL_INTERPRETATION_INVALID");
  }
  let extractedEntities: TurnInterpretation["extractedEntities"];
  if (value.extractedEntities !== undefined) {
    if (!isRecord(value.extractedEntities)) throw new ModelOutputError("MODEL_INTERPRETATION_INVALID");
    const model = value.extractedEntities.model;
    const models = value.extractedEntities.models;
    const price = value.extractedEntities.price;
    if (model !== undefined && !isNonEmptyString(model)) throw new ModelOutputError("MODEL_INTERPRETATION_INVALID");
    if (models !== undefined && !isStringArray(models)) throw new ModelOutputError("MODEL_INTERPRETATION_INVALID");
    if (price !== undefined && (typeof price !== "number" || !Number.isFinite(price) || price < 0)) {
      throw new ModelOutputError("MODEL_INTERPRETATION_INVALID");
    }
    extractedEntities = {
      ...(model === undefined ? {} : { model }),
      ...(models === undefined ? {} : { models }),
      ...(price === undefined ? {} : { price }),
    };
  }
  return immutableCopy({
    relation: value.relation as TurnInterpretation["relation"],
    ...(value.intentSummary === undefined ? {} : { intentSummary: value.intentSummary }),
    ...(extractedEntities === undefined ? {} : { extractedEntities }),
  });
}

function validQueryCall(value: unknown): value is QueryCall {
  if (!isRecord(value) || !QUERY_TOOLS.has(String(value.tool)) || !isRecord(value.input)) return false;
  const input = value.input;
  switch (value.tool) {
    case "stock_search":
      return (input.tipo === undefined || ["suv", "sedan", "hatch", "pickup", "unknown"].includes(String(input.tipo))) &&
        (input.precoMax === undefined || (typeof input.precoMax === "number" && Number.isFinite(input.precoMax) && input.precoMax > 0)) &&
        (input.cambio === undefined || input.cambio === "automatic" || input.cambio === "manual") &&
        (input.modelo === undefined || isNonEmptyString(input.modelo)) &&
        (input.broad === undefined || typeof input.broad === "boolean") &&
        (input.excludeKeys === undefined || isStringArray(input.excludeKeys));
    case "vehicle_details":
      return isNonEmptyString(input.vehicleKey);
    case "vehicle_photos_resolve":
      return isRecord(input.vehicleRef) && input.vehicleRef.kind === "vehicle" && isNonEmptyString(input.vehicleRef.key);
    case "crm_read":
      return isNonEmptyString(input.leadId);
    default:
      return false;
  }
}

function validTurn(value: unknown, role: "lead" | "agent"): boolean {
  return isRecord(value) && value.role === role && typeof value.text === "string" && isNonEmptyString(value.at);
}

function validEntityReference(value: unknown): boolean {
  return isRecord(value) && ["vehicle", "lead", "slot"].includes(String(value.kind)) && isNonEmptyString(value.key) &&
    (value.label === undefined || value.label === null || typeof value.label === "string");
}

function validPlannedObjective(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return isNonEmptyString(value.id) && isNonEmptyString(value.activationPlanId) &&
    (value.effectId === undefined || isNonEmptyString(value.effectId)) &&
    OBJECTIVE_TYPES.has(String(value.type)) &&
    (value.slot === undefined || value.slot === null || SLOT_NAMES.has(String(value.slot))) &&
    isNonEmptyString(value.plannedInTurnId) && Array.isArray(value.expectedAnswerKinds) &&
    value.expectedAnswerKinds.every((kind) => ANSWER_KINDS.has(String(kind)));
}

function validMutation(value: unknown): boolean {
  if (!isRecord(value) || !MUTATION_OPS.has(String(value.op))) return false;
  if (value.op === "set_planned_objective") return validPlannedObjective(value.planned);
  if (value.op === "append_lead_turn") return validTurn(value.turn, "lead");
  if (value.op === "set_slot") {
    return SLOT_NAMES.has(String(value.slot)) && value.slot !== "cpf" && "value" in value &&
      typeof value.confidence === "number" && Number.isFinite(value.confidence) &&
      isNonEmptyString(value.sourceTurnId);
  }
  if (value.op === "set_slot_ref") {
    return value.slot === "cpf" && isRecord(value.ref) && isNonEmptyString(value.ref.ref) &&
      ["cpf", "secret"].includes(String(value.ref.kind)) && isNonEmptyString(value.sourceTurnId);
  }
  if (value.op === "resolve_objective") {
    return isNonEmptyString(value.objectiveId) && ["satisfied", "declined"].includes(String(value.status));
  }
  if (value.op === "supersede_objective") return isNonEmptyString(value.objectiveId);
  if (value.op === "add_rejected") return isNonEmptyString(value.modelo);
  return false;
}

function validOutcome(value: unknown): boolean {
  if (!isRecord(value) || !OUTCOME_OPS.has(String(value.op))) return false;
  if (value.effectId !== undefined && !isNonEmptyString(value.effectId)) return false;
  switch (value.op) {
    case "activate_objective": return isNonEmptyString(value.plannedObjectiveId);
    case "mark_message_delivered": return isNonEmptyString(value.messageId);
    case "record_offer": {
      if (!isRecord(value.offer)) return false;
      return isNonEmptyString(value.offer.offerId) &&
        (value.offer.tipo === undefined || value.offer.tipo === null || ["suv", "sedan", "hatch", "pickup", "unknown"].includes(String(value.offer.tipo))) &&
        (value.offer.precoMax === undefined || value.offer.precoMax === null || (typeof value.offer.precoMax === "number" && Number.isFinite(value.offer.precoMax) && value.offer.precoMax >= 0)) &&
        isStringArray(value.offer.vehicleKeys) && isNonEmptyString(value.offer.at);
    }
    case "set_presented_vehicle_focus": return validEntityReference(value.vehicle);
    case "mark_photos_sent": return isNonEmptyString(value.vehicleKey) && isStringArray(value.photoIds);
    case "advance_stage": return STAGES.has(String(value.stage));
    // HF-1: sellerId é resolvido pela saga no dispatch — o outcome do plano não o afirma.
    case "mark_handoff_completed": return value.sellerId === undefined || isNonEmptyString(value.sellerId);
    case "append_assistant_turn": return validTurn(value.turn, "agent");
    default: return false;
  }
}

function validEffect(value: unknown): boolean {
  if (!isRecord(value) || !EFFECT_KINDS.has(String(value.kind)) || !isNonEmptyString(value.planId)) return false;
  if (typeof value.order !== "number" || !Number.isInteger(value.order) || value.order < 0) return false;
  if (!Array.isArray(value.onSuccess) || !value.onSuccess.every(validOutcome)) return false;
  if (value.dependsOn !== undefined && !isStringArray(value.dependsOn)) return false;
  switch (value.kind) {
    case "send_message": return true;
    case "send_media": return isNonEmptyString(value.vehicleKey) && isStringArray(value.photoIds);
    case "crm_write": return isNonEmptyString(value.leadId) && isRecord(value.fields);
    case "schedule_visit": return isNonEmptyString(value.leadId) && isNonEmptyString(value.slot);
    // HF-1: a LLM NUNCA fornece sellerId. handoff = leadId + reason tipado + briefing factual (o engine é quem
    // materializa briefing/etiquetas — do modelo basta o motivo; briefing ausente vira "" e o engine preenche).
    case "handoff": return isNonEmptyString(value.leadId) && isNonEmptyString(value.reason)
      && (value.briefing === undefined || typeof value.briefing === "string")
      && (value.correlationId === undefined || isNonEmptyString(value.correlationId)) && value.sellerId === undefined;
    case "notify_seller": return isNonEmptyString(value.leadId) && isNonEmptyString(value.reason)
      && (value.etiquetas === undefined || isRecord(value.etiquetas))
      && (value.correlationId === undefined || isNonEmptyString(value.correlationId)) && value.sellerId === undefined;
    default: return false;
  }
}

function decodeProposal(value: unknown): ProposedDecision {
  if (!isRecord(value) || !ACTIONS.has(value.proposedAction as TurnAction)) throw new ModelOutputError("MODEL_DECISION_INVALID", "proposedAction");
  if (!Array.isArray(value.facts) || !value.facts.every(validMutation)) throw new ModelOutputError("MODEL_DECISION_INVALID", "facts");
  if (!Array.isArray(value.proposedEffects) || !value.proposedEffects.every(validEffect)) throw new ModelOutputError("MODEL_DECISION_INVALID", "proposedEffects");
  if (!isRecord(value.responsePlan) || typeof value.responsePlan.guidance !== "string") throw new ModelOutputError("MODEL_DECISION_INVALID", "responsePlan.guidance");
  // reasonCode/reasonSummary sao metadados de observabilidade, nao contrato comercial.
  // A ausencia deles nao pode derrubar um turno valido nem gerar fallback ao lead.
  const reasonCode = isNonEmptyString(value.reasonCode) ? value.reasonCode : "model_decision";
  const reasonSummary = typeof value.reasonSummary === "string" ? value.reasonSummary : "Decisao valida sem resumo fornecido pelo modelo.";
  // FIX D (Fase 0, 2026-07-01): confidence e METADADO de observabilidade (como reasonCode/reasonSummary
  // acima), NAO contrato comercial. Um numero malformado do modelo NAO pode derrubar um turno valido e
  // jogar o lead num fallback cego (era a raiz do turno-3 "MODEL_DECISION_INVALID:confidence"). Normaliza:
  // finito -> clampa em [0,1]; ausente/NaN -> default seguro. O conteudo real segue validado pelo grounding.
  const confidence = (typeof value.confidence === "number" && Number.isFinite(value.confidence))
    ? Math.min(1, Math.max(0, value.confidence))
    : 0.7;
  if (value.target !== undefined && value.target !== null && !isRecord(value.target)) throw new ModelOutputError("MODEL_DECISION_INVALID", "target");
  return immutableCopy({ ...value, reasonCode, reasonSummary, confidence } as unknown as ProposedDecision);
}

function decodeStep(value: unknown): DecisionStep {
  if (!isRecord(value)) throw new ModelOutputError("MODEL_DECISION_INVALID", "step_not_object");
  if (value.kind === "query" && validQueryCall(value.call)) {
    // 1A.4: corrige a query do LLM no DECODE — termo de TIPO em `modelo` vira `tipo` antes de fluir p/ o
    // engine/runner/registro (a proposta crua nunca carrega modelo:"suv" adiante). Modelo real fica intacto.
    // Item 6: conflito tipo-em-modelo vs `tipo` divergente FALHA FECHADO (query inválida -> re-propõe).
    if (value.call.tool === "stock_search") {
      const norm = normalizeStockSearchInput(value.call.input);
      if (!norm.ok) throw new ModelOutputError("MODEL_DECISION_INVALID", "stock_type_model_conflict");
      return immutableCopy({ kind: "query", call: { ...value.call, input: norm.input } });
    }
    return immutableCopy({ kind: "query", call: value.call });
  }
  if (value.kind === "final") return immutableCopy({ kind: "final", proposal: decodeProposal(value.proposal) });
  throw new ModelOutputError("MODEL_DECISION_INVALID", "kind|query.call");
}

function validResponsePart(part: unknown): part is ResponsePart {
  if (!isRecord(part)) return false;
  if (part.type === "text") return typeof part.content === "string";
  if (part.type === "vehicle_ref") {
    return isNonEmptyString(part.vehicleKey) && ["marca", "modelo", "ano", "km", "cambio", "cor"].includes(String(part.field));
  }
  if (part.type === "money_ref") {
    if (!MONEY_ROLES.has(String(part.role)) || !isRecord(part.source)) return false;
    if (part.source.kind === "vehicle_fact") return isNonEmptyString(part.source.vehicleKey);
    if (part.source.kind === "slot_value") return isNonEmptyString(part.source.slotName);
  }
  if (part.type === "vehicle_offer_list") {
    // F2.7.5: o modelo so manda os vehicleKeys; o renderer formata (grounding no render/policy).
    return isStringArray(part.vehicleKeys) && (part.vehicleKeys as string[]).length > 0;
  }
  return false;
}

function decodeDraft(value: unknown): ResponseDraft {
  if (!isRecord(value) || !Array.isArray(value.parts) || !value.parts.every(validResponsePart)) {
    throw new ModelOutputError("MODEL_RESPONSE_INVALID");
  }
  return immutableCopy({ parts: value.parts });
}

export class PromptBoundConversationAdapter implements DecisionLlm, TurnUnderstanding {
  readonly binding: ModelBinding;

  constructor(config: TenantRuntimeConfig, private readonly backend: StructuredConversationModel) {
    this.binding = createModelBinding(config);
  }

  async interpret(args: Parameters<TurnUnderstanding["interpret"]>[0]): Promise<TurnInterpretation> {
    const turn = immutableCopy({
      turnId: args.turnId,
      now: args.now,
      leadMessage: args.leadMessage,
      state: args.state,
      tenantCatalog: args.tenantCatalog,
    });
    let raw: unknown;
    try {
      raw = await this.backend.interpret({ operation: "interpret", binding: this.binding, turn });
    } catch {
      throw new ModelOutputError("MODEL_INTERPRETATION_FAILURE");
    }
    return decodeInterpretation(raw);
  }

  async proposeNextQueryOrFinal(ctx: TurnContext, facts: QueryResult[]): Promise<DecisionStep> {
    let raw: unknown;
    try {
      raw = await this.backend.propose({
        operation: "propose",
        binding: this.binding,
        turn: snapshot(ctx),
        facts: immutableCopy(facts),
      });
    } catch {
      throw new ModelOutputError("MODEL_DECISION_FAILURE");
    }
    const step = decodeStep(raw);
    if (step.kind === "final") {
      for (const mutation of step.proposal.facts) {
        if ((mutation.op === "set_slot" || mutation.op === "set_slot_ref") && mutation.sourceTurnId !== ctx.turnId) {
          throw new ModelOutputError("MODEL_DECISION_INVALID", "facts.sourceTurnId");
        }
        if (mutation.op === "set_planned_objective" && mutation.planned.plannedInTurnId !== ctx.turnId) {
          throw new ModelOutputError("MODEL_DECISION_INVALID", "facts.plannedInTurnId");
        }
      }
      // Reuse the authoritative reducer validation before the decision can reach
      // the engine commit. Invalid model mutations become terminal-safe, not a
      // late commit_failed that would leave the lead without a response.
      const dryRun = applyDecision(ctx.state, step.proposal.facts, ctx.turnId, ctx.now);
      if (!dryRun.ok) throw new ModelOutputError("MODEL_DECISION_INVALID", "facts.reducer_rejected");
    }
    return step;
  }

  async compose(decision: TurnDecision, facts: QueryResult[], ctx: TurnContext): Promise<ResponseDraft> {
    let raw: unknown;
    try {
      raw = await this.backend.compose({
        operation: "compose",
        binding: this.binding,
        turn: snapshot(ctx),
        facts: immutableCopy(facts),
        decision: immutableCopy(decision),
      });
    } catch {
      throw new ModelOutputError("MODEL_RESPONSE_FAILURE");
    }
    return decodeDraft(raw);
  }
}
