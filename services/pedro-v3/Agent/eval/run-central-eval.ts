// ============================================================================
// eval/run-central-eval.ts — CLI do GATE R13 Inc2/G: replay P0 (85988323679) + 3 conversas 15+ turnos, 2x cada,
// com o AGENTE CENTRAL real (gpt-4.1-mini), efeitos OFF. Assertivas DETERMINÍSTICAS são o gate; judge NÃO roda
// (é só diagnóstico). Relatório por turno (JSON+MD) sanitizado. Prompt do portal jamais escrito (só SHA-256).
//   PEDRO_V3_REAL_EVAL=1 npm run eval:central:real
// ============================================================================
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { RealClock } from "../src/runtime/real-clock.ts";
import { loadServiceEnv, buildRealAssembly, sanitize, PILOT_MODEL } from "./real-harness.ts";
import { buildCentralStack, runCentralConversation, type CentralStack } from "./central-real-harness.ts";
import { CENTRAL_SCENARIOS, type CentralScenario } from "./central-scenarios.ts";
import { runCentralAssertions, type CentralTurnCapture, type CentralAssertionReport } from "./central-assertions.ts";

const RUNS_PER_SCENARIO = 2;

type RunResult = { runIndex: number; turns: CentralTurnCapture[]; assertions: CentralAssertionReport };
type ScenarioResult = { scenario: CentralScenario; runs: RunResult[] };

async function main(): Promise<void> {
  if (process.env.PEDRO_V3_REAL_EVAL !== "1") { console.error("BLOQUEADO: defina PEDRO_V3_REAL_EVAL=1 (custo + rede OpenAI)."); process.exit(2); }
  loadServiceEnv();
  const startedAt = new Date().toISOString();
  console.log(`== Pedro v3 — GATE Agente Central REAL (replay P0 + long flows) ${startedAt} ==`);
  const assembly = await buildRealAssembly(new RealClock());
  const stack: CentralStack = buildCentralStack(assembly);
  console.log(`config real: promptLen=${assembly.runtimeConfig.promptText.length} promptSha=${assembly.promptSha.slice(0, 16)}… temp(brain=0.2 compose=0.3) stock=${assembly.runtimeConfig.stockProvider} modelo=${PILOT_MODEL}`);
  console.log(`brain promptSha=${stack.brain.promptSha256.slice(0, 16)}…  (deve casar com o config)`);

  const only = process.env.EVAL_SCENARIO?.split(",").map((s) => s.trim()).filter(Boolean);
  const scenarios = only && only.length > 0 ? CENTRAL_SCENARIOS.filter((s) => only.some((o) => s.id.includes(o))) : CENTRAL_SCENARIOS;
  const results: ScenarioResult[] = [];

  for (const scenario of scenarios) {
    const runs: RunResult[] = [];
    for (let r = 1; r <= RUNS_PER_SCENARIO; r++) {
      const turns = await runCentralConversation(assembly, stack, `${scenario.id}-r${r}`, scenario.steps);
      const assertions = runCentralAssertions(turns);
      runs.push({ runIndex: r, turns, assertions });
      const memQ = turns.filter((t) => /qual\s+carro/i.test(t.leadBlock)).length;
      console.log(`  [${scenario.id}] run ${r}: turnos=${turns.length} crit=${assertions.criticalCount} warn=${assertions.warnCount} ts=${turns.filter((t) => t.terminalSafe).length} memQ=${memQ} llm=${turns.reduce((s, t) => s + t.llmCallsInTurn, 0)}`);
    }
    results.push({ scenario, runs });
  }

  // ── PROVAS ──
  const brainT = stack.brainTransport, composeT = stack.composeTransport;
  const allTurns = results.flatMap((s) => s.runs.flatMap((r) => r.turns));
  const totalCritical = results.reduce((s, sc) => s + sc.runs.reduce((a, r) => a + r.assertions.criticalCount, 0), 0);
  const totalWarn = results.reduce((s, sc) => s + sc.runs.reduce((a, r) => a + r.assertions.warnCount, 0), 0);
  const deliveredEffects = allTurns.reduce((s, t) => s + t.effects.filter((e) => e.status === "delivered").length, 0);
  const processingLeak = allTurns.some((t) => t.effects.some((e) => e.status === "processing"));
  const brainModels = [...new Set(brainT.calls.map((c) => c.model).filter(Boolean))];
  const composeModels = [...new Set(composeT.calls.map((c) => c.model).filter(Boolean))];

  const outDir = resolve(dirname(fileURLToPath(import.meta.url)), "reports");
  mkdirSync(outDir, { recursive: true });
  const stamp = startedAt.replace(/[:.]/g, "-");
  const json = { meta: { startedAt, model: PILOT_MODEL, brainModels, composeModels, promptSha256: assembly.promptSha, brainPromptSha256: stack.brain.promptSha256, promptLen: assembly.runtimeConfig.promptText.length, brainCalls: brainT.count, brainOk: brainT.okCount, brainPromptExact: brainT.allPromptExact, composeCalls: composeT.count, composeOk: composeT.okCount, composePromptExact: composeT.allPromptExact, totalCritical, totalWarn, deliveredEffects, processingLeak, note: "prompt do portal NÃO é escrito (só SHA-256). Efeitos OFF: receipts accepted simulados via commitEffectOutcome real; nenhum dispatcher criado." }, scenarios: results.map((sc) => ({ id: sc.scenario.id, title: sc.scenario.title, kind: sc.scenario.kind, runs: sc.runs.map((r) => ({ runIndex: r.runIndex, criticalCount: r.assertions.criticalCount, warnCount: r.assertions.warnCount, violations: r.assertions.violations, turns: r.turns })) })) };
  writeFileSync(resolve(outDir, `central-eval-${stamp}.json`), JSON.stringify(json, null, 2), "utf8");
  writeFileSync(resolve(outDir, `central-eval-${stamp}.md`), buildMarkdown(results, stack, startedAt, assembly.promptSha, assembly.runtimeConfig.promptText.length), "utf8");
  writeFileSync(resolve(outDir, "central-eval.md"), buildMarkdown(results, stack, startedAt, assembly.promptSha, assembly.runtimeConfig.promptText.length), "utf8");
  console.log(`\nrelatorio: eval/reports/central-eval-${stamp}.md (+ .json)`);

  // ── SUMÁRIO + GATE ──
  console.log(`\n== SUMARIO ==`);
  for (const sc of results) console.log(`  ${sc.scenario.id}: crit=${sc.runs.map((r) => r.assertions.criticalCount).join("/")} warn=${sc.runs.map((r) => r.assertions.warnCount).join("/")}`);
  console.log(`\nPROVA LLM REAL — BRAIN: ${brainT.count} chamadas (2xx=${brainT.okCount}) modelos=${brainModels.join(",")} prompt-integral=${brainT.allPromptExact} sha=${stack.brain.promptSha256.slice(0, 20)}…`);
  console.log(`PROVA LLM REAL — COMPOSE: ${composeT.count} chamadas (2xx=${composeT.okCount}) modelos=${composeModels.join(",")} prompt-integral=${composeT.allPromptExact}`);
  console.log(`PROVA EFEITOS OFF: delivered=${deliveredEffects} processingLeak=${processingLeak} (nenhum dispatcher criado; providerCapability=none)`);
  console.log(`ASSERCOES: criticas=${totalCritical} warns=${totalWarn}`);
  if (totalCritical > 0) { console.log(`\nVIOLACOES CRITICAS:`); for (const sc of results) for (const r of sc.runs) for (const v of r.assertions.violations.filter((x) => x.severity === "critical")) console.log(`  [${sc.scenario.id} r${r.runIndex} T${v.turnIndex}] ${v.code}: ${sanitize(v.detail)}`); }

  const realProven = brainT.count > 0 && brainT.okCount > 0 && brainT.allPromptExact && composeT.count > 0 && composeT.okCount > 0 && composeT.allPromptExact;
  if (!realProven) { console.error("\nFALHA: LLM real (brain+compose) NAO comprovada (chamadas 2xx + prompt integral)."); process.exit(1); }
  if (deliveredEffects > 0 || processingLeak) { console.error("\nFALHA: sinal de dispatch externo (delivered/processing) — deveria ser OFF."); process.exit(1); }
  const passed = totalCritical === 0;
  console.log(passed ? "\nGATE: PASS (0 criticas; LLM real comprovada; efeitos OFF)" : "\nGATE: FAIL — ver violacoes criticas acima e o relatorio.");
  process.exit(passed ? 0 : 1);
}

function esc(s: string): string { return (s ?? "").replace(/\n/g, " ⏎ ").replace(/\|/g, "\\|"); }
function buildMarkdown(results: ScenarioResult[], stack: CentralStack, startedAt: string, promptSha: string, promptLen: number): string {
  const L: string[] = [];
  L.push(`# Pedro v3 — GATE Agente Central (replay P0 real)`);
  L.push(`\n> ${startedAt} · modelo **${PILOT_MODEL}** · prompt real ${promptLen} chars (SHA-256 \`${promptSha.slice(0, 24)}…\`) · temp brain=0.2 compose=0.3`);
  L.push(`> **PROVA LLM REAL — BRAIN:** ${stack.brainTransport.count} chamadas (2xx=${stack.brainTransport.okCount}); prompt integral em todas = **${stack.brainTransport.allPromptExact}**.`);
  L.push(`> **PROVA LLM REAL — COMPOSE:** ${stack.composeTransport.count} chamadas (2xx=${stack.composeTransport.okCount}); prompt integral em todas = **${stack.composeTransport.allPromptExact}**.`);
  L.push(`> **EFEITOS OFF:** receipts \`accepted\` simulados via \`commitEffectOutcome\` real; nenhum dispatcher criado; \`providerCapability=none\`.`);
  const totalCrit = results.reduce((s, sc) => s + sc.runs.reduce((x, r) => x + r.assertions.criticalCount, 0), 0);
  L.push(`> Críticas totais: **${totalCrit}**`);
  for (const sc of results) {
    L.push(`\n---\n\n## ${sc.scenario.title} (\`${sc.scenario.id}\`)`);
    if (sc.scenario.note) L.push(`> ${sc.scenario.note}`);
    for (const r of sc.runs) {
      L.push(`\n### Run ${r.runIndex} — ${r.assertions.criticalCount} críticas · ${r.assertions.warnCount} warns`);
      if (r.assertions.violations.length) { L.push(`\n**Violações:**`); for (const v of r.assertions.violations) L.push(`- [${v.severity}] T${v.turnIndex} \`${v.code}\` — ${esc(sanitize(v.detail))}`); }
      L.push(`\n| T | lead | resposta | reason | brainSteps | tools pedidas | observações | efeitos | slots+ | possuiTroca | fotoMem (antes→depois) |`);
      L.push(`|---|---|---|---|---|---|---|---|---|---|---|`);
      for (const t of r.turns) {
        const obs = t.observations.map((o) => `${o.tool}${o.ok ? "✓" : "✗"}`).join(" ");
        const eff = t.effects.map((e) => `${e.kind}${e.vehicleKey ? `(${e.vehicleKey})` : ""}[${e.status}]`).join(" ");
        const slots = t.slotsDelta.map((d) => `${d.slot}=${d.to}`).join(", ");
        const troca = t.possuiTrocaBefore === t.possuiTrocaAfter ? t.possuiTrocaBefore : `${t.possuiTrocaBefore}→${t.possuiTrocaAfter}`;
        const foto = `${t.wmBeforeLastPhotoLabel ?? "-"}→${t.wmAfterLastPhotoLabel ?? "-"}`;
        L.push(`| ${t.turnIndex} | ${esc(t.leadBlock)} | ${esc(t.response).slice(0, 120)} | ${t.reasonCode ?? "-"}${t.terminalSafe ? " ⚠️TS" : ""} | ${t.brainSteps} | ${esc(t.toolsRequested.join(","))} | ${esc(obs)} | ${esc(eff)} | ${esc(slots).slice(0, 40)} | ${esc(troca)} | ${esc(foto)} |`);
      }
    }
  }
  L.push(`\n---\n_Relatório sanitizado; prompt do portal jamais escrito (só SHA-256). Judge NÃO roda (as assertivas determinísticas são o gate)._`);
  return L.join("\n");
}

main().catch((e) => { console.error("ERRO FATAL:", sanitize(String((e as Error)?.message ?? e))); process.exit(1); });
