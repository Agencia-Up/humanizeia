// Cheap real-LLM regression for current-turn authority.
// PEDRO_V3_REAL_EVAL=1 EVAL_USE_PLATFORM_KEY=1 F251_MAX_LLM_CALLS=20 npx tsx eval/run-f251-turn-authority-real-smoke.ts
import { RealClock } from "../src/runtime/real-clock.ts";
import { loadServiceEnv, buildRealAssembly, sanitize } from "./real-harness.ts";
import { buildCentralStack, runCentralConversation } from "./central-real-harness.ts";

const STEPS = [
  ["quero SUV automatico"],
  ["gostei do primeiro"],
  ["sei sim", "quero agendar visita", "pra segunda"],
] as const;

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
    `wa:f251-authority-${Date.now().toString(36)}`,
    STEPS,
    { maxLlmCalls: Number(process.env.F251_MAX_LLM_CALLS ?? "20"), singleAuthor: true, llmFirst: true },
  );

  const failures: string[] = [];
  const selection = turns[1];
  const visit = turns[2];
  const norm = (value: string): string => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (!selection?.selectedVehicleKeyAfter) failures.push("T2 nao selecionou o primeiro veiculo ofertado");
  if (visit?.primaryIntent !== "visit") failures.push(`T3 intent=${visit?.primaryIntent ?? "ausente"}, esperado visit`);
  if (!/brain_(?:final|retry)/.test(visit?.responseSource ?? "")) failures.push(`T3 source=${visit?.responseSource ?? "ausente"}, esperado autoria LLM`);
  const visitText = norm(visit?.response ?? "");
  if (!visitText.includes("segunda") || (!visitText.includes("visit") && !/horario|hora/.test(visitText))) failures.push("T3 nao acolheu o agendamento na segunda");
  if (visit?.selectedVehicleKeyAfter !== selection?.selectedVehicleKeyAfter) failures.push("T3 trocou o foco do veiculo ao interpretar segunda como ordinal");
  if ((visit?.toolsRequested ?? []).some((tool) => tool === "stock_search" || tool === "vehicle_details" || tool === "vehicle_photos_resolve")) failures.push(`T3 acionou tool comercial: ${(visit?.toolsRequested ?? []).join(",")}`);
  if (/\b(?:(?:vou|irei)\s+agendar|agendo\s+(?:a\s+|sua\s+)?visita)\b/i.test(norm(visit?.response ?? "")) && !(visit?.effects ?? []).some((effect) => effect.kind === "schedule_visit" || effect.kind === "handoff")) failures.push("T3 prometeu agendamento sem efeito executavel");
  if (!/horario|hora/i.test(norm(visit?.response ?? ""))) failures.push("T3 recebeu o dia, mas nao pediu o horario da visita");
  if (visit?.terminalSafe) failures.push("T3 terminou degradado/terminalSafe");

  for (const turn of turns) {
    console.log(`T${turn.turnIndex} [${turn.responseSource ?? turn.status}] intent=${turn.primaryIntent ?? "-"} selected=${turn.selectedVehicleKeyAfter ?? "-"} tools=${turn.toolsRequested.join(",") || "-"}`);
    console.log(`  lead: ${sanitize(turn.leadBlock)}`);
    console.log(`  agent: ${sanitize(turn.response)}`);
    if ((turn.policyFeedback ?? []).length > 0) console.log(`  feedback: ${(turn.policyFeedback ?? []).map((item) => sanitize(item)).join(" || ")}`);
  }
  console.log(`BRAIN=${stack.brainTransport.count} COMPOSE=${stack.composeTransport.count}`);
  if (failures.length > 0) {
    failures.forEach((failure) => console.error(`FALHA: ${failure}`));
    process.exit(1);
  }
  console.log("PASS: o ato atual de visita venceu foco/memoria e a LLM conduziu o turno.");
}

main().catch((error) => { console.error(error); process.exit(1); });
