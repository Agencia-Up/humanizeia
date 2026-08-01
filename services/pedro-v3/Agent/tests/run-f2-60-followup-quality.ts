import type { AgentBrainPort, AgentBrainStep, TurnFrame, TurnUnderstanding } from "../src/domain/agent-brain.ts";
import type { ConversationState } from "../src/domain/conversation-state.ts";
import type { ClaimExtractor, ResponsePart, SendMessagePlan } from "../src/domain/decision.ts";
import { createInitialState } from "../src/domain/conversation-state.ts";
import { applyEffectOutcome } from "../src/engine/state-reducer.ts";
import { authorFollowupMessageDetailed } from "../src/engine/followup-author.ts";
import { buildFollowupBaseDecision } from "../src/engine/followup-plan.ts";
import { resolveTurnTarget } from "../src/engine/turn-understanding.ts";
import { getBrazilChannelTime } from "../src/adapters/llm/openai-agent-brain.ts";
import { invalidBrazilGreeting } from "../src/engine/channel-time.ts";

let ok = 0;
let bad = 0;
function check(name: string, pass: boolean, extra?: string): void {
  if (pass) { ok += 1; console.log(`  OK  ${name}`); }
  else { bad += 1; console.error(`  RED ${name}${extra ? ` — ${extra}` : ""}`); }
}

function finalParts(parts: ResponsePart[]): AgentBrainStep {
  return {
    kind: "final",
    decision: {
      reasonCode: "followup",
      reasonSummary: "followup",
      confidence: 1,
      responsePlan: { guidance: "", draft: { parts } },
      proposedEffects: [], memoryMutations: [], stateMutations: [],
    },
  };
}

function final(text: string): AgentBrainStep {
  return finalParts([{ type: "text", content: text }]);
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

// Incidente real WA (30/07): T1 e T2 publicaram a mesma ficha declarativa do
// up! Cross, sem pergunta. O contrato antigo comparava apenas perguntas e nao
// enxergava a duplicacao integral. A engine nao escolhe a nova abordagem: ela
// apenas recusa a copia e devolve a autoria para a LLM.
const duplicateMessageState = state();
const duplicatedVehicleMessage = "Sobre o Volkswagen up! Cross MC 2017, ele esta com 136.711 km rodados, cambio manual e e flex. O preco e R$ 59.900. Se quiser, posso ajudar com mais informacoes ou tirar duvidas.";
duplicateMessageState.recentTurns = [
  { role: "lead", text: "Quero saber mais sobre o up", at: "2026-07-15T12:00:00.000Z" },
  { role: "agent", text: duplicatedVehicleMessage, at: "2026-07-15T12:05:00.000Z" },
];
const duplicateMessageBrain = new QueueBrain([
  final(duplicatedVehicleMessage.toUpperCase()),
  final("Se o up! Cross ainda fizer sentido para voce, sigo por aqui para ajudar."),
]);
const duplicateMessage = await authorFollowupMessageDetailed({
  brain: duplicateMessageBrain, state: duplicateMessageState, stage: 2,
  turnId: "fu60-duplicate-message", now: NOW, portalPromptSha256: "sha",
});
check("T2 rejeita mensagem declarativa integralmente repetida", duplicateMessage.attempts === 2
  && duplicateMessage.text === "Se o up! Cross ainda fizer sentido para voce, sigo por aqui para ajudar.");
check("retry de duplicacao devolve autoria para a LLM sem texto pronto da engine",
  duplicateMessageBrain.frames[1]?.block.includes("repete uma mensagem ja enviada") === true);

const duplicateOnlyBrain = new QueueBrain([final(duplicatedVehicleMessage), final(duplicatedVehicleMessage)]);
const duplicateOnly = await authorFollowupMessageDetailed({
  brain: duplicateOnlyBrain, state: duplicateMessageState, stage: 2,
  turnId: "fu60-duplicate-only", now: NOW, portalPromptSha256: "sha", maxAttempts: 2,
});
check("nenhuma copia e publicada quando a LLM insiste na duplicacao", duplicateOnly.text === null
  && duplicateOnly.reason === "duplicate_message" && duplicateOnly.attempts === 2);

const paraphraseState = state();
paraphraseState.recentTurns = [
  { role: "agent", text: "Voce ainda quer ver os detalhes desse Equinox?", at: NOW },
];
const paraphraseBrain = new QueueBrain([
  final("Ainda gostaria de ver mais detalhes do Equinox?"),
  final("Quer que eu envie as fotos do Equinox?"),
]);
const paraphrase = await authorFollowupMessageDetailed({
  brain: paraphraseBrain, state: paraphraseState, stage: 2, turnId: "fu60-paraphrase", now: NOW, portalPromptSha256: "sha",
});
check("T2 rejeita a mesma pergunta reformulada sem bloquear assunto novo", paraphrase.attempts === 2
  && paraphrase.text === "Quer que eu envie as fotos do Equinox?");

// Incidente real Icom (31/07): T1 "o que achou?" e T2 "ficou alguma
// duvida?" cobravam a mesma reacao com palavras diferentes. O validador so
// identifica a repeticao; a proxima acao e o texto continuam sendo da LLM.
const screenshotFollowupState = state();
screenshotFollowupState.recentTurns = [
  { role: "lead", text: "Qual a quilometragem?", at: "2026-07-31T18:49:00.000Z" },
  { role: "agent", text: "O Nissan Kicks Exclusive 2022 esta com 104 mil km rodados e e branco.", at: "2026-07-31T18:50:00.000Z" },
  { role: "agent", text: "O que achou do Nissan Kicks 2022 que te falei?", at: "2026-07-31T18:55:00.000Z" },
];
const screenshotFollowupBrain = new QueueBrain([
  final("Ficou alguma duvida sobre o Nissan Kicks 2022 que te falei?"),
  final("Quer que eu te mostre as fotos disponiveis desse Nissan Kicks?"),
]);
const screenshotFollowup = await authorFollowupMessageDetailed({
  brain: screenshotFollowupBrain,
  state: screenshotFollowupState,
  stage: 2,
  turnId: "fu60-screenshot-regression",
  now: NOW,
  portalPromptSha256: "sha",
});
check("T2 troca o objetivo da retomada em vez de parafrasear o T1", screenshotFollowup.attempts === 2
  && screenshotFollowup.text === "Quer que eu te mostre as fotos disponiveis desse Nissan Kicks?");
check("retry orienta por criterio sem escrever a resposta comercial", screenshotFollowupBrain.frames[1]?.block.includes("proxima acao concreta") === true
  && screenshotFollowupBrain.frames[1]?.block.includes("Quer que eu te mostre as fotos") === false);
check("frame proibe inventar conservacao para criar gancho", screenshotFollowupBrain.frames[0]?.block.includes("Nunca invente conservacao") === true);

// Incidente real WA (01/08, depois do primeiro fix de fotos): o follow-up
// ofereceu fotos da Meriva, mas persistiu apenas a frase. No turno seguinte,
// "Sim" encontrou Meriva e HB20 aterrados, perdeu o alvo e terminou em
// technical_fallback sem executar vehicle_photos_resolve. O contrato correto
// preserva a escolha que a propria LLM fez no follow-up como foco apresentado,
// sem transformar essa escolha em selecao explicita do lead.
const followupPhotoState = state();
followupPhotoState.groundedVehicles = [
  { vehicleKey: "revendamais:8241227", marca: "Chevrolet", modelo: "Meriva", versao: null, ano: 2012, referenceable: true },
  { vehicleKey: "revendamais:hb20", marca: "Hyundai", modelo: "HB20", versao: null, ano: 2017, referenceable: true },
];
followupPhotoState.vehicleContext.selected = { kind: "vehicle", key: "revendamais:hb20", label: "Hyundai HB20 2017" };
const followupPhotoBrain = new QueueBrain([finalParts([
  { type: "text", content: "Quer que eu te envie fotos do " },
  { type: "vehicle_ref", vehicleKey: "revendamais:8241227", field: "marca" },
  { type: "text", content: " " },
  { type: "vehicle_ref", vehicleKey: "revendamais:8241227", field: "modelo" },
  { type: "text", content: " " },
  { type: "vehicle_ref", vehicleKey: "revendamais:8241227", field: "ano" },
  { type: "text", content: " para voce avaliar melhor?" },
])]);
const followupPhoto = await authorFollowupMessageDetailed({
  brain: followupPhotoBrain,
  state: followupPhotoState,
  stage: 1,
  turnId: "fu60-photo-target",
  now: NOW,
  portalPromptSha256: "sha",
});
check("follow-up expoe todos os veiculos aterrados sem escolher por contagem",
  followupPhotoBrain.frames[0]?.conversationContext.followup?.groundedVehicles.length === 2);
check("LLM pode oferecer fotos com identidade estruturada da Meriva",
  followupPhoto.text === "Quer que eu te envie fotos do Chevrolet Meriva 2012 para voce avaliar melhor?");
check("autoria do follow-up devolve a vehicleKey exata que apresentou",
  followupPhoto.presentedVehicle?.key === "revendamais:8241227");

const followupPhotoDecision = buildFollowupBaseDecision({
  turnId: "fu60-photo-target",
  stage: 1,
  anchorEffectId: "anchor-photo-target",
  now: NOW,
  text: followupPhoto.text,
  presentedVehicle: followupPhoto.presentedVehicle,
});
const followupPhotoPlan = followupPhotoDecision.effectPlan[0] as SendMessagePlan;
check("plano persiste o foco apresentado somente junto do envio",
  followupPhotoPlan.onSuccess.some((mutation) => mutation.op === "set_presented_vehicle_focus"
    && mutation.vehicle.key === "revendamais:8241227"));
const followupPhotoCommitted = applyEffectOutcome(followupPhotoState, followupPhotoPlan, {
  status: "succeeded",
  effectId: followupPhotoPlan.effectId,
  receipt: { effectId: followupPhotoPlan.effectId, level: "delivered", at: NOW },
});
check("entrega grava Meriva como apresentada sem apagar HB20 selecionado", followupPhotoCommitted.ok
  && followupPhotoCommitted.next.vehicleContext.focus?.key === "revendamais:8241227"
  && followupPhotoCommitted.next.vehicleContext.selected?.key === "revendamais:hb20");

const requestPhotosUnderstanding: TurnUnderstanding = {
  primaryIntent: "request_photos",
  requestedCapabilities: ["send_photos"],
  subject: "selected_vehicle",
  subjectValue: null,
  subjectSource: "memory",
  evidence: [{ capability: "send_photos", quote: "Sim" }],
  isTopicChange: false,
  answeredLeadQuestions: [],
  policyDecision: null,
};
const noClaims: ClaimExtractor = { extractClaims: () => [] };
const knownPhotoVehicles = new Map([
  ["revendamais:8241227", { marca: "Chevrolet", modelo: "Meriva", ano: 2012 }],
  ["revendamais:hb20", { marca: "Hyundai", modelo: "HB20", ano: 2017 }],
]);
if (!followupPhotoCommitted.ok) throw new Error("fixture de follow-up nao foi persistida");
const acceptedPhotoTarget = resolveTurnTarget({
  understanding: requestPhotosUnderstanding,
  leadMessage: "Sim",
  state: followupPhotoCommitted.next,
  claimExtractor: noClaims,
  knownModels: knownPhotoVehicles,
});
check("'Sim' aceita a oferta de fotos da Meriva, nao o veiculo selecionado antigo",
  acceptedPhotoTarget.kind === "resolved"
    && acceptedPhotoTarget.vehicleKey === "revendamais:8241227"
    && acceptedPhotoTarget.source === "carryover_presented");
const directPhotoTarget = resolveTurnTarget({
  understanding: { ...requestPhotosUnderstanding, evidence: [{ capability: "send_photos", quote: "manda fotos dele" }] },
  leadMessage: "manda fotos dele",
  state: followupPhotoCommitted.next,
  claimExtractor: noClaims,
  knownModels: knownPhotoVehicles,
});
check("pedido direto de fotos tambem usa o ultimo veiculo apresentado",
  directPhotoTarget.kind === "resolved"
    && directPhotoTarget.vehicleKey === "revendamais:8241227"
    && directPhotoTarget.source === "carryover_presented");

const distinctQuestionBrain = new QueueBrain([final("Qual a quilometragem que voce procura no Equinox?")]);
const distinctQuestion = await authorFollowupMessageDetailed({
  brain: distinctQuestionBrain, state: paraphraseState, stage: 2, turnId: "fu60-distinct", now: NOW, portalPromptSha256: "sha",
});
check("pergunta diferente sobre o mesmo veiculo continua livre", distinctQuestion.attempts === 1
  && distinctQuestion.text?.includes("quilometragem") === true);

const differentAttributeState = state();
differentAttributeState.recentTurns = [
  { role: "agent", text: "Qual a km do Equinox?", at: NOW },
];
const differentAttributeBrain = new QueueBrain([final("Qual o preco do Equinox?")]);
const differentAttribute = await authorFollowupMessageDetailed({
  brain: differentAttributeBrain, state: differentAttributeState, stage: 2,
  turnId: "fu60-different-attribute", now: NOW, portalPromptSha256: "sha",
});
check("atributos diferentes do mesmo veiculo nao sao confundidos com repeticao", differentAttribute.attempts === 1
  && differentAttribute.text?.includes("preco") === true);

// Incidente real Monaco: a mesma pergunta de nome foi reformulada em T1/T2
// ("posso saber" -> "poderia informar") e escapava do comparador literal.
// A memoria tipada do slot pendente deve barrar a repeticao sem escolher o
// texto da retomada seguinte para a LLM.
const semanticRepeatState = state();
if (!semanticRepeatState.workingMemory) throw new Error("fixture sem workingMemory inicial");
semanticRepeatState.workingMemory = {
  ...semanticRepeatState.workingMemory,
  pendingAgentQuestion: { slot: "nome", sinceTurnId: "opening" },
};
semanticRepeatState.recentTurns = [
  { role: "lead", text: "Tenho interesse em financiamento.", at: "2026-07-15T12:00:00.000Z" },
  { role: "agent", text: "Para te ajudar melhor, posso saber seu nome?", at: "2026-07-15T12:01:00.000Z" },
];
const semanticRepeatBrain = new QueueBrain([
  final("Para continuarmos com o financiamento, poderia me informar seu nome?"),
  final("Se ainda quiser entender o financiamento, sigo por aqui para te ajudar."),
]);
const semanticRepeat = await authorFollowupMessageDetailed({
  brain: semanticRepeatBrain,
  state: semanticRepeatState,
  stage: 1,
  turnId: "fu60-semantic-repeat",
  now: NOW,
  portalPromptSha256: "sha",
});
check("T1 rejeita reformulacao semantica da pergunta de nome pendente", semanticRepeat.attempts === 2
  && semanticRepeat.text === "Se ainda quiser entender o financiamento, sigo por aqui para te ajudar.");

// Incidente real Monaco: T1 afirmou "vou encaminhar seu contato" sem existir
// handoff nesse evento. A LLM continua livre para oferecer a transferencia; o
// que nao pode e publicar como fato um efeito que nao sera materializado.
const t1FalseHandoffBrain = new QueueBrain([
  final("Vou encaminhar seu contato para um consultor de vendas, que dara continuidade ao atendimento."),
  final("Se quiser, posso continuar te ajudando por aqui."),
]);
const t1FalseHandoff = await authorFollowupMessageDetailed({
  brain: t1FalseHandoffBrain,
  state: state(),
  stage: 1,
  turnId: "fu60-t1-false-handoff",
  now: NOW,
  portalPromptSha256: "sha",
});
check("T1 nao afirma transferencia que nao sera materializada", t1FalseHandoff.attempts === 2
  && t1FalseHandoff.text === "Se quiser, posso continuar te ajudando por aqui.");

const t2HandoffOfferBrain = new QueueBrain([
  final("Quer que eu encaminhe seu contato para um consultor?"),
]);
const t2HandoffOffer = await authorFollowupMessageDetailed({
  brain: t2HandoffOfferBrain,
  state: state(),
  stage: 2,
  turnId: "fu60-t2-handoff-offer",
  now: NOW,
  portalPromptSha256: "sha",
});
check("T2 pode oferecer transferencia sem afirmar efeito inexistente", t2HandoffOffer.attempts === 1
  && t2HandoffOffer.text === "Quer que eu encaminhe seu contato para um consultor?");

const t1FalseConnectBrain = new QueueBrain([
  final("Vou te conectar agora com um consultor de vendas."),
  final("Se ainda quiser, continuo por aqui para ajudar."),
]);
const t1FalseConnect = await authorFollowupMessageDetailed({
  brain: t1FalseConnectBrain,
  state: state(),
  stage: 1,
  turnId: "fu60-t1-false-connect",
  now: NOW,
  portalPromptSha256: "sha",
});
check("T1 rejeita conexao humana afirmada sem handoff", t1FalseConnect.attempts === 2
  && t1FalseConnect.text === "Se ainda quiser, continuo por aqui para ajudar.");

const t2ConnectOfferBrain = new QueueBrain([
  final("Quer que eu te conecte com um consultor?"),
]);
const t2ConnectOffer = await authorFollowupMessageDetailed({
  brain: t2ConnectOfferBrain,
  state: state(),
  stage: 2,
  turnId: "fu60-t2-connect-offer",
  now: NOW,
  portalPromptSha256: "sha",
});
check("T2 pode oferecer conexao sem afirmar efeito inexistente", t2ConnectOffer.attempts === 1
  && t2ConnectOffer.text === "Quer que eu te conecte com um consultor?");

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

const t3MissingTransferClaimBrain = new QueueBrain([
  final("Entendo que voce deve estar ocupado. Quando quiser retomar, e so me chamar."),
  final("Entendo que voce deve estar ocupado. Seu contato ja esta encaminhado para um consultor de vendas, que dara continuidade. Obrigado pelo contato."),
]);
const t3MissingTransferClaim = await authorFollowupMessageDetailed({
  brain: t3MissingTransferClaimBrain, state: state(), stage: 3, turnId: "fu60-t3-required-transfer", now: NOW,
  portalPromptSha256: "sha", handoffAvailable: true,
});
check("T3 disponivel rejeita despedida sem avisar o consultor", t3MissingTransferClaim.attempts === 2
  && t3MissingTransferClaim.text?.includes("consultor") === true);

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
check("saudacao Brasil de madrugada e Boa noite", getBrazilChannelTime("2026-07-16T02:00:00.000Z").greeting === "Boa noite");
check("saudacao Brasil de manha e Bom dia", getBrazilChannelTime("2026-07-15T14:00:00.000Z").greeting === "Bom dia");
check("saudacao Brasil de tarde e Boa tarde", getBrazilChannelTime("2026-07-15T17:00:00.000Z").greeting === "Boa tarde");
check("data invalida nao inventa saudacao", getBrazilChannelTime("nao-e-data").greeting === null);
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
