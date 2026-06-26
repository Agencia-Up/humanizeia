import { PedroV2LeadMemory, PedroV2Intent } from "./types.ts";
import {
  classifyAgentReplyPending,
  isValidName,
  leadAffirmsPresenceToFollowupPing,
  leadAffirmsSchedulingQuestion,
  leadAsksAnyCarInBudget,
  leadAsksBodyType,
  leadProvidingTradeDetails,
  leadRespondsNoDownPaymentOrInstallmentConcern,
  leadRespondsTradeValueObjection,
  messageAsksForPhotos,
  normalizePlannerText,
  parsePriceCeiling,
} from "./decisionLogic.ts";

export type PendingQuestionType =
  | "nenhum"
  | "afirmacao"
  | "fez_pergunta"
  | "ofereceu_fotos"
  | "ofereceu_opcoes"
  | "perguntou_pagamento"
  | "perguntou_troca"
  | "perguntou_dados"
  | "perguntou_veiculo";

export type LeadReplyRelation =
  | "none"
  | "presence_ack"
  | "photo_acceptance"
  | "options_acceptance"
  | "finance_constraint"
  | "trade_value_objection"
  | "trade_details"
  | "schedule_affirmation"
  | "data_answer";

export type ConversationCenter = {
  pending_question: PendingQuestionType;
  last_agent_message: string;
  lead_reply_relation: LeadReplyRelation;
  should_hold_track: boolean;
  current_objective: string;
  qualification: {
    nome: string | null;
    interesse: string | null;
    troca: any;
    pagamento: string | null;
    entrada: string | null;
    agendamento: string | null;
  };
  vehicles_shown_count: number;
};

export type ConversationTrackOverride = {
  action: "reply_only" | "stock_search" | "photo_request";
  intent: PedroV2Intent;
  reason: string;
  response_guidance: string;
  search_query?: string | null;
  search_filters?: Record<string, any>;
  photo_target?: string | null;
  use_memory_vehicle?: boolean;
};

function turnText(turn: any): string {
  return String(turn?.text || turn?.content || turn?.message || "");
}

export function getLastAgentText(input: { memory?: PedroV2LeadMemory | null; recent_history?: any[] }): string {
  const turns = [
    ...(Array.isArray(input.recent_history) ? input.recent_history : []),
    ...(Array.isArray(input.memory?.recent_turns) ? input.memory.recent_turns : []),
  ];
  const agentTurns = turns.filter((turn) =>
    ["agent", "assistant", "consultor", "outgoing"].includes(String(turn?.role || turn?.direction || "").toLowerCase())
  );
  const last = agentTurns[agentTurns.length - 1];
  return turnText(last);
}

export function inferPendingQuestion(input: { memory?: PedroV2LeadMemory | null; recent_history?: any[] }): PendingQuestionType {
  const persisted = (input.memory as any)?.pending_question;
  if (persisted && typeof persisted === "string") return persisted as PendingQuestionType;
  return classifyAgentReplyPending(getLastAgentText(input), "") as PendingQuestionType;
}

function wordCount(text: string): number {
  return normalizePlannerText(text).split(/\s+/).filter(Boolean).length;
}

function isShortAffirmative(message?: string | null): boolean {
  const t = normalizePlannerText(message).replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
  if (!t) return false;
  if (wordCount(t) > 5) return false;
  return /^(sim|s|ss|claro|isso|isso ai|pode|pode sim|ok|okay|blz|beleza|perfeito|fechado|manda|envia|quero|quero sim|por favor|pf|pfv|aham|uhum)\b/.test(t);
}

function clearlyStartsNewVehicleSearch(message?: string | null): boolean {
  const t = normalizePlannerText(message);
  if (!t) return false;
  if (leadAsksAnyCarInBudget(t) || leadAsksBodyType(t)) return true;
  if (parsePriceCeiling(t) && /\b(tem|teria|quero|queria|procuro|busco|manda|mostra|mostrar|carro|veiculo|suv|sedan|hatch|picape|caminhonete)\b/.test(t)) return true;
  if (/\b(tem|teria|quero|queria|procuro|busco|mostra|mostrar)\b.{0,24}\b(carro|veiculo|suv|sedan|hatch|picape|pickup|caminhonete|modelo|opcao|opcoes)\b/.test(t)) return true;
  return false;
}

function likelyDataAnswer(message?: string | null): boolean {
  const raw = String(message || "").trim();
  const t = normalizePlannerText(raw);
  if (!t || t.includes("?")) return false;
  if (clearlyStartsNewVehicleSearch(raw) || messageAsksForPhotos(raw)) return false;
  if (isValidName(raw)) return true;
  if (/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/.test(t)) return true;
  if (/\b\d{1,2}[\/.-]\d{1,2}(?:[\/.-]\d{2,4})?\b/.test(t)) return true;
  if (/\b(segunda|terca|quarta|quinta|sexta|sabado|domingo|amanha|hoje)\b/.test(t)) return true;
  if (/\b\d{1,2}\s*h(?:oras?)?\b/.test(t)) return true;
  return wordCount(raw) <= 4 && !/\b(foto|fotos|preco|valor|carro|veiculo|suv|sedan|hatch|picape|modelo|opcao|opcoes)\b/.test(t);
}

export function classifyLeadReplyRelation(input: {
  message: string;
  memory?: PedroV2LeadMemory | null;
  recent_history?: any[];
}): LeadReplyRelation {
  const pending = inferPendingQuestion(input);
  const lastAgent = getLastAgentText(input);
  const startsNewSearch = clearlyStartsNewVehicleSearch(input.message);
  if (leadAffirmsPresenceToFollowupPing(input.message, lastAgent)) return "presence_ack";
  if (pending === "ofereceu_fotos" && (isShortAffirmative(input.message) || messageAsksForPhotos(input.message))) return "photo_acceptance";
  if (pending === "ofereceu_opcoes" && isShortAffirmative(input.message)) return "options_acceptance";
  if (!startsNewSearch && leadRespondsNoDownPaymentOrInstallmentConcern(input.message, pending, lastAgent)) return "finance_constraint";
  if (!startsNewSearch && leadRespondsTradeValueObjection(input.message, pending, lastAgent)) return "trade_value_objection";
  if (pending === "perguntou_troca" && !startsNewSearch && leadProvidingTradeDetails(input.message)) return "trade_details";
  if (leadAffirmsSchedulingQuestion(input.message, lastAgent)) return "schedule_affirmation";
  if (pending === "perguntou_dados" && likelyDataAnswer(input.message)) return "data_answer";
  return "none";
}

export function buildConversationCenter(input: {
  message: string;
  memory?: PedroV2LeadMemory | null;
  recent_history?: any[];
}): ConversationCenter {
  const memory: any = input.memory || {};
  const interesse = memory.interesse || {};
  const negociacao = memory.negociacao || {};
  const atendimento = memory.atendimento || {};
  const relation = classifyLeadReplyRelation(input);
  const pending = inferPendingQuestion(input);
  const interestLabel = interesse.modelo_desejado || interesse.tipo_veiculo || null;
  return {
    pending_question: pending,
    last_agent_message: getLastAgentText(input).slice(0, 500),
    lead_reply_relation: relation,
    should_hold_track: ["presence_ack", "finance_constraint", "trade_value_objection", "trade_details", "schedule_affirmation", "data_answer"].includes(relation),
    current_objective: pending === "nenhum" || pending === "afirmacao" ? "interpretar_mensagem_atual" : `responder_${pending}`,
    qualification: {
      nome: memory.lead?.nome || memory.lead_name || interesse.nome || null,
      interesse: interestLabel,
      troca: negociacao.carro_troca || interesse.carro_troca || null,
      pagamento: negociacao.forma_pagamento || interesse.forma_pagamento || null,
      entrada: negociacao.valor_entrada || interesse.valor_entrada || null,
      agendamento: atendimento.dia_agendamento || interesse.dia_agendamento || null,
    },
    vehicles_shown_count: Array.isArray(memory.veiculos_apresentados) ? memory.veiculos_apresentados.length : 0,
  };
}

export function conversationTrackOverride(input: {
  message: string;
  memory?: PedroV2LeadMemory | null;
  recent_history?: any[];
  planned_action?: string | null;
}): ConversationTrackOverride | null {
  const center = buildConversationCenter(input);
  const dangerous = ["stock_search", "photo_request", "handoff"].includes(String(input.planned_action || ""));

  if (center.lead_reply_relation === "photo_acceptance") {
    return {
      action: "photo_request",
      intent: "photo_request",
      reason: `conversation_center_photo_acceptance:${center.pending_question}`,
      response_guidance: "O lead aceitou a oferta de fotos. Envie as fotos do veiculo em contexto; nao liste estoque novo e nao transfira.",
      search_query: null,
      search_filters: {},
      photo_target: null,
      use_memory_vehicle: true,
    };
  }

  if (center.lead_reply_relation === "options_acceptance") {
    return {
      action: "stock_search",
      intent: "stock_lookup",
      reason: `conversation_center_options_acceptance:${center.pending_question}`,
      response_guidance: "O lead aceitou ver opcoes/modelos. Consulte o estoque real respeitando o perfil ja salvo e apresente uma lista curta, sem repetir carros ja apresentados.",
      search_query: null,
      search_filters: { stock_broad: true },
      photo_target: null,
      use_memory_vehicle: true,
    };
  }

  if (!dangerous && !center.should_hold_track) return null;

  if (center.lead_reply_relation === "presence_ack") {
    return {
      action: "reply_only",
      intent: "small_talk",
      reason: "conversation_center_presence_ack",
      response_guidance: "O lead so confirmou presenca depois de um ping. Nao envie fotos de novo, nao liste estoque e nao transfira. Retome com uma pergunta util sobre o interesse dele.",
      search_query: null,
      search_filters: {},
      photo_target: null,
      use_memory_vehicle: true,
    };
  }

  if (center.lead_reply_relation === "finance_constraint") {
    return {
      action: "reply_only",
      intent: "financing",
      reason: `conversation_center_finance_constraint:${center.pending_question}`,
      response_guidance: "O lead respondeu a pergunta de entrada/financiamento. Nao liste carros, nao ofereca fotos e nao transfira. Acolha a restricao e pergunte qual parcela mensal ficaria confortavel, seguindo o funil.",
      search_query: null,
      search_filters: {},
      photo_target: null,
      use_memory_vehicle: false,
    };
  }

  if (center.lead_reply_relation === "trade_value_objection" || center.lead_reply_relation === "trade_details") {
    return {
      action: "reply_only",
      intent: "trade_in",
      reason: `conversation_center_trade_reply:${center.lead_reply_relation}:${center.pending_question}`,
      response_guidance: "O lead esta respondendo a etapa de troca. Nao transforme o carro da troca em busca de estoque, nao mande fotos e nao transfira. Registre/acolha a informacao e avance para a proxima pergunta do funil.",
      search_query: null,
      search_filters: {},
      photo_target: null,
      use_memory_vehicle: true,
    };
  }

  if (center.lead_reply_relation === "schedule_affirmation") {
    return {
      action: "reply_only",
      intent: "human_request",
      reason: `conversation_center_schedule_affirmation:${center.pending_question}`,
      response_guidance: "O lead confirmou interesse em agendar visita. Nao transfira em silencio e nao liste estoque. Peca o melhor dia e horario, ou os dados que faltam no funil de agendamento.",
      search_query: null,
      search_filters: {},
      photo_target: null,
      use_memory_vehicle: true,
    };
  }

  if (center.lead_reply_relation === "data_answer") {
    return {
      action: "reply_only",
      intent: "unknown",
      reason: `conversation_center_data_answer:${center.pending_question}`,
      response_guidance: "O lead respondeu uma pergunta de dados/agendamento. Nao busque estoque, nao mande fotos e nao transfira. Agradeca brevemente e avance para a proxima pergunta obrigatoria do funil.",
      search_query: null,
      search_filters: {},
      photo_target: null,
      use_memory_vehicle: true,
    };
  }

  return null;
}
