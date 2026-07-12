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
  const openingText = norm(opening?.response ?? "");
  if (!isBrain(opening?.responseSource)) failures.push(`T1 source=${opening?.responseSource ?? "-"}, esperado brain_*`);
  if (!/\b(?:eu sou|me chamo|aqui e|sou o|sou a)\b/.test(openingText)) failures.push("T1 nao se apresentou");
  if (!/modelo|tipo|suv|sedan|hatch|picape|faixa/.test(openingText)) failures.push("T1 nao fez descoberta comercial");

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
  if (!/segunda/.test(norm(day?.response ?? "")) && !day?.slotsDelta.some((delta) => delta.slot === "diaHorario")) failures.push("T8 nao acolheu segunda");
  if (!time?.slotsDelta.some((delta) => delta.slot === "diaHorario") && !/15/.test(norm(time?.response ?? ""))) failures.push("T9 nao registrou/acolheu 15h");
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
