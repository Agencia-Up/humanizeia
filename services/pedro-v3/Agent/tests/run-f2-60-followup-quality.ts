import type { AgentBrainPort, AgentBrainStep, TurnFrame } from "../src/domain/agent-brain.ts";
import type { ConversationState } from "../src/domain/conversation-state.ts";
import type { SendMessagePlan } from "../src/domain/decision.ts";
import { createInitialState } from "../src/domain/conversation-state.ts";
import { applyEffectOutcome } from "../src/engine/state-reducer.ts";
import { authorFollowupMessageDetailed } from "../src/engine/followup-author.ts";
import { getBrazilChannelTime } from "../src/adapters/llm/openai-agent-brain.ts";
import { invalidBrazilGreeting } from "../src/engine/channel-time.ts";

let ok = 0;
let bad = 0;
function check(name: string, pass: boolean, extra?: string): void {
  if (pass) { ok += 1; console.log(`  OK  ${name}`); }
  else { bad += 1; console.error(`  RED ${name}${extra ? ` — ${extra}` : ""}`); }
}

function final(text: string): AgentBrainStep {
  return {
    kind: "final",
    decision: {
      reasonCode: "followup",
      reasonSummary: "followup",
      confidence: 1,
      responsePlan: { guidance: "", draft: { parts: [{ type: "text", content: text }] } },
      proposedEffects: [], memoryMutations: [], stateMutations: [],
    },
  };
}

class QueueBrain implements AgentBrainPort {
  readonly frames: TurnFrame[] = [];
  constructor(private readonly steps: AgentBrainStep[]) {}
  async proposeNextStep(frame: TurnFrame): Promise<AgentBrainStep> {
    this.frames.push(frame);
    return this.steps.shift() ?? final("Se quiser retomar, e so me chamar.");
  }
}

const TENANT = "11111111-1111-4111-8111-111111111111";
const AGENT = "22222222-2222-4222-8222-222222222222";
const LEAD = "33333333-3333-4333-8333-333333333333";
const NOW = "2026-07-16T00:30:00.000Z";

function state(): ConversationState {
  const s = createInitialState({ conversationId: "wa:f260", tenantId: TENANT, agentId: AGENT, leadId: LEAD, now: NOW });
  s.recentTurns = [{ role: "agent", text: "Voce conhece a nossa loja?", at: "2026-07-15T12:00:00.000Z" }];
  return s;
}

console.log("== F2.60 Follow-up contextual, anti-repeticao e horario Brasil ==");

const t1Brain = new QueueBrain([
  final("Boa tarde! Sou o Carvalho, consultor aqui da loja. Posso ajudar com alguma informacao sobre nossos carros?"),
  final("Conseguiu ver as informacoes que te enviei sobre a loja?"),
  final("Ainda esta por ai?"),
]);
const t1 = await authorFollowupMessageDetailed({ brain: t1Brain, state: state(), stage: 1, turnId: "fu60-t1", now: NOW, portalPromptSha256: "sha" });
check("T1 rejeita saudacao e afirmacao de material nao enviado", t1.text === "Ainda esta por ai?" && t1.attempts === 3);
check("T1 entrega contexto factual de follow-up para a LLM", t1Brain.frames[0]?.conversationContext.followup?.stage === 1
  && t1Brain.frames[0]?.conversationContext.followup?.lastAgentMessage === "Voce conhece a nossa loja?"
  && t1Brain.frames[0]?.conversationContext.followup?.hasVisibleOffer === false);

const t2State = state();
t2State.recentTurns.push({ role: "agent", text: "Voce conseguiu ver os veiculos que te mandei?", at: NOW });
const t2Brain = new QueueBrain([
  final("Voce conseguiu ver os veiculos que te mandei?"),
  final("Se ainda estiver avaliando, posso te ajudar com os detalhes desse carro. Quer continuar por aqui?"),
]);
const t2 = await authorFollowupMessageDetailed({ brain: t2Brain, state: t2State, stage: 2, turnId: "fu60-t2", now: NOW, portalPromptSha256: "sha" });
check("T2 rejeita repeticao da pergunta anterior", t2.text === "Se ainda estiver avaliando, posso te ajudar com os detalhes desse carro. Quer continuar por aqui?" && t2.attempts === 2);

const adState = state();
adState.adContext = {
  adId: "ad-f260",
  source: "facebook",
  sourceUrl: null,
  title: "Fiat Toro 2020",
  body: "",
  greeting: "Oi! Como podemos ajudar?",
  imageUrls: ["https://example.com/toro.jpg"],
  capturedAtTurn: 1,
};
const adBrain = new QueueBrain([
  final("Voce conhece a nossa loja?"),
  final("Quer ver fotos ou mais detalhes da Fiat Toro 2020 do anuncio?"),
]);
const adFollowup = await authorFollowupMessageDetailed({
  brain: adBrain, state: adState, stage: 1, turnId: "fu60-ad", now: NOW, portalPromptSha256: "sha",
});
check("follow-up de anuncio nao repete pergunta institucional e retoma o veiculo", adFollowup.attempts === 2
  && adFollowup.text?.includes("Toro") === true);
check("follow-up entrega anuncio e perguntas recentes como contexto read-only", adBrain.frames[0]?.conversationContext.followup?.adEntry === true
  && adBrain.frames[0]?.conversationContext.followup?.adVehicleLabel?.includes("Toro") === true
  && adBrain.frames[0]?.conversationContext.followup?.recentAgentQuestions.length === 1);

const imageOnlyAdState = state();
imageOnlyAdState.adContext = {
  adId: "ad-f260-image",
  source: "facebook",
  sourceUrl: null,
  title: null,
  body: null,
  greeting: "Oi! Como podemos ajudar?",
  imageUrls: ["https://example.com/car.jpg"],
  capturedAtTurn: 1,
};
const imageOnlyBrain = new QueueBrain([final("Quer saber mais sobre o veiculo do anuncio?")]);
const imageOnlyFollowup = await authorFollowupMessageDetailed({
  brain: imageOnlyBrain, state: imageOnlyAdState, stage: 1, turnId: "fu60-ad-image", now: NOW, portalPromptSha256: "sha",
});
check("anuncio sem modelo textual nao inventa veiculo", imageOnlyFollowup.attempts === 1
  && imageOnlyBrain.frames[0]?.conversationContext.followup?.adEntry === true
  && imageOnlyBrain.frames[0]?.conversationContext.followup?.adVehicleLabel === null);

const t3Brain = new QueueBrain([
  final("Prefiro ser honesto com voce — talvez nao seja o melhor cenario."),
  final("Tudo bem, vou encerrar por aqui para nao te incomodar. Quando quiser retomar, e so me chamar."),
]);
const t3 = await authorFollowupMessageDetailed({ brain: t3Brain, state: t2State, stage: 3, turnId: "fu60-t3", now: NOW, portalPromptSha256: "sha" });
check("T3 rejeita despedida fria e usa porta aberta sem pergunta", t3.text === "Tudo bem, vou encerrar por aqui para nao te incomodar. Quando quiser retomar, e so me chamar." && t3.attempts === 2);

const t3TransferBrain = new QueueBrain([
  final("Entendo que voce deve estar ocupado. Nao vou tomar mais seu tempo. Seu contato ja esta com um dos nossos analistas, que dara continuidade. Obrigado pelo contato."),
]);
const t3Transfer = await authorFollowupMessageDetailed({
  brain: t3TransferBrain, state: state(), stage: 3, turnId: "fu60-t3-transfer", now: NOW,
  portalPromptSha256: "sha", handoffAvailable: true,
});
check("T3 com transferencia disponivel informa continuidade com analista", t3Transfer.attempts === 1
  && t3Transfer.text?.includes("analista") === true
  && t3TransferBrain.frames[0]?.conversationContext.followup?.handoffAvailable === true);

const t3NoTransferBrain = new QueueBrain([
  final("Seu contato ja esta com um dos nossos analistas."),
  final("Entendo que voce deve estar ocupado. Quando quiser retomar, e so me chamar."),
]);
const t3NoTransfer = await authorFollowupMessageDetailed({
  brain: t3NoTransferBrain, state: state(), stage: 3, turnId: "fu60-t3-no-transfer", now: NOW,
  portalPromptSha256: "sha", handoffAvailable: false,
});
check("T3 sem transferencia nao promete analista", t3NoTransfer.attempts === 2
  && t3NoTransfer.text === "Entendo que voce deve estar ocupado. Quando quiser retomar, e so me chamar.");

check("horario Brasil de madrugada UTC e noite local", getBrazilChannelTime("2026-07-16T02:00:00.000Z").period === "noite");
check("meia-noite no Brasil continua noite", getBrazilChannelTime("2026-07-16T03:15:00.000Z").period === "noite");
check("horario Brasil de manha", getBrazilChannelTime("2026-07-15T14:00:00.000Z").period === "manha");
check("horario Brasil de tarde", getBrazilChannelTime("2026-07-15T17:00:00.000Z").period === "tarde");
check("saudacao contraditoria volta para retry factual", invalidBrazilGreeting("Boa tarde!", "2026-07-16T03:15:00.000Z")?.includes("boa noite") === true);

const persisted = state();
persisted.followupCycle = { anchorEffectId: "anchor", anchorAt: "2026-07-15T12:00:00.000Z", sentStages: [], plannedStage: 1, lastSentAt: null };
const effect: SendMessagePlan = {
  kind: "send_message", planId: "followup-message", effectId: "followup:anchor:1:followup-message", order: 1, onSuccess: [
    { op: "mark_followup_sent", effectId: "followup:anchor:1:followup-message", anchorEffectId: "anchor", stage: 1, sentAt: NOW },
    { op: "append_assistant_turn", effectId: "followup:anchor:1:followup-message", turn: { role: "agent", text: t1.text!, at: NOW } },
  ],
};
const committed = applyEffectOutcome(persisted, effect, {
  status: "succeeded", effectId: effect.effectId, receipt: { effectId: effect.effectId, level: "accepted", at: NOW },
});
check("follow-up enviado entra no historico para orientar T2", committed.ok && committed.next.recentTurns.at(-1)?.text === t1.text);

console.log(`\n== F2.60: ${ok} OK | ${bad} FALHA ==`);
if (bad > 0) process.exit(1);
