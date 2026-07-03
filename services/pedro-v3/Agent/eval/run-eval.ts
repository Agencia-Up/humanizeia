// ============================================================================
// eval/run-eval.ts — CLI da suíte de avaliação conversacional REAL do Pedro v3.
// Roda a MATRIZ: 3 cenários sintéticos + 3 incidentes sintéticos do v2, cada um
// >=2x (variância), com OpenAI REAL (gpt-4.1-mini), asserções determinísticas + judge,
// e gera relatórios JSON+MD sanitizados. Efeitos OFF. Proibido FakeLlm (prova HTTP real).
//
// Ciclo de receipt "accepted" simulado (correção da auditoria Codex) via commitEffectOutcome
// real — sem amnésia artificial. Prova do prompt por SHA-256/match integral. Modo baseline
// = pilot-realistic (accepted; mídia NÃO entregue).
//
//   PEDRO_V3_REAL_EVAL=1 npm run eval:conversation:real
// ============================================================================
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { RealClock } from "../src/runtime/real-clock.ts";
import { loadServiceEnv, buildRealAssembly, runConversation, sanitize, PILOT_MODEL, type EvalMode, type RealAssembly, type TurnCapture, type LlmCallRecord } from "./real-harness.ts";
import { SCENARIOS, type Scenario } from "./scenarios.ts";
import { runAssertions, type AssertionReport } from "./assertions.ts";
import { judgeConversation, type JudgeScore } from "./judge.ts";

const RUNS_PER_SCENARIO = 2;
const MIN_JUDGE = 85;
const MODE: EvalMode = "pilot-realistic"; // baseline oficial (accepted; sem delivered de mídia)

// Baseline PRÉ-FASE-1 (harness JÁ CORRIGIDO, antes do rebalanceamento). Números de eval/reports/run-final.log
// (2026-07-01). Usado só p/ a comparação antes/depois do rebalanceamento (não é re-executado). Isola o efeito
// da Fase 1 (binder/dinheiro/tipo/foco + anti-fixação) sobre o baseline fiel.
const BEFORE: Record<string, { judge: number[]; crit: number[] }> = {
  "s1-descoberta-estoque-memoria-fotos": { judge: [59, 70], crit: [3, 3] },
  "s2-direcao-referencias": { judge: [50, 60], crit: [1, 1] },
  "s3-sdr-anti-handoff-precoce": { judge: [52, 55], crit: [3, 3] },
  "r1-mais-opcoes-perdeu-categoria": { judge: [38, 43], crit: [1, 0] },
  "r2-foto-ordinal-veiculo-errado": { judge: [60, 59], crit: [1, 0] },
  "r3-repergunta-funil-handoff": { judge: [60, 60], crit: [0, 0] },
};

type Memory = { maxRecentTurns: number; objectiveActiveTurns: number; slotsKnown: string[]; nomeKnown: boolean; commitErrors: string[] };
type RunResult = { runIndex: number; turns: TurnCapture[]; assertions: AssertionReport; judge: JudgeScore; memory: Memory; llmCalls: number; okCalls: number; promptTokens: number; completionTokens: number; avgLatencyMs: number; modelsSeen: string[] };
type ScenarioResult = { scenario: Scenario; runs: RunResult[] };

function tokenSince(calls: readonly LlmCallRecord[], from: number) {
  const slice = calls.slice(from);
  return {
    llmCalls: slice.length,
    okCalls: slice.filter((c) => c.status >= 200 && c.status < 300).length,
    promptTokens: slice.reduce((s, c) => s + (c.promptTokens ?? 0), 0),
    completionTokens: slice.reduce((s, c) => s + (c.completionTokens ?? 0), 0),
    avgLatencyMs: slice.length ? Math.round(slice.reduce((s, c) => s + c.ms, 0) / slice.length) : 0,
    modelsSeen: [...new Set(slice.map((c) => c.model).filter(Boolean) as string[])],
  };
}

function memoryOf(turns: readonly TurnCapture[]): Memory {
  return {
    maxRecentTurns: turns.reduce((m, t) => Math.max(m, t.recentTurnsCount), 0),
    objectiveActiveTurns: turns.filter((t) => t.activeObjective).length,
    slotsKnown: [...new Set(turns.flatMap((t) => t.slotsDelta.filter((d) => /known/.test(d.to)).map((d) => d.slot)))],
    nomeKnown: turns.some((t) => t.slotsDelta.some((d) => d.slot === "nome" && /known/.test(d.to))),
    commitErrors: [...new Set(turns.flatMap((t) => t.commitErrors))],
  };
}
const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0);
// Percentil determinístico (nearest-rank; sem Math.random) para latência de turno no relatório.
function percentile(xs: readonly number[], p: number): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

async function main(): Promise<void> {
  if (process.env.PEDRO_V3_REAL_EVAL !== "1") { console.error("BLOQUEADO: defina PEDRO_V3_REAL_EVAL=1 (custo + rede OpenAI)."); process.exit(2); }
  loadServiceEnv();
  const startedAt = new Date().toISOString();
  console.log(`== Pedro v3 — Avaliacao REAL (matriz, modo=${MODE}) ${startedAt} ==`);
  const assembly = await buildRealAssembly(new RealClock());
  console.log(`config real: promptSource=${assembly.runtimeConfig.promptSource} promptLen=${assembly.runtimeConfig.promptText.length} promptSha=${assembly.promptSha.slice(0, 16)}… temp=${assembly.runtimeConfig.temperature ?? "default"} stock=${assembly.runtimeConfig.stockProvider} modelo=${PILOT_MODEL}`);

  const results: ScenarioResult[] = [];
  // Codex: cenários DIRECIONADOS (não a matriz inteira a cada mudança). EVAL_SCENARIO=s2,r1 roda só esses.
  const only = process.env.EVAL_SCENARIO?.split(",").map((s) => s.trim()).filter(Boolean);
  const scenarios = only && only.length > 0 ? SCENARIOS.filter((s) => only.some((o) => s.id.includes(o))) : SCENARIOS;
  if (only && only.length > 0) console.log(`cenarios DIRECIONADOS: ${scenarios.map((s) => s.id).join(", ") || "(nenhum casou)"}`);
  for (const scenario of scenarios) {
    const runs: RunResult[] = [];
    for (let r = 1; r <= RUNS_PER_SCENARIO; r++) {
      const from = assembly.transport.calls.length;
      const turns = await runConversation(assembly, `${scenario.id}-r${r}`, scenario.steps.map((s) => [...s]), MODE);
      const assertions = runAssertions(turns, MODE);
      const judge = await judgeConversation(assembly, scenario.title, turns);
      const tok = tokenSince(assembly.transport.calls, from);
      const memory = memoryOf(turns);
      runs.push({ runIndex: r, turns, assertions, judge, memory, ...tok });
      console.log(`  [${scenario.id}] run ${r}: turns=${turns.length} llm=${tok.llmCalls}(ok=${tok.okCalls}) crit=${assertions.criticalCount} judge=${judge.overall} recentTurnsMax=${memory.maxRecentTurns} objAtivos=${memory.objectiveActiveTurns} nomeKnown=${memory.nomeKnown} bypass=[${assertions.handlerBypassTurns.join(",")}]${memory.commitErrors.length ? ` COMMIT_ERR=${memory.commitErrors.length}` : ""}`);
    }
    results.push({ scenario, runs });
  }

  const outDir = resolve(dirname(fileURLToPath(import.meta.url)), "reports");
  mkdirSync(outDir, { recursive: true });
  const jsonReport = JSON.stringify(buildJson(results, assembly, startedAt), null, 2);
  const mdReport = buildMarkdown(results, assembly, startedAt);
  const stamp = startedAt.replace(/[:.]/g, "-"); // Seção 9: cada execução com nome próprio; NÃO sobrescreve evidência.
  writeFileSync(resolve(outDir, "eval-report.json"), jsonReport, "utf8");
  writeFileSync(resolve(outDir, "eval-report.md"), mdReport, "utf8");
  writeFileSync(resolve(outDir, `eval-report-${stamp}.json`), jsonReport, "utf8");
  writeFileSync(resolve(outDir, `eval-report-${stamp}.md`), mdReport, "utf8");
  console.log(`\nrelatorios: eval/reports/eval-report.json + .md (+ copia timestampada eval-report-${stamp}.*)`);

  // ── Sumario + comparação ANTES/DEPOIS + PROVA LLM real ──
  const totalCritical = results.reduce((s, sc) => s + sc.runs.reduce((a, r) => a + r.assertions.criticalCount, 0), 0);
  const belowThreshold = results.filter((sc) => sc.runs.some((r) => r.judge.overall < MIN_JUDGE));
  console.log(`\n== SUMARIO (depois — harness corrigido) ==`);
  for (const sc of results) {
    const j = sc.runs.map((r) => r.judge.overall).join("/");
    const c = sc.runs.map((r) => r.assertions.criticalCount).join("/");
    console.log(`  ${sc.scenario.id}: judge=${j} criticas=${c}`);
  }
  console.log(`\n== ANTES (pré-Fase-1, harness corrigido) -> DEPOIS (Fase 1 aplicada): judge medio / criticas ==`);
  for (const sc of results) {
    const b = BEFORE[sc.scenario.id];
    const aJ = avg(sc.runs.map((r) => r.judge.overall)), aC = sc.runs.reduce((s, r) => s + r.assertions.criticalCount, 0);
    const nome = sc.runs.every((r) => r.memory.nomeKnown) ? "nomeKnown✓" : sc.runs.some((r) => r.memory.nomeKnown) ? "nomeKnown~" : "nomeKnown✗";
    console.log(`  ${sc.scenario.id}: judge ${b ? avg(b.judge) : "?"}->${aJ} | criticas ${b ? b.crit.reduce((a, x) => a + x, 0) : "?"}->${aC} | ${nome}`);
  }

  const commitErrTotal = results.reduce((s, sc) => s + sc.runs.reduce((a, r) => a + r.memory.commitErrors.length, 0), 0);
  const dispatched = results.some((sc) => sc.runs.some((r) => r.assertions.outboxAudit.dispatchedExternally));
  console.log(`\nPROVA LLM REAL (agente): ${assembly.transport.count} chamadas (2xx=${assembly.transport.okCount}) | modelos=${[...new Set(assembly.transport.calls.map((c) => c.model).filter(Boolean))].join(",")} | prompt-INTEGRAL-em-todas=${assembly.transport.allPromptExact} | promptSha256=${assembly.promptSha.slice(0, 24)}…`);
  console.log(`PROVA EFEITOS OFF: dispatchExterno=${dispatched} | erros de commit de aceite=${commitErrTotal}`);
  console.log(`PROVA RETRY (harness, so transporte HTTP; nao reexecuta turno/efeito): agente retries=${assembly.retryTransport.retries} esgotados=${assembly.retryTransport.exhaustedFailures} | judge retries=${assembly.judgeRetryTransport.retries} esgotados=${assembly.judgeRetryTransport.exhaustedFailures}`);
  console.log(`total criticas=${totalCritical} | cenarios<${MIN_JUDGE}=${belowThreshold.map((s) => s.scenario.id).join(",") || "nenhum"}`);

  // Métricas agregadas (Rodada 9, Codex): latência p50/p95, LLM/turno e TAXA de terminal-safe. A taxa de
  // terminal-safe em cenário NORMAL precisa ser ~0 (o gate humano observa isto além do judge).
  const m = aggregateMetrics(results);
  console.log(`METRICAS: turnos=${m.turns} | latencia p50=${m.p50}ms p95=${m.p95}ms | LLM/turno=${m.llmPerTurn.toFixed(2)} | terminal-safe=${m.tsCount}/${m.turns} (${m.tsRate.toFixed(1)}%)`);
  for (const [reason, n] of m.tsByReason) console.log(`  terminal-safe x${n}: ${reason}`);

  if (assembly.transport.count === 0 || assembly.transport.okCount === 0) { console.error("\nFALHA: LLM real nao comprovada."); process.exit(1); }
  if (!assembly.transport.allPromptExact) { console.error("\nFALHA: prompt do portal NAO presente integralmente em toda chamada."); process.exit(1); }
  if (dispatched) { console.error("\nFALHA: efeito despachado externamente (deveria ser OFF)."); process.exit(1); }
  if (assembly.judgeRetryTransport.exhaustedFailures > 0 || assembly.judgeRetryTransport.finalFailures > 0) { console.error(`\nFALHA: chamadas do judge NAO concluidas em 2xx (esgotados=${assembly.judgeRetryTransport.exhaustedFailures} nao2xx=${assembly.judgeRetryTransport.finalFailures}) — gate nao confiavel.`); process.exit(1); }
  const passed = totalCritical === 0 && belowThreshold.length === 0;
  console.log(passed ? "\nGATE: PASS (0 criticas, judge >= 85)" : "\nGATE: FAIL — ver relatorio (a suite existe p/ ACHAR os erros).");
  process.exit(passed ? 0 : 1);
}

// Métricas agregadas de latência/terminal-safe sobre TODOS os turnos da execução (console + relatório MD).
function aggregateMetrics(results: ScenarioResult[]) {
  const allTurns = results.flatMap((sc) => sc.runs.flatMap((r) => r.turns));
  const latencies = allTurns.map((t) => t.latencyMs).filter((n): n is number => typeof n === "number");
  const tsTurns = allTurns.filter((t) => t.terminalSafe);
  const byReason = new Map<string, number>();
  for (const t of tsTurns) { const k = (t.reasonSummary || "sem-motivo").slice(0, 70); byReason.set(k, (byReason.get(k) ?? 0) + 1); }
  return {
    turns: allTurns.length,
    p50: percentile(latencies, 50), p95: percentile(latencies, 95),
    llmPerTurn: allTurns.length ? allTurns.reduce((s, t) => s + t.llmCallsInTurn, 0) / allTurns.length : 0,
    tsCount: tsTurns.length, tsRate: allTurns.length ? (100 * tsTurns.length) / allTurns.length : 0,
    tsByReason: [...byReason.entries()].sort((a, b) => b[1] - a[1]),
  };
}

function buildJson(results: ScenarioResult[], a: RealAssembly, startedAt: string) {
  return {
    meta: {
      startedAt, mode: MODE, model: PILOT_MODEL, modelsSeen: [...new Set(a.transport.calls.map((c) => c.model).filter(Boolean))],
      promptLen: a.runtimeConfig.promptText.length, promptSha256: a.promptSha, promptSource: a.runtimeConfig.promptSource,
      temperature: a.runtimeConfig.temperature, stock: a.runtimeConfig.stockProvider,
      totalAgentLlmCalls: a.transport.count, allPromptExact: a.transport.allPromptExact,
      note: "prompt do portal NAO e escrito no relatorio (so o SHA-256). Efeitos OFF: receipts accepted sao simulados via commitEffectOutcome real, nunca despachados.",
    },
    before: BEFORE,
    scenarios: results.map((sc) => ({
      id: sc.scenario.id, title: sc.scenario.title, kind: sc.scenario.kind, note: sc.scenario.note,
      runs: sc.runs.map((r) => ({
        runIndex: r.runIndex, judge: r.judge, criticalCount: r.assertions.criticalCount, violations: r.assertions.violations,
        outboxAudit: r.assertions.outboxAudit, memory: r.memory, handlerBypassTurns: r.assertions.handlerBypassTurns,
        llmCalls: r.llmCalls, promptTokens: r.promptTokens, completionTokens: r.completionTokens, avgLatencyMs: r.avgLatencyMs,
        turns: r.turns.map((t) => ({
          turnIndex: t.turnIndex, lead: t.leadText, agente: t.agentText, status: t.status, reasonCode: t.reasonCode, reasonSummary: t.reasonSummary, action: t.action,
          confidence: t.confidence, terminalSafe: t.terminalSafe, llmCallsInTurn: t.llmCallsInTurn, latencyMs: t.latencyMs, promptExact: t.promptExactInTurn,
          recentTurnsCount: t.recentTurnsCount, recentAgentTexts: t.recentAgentTexts, activeObjective: t.activeObjective, commitErrors: t.commitErrors,
          tools: t.tools, slotsDelta: t.slotsDelta, outbox: t.outbox, renderedOffer: t.renderedOffer, error: t.error,
        })),
      })),
    })),
  };
}

function buildMarkdown(results: ScenarioResult[], a: RealAssembly, startedAt: string): string {
  const L: string[] = [];
  L.push(`# Pedro v3 — Relatório de Avaliação Conversacional REAL`);
  L.push(`\n> ${startedAt} · modo **${MODE}** · modelo **${PILOT_MODEL}** (API retornou: ${[...new Set(a.transport.calls.map((c) => c.model).filter(Boolean))].join(", ")}) · prompt real ${a.runtimeConfig.promptText.length} chars (SHA-256 \`${a.promptSha.slice(0, 24)}…\`) · temp ${a.runtimeConfig.temperature} · estoque ${a.runtimeConfig.stockProvider}`);
  L.push(`> **PROVA LLM REAL:** ${a.transport.count} chamadas HTTP à OpenAI (2xx=${a.transport.okCount}); prompt do portal presente INTEGRALMENTE em TODAS = **${a.transport.allPromptExact}** (comparação por conteúdo + SHA-256; o prompt NÃO é escrito aqui).`);
  L.push(`> **EFEITOS OFF:** os receipts \`accepted\` são simulados via \`commitEffectOutcome\` real (append_assistant_turn/activate_objective aplicam) — **nada é despachado** (nenhum dispatcher criado; \`providerCapability=none\`).`);
  const totalCrit = results.reduce((s, sc) => s + sc.runs.reduce((x, r) => x + r.assertions.criticalCount, 0), 0);
  L.push(`> Críticas totais: **${totalCrit}** · cenários abaixo de ${MIN_JUDGE}: ${results.filter((sc) => sc.runs.some((r) => r.judge.overall < MIN_JUDGE)).map((s) => s.scenario.id).join(", ") || "nenhum"}`);
  const m = aggregateMetrics(results);
  L.push(`> **Métricas:** ${m.turns} turnos · latência p50 **${m.p50}ms** / p95 **${m.p95}ms** · **${m.llmPerTurn.toFixed(2)}** LLM/turno · terminal-safe **${m.tsCount}/${m.turns}** (${m.tsRate.toFixed(1)}%)${m.tsByReason.length ? ` — motivos: ${m.tsByReason.map(([r, n]) => `${sanitize(r)}×${n}`).join("; ")}` : ""}`);

  L.push(`\n## Comparação ANTES (pré-Fase-1: harness corrigido, sem rebalanceamento) → DEPOIS (Fase 1: binder/dinheiro/tipo/foco + anti-fixação)`);
  L.push(`\n| cenário | judge antes | judge depois | críticas antes | críticas depois | recentTurns máx | objetivos ativos | nome vinculado |`);
  L.push(`|---|---|---|---|---|---|---|---|`);
  for (const sc of results) {
    const b = BEFORE[sc.scenario.id];
    const nome = sc.runs.every((r) => r.memory.nomeKnown) ? "✓" : sc.runs.some((r) => r.memory.nomeKnown) ? "~" : "✗";
    L.push(`| ${sc.scenario.id} | ${b ? avg(b.judge) : "?"} | ${avg(sc.runs.map((r) => r.judge.overall))} | ${b ? b.crit.reduce((a2, x) => a2 + x, 0) : "?"} | ${sc.runs.reduce((s, r) => s + r.assertions.criticalCount, 0)} | ${Math.max(...sc.runs.map((r) => r.memory.maxRecentTurns))} | ${Math.max(...sc.runs.map((r) => r.memory.objectiveActiveTurns))} | ${nome} |`);
  }
  L.push(`\n> "recentTurns máx" e "objetivos ativos" > 0 comprovam que a memória agora evolui entre turnos (antes ficava zerada por não aplicar o aceite).`);

  L.push(`\n## Sumário por cenário`);
  L.push(`\n| cenário | tipo | judge (run1/run2) | críticas | handler-bypass | outbox maxReceipt |`);
  L.push(`|---|---|---|---|---|---|`);
  for (const sc of results) {
    L.push(`| ${sc.scenario.id} | ${sc.scenario.kind} | ${sc.runs.map((r) => r.judge.overall).join(" / ")} | ${sc.runs.map((r) => r.assertions.criticalCount).join(" / ")} | ${[...new Set(sc.runs.flatMap((r) => r.assertions.handlerBypassTurns))].join(",") || "-"} | ${[...new Set(sc.runs.map((r) => r.assertions.outboxAudit.maxReceipt))].join(",")} |`);
  }

  for (const sc of results) {
    L.push(`\n---\n\n## ${sc.scenario.title} (\`${sc.scenario.id}\`)`);
    if (sc.scenario.note) L.push(`> ${sc.scenario.note}`);
    for (const r of sc.runs) {
      L.push(`\n### Run ${r.runIndex} — judge ${r.judge.overall}/100 · ${r.assertions.criticalCount} críticas · ${r.llmCalls} chamadas LLM · ${r.promptTokens}+${r.completionTokens} tokens`);
      L.push(`judge dims: ${Object.entries(r.judge.dims).map(([k, v]) => `${k}=${v}`).join(" ")}`);
      if (r.judge.notes) L.push(`judge notes: _${sanitize(r.judge.notes)}_`);
      L.push(`memória: recentTurns máx=${r.memory.maxRecentTurns} · turnos c/ objetivo ativo=${r.memory.objectiveActiveTurns} · slots known=[${r.memory.slotsKnown.join(",")}] · nomeKnown=${r.memory.nomeKnown}${r.memory.commitErrors.length ? ` · ⚠️COMMIT_ERR=${r.memory.commitErrors.length}` : ""}`);
      L.push(`outbox audit: maxReceipt=${r.assertions.outboxAudit.maxReceipt} · dispatchExterno=${r.assertions.outboxAudit.dispatchedExternally} · midiaEntregue=${r.assertions.outboxAudit.deliveredMedia}`);
      if (r.assertions.violations.length) {
        L.push(`\n**Violações:**`);
        for (const v of r.assertions.violations) L.push(`- [${v.severity}] T${v.turnIndex} \`${v.code}\` — ${sanitize(v.detail)}`);
      }
      L.push(`\n**Transcrição:**`);
      for (const t of r.turns) {
        L.push(`- **T${t.turnIndex}** LEAD: ${t.leadText}`);
        L.push(`  - AGENTE: ${t.agentText.replace(/\n/g, " ⏎ ")}`);
        const tsMotivo = t.terminalSafe ? `terminalSafe{${(t.reasonSummary ?? "").replace(/^Valida\S+ falhou\S*\.?\s*/i, "").replace(/Efeitos comerciais cancelados\.\s*Razão:\s*/i, "").slice(0, 160)}}` : "";
        const meta = [`reason=${t.reasonCode}`, `llm=${t.llmCallsInTurn}`, `lat=${t.latencyMs}ms`, `recentTurns=${t.recentTurnsCount}`, t.activeObjective?.slot ? `objAtivo=${t.activeObjective.slot}` : "", tsMotivo].filter(Boolean).join(" ");
        L.push(`  - _${meta}_${t.tools.length ? ` · tools: ${t.tools.map((x) => `${x.tool}(${JSON.stringify(x.input)})→${x.itemCount ?? "?"}`).join(" ; ")}` : ""}${t.slotsDelta.length ? ` · slots+: ${t.slotsDelta.map((d) => `${d.slot}=${d.to}`).join(", ")}` : ""}${t.outbox.length ? ` · outbox: ${t.outbox.map((o) => `${o.kind}[${o.receiptLevel ?? o.status}]`).join(",")}` : ""}`);
      }
    }
  }
  L.push(`\n---\n\n_Relatório sanitizado (chave/JWT/CPF/telefone redigidos); prompt do portal jamais escrito (só SHA-256). Fixtures \`synthetic_v2_incident\` = casos DOCUMENTADOS no Brain, não conversas reais (ver limitação em scenarios.ts)._`);
  return L.join("\n");
}

main().catch((e) => { console.error("ERRO FATAL:", sanitize(String((e as Error)?.message ?? e))); process.exit(1); });
