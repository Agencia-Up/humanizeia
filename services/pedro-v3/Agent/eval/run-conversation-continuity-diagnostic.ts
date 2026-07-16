// Diagnóstico estrutural da continuidade do Pedro v3.
// Executa o central_active real e imprime medidas do payload do brain por turno:
// histórico, bloco atual, memória, fatos e tamanho. Não imprime prompt integral,
// histórico integral, chave ou PII.
import { RealClock } from "../src/runtime/real-clock.ts";
import { buildRealAssembly, loadServiceEnv, sanitize } from "./real-harness.ts";
import { buildCentralStack, runCentralConversation } from "./central-real-harness.ts";
import type { CentralTurnCapture } from "./central-assertions.ts";
import type { LlmRequestAudit } from "./real-harness.ts";

function printAudit(a: LlmRequestAudit): void {
  const tail = a.user.transcriptTail.map((x) => `${x.role}:${x.chars}c#${x.sha}`).join(",") || "-";
  console.log(`   brain#${a.seq} payload=${a.bodyChars}c system=${a.systemChars}c user=${a.userChars}c model=${a.model ?? "-"}`);
  console.log(`   current: ${sanitize(a.user.leadBlock)} | instruction=${sanitize(a.user.instruction).slice(0, 180)}`);
  console.log(`   transcript: n=${a.user.transcriptCount} tail=${tail}`);
  console.log(`   memory: keys=${a.user.workingMemoryKeys.join(",") || "-"} pending=${a.user.pendingAgentQuestion ?? "-"}`);
  console.log(`   context: keys=${a.user.contextKeys.join(",") || "-"} lastAgent=${a.user.lastAgentMessage ? `${a.user.lastAgentMessage.chars}c#${a.user.lastAgentMessage.sha}` : "-"}`);
  console.log(`   facts: keys=${a.user.currentFactsKeys.join(",") || "-"} expected=${a.user.expectedAnswer ?? "-"} extracted=${a.user.extractedFacts.join(",") || "-"} offer=${a.user.offerReference ?? "-"}`);
  console.log(`   signals=${a.user.signalKeys.join(",") || "-"} advisories=${a.user.advisories.length} observations=${a.user.observationTools.join(",") || "-"}`);
}

function printCase(name: string, turns: CentralTurnCapture[]): void {
  console.log(`\n==== ${name} ==== `);
  for (const t of turns) {
    console.log(`T${t.turnIndex} source=${t.responseSource ?? t.status} intent=${t.primaryIntent ?? "-"} tools=${t.toolsRequested.join(",") || "-"} pending=${t.pendingAgentQuestion ?? "-"}`);
    console.log(`   lead:  ${sanitize(t.leadBlock)}`);
    console.log(`   agent: ${sanitize(t.response).slice(0, 240)}`);
    for (const audit of t.llmRequestAudits ?? []) printAudit(audit);
  }
}

async function main(): Promise<void> {
  if (process.env.PEDRO_V3_REAL_EVAL !== "1") {
    console.error("BLOQUEADO: defina PEDRO_V3_REAL_EVAL=1.");
    process.exit(2);
  }
  loadServiceEnv();
  const assembly = await buildRealAssembly(new RealClock());
  const maxLlmCalls = Number(process.env.CONTINUITY_DIAG_MAX_LLM_CALLS ?? "24");

  const cases: { name: string; steps: readonly (readonly string[])[]; id: string }[] = [
    {
      name: "opções -> foto (continuidade de oferta)",
      id: `wa:diag-options-${Date.now().toString(36)}`,
      steps: [["Boa tarde"], ["Quero ver as opções de carro que vocês têm"], ["Me manda a foto do primeiro"]],
    },
    {
      name: "troca fragmentada (bloco lógico)",
      id: `wa:diag-fragments-${Date.now().toString(36)}`,
      steps: [["Boa tarde"], ["Quero dar um carro de troca"], ["Tenho", "uma Hilux", "2020", "78km"]],
    },
  ];

  for (const item of cases) {
    const stack = buildCentralStack(assembly);
    const turns = await runCentralConversation(assembly, stack, item.id, item.steps, {
      maxLlmCalls,
      singleAuthor: true,
      llmFirst: true,
      crmLeadId: "00000000-0000-4000-8000-00000000d1a1",
    });
    printCase(item.name, turns);
    console.log(`calls: brain=${stack.brainTransport.count} compose=${stack.composeTransport.count}`);
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
