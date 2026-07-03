// ============================================================================
// Pedro v3 â€” Kernel: testes L1 (unit) + L4 (multiturno). SEM rede, SEM I/O ($0).
//   npx tsx tests/run.ts
// Sai com cÃ³digo != 0 se algo falhar.
// ============================================================================
import { createInitialState } from "../src/domain/conversation-state.ts";
import type { ConversationState, PendingObjective, PlannedObjective, OfferRecord } from "../src/domain/conversation-state.ts";
import { applyDecision, applyEffectOutcome } from "../src/engine/state-reducer.ts";
import { PolicyEngine, hasDeny, parseMoneyMentions } from "../src/engine/policy-engine.ts";
import { finalize, effectIdFor, validateEffectPlans, validateDecisionObjectives } from "../src/engine/finalizer.ts";
import { runTurn } from "../src/engine/decision-engine.ts";
import type { QueryRunner } from "../src/engine/decision-engine.ts";
import { FakeLlm } from "../src/adapters/llm/fake-llm.ts";
import type {
  DecisionMutation, EffectOutcomeMutation, EffectResult, EffectReceipt, ProposedDecision,
  QueryResult, DecisionStep, SendMessagePlan, EffectPlan, TurnDecision, RenderedResponse, TenantCatalog, ClaimExtractor, AutomotiveClaim
} from "../src/domain/decision.ts";
import type { VehicleFact } from "../src/domain/types.ts";
import { interpretTurn, CatalogEntityExtractor } from "../src/adapters/turn-interpreter.ts";
import { ResponseRenderer } from "../src/engine/response-renderer.ts";
import { isVehicleKeyInCatalog, normalizeText, normalizedTermInText } from "../src/engine/catalog-utils.ts";

const NOW = "2026-06-26T00:00:00.000Z";
let ok = 0, fail = 0; const fails: string[] = [];
function check(group: string, name: string, pass: boolean, detail = "") {
  if (pass) { ok++; console.log(`  âœ… [${group}] ${name}`); }
  else { fail++; fails.push(`[${group}] ${name} â€” ${detail}`); console.log(`  âŒ [${group}] ${name} â€” ${detail}`); }
}

const baseState = (over: Partial<ConversationState> = {}): ConversationState => ({
  ...createInitialState({ conversationId: "c1", tenantId: "icom", agentId: "carvalho", leadId: "lead1", now: NOW }),
  ...over,
});
const succeeded = (effectId: string, level: "accepted" | "delivered" = "delivered", perItem?: EffectReceipt["perItem"]): EffectResult =>
  ({ status: "succeeded", effectId, receipt: { effectId, level, perItem, at: NOW } });

const testCatalog: TenantCatalog = {
  entries: [
    { vehicleKey: "jeep|renegade|2019", brand: "Jeep", model: "Renegade", aliases: ["renegade sport", "renegade 1.3"] },
    { vehicleKey: "jeep|renegade|2024", brand: "Jeep", model: "Renegade", aliases: [] },
    { vehicleKey: "hyundai|creta|2020", brand: "Hyundai", model: "Creta", aliases: [] },
    { vehicleKey: "audi|q5|2022", brand: "Audi", model: "Q5", aliases: [] },
    { vehicleKey: "byd|song|2023", brand: "BYD", model: "Song", aliases: [] },
    { vehicleKey: "gwm|haval|2023", brand: "GWM", model: "Haval", aliases: [] },
    { vehicleKey: "ram|rampage|2023", brand: "RAM", model: "Rampage", aliases: [] }
  ]
};

class MockClaimExtractor implements ClaimExtractor {
  constructor(private catalog: TenantCatalog) {}

  extractClaims(text: string): AutomotiveClaim[] {
    const claims: AutomotiveClaim[] = [];

    const pushOnce = (claim: AutomotiveClaim) => {
      if (!claims.some(c => c.normalized === claim.normalized && c.kind === claim.kind)) {
        claims.push(claim);
      }
    };

    for (const entry of this.catalog.entries) {
      if (normalizedTermInText(text, entry.brand)) {
        pushOnce({ kind: "brand", text: entry.brand, normalized: normalizeText(entry.brand) });
      }
      if (normalizedTermInText(text, entry.model)) {
        pushOnce({ kind: "model", text: entry.model, normalized: normalizeText(entry.model) });
      }

      for (const alias of entry.aliases) {
        if (normalizedTermInText(text, alias)) {
          pushOnce({ kind: "model", text: alias, normalized: normalizeText(alias) });
        }
      }
    }
    return claims;
  }
}

const testClaimExtractor = new MockClaimExtractor(testCatalog);
const defaultExtractor = new CatalogEntityExtractor();

console.log("\n=== KERNEL Pedro v3 â€” L1 (unit) + L4 (multiturno) â€” $0 ===\n");

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// L1 â€” StateReducer
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
{
  const s0 = baseState();
  const r1 = applyDecision(s0, [{ op: "set_slot", slot: "nome", value: "JoÃ£o", confidence: 0.9, sourceTurnId: "t1" }], "t1", NOW);
  check("L1-reducer", "set_slot nome -> known + version+1", r1.ok && r1.next.slots.nome.value === "JoÃ£o" && r1.next.version === 1, JSON.stringify(r1));

  const rBad = applyDecision(s0, [{ op: "set_slot", slot: "nome", value: "", confidence: 0.9, sourceTurnId: "t1" }], "t1", NOW);
  check("L1-reducer", "set_slot invÃ¡lido -> rejeiÃ§Ã£o (nÃ£o corrompe)", rBad.ok === false, JSON.stringify(rBad));

  // PLANEJADO nÃ£o ativa objetivo (Codex r3 #1 / POL-STATE-009)
  const planned: PlannedObjective = { id: "obj1", activationPlanId: "m1", effectId: effectIdFor("t1", "m1"), type: "perguntou_pagamento", slot: "entrada", plannedInTurnId: "t1", expectedAnswerKinds: ["valor", "negacao"] };
  const rPlan = applyDecision(s0, [{ op: "set_planned_objective", planned }], "t1", NOW);
  check("L1-reducer", "set_planned_objective NÃƒO ativa currentObjective", rPlan.ok && rPlan.next.plannedObjectives.length === 1 && rPlan.next.currentObjective == null, JSON.stringify(rPlan.ok && rPlan.next.currentObjective));

  // activate_objective sÃ³ no receipt succeeded
  const onAsk: EffectOutcomeMutation[] = [{ op: "activate_objective", effectId: planned.effectId, plannedObjectiveId: "obj1" }];
  const planAsk: EffectPlan = { kind: "send_message", planId: "m1", effectId: "t1:m1", order: 1, onSuccess: onAsk };
  const sPlan = (rPlan as any).next as ConversationState;
  const rFail = applyEffectOutcome(sPlan, planAsk, { status: "failed", effectId: planned.effectId, error: { code: "UPSTREAM", message: "x", retryable: true } });
  check("L1-reducer", "R3-1 pergunta NÃƒO entregue -> objetivo NÃƒO ativa (failed)", rFail.ok && (rFail as any).next.currentObjective == null && (rFail as any).next.plannedObjectives.length === 1, "");

  const rOk = applyEffectOutcome(sPlan, planAsk, succeeded(planned.effectId));
  check("L1-reducer", "pergunta ENTREGUE (succeeded) -> ativa currentObjective", rOk.ok && (rOk as any).next.currentObjective?.id === "obj1" && (rOk as any).next.plannedObjectives.length === 0, "");

  // idempotÃªncia: mesmo effectId 2x (Codex r3 #2 / POL-STATE-010)
  const rOk2 = applyEffectOutcome((rOk as any).next, planAsk, succeeded(planned.effectId));
  check("L1-reducer", "R3-4 mesmo effectId nÃ£o aplica outcome 2x", rOk.ok && rOk2.ok && (rOk2 as any).next.version === (rOk as any).next.version, "");

  // record_offer sÃ³ se enviada (Codex r3 / POL-STATE-009)
  const offer: OfferRecord = { offerId: "o1", tipo: "suv", precoMax: 80000, vehicleKeys: ["jeep|renegade|2019"], at: NOW };
  const onOffer: EffectOutcomeMutation[] = [{ op: "record_offer", effectId: "t1:moffer", offer }];
  const planOffer: EffectPlan = { kind: "send_message", planId: "moffer", effectId: "t1:moffer", order: 1, onSuccess: onOffer };
  const rOfferFail = applyEffectOutcome(s0, planOffer, { status: "failed", effectId: "t1:moffer", error: { code: "UPSTREAM", message: "x", retryable: true } });
  check("L1-reducer", "R3-2 oferta NÃƒO enviada nÃ£o entra em OfferMemory", rOfferFail.ok && (rOfferFail as any).next.offers.last == null, "");
  const rOfferOk = applyEffectOutcome(s0, planOffer, succeeded("t1:moffer"));
  check("L1-reducer", "oferta enviada entra em OfferMemory", rOfferOk.ok && (rOfferOk as any).next.offers.last?.offerId === "o1", "");

  // mÃ­dia parcial 3/5 (Codex r3 #5)
  const onPhotos: EffectOutcomeMutation[] = [{ op: "mark_photos_sent", effectId: "t1:mph", vehicleKey: "jeep|renegade|2019", photoIds: ["a", "b", "c", "d", "e"] }];
  const perItem = [{ photoId: "a", status: "succeeded" as const }, { photoId: "b", status: "succeeded" as const }, { photoId: "c", status: "succeeded" as const }, { photoId: "d", status: "failed" as const }, { photoId: "e", status: "failed" as const }];
  const planPhotos: EffectPlan = { kind: "send_media", planId: "mph", effectId: "t1:mph", order: 1, vehicleKey: "jeep|renegade|2019", photoIds: ["a", "b", "c", "d", "e"], onSuccess: onPhotos };
  const rPh = applyEffectOutcome(s0, planPhotos, succeeded("t1:mph", "delivered", perItem));
  check("L1-reducer", "R3-5 lote 5 fotos, 3 sucessos -> ledger sÃ³ 3", rPh.ok && ((rPh as any).next.photoLedger.sentByVehicle["jeep|renegade|2019"] || []).length === 3, JSON.stringify((rPh as any).next?.photoLedger));
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// L1-reducer-extra: testes de endurecimento do Reducer
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
{
  const s0 = baseState();
  const planned: PlannedObjective = { id: "obj1", activationPlanId: "m1", effectId: "t1:m1", type: "perguntou_pagamento", slot: "entrada", plannedInTurnId: "t1", expectedAnswerKinds: ["valor"] };
  const rPlan = applyDecision(s0, [{ op: "set_planned_objective", planned }], "t1", NOW);
  const sPlan = (rPlan as any).next as ConversationState;
  const planAsk: EffectPlan = { kind: "send_message", planId: "m1", effectId: "t1:m1", order: 1, onSuccess: [{ op: "activate_objective", effectId: "t1:m1", plannedObjectiveId: "obj1" }] };

  // 1. result.effectId === receipt.effectId
  const rDiffReceipt = applyEffectOutcome(sPlan, planAsk, { status: "succeeded", effectId: "t1:m1", receipt: { effectId: "t1:m2", level: "delivered", at: NOW } });
  check("L1-reducer-extra", "receipt/result com effectIds divergentes rejeita", rDiffReceipt.ok === false, "");

  // 2. toda mutation.effectId === effectId
  const planAskBadMut: EffectPlan = { kind: "send_message", planId: "m1", effectId: "t1:m1", order: 1, onSuccess: [{ op: "activate_objective", effectId: "t1:m2", plannedObjectiveId: "obj1" }] };
  const rDiffMut = applyEffectOutcome(sPlan, planAskBadMut, succeeded("t1:m1"));
  check("L1-reducer-extra", "mutation com effectId divergente rejeita", rDiffMut.ok === false, "");

  // 3. efeito errado nÃ£o ativa objetivo (PlannedObjective.effectId correspondente)
  const planAskM2: EffectPlan = { kind: "send_message", planId: "m2", effectId: "t1:m2", order: 1, onSuccess: [{ op: "activate_objective", effectId: "t1:m2", plannedObjectiveId: "obj1" }] };
  const rDiffPlanned = applyEffectOutcome(sPlan, planAskM2, succeeded("t1:m2"));
  check("L1-reducer-extra", "efeito errado nÃ£o ativa objetivo (PlannedObjective.effectId divergente)", rDiffPlanned.ok === false, "");

  // 4. objetivo inexistente nÃ£o marca outcome aplicado
  const planAskFakeObj: EffectPlan = { kind: "send_message", planId: "m1", effectId: "t1:m1", order: 1, onSuccess: [{ op: "activate_objective", effectId: "t1:m1", plannedObjectiveId: "fake-obj" }] };
  const rFakeObj = applyEffectOutcome(sPlan, planAskFakeObj, succeeded("t1:m1"));
  check("L1-reducer-extra", "objetivo inexistente rejeita outcome", rFakeObj.ok === false, "");

  // 5. mÃ­dia sem perItem nÃ£o confirma todas (com mÃºltiplas fotos)
  const planMultiMedia: EffectPlan = { kind: "send_media", planId: "mph", effectId: "t1:mph", order: 1, vehicleKey: "jeep", photoIds: ["a", "b"], onSuccess: [{ op: "mark_photos_sent", effectId: "t1:mph", vehicleKey: "jeep", photoIds: ["a", "b"] }] };
  const rMultiNoPerItem = applyEffectOutcome(s0, planMultiMedia, succeeded("t1:mph", "delivered"));
  check("L1-reducer-extra", "mÃ­dia com mÃºltiplas fotos sem perItem Ã© rejeitado", rMultiNoPerItem.ok === false, "");

  // 6. effectId com prefixo forjado Ã© rejeitado
  const forgerPlan: EffectPlan = { kind: "send_message", planId: "m1", effectId: "t1:m1", order: 1, onSuccess: [] };
  const forgerRes = applyEffectOutcome(s0, forgerPlan, succeeded("t2:m1"));
  check("L1-reducer-extra", "effectId com prefixo forjado Ã© rejeitado", forgerRes.ok === false, "");
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// ---------------------------------------------------------------------------
// L1-reducer-validation: validacoes runtime que impedem estado corrompido
// ---------------------------------------------------------------------------
{
  const s0 = baseState();

  const badConfidence = applyDecision(s0, [{ op: "set_slot", slot: "nome", value: "Joao", confidence: 1.5, sourceTurnId: "t1" }], "t1", NOW);
  check("L1-reducer-validation", "confidence > 1 rejeita atomicamente", badConfidence.ok === false && s0.version === 0, JSON.stringify(badConfidence));

  const badTurn = applyDecision(s0, [{ op: "set_slot", slot: "nome", value: "Joao", confidence: 0.9, sourceTurnId: "t0" }], "t1", NOW);
  check("L1-reducer-validation", "sourceTurnId diferente do turno atual rejeita", badTurn.ok === false, JSON.stringify(badTurn));

  const badNegativeRange = applyDecision(s0, [{ op: "set_slot", slot: "faixaPreco", value: { max: -1 }, confidence: 0.9, sourceTurnId: "t1" }], "t1", NOW);
  check("L1-reducer-validation", "faixaPreco.max negativo rejeita", badNegativeRange.ok === false, JSON.stringify(badNegativeRange));

  const badRangeOrder = applyDecision(s0, [{ op: "set_slot", slot: "faixaPreco", value: { min: 90000, max: 50000 }, confidence: 0.9, sourceTurnId: "t1" }], "t1", NOW);
  check("L1-reducer-validation", "faixaPreco min > max rejeita", badRangeOrder.ok === false, JSON.stringify(badRangeOrder));

  const emptyTrade = applyDecision(s0, [{ op: "set_slot", slot: "veiculoTroca", value: {}, confidence: 0.9, sourceTurnId: "t1" }], "t1", NOW);
  check("L1-reducer-validation", "veiculoTroca vazio rejeita", emptyTrade.ok === false, JSON.stringify(emptyTrade));
}
// L1 â€” PolicyEngine + Finalizer (Fase 1.3/1.4/1.5)
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
{
  const ctx = { state: baseState(), turnId: "t1", leadMessage: "oi", now: NOW, interpretation: { relation: "unrelated" as const }, tenantCatalog: testCatalog, claimExtractor: testClaimExtractor };
  check("L1-policy", "R3-6 authorizeQuery crm_read sem leadId -> deny", PolicyEngine.authorizeQuery({ tool: "crm_read", input: { leadId: "" } }, ctx, []).outcome === "deny", "");
  check("L1-policy", "authorizeQuery stock_search -> allow", PolicyEngine.authorizeQuery({ tool: "stock_search", input: { tipo: "suv" } }, ctx, []).outcome === "allow", "");

  // POL-TRACK-001: pergunta de pagamento pendente + propÃµe estoque -> deny
  const payObj: PendingObjective = { id: "o", type: "perguntou_pagamento", slot: "entrada", askedAt: NOW, askedInTurnId: "t0", deliveredByEffectId: "t0:m", deliveryLevel: "delivered", expectedAnswerKinds: ["valor", "negacao"], status: "pending", attempts: 0 };
  const ctxPay = { state: baseState({ currentObjective: payObj }), turnId: "t1", leadMessage: "nÃ£o tenho", now: NOW, interpretation: { relation: "answers_pending" as const }, tenantCatalog: testCatalog, claimExtractor: testClaimExtractor };
  const propStock: ProposedDecision = { proposedAction: "search_stock", facts: [], proposedEffects: [], responsePlan: { guidance: "" }, reasonCode: "", reasonSummary: "", confidence: 0.7 };
  check("L1-policy", "POL-TRACK-001 resposta de financiamento -> deny estoque", hasDeny(PolicyEngine.postQuery(propStock, [], ctxPay)), "");

  // POL-STOCK-003: ofertar veÃ­culo acima do teto -> deny
  const facts: QueryResult[] = [{ ok: true, tool: "stock_search", data: { items: [{ vehicleKey: "hyundai|creta|2020", marca: "Hyundai", modelo: "Creta", ano: 2020, preco: 86990, tipo: "suv" } as VehicleFact], filtersUsed: {} }, source: "fake" }];
  const ctxCeil = { state: baseState({ slots: { ...baseState().slots, faixaPreco: { status: "known", value: { max: 80000 }, confidence: 1, updatedAt: NOW } } }), turnId: "t1", leadMessage: "", now: NOW, interpretation: { relation: "continues_offer" as const }, tenantCatalog: testCatalog, claimExtractor: testClaimExtractor };
  const propOffer: ProposedDecision = { proposedAction: "search_stock", facts: [], proposedEffects: [{ kind: "send_message", planId: "m1", effectId: "t1:m1", order: 1, onSuccess: [{ op: "record_offer", effectId: "t1:m1", offer: { offerId: "o", tipo: "suv", precoMax: 80000, vehicleKeys: ["hyundai|creta|2020"], at: NOW } }] } as SendMessagePlan], responsePlan: { guidance: "" }, reasonCode: "", reasonSummary: "", confidence: 0.8 };
  check("L1-policy", "R2-6 POL-STOCK-003 oferta acima do teto -> deny", hasDeny(PolicyEngine.postQuery(propOffer, facts, ctxCeil)), JSON.stringify(PolicyEngine.postQuery(propOffer, facts, ctxCeil)));

  // Grounding base de referÃªncias (Fase 1.3/1.5)
  const blankDecision: TurnDecision = { turnId: "t1", action: "reply", target: null, reasonCode: "", reasonSummary: "", confidence: 1, decisionMutations: [], effectPlan: [], responsePlan: { guidance: "" }, policyChecks: [] };

  // 1. TextPart com preÃ§o livre/sem referÃªncia -> deny
  const badPriceRes = PolicyEngine.validateResponse(
    { draft: { parts: [{ type: "text", content: "Temos por apenas R$ 50.000" }] }, text: "Temos por apenas R$ 50.000" },
    facts,
    blankDecision,
    ctx
  );
  check("L1-policy", "POL-GROUND-PRICE preÃ§o livre no TextPart -> deny", hasDeny(badPriceRes), JSON.stringify(badPriceRes));

  // 2. TextPart com marca/modelo livre/sem referÃªncia -> deny
  // Modelo NAO-ATERRADO (Jeep Renegade nao esta nos fatos deste turno; so ha Creta) em texto livre -> deny (invencao).
  const badModelRes = PolicyEngine.validateResponse(
    { draft: { parts: [{ type: "text", content: "O modelo Jeep Renegade e excelente" }] }, text: "O modelo Jeep Renegade e excelente" },
    facts,
    blankDecision,
    ctx
  );
  check("L1-policy", "POL-GROUND-STOCK marca/modelo NAO-aterrado no TextPart -> deny", hasDeny(badModelRes), JSON.stringify(badModelRes));

  // Rodada 9: modelo ATERRADO nos fatos do turno pode ser citado em texto livre (conversa natural, nao invencao) -> allow.
  const groundedModelRes = PolicyEngine.validateResponse(
    { draft: { parts: [{ type: "text", content: "O Creta e um otimo SUV para voce!" }] }, text: "O Creta e um otimo SUV para voce!" },
    facts,
    blankDecision,
    ctx
  );
  check("L1-policy", "POL-GROUND-STOCK modelo ATERRADO no TextPart -> allow (Rodada 9)", !hasDeny(groundedModelRes), JSON.stringify(groundedModelRes));

  // 3. ReferÃªncia estruturada vÃ¡lida resolvida e aterrada -> allow
  const validDraft = {
    parts: [
      { type: "text" as const, content: "Temos um " },
      { type: "vehicle_ref" as const, vehicleKey: "hyundai|creta|2020", field: "modelo" as const },
      { type: "text" as const, content: " por " },
      { type: "money_ref" as const, role: "vehicle_price" as const, source: { kind: "vehicle_fact" as const, vehicleKey: "hyundai|creta|2020" } }
    ]
  };
  const renderedText = ResponseRenderer.render(validDraft, facts, ctx.state);
  const okRes = PolicyEngine.validateResponse({ draft: validDraft, text: renderedText }, facts, blankDecision, ctx);
  check("L1-policy", "Grounding estruturado por referÃªncia -> allow", !hasDeny(okRes), JSON.stringify(okRes));
  let vehiclePriceFieldRejected = false;
  try {
    ResponseRenderer.render({ parts: [{ type: "vehicle_ref", vehicleKey: "hyundai|creta|2020", field: "preco" } as any] }, facts, ctx.state);
  } catch {
    vehiclePriceFieldRejected = true;
  }
  check("L1-policy", "vehicle_ref com campo preco falha fechado", vehiclePriceFieldRejected, "");

  let badMoneySourceRejected = false;
  try {
    ResponseRenderer.render({ parts: [{ type: "money_ref", role: "installment", source: { kind: "vehicle_fact", vehicleKey: "hyundai|creta|2020" } }] }, facts, ctx.state);
  } catch {
    badMoneySourceRejected = true;
  }
  check("L1-policy", "money_ref installment com vehicle_fact rejeita", badMoneySourceRejected, "");

  const zeekrExtractor: ClaimExtractor = {
    extractClaims: (text: string) => text.includes("Zeekr X")
      ? [{ kind: "brand_model", text: "Zeekr X", normalized: "zeekr x" }]
      : []
  };
  const ctxZeekr = { ...ctx, claimExtractor: zeekrExtractor };
  const zeekrDraft = {
    parts: [
      { type: "text" as const, content: "Temos um Zeekr X por " },
      { type: "money_ref" as const, role: "vehicle_price" as const, source: { kind: "vehicle_fact" as const, vehicleKey: "hyundai|creta|2020" } }
    ]
  };
  const zeekrRendered = ResponseRenderer.render(zeekrDraft, facts, ctx.state);
  const zeekrRes = PolicyEngine.validateResponse({ draft: zeekrDraft, text: zeekrRendered }, facts, blankDecision, ctxZeekr);
  check("L1-policy", "Zeekr X + preco real de outro veiculo -> deny", hasDeny(zeekrRes), JSON.stringify(zeekrRes));

  // Finalizer: deny -> aÃ§Ã£o segura, efeitos comerciais cancelados, fatos preservados
  const post = PolicyEngine.postQuery(propStock, [], ctxPay);
  const fin = finalize("t1", { ...propStock, facts: [{ op: "append_lead_turn", turn: { role: "lead", text: "nÃ£o tenho", at: NOW } }] as DecisionMutation[] }, post, []);
  check("L1-finalizer", "deny -> action != search_stock + efeito sÃ³ send_message", fin.action !== "search_stock" && fin.effectPlan.length === 1 && fin.effectPlan[0].kind === "send_message", JSON.stringify(fin.action));
  check("L1-finalizer", "deny preserva os FATOS do inbound", fin.decisionMutations.length === 1, "");
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// L1-policy-extra: testes adversariais da Fase 1.3/1.5
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
{
  // 1. "85 mil km" e "117.000 km" nÃ£o sÃ£o interpretados como preÃ§os
  const mentionsKm = parseMoneyMentions("O carro tem 85 mil km rodados e outro com 117.000 km de quilometragem");
  check("L1-policy-extra", "85 mil km e 117.000 km nÃ£o sÃ£o preÃ§os", mentionsKm.length === 0, JSON.stringify(mentionsKm));

  // 2. "carro R$60 mil + parcela R$1.500" separa os dois roles
  const mentionsSplit = parseMoneyMentions("Temos o carro por R$ 60 mil + parcela de R$ 1.500 por mÃªs");
  const hasPrice = mentionsSplit.some(m => m.value === 60000 && m.role === "vehicle_price");
  const hasInstallment = mentionsSplit.some(m => m.value === 1500 && m.role === "installment");
  check("L1-policy-extra", "carro R$60 mil + parcela R$1.500 separa os dois roles", mentionsSplit.length === 2 && hasPrice && hasInstallment, JSON.stringify(mentionsSplit));

  // 3. "entrada R$20 mil + carro R$80 mil" separa os dois roles
  const mentionsDown = parseMoneyMentions("Com entrada de R$ 20 mil e carro R$ 80 mil reais");
  const hasDown = mentionsDown.some(m => m.value === 20000 && m.role === "down_payment");
  const hasCarPrice = mentionsDown.some(m => m.value === 80000 && m.role === "vehicle_price");
  check("L1-policy-extra", "entrada R$20 mil + carro R$80 mil", mentionsDown.length === 2 && hasDown && hasCarPrice, JSON.stringify(mentionsDown));

  // 4. "BYD Song", "GWM Haval" e "RAM Rampage" sem fatos correspondentes sÃ£o bloqueados
  const badFacts: QueryResult[] = [{ ok: true, tool: "stock_search", data: { items: [], filtersUsed: {} }, source: "fake" }];
  const blankDecision: TurnDecision = { turnId: "t1", action: "reply", target: null, reasonCode: "", reasonSummary: "", confidence: 1, decisionMutations: [], effectPlan: [], responsePlan: { guidance: "" }, policyChecks: [] };
  const ctx = { state: baseState(), turnId: "t1", leadMessage: "", now: NOW, interpretation: { relation: "unrelated" as const }, tenantCatalog: testCatalog, claimExtractor: testClaimExtractor };

  const testByd = PolicyEngine.validateResponse({ draft: { parts: [{ type: "text", content: "Temos um BYD Song" }] }, text: "Temos um BYD Song" }, badFacts, blankDecision, ctx);
  const testGwm = PolicyEngine.validateResponse({ draft: { parts: [{ type: "text", content: "Temos um GWM Haval" }] }, text: "Temos um GWM Haval" }, badFacts, blankDecision, ctx);
  const testRam = PolicyEngine.validateResponse({ draft: { parts: [{ type: "text", content: "Temos um RAM Rampage" }] }, text: "Temos um RAM Rampage" }, badFacts, blankDecision, ctx);
  check("L1-policy-extra", "BYD Song, GWM Haval e RAM Rampage sem fatos sÃ£o bloqueados", hasDeny(testByd) && hasDeny(testGwm) && hasDeny(testRam), "");

  // 5. VeÃ­culo vÃ¡lido fora de listas manuais Ã© aceito via VehicleFact dinamicamente
  const dynamicFacts: QueryResult[] = [{ ok: true, tool: "stock_search", data: { items: [{ vehicleKey: "ram|rampage|2023", marca: "RAM", modelo: "Rampage", preco: 200000, ano: 2023 } as any], filtersUsed: {} }, source: "fake" }];
  const rampageDraft = {
    parts: [
      { type: "text" as const, content: "Temos a " },
      { type: "vehicle_ref" as const, vehicleKey: "ram|rampage|2023", field: "modelo" as const },
      { type: "text" as const, content: " em estoque" }
    ]
  };
  const renderedRampage = ResponseRenderer.render(rampageDraft, dynamicFacts, ctx.state);
  const testRampageOk = PolicyEngine.validateResponse({ draft: rampageDraft, text: renderedRampage }, dynamicFacts, blankDecision, ctx);
  check("L1-policy-extra", "veÃ­culo vÃ¡lido fora de listas manuais Ã© aceito via VehicleFact", !hasDeny(testRampageOk), JSON.stringify(testRampageOk));
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// L1-turn-interpreter-extra: novos testes de interpretaÃ§Ã£o sem marcas manuais
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
{
  // 1. "prefiro financiar" responde pagamento (formaPagamento ativa) = answers_pending
  const sPay = baseState({
    currentObjective: { id: "o", type: "perguntou_pagamento", slot: "formaPagamento", askedAt: NOW, askedInTurnId: "t0", deliveredByEffectId: "t0:m", deliveryLevel: "delivered", expectedAnswerKinds: ["afirmacao"], status: "pending", attempts: 0 }
  });
  const interpFinancing = interpretTurn("prefiro financiar", sPay, defaultExtractor, testCatalog);
  check("L1-interpreter-extra", "prefiro financiar responde pagamento -> answers_pending", interpFinancing.relation === "answers_pending", JSON.stringify(interpFinancing));

  // 2. "quero SUV" responde pergunta de tipo (tipoVeiculo ativa) = answers_pending
  const sTipo = baseState({
    currentObjective: { id: "o", type: "ofereceu_opcoes", slot: "tipoVeiculo", askedAt: NOW, askedInTurnId: "t0", deliveredByEffectId: "t0:m", deliveryLevel: "delivered", expectedAnswerKinds: ["modelo"], status: "pending", attempts: 0 }
  });
  const interpSuv = interpretTurn("quero SUV", sTipo, defaultExtractor, testCatalog);
  check("L1-interpreter-extra", "quero SUV responde pergunta de tipo -> answers_pending", interpSuv.relation === "answers_pending", JSON.stringify(interpSuv));

  // 3. "agora quero sedan" durante pagamento = direction_change
  const interpSedanPay = interpretTurn("agora quero sedan", sPay, defaultExtractor, testCatalog);
  check("L1-interpreter-extra", "agora quero sedan durante pagamento -> direction_change", interpSedanPay.relation === "direction_change", JSON.stringify(interpSedanPay));
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// L1-validator-extra: testes de acoplamento de objetivos (Requirement 7)
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
{
  // 1. PlannedObjective sem activate correspondente Ã© rejeitado
  const decNoActivate: TurnDecision = {
    turnId: "t1", action: "reply", target: null, reasonCode: "", reasonSummary: "", confidence: 1,
    decisionMutations: [{ op: "set_planned_objective", planned: { id: "obj-orphan", activationPlanId: "plan-intro", effectId: "t1:plan-intro", type: "perguntou_dados", slot: "nome", plannedInTurnId: "t1", expectedAnswerKinds: ["nome"] } }],
    effectPlan: [{ kind: "send_message", planId: "plan-intro", effectId: "t1:plan-intro", order: 1, onSuccess: [] }], // nÃ£o tem activate_objective
    responsePlan: { guidance: "" }, policyChecks: []
  };
  const orphanPlanRes = validateDecisionObjectives(decNoActivate);
  check("L1-validator-extra", "PlannedObjective sem activate correspondente Ã© rejeitado", orphanPlanRes.length > 0, JSON.stringify(orphanPlanRes));

  // 2. activate sem PlannedObjective Ã© rejeitado
  const decNoPlanned: TurnDecision = {
    turnId: "t1", action: "reply", target: null, reasonCode: "", reasonSummary: "", confidence: 1,
    decisionMutations: [], // nÃ£o tem set_planned_objective
    effectPlan: [{ kind: "send_message", planId: "plan-intro", effectId: "t1:plan-intro", order: 1, onSuccess: [{ op: "activate_objective", effectId: "t1:plan-intro", plannedObjectiveId: "obj-orphan" }] }],
    responsePlan: { guidance: "" }, policyChecks: []
  };
  const orphanActivateRes = validateDecisionObjectives(decNoPlanned);
  check("L1-validator-extra", "activate sem PlannedObjective Ã© rejeitado", orphanActivateRes.length > 0, JSON.stringify(orphanActivateRes));

  // 3. Duplicidade de set_planned_objective ou activate_objective Ã© rejeitado (Fase 1.4)
  const plannedObj = { id: "obj-dup", activationPlanId: "m1", effectId: "t1:m1", type: "perguntou_dados" as const, slot: "nome" as const, plannedInTurnId: "t1", expectedAnswerKinds: ["nome" as const] };
  const decDup: TurnDecision = {
    turnId: "t1", action: "reply", target: null, reasonCode: "", reasonSummary: "", confidence: 1,
    decisionMutations: [
      { op: "set_planned_objective", planned: plannedObj },
      { op: "set_planned_objective", planned: plannedObj } // Duplicado!
    ],
    effectPlan: [{ kind: "send_message", planId: "m1", effectId: "t1:m1", order: 1, onSuccess: [{ op: "activate_objective", effectId: "t1:m1", plannedObjectiveId: "obj-dup" }] }],
    responsePlan: { guidance: "" }, policyChecks: []
  };
  const dupRes = validateDecisionObjectives(decDup);
  check("L1-validator-extra", "Duplicidade de set_planned_objective Ã© rejeitado", dupRes.some(v => v.includes("duplicata")), JSON.stringify(dupRes));
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// L1-adversarial-catalog: Testes adversariais com modelos sintÃ©ticos (Fase 1.3/1.4/1.5)
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
{
  const syntheticCatalog: TenantCatalog = {
    entries: [
      { vehicleKey: "volvo|xc60|2023", brand: "Volvo", model: "XC60", aliases: [] },
      { vehicleKey: "tesla|model-y|2023", brand: "Tesla", model: "Model-Y", aliases: [] },
      { vehicleKey: "ferrari|roma|2023", brand: "Ferrari", model: "Roma", aliases: [] }
    ]
  };
  const syntheticExtractor = new CatalogEntityExtractor();

  // Teste 1: Reconhece marca/modelo sintÃ©ticos corretos
  const entTesla = syntheticExtractor.extract("Quero comprar um Tesla Model-Y", syntheticCatalog);
  const hasTesla = entTesla.brandModelWords?.some(w => w.toLowerCase() === "tesla") && entTesla.brandModelWords?.some(w => w.toLowerCase() === "model-y");
  check("L1-adversarial-catalog", "Reconhece marca/modelo sintÃ©ticos do catÃ¡logo dinÃ¢mico", !!hasTesla, JSON.stringify(entTesla));

  // Teste 2: Ignora marcas que nÃ£o estÃ£o no catÃ¡logo sintÃ©tico
  const entByd = syntheticExtractor.extract("Quero comprar um BYD Song", syntheticCatalog);
  const hasByd = entByd.brandModelWords?.some(w => w.toLowerCase() === "byd") || entByd.brandModelWords?.some(w => w.toLowerCase() === "song");
  check("L1-adversarial-catalog", "Ignora marca/modelo fora do catÃ¡logo dinÃ¢mico sintÃ©tico", !hasByd, JSON.stringify(entByd));

  // Teste 3: Grounding rejeita modelo sintÃ©tico que nÃ£o esteja nos fatos do turno, mesmo se for vÃ¡lido no catÃ¡logo
  const badFacts: QueryResult[] = []; // Sem fatos
  const blankDecision: TurnDecision = { turnId: "t1", action: "reply", target: null, reasonCode: "", reasonSummary: "", confidence: 1, decisionMutations: [], effectPlan: [], responsePlan: { guidance: "" }, policyChecks: [] };
  const ctxSynthetic = { state: baseState(), turnId: "t1", leadMessage: "", now: NOW, interpretation: { relation: "unrelated" as const }, tenantCatalog: syntheticCatalog, claimExtractor: new MockClaimExtractor(syntheticCatalog) };

  const testVolvo = PolicyEngine.validateResponse(
    { draft: { parts: [{ type: "text", content: "Temos um Volvo XC60 em promoÃ§Ã£o" }] }, text: "Temos um Volvo XC60 em promoÃ§Ã£o" },
    badFacts,
    blankDecision,
    ctxSynthetic
  );
  check("L1-adversarial-catalog", "Rejeita marca/modelo sintÃ©tico do catÃ¡logo se ausente nos fatos", hasDeny(testVolvo), JSON.stringify(testVolvo));
  const complexCatalog: TenantCatalog = {
    entries: [
      { vehicleKey: "land-rover|range-rover-evoque|2015", brand: "Land Rover", model: "Range Rover Evoque", aliases: ["Evoque"] },
      { vehicleKey: "c++|model-x|2024", brand: "C++", model: "Model-X", aliases: [] },
      { vehicleKey: "fiat|mobi|2022", brand: "FIAT", model: "MOBI", aliases: [] }
    ]
  };
  const complexExtractor = new CatalogEntityExtractor();
  const rangeEntities = complexExtractor.extract("Quero uma Land-Rover Range Rover Evoque", complexCatalog);
  const specialEntities = complexExtractor.extract("Quero um C++ Model X", complexCatalog);

  check("L1-adversarial-catalog", "catalogo aceita key hifenizada contra marca/modelo multi-palavra", isVehicleKeyInCatalog(complexCatalog, "land-rover|range-rover-evoque|2015"), "");
  check("L1-adversarial-catalog", "catalogo aceita uppercase/lowercase canonico", isVehicleKeyInCatalog(complexCatalog, "fiat|mobi|2022"), "");
  check("L1-adversarial-catalog", "normalizacao preserva C++ sem virar letra solta", normalizeText("C++") === "c plus plus", normalizeText("C++"));
  check("L1-adversarial-catalog", "extractor reconhece Range Rover Evoque multi-palavra", !!rangeEntities.brandModelWords?.includes("Range Rover Evoque"), JSON.stringify(rangeEntities));
  check("L1-adversarial-catalog", "extractor com metacaractere nao quebra e reconhece C++", !!specialEntities.brandModelWords?.includes("C++"), JSON.stringify(specialEntities));
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// L4 â€” multiturno pelo engine
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const STOCK: VehicleFact[] = [
  { vehicleKey: "jeep|renegade|2019", marca: "Jeep", modelo: "Renegade", ano: 2019, preco: 79990, tipo: "suv", photoIds: ["p1", "p2"] },
  { vehicleKey: "hyundai|creta|2020", marca: "Hyundai", modelo: "Creta", ano: 2020, preco: 86990, tipo: "suv", photoIds: ["p3"] },
];
const runQuery: QueryRunner = async (call) => {
  if (call.tool === "stock_search") {
    const items = STOCK.filter((v) => (!call.input.tipo || v.tipo === call.input.tipo) && (call.input.precoMax == null || v.preco <= call.input.precoMax));
    return { ok: true as const, tool: "stock_search" as const, data: { items, filtersUsed: call.input as any }, source: "fake" };
  }
  if (call.tool === "crm_read") return { ok: true as const, tool: "crm_read" as const, data: { leadId: call.input.leadId, name: null }, source: "fake" };
  return { ok: false, tool: call.tool, error: { code: "NOT_FOUND", message: "n/a", retryable: false } } as QueryResult;
};
const limits = { maxSteps: 4, totalTimeoutMs: 5000 };

await (async () => {
  const llm = new FakeLlm();

  // Turno 1: "quero suv atÃ© 80 k" -> busca + oferta do Renegade (â‰¤ teto). Sem deny.
  const offer: OfferRecord = { offerId: "o1", tipo: "suv", precoMax: 80000, vehicleKeys: ["jeep|renegade|2019"], at: NOW };
  llm.setTurnScript([
    { kind: "query", call: { tool: "stock_search", input: { tipo: "suv", precoMax: 80000 } } },
    { kind: "final", proposal: {
        proposedAction: "search_stock",
        facts: [{ op: "set_slot", slot: "tipoVeiculo", value: "suv", confidence: 0.9, sourceTurnId: "t1" }, { op: "set_slot", slot: "faixaPreco", value: { max: 80000 }, confidence: 0.9, sourceTurnId: "t1" }],
        proposedEffects: [{ kind: "send_message", planId: "m1", order: 1, onSuccess: [{ op: "record_offer", offer }] } as any],
        responsePlan: { guidance: "Tenho SUVs atÃ© 80k" },
        reasonCode: "stock_lookup", reasonSummary: "", confidence: 0.9 } },
  ] as DecisionStep[]);
  const ctx1 = { state: baseState(), turnId: "t1", leadMessage: "quero suv ate 80 mil", now: NOW, interpretation: { relation: "answers_pending" as const }, tenantCatalog: testCatalog, claimExtractor: testClaimExtractor };
  const out1 = await runTurn({ ctx: ctx1, llm, runQuery, limits, maxValidationAttempts: 2 });
  check("L4", "T1: busca SUV roda + decisÃ£o search_stock sem deny", out1.decision.action === "search_stock" && !hasDeny(out1.decision.policyChecks) && out1.facts.length === 1, JSON.stringify(out1.decision.action));
  // simula dispatch + EffectOutcomeCommit: oferta entra na memÃ³ria sÃ³ apÃ³s receipt
  const afterCommit = applyDecision(ctx1.state, out1.decision.decisionMutations, "t1", NOW);
  const afterOffer = afterCommit.ok ? applyEffectOutcome(afterCommit.next, out1.decision.effectPlan[0], succeeded(effectIdFor("t1", "m1"))) : null as any;
  check("L4", "T1: oferta na memÃ³ria sÃ³ apÃ³s receipt", afterOffer?.ok && afterOffer.next.offers.last?.offerId === "o1", "");

  // Turno 2: agente jÃ¡ perguntou entrada (objetivo entregue); lead "nÃ£o tenho" -> LLM propÃµe estoque -> deny POL-TRACK-001
  const payObj: PendingObjective = { id: "o", type: "perguntou_pagamento", slot: "entrada", askedAt: NOW, askedInTurnId: "t1", deliveredByEffectId: "t1:mq", deliveryLevel: "delivered", expectedAnswerKinds: ["valor", "negacao"], status: "pending", attempts: 0 };
  llm.setTurnScript([
    { kind: "final", proposal: { proposedAction: "search_stock", facts: [{ op: "append_lead_turn", turn: { role: "lead", text: "nÃ£o tenho", at: NOW } }], proposedEffects: [], responsePlan: { guidance: "" }, reasonCode: "stock", reasonSummary: "", confidence: 0.6 } },
  ] as DecisionStep[]);
  const ctx2 = { state: baseState({ currentObjective: payObj }), turnId: "t2", leadMessage: "nÃ£o tenho", now: NOW, interpretation: { relation: "answers_pending" as const }, tenantCatalog: testCatalog, claimExtractor: testClaimExtractor };
  const out2 = await runTurn({ ctx: ctx2, llm, runQuery, limits, maxValidationAttempts: 2 });
  check("L4", "T2: resposta de financiamento NÃƒO vira estoque (POL-TRACK-001)", out2.decision.action !== "search_stock" && !out2.decision.effectPlan.some((e) => e.kind !== "send_message"), JSON.stringify(out2.decision.action));

  // Turno 3: query proibida (crm_read sem leadId) nunca executa
  llm.setTurnScript([
    { kind: "query", call: { tool: "crm_read", input: { leadId: "" } } },
    { kind: "final", proposal: { proposedAction: "reply", facts: [], proposedEffects: [{ kind: "send_message", planId: "m1", order: 1, onSuccess: [] } as any], responsePlan: { guidance: "ok" }, reasonCode: "reply", reasonSummary: "", confidence: 0.8 } },
  ] as DecisionStep[]);
  const ctx3 = { state: baseState(), turnId: "t3", leadMessage: "?", now: NOW, interpretation: { relation: "unrelated" as const }, tenantCatalog: testCatalog, claimExtractor: testClaimExtractor };
  const out3 = await runTurn({ ctx: ctx3, llm, runQuery, limits, maxValidationAttempts: 2 });
  check("L4", "R3-6 query proibida nunca executa (vira FORBIDDEN)", out3.facts.length === 1 && out3.facts[0].ok === false && (out3.facts[0] as any).error.code === "FORBIDDEN", JSON.stringify(out3.facts[0]));

  // Turno 4: validaÃ§Ã£o falha sempre -> terminal SAFE_RESPONSE (cancela comercial, sem loop/silÃªncio)
  llm.setTurnScript([
    { kind: "final", proposal: { proposedAction: "reply", facts: [], proposedEffects: [{ kind: "handoff", planId: "h1", order: 1, leadId: "lead1", sellerId: "s1", onSuccess: [{ op: "mark_handoff_completed", sellerId: "s1" }] } as any], responsePlan: { guidance: "transferindo" }, reasonCode: "handoff", reasonSummary: "", confidence: 0.8 } },
  ] as DecisionStep[], () => ({ parts: [{ type: "text", content: "preÃ§o R$ 99.999" }] }));
  const ctx4 = { state: baseState({ slots: { ...baseState().slots, nome: { status: "known", value: "JoÃ£o", confidence: 1, updatedAt: NOW } } }), turnId: "t4", leadMessage: "ok", now: NOW, interpretation: { relation: "answers_pending" as const }, tenantCatalog: testCatalog, claimExtractor: testClaimExtractor };
  const out4 = await runTurn({ ctx: ctx4, llm, runQuery, limits, maxValidationAttempts: 2 });
  check("L4", "R3-7 validaÃ§Ã£o falha sempre -> terminal SAFE + comercial cancelado", out4.terminalSafe === true && out4.decision.effectPlan.every((e) => e.kind === "send_message") && out4.composed.text.length > 0, JSON.stringify({ t: out4.terminalSafe, k: out4.decision.effectPlan.map((e) => e.kind) }));

  // Turno 5: loop esgota sem "final" -> saÃ­da segura (clarify), sem silÃªncio
  llm.setTurnScript([
    { kind: "query", call: { tool: "stock_search", input: { tipo: "suv" } } },
    { kind: "query", call: { tool: "stock_search", input: { tipo: "sedan" } } },
    { kind: "query", call: { tool: "stock_search", input: { tipo: "hatch" } } },
    { kind: "query", call: { tool: "stock_search", input: { tipo: "pickup" } } },
  ] as DecisionStep[]);
  const ctx5 = { state: baseState(), turnId: "t5", leadMessage: "?", now: NOW, interpretation: { relation: "unrelated" as const }, tenantCatalog: testCatalog, claimExtractor: testClaimExtractor };
  const out5 = await runTurn({ ctx: ctx5, llm, runQuery, limits, maxValidationAttempts: 2 });
  check("L4", "loop esgota -> saÃ­da segura (clarify), sem silÃªncio", out5.loopExhausted === true && out5.decision.action === "clarify" && out5.composed.text.length > 0, JSON.stringify(out5.decision.action));
})();

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// L4-extra: testes de integraÃ§Ã£o e timeouts
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
await (async () => {
  const llm = new FakeLlm();
  const ctx = { state: baseState(), turnId: "t1", leadMessage: "quero suv ate 80 mil", now: NOW, interpretation: { relation: "answers_pending" as const }, tenantCatalog: testCatalog, claimExtractor: testClaimExtractor };

  // 1. terminal-safe nÃ£o deixa PlannedObjective Ã³rfÃ£o
  const plObjective = { id: "obj-h1", activationPlanId: "h1", effectId: "t1:h1", type: "perguntou_dados" as const, plannedInTurnId: "t1", expectedAnswerKinds: ["nome" as const] };
  llm.setTurnScript([
    { kind: "final", proposal: { proposedAction: "reply", facts: [{ op: "set_planned_objective", planned: plObjective }], proposedEffects: [{ kind: "handoff", planId: "h1", order: 1, leadId: "lead1", sellerId: "s1", onSuccess: [{ op: "mark_handoff_completed", sellerId: "s1" }, { op: "activate_objective", plannedObjectiveId: "obj-h1" }] } as any], responsePlan: { guidance: "transferindo" }, reasonCode: "handoff", reasonSummary: "", confidence: 0.8 } },
  ] as DecisionStep[], () => ({ parts: [{ type: "text", content: "preÃ§o R$ 99.999" }] }));
  const outOrphan = await runTurn({ ctx, llm, runQuery, limits, maxValidationAttempts: 2 });
  const hasOrphan = outOrphan.decision.decisionMutations.some(m => m.op === "set_planned_objective" && m.planned.effectId === "t1:h1");
  check("L4-extra", "terminal-safe nÃ£o deixa PlannedObjective Ã³rfÃ£o", outOrphan.terminalSafe === true && !hasOrphan, "");

  // 2. Propose lanÃ§a erro
  const llmErr = new FakeLlm();
  llmErr.setTurnScript([]); // LanÃ§a erro pelo script esgotado
  const outErr = await runTurn({ ctx, llm: llmErr, runQuery, limits, maxValidationAttempts: 2 });
  check("L4-extra", "LLM propose erro -> safe fallback", outErr.terminalSafe === true && outErr.decision.reasonCode === "error" && outErr.decision.effectPlan.length === 1 && outErr.decision.effectPlan[0].planId === "safe-terminal", "");

  // 3. Query excede timeout
  const slowQueryRunner = async () => {
    await new Promise(r => setTimeout(r, 50));
    return { ok: true as const, tool: "stock_search" as const, data: { items: [], filtersUsed: {} }, source: "fake" };
  };
  const tightLimits = { maxSteps: 2, totalTimeoutMs: 1000, queryTimeoutMs: 10 };
  llm.setTurnScript([
    { kind: "query", call: { tool: "stock_search", input: {} } }
  ] as any);
  const outQueryTimeout = await runTurn({ ctx, llm, runQuery: slowQueryRunner, limits: tightLimits, maxValidationAttempts: 2 });
  check("L4-extra", "Query timeout -> safe fallback", outQueryTimeout.terminalSafe === true && outQueryTimeout.decision.reasonCode === "error", "");

  // 4. Compose excede timeout
  const slowComposeLlm = new FakeLlm();
  slowComposeLlm.setTurnScript([
    { kind: "final", proposal: { proposedAction: "reply", facts: [], proposedEffects: [], responsePlan: { guidance: "ok" }, reasonCode: "reply", reasonSummary: "", confidence: 0.9 } }
  ] as any);
  const originalCompose = slowComposeLlm.compose.bind(slowComposeLlm);
  slowComposeLlm.compose = async (d, f, c) => {
    await new Promise(r => setTimeout(r, 50));
    return originalCompose(d, f, c);
  };
  const tightLimitsCompose = { maxSteps: 2, totalTimeoutMs: 1000, composeTimeoutMs: 10 };
  const outComposeTimeout = await runTurn({ ctx, llm: slowComposeLlm, runQuery, limits: tightLimitsCompose, maxValidationAttempts: 2 });
  // P0-1 (Codex): compose timeout é DEPOIS dos fatos -> NÃO propaga (não vira error/commit_failed); vira
  // terminal-safe interno (composeAndVerify) com 1 send_message. Nunca silêncio.
  check("L4-extra", "Compose timeout -> terminal-safe interno (nao propaga como error)", outComposeTimeout.terminalSafe === true && outComposeTimeout.decision.reasonCode === "terminal_safe" && outComposeTimeout.decision.effectPlan.some((p) => p.kind === "send_message"), outComposeTimeout.decision.reasonCode);

  // 5. erro ANTES dos fatos (query/global timeout) passa pelo Finalizer como error (POL-TIMEOUT-GUARD).
  const isErrDecisionFromFinalizer = outQueryTimeout.decision.policyChecks.some(v => v.policyId === "POL-TIMEOUT-GUARD");
  check("L4-extra", "erro global/timeout (query) passa pelo Finalizer", outQueryTimeout.terminalSafe && isErrDecisionFromFinalizer, JSON.stringify(outQueryTimeout.decision.policyChecks));

  // 6. fallback nÃ£o faz promessa sem mecanismo
  const txt = outComposeTimeout.composed.text;
  const noPromise = !txt.includes("retorno") && !txt.includes("contato") && !txt.includes("ligamos");
  check("L4-extra", "fallback nÃ£o faz promessa sem mecanismo", noPromise, txt);
})();

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// L4-multiturn: Conversa real encadeada por pelo menos 4 turnos
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
await (async () => {
  const llm = new FakeLlm();
  let state = baseState();

  console.log("  --- Iniciando conversa multiturno de 4 turnos ---");

  // TURNO 1: Lead inicia com "Oi"
  const plannedNome: PlannedObjective = { id: "obj-nome", activationPlanId: "msg-intro", effectId: "t1:msg-intro", type: "perguntou_dados", slot: "nome", plannedInTurnId: "t1", expectedAnswerKinds: ["nome"] };
  llm.setTurnScript([
    { kind: "final", proposal: {
        proposedAction: "reply",
        facts: [{ op: "set_planned_objective", planned: plannedNome }],
        proposedEffects: [{ kind: "send_message", planId: "msg-intro", order: 1, onSuccess: [{ op: "activate_objective", plannedObjectiveId: "obj-nome" }, { op: "append_assistant_turn", turn: { role: "agent", text: "OlÃ¡! Qual o seu nome?", at: NOW } }] } as any],
        responsePlan: { guidance: "OlÃ¡! Qual o seu nome?" },
        reasonCode: "intro", reasonSummary: "", confidence: 1
      }
    }
  ]);
  const ctxT1 = { state, turnId: "t1", leadMessage: "Oi", now: NOW, interpretation: { relation: "unrelated" as const }, tenantCatalog: testCatalog, claimExtractor: testClaimExtractor };
  const outT1 = await runTurn({ ctx: ctxT1, llm, runQuery, limits, maxValidationAttempts: 2 });

  // Commit do Turno 1
  let commitRes = applyDecision(state, outT1.decision.decisionMutations, "t1", NOW);
  if (!commitRes.ok) throw new Error("Falha no commit T1");
  state = commitRes.next;
  // Confirma entrega do efeito
  let receiptRes = applyEffectOutcome(state, outT1.decision.effectPlan[0], succeeded("t1:msg-intro"));
  if (!receiptRes.ok) throw new Error("Falha no receipt T1");
  state = receiptRes.next;

  check("L4-multiturn", "Turno 1: objetivo de nome planejado e ativado por receipt", state.currentObjective?.id === "obj-nome" && state.stage === "greeting", "");

  // TURNO 2: Lead responde "Meu nome Ã© Carlos"
  const plannedVeiculo: PlannedObjective = { id: "obj-veiculo", activationPlanId: "msg-ask-model", effectId: "t2:msg-ask-model", type: "ofereceu_opcoes", slot: "interesse", plannedInTurnId: "t2", expectedAnswerKinds: ["modelo"] };
  llm.setTurnScript([
    { kind: "final", proposal: {
        proposedAction: "collect_slot",
        facts: [
          { op: "set_slot", slot: "nome", value: "Carlos", confidence: 1, sourceTurnId: "t2" },
          { op: "resolve_objective", objectiveId: "obj-nome", status: "satisfied" },
          { op: "set_planned_objective", planned: plannedVeiculo }
        ],
        proposedEffects: [{ kind: "send_message", planId: "msg-ask-model", order: 1, onSuccess: [{ op: "activate_objective", plannedObjectiveId: "obj-veiculo" }, { op: "advance_stage", stage: "discovery" }, { op: "append_assistant_turn", turn: { role: "agent", text: "Prazer Carlos! Que carro vocÃª busca?", at: NOW } }] } as any],
        responsePlan: { guidance: "Prazer Carlos! Que carro vocÃª busca?" },
        reasonCode: "collect_name", reasonSummary: "", confidence: 1
      }
    }
  ]);
  const ctxT2 = { state, turnId: "t2", leadMessage: "Meu nome Ã© Carlos", now: NOW, interpretation: { relation: "answers_pending" as const }, tenantCatalog: testCatalog, claimExtractor: testClaimExtractor };
  const outT2 = await runTurn({ ctx: ctxT2, llm, runQuery, limits, maxValidationAttempts: 2 });

  // Commit do Turno 2
  commitRes = applyDecision(state, outT2.decision.decisionMutations, "t2", NOW);
  if (!commitRes.ok) throw new Error("Falha no commit T2");
  state = commitRes.next;
  // Confirma entrega
  receiptRes = applyEffectOutcome(state, outT2.decision.effectPlan[0], succeeded("t2:msg-ask-model"));
  if (!receiptRes.ok) throw new Error("Falha no receipt T2");
  state = receiptRes.next;

  check("L4-multiturn", "Turno 2: nome salvo ('Carlos') e stage avanÃ§a para discovery", state.slots.nome.value === "Carlos" && state.currentObjective?.id === "obj-veiculo" && state.stage === "discovery", "");

  // TURNO 3: Lead responde "Quero um Renegade"
  const plannedPgto: PlannedObjective = { id: "obj-pagamento", activationPlanId: "msg-offer-car", effectId: "t3:msg-offer-car", type: "perguntou_pagamento", slot: "formaPagamento", plannedInTurnId: "t3", expectedAnswerKinds: ["afirmacao", "negacao"] };
  llm.setTurnScript([
    { kind: "query", call: { tool: "stock_search", input: { modelo: "renegade" } } },
    { kind: "final", proposal: {
        proposedAction: "search_stock",
        facts: [
          { op: "set_slot", slot: "interesse", value: "renegade", confidence: 1, sourceTurnId: "t3" },
          { op: "resolve_objective", objectiveId: "obj-veiculo", status: "satisfied" },
          { op: "set_planned_objective", planned: plannedPgto }
        ],
        proposedEffects: [{ kind: "send_message", planId: "msg-offer-car", order: 1, onSuccess: [
          { op: "activate_objective", plannedObjectiveId: "obj-pagamento" },
          { op: "record_offer", offer: { offerId: "o3", vehicleKeys: ["jeep|renegade|2019"], at: NOW } },
          { op: "set_presented_vehicle_focus", vehicle: { kind: "vehicle", key: "jeep|renegade|2019" } },
          { op: "advance_stage", stage: "offering" },
          { op: "append_assistant_turn", turn: { role: "agent", text: "Temos um Jeep Renegade por R$ 79.990. Qual seria a forma de pagamento?", at: NOW } }
        ] } as any],
        responsePlan: { guidance: "Temos um Jeep Renegade por R$ 79.990. Qual seria a forma de pagamento?" },
        reasonCode: "stock_search", reasonSummary: "", confidence: 1
      }
    }
  ], () => ({
    parts: [
      { type: "text" as const, content: "Temos um " },
      { type: "vehicle_ref" as const, vehicleKey: "jeep|renegade|2019", field: "marca" as const },
      { type: "text" as const, content: " " },
      { type: "vehicle_ref" as const, vehicleKey: "jeep|renegade|2019", field: "modelo" as const },
      { type: "text" as const, content: " por " },
      { type: "money_ref" as const, role: "vehicle_price" as const, source: { kind: "vehicle_fact" as const, vehicleKey: "jeep|renegade|2019" } },
      { type: "text" as const, content: ". Qual seria a forma de pagamento?" }
    ]
  }));
  const ctxT3 = { state, turnId: "t3", leadMessage: "Quero um Renegade", now: NOW, interpretation: { relation: "answers_pending" as const }, tenantCatalog: testCatalog, claimExtractor: testClaimExtractor };
  const outT3 = await runTurn({ ctx: ctxT3, llm, runQuery, limits, maxValidationAttempts: 2 });

  // Commit do Turno 3
  commitRes = applyDecision(state, outT3.decision.decisionMutations, "t3", NOW);
  if (!commitRes.ok) throw new Error("Falha no commit T3");
  state = commitRes.next;
  // Confirma entrega
  receiptRes = applyEffectOutcome(state, outT3.decision.effectPlan[0], succeeded("t3:msg-offer-car"));
  if (!receiptRes.ok) throw new Error("Falha no receipt T3");
  state = receiptRes.next;

  check("L4-multiturn", "Turno 3: interesse Renegade salvo, carro em foco e stage avanÃ§a para offering", state.slots.interesse.value === "renegade" && state.vehicleContext.focus?.key === "jeep|renegade|2019" && state.offers.last?.offerId === "o3" && state.currentObjective?.id === "obj-pagamento" && state.stage === "offering", "");

  // TURNO 4: Lead responde "Vou financiar"
  const plannedEntrada: PlannedObjective = { id: "obj-entrada", activationPlanId: "msg-ask-downpayment", effectId: "t4:msg-ask-downpayment", type: "perguntou_pagamento", slot: "entrada", plannedInTurnId: "t4", expectedAnswerKinds: ["valor"] };
  llm.setTurnScript([
    { kind: "final", proposal: {
        proposedAction: "collect_slot",
        facts: [
          { op: "set_slot", slot: "formaPagamento", value: "financiamento", confidence: 1, sourceTurnId: "t4" },
          { op: "resolve_objective", objectiveId: "obj-pagamento", status: "satisfied" },
          { op: "set_planned_objective", planned: plannedEntrada }
        ],
        proposedEffects: [{ kind: "send_message", planId: "msg-ask-downpayment", order: 1, onSuccess: [{ op: "activate_objective", plannedObjectiveId: "obj-entrada" }, { op: "advance_stage", stage: "negotiating" }, { op: "append_assistant_turn", turn: { role: "agent", text: "Legal! Quanto tem de entrada?", at: NOW } }] } as any],
        responsePlan: { guidance: "Legal! Quanto tem de entrada?" },
        reasonCode: "collect_payment", reasonSummary: "", confidence: 1
      }
    }
  ]);
  const ctxT4 = { state, turnId: "t4", leadMessage: "Vou financiar", now: NOW, interpretation: { relation: "answers_pending" as const }, tenantCatalog: testCatalog, claimExtractor: testClaimExtractor };
  const outT4 = await runTurn({ ctx: ctxT4, llm, runQuery, limits, maxValidationAttempts: 2 });

  // Commit do Turno 4
  commitRes = applyDecision(state, outT4.decision.decisionMutations, "t4", NOW);
  if (!commitRes.ok) throw new Error("Falha no commit T4");
  state = commitRes.next;
  // Confirma entrega
  receiptRes = applyEffectOutcome(state, outT4.decision.effectPlan[0], succeeded("t4:msg-ask-downpayment"));
  if (!receiptRes.ok) throw new Error("Falha no receipt T4");
  state = receiptRes.next;

  check("L4-multiturn", "Turno 4: formaPagamento salva, objetivo de entrada ativo e stage avanÃ§a para negotiating", state.slots.formaPagamento.value === "financiamento" && state.currentObjective?.id === "obj-entrada" && state.stage === "negotiating", "");
})();

console.log(`\n=== KERNEL: ${ok} OK | ${fail} FALHA ===\n`);
if (fail > 0) { console.log("FALHAS:"); for (const f of fails) console.log("  " + f); process.exit(1); }
