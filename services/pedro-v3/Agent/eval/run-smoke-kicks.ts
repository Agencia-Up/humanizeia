// ============================================================================
// eval/run-smoke-kicks.ts — SMOKE real da 3ª auditoria (P0-1 alvo por modelo + P0-2 autorização tipada). 4 turnos,
// gpt-4.1-mini REAL, prompt/estoque REAIS, singleAuthor+llmFirst = produção, efeitos OFF, teto 20 chamadas.
//   PEDRO_V3_REAL_EVAL=1 EVAL_USE_PLATFORM_KEY=1 npm run smoke:kicks
// ============================================================================
import { RealClock } from "../src/runtime/real-clock.ts";
import { loadServiceEnv, buildRealAssembly, sanitize, PILOT_MODEL } from "./real-harness.ts";
import { buildCentralStack, runCentralConversation } from "./central-real-harness.ts";
import { createInitialPersistedWorkingMemory } from "../src/domain/agent-brain.ts";
import type { TurnFrame } from "../src/domain/agent-brain.ts";

const CONV = ["Tem Kicks?", "Me manda fotos do Onix", "Me manda fotos do segundo Kicks", "Oi"];
const MAX_LLM_CALLS = 20;
const norm = (s: string): string => (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const has = (s: string, n: string): boolean => norm(s).includes(norm(n));

async function main(): Promise<void> {
  if (process.env.PEDRO_V3_REAL_EVAL !== "1") { console.error("BLOQUEADO: PEDRO_V3_REAL_EVAL=1."); process.exit(2); }
  loadServiceEnv();
  const startedAt = new Date().toISOString();
  console.log(`== SMOKE KICKS (4 turnos, singleAuthor+llmFirst, efeitos OFF, teto=${MAX_LLM_CALLS}) ${startedAt} ==`);
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

  const caps = await runCentralConversation(assembly, stack, "smoke-kicks", CONV.map((m) => [m]), { singleAuthor: true, llmFirst: true, maxLlmCalls: MAX_LLM_CALLS });
  const at = (i: number) => caps.find((c) => c.turnIndex === i);
  const media = (c: ReturnType<typeof at>) => (c?.effects ?? []).filter((e) => e.kind === "send_media");

  console.log(`\n== POR TURNO ==`);
  for (const c of caps) {
    console.log(`T${c.turnIndex} [${sanitize(c.leadBlock)}]`);
    console.log(`   resp: ${sanitize(c.response).slice(0, 170)}`);
    console.log(`   intent=${c.primaryIntent}(brain=${c.understandingFromBrain}) | tools=${c.toolsRequested.join(",") || "-"} | media=${media(c).map((e) => e.vehicleKey).join(",") || "-"} | targetSrc=${c.targetResolutionSource ?? "-"} | src=${c.responseSource ?? c.reasonCode} TS=${c.terminalSafe}`);
  }

  const V: string[] = [];
  for (const c of caps) {
    if (c.status !== "committed") V.push(`T${c.turnIndex}: status=${c.status}`);
    if (c.responseSource === "technical_fallback") V.push(`T${c.turnIndex}: technical_fallback GENÉRICO visível`);
    if (/nao consegui confirmar|não consegui confirmar|reformul/.test(norm(c.response))) V.push(`T${c.turnIndex}: texto técnico genérico`);
  }
  const t1 = at(1), t2 = at(2), t3 = at(3), t4 = at(4);
  // T1 "Tem Kicks?" -> busca.
  if (t1 && !t1.toolsRequested.includes("stock_search")) V.push(`T1: 'Tem Kicks?' não chamou stock_search`);
  // T2 "fotos do Onix" (assunto ONIX) -> NUNCA um Kicks; resposta trata Onix (ou pergunta qual). Nunca a foto de um Kicks.
  if (t2) {
    if (media(t2).length > 0 && !has(t2.response, "onix")) V.push(`T2: enviou mídia mas a resposta não é do Onix (possível carro errado)`);
    if (has(t2.response, "kicks") && !has(t2.response, "onix")) V.push(`T2: assunto era Onix mas respondeu Kicks (memória sequestrou)`);
  }
  // T3 "fotos do segundo Kicks" (ordinal) -> assunto Kicks; nunca Onix.
  if (t3) {
    if (media(t3).length > 0 && has(t3.response, "onix") && !has(t3.response, "kicks")) V.push(`T3: pediu Kicks mas enviou/respondeu Onix`);
  }
  // T4 "Oi" -> NENHUMA tool comercial.
  if (t4) {
    const commercial = t4.toolsRequested.filter((t) => t !== "tenant_business_info");
    if (commercial.length > 0) V.push(`T4: 'Oi' executou tool comercial (${commercial.join(",")})`);
    if (media(t4).length > 0) V.push(`T4: 'Oi' enviou mídia`);
  }
  if (stack.composeTransport.count > 0) V.push(`compose≠0 (${stack.composeTransport.count})`);
  if (caps.some((c) => !c.promptExactInTurn)) V.push(`prompt não íntegro em algum turno`);

  const brainCalls = stack.brainTransport.count, composeCalls = stack.composeTransport.count;
  const promptTok = stack.brainTransport.calls.reduce((s, x) => s + (x.promptTokens ?? 0), 0);
  const compTok = stack.brainTransport.calls.reduce((s, x) => s + (x.completionTokens ?? 0), 0);
  console.log(`\n== TOTAIS ==\nOpenAI: ${brainCalls + composeCalls} chamadas (BRAIN ${brainCalls} 2xx=${stack.brainTransport.okCount} · COMPOSE ${composeCalls}) · custo≈US$${((promptTok * 0.4 + compTok * 1.6) / 1e6).toFixed(4)} · turnos=${caps.length}/4`);
  if (V.length) { console.log(`\nRESULTADO: ${V.length} violação(ões):`); for (const v of V) console.log(`  - ${sanitize(v)}`); }
  else console.log(`\nRESULTADO: PASS (nunca Onix p/ assunto Kicks; nenhuma tool no 'Oi'; foto por ordinal; 0 fallback genérico; compose=0)`);
  process.exit(V.length === 0 ? 0 : 1);
}
main().catch((e) => { console.error("ERRO FATAL:", sanitize(String((e as Error)?.message ?? e))); process.exit(1); });
