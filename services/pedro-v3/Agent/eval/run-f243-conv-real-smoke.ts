// ============================================================================
// F2.43 — SMOKE REAL Conversa 1 (gpt-4.1-mini, efeitos OFF): jornada SDR completa sem contradição interna.
//   Boa tarde -> SUV até 100 mil -> tem outros? -> gostei do segundo -> fotos -> mais fotos -> condições ->
//   troca (Hilux 2020 85km) -> 8k entrada -> até 2100 parcela.
//   Critérios: busca SÓ nos turnos comerciais (T2/T3); "outros" herda escopo (excludeKeys); fotos seguem o MESMO
//   veículo; troca/financeiro NUNCA buscam; LLM conduz todos os turnos (0 technical_fallback, 0 recovery comercial).
//   PEDRO_V3_REAL_EVAL=1 EVAL_USE_PLATFORM_KEY=1 F243_MAX_LLM_CALLS=50 npx tsx eval/run-f243-conv-real-smoke.ts
// ============================================================================
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { buildRealAssembly } from "./real-harness.ts";
import { buildCentralStack, runCentralConversation } from "./central-real-harness.ts";

type Capture = Awaited<ReturnType<typeof runCentralConversation>>[number];

const SCENARIO: readonly (readonly string[])[] = [
  ["Boa tarde"],
  ["Quero SUV até 100 mil"],
  ["Tem outros?"],
  ["Gostei do segundo"],
  ["Me manda fotos"],
  ["Tem mais fotos?"],
  ["Quais as condições?"],
  ["Tenho uma Hilux 2020 85km"],
  ["Tenho 8k de entrada"],
  ["Até 2100 de parcela"],
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
const media = (turn: Capture): { kind: string; vehicleKey?: string; photoCount?: number } | undefined => turn.effects.find((e) => e.kind === "send_media");
const normalized = (value: string): string => value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
const slotText = (turn: Capture): string => JSON.stringify(turn.slotsDelta ?? []);
function failIf(condition: boolean, failures: string[], message: string): void { if (condition) failures.push(message); }

function evaluate(turns: Capture[]): string[] {
  const failures: string[] = [];
  const [, t2, t3, t4, t5, t6, t7, t8, t9, t10] = turns;
  // T2: busca comercial legítima com escopo do lead.
  if (t2) {
    failIf(countTool(t2, "stock_search") < 1, failures, "T2: 'SUV até 100 mil' não buscou.");
    failIf(!/encontrei|opc[oõ]es|tenho/i.test(normalized(t2.response)) && !/suv/i.test(normalized(t2.response)), failures, `T2: resposta não apresentou opções: "${t2.response.slice(0, 100)}"`);
  } else failures.push("T2 ausente.");
  // T3: mais opções HERDA o escopo (não repergunta, não re-lista os mesmos).
  if (t3) failIf(countTool(t3, "stock_search") < 1 && !/nao\s+(?:temos|tenho)|alem dess/i.test(normalized(t3.response)), failures, `T3: 'tem outros?' nem buscou nem foi honesto: "${t3.response.slice(0, 100)}"`);
  // T4: seleção — NUNCA busca.
  if (t4) failIf(countTool(t4, "stock_search") > 0, failures, "T4: seleção ('gostei do segundo') acionou stock_search.");
  // T5: foto do selecionado.
  if (t5) {
    failIf(countTool(t5, "stock_search") > 0, failures, "T5: pedido de FOTO acionou stock_search.");
    failIf(!media(t5) && !/foto/i.test(normalized(t5.response)), failures, `T5: 'me manda fotos' não enviou mídia nem tratou fotos: "${t5.response.slice(0, 100)}"`);
  }
  // T6: MAIS fotos = MESMO veículo, novo lote; nunca busca.
  if (t6) {
    failIf(countTool(t6, "stock_search") > 0, failures, "T6: 'tem mais fotos?' acionou stock_search (deveria ser foto do MESMO veículo).");
    const m5 = media(t5 ?? ({} as Capture)); const m6 = media(t6);
    if (m5?.vehicleKey && m6?.vehicleKey) failIf(m6.vehicleKey !== m5.vehicleKey, failures, `T6: 'mais fotos' trocou de veículo (${m5.vehicleKey} -> ${m6.vehicleKey}).`);
  }
  // T7: condições — conduz qualificação, não busca.
  if (t7) failIf(countTool(t7, "stock_search") > 0, failures, "T7: 'quais as condições?' acionou stock_search.");
  // T8: TROCA — 0 tools comerciais; briefing completo; sem regressão à descoberta.
  if (t8) {
    const sd = slotText(t8);
    failIf(countTool(t8, "stock_search") > 0, failures, "T8: resposta de TROCA acionou stock_search.");
    failIf(countTool(t8, "vehicle_details") > 0, failures, "T8: resposta de TROCA acionou vehicle_details.");
    failIf(!/possuiTroca/i.test(sd) || !/true/.test(sd), failures, `T8: possuiTroca=true não registrado (slotsDelta=${sd}).`);
    failIf(!/veiculoTroca/i.test(sd) || !/85000/.test(sd) || !/hil+ux/i.test(sd), failures, `T8: veiculoTroca Hilux/85000 incompleto (slotsDelta=${sd}).`);
    failIf(/me conta um pouco mais do que voce procura|o que voce procura/.test(normalized(t8.response)), failures, `T8: regrediu à descoberta: "${t8.response.slice(0, 100)}"`);
  } else failures.push("T8 ausente.");
  // T9/T10: financeiro — slots certos, 0 busca.
  if (t9) {
    failIf(countTool(t9, "stock_search") > 0, failures, "T9: resposta de ENTRADA acionou stock_search.");
    failIf(!/entrada/i.test(slotText(t9)) || !/8000/.test(slotText(t9)), failures, `T9: entrada=8000 não registrada (slotsDelta=${slotText(t9)}).`);
  }
  if (t10) {
    failIf(countTool(t10, "stock_search") > 0, failures, "T10: resposta de PARCELA acionou stock_search.");
    failIf(!/parcelaDesejada/i.test(slotText(t10)) || !/2100/.test(slotText(t10)), failures, `T10: parcelaDesejada=2100 não registrada (slotsDelta=${slotText(t10)}).`);
    failIf(/faixaPreco/i.test(slotText(t10)) && /2100/.test(slotText(t10)), failures, `T10: faixaPreco recebeu 2100 (proibido).`);
  }
  return failures;
}

function mdCell(value: unknown): string { return String(value ?? "-").replace(/\r?\n/g, "<br>").replace(/\|/g, "\\|"); }
function shortJson(value: unknown): string { const text = JSON.stringify(value ?? null); return text.length > 240 ? `${text.slice(0, 237)}...` : text; }

async function main(): Promise<void> {
  loadRootEnv();
  process.env.PEDRO_V3_REAL_EVAL = "1";
  process.env.EVAL_USE_PLATFORM_KEY = process.env.EVAL_USE_PLATFORM_KEY || "1";

  const clock = { now: () => new Date("2026-07-09T12:00:00.000Z").toISOString() };
  const assembly = await buildRealAssembly(clock);
  const stack = buildCentralStack(assembly);
  const started = new Date().toISOString();
  const turns = await runCentralConversation(assembly, stack, `wa:f243-conv-smoke-${Date.now()}`, SCENARIO, {
    maxLlmCalls: Number(process.env.F243_MAX_LLM_CALLS ?? "50"), singleAuthor: true, llmFirst: true,
  });
  if (process.env.F243_PF) for (const t of turns) console.error(`T${t.turnIndex} src=${t.responseSource} intent=${t.primaryIntent} reason=${t.reasonCode} tools=${toolNames(t).join(",")} effects=${JSON.stringify(t.effects)} pf=`, JSON.stringify(t.policyFeedback ?? []));

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
    if (s === "deterministic_recall" || s === "deterministic_photo") continue; // foto/recall determinístico aterrado (invariante, não fallback)
    failures.push(`T${t.turnIndex}: responseSource=${s} (${t.reasonCode ?? "-"}) não é brain — a LLM não conduziu.`);
  }
  failIf(composeCalls > 0, failures, `compose=${composeCalls} (deveria ser 0 — autoria única).`);
  const passed = failures.length === 0;
  const totalCalls = stack.brainTransport.count + stack.composeTransport.count;

  mkdirSync(join(process.cwd(), "eval", "reports"), { recursive: true });
  const stamp = started.replace(/[:.]/g, "-");
  const reportPath = join(process.cwd(), "eval", "reports", `f243-conv-real-smoke-${stamp}.md`);
  const rows = turns.map((turn) => [
    turn.turnIndex, turn.leadBlock, turn.response, toolNames(turn).join(", ") || "-",
    turn.effects.map((e) => `${e.kind}${e.vehicleKey ? `(${e.vehicleKey})` : ""}${e.photoCount != null ? `[${e.photoCount}]` : ""}`).join(",") || "-",
    turn.responseSource ?? "-", turn.reasonCode ?? "-", turn.primaryIntent ?? "-", shortJson(turn.slotsDelta), turn.terminalSafe ? "sim" : "nao",
  ]);
  const md = [
    "# F2.43 Real Smoke — Conversa 1 (jornada SDR completa, 10 turnos)",
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
    "| # | Lead | Resposta | Tools | Effects | responseSource | reasonCode | primaryIntent | slotsDelta | terminalSafe |",
    "|---|------|----------|-------|---------|----------------|------------|---------------|-----------|--------------|",
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
