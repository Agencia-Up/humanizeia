import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { RealClock } from "../src/runtime/real-clock.ts";
import { loadServiceEnv, buildRealAssembly, sanitize } from "./real-harness.ts";
import { buildCentralStack, runCentralConversation } from "./central-real-harness.ts";

const STEPS = [
  ["Boa tarde"],
  ["Quero suv", "Tem?"],
  ["Gostei do primeiro"],
  ["Me manda fotos dele"],
  ["Na verdade quero um Compass 2019"],
  ["Gostei do Compass 2019"],
  ["Quero agendar uma visita"],
  ["Pra segunda"],
  ["As 15h"],
  ["Quero falar com um vendedor"],
] as const;

const norm = (value: string): string => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const isBrain = (source: string | undefined): boolean => /^brain_(?:final|retry)$/.test(source ?? "");
// \u2b50MISS\u00c3O FINAL (resposta VIS\u00cdVEL): a pergunta de DIA/HOR\u00c1RIO no texto que o cliente l\u00ea. O agente NUNCA pode reperguntar
// uma dimens\u00e3o j\u00e1 respondida (dia dado -> n\u00e3o repergunta dia; hor\u00e1rio dado -> n\u00e3o repergunta hor\u00e1rio).
const asksDay = (value: string): boolean => /qual\s+(?:o\s+)?(?:melhor\s+)?dia|que\s+dia|em\s+que\s+dia|pra\s+que\s+dia|para\s+que\s+dia/.test(norm(value));
const asksTime = (value: string): boolean => /qual\s+(?:o\s+)?(?:melhor\s+)?hor|que\s+hor|que\s+horas|qual\s+horario|a\s+que\s+horas/.test(norm(value));

async function main(): Promise<void> {
  if (process.env.PEDRO_V3_REAL_EVAL !== "1") {
    console.error("BLOQUEADO: defina PEDRO_V3_REAL_EVAL=1.");
    process.exit(2);
  }
  loadServiceEnv();
  const assembly = await buildRealAssembly(new RealClock());
  const stack = buildCentralStack(assembly);
  const turns = await runCentralConversation(
    assembly,
    stack,
    `wa:f252-journey-${Date.now().toString(36)}`,
    STEPS,
    {
      maxLlmCalls: Number(process.env.F252_MAX_LLM_CALLS ?? "32"),
      singleAuthor: true,
      llmFirst: true,
      crmLeadId: "00000000-0000-4000-8000-000000000052",
      handoff: { enabled: true, available: true, precheck: { available: true, reason: "available" } as never },
    },
  );

  const failures: string[] = [];
  const [opening, search, selection, photos, pivot, pivotSelection, visit, day, time, human] = turns;
  // ⭐P0-C (gate PORTAL-FIRST): a abertura é regida pelo PROMPT DO PORTAL, não por um roteiro fixo do teste. Valida
  // INVARIANTES (não frases obrigatórias de descoberta): (1) autoria da LLM (brain_*); (2) não degradou (sem terminalSafe);
  // (3) apresentou-se conforme a identidade do portal; (4) no máximo UMA pergunta principal; (5) sem nome/telefone
  // prematuros. NÃO exige taxonomia de carroceria — se o portal abre pela cidade/loja, a LLM seguindo o portal PASSA.
  const openingText = norm(opening?.response ?? "");
  if (!isBrain(opening?.responseSource)) failures.push(`T1 source=${opening?.responseSource ?? "-"}, esperado brain_*`);
  if (opening?.terminalSafe) failures.push("T1 degradou (terminalSafe/technical_fallback)");
  if (!/\b(?:eu sou|me chamo|aqui e|sou o|sou a|aqui quem fala|falo da|falando da)\b/.test(openingText)) failures.push("T1 nao se apresentou conforme o portal");
  if ((openingText.match(/\?/g) ?? []).length > 1) failures.push("T1 empilhou mais de uma pergunta principal");
  if (/\b(?:seu nome|seu telefone|seu numero|nome completo)\b/.test(openingText)) failures.push("T1 pediu nome/telefone prematuros (nao configurado no portal)");

  if (!search?.toolsRequested.includes("stock_search")) failures.push("T2 nao chamou stock_search");
  if (!isBrain(search?.responseSource)) failures.push(`T2 source=${search?.responseSource ?? "-"}, esperado brain_*`);
  if (/qual modelo ou tipo/.test(norm(search?.response ?? ""))) failures.push("T2 reperguntou o tipo SUV ja informado");
  if (!/suv|aircross|duster|renegade|2008|kicks|compass|t-cross/.test(norm(search?.response ?? ""))) failures.push("T2 nao apresentou lista de SUVs");

  if (!selection?.selectedVehicleKeyAfter) failures.push("T3 nao selecionou o primeiro veiculo");
  if (!isBrain(selection?.responseSource)) failures.push(`T3 source=${selection?.responseSource ?? "-"}, esperado brain_*`);

  const media = photos?.effects.find((effect) => effect.kind === "send_media");
  if (!media) failures.push("T4 nao enviou fotos");
  if (media?.vehicleKey !== selection?.selectedVehicleKeyAfter) failures.push("T4 enviou fotos de outro veiculo");
  if ((media?.photoCount ?? 0) > 5) failures.push(`T4 enviou ${media?.photoCount} fotos (>5)`);

  if (!pivot?.toolsRequested.includes("stock_search")) failures.push("T5 mudanca de intencao nao buscou Compass 2019");
  if (!/compass\s+2019/.test(norm(pivot?.response ?? ""))) failures.push("T5 nao apresentou Compass 2019");
  if (pivotSelection?.selectedVehicleKeyAfter === selection?.selectedVehicleKeyAfter) failures.push("T6 manteve o veiculo antigo apos selecionar Compass 2019");

  if (visit?.primaryIntent !== "visit") failures.push(`T7 intent=${visit?.primaryIntent ?? "-"}, esperado visit`);
  if (visit?.toolsRequested.some((tool) => tool === "stock_search" || tool === "vehicle_details" || tool === "vehicle_photos_resolve")) failures.push("T7 visita acionou tool comercial");
  // ── T8 "Pra segunda" (só o DIA): P0-A. NÃO pode virar technical_fallback; acolhe o dia; e — endurecimento MISSÃO FINAL —
  //    o texto VISÍVEL NÃO repergunta o DIA (já dado). Pode pedir só o horário.
  if (!/segunda/.test(norm(day?.response ?? "")) && !day?.slotsDelta.some((delta) => delta.slot === "diaHorario")) failures.push("T8 nao acolheu segunda");
  if (day?.terminalSafe) failures.push("T8 degradou (terminalSafe) ao receber so o dia");
  if (asksDay(day?.response ?? "")) failures.push(`T8 REPERGUNTOU o dia ja informado (segunda): "${sanitize(day?.response ?? "")}"`);
  // ── T9 "As 15h" (só o HORÁRIO): P0-A composição. Endurecimento MISSÃO FINAL — exigir CUMULATIVAMENTE:
  //    (a) intent visit; (b) diaHorario com DIA+HORÁRIO; (c) brain_final|retry; (d) zero fallback; (e) reconhece o horário
  //    OU avança (não fica mudo); (f) NÃO repergunta NENHUMA dimensão conhecida (dia nem horário); (g) não volta à
  //    descoberta; (h) não perde o veículo selecionado.
  const diaHorarioAfter = norm(String(time?.slotsDelta.find((delta) => delta.slot === "diaHorario")?.to ?? day?.slotsDelta.find((delta) => delta.slot === "diaHorario")?.to ?? ""));
  if (time?.primaryIntent !== "visit") failures.push(`T9 intent=${time?.primaryIntent ?? "-"}, esperado visit`);
  if (!isBrain(time?.responseSource)) failures.push(`T9 source=${time?.responseSource ?? "-"}, esperado brain_*`);
  if (time?.terminalSafe) failures.push("T9 degradou (terminalSafe/technical_fallback) ao compor o horario");
  if (!(diaHorarioAfter.includes("segunda") && /15/.test(diaHorarioAfter)) && !/15/.test(norm(time?.response ?? ""))) failures.push(`T9 nao compos dia+horario (diaHorario="${diaHorarioAfter}")`);
  if (asksDay(time?.response ?? "")) failures.push(`T9 REPERGUNTOU o dia ja conhecido: "${sanitize(time?.response ?? "")}"`);
  if (asksTime(time?.response ?? "")) failures.push(`T9 REPERGUNTOU o horario que o cliente ACABOU de dar: "${sanitize(time?.response ?? "")}"`);
  if (/qual\s+(?:modelo|tipo|carro)|o que voce (?:procura|busca)/.test(norm(time?.response ?? ""))) failures.push("T9 voltou a descoberta em vez de fechar a visita");
  if (time?.selectedVehicleKeyAfter !== pivotSelection?.selectedVehicleKeyAfter) failures.push("T9 perdeu o Compass ao agendar visita");

  if (human?.primaryIntent !== "request_human") failures.push(`T10 intent=${human?.primaryIntent ?? "-"}, esperado request_human`);
  if (!human?.effects.some((effect) => effect.kind === "handoff")) failures.push("T10 nao planejou handoff");
  if (!human?.effects.some((effect) => effect.kind === "notify_seller")) failures.push("T10 nao planejou notify_seller");
  if (!turns.some((turn) => turn.effects.some((effect) => effect.kind === "crm_write"))) failures.push("jornada nao planejou crm_write");

  for (const turn of turns) {
    if (turn.terminalSafe) failures.push(`T${turn.turnIndex} terminou terminalSafe`);
    if (!turn.promptExactInTurn) failures.push(`T${turn.turnIndex} nao usou prompt integral`);
  }

  const lines = [
    "# F2.52 - Jornada real: abertura, estoque, fotos, mudanca, visita e CRM",
    "",
    `Resultado: **${failures.length === 0 ? "PASS" : "FAIL"}**`,
    "",
    "| T | Lead | Resposta | Intent | Tools | Effects | Source | Slots |",
    "|---:|---|---|---|---|---|---|---|",
    ...turns.map((turn) => `| ${turn.turnIndex} | ${sanitize(turn.leadBlock).replace(/\|/g, "/")} | ${sanitize(turn.response).replace(/\|/g, "/")} | ${turn.primaryIntent ?? "-"} | ${turn.toolsRequested.join(", ") || "-"} | ${turn.effects.map((effect) => `${effect.kind}${effect.photoCount != null ? `[${effect.photoCount}]` : ""}`).join(", ") || "-"} | ${turn.responseSource ?? "-"} | ${turn.slotsDelta.map((delta) => `${delta.slot}=${delta.to}`).join("; ") || "-"} |`),
    "",
    `Chamadas: BRAIN=${stack.brainTransport.count}, COMPOSE=${stack.composeTransport.count}`,
    "",
    "## Falhas",
    ...(failures.length ? failures.map((failure) => `- ${failure}`) : ["- Nenhuma."]),
  ];
  const outDir = join(process.cwd(), "eval", "reports");
  mkdirSync(outDir, { recursive: true });
  const report = join(outDir, `f252-journey-${new Date().toISOString().replace(/[:.]/g, "-")}.md`);
  writeFileSync(report, lines.join("\n"), "utf8");

  for (const turn of turns) {
    console.log(`T${turn.turnIndex} [${turn.responseSource ?? turn.status}] intent=${turn.primaryIntent ?? "-"} tools=${turn.toolsRequested.join(",") || "-"} effects=${turn.effects.map((effect) => effect.kind).join(",") || "-"}`);
    console.log(`  lead: ${sanitize(turn.leadBlock)}`);
    console.log(`  agent: ${sanitize(turn.response)}`);
    if ((turn.policyFeedback ?? []).length > 0) console.log(`  feedback: ${(turn.policyFeedback ?? []).map((item) => sanitize(item)).join(" || ")}`);
    console.log(`  reason: ${turn.reasonCode ?? "-"} steps=${turn.brainSteps}`);
  }
  console.log(`BRAIN=${stack.brainTransport.count} COMPOSE=${stack.composeTransport.count}`);
  console.log(`relatorio: ${report}`);
  if (failures.length) {
    failures.forEach((failure) => console.error(`FALHA: ${failure}`));
    process.exit(1);
  }
  console.log("PASS: jornada completa conduzida pela LLM com estoque, fotos, mudanca, visita, CRM e handoff.");
}

main().catch((error) => { console.error(error); process.exit(1); });
