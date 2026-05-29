import { PedroV2Intent, PedroV2IntentResult, PedroV2LeadMemory } from "./types.ts";
import { PedroVehicleResolution } from "./vehicleResolver_20260525_brain.ts";

export type PedroBrainAction =
  | "reply_only"
  | "stock_search"
  | "photo_request"
  | "handoff"
  | "clarify";

export type PedroBrainPlan = {
  action: PedroBrainAction;
  intent: PedroV2Intent;
  confidence: number;
  search_query: string | null;
  search_filters: Record<string, any>;
  photo_target: string | null;
  use_memory_vehicle: boolean;
  response_guidance: string;
  reason: string;
  source: "llm" | "fallback";
};

const VALID_INTENTS: PedroV2Intent[] = [
  "stock_lookup",
  "price_question",
  "vehicle_reference",
  "photo_request",
  "financing",
  "trade_in",
  "location",
  "human_request",
  "seller_ack",
  "complaint",
  "small_talk",
  "unknown",
];

function normalizeText(value?: string | null) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isSimpleGreeting(message?: string | null) {
  const normalized = normalizeText(message);
  return /^(oi|ola|bom dia|boa tarde|boa noite|opa|e ai|tudo bem|td bem|blz|beleza)$/.test(normalized);
}

function isSocialQuestion(message?: string | null) {
  const normalized = normalizeText(message);
  return /\b(como voce ta|como voce esta|como vc ta|como vc esta|e voce|e vc|tudo bem contigo|tudo certo contigo|como vai)\b/.test(normalized) ||
    /\b(perguntei|perguntando)\b.*\b(como voce|como vc|voce ta|vc ta|voce esta|vc esta)\b/.test(normalized);
}

function isPhotoText(message?: string | null) {
  const normalized = normalizeText(message);
  return /\b(foto|fotos|imagem|imagens|painel|interior|banco|bancos|roda|rodas|porta malas|porta malas|traseira|frente|lateral|video)\b/.test(normalized);
}

function isAffirmativeText(message?: string | null) {
  const normalized = normalizeText(message);
  return /^(sim|s|ss|quero|pode|pode sim|pode mandar|manda|manda sim|envia|envia sim|claro|bora|vamos|ok|ta bom|beleza|blz)$/.test(normalized) ||
    /\b(pode mandar|manda pra mim|manda ai|me manda|envia pra mim|quero ver|quero sim|pode enviar)\b/.test(normalized);
}

function hasRecentPhotoOffer(input: {
  memory?: PedroV2LeadMemory | null;
  recent_history?: any[];
}) {
  const turns = [
    ...(Array.isArray(input.recent_history) ? input.recent_history : []),
    ...(Array.isArray(input.memory?.recent_turns) ? input.memory.recent_turns : []),
  ];
  const agentTurns = turns
    .slice(-12)
    .filter((turn) => {
      const role = String(turn?.role || turn?.direction || "").toLowerCase();
      return ["agent", "assistant", "consultor", "outgoing"].includes(role);
    })
    .slice(-5);

  return agentTurns.some((turn) => {
    const text = normalizeText(turn?.text || turn?.content || turn?.message || "");
    return /\b(quer|posso|te mando|mandar|envio|ver)\b.*\b(foto|fotos|imagem|imagens)\b/.test(text) ||
      /\b(foto|fotos|imagem|imagens)\b.*\b(dele|desse|deste|carro|veiculo|anuncio)\b/.test(text);
  });
}

function detectPhotoTarget(message?: string | null) {
  const normalized = normalizeText(message);
  if (/\b(roda|rodas|pneu|pneus|aro|calota)\b/.test(normalized)) return "wheel";
  if (/\b(painel|volante|multimidia|midia|cambio|console|comando|comandos)\b/.test(normalized)) return "dashboard";
  if (/\b(banco|bancos|estofado|assento|assentos)\b/.test(normalized)) return "seats";
  if (/\b(interior|interno|interna|dentro|por dentro)\b/.test(normalized)) return "interior";
  if (/\b(porta malas|porta-malas|bagageiro|mala)\b/.test(normalized)) return "trunk";
  if (/\b(traseira|traseiro|atras|fundo)\b/.test(normalized)) return "rear";
  if (/\b(lado|lateral|laterais)\b/.test(normalized)) return "side";
  if (/\b(frente|dianteira|dianteiro)\b/.test(normalized)) return "front";
  return "overview";
}

function adVehicleGuidance() {
  return [
    "Lead veio de anuncio/link/imagem com veiculo identificado.",
    "Consulte o estoque apenas para confirmar esse veiculo especifico.",
    "Nao liste alternativas, modelos similares ou catalogo sem o lead pedir.",
    "Depois da consulta, responda como consultor: apresente-se se for primeiro contato, confirme o carro do anuncio e pergunte se ele quer detalhes, fotos ou tem alguma duvida.",
  ].join(" ");
}

function hasRecentConversation(input: {
  memory?: PedroV2LeadMemory | null;
  recent_history?: any[];
}) {
  return (Array.isArray(input.recent_history) && input.recent_history.length >= 2) ||
    (Array.isArray(input.memory?.recent_turns) && input.memory.recent_turns.length >= 2);
}

function sanitizeModel(model?: string | null) {
  const raw = String(model || "").trim();
  if (!raw) return "gpt-4o";
  const withoutProvider = raw.includes("/") ? raw.split("/").pop() || raw : raw;
  if (/^(gpt-|o\d|chatgpt-)/i.test(withoutProvider)) return withoutProvider;
  return "gpt-4o";
}

function fallbackPlan(input: {
  message: string;
  memory?: PedroV2LeadMemory | null;
  heuristic_intent?: PedroV2IntentResult | null;
  ad_context?: any;
  media_context?: any;
  recent_history?: any[];
  vehicle_resolution: PedroVehicleResolution;
}): PedroBrainPlan {
  const heuristic = input.heuristic_intent;
  const vehicle = input.vehicle_resolution;
  const hasPresentedVehicles = Array.isArray(input.memory?.veiculos_apresentados) && input.memory.veiculos_apresentados.length > 0;
  const photo = isPhotoText(input.message);
  const acceptedPhotoOffer = isAffirmativeText(input.message) && hasRecentPhotoOffer(input);

  if (isSocialQuestion(input.message)) {
    return {
      action: "reply_only",
      intent: "small_talk",
      confidence: 0.9,
      search_query: null,
      search_filters: {},
      photo_target: null,
      use_memory_vehicle: false,
      response_guidance: "Cliente fez pergunta social sobre o consultor. Responda diretamente, sem se reapresentar e sem puxar estoque.",
      reason: "fallback_social_question",
      source: "fallback",
    };
  }

  if (heuristic?.needs_handoff || heuristic?.intent === "human_request") {
    return {
      action: "handoff",
      intent: "human_request",
      confidence: 0.78,
      search_query: null,
      search_filters: {},
      photo_target: null,
      use_memory_vehicle: false,
      response_guidance: "Cliente pediu humano/consultor. Responda curto e acione transferencia quando a regra permitir.",
      reason: "fallback_handoff",
      source: "fallback",
    };
  }

  if (acceptedPhotoOffer && hasPresentedVehicles && !vehicle.possible_new_topic) {
    return {
      action: "photo_request",
      intent: "photo_request",
      confidence: 0.91,
      search_query: vehicle.query,
      search_filters: {},
      photo_target: detectPhotoTarget(input.message),
      use_memory_vehicle: true,
      response_guidance: "Lead aceitou a oferta recente de fotos. Acione a tool de fotos usando o veiculo em contexto; nao prometa fotos sem enviar midia.",
      reason: "fallback_accepted_recent_photo_offer",
      source: "fallback",
    };
  }

  if (photo && hasPresentedVehicles && !vehicle.possible_new_topic) {
    return {
      action: "photo_request",
      intent: "photo_request",
      confidence: 0.86,
      search_query: vehicle.query,
      search_filters: {},
      photo_target: detectPhotoTarget(input.message),
      use_memory_vehicle: true,
      response_guidance: "Cliente pediu fotos do veiculo em contexto. Use somente as fotos do veiculo ja apresentado.",
      reason: "fallback_photo_from_memory",
      source: "fallback",
    };
  }

  if (vehicle.query && (vehicle.has_current_vehicle_signal || heuristic?.needs_stock_search)) {
    const adVehicle = Boolean(input.ad_context?.has_ad_context && input.ad_context?.vehicle_query && !hasRecentConversation(input));
    return {
      action: "stock_search",
      intent: photo ? "photo_request" : (heuristic?.intent || "stock_lookup"),
      confidence: Math.max(0.72, vehicle.confidence || heuristic?.confidence || 0),
      search_query: vehicle.query,
      search_filters: {
        ...(heuristic?.extracted?.interesse || {}),
        modelo_desejado: vehicle.query,
        tipo_veiculo: vehicle.vehicle_type || heuristic?.extracted?.interesse?.tipo_veiculo || null,
      },
      photo_target: photo ? detectPhotoTarget(input.message) : null,
      use_memory_vehicle: vehicle.used_memory,
      response_guidance: photo
        ? "Cliente pediu fotos, mas a mensagem atual traz outro veiculo ou nao ha contexto seguro. Consulte estoque antes de enviar fotos."
        : adVehicle
          ? adVehicleGuidance()
          : "Cliente falou de veiculo/estoque. Consulte estoque real antes de responder.",
      reason: `fallback_vehicle_resolution:${vehicle.reason}`,
      source: "fallback",
    };
  }

  if (input.ad_context?.has_ad_context && !input.ad_context?.vehicle_query) {
    return {
      action: "clarify",
      intent: "vehicle_reference",
      confidence: 0.68,
      search_query: null,
      search_filters: {},
      photo_target: null,
      use_memory_vehicle: false,
      response_guidance: "Lead veio de anuncio/link, mas nao foi possivel identificar o veiculo. Peca confirmacao curta ou print.",
      reason: "fallback_ad_without_vehicle",
      source: "fallback",
    };
  }

  if (isSimpleGreeting(input.message)) {
    const continuing = hasRecentConversation(input);
    return {
      action: "reply_only",
      intent: "small_talk",
      confidence: 0.82,
      search_query: null,
      search_filters: {},
      photo_target: null,
      use_memory_vehicle: false,
      response_guidance: continuing
        ? "Cumprimento em conversa existente. Responda naturalmente sem se reapresentar e retome o contexto com leveza."
        : "Primeiro contato comum. Seja humano, se apresente e faca uma pergunta aberta simples.",
      reason: continuing ? "fallback_greeting_existing_context" : "fallback_simple_greeting",
      source: "fallback",
    };
  }

  if (heuristic?.intent === "financing" || heuristic?.intent === "trade_in" || heuristic?.intent === "location") {
    return {
      action: "reply_only",
      intent: heuristic.intent,
      confidence: heuristic.confidence || 0.7,
      search_query: null,
      search_filters: {},
      photo_target: null,
      use_memory_vehicle: false,
      response_guidance: "Responda a duvida principal antes de puxar nova qualificacao.",
      reason: `fallback_${heuristic.intent}`,
      source: "fallback",
    };
  }

  return {
    action: "reply_only",
    intent: heuristic?.intent || "unknown",
    confidence: heuristic?.confidence || 0.45,
    search_query: null,
    search_filters: {},
    photo_target: null,
    use_memory_vehicle: false,
    response_guidance: "Responda como consultor humano. Se faltar informacao, faca uma pergunta curta.",
    reason: "fallback_reply_only",
    source: "fallback",
  };
}

function cleanJson(text: string) {
  return text.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
}

function normalizeIntent(value: any, fallback: PedroV2Intent): PedroV2Intent {
  const normalized = String(value || "").trim();
  return VALID_INTENTS.includes(normalized as PedroV2Intent)
    ? normalized as PedroV2Intent
    : fallback;
}

function normalizePlan(raw: any, fallback: PedroBrainPlan, input: {
  message: string;
  heuristic_intent?: PedroV2IntentResult | null;
  vehicle_resolution: PedroVehicleResolution;
  ad_context?: any;
  memory?: PedroV2LeadMemory | null;
  recent_history?: any[];
}): PedroBrainPlan {
  const action = ["reply_only", "stock_search", "photo_request", "handoff", "clarify"].includes(raw?.action)
    ? raw.action as PedroBrainAction
    : fallback.action;
  const intent = normalizeIntent(raw?.intent, fallback.intent);
  const searchQuery = typeof raw?.search_query === "string" && raw.search_query.trim()
    ? raw.search_query.trim()
    : fallback.search_query;
  const plan: PedroBrainPlan = {
    action,
    intent,
    confidence: Number.isFinite(Number(raw?.confidence)) ? Number(raw.confidence) : fallback.confidence,
    search_query: searchQuery,
    search_filters: raw?.search_filters && typeof raw.search_filters === "object" ? raw.search_filters : { ...(fallback.search_filters || {}) },
    photo_target: typeof raw?.photo_target === "string" ? raw.photo_target : fallback.photo_target,
    use_memory_vehicle: Boolean(raw?.use_memory_vehicle ?? fallback.use_memory_vehicle),
    response_guidance: typeof raw?.response_guidance === "string" ? raw.response_guidance : fallback.response_guidance,
    reason: typeof raw?.reason === "string" ? raw.reason : fallback.reason,
    source: "llm",
  };

  if (plan.search_query) {
    plan.search_filters = {
      ...(plan.search_filters || {}),
      modelo_desejado: plan.search_query,
    };
  }

  const vehicle = input.vehicle_resolution;
  const hasPresentedVehicles = Array.isArray(input.memory?.veiculos_apresentados) && input.memory.veiculos_apresentados.length > 0;
  const photo = isPhotoText(input.message);
  const acceptedPhotoOffer = isAffirmativeText(input.message) && hasRecentPhotoOffer(input);

  if (acceptedPhotoOffer && hasPresentedVehicles && !vehicle.possible_new_topic) {
    plan.action = "photo_request";
    plan.intent = "photo_request";
    plan.photo_target = detectPhotoTarget(input.message);
    plan.use_memory_vehicle = true;
    plan.reason = "enforced_accepted_recent_photo_offer";
    plan.response_guidance = "Lead aceitou a oferta recente de fotos. Acione a tool de fotos usando o veiculo em contexto; nao prometa fotos sem enviar midia.";
  }

  if (vehicle.has_current_vehicle_signal && vehicle.query) {
    plan.action = photo && hasPresentedVehicles && !vehicle.possible_new_topic ? "photo_request" : "stock_search";
    plan.search_query = vehicle.query;
    plan.search_filters = {
      ...(plan.search_filters || {}),
      modelo_desejado: vehicle.query,
      tipo_veiculo: vehicle.vehicle_type || plan.search_filters?.tipo_veiculo || null,
    };
    plan.use_memory_vehicle = vehicle.used_memory;
    plan.reason = `enforced_current_vehicle:${vehicle.reason}`;
  }

  if (input.ad_context?.has_ad_context && input.ad_context?.vehicle_query && vehicle.query && plan.action === "stock_search" && !hasRecentConversation(input)) {
    plan.intent = "vehicle_reference";
    plan.search_query = vehicle.query;
    plan.search_filters = {
      ...(plan.search_filters || {}),
      modelo_desejado: vehicle.query,
      tipo_veiculo: vehicle.vehicle_type || plan.search_filters?.tipo_veiculo || null,
    };
    plan.use_memory_vehicle = false;
    plan.response_guidance = adVehicleGuidance();
    plan.reason = `enforced_ad_vehicle_consultation:${vehicle.reason}`;
  }

  if (input.ad_context?.has_ad_context && !input.ad_context?.vehicle_query && !vehicle.query) {
    plan.action = "clarify";
    plan.intent = "vehicle_reference";
    plan.search_query = null;
    plan.use_memory_vehicle = false;
    plan.reason = "enforced_ad_without_vehicle";
  }

  if (photo && !hasPresentedVehicles && vehicle.query) {
    plan.action = "stock_search";
    plan.reason = `enforced_photo_needs_stock:${vehicle.reason}`;
  }

  if (isSimpleGreeting(input.message) && !input.ad_context?.has_ad_context && !vehicle.query) {
    const continuing = hasRecentConversation(input);
    plan.action = "reply_only";
    plan.intent = "small_talk";
    plan.search_query = null;
    plan.use_memory_vehicle = false;
    plan.response_guidance = continuing
      ? "Cumprimento em conversa existente. Nao se apresente de novo; responda como continuidade da conversa."
      : "Primeiro contato comum. Seja humano, se apresente e faca uma pergunta aberta simples.";
    plan.reason = continuing ? "enforced_greeting_existing_context" : "enforced_plain_greeting";
  }

  if (isSocialQuestion(input.message)) {
    plan.action = "reply_only";
    plan.intent = "small_talk";
    plan.search_query = null;
    plan.use_memory_vehicle = false;
    plan.response_guidance = "Responda a pergunta social do lead de forma humana; nao se apresente de novo.";
    plan.reason = "enforced_social_question";
  }

  // ETAPA C: preserva a decisao de HANDOFF do cerebro (lead qualificado/agendou/
  // pediu humano) contra as regras de veiculo/estoque acima. Pedido explicito de
  // FOTO ainda vence (intencao clara de imagem).
  if (raw?.action === "handoff" && plan.action !== "photo_request") {
    plan.action = "handoff";
    plan.intent = "human_request";
    plan.use_memory_vehicle = false;
    if (typeof raw?.response_guidance !== "string" || !raw.response_guidance.trim()) {
      plan.response_guidance = "Lead qualificado, agendou visita ou pediu um humano. Despeca-se de forma curta e amigavel avisando que um consultor de vendas vai entrar em contato em breve, e agradeca. Nao acione estoque nem prometa mais nada.";
    }
    plan.reason = `enforced_handoff:${raw?.reason || plan.reason || "qualificado"}`;
  }

  return plan;
}

export async function planPedroTurn(input: {
  agent?: any;
  message: string;
  enriched_message?: string | null;
  memory?: PedroV2LeadMemory | null;
  heuristic_intent?: PedroV2IntentResult | null;
  ad_context?: any;
  media_context?: any;
  recent_history?: any[];
  vehicle_resolution: PedroVehicleResolution;
}): Promise<PedroBrainPlan> {
  const fallback = fallbackPlan(input);
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) return fallback;

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: sanitizeModel(input.agent?.model),
        temperature: 0.1,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              [
                "Voce e o cerebro/orquestrador Pedro v2. Decida a proxima acao, sem escrever resposta final ao lead.",
                "Retorne JSON valido com: action, intent, confidence, search_query, search_filters, photo_target, use_memory_vehicle, response_guidance, reason.",
                "",
                "REGRAS DE RESOLUÇÃO DE VEÍCULOS (INTELIGÊNCIA SEMÂNTICA):",
                "- Identifique se a mensagem atual do lead (lead_message) ou o contexto recente cita algum veículo (marca, modelo ou versão), mesmo com erros graves de digitação, abreviações ou escrita fonética (ex: 'reguede' -> 'Jeep Renegade', 'tcross' -> 'Volkswagen T-Cross', 'oroqui' -> 'Renault Oroch', 'mini cuper' -> 'Mini Cooper').",
                "- Se um veículo for mencionado, defina 'action' como 'stock_search' (para buscar no estoque) e coloque o nome do veículo corrigido/canônico (Marca + Modelo, ex: 'Jeep Renegade') em 'search_query'.",
                "- Preencha em 'search_filters' o campo 'modelo_desejado' com o modelo correto e 'tipo_veiculo' com 'suv', 'pickup', 'hatch', 'sedan' ou 'moto'.",
                "- Não confie cegamente no 'vehicle_resolution' heurístico se você puder deduzir semanticamente o veículo correto a partir da mensagem do lead.",
                "",
                "REGRAS DE ORQUESTRAÇÃO GERAIS:",
                "- A mensagem atual do lead sempre vence o contexto da memória antiga (se ele mudou de carro, respeite o novo carro).",
                "- Se o lead pedir fotos de um veículo já apresentado ou em contexto seguro, defina 'action' como 'photo_request'.",
                "- Se o lead respondeu afirmativamente (sim/pode/manda) após uma oferta recente de fotos, defina 'action' como 'photo_request' com 'use_memory_vehicle' true.",
                "- Se for apenas uma saudação comum, use 'reply_only'.",
                "- Nunca invente que enviou fotos sem a ação 'photo_request'.",
                "",
                "REGRA DE TRANSFERÊNCIA (HANDOFF) — defina 'action' como 'handoff' quando:",
                "  (a) o lead AGENDOU ou quer agendar uma visita/test-drive (ex: 'quero agendar', 'posso ir aí?', 'marcar uma visita', 'vou aí ver', ou cita um dia/horário para ir à loja);",
                "  (b) o lead demonstrou que está PRONTO para fechar/comprar (ex: 'quero comprar', 'fechar negócio', 'pode preparar a proposta', ou já disse que tem carro na troca E quer dar entrada/financiar para seguir);",
                "  (c) o lead pediu explicitamente falar com um humano/vendedor/consultor.",
                "  Seja CONSERVADOR: interesse vago, dúvida de preço, pedir foto ou só perguntar sobre um modelo NÃO é handoff.",
                "  Em 'handoff', preencha 'response_guidance' orientando uma despedida curta e amigável avisando que um consultor de vendas vai entrar em contato e agradecendo — sem prometer mais nada e sem acionar estoque."
              ].join("\n"),
          },
          {
            role: "user",
            content: JSON.stringify({
              lead_message: input.message,
              enriched_message: input.enriched_message,
              memory: input.memory || {},
              heuristic_intent: input.heuristic_intent || null,
              ad_context: input.ad_context || null,
              media_context: input.media_context || null,
              recent_history: input.recent_history || [],
              vehicle_resolution: input.vehicle_resolution,
            }),
          },
        ],
      }),
    });

    if (!res.ok) return fallback;
    const data = await res.json();
    const content = String(data?.choices?.[0]?.message?.content || "{}");
    const parsed = JSON.parse(cleanJson(content));
    return normalizePlan(parsed, fallback, input);
  } catch (error) {
    console.warn("[PedroV2] brain planner fallback:", error);
    return fallback;
  }
}
