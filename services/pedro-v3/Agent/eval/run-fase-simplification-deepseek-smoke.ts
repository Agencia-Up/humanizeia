// ============================================================================
// run-fase-simplification-deepseek-smoke.ts — SMOKE REAL da simplificação estrutural (FASES 1/3/4/5/6),
// EXCLUSIVAMENTE DeepSeek (NÃO OpenAI — inferência 100% via proxy DeepSeek; nenhuma chamada OpenAI). Prova, com LLM
// real + prompt/estoque reais do piloto, os 3 cenários da missão:
//   A) SUV automático -> busca -> "Gostei do primeiro" -> "agendar segunda" (visita, não ordinal)
//   B) entrada por anúncio específico (Compass) -> info -> foto do veículo certo (sem lista ampla)
//   C) endereço -> resposta factual -> horário (sem "instabilidade", sem repetir, sem pedir nome)
// Efeitos OFF. Teto de 8 chamadas reais por cenário. Relatório por turno.
//   npx tsx eval/run-fase-simplification-deepseek-smoke.ts
// ============================================================================
import { loadServiceEnv, buildRealAssembly, CountingModelHttpTransport, RetryingModelHttpTransport, type RealAssembly } from "./real-harness.ts";
import { FetchModelHttpTransport } from "../src/runtime/fetch-transports.ts";
import { OpenAiAgentBrain } from "../src/adapters/llm/openai-agent-brain.ts";
import { PromptBoundConversationAdapter } from "../src/adapters/llm/prompt-bound-conversation.ts";
import { createOpenAiModelFactory } from "../src/engine/openai-canary-root.ts";
import { runCentralConversation, buildCentralStack, CENTRAL_ALLOWED_TOOLS, type CentralStack } from "./central-real-harness.ts";
import type { CentralTurnCapture } from "./central-assertions.ts";
import type { AdContext } from "../src/domain/ad-context.ts";
import type { ModelHttpRequest, ModelHttpResponse, ModelHttpTransport } from "../src/adapters/llm/structured-json-model.ts";

const DEEPSEEK_ENDPOINT = "https://api.deepseek.com/chat/completions";
const DEEPSEEK_PROXY_URL = "https://seyljsqmhlopkcauhlor.supabase.co/functions/v1/pedro-v3-deepseek-eval-proxy";
const MAX_CALLS_PER_SCENARIO = 8;

// A chave DeepSeek fica no cofre da Edge Function; o runner só autentica com a service role. Nenhuma chave OpenAI.
class DeepSeekEvalProxyTransport implements ModelHttpTransport {
  readonly #inner = new FetchModelHttpTransport();
  postJson(_url: string, request: ModelHttpRequest): Promise<ModelHttpResponse> {
    return this.#inner.postJson(DEEPSEEK_PROXY_URL, request);
  }
}

function buildDeepSeekStack(assembly: RealAssembly): CentralStack {
  const promptText = assembly.runtimeConfig.promptText;
  const brainTransport = new CountingModelHttpTransport(new RetryingModelHttpTransport(new DeepSeekEvalProxyTransport()));
  brainTransport.fullPrompt = promptText;
  const brain = new OpenAiAgentBrain(assembly.openAiSecret, brainTransport, promptText, {
    endpointUrl: DEEPSEEK_ENDPOINT, allowedHosts: ["api.deepseek.com"], tokenParameter: "max_tokens",
    model: assembly.aiProvider.model, retryModel: assembly.aiProvider.model,
    temperature: 0.1, maxCompletionTokens: 1_200, timeoutMs: 60_000, allowedTools: [...CENTRAL_ALLOWED_TOOLS],
  });
  const composeTransport = new CountingModelHttpTransport(new RetryingModelHttpTransport(new DeepSeekEvalProxyTransport()));
  composeTransport.fullPrompt = promptText;
  const composeModel = createOpenAiModelFactory({
    openAiSecret: assembly.openAiSecret, modelTransport: composeTransport,
    modelOptions: {
      endpointUrl: DEEPSEEK_ENDPOINT, allowedHosts: ["api.deepseek.com"], tokenParameter: "max_tokens",
      modelOverride: assembly.aiProvider.model, temperatureOverride: 0.3, timeoutMs: 30_000, maxResponseBytes: 2 * 1024 * 1024, maxCompletionTokens: 1_200,
    },
  })(assembly.runtimeConfig);
  const composeLlm = new PromptBoundConversationAdapter(assembly.runtimeConfig, composeModel);
  return { brain, brainTransport, composeLlm, composeTransport };
}

const adCompass: AdContext = {
  adId: "120253981641730460", source: "FB_Ads", sourceUrl: "https://fb.me/c9tWuhhGL",
  title: "Anuncio do Facebook", body: "Fale com nossos consultores",
  greeting: "Ola! Posso ter mais informacoes sobre isso?",
  imageUrls: ["https://scontent.fbcdn.net/full.jpg"],
  vehicleQuery: "Jeep Compass 2019", vehicleType: "suv",
  summary: "A arte do anuncio identifica um Jeep Compass 2019.", confidence: 0.98, semanticSource: "image", capturedAtTurn: 0,
};

const fb = (c: CentralTurnCapture): boolean => c.responseSource === "technical_fallback";
const authored = (c: CentralTurnCapture): boolean => c.responseSource === "brain_final" || c.responseSource === "brain_retry";

function reportScenario(name: string, caps: CentralTurnCapture[]): { fallbacks: number; totalCalls: number } {
  const totalCalls = caps.reduce((s, c) => s + c.llmCallsInTurn, 0);
  const fallbacks = caps.filter(fb).length;
  console.log(`\n████ CENÁRIO ${name} — chamadas reais=${totalCalls} | fallbacks(technical)=${fallbacks} | LLM-autorados=${caps.filter(authored).length}/${caps.length}`);
  for (const c of caps) {
    console.log(`  T${c.turnIndex} «${c.leadBlock}»`);
    console.log(`     source=${c.responseSource ?? c.status} | degradationKind=${c.degradationKind ?? "-"}${c.providerFallbackReason ? ` (${c.providerFallbackReason})` : ""} | terminalSafe=${c.terminalSafe} | calls=${c.llmCallsInTurn} | brainSteps=${c.brainSteps} | intent=${c.primaryIntent ?? "-"}`);
    console.log(`     tools=[${c.toolsRequested.join(",")}] | effects=[${c.effects.map((e) => e.kind + (e.vehicleKey ? `(${e.vehicleKey})` : "")).join(",")}]`);
    if (c.policyFeedback && c.policyFeedback.length) console.log(`     denies=${JSON.stringify(c.policyFeedback).slice(0, 220)}`);
    console.log(`     RESP: ${JSON.stringify(c.response).slice(0, 420)}`);
  }
  return { fallbacks, totalCalls };
}

async function main(): Promise<void> {
  loadServiceEnv();
  process.env.PEDRO_V3_REAL_EVAL = "1";
  // Provider selecionável: PEDRO_V3_AI_PROVIDER=openai (produção, gpt-4.1-mini) OU deepseek (diagnóstico via proxy).
  // Default = openai (é o modelo de produção; DeepSeek só serviu p/ diagnosticar o protocolo — não comprova produção).
  const provider = (process.env.PEDRO_V3_AI_PROVIDER ?? "openai").trim();
  process.env.PEDRO_V3_AI_PROVIDER = provider;
  if (provider === "deepseek") {
    // A service role autentica o proxy DeepSeek (chave real na Edge Function). buildRealAssembly usa EVAL_DEEPSEEK_API_KEY.
    const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
    if (!serviceRole) throw new Error("SUPABASE_SERVICE_ROLE_KEY ausente (proxy DeepSeek)");
    process.env.EVAL_DEEPSEEK_API_KEY = serviceRole;
  } else {
    // Produção: gpt-4.1-mini via chave de PLATAFORMA (Vault). Modelo default do harness openai é gpt-4.1; forçamos o mini.
    if (process.env.PEDRO_V3_OPENAI_MODEL == null) process.env.PEDRO_V3_OPENAI_MODEL = "gpt-4.1-mini";
    if (process.env.EVAL_OPENAI_API_KEY == null && process.env.EVAL_USE_PLATFORM_KEY == null) process.env.EVAL_USE_PLATFORM_KEY = "1";
  }
  if (process.env.CENTRAL_EVAL_TURN_DELAY_MS == null) process.env.CENTRAL_EVAL_TURN_DELAY_MS = "500";

  const base = { ms: Date.parse("2026-07-17T13:00:00.000Z") };
  const clock = { now: () => new Date(base.ms).toISOString() };
  console.log(`== SMOKE simplificação estrutural (${provider} real) ==`);
  const assembly = await buildRealAssembly(clock);
  console.log(`tenant=${assembly.ref.tenantId} provider=${assembly.aiProvider.provider} model=${assembly.aiProvider.model} promptSha=${assembly.promptSha.slice(0, 12)}`);
  // ⭐auditoria Codex #4: GUARDA de modelo — o default openai resolve gpt-4.1, mas a PRODUÇÃO usa gpt-4.1-mini. Aborta
  // se rodar no modelo errado (não gastar créditos no gpt-4.1). Override consciente via PEDRO_V3_ALLOW_ANY_MODEL=1.
  if (provider === "openai" && assembly.aiProvider.model !== "gpt-4.1-mini" && process.env.PEDRO_V3_ALLOW_ANY_MODEL !== "1") {
    throw new Error(`MODELO ERRADO: ${assembly.aiProvider.model} (esperado gpt-4.1-mini). Rode com PEDRO_V3_OPENAI_MODEL=gpt-4.1-mini ou PEDRO_V3_ALLOW_ANY_MODEL=1.`);
  }
  // Filtro de cenário: SMOKE_ONLY=A|B|C roda só um (isola o Compass sem gastar nos demais).
  const only = process.env.SMOKE_ONLY?.trim().toUpperCase();
  const run = (name: string) => !only || only === name;
  // openai usa o stack padrão (FetchTransport direto); deepseek usa o proxy.
  const makeStack = (): CentralStack => provider === "deepseek" ? buildDeepSeekStack(assembly) : buildCentralStack(assembly);

  const summaries: { name: string; fallbacks: number; totalCalls: number }[] = [];

  // ── A: SUV automático -> seleção -> agendamento (continuidade de visita, não ordinal) ──
  if (run("A")) {
    const caps = await runCentralConversation(assembly, makeStack(), "smoke-A", [
      ["Oi, boa tarde! Tô procurando um SUV automático até uns 100 mil"],
      ["Gostei do primeiro"],
      ["Show, quero agendar uma visita pra segunda"],
    ], { llmFirst: true, singleAuthor: true, maxLlmCalls: MAX_CALLS_PER_SCENARIO });
    summaries.push({ name: "A", ...reportScenario("A (SUV->seleção->agenda)", caps) });
  }

  // ── B: entrada por anúncio específico (Compass) -> info -> foto do veículo certo (sem lista ampla) ──
  if (run("B")) {
    const caps = await runCentralConversation(assembly, makeStack(), "smoke-B", [
      ["Oi! Posso ter mais informações sobre isso?"],
      ["Esse ainda tá disponível?"],
      ["Manda umas fotos dele por favor"],
    ], { llmFirst: true, singleAuthor: true, maxLlmCalls: MAX_CALLS_PER_SCENARIO, firstTurnAdContext: adCompass });
    summaries.push({ name: "B", ...reportScenario("B (anúncio Compass->info->foto)", caps) });
  }

  // ── C: institucional (endereço -> horário), sem "instabilidade", sem repetir, sem pedir nome ──
  if (run("C")) {
    const caps = await runCentralConversation(assembly, makeStack(), "smoke-C", [
      ["Oi, onde fica a loja de vocês?"],
      ["E qual o horário de atendimento?"],
    ], { llmFirst: true, singleAuthor: true, maxLlmCalls: MAX_CALLS_PER_SCENARIO });
    summaries.push({ name: "C", ...reportScenario("C (endereço->horário)", caps) });
  }

  console.log("\n════════ RESUMO ════════");
  let totalFallbacks = 0;
  for (const s of summaries) { console.log(`  Cenário ${s.name}: ${s.totalCalls} chamadas reais, ${s.fallbacks} technical_fallback`); totalFallbacks += s.fallbacks; }
  console.log(`  TOTAL technical_fallback nos 3 cenários: ${totalFallbacks}`);
  console.log(totalFallbacks === 0 ? "  ✅ zero technical_fallback com provedor disponível" : "  ⚠️ houve technical_fallback — inspecionar turnos acima");
}
main().catch((e) => { console.error("ERRO FATAL:", (e as Error)?.stack ?? e); process.exit(1); });
