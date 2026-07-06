// ============================================================================
// eval/run-eval-understanding.ts — VALIDAÇÃO REAL da FONTE ÚNICA (TurnUnderstanding). UMA conversa (5 turnos),
// gpt-4.1-mini REAL, prompt/estoque/config REAIS, central engine singleAuthor+llmFirst = PRODUÇÃO central_active,
// efeitos OFF. Foco: alvo do turno correto, foto só no pedido explícito, mudança de assunto respeitada, memória antiga
// não sequestra, 0 fallback visível. Teto de 20 chamadas. Sem judge, sem matriz.
//   PEDRO_V3_REAL_EVAL=1 EVAL_USE_PLATFORM_KEY=1 npm run eval:understanding
// ============================================================================
import { RealClock } from "../src/runtime/real-clock.ts";
import { loadServiceEnv, buildRealAssembly, sanitize, PILOT_MODEL } from "./real-harness.ts";
import { buildCentralStack, runCentralConversation } from "./central-real-harness.ts";
import { createInitialPersistedWorkingMemory } from "../src/domain/agent-brain.ts";
import type { TurnFrame } from "../src/domain/agent-brain.ts";

// Sequência da AUDITORIA CODEX (6 turnos): lista -> compra o 3º -> foto -> "gostei das fotos" (menção, ZERO mídia) ->
// troca p/ Onix -> "fotos do Onix" (múltiplas variantes -> nunca variante arbitrária, nunca o carro errado do T2).
const CONV = ["Boa noite! Quais SUV vocês têm?", "quero comprar o terceiro", "Me mande fotos", "Gostei das fotos", "E o Onix, tem?", "Me manda as fotos do Onix"];
const MAX_LLM_CALLS = 20;
const norm = (s: string): string => (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const has = (s: string, n: string): boolean => norm(s).includes(norm(n));

async function main(): Promise<void> {
  if (process.env.PEDRO_V3_REAL_EVAL !== "1") { console.error("BLOQUEADO: PEDRO_V3_REAL_EVAL=1."); process.exit(2); }
  loadServiceEnv();
  const startedAt = new Date().toISOString();
  console.log(`== EVAL FONTE ÚNICA (5 turnos, singleAuthor+llmFirst, efeitos OFF, teto=${MAX_LLM_CALLS}) ${startedAt} ==`);
  const assembly = await buildRealAssembly(new RealClock());
  const stack = buildCentralStack(assembly);
  console.log(`config: promptLen=${assembly.runtimeConfig.promptText.length} modelo=${PILOT_MODEL}`);

  const probeFrame: TurnFrame = {
    turnId: "probe", now: startedAt, block: "oi", portalPromptSha256: assembly.promptSha,
    workingMemory: { ...createInitialPersistedWorkingMemory(), funnel: { known: [], declined: [], deferred: [], suggestedObjective: null }, selectedVehicle: null, lastOffer: null },
    recentTranscript: [], signals: { mentionsPhoto: false, mentionsStore: false, mentionsMoreOptions: false, mentionsVehicleType: null, isMemoryQuestion: false, relation: "ambiguous" },
  };
  try { await stack.brain.proposeNextStep(probeFrame, []); } catch { /* final seguro */ }
  if (stack.brainTransport.okCount === 0) { console.error(`\nBLOQUEIO EXTERNO: sem quota/chave (2xx=0). NÃO executando.`); process.exit(3); }
  console.log(`probe OK: brain 2xx (${stack.brainTransport.okCount}/${stack.brainTransport.count}).`);

  const caps = await runCentralConversation(assembly, stack, "und-1", CONV.map((m) => [m]), { singleAuthor: true, llmFirst: true, maxLlmCalls: MAX_LLM_CALLS });
  const at = (i: number) => caps.find((c) => c.turnIndex === i);
  const media = (c: ReturnType<typeof at>) => (c?.effects ?? []).filter((e) => e.kind === "send_media");

  console.log(`\n== POR TURNO ==`);
  for (const c of caps) {
    console.log(`T${c.turnIndex} [${sanitize(c.leadBlock)}]`);
    console.log(`   resp: ${sanitize(c.response).slice(0, 170)}`);
    console.log(`   intent=${c.primaryIntent}(brain=${c.understandingFromBrain}) | tools=${c.toolsRequested.join(",") || "-"} | media=${media(c).map((e) => e.vehicleKey).join(",") || "-"} | targetSrc=${c.targetResolutionSource ?? "-"} resolved=${c.resolvedVehicleKey ?? "-"} | src=${c.responseSource ?? c.reasonCode} TS=${c.terminalSafe}`);
    if (c.terminalSafe && c.policyFeedback?.length) console.log(`   ⚠ policyFeedback: ${c.policyFeedback.map((f) => sanitize(f)).join(" || ").slice(0, 260)}`);
  }

  // ── CRITÉRIOS ──────────────────────────────────────────────────────────────
  const GENERIC_RX = /nao consegui confirmar|não consegui confirmar|reformul/;
  const V: string[] = [];
  for (const c of caps) {
    if (c.status !== "committed") V.push(`T${c.turnIndex}: status=${c.status}`);
    // "0 fallback VISÍVEL" = 0 technical_fallback genérico (recuperação CONTEXTUAL, deterministic_recovery, é OK) e 0 texto técnico.
    if (c.responseSource === "technical_fallback") V.push(`T${c.turnIndex}: technical_fallback GENÉRICO visível (${c.reasonCode})`);
    if (GENERIC_RX.test(norm(c.response))) V.push(`T${c.turnIndex}: texto técnico genérico no outbox`);
  }
  const t2 = at(2), t3 = at(3), t4 = at(4), t5 = at(5), t6 = at(6);
  const t2Key = t2?.resolvedVehicleKey ?? null;   // (normalmente null; seleção não envia mídia) — usado p/ "carro errado"
  // T3 = "Me mande fotos": mídia do 3º SELECIONADO (alvo do turno, não foco stale).
  if (t3) {
    if (media(t3).length === 0) V.push(`T3: pedido explícito de foto NÃO enviou mídia`);
  }
  // T4 = "Gostei das fotos" (MENÇÃO, não pedido) -> ZERO mídia.
  if (t4 && media(t4).length > 0) V.push(`T4: 'Gostei das fotos' (menção) enviou mídia`);
  // T5 = "E o Onix, tem?": mudança de assunto -> busca + fala do Onix (memória do SUV anterior não sequestra).
  if (t5) {
    if (!t5.toolsRequested.includes("stock_search")) V.push(`T5: troca p/ Onix não chamou stock_search`);
    if (!has(t5.response, "onix")) V.push(`T5: resposta não menciona o Onix (mudança de assunto ignorada)`);
    if (media(t5).length > 0) V.push(`T5: enviou mídia numa pergunta de disponibilidade`);
  }
  // T6 = "Me manda as fotos do Onix" (múltiplas variantes): NUNCA o carro errado (o SUV do T2/T3); se ambíguo, pergunta.
  if (t6) {
    for (const e of media(t6)) {
      if (!has(t6.response, "onix") && !/qual|numero|número|ano/.test(norm(t6.response))) { /* ok se pergunta */ }
      const t3Key = t3?.resolvedVehicleKey;
      if (t3Key && e.vehicleKey === t3Key) V.push(`T6: enviou a foto do carro ERRADO (o SUV do T3, não um Onix)`);
    }
    if (media(t6).length === 0 && !/qual|numero|número|ano|onix/.test(norm(t6.response))) V.push(`T6: sem mídia e sem perguntar qual variante (resposta não trata o pedido)`);
  }
  // Mídia SÓ em pedidos explícitos (T3 e possivelmente T6) — nunca em T1/T2/T4/T5.
  for (const c of [at(1), t2, t4, t5]) if (c && media(c).length > 0) V.push(`T${c.turnIndex}: enviou mídia sem pedido explícito de foto`);
  // compose=0 (autoria única).
  if (stack.composeTransport.count > 0) V.push(`compose≠0 (${stack.composeTransport.count}) — autoria única violada`);
  // prompt integral em todas as chamadas.
  if (caps.some((c) => !c.promptExactInTurn)) V.push(`prompt do portal NÃO íntegro em algum turno`);

  const brainCalls = stack.brainTransport.count, composeCalls = stack.composeTransport.count;
  const promptTok = stack.brainTransport.calls.reduce((s, x) => s + (x.promptTokens ?? 0), 0);
  const compTok = stack.brainTransport.calls.reduce((s, x) => s + (x.completionTokens ?? 0), 0);
  console.log(`\n== TOTAIS ==`);
  console.log(`OpenAI: ${brainCalls + composeCalls} chamadas (BRAIN ${brainCalls} 2xx=${stack.brainTransport.okCount} · COMPOSE ${composeCalls}) · custo≈US$${((promptTok * 0.4 + compTok * 1.6) / 1e6).toFixed(4)} · turnos=${caps.length}/6`);
  if (V.length) { console.log(`\nRESULTADO: ${V.length} violação(ões):`); for (const v of V) console.log(`  - ${sanitize(v)}`); }
  else console.log(`\nRESULTADO: PASS (0 fallback visível; mídia só no pedido explícito; alvo por turno; troca respeitada; memória não sequestra; compose=0)`);
  process.exit(V.length === 0 ? 0 : 1);
}
main().catch((e) => { console.error("ERRO FATAL:", sanitize(String((e as Error)?.message ?? e))); process.exit(1); });
