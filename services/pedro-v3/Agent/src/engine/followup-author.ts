import type { AgentBrainPort, TurnFrame } from "../domain/agent-brain.ts";
import type { ConversationState } from "../domain/conversation-state.ts";
import { ResponseRenderer } from "./response-renderer.ts";
import { buildWorkingMemory } from "./working-memory.ts";
import { buildConversationContext } from "./conversation-context.ts";
import type { FollowupStage } from "./followup-policy.ts";
import { adText, resolveAdVehicleFromMarket } from "./ad-context.ts";
import { questionSlotFromAgentText } from "./lead-extraction.ts";

function questionCount(text: string): number {
  return (text.match(/\?/g) ?? []).length;
}

function normalizeFollowupText(text: string): string {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

function comparableFollowupText(text: string): string {
  return normalizeFollowupText(text).replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

// Repetir integralmente uma mensagem ja publicada nao e uma escolha comercial:
// e uma duplicacao observavel. A validacao permanece deliberadamente
// conservadora para nao impedir a LLM de retomar o mesmo assunto com uma
// abordagem nova. Igualdade normalizada sempre bloqueia; similaridade so conta
// em mensagens longas e quase identicas.
function repeatsRecentAgentMessage(text: string, state: ConversationState): boolean {
  const current = comparableFollowupText(text);
  if (!current) return false;
  const currentTokens = current.split(" ").filter(Boolean);
  const currentSet = new Set(currentTokens);

  return (state.recentTurns ?? [])
    .filter((turn) => turn.role === "agent")
    .slice(-6)
    .some((turn) => {
      const prior = comparableFollowupText(turn.text);
      if (!prior) return false;
      if (prior === current) return true;

      const priorTokens = prior.split(" ").filter(Boolean);
      if (currentTokens.length < 12 || priorTokens.length < 12) return false;
      const priorSet = new Set(priorTokens);
      const intersection = [...currentSet].filter((token) => priorSet.has(token)).length;
      const union = new Set([...currentSet, ...priorSet]).size;
      return intersection / Math.min(currentSet.size, priorSet.size) >= 0.9
        && intersection / union >= 0.8;
    });
}

function lastAgentMessage(state: ConversationState): string | null {
  for (let i = (state.recentTurns ?? []).length - 1; i >= 0; i -= 1) {
    if (state.recentTurns[i]?.role === "agent") return state.recentTurns[i]!.text;
  }
  return null;
}

function lastLeadMessage(state: ConversationState): string | null {
  for (let i = (state.recentTurns ?? []).length - 1; i >= 0; i -= 1) {
    if (state.recentTurns[i]?.role === "lead") return state.recentTurns[i]!.text;
  }
  return null;
}

// Follow-up pode mencionar algo enviado somente quando existe material
// factual correspondente no histórico/na oferta visível. Isto valida uma
// afirmação da LLM; não escolhe assunto, CTA ou próximo slot.
function claimsUnseenOutboundMaterial(text: string, state: ConversationState): boolean {
  const normalized = normalizeFollowupText(text);
  const claims = /\b(?:te|lhe)\s+(?:enviei|mandei|passei|mostrei|encaminhei)\b|\b(?:que|q)\s+(?:te|lhe)\s+(?:enviei|mandei|passei|mostrei)\b/.test(normalized);
  if (!claims) return false;
  const hasVisibleOffer = (state.lastRenderedOfferContext?.items.length ?? 0) > 0;
  const hasConcreteAgentMaterial = (state.recentTurns ?? [])
    .filter((turn) => turn.role === "agent")
    .some((turn) => /\b(?:r\$|km|modelo|ano|carro|veiculo|foto|endereco|avenida|rua|opcao|informac)/.test(normalizeFollowupText(turn.text)));
  return !hasVisibleOffer && !hasConcreteAgentMaterial;
}

function recentAgentQuestions(state: ConversationState): string[] {
  return (state.recentTurns ?? [])
    .filter((turn) => turn.role === "agent" && turn.text.includes("?"))
    .slice(-6)
    .map((turn) => turn.text);
}

function adVehicleLabel(state: ConversationState): string | null {
  const ad = state.adContext;
  if (!ad) return null;
  const vehicle = resolveAdVehicleFromMarket(adText(ad));
  if (!vehicle) return null;
  const year = adText(ad).match(/\b(?:19|20)\d{2}\b/)?.[0] ?? null;
  return [vehicle.marca, vehicle.modelo, year].filter(Boolean).join(" ");
}

// Uma mensagem de follow-up so pode AFIRMAR continuidade humana quando este
// mesmo evento vai materializar o handoff (hoje, apenas o T3 habilitado). Isto
// valida um efeito operacional; nao escolhe se/quando a conversa deve ser
// transferida. Perguntas/ofertas como "quer que eu encaminhe?" continuam livres.
function claimsHandoffContinuity(text: string): boolean {
  for (const sentence of text.split(/(?<=[.!?\n])/)) {
    const normalized = normalizeFollowupText(sentence);
    const mentionsTeam = /\b(?:analista(?:s)?|vendedor(?:es)?|consultor(?:es)?|equipe)\b/.test(normalized);
    if (!mentionsTeam) continue;

    // "Seu contato ja foi/sera encaminhado" e equivalentes: o contato vem
    // antes do predicado operacional.
    const contactFirst = /\b(?:seu\s+contato|o\s+contato|contato)\b.{0,120}\b(?:encaminhad\w*|transferid\w*|repassad\w*|esta\s+com|ja\s+esta|ficara?\s+com|vai\s+(?:falar|receber)|entrara?\s+em\s+contato|dara?\s+continuidade)/.test(normalized);

    // "Vou encaminhar seu contato para um consultor": no incidente real, a
    // acao vinha antes de "contato" e escapava do detector anterior. Somente
    // formas assertivas entram aqui; "posso/quer que eu encaminhe?" nao casa.
    const actionFirst = /\b(?:(?:vou|irei|vamos|iremos)\s+(?:te\s+|lhe\s+)?(?:encaminhar|transferir|repassar|conectar|colocar\s+em\s+contato)|(?:encaminharei|transferirei|repassarei|conectarei|encaminhamos|transferimos|repassamos|conectamos|encaminho|transfiro|repasso|conecto))\b.{0,120}\b(?:seu\s+contato|o\s+contato|voce|te|lhe|analista|vendedor|consultor|equipe)\b/.test(normalized);

    // "Um consultor dara continuidade/entrara em contato" afirma uma acao
    // futura da equipe mesmo sem mencionar literalmente "seu contato".
    const teamFirst = /\b(?:analista(?:s)?|vendedor(?:es)?|consultor(?:es)?|equipe)\b.{0,100}\b(?:vai|ira|entrara?|dara?)\s+(?:te\s+|lhe\s+)?(?:atender|chamar|receber|entrar\s+em\s+contato|dar\s+continuidade|continuidade)\b/.test(normalized);
    if (contactFirst || actionFirst || teamFirst) return true;
  }
  return false;
}

function repeatsLastAgentQuestion(text: string, previous: string | null): boolean {
  if (!previous) return false;
  const normalizedText = normalizeFollowupText(text);
  const questions = previous.match(/[^?]{12,}\?/g) ?? [];
  if (questions.some((question) => {
    const core = normalizeFollowupText(question).replace(/\?$/, "").trim();
    return core.length >= 18 && normalizedText.includes(core);
  })) return true;

  // Comparacao lexical conservadora para a mesma pergunta reformulada em
  // T1/T2 (por exemplo, "quer ver detalhes?" -> "gostaria de ver mais
  // detalhes?"). Isto nao escolhe o proximo assunto e nao rejeita perguntas
  // diferentes sobre o mesmo carro: exige ao menos dois termos informativos
  // em comum e forte contencao entre os dois nucleos.
  const STOP = new Set([
    "a", "o", "as", "os", "um", "uma", "de", "da", "do", "das", "dos",
    "em", "no", "na", "nos", "nas", "para", "pra", "por", "com", "e", "ou",
    "se", "que", "voce", "voces", "seu", "sua", "seus", "suas", "te", "lhe",
    "me", "eu", "ele", "ela", "isso", "esse", "essa", "desse", "dessa",
    "ainda", "mais", "ja", "agora", "aqui", "ai", "pode", "posso", "poderia",
    "quer", "quero", "gosta", "gostaria", "continuar", "continuarmos", "saber",
    "informar", "ajudar", "melhor", "favor", "qual", "quais", "quanto", "quantos",
  ]);
  const tokens = (question: string): Set<string> => new Set(
    normalizeFollowupText(question)
      .replace(/[^a-z0-9]+/g, " ")
      .split(/\s+/)
      .filter((token) => (token.length >= 3 || token === "km") && !STOP.has(token)),
  );
  const currentQuestions = text.match(/[^?]{8,}\?/g) ?? [];
  return currentQuestions.some((current) => questions.some((prior) => {
    const a = tokens(current);
    const b = tokens(prior);
    if (a.size < 2 || b.size < 2) return false;
    const intersection = [...a].filter((token) => b.has(token)).length;
    if (intersection < 2) return false;
    const containment = intersection / Math.min(a.size, b.size);
    const union = new Set([...a, ...b]).size;
    return containment >= 0.8 && intersection / union >= 0.55;
  }));
}

// A pergunta pendente e um fato semantico persistido pelo turno conversacional.
// T1/T2 podem retomar o assunto com autoria livre, mas nao devem reformular a
// mesma pergunta de qualificacao que o lead ainda nao respondeu. Isso valida
// repeticao; nao escolhe CTA, assunto novo ou texto para a LLM.
function repeatsPendingQuestionSlot(text: string, pendingSlot: string | null): boolean {
  if (!pendingSlot) return false;
  return questionSlotFromAgentText(text) === pendingSlot;
}

function violatesFollowupStyle(text: string, stage: FollowupStage): boolean {
  const normalized = normalizeFollowupText(text);
  const startsWithGreeting = /^(?:bom dia|boa tarde|boa noite|ola|oi)\b/.test(normalized);
  const repeatsPresentation = /\b(?:sou o|sou a|aqui e o|aqui e a|meu nome e)\b/.test(normalized);
  const coldFarewell = /\bprefiro ser honesto\b|\btalvez nao seja o melhor cenario\b/.test(normalized);
  return startsWithGreeting || repeatsPresentation || coldFarewell;
}

export async function authorFollowupMessage(args: {
  brain: AgentBrainPort;
  state: ConversationState;
  stage: FollowupStage;
  turnId: string;
  now: string;
  portalPromptSha256: string;
  maxAttempts?: number;
}): Promise<string | null> {
  return (await authorFollowupMessageDetailed(args)).text;
}

export type FollowupAuthorResult = {
  readonly text: string | null;
  readonly attempts: number;
  readonly reason: "authored" | "brain_error" | "query_not_allowed" | "text_missing" | "duplicate_message" | "question_contract" | "unsupported_claim" | "unsupported_handoff_claim";
};

export async function authorFollowupMessageDetailed(args: {
  brain: AgentBrainPort;
  state: ConversationState;
  stage: FollowupStage;
  turnId: string;
  now: string;
  portalPromptSha256: string;
  handoffAvailable?: boolean;
  maxAttempts?: number;
}): Promise<FollowupAuthorResult> {
  const { memory } = buildWorkingMemory(args.state, args.state.workingMemory);
  let feedback = "";
  let lastReason: FollowupAuthorResult["reason"] = "text_missing";
  const maxAttempts = args.maxAttempts ?? 3;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const previousAgent = lastAgentMessage(args.state);
    const previousLead = lastLeadMessage(args.state);
    const agentQuestions = recentAgentQuestions(args.state);
    const advertisedVehicle = adVehicleLabel(args.state);
    const block = `[EVENTO SISTEMICO FOLLOW-UP T${args.stage}] O cliente esta inativo. Reabra a conversa com autoria propria, usando apenas o historico factual deste frame. Nao repita uma mensagem, ficha, proposta ou CTA ja enviados. Nao afirme que algo foi enviado se nao aparece nas falas anteriores ou na oferta visivel.${feedback}`;
    const conversationContext = buildConversationContext({ state: args.state, workingMemory: memory });
    const frame: TurnFrame = {
      turnId: args.turnId,
      now: args.now,
      block,
      portalPromptSha256: args.portalPromptSha256,
      workingMemory: memory,
      recentTranscript: (args.state.recentTurns ?? []).slice(-12).map((turn) => ({ role: turn.role, text: turn.text })),
      conversationContext: {
        ...conversationContext,
        followup: {
          stage: args.stage,
          lastLeadMessage: previousLead,
          lastAgentMessage: previousAgent,
          recentAgentQuestions: agentQuestions,
          hasVisibleOffer: (args.state.lastRenderedOfferContext?.items.length ?? 0) > 0,
          adEntry: args.state.adContext != null,
          adVehicleLabel: advertisedVehicle,
          handoffAvailable: args.handoffAvailable === true,
        },
      },
      currentTurnFacts: { expectedAnswer: { slot: null, lastAgentQuestion: null }, extracted: [], offerReference: null },
      signals: {
        mentionsPhoto: false,
        mentionsStore: false,
        mentionsMoreOptions: false,
        mentionsVehicleType: null,
        isMemoryQuestion: false,
        relation: "unrelated",
        currentTurnIntent: "other",
        followupStage: args.stage,
        handoffAvailable: args.handoffAvailable === true,
        ...(advertisedVehicle ? { adVehicle: advertisedVehicle } : {}),
      },
    };
    let step;
    try {
      step = await args.brain.proposeNextStep(frame, []);
    } catch {
      lastReason = "brain_error";
      feedback = " FEEDBACK: gere apenas a mensagem curta de follow-up em um final de texto.";
      continue;
    }
    if (step.kind !== "final") {
      lastReason = "query_not_allowed";
      feedback = " FEEDBACK: follow-up nao usa tools; devolva final em texto.";
      continue;
    }
    const draft = step.decision.responsePlan.draft;
    const textParts = draft?.parts.filter((part) => part.type === "text") ?? [];
    if (textParts.length === 0) {
      lastReason = "text_missing";
      feedback = " FEEDBACK: inclua uma mensagem em draft.parts usando uma parte text.";
      continue;
    }
    // A LLM continua sendo a autora. Efeitos ou refs adicionais propostos por ela
    // sao deliberadamente ignorados: o turno sistemico possui seu proprio plano
    // seguro e nao deve falhar apenas porque o provider devolveu metadados extras.
    let text: string;
    try { text = ResponseRenderer.render({ parts: textParts }, [], args.state).trim(); }
    catch { text = ""; }
    const repeatedMessage = repeatsRecentAgentMessage(text, args.state);
    const repeatedQuestion = args.stage !== 3 && repeatsLastAgentQuestion(text, lastAgentMessage(args.state));
    const repeatedPendingSlot = args.stage !== 3
      && repeatsPendingQuestionSlot(text, memory.pendingAgentQuestion?.slot ?? null);
    const invalidStyle = violatesFollowupStyle(text, args.stage);
    const unsupportedClaim = claimsUnseenOutboundMaterial(text, args.state);
    const handoffWillBeMaterialized = args.stage === 3 && args.handoffAvailable === true;
    const unsupportedHandoffClaim = claimsHandoffContinuity(text) && !handoffWillBeMaterialized;
    const missingHandoffClaim = args.stage === 3 && args.handoffAvailable === true && !claimsHandoffContinuity(text);
    const questions = questionCount(text);
    if (!text || repeatedMessage || invalidStyle || repeatedQuestion || repeatedPendingSlot || unsupportedClaim || unsupportedHandoffClaim || missingHandoffClaim || (args.stage === 3 ? questions !== 0 : questions > 1)) {
      lastReason = !text ? "text_missing" : repeatedMessage ? "duplicate_message" : unsupportedHandoffClaim ? "unsupported_handoff_claim" : unsupportedClaim ? "unsupported_claim" : "question_contract";
      feedback = unsupportedHandoffClaim
        ? " FEEDBACK: este follow-up nao materializa uma transferencia. Reescreva com autoria propria sem afirmar que o contato foi ou sera encaminhado e sem prometer acao futura de analista/vendedor/equipe. Uma pergunta ou oferta, sem afirmar que a transferencia aconteceu, continua permitida."
        : args.stage === 3
          ? missingHandoffClaim
            ? " FEEDBACK: a transferencia deste T3 esta disponivel e sera materializada junto com a despedida. Despeca-se sem pergunta e informe claramente que o contato ja esta encaminhado a um consultor de vendas, que dara continuidade."
            : " FEEDBACK: T3 deve ser uma despedida curta, amigavel e sem pergunta. Nao use saudacao, apresentacao, 'Prefiro ser honesto' ou linguagem de desistencia fria."
          : unsupportedClaim
            ? " FEEDBACK: sua mensagem afirmou que algo foi enviado, mas esse material nao esta comprovado no historico atual. Reescreva sem essa afirmacao e reabra com uma mensagem verdadeira ligada ao contexto disponivel."
            : repeatedMessage
              ? " FEEDBACK: esta mensagem repete uma mensagem ja enviada ao cliente. Nao parafraseie a mesma ficha, proposta ou CTA. Escreva uma retomada nova, curta e de baixa friccao, ligada ao historico; a escolha das palavras continua sendo sua."
            : repeatedQuestion || repeatedPendingSlot
              ? " FEEDBACK: voce repetiu uma pergunta de qualificacao que o cliente ainda nao respondeu. Nao a reformule. Faca uma retomada diferente e ligada ao contexto; a escolha do texto continua sendo sua."
              : invalidStyle
                ? " FEEDBACK: follow-up nao pode ter saudacao, reapresentacao, 'Prefiro ser honesto' ou linguagem de desistencia. Retome o historico com naturalidade."
                : " FEEDBACK: escreva uma mensagem curta com no maximo uma pergunta.";
      continue;
    }
    return { text, attempts: attempt + 1, reason: "authored" };
  }
  return { text: null, attempts: maxAttempts, reason: lastReason };
}
