// ============================================================================
// F2.40 — SMOKE REAL (gpt-4.1-mini, efeitos OFF): Financial Question Context.
//   Cenário do incidente real: selecionar carro -> "quais as condições?" -> "tenho não" (entrada) -> "até 1200" (parcela).
//   "até 1200" NUNCA pode virar stock_search nem faixaPreco. A LLM conduz; o engine só valida/bloqueia/dá feedback.
//   PEDRO_V3_REAL_EVAL=1 EVAL_USE_PLATFORM_KEY=1 F240_MAX_LLM_CALLS=40 npx tsx eval/run-f240-financial-real-smoke.ts
// ============================================================================
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { buildRealAssembly } from "./real-harness.ts";
import { buildCentralStack, runCentralConversation } from "./central-real-harness.ts";

type Capture = Awaited<ReturnType<typeof runCentralConversation>>[number];

// Cenário da missão P0 (Financial Question Context).
const SCENARIO: readonly (readonly string[])[] = [
  ["Boa tarde"],
  ["quero um Compass"],
  ["gostei do primeiro"],
  ["quais as condicoes?"],
  ["tenho nao"],
  ["ate 1200"],
];

function loadRootEnv(): void {
  const candidates = [resolve(process.cwd(), ".env"), resolve(process.cwd(), "../../.env"), resolve(process.cwd(), "../../../.env")];
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    for (const rawLine of readFileSync(file, "utf8").split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("="); if (eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      if (!process.env[key]) process.env[key] = value;
    }
  }
}

const toolNames = (turn: Capture): string[] => turn.observations.map((o) => o.tool);
const countTool = (turn: Capture, tool: string): number => toolNames(turn).filter((name) => name === tool).length;
const normalized = (value: string): string => value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
const slotText = (turn: Capture): string => JSON.stringify(turn.slotsDelta ?? []);
function failIf(condition: boolean, failures: string[], message: string): void { if (condition) failures.push(message); }

function evaluate(turns: Capture[]): string[] {
  const failures: string[] = [];
  const [t1, t2, t3, t4, t5, t6] = turns;
  // T2: "quero um Compass" -> busca (é intenção comercial explícita).
  if (t2) failIf(!turns.slice(0, 3).some((t) => countTool(t, "stock_search") >= 1), failures, "T2/T3: nenhuma busca de estoque no início (Compass não foi buscado).");
  // T5: "tenho não" (entrada) -> zero stock_search.
  if (t5) {
    failIf(countTool(t5, "stock_search") > 0, failures, `T5: 'tenho não' (entrada) acionou stock_search ${countTool(t5, "stock_search")}x.`);
    failIf(t5.terminalSafe, failures, "T5: 'tenho não' caiu em terminalSafe.");
  } else failures.push("T5 ausente.");
  // T6: "até 1200" (parcela) -> zero stock_search, parcelaDesejada=1200, faixaPreco NÃO 1200.
  if (t6) {
    const sd = slotText(t6);
    failIf(countTool(t6, "stock_search") > 0, failures, `T6: 'até 1200' (parcela) acionou stock_search ${countTool(t6, "stock_search")}x.`);
    failIf(t6.terminalSafe, failures, "T6: 'até 1200' caiu em terminalSafe.");
    failIf(!/parcelaDesejada/i.test(sd) || !/1200/.test(sd), failures, `T6: parcelaDesejada=1200 não registrado (slotsDelta=${sd}).`);
    failIf(/faixaPreco/i.test(sd) && /1200/.test(sd), failures, `T6: faixaPreco recebeu 1200 (proibido) — slotsDelta=${sd}.`);
    failIf(/nao achei|nao encontrei|temos estas|opcoes disponiveis|encontrei estas/.test(normalized(t6.response)), failures, "T6: 'até 1200' foi tratado como busca (listou/ofertou estoque).");
  } else failures.push("T6 ausente.");
  return failures;
}

function mdCell(value: unknown): string { return String(value ?? "-").replace(/\r?\n/g, "<br>").replace(/\|/g, "\\|"); }
function shortJson(value: unknown): string { const text = JSON.stringify(value ?? null); return text.length > 260 ? `${text.slice(0, 257)}...` : text; }

async function main(): Promise<void> {
  loadRootEnv();
  process.env.PEDRO_V3_REAL_EVAL = "1";
  process.env.EVAL_USE_PLATFORM_KEY = process.env.EVAL_USE_PLATFORM_KEY || "1";

  const clock = { now: () => new Date("2026-07-08T12:00:00.000Z").toISOString() };
  const assembly = await buildRealAssembly(clock);
  const stack = buildCentralStack(assembly);
  const started = new Date().toISOString();
  const turns = await runCentralConversation(assembly, stack, `wa:f240-fin-smoke-${Date.now()}`, SCENARIO, {
    maxLlmCalls: Number(process.env.F240_MAX_LLM_CALLS ?? "40"), singleAuthor: true, llmFirst: true,
  });
  if (process.env.F240_PF) for (const t of turns) console.error(`T${t.turnIndex} src=${t.responseSource} reason=${t.reasonCode} tools=${toolNames(t).join(",")} slots=${slotText(t)} pf=`, JSON.stringify(t.policyFeedback ?? []));

  const failures = evaluate(turns);
  // ── Regra P0 LLM-first: a conversa deve ser conduzida pela LLM; 0 technical_fallback e 0 recovery comercial. ──
  const COMMERCIAL_RECOVERY = new Set(["recovery_offer", "recovery_stock_empty", "recovery_stock_empty_conduct", "recovery_relaxed_offer", "recovery_stock_not_run", "recovery_detail_attr", "recovery_detail_no_vehicle", "recovery_photo_which", "more_options_needs_scope", "ad_generic_discovery", "recovery_ask_need"]);
  const srcCount: Record<string, number> = {};
  for (const t of turns) { const s = t.responseSource ?? "?"; srcCount[s] = (srcCount[s] ?? 0) + 1; }
  const llmTurns = turns.filter((t) => t.responseSource === "brain_final" || t.responseSource === "brain_retry").length;
  const techFallbackTurns = turns.filter((t) => t.responseSource === "technical_fallback");
  const commercialRecoveryTurns = turns.filter((t) => t.responseSource === "deterministic_recovery" && COMMERCIAL_RECOVERY.has(t.reasonCode ?? ""));
  const composeCalls = stack.composeTransport.count;
  for (const t of techFallbackTurns) failures.push(`T${t.turnIndex}: technical_fallback — a LLM NÃO conduziu (regra LLM-first).`);
  for (const t of commercialRecoveryTurns) failures.push(`T${t.turnIndex}: recovery comercial (${t.reasonCode}) — o engine escreveu no lugar da LLM.`);
  for (const t of turns) {
    const s = t.responseSource;
    if (s === "brain_final" || s === "brain_retry" || s === "technical_fallback") continue;
    if (s === "deterministic_recovery" && COMMERCIAL_RECOVERY.has(t.reasonCode ?? "")) continue;
    // deterministic_discovery na ABERTURA (T1) é backstop aceitável (fora do escopo desta missão); reprova o resto.
    if (t.turnIndex === 1 && s === "deterministic_discovery") continue;
    failures.push(`T${t.turnIndex}: responseSource=${s} (${t.reasonCode ?? "-"}) não é brain — a LLM não conduziu.`);
  }
  failIf(composeCalls > 0, failures, `compose=${composeCalls} (deveria ser 0 — autoria única).`);
  const passed = failures.length === 0;
  const totalCalls = stack.brainTransport.count + stack.composeTransport.count;

  mkdirSync(join(process.cwd(), "eval", "reports"), { recursive: true });
  const stamp = started.replace(/[:.]/g, "-");
  const reportPath = join(process.cwd(), "eval", "reports", `f240-financial-real-smoke-${stamp}.md`);
  const rows = turns.map((turn) => [
    turn.turnIndex, turn.leadBlock, turn.response, toolNames(turn).join(", ") || "-",
    turn.responseSource ?? "-", turn.reasonCode ?? "-", turn.primaryIntent ?? "-", shortJson(turn.slotsDelta), turn.terminalSafe ? "sim" : "nao",
  ]);
  const md = [
    "# F2.40 Real Smoke — Financial Question Context (parcela/entrada não viram busca)",
    "",
    `- Resultado: **${passed ? "PASS" : "FAIL"}**`,
    `- LLM calls: brain=${stack.brainTransport.count}, compose=${composeCalls}, total=${totalCalls}`,
    "",
    "## Falhas",
    failures.length ? failures.map((f) => `- ${f}`).join("\n") : "- Nenhuma.",
    "",
    "## Métricas LLM-first",
    `- Turnos conduzidos pela LLM (brain_final/brain_retry): ${llmTurns}/${turns.length}`,
    `- technical_fallback: ${techFallbackTurns.length} | commercialRecovery: ${commercialRecoveryTurns.length} | compose: ${composeCalls}`,
    `- Distribuição responseSource: ${Object.entries(srcCount).map(([k, v]) => `${k}=${v}`).join(", ")}`,
    "",
    "## Turnos",
    "| # | Lead | Resposta | Tools | responseSource | reasonCode | primaryIntent | slotsDelta | terminalSafe |",
    "|---|------|----------|-------|----------------|------------|---------------|-----------|--------------|",
    ...rows.map((r) => `| ${r.map(mdCell).join(" | ")} |`),
    "",
    "## policyFeedback por turno",
    ...turns.map((t) => `- T${t.turnIndex}: ${mdCell(JSON.stringify(t.policyFeedback ?? []))}`),
  ].join("\n");
  writeFileSync(reportPath, md, "utf8");

  console.log(JSON.stringify({
    passed, failures, reportPath, totalCalls, brainCalls: stack.brainTransport.count, composeCalls,
    llmFirst: { turns: turns.length, llmAuthored: llmTurns, technicalFallback: techFallbackTurns.length, commercialRecovery: commercialRecoveryTurns.length, sources: srcCount },
  }, null, 2));
  if (!passed) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
