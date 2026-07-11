// ============================================================================
// handoff-plan.ts — HF-1/HF-3. Chokepoint PURO da cadeia de transferência.
// O cérebro PROPÕE apenas o ATO ({kind:"handoff", reason}); o ENGINE (aqui)
// materializa a cadeia executável com autoridade de domínio:
//
//   send_message (anúncio ao lead, DELIVERED-gated) ->
//   crm_write (delivered síncrono) ->
//   handoff (saga: claim + pendente + briefing) ->
//   notify_seller (vendedor resolvido pela saga + gerente best-effort)
//
// Ordem/dependência = missão HF (efeitos só avançam com o receipt exigido):
// o send_message do turno ganha o outcome `mark_message_delivered` (NÃO é
// accepted-safe) => o effect-policy passa a exigir receipt DELIVERED do reply
// antes de liberar a cadeia — o flush pós-receipt (server) despacha o resto.
// A LLM NUNCA fornece sellerId/UUID; leadId/briefing/etiquetas nascem AQUI do
// estado factual. Módulo puro: zero IO, testável offline.
// ============================================================================
import type { EffectPlan, HandoffPlan, NotifySellerPlan, SendMessagePlan, TurnDecision } from "../domain/decision.ts";
import type { AdContext, ConversationState } from "../domain/conversation-state.ts";
import { effectIdFor } from "./finalizer.ts";
import { buildSellerBriefing, classifySdrCategory } from "./briefing-builder.ts";
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
  return reason === "explicit_human_request" || reason === "qualified_handoff" ? reason : null;
}

// Monta a cadeia final. SEMPRE remove handoff/notify_seller propostos (autoria do engine);
// quando `plannable`, reconstrói a cadeia completa com briefing/etiquetas factuais.
export function buildHandoffChain(args: HandoffChainArgs & { readonly plannable: boolean; readonly forcedReason?: HandoffReasonKind }): HandoffChainResult {
  const withoutHandoff = args.decision.effectPlan.filter((p) => p.kind !== "handoff" && p.kind !== "notify_seller");
  const reason = args.forcedReason ?? proposedHandoffReason(args.decision);
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
  const briefingBase = buildSellerBriefing({
    state: args.stateAfter,
    adContext: args.adContext,
    adVehicleLabel: args.adVehicleLabel,
    lastPhotoAction: args.lastPhotoAction,
    agentName: args.agentName,
    leadPhone: args.leadPhone,
    readyToTransfer: reason === "qualified_handoff",
  });
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
    resumo: briefing,
  });

  const maxOrder = withoutHandoff.reduce((max, p) => Math.max(max, p.order), 0);
  const reply = withoutHandoff.find((p): p is SendMessagePlan => p.kind === "send_message");
  const crm = withoutHandoff.find((p) => p.kind === "crm_write");

  // DELIVERED-gate do anúncio (missão HF ordem mínima): mark_message_delivered NÃO é accepted-safe,
  // então o effect-policy exige receipt delivered do reply p/ satisfazer a dependência da cadeia.
  const gatedPlans = withoutHandoff.map((p) => {
    if (p !== reply) return p;
    const alreadyGated = p.onSuccess.some((o) => o.op === "mark_message_delivered");
    return alreadyGated ? p : {
      ...p,
      onSuccess: [...p.onSuccess, { op: "mark_message_delivered" as const, effectId: p.effectId, messageId: "handoff_delivery_gate" }],
    };
  });

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

  return { planned: true, reason, effectPlan: [...gatedPlans, handoffPlan, notifyPlan], briefing };
}
