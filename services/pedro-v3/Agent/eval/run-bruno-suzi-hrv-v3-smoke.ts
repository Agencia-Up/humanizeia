// Low-cost replay of a real Bruno lead that Pedro v2 mishandled on 2026-07-15.
// Uses Bruno's portal prompt, BNDV stock and configured LLM, with every external
// effect kept in memory. No customer, CRM row or seller is touched.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { TenantAgentRef } from "../src/domain/read-ports.ts";
import { RealClock } from "../src/runtime/real-clock.ts";
import { buildCentralStack, runCentralConversation } from "./central-real-harness.ts";
import { buildRealAssemblyFor, loadServiceEnv, sanitize } from "./real-harness.ts";

const BRUNO: TenantAgentRef = {
  tenantId: "f49fd48a-4386-4009-95f3-26a5100b84f7",
  agentId: "aee7e916-31b1-431c-ba6f-f38178fd4899",
};

const AD = {
  adId: null,
  source: "instagram",
  sourceUrl: "https://www.instagram.com/p/DanpHBVswqf/",
  title: "Fale agora com um de nossos consultores e confira as opcoes disponiveis!",
  body: "Veiculos revisados e prontos para voce. Condicoes especiais a vista ou na troca.",
  greeting: "Ola! Quer saber mais sobre o Corolla 2.0 Cross XRE 2024?",
  imageUrls: [],
  capturedAtTurn: 0,
};

const STEPS = [
  ["Ola! Tenho interesse e queria mais informacoes, por favor."],
  ["Sim", "Temos", "Bom dia", "Tenho uma HRV ano 2023/24 e l", "EXL", "30mil kilometros", "Para troca!"],
  ["Tenho 20 mil de entrada"],
  ["Ate 2500 de parcela"],
  ["Quero falar com um vendedor"],
] as const;

const isBrain = (source: string | undefined): boolean => /^brain_(?:final|retry)$/.test(source ?? "");
const slotText = (turn: Awaited<ReturnType<typeof runCentralConversation>>[number] | undefined): string =>
  JSON.stringify(turn?.slotsDelta ?? []);
const normalize = (text: string): string => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const questions = (text: string): string[] => text.split("?").slice(0, -1)
  .map((part) => normalize(part.split(/[.!]/).at(-1) ?? ""))
  .filter(Boolean);

async function main(): Promise<void> {
  if (process.env.PEDRO_V3_REAL_EVAL !== "1") throw new Error("PEDRO_V3_REAL_EVAL_REQUIRED");
  loadServiceEnv();
  const assembly = await buildRealAssemblyFor(BRUNO, new RealClock());
  const stack = buildCentralStack(assembly);
  const turns = await runCentralConversation(
    assembly,
    stack,
    `wa:bruno-suzi-hrv-${Date.now().toString(36)}`,
    STEPS,
    {
      maxLlmCalls: Number(process.env.BRUNO_SUZI_MAX_LLM_CALLS ?? "14"),
      singleAuthor: true,
      llmFirst: true,
      crmLeadId: "00000000-0000-4000-8000-000000000058",
      handoff: { enabled: true, available: true, precheck: { available: true, reason: "available" } as never },
      firstTurnAdContext: AD,
    },
  );

  const failures: string[] = [];
  if (turns.length !== STEPS.length) failures.push(`turn_count=${turns.length}`);
  for (const turn of turns) {
    if (turn.status !== "committed") failures.push(`T${turn.turnIndex}:status=${turn.status}`);
    if (!isBrain(turn.responseSource)) failures.push(`T${turn.turnIndex}:not_llm_authored=${turn.responseSource ?? "none"}`);
    if (turn.terminalSafe || turn.responseSource === "technical_fallback") failures.push(`T${turn.turnIndex}:fallback`);
    if (!turn.promptExactInTurn) failures.push(`T${turn.turnIndex}:portal_prompt_missing`);
  }
  const seenQuestions = new Set<string>();
  for (const turn of turns) {
    for (const question of questions(turn.response)) {
      if (question.length >= 12 && seenQuestions.has(question)) failures.push(`T${turn.turnIndex}:repeated_agent_question`);
      if (question.includes(" ou ")) failures.push(`T${turn.turnIndex}:ambiguous_question_with_alternatives`);
      seenQuestions.add(question);
    }
  }

  const [opening, trade, entry, installment, human] = turns;
  if (!/corolla|cross|an[uú]ncio/i.test(opening?.response ?? "")) failures.push("T1:ad_vehicle_not_acknowledged");
  if (opening?.effects.some((effect) => effect.kind === "handoff" || effect.kind === "notify_seller")) failures.push("T1:premature_handoff");

  const tradeSlots = slotText(trade);
  if (!/possuiTroca/i.test(tradeSlots) || !/true/i.test(tradeSlots)) failures.push("T2:trade_presence_missing");
  if (!/veiculoTroca/i.test(tradeSlots) || !/hr-?v|hrv/i.test(tradeSlots)) failures.push("T2:trade_model_missing");
  if (!/30000/.test(tradeSlots)) failures.push("T2:trade_mileage_missing");
  if (!/2023|2024/.test(tradeSlots)) failures.push("T2:trade_year_missing");
  if (trade?.toolsRequested.some((tool) => ["stock_search", "vehicle_details", "vehicle_photos_resolve"].includes(tool))) failures.push("T2:commercial_tool_on_trade_answer");
  if (/qual (?:o )?modelo|qual (?:o )?ano|quilometragem do carro/i.test(trade?.response ?? "")) failures.push("T2:reasked_known_trade_data");
  if (/revis(?:ao|oes|ada)|avaria|bom estado|sinistro|leilao|pendencia/i.test(normalize(trade?.response ?? ""))) failures.push("T2:invented_trade_question_outside_portal_prompt");
  if (trade?.effects.some((effect) => effect.kind === "handoff" || effect.kind === "notify_seller")) failures.push("T2:premature_handoff");

  const entrySlots = slotText(entry);
  if (entry?.primaryIntent !== "financing") failures.push(`T3:intent=${entry?.primaryIntent ?? "none"}`);
  if (!/entrada/i.test(entrySlots) || !/20000/.test(entrySlots)) failures.push("T3:entry_missing");
  if (entry?.toolsRequested.includes("stock_search")) failures.push("T3:stock_search_on_entry");
  const entryQuestions = questions(entry?.response ?? "");
  const entryHandledVisibly = /entrada|20\s*mil/i.test(entry?.response ?? "")
    || entryQuestions.some((question) => /parcela|financ|pagamento|valor/.test(question));
  if (!entryHandledVisibly) failures.push("T3:entry_not_addressed_in_visible_reply");
  if (/qual (?:o )?modelo|modelo .*interesse|modelo .*procura/i.test(entry?.response ?? "")) failures.push("T3:reasked_purchase_model_already_known_from_ad");
  if (entryQuestions.some((question) => !/entrada|parcela|financ|pagamento|valor/.test(question))) failures.push("T3:next_question_left_current_financial_act");

  const installmentSlots = slotText(installment);
  if (installment?.primaryIntent !== "financing") failures.push(`T4:intent=${installment?.primaryIntent ?? "none"}`);
  if (!/parcela/i.test(installmentSlots) || !/2500/.test(installmentSlots)) failures.push("T4:installment_missing");
  if (installment?.toolsRequested.includes("stock_search")) failures.push("T4:stock_search_on_installment");
  if (!/parcela|2[.]?500|2500/i.test(installment?.response ?? "")) failures.push("T4:installment_not_addressed_in_visible_reply");
  if (/consultor|vendedor|encaminh|transfer/i.test(installment?.response ?? "")
    && !installment?.effects.some((effect) => effect.kind === "handoff" || effect.kind === "notify_seller")) failures.push("T4:human_handoff_promise_without_effect");
  if (questions(installment?.response ?? "").some((question) => !/entrada|parcela|financ|pagamento|valor/.test(question))) failures.push("T4:next_question_left_current_financial_act");

  if (human?.primaryIntent !== "request_human") failures.push(`T5:intent=${human?.primaryIntent ?? "none"}`);
  if (!human?.effects.some((effect) => effect.kind === "handoff")) failures.push("T5:handoff_missing");
  if (!human?.effects.some((effect) => effect.kind === "notify_seller")) failures.push("T5:notify_seller_missing");
  const briefing = human?.handoffBriefing ?? "";
  if (!/corolla|cross/i.test(briefing)) failures.push("T5:briefing_purchase_interest_missing");
  if (!/hr-?v|hrv/i.test(briefing) || !/30(?:[.]?000| mil)/i.test(briefing)) failures.push("T5:briefing_trade_missing");
  if (!/20(?:[.]?000| mil)/i.test(briefing) || !/2[.]?500/i.test(briefing)) failures.push("T5:briefing_financials_missing");

  const report = [
    "# Replay real Bruno - Suzi / Corolla Cross / HR-V de troca",
    "",
    `Resultado: **${failures.length === 0 ? "PASS" : "FAIL"}**`,
    `Provider/modelo: ${assembly.aiProvider.provider}/${assembly.aiProvider.model}`,
    `Chamadas LLM: ${stack.brainTransport.count + stack.composeTransport.count}`,
    "Efeitos externos: OFF (WhatsApp, CRM e vendedor em memoria).",
    "",
    "## Conversa simulada",
    "",
    "| T | Lead | Resposta Pedro v3 | Intent | Tools | Effects | Slots | Fonte | LLM calls |",
    "|---:|---|---|---|---|---|---|---|---:|",
    ...turns.map((turn) => `| ${turn.turnIndex} | ${sanitize(turn.leadBlock).replace(/\|/g, "/")} | ${sanitize(turn.response).replace(/\|/g, "/")} | ${turn.primaryIntent ?? "-"} | ${turn.toolsRequested.join(", ") || "-"} | ${turn.effects.map((effect) => effect.kind).join(", ") || "-"} | ${sanitize(slotText(turn)).replace(/\|/g, "/")} | ${turn.responseSource ?? "-"} | ${turn.llmCallsInTurn} |`),
    "",
    "## Briefing final",
    "",
    sanitize(briefing) || "(ausente)",
    "",
    "## Falhas",
    ...(failures.length ? failures.map((failure) => `- ${failure}`) : ["- Nenhuma."]),
  ];
  const reportDir = join(process.cwd(), "eval", "reports");
  mkdirSync(reportDir, { recursive: true });
  const output = join(reportDir, `bruno-suzi-hrv-${new Date().toISOString().replace(/[:.]/g, "-")}.md`);
  writeFileSync(output, report.join("\n"), "utf8");
  console.log(`REPORT ${output}`);
  console.log(`RESULT ${failures.length === 0 ? "PASS" : "FAIL"} calls=${stack.brainTransport.count + stack.composeTransport.count}`);
  failures.forEach((failure) => console.error(`FAIL ${failure}`));
  if (failures.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
