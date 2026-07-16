// Smoke real curto: uma conversa de 10 turnos com foco em pagamento, troca,
// conhecimento semântico, fotos e agendamento. Sem dispatch externo.
// PEDRO_V3_REAL_EVAL=1 EVAL_USE_PLATFORM_KEY=1 npm run smoke:knowledge:real
import { RealClock } from "../src/runtime/real-clock.ts";
import { buildRealAssembly, loadServiceEnv, sanitize, PILOT_MODEL } from "./real-harness.ts";
import { buildCentralStack, runCentralConversation } from "./central-real-harness.ts";
import { runCentralAssertions } from "./central-assertions.ts";

const steps: readonly (readonly string[])[] = [
  ["Boa noite"],
  ["Quero ver um SUV até 90 mil"],
  ["Tenho uma Hilux 2020 com 78 mil km para dar de troca"],
  ["Tenho uma carta de consórcio contemplada de 53 mil"],
  ["Como funciona usar essa carta como pagamento?"],
  ["Me manda a foto do segundo"],
  ["E se eu quiser financiar, qual parcela eu consigo?"],
  ["Quero visitar na segunda"],
  ["Às 15h"],
  ["Vou falar com um vendedor"],
];

function contains(text: string, pattern: RegExp): boolean { return pattern.test(text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()); }

async function main(): Promise<void> {
  if (process.env.PEDRO_V3_REAL_EVAL !== "1") throw new Error("BLOQUEADO: defina PEDRO_V3_REAL_EVAL=1");
  loadServiceEnv();
  const assembly = await buildRealAssembly(new RealClock());
  const stack = buildCentralStack(assembly);
  const requestedTurns = Number(process.env.REAL_KNOWLEDGE_TURNS ?? steps.length);
  const selectedSteps = steps.slice(0, Number.isFinite(requestedTurns) ? Math.max(1, Math.min(steps.length, Math.trunc(requestedTurns))) : steps.length);
  const turns = await runCentralConversation(assembly, stack, `real-knowledge-${Date.now().toString(36)}`, selectedSteps, {
    maxLlmCalls: Number(process.env.REAL_KNOWLEDGE_MAX_LLM_CALLS ?? "30"),
    singleAuthor: true,
    llmFirst: true,
    crmLeadId: "00000000-0000-4000-8000-00000000d1a1",
    handoff: { enabled: true, available: true },
  });

  let failures = 0;
  const qualityGate = runCentralAssertions(turns);
  for (const violation of qualityGate.violations.filter((item) => item.severity === "critical")) {
    failures += 1;
    console.log(`FAIL T${violation.turnIndex} ${violation.code}: ${violation.detail}`);
  }
  console.log(`== Pedro v3 smoke real semântico == modelo=${PILOT_MODEL} turnos=${turns.length}`);
  for (const turn of turns) {
    const tools = turn.toolsRequested.join(",") || "-";
    console.log(`T${turn.turnIndex} lead=${sanitize(turn.leadBlock)}`);
    console.log(`  agent=${sanitize(turn.response).slice(0, 360)}`);
    console.log(`  intent=${turn.primaryIntent ?? "-"} tools=${tools} observations=${turn.observations.map((o) => o.tool).join(",") || "-"} source=${turn.responseSource ?? "-"}`);
    if (turn.status !== "committed") { failures++; console.log(`  FAIL status=${turn.status}`); }
    if (turn.terminalSafe || turn.responseSource === "technical_fallback") { failures++; console.log("  FAIL fallback/terminal_safe visível"); }
    if (contains(turn.response, /prefiro ser honesto|talvez nao seja o melhor cenario/)) { failures++; console.log("  FAIL despedida antiga"); }
  }

  const trade = turns[2];
  const payment = turns[3];
  const paymentExplain = turns[4];
  const visitDay = turns[7];
  const visitTime = turns[8];
  if (trade?.toolsRequested.includes("stock_search")) { failures++; console.log("FAIL troca acionou stock_search"); }
  const paymentStockExecuted = [payment, paymentExplain].some((turn) => turn?.observations.some((observation) => observation.ok && observation.tool === "stock_search"));
  if (paymentStockExecuted) { failures++; console.log("FAIL pagamento executou stock_search"); }
  if (payment && contains(payment.response, /seu nome|qual e o seu nome|cpf/)) { failures++; console.log("FAIL pagamento pediu identidade"); }
  if (visitDay?.toolsRequested.includes("stock_search") || visitTime?.toolsRequested.includes("stock_search")) { failures++; console.log("FAIL agendamento acionou stock_search"); }
  const knowledgeCalls = turns.flatMap((turn) => turn.toolsRequested).filter((tool) => tool === "knowledge_search").length;
  console.log(`knowledge_search_calls=${knowledgeCalls}`);
  console.log(`RESULTADO=${failures === 0 ? "PASS" : `FAIL (${failures})`}`);
  console.log(`llm_calls=${stack.brainTransport.count + stack.composeTransport.count}`);
  if (failures > 0) process.exitCode = 1;
}

main().catch((error) => { console.error(`ERRO FATAL: ${sanitize(error instanceof Error ? error.message : String(error))}`); process.exitCode = 1; });
