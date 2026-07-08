// ============================================================================
// F2.40 — SMOKE REAL (gpt-4.1-mini, efeitos OFF): "Até 2100" (valor no range de ANO) não vira busca.
//   Reproduz o print: quero Compass -> gostei do primeiro -> quais as condições? -> "Tenho 8k" (entrada) ->
//   "Até 2100 ta bom" (PARCELA). "Até 2100" NUNCA pode virar stock_search nem faixaPreco.max=2100. A LLM conduz.
//   PEDRO_V3_REAL_EVAL=1 EVAL_USE_PLATFORM_KEY=1 F240_MAX_LLM_CALLS=40 npx tsx eval/run-f240-2100-real-smoke.ts
// ============================================================================
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { buildRealAssembly } from "./real-harness.ts";
import { buildCentralStack, runCentralConversation } from "./central-real-harness.ts";

type Capture = Awaited<ReturnType<typeof runCentralConversation>>[number];

const SCENARIO: readonly (readonly string[])[] = [
  ["Boa tarde"],
  ["quero um Compass"],
  ["gostei do primeiro"],
  ["quais as condicoes?"],
  ["Tenho 8k"],
  ["Ate 2100 ta bom"],
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
  const [, , , , t5, t6] = turns;
  // T5 "Tenho 8k" (entrada): zero stock_search + entrada=8000 registrado.
  if (t5) {
    const sd = slotText(t5);
    failIf(countTool(t5, "stock_search") > 0, failures, `T5: 'Tenho 8k' (entrada) acionou stock_search ${countTool(t5, "stock_search")}x.`);
    failIf(t5.terminalSafe, failures, "T5: 'Tenho 8k' caiu em terminalSafe.");
    failIf(!/entrada/i.test(sd) || !/8000/.test(sd), failures, `T5: entrada=8000 não registrado (slotsDelta=${sd}).`);
  } else failures.push("T5 ausente.");
  // T6 "Até 2100 ta bom" (parcela): zero tool comercial, parcelaDesejada=2100, faixaPreco NÃO 2100, não vira busca.
  if (t6) {
    const sd = slotText(t6);
    failIf(countTool(t6, "stock_search") > 0, failures, `T6: 'Até 2100' acionou stock_search ${countTool(t6, "stock_search")}x.`);
    failIf(countTool(t6, "vehicle_details") > 0, failures, `T6: 'Até 2100' acionou vehicle_details ${countTool(t6, "vehicle_details")}x.`);
    failIf(countTool(t6, "vehicle_photos_resolve") > 0, failures, `T6: 'Até 2100' acionou vehicle_photos_resolve.`);
    failIf(t6.terminalSafe, failures, "T6: 'Até 2100' caiu em terminalSafe.");
    failIf(t6.primaryIntent === "search_stock", failures, "T6: primaryIntent=search_stock (deveria ser financing).");
    failIf(!/parcelaDesejada/i.test(sd) || !/2100/.test(sd), failures, `T6: parcelaDesejada=2100 não registrado (slotsDelta=${sd}).`);
    failIf(/faixaPreco/i.test(sd) && /2100/.test(sd), failures, `T6: faixaPreco recebeu 2100 (proibido) — slotsDelta=${sd}.`);
    failIf(/nao achei|nao encontrei|temos estas|opcoes disponiveis|encontrei estas|pickup ate|nessa faixa/.test(normalized(t6.response)), failures, "T6: 'Até 2100' foi tratado como busca (listou/ofertou estoque como no print).");
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
  const turns = await runCentralConversation(assembly, stack, `wa:f240-2100-smoke-${Date.now()}`, SCENARIO, {
    maxLlmCalls: Number(process.env.F240_MAX_LLM_CALLS ?? "40"), singleAuthor: true, llmFirst: true,
  });
  if (process.env.F240_PF) for (const t of turns) console.error(`T${t.turnIndex} src=${t.responseSource} reason=${t.reasonCode} tools=${toolNames(t).join(",")} slots=${slotText(t)} pf=`, JSON.stringify(t.policyFeedback ?? []));

  const failures = evaluate(turns);
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
    if (t.turnIndex === 1 && s === "deterministic_discovery") continue; // abertura = backstop aceitável (fora do escopo)
    failures.push(`T${t.turnIndex}: responseSource=${s} (${t.reasonCode ?? "-"}) não é brain — a LLM não conduziu.`);
  }
  failIf(composeCalls > 0, failures, `compose=${composeCalls} (deveria ser 0 — autoria única).`);
  const passed = failures.length === 0;
  const totalCalls = stack.brainTransport.count + stack.composeTransport.count;

  mkdirSync(join(process.cwd(), "eval", "reports"), { recursive: true });
  const stamp = started.replace(/[:.]/g, "-");
  const reportPath = join(process.cwd(), "eval", "reports", `f240-2100-real-smoke-${stamp}.md`);
  const rows = turns.map((turn) => [
    turn.turnIndex, turn.leadBlock, turn.response, toolNames(turn).join(", ") || "-",
    turn.responseSource ?? "-", turn.reasonCode ?? "-", turn.primaryIntent ?? "-", shortJson(turn.slotsDelta), turn.terminalSafe ? "sim" : "nao",
  ]);
  const md = [
    "# F2.40 Real Smoke — 'Até 2100' (valor no range de ano) não vira busca",
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
