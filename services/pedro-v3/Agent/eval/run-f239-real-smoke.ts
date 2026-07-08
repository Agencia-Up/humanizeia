import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { buildRealAssembly } from "./real-harness.ts";
import { buildCentralStack, runCentralConversation } from "./central-real-harness.ts";

type Capture = Awaited<ReturnType<typeof runCentralConversation>>[number];

const now = new Date("2026-07-08T12:00:00.000Z");
const clock = { now: () => now.toISOString() };

const SCENARIO: readonly (readonly string[])[] = [
  ["Boa noite"],
  ["Sim, conheco"],
  ["Douglas"],
  ["Aloan", "voce tem SUV?"],
  ["cade?"],
  ["quero SUV"],
  ["gostei do segundo"],
  ["Me passa as condicoes de pagamento"],
  ["Tenho", "Um Renegade", "2019", "86km"],
];

function loadRootEnv(): void {
  const candidates = [
    resolve(process.cwd(), ".env"),
    resolve(process.cwd(), "../../.env"),
    resolve(process.cwd(), "../../../.env"),
  ];
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    for (const rawLine of readFileSync(file, "utf8").split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      if (!process.env[key]) process.env[key] = value;
    }
  }
}

const includesAny = (value: string, patterns: readonly RegExp[]): boolean => patterns.some((rx) => rx.test(value));
const toolNames = (turn: Capture): string[] => turn.observations.map((o) => o.tool);
const hasTool = (turn: Capture, tool: string): boolean => toolNames(turn).includes(tool);
const normalized = (value: string): string => value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
const slotText = (turn: Capture): string => JSON.stringify(turn.slotsDelta ?? []);
const hasVehicleOfferText = (turn: Capture): boolean => /R\$\s*\d|km\s*\|/i.test(turn.response);
const countTool = (turn: Capture, tool: string): number => toolNames(turn).filter((name) => name === tool).length;

function failIf(condition: boolean, failures: string[], message: string): void {
  if (condition) failures.push(message);
}

function evaluate(turns: readonly Capture[]): string[] {
  const failures: string[] = [];
  const byIndex = new Map(turns.map((turn) => [turn.turnIndex, turn]));
  const t4 = byIndex.get(4);
  const t5 = byIndex.get(5);
  const t6 = byIndex.get(6);
  const t7 = byIndex.get(7);
  const t8 = byIndex.get(8);
  const t9 = byIndex.get(9);

  for (const turn of turns) {
    failIf(turn.status !== "committed", failures, `T${turn.turnIndex}: nao commitou (${turn.status}).`);
    failIf(turn.terminalSafe, failures, `T${turn.turnIndex}: caiu em terminalSafe.`);
    failIf(includesAny(normalized(turn.response), [/sobrenome/, /telefone para contato/, /qual.*telefone/]), failures, `T${turn.turnIndex}: pediu sobrenome/telefone indevido.`);
    failIf(includesAny(normalized(turn.response), [/nao consegui confirmar essa informacao/, /reformular pra eu te ajudar/]), failures, `T${turn.turnIndex}: fallback generico apareceu.`);
    failIf(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]|\uFFFD/.test(turn.response), failures, `T${turn.turnIndex}: resposta tem caractere corrompido/controle.`);
  }

  if (t4) {
    failIf(!hasTool(t4, "stock_search"), failures, "T4: pedido de SUV nao executou stock_search.");
    failIf(!hasVehicleOfferText(t4), failures, "T4: pedido de SUV nao retornou lista/oferta aterrada.");
    failIf(includesAny(normalized(t4.response), [/vou buscar/, /ja busco/, /vou procurar/]) && !hasVehicleOfferText(t4), failures, "T4: prometeu buscar sem devolver estoque.");
  } else {
    failures.push("T4 ausente.");
  }

  if (t5) {
    failIf(includesAny(normalized(t5.response), [/qual modelo ou tipo/, /que tipo de carro voce procura/]), failures, "T5: 'cade?' perdeu o contexto e perguntou o que ja tinha sido dito.");
    failIf(includesAny(normalized(t5.response), [/vou buscar/, /ja busco/, /vou procurar/]) && !hasVehicleOfferText(t5), failures, "T5: 'cade?' virou promessa sem resultado.");
    failIf(countTool(t5, "stock_search") > 1, failures, `T5: 'cade?' repetiu stock_search ${countTool(t5, "stock_search")}x no mesmo turno.`);
  } else {
    failures.push("T5 ausente.");
  }

  if (t6) {
    failIf(!hasTool(t6, "stock_search") && !hasVehicleOfferText(t6), failures, "T6: segundo pedido de SUV nao buscou nem listou.");
  } else {
    failures.push("T6 ausente.");
  }

  if (t7) {
    failIf(t7.terminalSafe, failures, "T7: selecao 'gostei do segundo' caiu em terminalSafe.");
    failIf(countTool(t7, "vehicle_details") > 1, failures, `T7: selecao repetiu vehicle_details ${countTool(t7, "vehicle_details")}x no mesmo turno.`);
    failIf(includesAny(normalized(t7.response), [/me conta um pouco mais do que voce procura/, /qual modelo ou tipo/]), failures, "T7: selecao perdeu o carro escolhido e voltou para discovery.");
  } else {
    failures.push("T7 ausente.");
  }

  if (t8) {
    failIf(includesAny(normalized(t8.response), [/qual seu nome/, /me informe seu nome/, /seu nome\?/]), failures, "T8: pagamento/condicoes pediu nome mesmo apos o lead ter informado Douglas.");
  } else {
    failures.push("T8 ausente.");
  }

  if (t9) {
    const text = normalized(t9.response);
    const slots = normalized(slotText(t9));
    failIf(hasTool(t9, "stock_search"), failures, "T9: resposta de veiculo de troca acionou stock_search.");
    failIf(t9.primaryIntent === "search_stock", failures, "T9: entendimento classificou veiculo de troca como search_stock.");
    failIf(includesAny(text, [/nao achei/, /nao encontrei/, /temos estas/, /opcoes disponiveis/]), failures, "T9: tratou Renegade de troca como busca de estoque.");
    failIf(!/possuiTroca/.test(slotText(t9)) && !/veiculoTroca/.test(slotText(t9)), failures, "T9: nao registrou informacao de troca nos slots.");
    failIf(!/renegade/i.test(slots), failures, "T9: veiculo de troca nao capturou Renegade.");
    failIf(!/2019/.test(slots), failures, "T9: veiculo de troca nao capturou ano 2019.");
    failIf(!/86000|86\.000/.test(slots), failures, "T9: veiculo de troca nao normalizou 86km para 86000.");
    failIf(/"slot":"interesse"[^}]*renegade/i.test(slotText(t9)), failures, "T9: veiculo de troca contaminou o interesse de compra.");
  } else {
    failures.push("T9 ausente.");
  }

  return failures;
}

function mdCell(value: unknown): string {
  return String(value ?? "-")
    .replace(/\r?\n/g, "<br>")
    .replace(/\|/g, "\\|");
}

function shortJson(value: unknown): string {
  const text = JSON.stringify(value ?? null);
  return text.length > 260 ? `${text.slice(0, 257)}...` : text;
}

async function main(): Promise<void> {
  loadRootEnv();
  process.env.PEDRO_V3_REAL_EVAL = "1";
  process.env.EVAL_USE_PLATFORM_KEY = process.env.EVAL_USE_PLATFORM_KEY || "1";

  const assembly = await buildRealAssembly(clock);
  const stack = buildCentralStack(assembly);
  const started = new Date().toISOString();
  // conversationId com prefixo "wa:" p/ refletir PRODUÇÃO (todo lead vem do WhatsApp): ativa a guarda POL-PHONE-KNOWN (o
  // telefone JÁ é conhecido pelo canal — o agente não deve pedir telefone) + o sinal contactPhoneKnown no frame.
  const turns = await runCentralConversation(assembly, stack, `wa:f239-real-smoke-${Date.now()}`, SCENARIO, {
    maxLlmCalls: Number(process.env.F239_MAX_LLM_CALLS ?? "45"),
    singleAuthor: true,
    llmFirst: true,
  });
  if (process.env.F239_PF) for (const t of turns) console.error(`T${t.turnIndex} src=${t.responseSource} reason=${t.reasonCode} pf=`, JSON.stringify(t.policyFeedback ?? []));
  const failures = evaluate(turns);
  // ── Métricas LLM-first (regra P0 do dono): a conversa deve ser conduzida pela LLM (brain_final/brain_retry), 0
  //    technical_fallback, e recovery comercial determinístico = 0 (ou dívida de arquitetura declarada). Não declarar
  //    concluído se depender de recovery comercial. ────────────────────────────────────────────────────────────────
  const COMMERCIAL_RECOVERY = new Set(["recovery_offer", "recovery_stock_empty", "recovery_stock_empty_conduct", "recovery_relaxed_offer", "recovery_stock_not_run", "recovery_detail_attr", "recovery_detail_no_vehicle", "recovery_photo_which", "more_options_needs_scope", "ad_generic_discovery", "recovery_ask_need"]);
  const srcCount: Record<string, number> = {};
  for (const t of turns) { const s = t.responseSource ?? "?"; srcCount[s] = (srcCount[s] ?? 0) + 1; }
  const llmTurns = turns.filter((t) => t.responseSource === "brain_final" || t.responseSource === "brain_retry").length;
  const techFallbackTurns = turns.filter((t) => t.responseSource === "technical_fallback");
  const commercialRecoveryTurns = turns.filter((t) => t.responseSource === "deterministic_recovery" && COMMERCIAL_RECOVERY.has(t.reasonCode ?? ""));
  // technical_fallback já reprova via terminalSafe; declaro explícito p/ o relatório da regra P0.
  for (const t of techFallbackTurns) failures.push(`T${t.turnIndex}: technical_fallback — a LLM NÃO conduziu (regra LLM-first).`);
  // ⭐Regra P0 do dono: recovery comercial determinístico (o engine escrevendo/listando no lugar da LLM) deve ser 0. HARD FAIL.
  for (const t of commercialRecoveryTurns) failures.push(`T${t.turnIndex}: recovery comercial (${t.reasonCode}) — o engine escreveu no lugar da LLM (regra LLM-first: commercialRecovery deve ser 0).`);
  // ⭐Regra P0 do dono: a LLM deve conduzir 9/9 (brain_final/brain_retry). Qualquer turno com fonte determinística do engine
  // (deterministic_discovery/conduct/recovery/... = engine escrevendo) reprova. Exceção legítima: foto/institucional/recall
  // (factuais) — este cenário não tem esses turnos, então exijo 100% brain.
  for (const t of turns) {
    const s = t.responseSource;
    if (s === "brain_final" || s === "brain_retry") continue;
    if (s === "technical_fallback") continue; // já reportado acima (167) — mensagem mais específica
    if (s === "deterministic_recovery" && COMMERCIAL_RECOVERY.has(t.reasonCode ?? "")) continue; // já reportado (169)
    failures.push(`T${t.turnIndex}: responseSource=${s} (${t.reasonCode ?? "-"}) não é brain — a LLM não conduziu (regra LLM-first: 9/9).`);
  }
  const passed = failures.length === 0;
  const totalCalls = stack.brainTransport.count + stack.composeTransport.count;

  mkdirSync(join(process.cwd(), "eval", "reports"), { recursive: true });
  const stamp = started.replace(/[:.]/g, "-");
  const reportPath = join(process.cwd(), "eval", "reports", `f239-real-smoke-${stamp}.md`);
  const rows = turns.map((turn) => [
    turn.turnIndex,
    turn.leadBlock,
    turn.response,
    toolNames(turn).join(", ") || "-",
    turn.effects.map((effect) => `${effect.kind}${effect.photoCount ? `(${effect.photoCount})` : ""}`).join(", ") || "-",
    turn.responseSource ?? "-",
    turn.reasonCode ?? "-",
    turn.primaryIntent ?? "-",
    shortJson(turn.slotsDelta),
    turn.possuiTrocaAfter,
    turn.terminalSafe ? "sim" : "nao",
  ]);
  const md = [
    "# F2.39 Real Smoke - SUV, resume e veiculo de troca",
    "",
    `- Resultado: **${passed ? "PASS" : "FAIL"}**`,
    `- LLM calls: brain=${stack.brainTransport.count}, compose=${stack.composeTransport.count}, total=${totalCalls}`,
    `- Prompt integral brain: ${stack.brainTransport.calls.every((c) => c.promptExact) ? "sim" : "nao"}`,
    `- Prompt integral compose: ${stack.composeTransport.calls.every((c) => c.promptExact) ? "sim" : "nao"}`,
    "",
    "## Falhas",
    failures.length ? failures.map((failure) => `- ${failure}`).join("\n") : "- Nenhuma.",
    "",
    "## Métricas LLM-first (regra P0 do dono)",
    `- Turnos: ${turns.length} | conduzidos pela LLM (brain_final/brain_retry): **${llmTurns}/${turns.length}** | technical_fallback: **${techFallbackTurns.length}** | recovery comercial determinístico: **${commercialRecoveryTurns.length}**`,
    `- Distribuição responseSource: ${Object.entries(srcCount).map(([s, n]) => `${s}=${n}`).join(", ")}`,
    commercialRecoveryTurns.length
      ? `- ⚠️ Recovery comercial (engine escreveu resposta — DÍVIDA de arquitetura, refatorar p/ LLM): ${commercialRecoveryTurns.map((t) => `T${t.turnIndex}:${t.reasonCode}`).join(", ")}`
      : "- ✅ Nenhum recovery comercial determinístico (a LLM conduziu).",
    "",
    "## Turnos",
    "| T | lead | resposta | tools | effects | source | reason | intent | slotsDelta | possuiTroca | terminalSafe |",
    "|---:|---|---|---|---|---|---|---|---|---|---|",
    ...rows.map((row) => `| ${row.map(mdCell).join(" | ")} |`),
    "",
  ].join("\n");
  writeFileSync(reportPath, md, "utf8");

  console.log(JSON.stringify({ passed, failures, reportPath, totalCalls, brainCalls: stack.brainTransport.count, composeCalls: stack.composeTransport.count, llmFirst: { turns: turns.length, llmAuthored: llmTurns, technicalFallback: techFallbackTurns.length, commercialRecovery: commercialRecoveryTurns.length, sources: srcCount } }, null, 2));
  if (!passed) process.exitCode = 1;
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
