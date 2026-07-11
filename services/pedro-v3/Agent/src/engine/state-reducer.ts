// ============================================================================
// StateReducer — PURO. Brain/02 §2.6 (+ r3 #1/#2/#5, Fase 1.5).
//  - applyDecision: só FATOS DO INBOUND (o que o lead disse) -> commit.
//    Recebe expectedTurnId e expectedNow para validação estrita.
//  - applyEffectOutcome: só após receipt; idempotente por effectId; mídia parcial.
// Nada que afirme que o lead VIU/RECEBEU algo entra por applyDecision.
// ============================================================================
import type { ConversationState, PendingObjective, FunnelSlots } from "../domain/conversation-state.ts";
import type { DecisionMutation, EffectOutcomeMutation, EffectResult, EffectPlan } from "../domain/decision.ts";
import type { Id, Iso, VehicleType, PaymentMethod } from "../domain/types.ts";

export type ReducerResult =
  | { ok: true; next: ConversationState }
  | { ok: false; rejected: { mutation: DecisionMutation | EffectOutcomeMutation; reason: string }[] };

function clone(s: ConversationState): ConversationState {
  return structuredClone(s);
}

const ALLOWED_OUTCOMES: Record<string, string[]> = {
  send_message: ["activate_objective", "mark_message_delivered", "mark_followup_sent", "record_offer", "set_presented_vehicle_focus", "advance_stage", "append_assistant_turn"],
  send_media: ["mark_photos_sent", "record_offer", "set_presented_vehicle_focus", "append_assistant_turn", "activate_objective", "advance_stage"],
  crm_write: ["advance_stage"],
  schedule_visit: ["advance_stage"],
  handoff: ["mark_handoff_completed", "advance_stage"],
  notify_seller: ["mark_handoff_completed", "advance_stage"],
};

const VALID_VEHICLE_TYPES: readonly VehicleType[] = ["suv", "sedan", "hatch", "pickup", "unknown"];
const VALID_PAYMENT_METHODS: readonly PaymentMethod[] = ["a_vista", "financiamento", "consorcio", "troca"];

// ── applyDecision: fatos do inbound (commit). version+1. Mutação inválida -> rejeição atômica. ──
export function applyDecision(
  state: ConversationState,
  mutations: DecisionMutation[],
  expectedTurnId: Id,
  expectedNow: Iso
): ReducerResult {
  const rejected: { mutation: DecisionMutation; reason: string }[] = [];
  const next = clone(state);

  for (const m of mutations) {
    switch (m.op) {
      case "set_slot": {
        // Validação global: confidence deve ser número em [0, 1]
        if (typeof m.confidence !== "number" || m.confidence < 0 || m.confidence > 1) {
          rejected.push({ mutation: m, reason: `confidence '${m.confidence}' fora do intervalo [0, 1]` }); continue;
        }
        // Validação global: sourceTurnId deve ser igual ao turno esperado
        if (m.sourceTurnId !== expectedTurnId) {
          rejected.push({ mutation: m, reason: `sourceTurnId '${m.sourceTurnId}' diferente do turno atual '${expectedTurnId}'` }); continue;
        }

        // Validação por slot — tipada explicitamente para cada slot
        switch (m.slot) {
          case "nome": {
            if (typeof m.value !== "string" || m.value.trim().length < 2) {
              rejected.push({ mutation: m, reason: "nome inválido (mínimo 2 caracteres)" }); continue;
            }
            next.slots.nome = { status: "known", value: m.value, confidence: m.confidence, sourceTurnId: m.sourceTurnId, updatedAt: expectedNow };
            break;
          }
          case "interesse": {
            if (typeof m.value !== "string" || m.value.trim().length === 0) {
              rejected.push({ mutation: m, reason: "interesse inválido (vazio)" }); continue;
            }
            next.slots.interesse = { status: "known", value: m.value, confidence: m.confidence, sourceTurnId: m.sourceTurnId, updatedAt: expectedNow };
            break;
          }
          case "tipoVeiculo": {
            if (!VALID_VEHICLE_TYPES.includes(m.value)) {
              rejected.push({ mutation: m, reason: `tipoVeiculo '${m.value}' não é um VehicleType válido` }); continue;
            }
            next.slots.tipoVeiculo = { status: "known", value: m.value, confidence: m.confidence, sourceTurnId: m.sourceTurnId, updatedAt: expectedNow };
            break;
          }
          case "faixaPreco": {
            if (typeof m.value !== "object" || m.value === null) {
              rejected.push({ mutation: m, reason: "faixaPreco deve ser um objeto {min?, max?}" }); continue;
            }
            if (m.value.min != null && (typeof m.value.min !== "number" || m.value.min < 0)) {
              rejected.push({ mutation: m, reason: `faixaPreco.min '${m.value.min}' inválido (não-negativo)` }); continue;
            }
            if (m.value.max != null && (typeof m.value.max !== "number" || m.value.max < 0)) {
              rejected.push({ mutation: m, reason: `faixaPreco.max '${m.value.max}' inválido (não-negativo)` }); continue;
            }
            if (m.value.min != null && m.value.max != null && m.value.min > m.value.max) {
              rejected.push({ mutation: m, reason: `faixaPreco.min (${m.value.min}) > faixaPreco.max (${m.value.max})` }); continue;
            }
            next.slots.faixaPreco = { status: "known", value: m.value, confidence: m.confidence, sourceTurnId: m.sourceTurnId, updatedAt: expectedNow };
            break;
          }
          case "formaPagamento": {
            if (!VALID_PAYMENT_METHODS.includes(m.value)) {
              rejected.push({ mutation: m, reason: `formaPagamento '${m.value}' não é um PaymentMethod válido` }); continue;
            }
            next.slots.formaPagamento = { status: "known", value: m.value, confidence: m.confidence, sourceTurnId: m.sourceTurnId, updatedAt: expectedNow };
            break;
          }
          case "entrada": {
            if (typeof m.value !== "number" || m.value < 0) {
              rejected.push({ mutation: m, reason: "entrada inválida (deve ser número >= 0)" }); continue;
            }
            next.slots.entrada = { status: "known", value: m.value, confidence: m.confidence, sourceTurnId: m.sourceTurnId, updatedAt: expectedNow };
            break;
          }
          case "possuiTroca": {
            if (typeof m.value !== "boolean") {
              rejected.push({ mutation: m, reason: "possuiTroca deve ser boolean" }); continue;
            }
            next.slots.possuiTroca = { status: "known", value: m.value, confidence: m.confidence, sourceTurnId: m.sourceTurnId, updatedAt: expectedNow };
            break;
          }
          case "diaHorario": {
            if (typeof m.value !== "string" || m.value.trim().length === 0) {
              rejected.push({ mutation: m, reason: "diaHorario inválido (vazio)" }); continue;
            }
            next.slots.diaHorario = { status: "known", value: m.value, confidence: m.confidence, sourceTurnId: m.sourceTurnId, updatedAt: expectedNow };
            break;
          }
          case "parcelaDesejada": {
            if (typeof m.value !== "number" || m.value < 0) {
              rejected.push({ mutation: m, reason: "parcelaDesejada inválida (deve ser número >= 0)" }); continue;
            }
            next.slots.parcelaDesejada = { status: "known", value: m.value, confidence: m.confidence, sourceTurnId: m.sourceTurnId, updatedAt: expectedNow };
            break;
          }
          case "veiculoTroca": {
            if (typeof m.value !== "object" || m.value === null) {
              rejected.push({ mutation: m, reason: "veiculoTroca deve ser um objeto" }); continue;
            }
            // Deve ter ao menos um dado preenchido
            const hasData =
              (typeof m.value.marca === "string" && m.value.marca.trim().length > 0) ||
              (typeof m.value.modelo === "string" && m.value.modelo.trim().length > 0) ||
              (typeof m.value.ano === "number" && m.value.ano > 0) ||
              (typeof m.value.km === "number" && m.value.km >= 0) ||
              (typeof m.value.estado === "string" && m.value.estado.trim().length > 0);
            if (!hasData) {
              rejected.push({ mutation: m, reason: "veiculoTroca deve conter ao menos um dado preenchido (marca, modelo, ano, km ou estado)" }); continue;
            }
            next.slots.veiculoTroca = { status: "known", value: m.value, confidence: m.confidence, sourceTurnId: m.sourceTurnId, updatedAt: expectedNow };
            break;
          }
          case "cidade": {
            if (typeof m.value !== "string" || m.value.trim().length === 0) {
              rejected.push({ mutation: m, reason: "cidade inválida (vazio)" }); continue;
            }
            next.slots.cidade = { status: "known", value: m.value, confidence: m.confidence, sourceTurnId: m.sourceTurnId, updatedAt: expectedNow };
            break;
          }
          case "conheceLoja": {
            if (typeof m.value !== "boolean") {
              rejected.push({ mutation: m, reason: "conheceLoja deve ser boolean" }); continue;
            }
            next.slots.conheceLoja = { status: "known", value: m.value, confidence: m.confidence, sourceTurnId: m.sourceTurnId, updatedAt: expectedNow };
            break;
          }
          case "interesseVisita": {
            if (typeof m.value !== "boolean") {
              rejected.push({ mutation: m, reason: "interesseVisita deve ser boolean" }); continue;
            }
            next.slots.interesseVisita = { status: "known", value: m.value, confidence: m.confidence, sourceTurnId: m.sourceTurnId, updatedAt: expectedNow };
            break;
          }
          default: {
            // Exaustividade: nunca entra aqui se SlotMutation estiver correto
            rejected.push({ mutation: m, reason: `slot desconhecido '${(m as any).slot}'` }); continue;
          }
        }
        break;
      }
      case "set_slot_ref": {
        if (!m.ref?.ref) { rejected.push({ mutation: m, reason: "ref sensivel ausente" }); continue; }
        next.slots[m.slot] = { status: "known", ref: m.ref, sourceTurnId: m.sourceTurnId, updatedAt: expectedNow };
        break;
      }
      case "resolve_objective": {
        if (next.currentObjective?.id === m.objectiveId) next.currentObjective.status = m.status;
        else rejected.push({ mutation: m, reason: "objetivo ativo não corresponde" });
        break;
      }
      case "supersede_objective": {
        if (next.currentObjective?.id === m.objectiveId) next.currentObjective.status = "superseded";
        break;
      }
      case "defer_objective": {
        // item 5 + F-5: o lead falou de outra coisa; o objetivo continua pendente, só conta o deferimento.
        // objectiveId DIVERGENTE do objetivo ativo é REJEITADO (não ignorado) — fail-closed.
        if (next.currentObjective?.id === m.objectiveId) next.currentObjective.deferrals = (next.currentObjective.deferrals ?? 0) + 1;
        else rejected.push({ mutation: m, reason: "defer_objective: objetivo ativo não corresponde" });
        break;
      }
      case "add_rejected": {
        if (!next.rejected.modelos.includes(m.modelo)) next.rejected.modelos.push(m.modelo);
        break;
      }
      case "set_planned_objective": {
        // PLANEJADO — não ativa nada; só registra (será ativado no receipt do effectId).
        next.plannedObjectives.push(m.planned);
        break;
      }
      case "append_lead_turn": {
        if (m.turn.role !== "lead") { rejected.push({ mutation: m, reason: "append_lead_turn só aceita role=lead" }); continue; }
        next.recentTurns.push(m.turn);
        break;
      }
      case "select_vehicle_focus": {
        // item 1: ESCOLHA explícita do lead -> selectedVehicleFocus (fato inbound, no commit). Substitui o anterior.
        if (m.sourceTurnId !== expectedTurnId) { rejected.push({ mutation: m, reason: `sourceTurnId '${m.sourceTurnId}' != turno esperado '${expectedTurnId}'` }); continue; }
        if (!m.vehicle?.key) { rejected.push({ mutation: m, reason: "select_vehicle_focus sem vehicle.key" }); continue; }
        // Hardening 1 (audit): o label DEVE ser CANÔNICO (nome real "MARCA MODELO ANO"); NUNCA vazio nem == key (o
        // engine canonicaliza antes de propor). Barra label fabricado pela LLM sem fato aterrado / chave crua vazando.
        if (!m.vehicle.label || m.vehicle.label.trim() === "" || m.vehicle.label === m.vehicle.key) {
          rejected.push({ mutation: m, reason: `select_vehicle_focus com label não-canônico (vazio ou == key '${m.vehicle.key}')` }); continue;
        }
        next.vehicleContext.selected = m.vehicle;
        break;
      }
      case "clear_vehicle_focus": {
        // item F-3: nova intenção explícita / busca ambígua ou vazia -> foco obsoleto é LIMPO.
        if (m.sourceTurnId !== expectedTurnId) { rejected.push({ mutation: m, reason: `sourceTurnId '${m.sourceTurnId}' != turno esperado '${expectedTurnId}'` }); continue; }
        next.vehicleContext.selected = null;
        break;
      }
      case "set_more_options_exhausted": {
        // R10-4: progressão de "mais opções esgotadas". Valor >=0 (incremento a cada esgotamento; reset=0 em nova oferta).
        if (!Number.isInteger(m.value) || m.value < 0) { rejected.push({ mutation: m, reason: `set_more_options_exhausted valor inválido '${m.value}'` }); continue; }
        next.moreOptionsExhausted = m.value;
        break;
      }
      case "set_search_transmission": {
        if (m.sourceTurnId !== expectedTurnId) { rejected.push({ mutation: m, reason: `sourceTurnId '${m.sourceTurnId}' != turno esperado '${expectedTurnId}'` }); continue; }
        if (m.value !== null && m.value !== "automatic" && m.value !== "manual") {
          rejected.push({ mutation: m, reason: `preferencia de cambio invalida '${m.value}'` }); continue;
        }
        next.searchPreferences = { transmission: m.value };
        break;
      }
      default: rejected.push({ mutation: m as DecisionMutation, reason: "op desconhecida" });
    }
  }

  if (rejected.length > 0) return { ok: false, rejected };
  next.version = state.version + 1;
  next.turnNumber = state.turnNumber + 1;
  next.updatedAt = expectedNow;
  return { ok: true, next };
}

// ── applyEffectOutcome: só com EffectResult; idempotente; só succeeded avança o estado. ──
export function applyEffectOutcome(
  state: ConversationState,
  effectPlan: EffectPlan,
  result: EffectResult,
): ReducerResult {
  // IDEMPOTÊNCIA (Codex r3 #2): mesmo effectId já aplicado -> no-op.
  if (state.appliedEffectIds.includes(result.effectId)) return { ok: true, next: state };

  // 1. Validar que o effectId do resultado corresponde exatamente ao effectId do plano de efeito
  if (result.effectId !== effectPlan.effectId) {
    return {
      ok: false,
      rejected: [{
        mutation: { op: "activate_objective", effectId: result.effectId, plannedObjectiveId: "N/A" } as EffectOutcomeMutation,
        reason: `result.effectId ${result.effectId} divergente de effectPlan.effectId ${effectPlan.effectId}`
      }]
    };
  }

  // 2. Validar que result.effectId === receipt.effectId se foi sucesso
  if (result.status === "succeeded") {
    if (result.effectId !== result.receipt.effectId) {
      return {
        ok: false,
        rejected: [{
          mutation: { op: "activate_objective", effectId: result.effectId, plannedObjectiveId: "N/A" } as EffectOutcomeMutation,
          reason: `result.effectId ${result.effectId} divergente de receipt.effectId ${result.receipt.effectId}`
        }]
      };
    }
  }

  // 3. Validar mutações onSuccess: consistência de effectId e permissões por EffectKind
  const allowed = ALLOWED_OUTCOMES[effectPlan.kind];
  for (const o of effectPlan.onSuccess) {
    if (o.effectId !== effectPlan.effectId) {
      return {
        ok: false,
        rejected: [{
          mutation: o,
          reason: `mutation.effectId ${o.effectId} divergente de result.effectId ${result.effectId}`
        }]
      };
    }

    if (!allowed || !allowed.includes(o.op)) {
      return {
        ok: false,
        rejected: [{
          mutation: o,
          reason: `operação ${o.op} não permitida para o tipo de efeito ${effectPlan.kind}`
        }]
      };
    }

    // 4. Validar PlannedObjective para activate_objective
    if (o.op === "activate_objective") {
      const idx = state.plannedObjectives.findIndex((p) => p.id === o.plannedObjectiveId);
      if (idx < 0) {
        return {
          ok: false,
          rejected: [{
            mutation: o,
            reason: `PlannedObjective com id ${o.plannedObjectiveId} não encontrado no estado`
          }]
        };
      }
      const p = state.plannedObjectives[idx];
      if (p.effectId !== result.effectId) {
        return {
          ok: false,
          rejected: [{
            mutation: o,
            reason: `PlannedObjective.effectId ${p.effectId} divergente de result.effectId ${result.effectId}`
          }]
        };
      }
    }

    // 5. Validar que send_media com múltiplas fotos exige perItem no receipt
    if (o.op === "mark_photos_sent") {
      if (o.photoIds.length > 1 && result.status === "succeeded" && !result.receipt.perItem) {
        return {
          ok: false,
          rejected: [{
            mutation: o,
            reason: "múltiplas fotos exige perItem no receipt"
          }]
        };
      }
    }
  }

  // failed / outcome_uncertain: estado NÃO avança (aguarda reconciliação). Não marca aplicado.
  if (result.status !== "succeeded") return { ok: true, next: state };

  const next = clone(state);
  const receipt = result.receipt;

  for (const o of effectPlan.onSuccess) {
    switch (o.op) {
      case "activate_objective": {
        const idx = next.plannedObjectives.findIndex((p) => p.id === o.plannedObjectiveId);
        if (idx < 0) break; // Já validado acima
        const p = next.plannedObjectives[idx];
        const pending: PendingObjective = {
          id: p.id, type: p.type, slot: p.slot ?? null,
          askedAt: receipt.at, askedInTurnId: p.plannedInTurnId,
          deliveredByEffectId: result.effectId, deliveryLevel: receipt.level,
          expectedAnswerKinds: p.expectedAnswerKinds, status: "pending", attempts: 0, deferrals: 0,
        };
        next.currentObjective = pending;
        next.plannedObjectives.splice(idx, 1);
        break;
      }
      case "record_offer": {
        next.offers.last = o.offer;
        for (const k of o.offer.vehicleKeys) if (!next.offers.presentedKeys.includes(k)) next.offers.presentedKeys.push(k);
        break;
      }
      case "set_presented_vehicle_focus": {
        next.vehicleContext.focus = o.vehicle;
        break;
      }
      case "mark_photos_sent": {
        // MÍDIA PARCIAL (Codex r3 #5): só os photoIds CONFIRMADOS no receipt.perItem.
        const confirmed = receipt.perItem
          ? o.photoIds.filter((id) => receipt.perItem!.some((it) => it.photoId === id && it.status === "succeeded"))
          : o.photoIds;
        const prev = next.photoLedger.sentByVehicle[o.vehicleKey] ?? [];
        next.photoLedger.sentByVehicle[o.vehicleKey] = Array.from(new Set([...prev, ...confirmed]));
        break;
      }
      case "advance_stage": {
        next.stage = o.stage;
        break;
      }
      case "mark_handoff_completed": {
        next.stage = "handoff";
        break;
      }
      case "mark_followup_sent": {
        const cycle = next.followupCycle;
        if (!cycle || cycle.anchorEffectId !== o.anchorEffectId) break;
        next.followupCycle = {
          ...cycle,
          sentStages: Array.from(new Set([...cycle.sentStages, o.stage])).sort() as Array<1 | 2 | 3>,
          plannedStage: cycle.plannedStage === o.stage ? null : cycle.plannedStage,
          lastSentAt: o.sentAt,
        };
        break;
      }
      case "append_assistant_turn": {
        next.recentTurns.push(o.turn);
        break;
      }
      case "mark_message_delivered": break;
    }
  }

  next.appliedEffectIds.push(result.effectId);
  next.version = state.version + 1;
  return { ok: true, next };
}
