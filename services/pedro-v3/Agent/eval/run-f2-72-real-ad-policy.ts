// F2.72 — smoke real curto do contrato de política + anúncio/fotos.
// Efeitos externos OFF: estoque e LLM são reais; WhatsApp/CRM/vendedor ficam em memória.
// Uso explícito:
//   $env:PEDRO_V3_REAL_EVAL='1'; $env:EVAL_USE_PLATFORM_KEY='1'; npm run smoke:f272
// O script aborta antes do fluxo se provider/modelo não forem OpenAI/gpt-4.1-mini.

import { createHash } from "node:crypto";
import { RealClock } from "../src/runtime/real-clock.ts";
import type { TenantAgentRef } from "../src/domain/read-ports.ts";
import { buildTenantPolicyPromptSection, validateTenantPolicyDecision, type TenantFunnelPolicy } from "../../../../src/lib/pedroFunnelPolicyContract.ts";
import { buildRealAssemblyFor, loadServiceEnv, sanitize } from "./real-harness.ts";
import { buildCentralStack, runCentralConversation } from "./central-real-harness.ts";

const BRUNO: TenantAgentRef = {
  tenantId: "f49fd48a-4386-4009-95f3-26a5100b84f7",
  agentId: "aee7e916-31b1-431c-ba6f-f38178fd4899",
};

const MAX_USD = 0.10;
const MAX_LLM_CALLS = Number(process.env.F272_MAX_LLM_CALLS ?? "16");

const policy: TenantFunnelPolicy = {
  id: "entrada_financiada",
  enabled: true,
  name: "Entrada informada",
  domain: "financial",
  when: "quando o lead informa explicitamente um valor que pode dar de entrada",
  action: "inform",
  responseGuidance: "acolha o valor informado e prossiga naturalmente para entender o financiamento, sem pedir novamente a entrada",
  evidenceRequirement: "trecho literal do bloco atual com o valor da entrada",
  priority: 20,
};

const adContext = {
  adId: "f2-72-hb20x",
  source: "instagram",
  sourceUrl: "https://instagram.com/p/f2-72-hb20x",
  title: "Hyundai HB20X Premium 1.6 2019",
  body: "Fale com nossos consultores",
  greeting: "Olá! Quero saber mais sobre o Hyundai HB20X Premium 1.6 2019.",
  imageUrls: ["https://scontent.example.invalid/hb20x.jpg"],
  vehicleQuery: "Hyundai HB20X Premium 1.6 2019",
  vehicleType: "hatch",
  summary: "O anúncio identifica um Hyundai HB20X Premium 1.6 2019.",
  confidence: 1,
  semanticSource: "image",
  capturedAtTurn: 0,
};

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function usageCost(calls: readonly { promptTokens?: number; completionTokens?: number }[]): number {
  const input = calls.reduce((sum, call) => sum + (call.promptTokens ?? 0), 0);
  const output = calls.reduce((sum, call) => sum + (call.completionTokens ?? 0), 0);
  // gpt-4.1-mini: US$0.40/M input e US$1.60/M output.
  return (input * 0.40 + output * 1.60) / 1_000_000;
}

function fail(message: string): never {
  console.error(`F2.72 BLOQUEADO/FAIL: ${message}`);
  process.exit(1);
  throw new Error(message);
}

async function main(): Promise<void> {
  if (process.env.PEDRO_V3_REAL_EVAL !== "1") fail("defina PEDRO_V3_REAL_EVAL=1");
  loadServiceEnv();
  // Limita a saída antes de construir o stack; o default de produção/eval não muda.
  process.env.CENTRAL_EVAL_BRAIN_MAX_COMPLETION_TOKENS = "700";
  process.env.CENTRAL_EVAL_COMPOSE_MAX_COMPLETION_TOKENS = "500";
  process.env.CENTRAL_EVAL_TURN_DELAY_MS = "0";

  const assembly = await buildRealAssemblyFor(BRUNO, new RealClock());
  if (assembly.aiProvider.provider !== "openai") fail(`provider=${assembly.aiProvider.provider}; esperado openai`);
  if (assembly.aiProvider.model !== "gpt-4.1-mini") fail(`model=${assembly.aiProvider.model}; esperado gpt-4.1-mini`);

  const policyPrompt = buildTenantPolicyPromptSection([policy]);
  const promptText = `${assembly.runtimeConfig.promptText.trim()}\n\n${policyPrompt}`;
  const testAssembly = {
    ...assembly,
    portalPrompt: promptText,
    promptSha: sha256(promptText),
    runtimeConfig: { ...assembly.runtimeConfig, promptText, tenantPolicies: [policy] },
  };
  const stack = buildCentralStack(testAssembly, promptText);
  const turns = await runCentralConversation(
    testAssembly,
    stack,
    `f2-72-${Date.now().toString(36)}`,
    [
      ["Olá, vim pelo anúncio. Esse Hyundai HB20X ainda está disponível?"],
      ["Pode me mandar fotos dele?"],
      ["Tenho 15 mil de entrada e quero financiar o restante."],
    ],
    {
      maxLlmCalls: MAX_LLM_CALLS,
      singleAuthor: true,
      llmFirst: true,
      firstTurnAdContext: adContext,
    },
  );

  const calls = [...stack.brainTransport.calls, ...stack.composeTransport.calls];
  const cost = usageCost(calls);
  const errors: string[] = [];
  if (turns.length !== 3) errors.push(`turn_count=${turns.length}`);
  if (turns.some((turn) => turn.status !== "committed")) errors.push("turn_not_committed");
  if (turns.some((turn) => turn.responseSource !== "brain_final" && turn.responseSource !== "brain_retry")) errors.push("non_llm_response_source");
  if (turns.some((turn) => turn.terminalSafe)) errors.push("terminal_safe_or_degraded_turn");
  if (!/hb\s*20\s*x/i.test(turns[0]?.response ?? "")) errors.push("opening_did_not_name_ad_vehicle");
  if (/\b1[.)]\s+[^\n]+\b2[.)]\s+/i.test(turns[0]?.response ?? "")) errors.push("opening_sent_broad_vehicle_list");
  if (!turns[1]?.effects.some((effect) => effect.kind === "send_media")) errors.push("photo_effect_missing");
  const declared = turns[2]?.policyDecision ?? null;
  if (!declared) errors.push("policy_decision_missing_on_entry_turn");
  else {
    const policyIssues = validateTenantPolicyDecision(declared, "Tenho 15 mil de entrada e quero financiar o restante.", [policy]);
    if (policyIssues.length > 0) errors.push(`policy_not_grounded:${policyIssues.map((issue) => issue.code).join(",")}`);
    if (declared.action !== "inform" || declared.policyId !== policy.id) errors.push("policy_decision_mismatch");
  }
  if (cost > MAX_USD) errors.push(`cost_over_cap=${cost.toFixed(6)}`);

  console.log(JSON.stringify({
    result: errors.length === 0 ? "PASS" : "FAIL",
    provider: assembly.aiProvider.provider,
    model: assembly.aiProvider.model,
    calls: calls.length,
    brainCalls: stack.brainTransport.count,
    composeCalls: stack.composeTransport.count,
    costUsd: Number(cost.toFixed(6)),
    promptSha: testAssembly.promptSha.slice(0, 16),
    turns: turns.map((turn) => ({
      turn: turn.turnIndex,
      lead: sanitize(turn.leadBlock),
      response: sanitize(turn.response),
      source: turn.responseSource,
      intent: turn.primaryIntent,
      tools: turn.toolsRequested,
      effects: turn.effects.map((effect) => ({ kind: effect.kind, vehicleKey: effect.vehicleKey, photoCount: effect.photoCount })),
      policyDecision: turn.policyDecision ?? null,
      feedback: turn.policyFeedback ?? [],
    })),
    errors,
  }, null, 2));
  if (errors.length > 0) process.exit(1);
}

main().catch((error) => fail(sanitize(String((error as Error)?.message ?? error))));
