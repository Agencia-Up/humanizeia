import { RealClock } from "../src/runtime/real-clock.ts";
import { loadServiceEnv, buildRealAssembly, sanitize } from "./real-harness.ts";
import { buildCentralStack } from "./central-real-harness.ts";
import { createInitialState } from "../src/domain/conversation-state.ts";
import { authorFollowupMessageDetailed } from "../src/engine/followup-author.ts";

async function main(): Promise<void> {
  if (process.env.PEDRO_V3_REAL_EVAL !== "1") { console.error("BLOQUEADO: defina PEDRO_V3_REAL_EVAL=1."); process.exit(2); }
  loadServiceEnv();
  const clock = new RealClock();
  const assembly = await buildRealAssembly(clock);
  const stack = buildCentralStack(assembly);
  const now = clock.now();
  const state = createInitialState({
    conversationId: "wa:followup-quality-real",
    tenantId: assembly.ref.tenantId,
    agentId: assembly.ref.agentId,
    leadId: null,
    now,
  });
  state.recentTurns = [
    { role: "lead", text: "Quero ver as opções de carro que vocês têm", at: now },
    { role: "agent", text: "Aqui estão algumas opções disponíveis para você. Qual delas chamou sua atenção?", at: now },
  ];
  const results: string[] = [];
  for (const stage of [1, 2, 3] as const) {
    const authored = await authorFollowupMessageDetailed({
      brain: stack.brain,
      state,
      stage,
      turnId: `real-followup-${stage}`,
      now,
      portalPromptSha256: stack.brain.promptSha256,
    });
    if (!authored.text) throw new Error(`FOLLOWUP_T${stage}_FAILED:${authored.reason}`);
    results.push(`T${stage} attempts=${authored.attempts}: ${sanitize(authored.text)}`);
    state.recentTurns.push({ role: "agent", text: authored.text, at: now });
  }
  console.log(results.join("\n"));
}

main().catch((error) => { console.error(String(error)); process.exit(1); });
