// ============================================================================
// F2.91 — FRONTEIRA DE AUTORIDADE DA ENGINE.
//
// O Pedro v3 ativo recebe fatos estruturados ANTES da autoria. Depois que a LLM
// escreve, a engine não pode julgar estilo, funil ou prosa comercial por regex.
// Ela continua fail-closed para referências estruturadas, recursos inexistentes,
// efeitos sobre alvo errado e vazamento de referências sensíveis.
// ============================================================================
import { readFileSync } from "node:fs";
import { createInitialState, type PendingObjective } from "../src/domain/conversation-state.ts";
import type { TurnContext } from "../src/domain/context.ts";
import type { ProposedDecision, QueryResult, RenderedResponse, TurnDecision } from "../src/domain/decision.ts";
import type { VehicleFact } from "../src/domain/types.ts";
import { buildTenantCatalog } from "../src/engine/catalog-utils.ts";
import { enrichStockSearchCall } from "../src/engine/central-engine.ts";
import { PolicyEngine, hasDeny } from "../src/engine/policy-engine.ts";
import { responseAuthorityProfile } from "../src/engine/response-authority.ts";
import { assertToolExecutionAuthority } from "../src/engine/tool-authority.ts";
import { sensitiveReferenceLeakFeedback } from "../src/engine/turn-understanding.ts";
import { CatalogClaimExtractor } from "../src/engine/turn-context-preparer.ts";

let ok = 0;
let fail = 0;
const failures: string[] = [];
function check(name: string, pass: boolean, detail = ""): void {
  if (pass) { ok++; console.log(`  OK  ${name}`); return; }
  fail++; failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
  console.error(`  RED ${name}${detail ? ` — ${detail}` : ""}`);
}

const NOW = "2026-07-28T15:00:00.000Z";
const COMPASS: VehicleFact = {
  vehicleKey: "rm:compass", marca: "Jeep", modelo: "Compass", ano: 2021,
  preco: 121400, km: 74652, cambio: "Automatico", cor: "Prata", tipo: "suv",
};
const KA: VehicleFact = {
  vehicleKey: "rm:ka", marca: "Ford", modelo: "Ka", ano: 2019,
  preco: 63990, km: 119443, cambio: "Automatico", cor: "Prata", tipo: "hatch",
};
const catalog = buildTenantCatalog([COMPASS, KA]);
const claimExtractor = new CatalogClaimExtractor(catalog);
const initial = createInitialState({ conversationId: "wa:lead", tenantId: "tenant", agentId: "agent", leadId: null, now: NOW });
const context = (overrides: Partial<TurnContext> = {}): TurnContext => ({
  state: initial,
  turnId: "turn",
  leadMessage: "Tenho interesse.",
  now: NOW,
  interpretation: { relation: "ambiguous" },
  tenantCatalog: catalog,
  claimExtractor,
  ...overrides,
});
const decision: TurnDecision = {
  turnId: "turn", action: "reply", target: null, reasonCode: "reply", reasonSummary: "reply",
  confidence: 1, decisionMutations: [], effectPlan: [], responsePlan: { guidance: "" }, policyChecks: [],
};
const say = (text: string): RenderedResponse => ({ draft: { parts: [{ type: "text", content: text }] }, text });
const stockFact: QueryResult = {
  ok: true, tool: "stock_search", source: "fake",
  data: { items: [COMPASS], filtersUsed: { modelo: "Compass" } },
} as QueryResult;
const policyIds = (
  response: RenderedResponse,
  facts: QueryResult[],
  ctx: TurnContext,
  mode: "legacy_strict" | "legacy_without_style" | "central_active" | boolean,
): string[] => PolicyEngine.validateResponse(response, facts, decision, ctx, mode)
  .filter((v) => v.outcome === "deny")
  .map((v) => v.policyId);

const pendingPayment: PendingObjective = {
  id: "objective", type: "perguntou_pagamento", slot: "entrada", askedAt: NOW,
  askedInTurnId: "previous", deliveredByEffectId: "previous:message", deliveryLevel: "delivered",
  expectedAnswerKinds: ["valor", "negacao"], status: "pending", attempts: 0,
};
const baseProposal: ProposedDecision = {
  proposedAction: "search_stock", facts: [], proposedEffects: [], nextPlanned: null,
  responsePlan: { guidance: "" }, reasonCode: "reply", reasonSummary: "reply", confidence: 1,
};
const offerProposal = (vehicleKey: string): ProposedDecision => ({
  ...baseProposal,
  proposedEffects: [{
    kind: "send_message", planId: "message", order: 1,
    onSuccess: [{ op: "record_offer", offer: { offerId: "offer", vehicleKeys: [vehicleKey], at: NOW } }],
  } as ProposedDecision["proposedEffects"][number]],
});

async function main(): Promise<void> {
  console.log("== F2.91: fronteira de autoridade da engine ==");

  const active = responseAuthorityProfile("central_active");
  check("[A1] central_active não veta texto, política comercial ou grounding lexical",
    !active.conversationalTextVeto && !active.commercialPolicyVeto && !active.lexicalGroundingVeto);
  check("[A2] central_active preserva estrutura, efeitos e vazamento sensível",
    active.structuredGroundingVeto && active.executableEffectVeto && active.sensitiveLeakVeto);
  const compatible = responseAuthorityProfile(true);
  check("[A3] booleano antigo continua sendo apenas legacy_without_style",
    compatible.mode === "legacy_without_style" && compatible.lexicalGroundingVeto && !compatible.conversationalTextVeto);

  const freeText = say("Encontrei um Ford Ka 2030 por R$ 999.999. Posso seguir?");
  const legacyDenies = policyIds(freeText, [], context(), "legacy_strict");
  check("[B1] legado ainda detecta alegações livres", legacyDenies.length > 0, legacyDenies.join(","));
  check("[B2] central_active não derruba turno por reinterpretação da prosa",
    policyIds(freeText, [], context(), "central_active").length === 0);
  check("[B3] compatibilidade booleana não desliga grounding lexical",
    policyIds(freeText, [], context(), true).length > 0);

  const badVehicleRef: RenderedResponse = {
    draft: { parts: [{ type: "vehicle_ref", vehicleKey: "invented:key", field: "modelo" }] }, text: "Veículo",
  };
  check("[C1] central_active rejeita vehicle_ref para chave inexistente",
    policyIds(badVehicleRef, [], context(), "central_active").includes("POL-GROUND-STOCK"));
  const badMoneyRef: RenderedResponse = {
    draft: { parts: [{ type: "money_ref", role: "vehicle_price", source: { kind: "vehicle_fact", vehicleKey: "invented:key" } }] }, text: "Preço",
  };
  check("[C2] central_active rejeita money_ref para chave inexistente",
    policyIds(badMoneyRef, [], context(), "central_active").includes("POL-GROUND-STOCK"));
  const badOfferList: RenderedResponse = {
    draft: { parts: [{ type: "vehicle_offer_list", vehicleKeys: ["invented:key"] }] }, text: "Opções",
  };
  check("[C3] central_active rejeita lista estruturada com chave inexistente",
    policyIds(badOfferList, [], context(), "central_active").includes("POL-GROUND-STOCK"));
  const goodVehicleRef: RenderedResponse = {
    draft: { parts: [{ type: "vehicle_ref", vehicleKey: COMPASS.vehicleKey, field: "modelo" }] }, text: "Compass",
  };
  check("[C4] referência estruturada para fato fresco continua aceita",
    policyIds(goodVehicleRef, [stockFact], context(), "central_active").length === 0);

  const paymentCtx = context({
    state: { ...initial, currentObjective: pendingPayment },
    interpretation: { relation: "answers_pending" },
  });
  check("[D1] legado pode negar desvio comercial de objetivo",
    PolicyEngine.postQuery(baseProposal, [], paymentCtx, "legacy_strict")
      .some((v) => v.policyId === "POL-TRACK-001" && v.outcome === "deny"));
  check("[D2] central_active deixa a decisão comercial com a LLM",
    !hasDeny(PolicyEngine.postQuery(baseProposal, [], paymentCtx, "central_active")));

  const ceilingCtx = context({
    state: {
      ...initial,
      slots: { ...initial.slots, faixaPreco: { status: "known", value: { max: 80000 }, confidence: 1, updatedAt: NOW } },
    },
  });
  check("[D3] legado veta oferta acima do teto",
    PolicyEngine.postQuery(offerProposal(COMPASS.vehicleKey), [stockFact], ceilingCtx, "legacy_strict")
      .some((v) => v.policyId === "POL-STOCK-003" && v.outcome === "deny"));
  check("[D4] central_active não substitui a estratégia comercial do prompt",
    !hasDeny(PolicyEngine.postQuery(offerProposal(COMPASS.vehicleKey), [stockFact], ceilingCtx, "central_active")));
  check("[D5] central_active ainda bloqueia oferta estruturada de chave inexistente",
    PolicyEngine.postQuery(offerProposal("invented:key"), [], context(), "central_active")
      .some((v) => v.policyId === "POL-GROUND-STOCK" && v.outcome === "deny"));
  const rememberedOfferState = {
    ...initial,
    lastRenderedOfferContext: {
      sourceTurnId: "previous-turn",
      createdAt: NOW,
      items: [{
        ordinal: 1,
        vehicleKey: COMPASS.vehicleKey,
        marca: COMPASS.marca,
        modelo: COMPASS.modelo,
        ano: COMPASS.ano,
        preco: COMPASS.preco,
        km: COMPASS.km ?? null,
        cor: COMPASS.cor ?? null,
        cambio: COMPASS.cambio ?? null,
        tipo: COMPASS.tipo,
      }],
    },
  };
  check("[D6] oferta ja entregue permanece ofertavel quando o snapshot atual oscila",
    !hasDeny(PolicyEngine.postQuery(
      offerProposal(COMPASS.vehicleKey),
      [],
      context({ state: rememberedOfferState, tenantCatalog: buildTenantCatalog([]) }),
      "central_active",
    )));

  check("[E1] referência interna sensível continua bloqueada",
    sensitiveReferenceLeakFeedback("Recebi cpf_valido_ref e vou prosseguir.") != null);
  check("[E2] resposta natural não precisa usar frase obrigatória de reconhecimento",
    sensitiveReferenceLeakFeedback("Perfeito, podemos continuar.") == null);
  check("[E2a] mencionar o tipo de dado sem expor valor ou referência interna continua permitido",
    sensitiveReferenceLeakFeedback("Recebi seu CPF e podemos seguir com o atendimento.") == null);

  let directToolAllowed = true;
  try {
    assertToolExecutionAuthority("stock_search", {
      principal: "llm", source: "llm_tool_call", primaryIntent: "search_stock",
      capability: null, currentTurnEvidence: false, callSite: "f2.91",
    });
  } catch { directToolAllowed = false; }
  check("[E3] chamada direta da LLM é autoridade suficiente para tool de leitura", directToolAllowed);
  let indirectWithoutEvidenceRejected = false;
  try {
    assertToolExecutionAuthority("stock_search", {
      principal: "llm", source: "llm_intent_completion", primaryIntent: "search_stock",
      capability: "stock_search", currentTurnEvidence: false, callSite: "f2.91",
    });
  } catch { indirectWithoutEvidenceRejected = true; }
  check("[E4] execução indireta pela engine continua exigindo evidência atual", indirectWithoutEvidenceRejected);

  const centralSource = readFileSync(new URL("../src/engine/central-engine.ts", import.meta.url), "utf8");
  check("[F1] autoria ativa seleciona explicitamente central_active",
    /args\.requireBrain\s*\?\s*"central_active"\s*:\s*"legacy_strict"/.test(centralSource));
  check("[F2] policy pós-query recebe a autoridade explícita",
    /PolicyEngine\.postQuery\(proposal, realFacts, args\.ctx, authorityMode\)/.test(centralSource));
  check("[F3] validação da resposta recebe a autoridade explícita",
    /PolicyEngine\.validateResponse\(composed, renderFacts, decision0, args\.ctx, authorityMode\)/.test(centralSource));
  check("[F4] central_active não força requiredToolBeforeFinal",
    /const missingTool = llmFirst \? null : requiredToolBeforeFinal\(/.test(centralSource)
      && /const finalMissingTool = llmFirst \? null : requiredToolBeforeFinal\(/.test(centralSource));
  const directQueryStart = centralSource.indexOf("const call = step.call");
  const directQueryEnd = centralSource.indexOf("const sig = toolCallSignature(call)", directQueryStart);
  const directQueryBoundary = directQueryStart >= 0 && directQueryEnd > directQueryStart
    ? centralSource.slice(directQueryStart, directQueryEnd)
    : "";
  check("[F5] query direta da LLM não exige understanding duplicado",
    /A direct QueryCall is a read chosen by the LLM/.test(directQueryBoundary)
      && !/UNDERSTANDING_REQUIRED|REQUIRED_TURN_UNDERSTANDING/.test(directQueryBoundary));
  check("[F6] mídia ativa passa pela prova factual única",
    /groundProposedMediaEffects\(args\.finalDecision\.proposedEffects, args\.facts\)/.test(centralSource));

  const llmOwnedSearch = enrichStockSearchCall(
    { tool: "stock_search", input: { tipo: "suv", excludeKeys: ["shown:key", "hidden:key"] } },
    {
      popular: true,
      moreOptions: true,
      previousVehicleKeys: ["shown:key"],
      constraints: {
        marca: "Jeep", modelos: ["Compass"], anos: [2021], precoMax: 90000,
        cambio: "automatic", combustivel: "diesel", popular: true,
      },
      wantsMotorcycle: true,
      enforceShownClamp: true,
      llmOwnsFilters: true,
    },
  );
  const llmOwnedInput = llmOwnedSearch.input as Record<string, unknown>;
  check("[F7] chamada direta executa somente os filtros comerciais declarados pela LLM",
    llmOwnedInput.tipo === "suv"
      && llmOwnedInput.marca == null
      && llmOwnedInput.modelo == null
      && llmOwnedInput.anos == null
      && llmOwnedInput.precoMax == null
      && llmOwnedInput.cambio == null
      && llmOwnedInput.combustivel == null
      && llmOwnedInput.popular == null
      && llmOwnedInput.includeMotorcycles == null,
    JSON.stringify(llmOwnedInput));
  check("[F8] protecao objetiva ainda remove excludeKey que nunca foi mostrado",
    JSON.stringify(llmOwnedInput.excludeKeys) === JSON.stringify(["shown:key"]),
    JSON.stringify(llmOwnedInput.excludeKeys));
  check("[F9] loop ativo declara explicitamente a autoridade da LLM sobre filtros",
    /llmOwnsFilters:\s*llmFirst/.test(centralSource));
  check("[F10] engine não cria nem renomeia handoff no fluxo ativo",
    !/const forcedHandoffReason/.test(centralSource)
      && !/photoSafeEffects\.map\(\(effect\) => effect\.kind === \"handoff\"/.test(centralSource));
  check("[F11] handoff proposto permanece sujeito apenas à executabilidade",
    /proposedHandoff && args\.handoffPlannable !== true/.test(centralSource));
  check("[F12] alegacao textual de visita nao e hard deny no central_active",
    /authority\.lexicalGroundingVeto\s*&&\s*promisesVisitScheduled\(composed\.text\)/.test(centralSource)
      && !/authority\.executableEffectVeto\s*&&\s*promisesVisitScheduled\(composed\.text\)/.test(centralSource));
  check("[F13] engine nao possui mais busca comercial deterministica morta no pos-loop",
    !centralSource.includes('source: "det_completion"')
      && !centralSource.includes('callSite: "search_fact_completion"'));
  check("[F14] engine nao conserva guarda de alvo com condicao estruturalmente impossivel",
    !centralSource.includes("const unresolvedDetailTarget = applyLegacyStyleGuards"));
  const exactDupStart = centralSource.indexOf("if (seenToolSigs.has(sig))");
  const exactDupLegacyStart = centralSource.indexOf("const dupCap =", exactDupStart);
  const activeExactDup = exactDupStart >= 0 && exactDupLegacyStart > exactDupStart
    ? centralSource.slice(exactDupStart, exactDupLegacyStart)
    : "";
  check("[F15] tool duplicada no central_active encerra tools sem deny nem nova observacao",
    /if \(llmFirst\)[\s\S]*?break;/.test(activeExactDup)
      && !/observations\.push\(/.test(activeExactDup),
    activeExactDup.slice(0, 240));
  const semanticDupStart = centralSource.indexOf("if (execCall.tool === \"stock_search\" && stockSearchCache.has(");
  const semanticDupLegacyStart = centralSource.indexOf("observations.push({ tool: \"response\"", semanticDupStart);
  const activeSemanticDup = semanticDupStart >= 0 && semanticDupLegacyStart > semanticDupStart
    ? centralSource.slice(semanticDupStart, semanticDupLegacyStart)
    : "";
  check("[F16] busca semanticamente duplicada no central_active nao cria DUP_STOCK_SEARCH",
    /if \(llmFirst\)[\s\S]*?break;/.test(activeSemanticDup)
      && !/DUP_STOCK_SEARCH/.test(activeSemanticDup),
    activeSemanticDup.slice(0, 240));
  const completenessStart = centralSource.indexOf("function turnCompletenessFeedback(");
  const completenessEnd = centralSource.indexOf("// ╔", completenessStart);
  const completenessBoundary = completenessStart >= 0 && completenessEnd > completenessStart
    ? centralSource.slice(completenessStart, completenessEnd)
    : "";
  check("[F17] completude conversacional e escolha de tool nao vetam o central_active",
    /if \(!authority\.conversationalTextVeto\) return null;/.test(completenessBoundary));
  const photoPostconditionAt = completenessBoundary.indexOf("photoOperationalPostcondition(args)");
  const conversationalVetoAt = completenessBoundary.indexOf("if (!authority.conversationalTextVeto) return null;");
  check("[F17a] ato de foto declarado valida efeito antes da fronteira conversacional",
    photoPostconditionAt >= 0 && conversationalVetoAt > photoPostconditionAt,
    `photo=${photoPostconditionAt} conversational=${conversationalVetoAt}`);
  const activeFallbackStart = centralSource.indexOf("} else if (!legacyReplayEnabled) {");
  const legacyFallbackStart = centralSource.indexOf("} else {", activeFallbackStart + 1);
  const activeFallback = activeFallbackStart >= 0 && legacyFallbackStart > activeFallbackStart
    ? centralSource.slice(activeFallbackStart, legacyFallbackStart)
    : "";
  check("[F18] falha de autoria ativa nao aciona redator comercial deterministico",
    /responseSource = "technical_fallback"/.test(activeFallback)
      && !/buildDeterministicPhotoResponse|buildInstitutionalResponse|buildContextualRecovery/.test(activeFallback));
  check("[F19] autoria deterministica comercial permanece protegida por opt-in de replay",
    /assertLegacyAuthoringAuthorized\(responseSource, \{ llmFirst, legacyCommercialReplay \}\)/.test(centralSource)
      && /if \(legacyReplayEnabled\)/.test(centralSource));

  // O isolamento acima só protege se produção realmente entrar no caminho
  // `central_active`. Estas regressões travam a composição do runtime: rollout
  // global, default LLM-first, propagação do modo ao root e autoria única.
  const scopeSource = readFileSync(new URL("../src/domain/pilot-scope.ts", import.meta.url), "utf8");
  const serverSource = readFileSync(new URL("../src/runtime/server.ts", import.meta.url), "utf8");
  const activeRootSource = readFileSync(new URL("../src/engine/pilot-active-root.ts", import.meta.url), "utf8");
  check("[G1] rollout de produção permanece global no Pedro v3",
    /export const PEDRO_V3_GLOBAL_ROLLOUT\s*=\s*true\s*;/.test(scopeSource));
  check("[G2] modo omitido usa central_active e off exige configuração explícita",
    /return value === "off" \|\| value === "central_active" \|\| value === "central_shadow" \? value : "central_active";/.test(serverSource));
  check("[G3] composition root recebe exatamente o modo resolvido pelo runtime",
    /const brainMode = resolveBrainMode\(\);[\s\S]*?brainMode,\s*\n\s*agentBrainFactory,/.test(serverSource));
  const activeRouteStart = activeRootSource.indexOf('if (this.mode === "central_active" && this.agentBrain)');
  const handlerRouteStart = activeRootSource.indexOf("const result = await this.#processHandlerFirst(input);", activeRouteStart);
  const activeRoute = activeRouteStart >= 0 && handlerRouteStart > activeRouteStart
    ? activeRootSource.slice(activeRouteStart, handlerRouteStart)
    : "";
  check("[G4] central_active entra no cérebro antes de qualquer handler comercial legado",
    /return this\.#processCentralActive\(input\);/.test(activeRoute)
      && !/#processHandlerFirst/.test(activeRoute));
  const activeCallStart = activeRootSource.indexOf("const engine = await runCentralConversationTurn({");
  const activeCallEnd = activeRootSource.indexOf("});", activeCallStart);
  const activeCall = activeCallStart >= 0 && activeCallEnd > activeCallStart
    ? activeRootSource.slice(activeCallStart, activeCallEnd)
    : "";
  check("[G5] chamada real de produção fixa autoria única e LLM-first",
    /singleAuthor:\s*true/.test(activeCall) && /llmFirst:\s*true/.test(activeCall));

  console.log(`\nF2.91: ${ok} OK / ${fail} FALHA`);
  if (fail) { console.error(failures.join("\n")); process.exit(1); }
}

main().catch((error) => { console.error(error); process.exit(1); });
