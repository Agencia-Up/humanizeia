// ============================================================================
// handoff-plan.ts — HF-1/HF-3. Chokepoint PURO da cadeia de transferência.
// O cérebro PROPÕE apenas o ATO ({kind:"handoff", reason}); o ENGINE (aqui)
// materializa a cadeia executável com autoridade de domínio:
//
//   send_message (aceito pelo provedor) ->
//   crm_write (delivered síncrono) ->
//   handoff (saga: claim + pendente + briefing) ->
//   notify_seller (vendedor resolvido pela saga + gerente best-effort)
//
// Ordem/dependência = missão HF: cada efeito avança com o receipt realmente
// suportado por ele; mídia e mutações críticas continuam exigindo delivered.
// A LLM NUNCA fornece sellerId/UUID; leadId/briefing/etiquetas nascem AQUI do
// estado factual. Módulo puro: zero IO, testável offline.
// ============================================================================
import type { EffectPlan, HandoffPlan, NotifySellerPlan, SendMessagePlan, TurnDecision } from "../domain/decision.ts";
import type { AdContext, ConversationState } from "../domain/conversation-state.ts";
import type { KnowledgeGap } from "../domain/knowledge.ts";
import { effectIdFor } from "./finalizer.ts";
import { buildAgentSummary, buildSellerBriefing, classifySdrCategory } from "./briefing-builder.ts";
import {
  HANDOFF_REASON_LABEL, buildTransferEtiquetas, isHandoffReasonKind,
  type HandoffReasonKind,
} from "./transfer-templates.ts";

const SDR_CATEGORY_TEXT: Record<string, string> = {
  inativo: "💤 LEAD INATIVO",
  pouco_qualificado: "🧊 LEAD POUCO QUALIFICADO",
  qualificado: "🎯 LEAD QUALIFICADO",
};

export type HandoffChainArgs = {
  readonly decision: TurnDecision;                 // pós-finalizer (effectIds prontos)
  readonly turnId: string;
  readonly leadId: string;                         // vínculo JÁ validado (crmLeadId do chokepoint)
  readonly stateAfter: ConversationState;          // estado PÓS-turno (fatos p/ briefing/etiquetas)
  readonly adContext: AdContext | null;
  readonly adVehicleLabel: string | null;
  readonly lastPhotoAction: { label: string; photoIds: readonly string[] } | null;
  readonly agentName: string;
  readonly leadPhone: string | null;               // dígitos do contato (toAddr)
  readonly leadDisplayName: string | null;         // hint sanitizado (pushName/CRM)
  readonly knowledgeGaps?: readonly KnowledgeGap[];
  readonly nowLocal: string;                       // horário local formatado (injeção — puro)
};

export type HandoffChainResult =
  | { readonly planned: true; readonly reason: HandoffReasonKind; readonly effectPlan: EffectPlan[]; readonly briefing: string }
  | { readonly planned: false; readonly strippedReason: string | null; readonly effectPlan: EffectPlan[] };

// Extrai o motivo do handoff proposto (se houver) — só os kinds que a DECISÃO pode originar.
export function proposedHandoffReason(decision: TurnDecision): HandoffReasonKind | null {
  const plan = decision.effectPlan.find((p) => p.kind === "handoff");
  if (!plan || plan.kind !== "handoff") return null;
  const reason = plan.reason;
  if (!isHandoffReasonKind(reason)) return null;
  // returning_lead_renotify é resolução da SAGA (lead com dono) — a decisão não o origina;
  // followup_timeout_handoff nasce do timer (HF-4), não do turno conversacional.
  // ⭐DEGRAU 2: handoff_after_closure é originável pela DECISÃO (a LLM encerra com lead interessado).
  return reason === "explicit_human_request" || reason === "qualified_handoff" || reason === "handoff_after_closure"
    ? reason
    : null;
}

// ⭐DEGRAU 2: a decisão da LLM VENCE o motivo forçado quando ela declarou encerramento-com-transferência.
// Antes, `forcedReason ?? proposedHandoffReason(...)` fazia o forçado sempre ganhar: um handoff_after_closure
// autorado pela LLM num turno em que ela também declarasse encerramento era RENOMEADO para
// silent_disengagement_handoff, e o vendedor recebia "encerrou sem interesse" para um lead que QUER comprar.
// Regra: só um opt-out explícito e inequívoco do lead ("me tire da lista") pode sobrescrever a autoria.
export function resolveHandoffReason(
  decision: TurnDecision,
  forcedReason: HandoffReasonKind | null | undefined,
): HandoffReasonKind | null {
  const proposed = proposedHandoffReason(decision);
  if (proposed === "handoff_after_closure" && forcedReason === "silent_disengagement_handoff") return proposed;
  return forcedReason ?? proposed;
}

// Encerrar a conversa por desinteresse também é um evento operacional: o
// vendedor recebe o briefing, enquanto a mensagem ao lead continua sendo só a
// despedida que a LLM já autorou. Pedido explícito de humano conserva o motivo
// visível/original e uma conversa já entregue ao vendedor não cria nova saga.
export function forcedSilentDisengagementReason(input: {
  readonly disengaged: boolean;
  readonly explicitHumanRequest: boolean;
  readonly stage: ConversationState["stage"];
}): HandoffReasonKind | null {
  if (!input.disengaged || input.explicitHumanRequest) return null;
  if (input.stage === "handoff" || input.stage === "closed") return null;
  return "silent_disengagement_handoff";
}

// Monta a cadeia final. SEMPRE remove handoff/notify_seller propostos (autoria do engine);
// quando `plannable`, reconstrói a cadeia completa com briefing/etiquetas factuais.
export function buildHandoffChain(args: HandoffChainArgs & { readonly plannable: boolean; readonly forcedReason?: HandoffReasonKind }): HandoffChainResult {
  const withoutHandoff = args.decision.effectPlan.filter((p) => p.kind !== "handoff" && p.kind !== "notify_seller");
  const reason = resolveHandoffReason(args.decision, args.forcedReason);
  if (!reason || !args.plannable) {
    return {
      planned: false,
      strippedReason: args.decision.effectPlan.some((p) => p.kind === "handoff" || p.kind === "notify_seller")
        ? (reason ? "handoff_not_plannable" : "handoff_reason_invalid")
        : null,
      effectPlan: withoutHandoff,
    };
  }

  const category = classifySdrCategory(args.stateAfter, { readyToTransfer: reason === "qualified_handoff" });
  const briefingArgs = {
    state: args.stateAfter,
    adContext: args.adContext,
    adVehicleLabel: args.adVehicleLabel,
    lastPhotoAction: args.lastPhotoAction,
    agentName: args.agentName,
    leadPhone: args.leadPhone,
    leadDisplayName: args.leadDisplayName,
    handoffReason: reason,
    knowledgeGaps: args.knowledgeGaps,
    readyToTransfer: reason === "qualified_handoff",
  } as const;
  const briefingBase = buildSellerBriefing(briefingArgs);
  // Motivo/origem da transferência SEMPRE declarado no briefing (contrato HF-2).
  const briefing = `${briefingBase}\n\n🎯 *Motivo da transferência:* ${HANDOFF_REASON_LABEL[reason]}`;

  const etiquetas = buildTransferEtiquetas({
    state: args.stateAfter,
    agentName: args.agentName,
    leadDisplayName: args.leadDisplayName,
    leadPhone: args.leadPhone,
    sellerName: null,                 // resolvido pela saga; o notify completa no dispatch
    sellerPhone: null,
    adVehicleLabel: args.adVehicleLabel,
    classificacao: SDR_CATEGORY_TEXT[category] ?? "",
    horario: args.nowLocal,
    // Templates personalizados recebem um resumo factual curto. O fallback
    // padrão continua usando o briefing integral abaixo.
    resumo: buildAgentSummary(briefingArgs).join(" "),
  });

  const maxOrder = withoutHandoff.reduce((max, p) => Math.max(max, p.order), 0);
  const reply = withoutHandoff.find((p): p is SendMessagePlan => p.kind === "send_message");
  const crm = withoutHandoff.find((p) => p.kind === "crm_write");

  // The reply dependency uses the receipt level supported by its outcomes. A
  // regular text reply is accepted-safe; media and state-bearing outcomes keep
  // their stronger delivered requirement in effect-policy.
  const handoffPlanId = "handoff";
  const notifyPlanId = "notify-seller";
  const correlationId = effectIdFor(args.turnId, handoffPlanId);
  const handoffDeps = [reply?.planId, crm?.planId].filter((d): d is string => typeof d === "string");
  const handoffPlan: HandoffPlan = {
    kind: "handoff",
    planId: handoffPlanId,
    effectId: effectIdFor(args.turnId, handoffPlanId),
    order: maxOrder + 1,
    dependsOn: handoffDeps,
    leadId: args.leadId,
    reason,
    briefing,
    correlationId,
    sensitiveRefs: {
      ...(args.stateAfter.slots.cpf?.status === "known" && args.stateAfter.slots.cpf.ref ? { cpf: args.stateAfter.slots.cpf.ref.ref } : {}),
      ...(args.stateAfter.slots.birthDate?.status === "known" && args.stateAfter.slots.birthDate.ref ? { birthDate: args.stateAfter.slots.birthDate.ref.ref } : {}),
    },
    onSuccess: [],
  };
  const notifyPlan: NotifySellerPlan = {
    kind: "notify_seller",
    planId: notifyPlanId,
    effectId: effectIdFor(args.turnId, notifyPlanId),
    order: maxOrder + 2,
    dependsOn: [handoffPlanId],
    leadId: args.leadId,
    reason,
    etiquetas,
    correlationId,
    sensitiveRefs: {
      ...(args.stateAfter.slots.cpf?.status === "known" && args.stateAfter.slots.cpf.ref ? { cpf: args.stateAfter.slots.cpf.ref.ref } : {}),
      ...(args.stateAfter.slots.birthDate?.status === "known" && args.stateAfter.slots.birthDate.ref ? { birthDate: args.stateAfter.slots.birthDate.ref.ref } : {}),
    },
    // A transferencia so esta concluida para a conversa depois que o aviso ao
    // vendedor foi realmente ENTREGUE. O registro pending sozinho nao basta.
    onSuccess: [{ op: "mark_handoff_completed", effectId: effectIdFor(args.turnId, notifyPlanId) }],
  };

  return { planned: true, reason, effectPlan: [...withoutHandoff, handoffPlan, notifyPlan], briefing };
}
