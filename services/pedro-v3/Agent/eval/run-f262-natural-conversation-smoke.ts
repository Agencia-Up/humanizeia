// Smoke real barato da camada conversacional N8N-like.
// Efeitos externos ficam simulados no harness; uma conversa curta avalia
// continuidade, papeis semanticos, repeticao e conducao antes de qualquer push.
//
// PEDRO_V3_REAL_EVAL=1 EVAL_USE_PLATFORM_KEY=1 npx tsx eval/run-f262-natural-conversation-smoke.ts
import { readFileSync } from "node:fs";
import { RealClock } from "../src/runtime/real-clock.ts";
import { buildRealAssembly, loadServiceEnv, sanitize } from "./real-harness.ts";
import { buildCentralStack, runCentralConversation } from "./central-real-harness.ts";
import type { CentralTurnCapture } from "./central-assertions.ts";

const norm = (text: string): string => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

function questions(text: string): string[] {
  return text.split("?").slice(0, -1).map((part) => norm(part.split(/[.!]/).at(-1) ?? "")).filter(Boolean);
}

function listedVehicleLabels(text: string): string[] {
  return [...text.matchAll(/^\s*\d+\.\s+(.+?)\s+-\s+R\$/gim)].map((match) => norm(match[1] ?? ""));
}

function deterministicViolations(turns: readonly CentralTurnCapture[], stockOnly = false): string[] {
  const out: string[] = [];
  const allResponses = turns.map((turn) => turn.response);
  const nameUses = allResponses.reduce((sum, response) => sum + (norm(response).match(/\bveronica\b/g)?.length ?? 0), 0);
  if (nameUses > 2) out.push(`nome usado ${nameUses} vezes em ${turns.length} respostas`);
  for (const turn of turns) {
    if (turn.status !== "committed") out.push(`T${turn.turnIndex}: status=${turn.status}`);
    if (turn.terminalSafe || turn.responseSource === "technical_fallback") out.push(`T${turn.turnIndex}: fallback tecnico`);
    if ((turn.response.match(/\?/g) ?? []).length > 1) out.push(`T${turn.turnIndex}: mais de uma pergunta`);
    if (!stockOnly && turn.turnIndex <= 4 && turn.toolsRequested.includes("stock_search")) out.push(`T${turn.turnIndex}: carro de troca virou busca de estoque`);
  }
  const t2 = turns.find((turn) => turn.turnIndex === 2);
  if (t2 && /qual.*(?:km|quilometr)|informe.*(?:km|quilometr)/i.test(norm(t2.response))) out.push("T2: pediu novamente a quilometragem ja informada");
  const seen = new Set<string>();
  for (const response of allResponses) {
    for (const question of questions(response)) {
      if (question.length >= 18 && seen.has(question)) out.push(`pergunta repetida: ${question}`);
      seen.add(question);
    }
  }
  const t5 = turns.find((turn) => turn.turnIndex === (stockOnly ? 1 : 5));
  if (t5 && !t5.toolsRequested.includes("stock_search")) out.push("T5: mudanca explicita para SUV nao consultou estoque");
  const t6 = turns.find((turn) => turn.turnIndex === (stockOnly ? 2 : 6));
  if (t5 && t6) {
    const before = listedVehicleLabels(t5.response);
    const after = listedVehicleLabels(t6.response);
    if (before.length > 0 && before.length === after.length && before.every((label, index) => label === after[index])) {
      out.push("T6: repetiu integralmente a lista ja visivel");
    }
  }
  return out;
}

type JudgeResult = {
  readonly continuity?: number;
  readonly naturalness?: number;
  readonly roleBinding?: number;
  readonly progression?: number;
  readonly repetitionControl?: number;
  readonly critical?: boolean;
  readonly notes?: string;
};

async function judge(assembly: Awaited<ReturnType<typeof buildRealAssembly>>, turns: readonly CentralTurnCapture[]): Promise<JudgeResult> {
  const transcript = turns.map((turn) => `T${turn.turnIndex} LEAD: ${sanitize(turn.leadBlock)}\nT${turn.turnIndex} AGENTE: ${sanitize(turn.response)}`).join("\n");
  const system = `Voce audita uma conversa curta de venda de carros no WhatsApp. Avalie apenas qualidade conversacional global, nao uma frase especifica. Seja rigoroso: o agente deve entender a fala atual usando o historico, distinguir carro que o lead possui do carro que procura, nao repetir pergunta respondida, nao usar o nome como prefixo automatico, tolerar escrita informal e conduzir um passo natural sem parecer formulario. Marque critical=true se houver perda de contexto, repeticao importante, papel semantico trocado ou conducao robotica grave. Responda somente JSON com continuity, naturalness, roleBinding, progression, repetitionControl (0-100), critical e notes.`;
  const user = `Transcricao:\n${transcript}`;
  const raw = await assembly.chat(system, user);
  try { return JSON.parse(raw) as JudgeResult; } catch { return { critical: true, notes: "judge_json_invalid" }; }
}

async function main(): Promise<void> {
  if (process.env.PEDRO_V3_REAL_EVAL !== "1") throw new Error("BLOQUEADO: defina PEDRO_V3_REAL_EVAL=1");
  loadServiceEnv();
  const assembly = await buildRealAssembly(new RealClock());
  const promptOverride = process.env.F262_PORTAL_PROMPT_FILE
    ? readFileSync(process.env.F262_PORTAL_PROMPT_FILE, "utf8")
    : undefined;
  const stack = buildCentralStack(assembly, promptOverride);
  const fullScenario = [
    ["Meu nome e Veronica. Tenho um Sonic 2014 automatico para dar de troca"],
    ["A quilometragem e", "186km"],
    ["Sim"],
    ["Quero saber da avaliacao"],
    ["Tambem queria ver opcoes de SUV"],
    ["Ate 100 mil"],
  ];
  const stockOnly = process.env.F262_STOCK_ONLY === "1";
  const scenario = stockOnly ? [["Quero ver opcoes de SUV"], ["Ate 100 mil"]] : fullScenario;
  const turnLimit = Math.max(1, Math.min(scenario.length, Number(process.env.F262_TURN_LIMIT ?? scenario.length)));
  const diagnosticOnly = process.env.F262_DIAGNOSTIC_ONLY === "1";
  const turns = await runCentralConversation(assembly, stack, `f262-natural-${Date.now()}`, scenario.slice(0, turnLimit), {
    singleAuthor: true,
    llmFirst: true,
    maxLlmCalls: diagnosticOnly ? 10 : 32,
    crmLeadId: "lead-f262-conversation-quality",
    handoff: { enabled: true, available: true },
  });

  for (const turn of turns) {
    console.log(`T${turn.turnIndex} lead=${sanitize(turn.leadBlock)}`);
    console.log(`  agent=${sanitize(turn.response)}`);
    console.log(`  intent=${turn.primaryIntent ?? "-"} tools=${turn.toolsRequested.join(",") || "-"} source=${turn.responseSource ?? "-"}`);
    if ((turn.policyFeedback?.length ?? 0) > 0) console.log(`  feedback=${turn.policyFeedback!.join(" | ")}`);
  }
  const deterministic = deterministicViolations(turns, stockOnly);
  if (diagnosticOnly) {
    console.log(`diagnostic calls=${stack.brainTransport.count} promptTokens=${stack.brainTransport.calls.reduce((sum, call) => sum + (call.promptTokens ?? 0), 0)}`);
    return;
  }
  const judged = await judge(assembly, turns);
  const scores = [judged.continuity, judged.naturalness, judged.roleBinding, judged.progression, judged.repetitionControl]
    .filter((score): score is number => typeof score === "number");
  const minScore = scores.length === 5 ? Math.min(...scores) : 0;
  console.log(`judge=${JSON.stringify(judged)}`);
  console.log(`calls=${stack.brainTransport.count} promptTokens=${stack.brainTransport.calls.reduce((sum, call) => sum + (call.promptTokens ?? 0), 0)}`);
  if (deterministic.length > 0 || judged.critical === true || minScore < 80) {
    for (const violation of deterministic) console.log(`RED ${violation}`);
    throw new Error(`F2.62_FAIL deterministic=${deterministic.length} critical=${judged.critical === true} minScore=${minScore}`);
  }
  console.log(`F2.62 PASS minScore=${minScore}`);
}

main().catch((error) => {
  console.error(sanitize(error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
});
