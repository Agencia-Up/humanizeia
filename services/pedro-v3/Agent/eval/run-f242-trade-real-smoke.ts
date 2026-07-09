// ============================================================================
// F2.42 — SMOKE REAL (gpt-4.1-mini, efeitos OFF): resposta de TROCA em BLOCO QUEBRADO não cai em fallback nem vira busca.
//   Roteiro do incidente (2026-07-09): Boa tarde -> quero um Nivus -> gostei -> tem garantia? -> vou querer -> Douglas
//   -> bloco em rajada: "tenho" / "uma hillux 2020" / "85km rodados".
//   PASS: no turno da troca ZERO tool comercial, veiculoTroca completo (Hilux/2020/85000), compra preservada,
//   resposta brain_final/brain_retry (0 technical_fallback, 0 recovery comercial), sem regressão à descoberta.
//   PEDRO_V3_REAL_EVAL=1 EVAL_USE_PLATFORM_KEY=1 F242_MAX_LLM_CALLS=45 npx tsx eval/run-f242-trade-real-smoke.ts
// ============================================================================
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { buildRealAssembly } from "./real-harness.ts";
import { buildCentralStack, runCentralConversation } from "./central-real-harness.ts";

type Capture = Awaited<ReturnType<typeof runCentralConversation>>[number];

const SCENARIO: readonly (readonly string[])[] = [
  ["Boa tarde"],
  ["quero um Nivus"],
  ["gostei"],
  ["tem garantia?"],
  ["vou querer"],
  ["Douglas"],
  ["tenho", "uma hillux 2020", "85km rodados"],
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
  const [, t2, , , , , t7] = turns;
  // T2 é pedido de busca legítimo: a LLM classifica e busca (autoridade positiva).
  if (t2) failIf(countTool(t2, "stock_search") < 1, failures, "T2: 'quero um Nivus' não buscou (a LLM deveria classificar busca).");
  // T7 = O INCIDENTE: resposta de troca em bloco quebrado.
  if (t7) {
    const sd = slotText(t7);
    const resp = normalized(t7.response);
    failIf(countTool(t7, "stock_search") > 0, failures, `T7: resposta de TROCA acionou stock_search ${countTool(t7, "stock_search")}x.`);
    failIf(countTool(t7, "vehicle_details") > 0, failures, "T7: resposta de TROCA acionou vehicle_details (o bug do incidente: '85km rodados' NÃO é pergunta de atributo do Nivus).");
    failIf(countTool(t7, "vehicle_photos_resolve") > 0, failures, "T7: resposta de TROCA acionou vehicle_photos_resolve.");
    failIf(t7.primaryIntent === "search_stock", failures, "T7: primaryIntent=search_stock (a troca foi tratada como busca).");
    failIf(t7.terminalSafe, failures, "T7: turno da troca caiu em terminalSafe.");
    failIf(!/possuiTroca/i.test(sd) || !/true/.test(sd), failures, `T7: possuiTroca=true não registrado (slotsDelta=${sd}).`);
    failIf(!/veiculoTroca/i.test(sd) || !/85000/.test(sd), failures, `T7: veiculoTroca com km=85000 não registrado (slotsDelta=${sd}).`);
    failIf(!/hil+ux/i.test(sd), failures, `T7: veiculoTroca sem o MODELO (Hilux/hillux) — briefing incompleto (slotsDelta=${sd}).`);
    failIf(!/2020/.test(sd), failures, `T7: veiculoTroca sem o ANO 2020 (slotsDelta=${sd}).`);
    failIf(/interesse"[^}]*hil+ux/i.test(sd), failures, `T7: interesse de COMPRA contaminado pela troca (slotsDelta=${sd}).`);
    failIf(/me conta um pouco mais do que voce procura|o que voce procura/.test(resp), failures, `T7: REGREDIU à descoberta genérica (o incidente): "${t7.response.slice(0, 120)}"`);
    failIf(/encontrei estas opcoes/.test(resp), failures, `T7: re-listou estoque na resposta de troca: "${t7.response.slice(0, 120)}"`);
  } else failures.push("T7 ausente.");
  return failures;
}

function mdCell(value: unknown): string { return String(value ?? "-").replace(/\r?\n/g, "<br>").replace(/\|/g, "\\|"); }
function shortJson(value: unknown): string { const text = JSON.stringify(value ?? null); return text.length > 260 ? `${text.slice(0, 257)}...` : text; }

async function main(): Promise<void> {
  loadRootEnv();
  process.env.PEDRO_V3_REAL_EVAL = "1";
  process.env.EVAL_USE_PLATFORM_KEY = process.env.EVAL_USE_PLATFORM_KEY || "1";

  const clock = { now: () => new Date("2026-07-09T12:00:00.000Z").toISOString() };
  const assembly = await buildRealAssembly(clock);
  const stack = buildCentralStack(assembly);
  const started = new Date().toISOString();
  const turns = await runCentralConversation(assembly, stack, `wa:f242-trade-smoke-${Date.now()}`, SCENARIO, {
    maxLlmCalls: Number(process.env.F242_MAX_LLM_CALLS ?? "45"), singleAuthor: true, llmFirst: true,
  });
  if (process.env.F242_PF) for (const t of turns) console.error(`T${t.turnIndex} src=${t.responseSource} intent=${t.primaryIntent} reason=${t.reasonCode} tools=${toolNames(t).join(",")} pf=`, JSON.stringify(t.policyFeedback ?? []));

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
  const reportPath = join(process.cwd(), "eval", "reports", `f242-trade-real-smoke-${stamp}.md`);
  const rows = turns.map((turn) => [
    turn.turnIndex, turn.leadBlock, turn.response, toolNames(turn).join(", ") || "-",
    turn.responseSource ?? "-", turn.reasonCode ?? "-", turn.primaryIntent ?? "-", shortJson(turn.slotsDelta), turn.terminalSafe ? "sim" : "nao",
  ]);
  const md = [
    "# F2.42 Real Smoke — troca em bloco quebrado (tenho / uma hillux 2020 / 85km rodados)",
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
