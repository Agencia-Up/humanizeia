// ============================================================================
// eval/run-central-smoke.ts — R13-D/6. UM smoke real do agente central: 1 cenário (15 turnos), 1 execução, SEM
// judge, com TETO de chamadas LLM (aborta ao atingir). Probe de quota ANTES: sem quota -> NÃO executa e declara
// bloqueio externo (exit 3). Efeitos OFF. Assertivas determinísticas (não é matriz).
//   PEDRO_V3_REAL_EVAL=1 [EVAL_MAX_LLM_CALLS=60] [EVAL_SMOKE_SCENARIO=c1-...] npm run smoke:central
// ============================================================================
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { RealClock } from "../src/runtime/real-clock.ts";
import { loadServiceEnv, buildRealAssembly, sanitize, PILOT_MODEL } from "./real-harness.ts";
import { buildCentralStack, runCentralConversation } from "./central-real-harness.ts";
import { CENTRAL_SCENARIOS } from "./central-scenarios.ts";
import { runCentralAssertions } from "./central-assertions.ts";
import { createInitialPersistedWorkingMemory } from "../src/domain/agent-brain.ts";
import type { TurnFrame } from "../src/domain/agent-brain.ts";

async function main(): Promise<void> {
  if (process.env.PEDRO_V3_REAL_EVAL !== "1") { console.error("BLOQUEADO: defina PEDRO_V3_REAL_EVAL=1 (custo + rede OpenAI)."); process.exit(2); }
  loadServiceEnv();
  const maxLlmCalls = Number(process.env.EVAL_MAX_LLM_CALLS ?? "60");
  const startedAt = new Date().toISOString();
  console.log(`== Pedro v3 — SMOKE central REAL (1 cenário, 1 execução, teto=${maxLlmCalls} chamadas) ${startedAt} ==`);
  const assembly = await buildRealAssembly(new RealClock());
  const stack = buildCentralStack(assembly);
  console.log(`config: promptLen=${assembly.runtimeConfig.promptText.length} promptSha=${assembly.promptSha.slice(0, 16)}… modelo=${PILOT_MODEL}`);

  // ── PROBE DE QUOTA: 1 chamada mínima ao brain. Sem 2xx -> quota esgotada -> NÃO executa (bloqueio externo). ──
  const probeFrame: TurnFrame = {
    turnId: "probe", now: startedAt, block: "oi", portalPromptSha256: assembly.promptSha,
    workingMemory: { ...createInitialPersistedWorkingMemory(), funnel: { known: [], declined: [], deferred: [], suggestedObjective: null }, selectedVehicle: null, lastOffer: null },
    recentTranscript: [], signals: { mentionsPhoto: false, mentionsStore: false, mentionsMoreOptions: false, mentionsVehicleType: null, isMemoryQuestion: false, relation: "ambiguous" },
  };
  try { await stack.brain.proposeNextStep(probeFrame, []); } catch { /* o adapter cai em final seguro; a prova é o 2xx no transporte */ }
  if (stack.brainTransport.okCount === 0) {
    console.error(`\nBLOQUEIO EXTERNO: sem quota OpenAI (probe: ${stack.brainTransport.count} chamada(s), 2xx=0). NÃO executando o smoke.`);
    console.error(`Ação do dono: usar uma chave OpenAI com saldo (EVAL_OPENAI_API_KEY) e re-rodar. O engine/assertivas já estão provados offline (test:all, PGlite).`);
    process.exit(3);
  }
  console.log(`probe OK: brain 2xx comprovado (${stack.brainTransport.okCount}/${stack.brainTransport.count}). Executando o smoke…`);

  // ── UM cenário (default c1, 15 turnos) — sem matriz, sem judge. ──
  const wanted = process.env.EVAL_SMOKE_SCENARIO;
  const scenario = (wanted ? CENTRAL_SCENARIOS.find((s) => s.id.includes(wanted)) : null) ?? CENTRAL_SCENARIOS.find((s) => s.kind === "long_flow") ?? CENTRAL_SCENARIOS[0];
  console.log(`cenário: ${scenario.id} (${scenario.steps.length} turnos)`);
  const turns = await runCentralConversation(assembly, stack, `smoke-${scenario.id}`, scenario.steps, { maxLlmCalls });
  const assertions = runCentralAssertions(turns);

  // ── Relatório por turno (sanitizado) ──
  const outDir = resolve(dirname(fileURLToPath(import.meta.url)), "reports");
  mkdirSync(outDir, { recursive: true });
  const stamp = startedAt.replace(/[:.]/g, "-");
  const L: string[] = [`# Pedro v3 — SMOKE central (${scenario.id})`, `\n> ${startedAt} · modelo ${PILOT_MODEL} · teto ${maxLlmCalls} chamadas · sem judge`,
    `> BRAIN ${stack.brainTransport.count} (2xx=${stack.brainTransport.okCount}) · COMPOSE ${stack.composeTransport.count} (2xx=${stack.composeTransport.okCount}) · prompt integral brain=${stack.brainTransport.allPromptExact} compose=${stack.composeTransport.allPromptExact}`,
    `> críticas=${assertions.criticalCount} warns=${assertions.warnCount}\n`, `| T | lead | resposta | reason | tools | possuiTroca | fotoMem |`, `|---|---|---|---|---|---|---|`];
  for (const t of turns) L.push(`| ${t.turnIndex} | ${sanitize(t.leadBlock)} | ${sanitize(t.response).replace(/\|/g, "\\|").slice(0, 110)} | ${t.reasonCode ?? "-"}${t.terminalSafe ? " ⚠️TS" : ""} | ${t.toolsRequested.join(",")} | ${t.possuiTrocaBefore === t.possuiTrocaAfter ? t.possuiTrocaBefore : `${t.possuiTrocaBefore}→${t.possuiTrocaAfter}`} | ${t.wmBeforeLastPhotoLabel ?? "-"}→${t.wmAfterLastPhotoLabel ?? "-"} |`);
  if (assertions.violations.length) { L.push(`\n**Violações:**`); for (const v of assertions.violations) L.push(`- [${v.severity}] T${v.turnIndex} \`${v.code}\` — ${sanitize(v.detail)}`); }
  writeFileSync(resolve(outDir, `central-smoke-${stamp}.md`), L.join("\n"), "utf8");
  console.log(`\nrelatorio: eval/reports/central-smoke-${stamp}.md`);

  // ── Sumário + gate ──
  console.log(`\n== SMOKE ==`);
  console.log(`turnos=${turns.length} | terminal_safe=${turns.filter((t) => t.terminalSafe).length} | críticas=${assertions.criticalCount} | warns=${assertions.warnCount}`);
  console.log(`PROVA LLM REAL: BRAIN ${stack.brainTransport.count} (2xx=${stack.brainTransport.okCount}) · COMPOSE ${stack.composeTransport.count} (2xx=${stack.composeTransport.okCount}) · prompt-integral brain=${stack.brainTransport.allPromptExact} compose=${stack.composeTransport.allPromptExact}`);
  console.log(`PROVA EFEITOS OFF: delivered=${turns.reduce((s, t) => s + t.effects.filter((e) => e.status === "delivered").length, 0)} | nenhum dispatcher criado`);
  if (assertions.criticalCount > 0) { console.log(`\nCRÍTICAS:`); for (const v of assertions.violations.filter((x) => x.severity === "critical")) console.log(`  T${v.turnIndex} ${v.code}: ${sanitize(v.detail)}`); }
  const passed = assertions.criticalCount === 0 && stack.brainTransport.allPromptExact && stack.composeTransport.allPromptExact;
  console.log(passed ? "\nSMOKE: PASS (0 críticas; LLM real; efeitos OFF)" : "\nSMOKE: FAIL — ver relatório.");
  process.exit(passed ? 0 : 1);
}
main().catch((e) => { console.error("ERRO FATAL:", sanitize(String((e as Error)?.message ?? e))); process.exit(1); });
