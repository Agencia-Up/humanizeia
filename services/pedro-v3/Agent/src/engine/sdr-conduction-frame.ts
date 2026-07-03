// ============================================================================
// sdr-conduction-frame.ts — R11 (Condução SDR). Módulo PURO e determinístico que
// GOVERNA o próximo passo da conversa e entrega uma GUIDANCE estruturada ao compose.
//
// Ele NÃO redige a fala final (isso é do LLM seguindo o prompt do portal) e NÃO
// impõe invariantes por força bruta (isso é da policy + reconciliação). Ele TRADUZ
// o estado do funil + os sinais comerciais do turno em orientação clara:
//   - o que o lead acabou de trazer (leadIntent) e se respondeu o objetivo pendente;
//   - qual a PRÓXIMA pergunta permitida (ordem do funil) e quais são PROIBIDAS (já sabidas);
//   - se deve responder primeiro a pergunta do lead;
//   - se o lead demonstrou COMPRA forte (acelerar) ou interesse suave;
//   - o stage e a elegibilidade de handoff.
//
// Sem `if` por frase: os sinais são classificados por LÉXICOS gerais (como parseType/
// parseBudget), nunca casando a frase específica de um teste.
// ============================================================================
import type { ConversationState } from "../domain/conversation-state.ts";
import type { TurnInterpretation } from "../domain/decision.ts";
import { normalizeText } from "./catalog-utils.ts";
// Tipos do funil (import type = sem ciclo em runtime; a lógica de view vem do conductor).
import type { SdrQualificationView, SdrQualificationSlot } from "./sdr-conductor.ts";

export type SdrStage =
  | "discovery" | "qualification" | "offer" | "vehicle_detail" | "visit" | "handoff_ready" | "handoff_blocked";
export type BuySignal = "none" | "soft" | "strong";
export type LeadIntent =
  | "greeting" | "answering_funnel" | "asking_price" | "asking_detail" | "selecting_vehicle"
  | "requesting_photo" | "more_options" | "direction_change" | "buy_now" | "small_talk" | "other";

export type SdrConductionFrame = {
  readonly stage: SdrStage;
  readonly leadIntent: LeadIntent;
  readonly answeredObjective: SdrQualificationSlot | null;
  readonly nextAllowedQuestion: { readonly slot: SdrQualificationSlot; readonly question: string } | null;
  readonly forbiddenQuestions: readonly SdrQualificationSlot[];
  readonly mustAnswerLeadQuestionFirst: boolean;
  readonly shouldAskOneQuestionOnly: boolean;
  readonly buySignalLevel: BuySignal;
  readonly handoffEligibility: "blocked" | "ready";
  readonly composeGuidance: string;
};

// ── Léxicos de sinal (classificadores gerais, não frases de teste) ──────────────────────────────────────────
// COMPRA FORTE: decisão/urgência de fechar OU intenção explícita de visitar/financiar. Fecha o funil rápido.
const STRONG_BUY = [
  "quero comprar", "comprar agora", "vou comprar", "quero fechar", "vou fechar", "fechar negocio", "pode fechar",
  "vou levar", "quero levar", "quero esse mesmo", "fechado", "quero financiar", "ver financiamento",
  "simular financiamento", "quero visitar", "posso visitar", "consigo visitar", "quando posso ir",
  "quero agendar", "marcar visita", "agendar visita", "quero ir ai", "quero ir na loja",
];
// INTERESSE SUAVE: gostou/curtiu um veículo, quer saber mais — avança 1 passo, sem acelerar handoff.
const SOFT_BUY = [
  "gostei", "curti", "adorei", "esse e bom", "esse me interessa", "me interessei", "quero saber mais",
  "gostei desse", "esse ficou bom", "esse serve", "bonito", "esse ai", "esse mesmo",
];
// PERGUNTA DE PREÇO (lead pergunta valor/custo). mustAnswerFirst.
const PRICE_QUESTION = [
  "quanto custa", "qual o valor", "qual o preco", "qual preco", "quanto ta", "quanto fica", "quanto sai",
  "valor dele", "preco dele", "quanto e", "qual valor",
];
// PERGUNTA DE DETALHE do veículo (câmbio/km/cor/ano/opcionais). mustAnswerFirst.
const DETAIL_QUESTION = [
  "automatic", "e manual", "quantos km", "qual a cor", "qual cor", "qual o ano", "que ano", "tem ar",
  "e flex", "e completo", "tem multimidia", "motor", "consumo", "ipva", "single owner", "unico dono",
];
const DIRECTION_CHANGE = ["na verdade", "prefiro", "agora quero", "melhor um", "mudei de ideia", "pensando bem"];
const MORE_OPTIONS = ["mais opc", "mais alguma", "outras opc", "mais carr", "tem outro", "mostra mais"];
const PHOTO_REQUEST = ["foto", "imagem", "manda a foto", "ver foto"];
const GREETING = ["bom dia", "boa tarde", "boa noite", "oi", "ola", "opa", "vim pelo anuncio", "vim do anuncio"];

function anyCue(norm: string, cues: readonly string[]): boolean {
  return cues.some((c) => norm.includes(c));
}
// Pergunta explícita (interrogativa) na fala do lead — "?" OU relação de detalhe interpretada pelo modelo.
function leadAskedQuestion(norm: string, interpretation?: TurnInterpretation | null): boolean {
  if (norm.includes("?")) return true;
  if (interpretation?.relation === "asks_vehicle_detail") return true;
  return anyCue(norm, PRICE_QUESTION) || anyCue(norm, DETAIL_QUESTION);
}

function detectBuySignal(norm: string): BuySignal {
  if (anyCue(norm, STRONG_BUY)) return "strong";
  if (anyCue(norm, SOFT_BUY)) return "soft";
  return "none";
}

function detectLeadIntent(norm: string, interpretation: TurnInterpretation | null | undefined, buy: BuySignal): LeadIntent {
  if (buy === "strong") return "buy_now";
  if (anyCue(norm, PRICE_QUESTION)) return "asking_price";
  if (anyCue(norm, PHOTO_REQUEST)) return "requesting_photo";
  if (anyCue(norm, MORE_OPTIONS)) return "more_options";
  if (anyCue(norm, DIRECTION_CHANGE)) return "direction_change";
  if (anyCue(norm, DETAIL_QUESTION) || interpretation?.relation === "asks_vehicle_detail") return "asking_detail";
  if (buy === "soft") return "selecting_vehicle";
  if (anyCue(norm, GREETING) && norm.length <= 40) return "greeting";
  if (interpretation?.relation === "answers_pending") return "answering_funnel";
  return "other";
}

// Slots já conhecidos OU declinados (nunca reperguntar). Determinístico a partir do estado.
function forbiddenSlots(state: ConversationState): SdrQualificationSlot[] {
  const out: SdrQualificationSlot[] = [];
  const s = state.slots as Record<string, { status?: string } | undefined>;
  for (const slot of Object.keys(s)) {
    if (slot === "cpf") continue;
    const st = s[slot]?.status;
    if (st && st !== "unknown") out.push(slot as SdrQualificationSlot);
  }
  return out;
}

function stageOf(args: {
  view: SdrQualificationView; buy: BuySignal; hasSelectedVehicle: boolean; leadIntent: LeadIntent;
  nomeKnown: boolean; interesseVisitaTrue: boolean;
}): SdrStage {
  const { view, buy, hasSelectedVehicle, leadIntent, nomeKnown, interesseVisitaTrue } = args;
  if (view.readyForHandoff) return "handoff_ready";
  if (buy === "strong" && !view.readyForHandoff) return "handoff_blocked"; // quer fechar mas falta dado -> acelerar
  if (interesseVisitaTrue) return "visit";
  if (leadIntent === "asking_detail" && hasSelectedVehicle) return "vehicle_detail";
  if (hasSelectedVehicle || leadIntent === "selecting_vehicle" || leadIntent === "more_options") return "offer";
  if (!nomeKnown) return "discovery";
  return "qualification";
}

export function buildSdrConductionFrame(args: {
  readonly state: ConversationState;
  readonly leadMessage: string;
  readonly interpretation?: TurnInterpretation | null;
  readonly view: SdrQualificationView;                 // deriveSdrQualification (caller)
  readonly nextQuestion: string | null;                // policy.questions[nextSlot] ?? default (caller)
  readonly reasonCode: string;
  readonly isFirstContact: boolean;
}): SdrConductionFrame {
  const { state, leadMessage, interpretation, view, nextQuestion, reasonCode, isFirstContact } = args;
  const norm = normalizeText(leadMessage);

  const buySignalLevel = detectBuySignal(norm);
  const leadIntent = detectLeadIntent(norm, interpretation, buySignalLevel);
  const mustAnswerLeadQuestionFirst = leadAskedQuestion(norm, interpretation);

  const forbidden = forbiddenSlots(state);
  const pending = state.currentObjective?.status === "pending" && state.currentObjective.slot !== "cpf"
    ? (state.currentObjective.slot as SdrQualificationSlot) : null;
  // Objetivo pendente foi RESPONDIDO se o slot dele já ficou conhecido/declinado neste estado.
  const answeredObjective = pending && forbidden.includes(pending) ? pending : null;

  const nomeKnown = state.slots.nome.status === "known";
  const interesseVisitaTrue = state.slots.interesseVisita.status === "known" && state.slots.interesseVisita.value === true;
  const hasSelectedVehicle = !!state.vehicleContext.selected?.key;
  const nextAllowedQuestion = view.nextSlot && nextQuestion ? { slot: view.nextSlot, question: nextQuestion } : null;
  const handoffEligibility: "blocked" | "ready" = view.readyForHandoff ? "ready" : "blocked";
  const stage = stageOf({ view, buy: buySignalLevel, hasSelectedVehicle, leadIntent, nomeKnown, interesseVisitaTrue });

  // ── Montagem da GUIDANCE (segmentos rotulados; o LLM redige seguindo o prompt do portal DENTRO disto) ──
  const seg: string[] = [];
  if (isFirstContact) seg.push("[ABERTURA] Primeiro contato: apresente-se como no prompt antes de conduzir.");

  const knownList = forbidden.length > 0 ? forbidden.join(", ") : "nenhum";
  seg.push(`[JA SABEMOS] dados conhecidos (NUNCA pergunte de novo): ${knownList}.`);

  if (mustAnswerLeadQuestionFirst) {
    seg.push("[RESPONDA PRIMEIRO] O lead FEZ UMA PERGUNTA (preco/detalhe). Responda-a PRIMEIRO com base SO nos fatos deste turno; so depois conduza. Se nao houver o dado nos fatos, seja honesto.");
  }

  if (buySignalLevel === "strong") {
    if (view.nextSlot) {
      seg.push(`[COMPRA FORTE] O lead demonstrou INTENCAO CLARA de comprar/visitar. NAO desacelere com pergunta burocratica nem ofereca lista generica. Reconheca a intencao e peca SO o dado essencial que falta agora (uma pergunta so)${nextQuestion ? `. Pergunta sugerida (pode reformular no seu tom): ${nextQuestion}` : `: ${view.nextSlot}`}`);
    } else {
      seg.push("[COMPRA FORTE + FUNIL OK] O lead quer fechar e ja temos os dados essenciais. Conduza direto para o PROXIMO PASSO do prompt (confirmar/agendar visita ou preparar a transferencia), sem repetir perguntas.");
    }
  } else if (buySignalLevel === "soft") {
    seg.push("[INTERESSE] O lead gostou de um veiculo. Reconheca isso e avance UM passo (foto do veiculo escolhido OU a proxima qualificacao do funil), sem repetir a mesma oferta/CTA.");
  }

  if (/offer|oferta/i.test(reasonCode)) {
    seg.push("[OFERTA] Voce ofereceu veiculos REAIS (na lista). NAO fale preco/modelo em texto livre (a lista ja mostra). Se ainda faltam dados essenciais, priorize UMA pergunta de qualificacao antes de empurrar visita.");
  }

  // Fechamento OU próxima pergunta do funil (UMA, opcional de follow-up). Compra forte já tem seu próprio pedido.
  // Responder-primeiro NÃO suprime o follow-up — a resposta ao lead vem antes, a pergunta continua sendo UMA.
  if (buySignalLevel !== "strong") {
    if (stage === "handoff_ready" || !nextAllowedQuestion) {
      seg.push("[FECHAMENTO] Qualificacao COMPLETA — NAO faca mais perguntas de dados nem repita nada que ja sabe. Conduza o PROXIMO PASSO do prompt (confirmar/agendar visita, combinar retorno ou preparar a transferencia). Se a visita ja foi aceita e falta so o horario, pergunte SO o dia/horario.");
    } else {
      seg.push(`[PROXIMA PERGUNTA] Na ordem do funil do prompt, o proximo dado util e sobre '${nextAllowedQuestion.slot}'. Pergunta sugerida (uma so, pode reformular no seu tom): ${nextAllowedQuestion.question}`);
    }
  }

  seg.push("[UMA PERGUNTA] Faca no MAXIMO UMA pergunta nesta mensagem (oferecer visita/horario TAMBEM conta como pergunta). Nunca empilhe duas.");
  seg.push("[NATURALIDADE] Varie o tom; NAO repita o nome do lead em toda mensagem; NAO abra com enchimento vazio; NAO termine sempre com o mesmo CTA.");
  seg.push("[PRECO] Nao fale preco/custo por iniciativa antes de qualificar o minimo — salvo se o lead perguntou preco.");

  const composeGuidance = ` [CONDUCAO SDR] ${seg.join(" ")}`.slice(0, 1900);

  return {
    stage,
    leadIntent,
    answeredObjective,
    nextAllowedQuestion,
    forbiddenQuestions: forbidden,
    mustAnswerLeadQuestionFirst,
    shouldAskOneQuestionOnly: true,
    buySignalLevel,
    handoffEligibility,
    composeGuidance,
  };
}
