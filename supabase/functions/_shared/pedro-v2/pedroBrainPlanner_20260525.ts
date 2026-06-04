import { PedroV2Intent, PedroV2IntentResult, PedroV2LeadMemory } from "./types.ts";
import { PedroVehicleResolution } from "./vehicleResolver_20260525_brain.ts";
import { sumOpenAiTokens, UsageSink } from "./tokenMeter.ts";

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
  if (/\b(foto|fotos|fotinha|fotinhas|imagem|imagens|painel|interior|banco|bancos|roda|rodas|porta malas|traseira|frente|lateral|video|videos|catalog|catalogo|catalogos|album|albuns|albun)\b/.test(normalized)) return true;
  if (/\b(me mostra|me mostre|mostra (a|o|ele|ela|esse|essa|mais|umas|uma|foto|as))\b/.test(normalized) || /\bmostrar\b/.test(normalized)) return true;
  if (/\b(quero ver|queria ver|gostaria de ver|posso ver|da pra ver|deixa eu ver|consigo ver|tem como ver)\b/.test(normalized)) return true;
  if (/\bver (o carro|ele|ela|esse|essa|esse carro|mais|as foto|as fotos|as imagens|melhor)\b/.test(normalized)) return true;
  return false;
}

// Emojis positivos que, SOZINHOS, equivalem a um "sim" quando o lead esta reagindo
// a uma oferta ("quer ver as fotos?" -> 👍 = sim). normalizeText() apaga emojis
// (sao non-word), entao precisamos testar a string CRUA, antes de normalizar.
function hasPositiveEmoji(message?: string | null) {
  if (!message) return false;
  // 👍👍🏻..🏿 👌 ✅ ✔ 🙏 🔥 ❤ 😍 🙂 😊 😀 😁 👊 🤙 ✌ 🤩 🥳 💯
  return /[\u{1F44D}\u{1F44C}\u{2705}\u{2714}\u{1F64F}\u{1F525}\u{2764}\u{1F60D}\u{1F642}\u{1F60A}\u{1F600}\u{1F601}\u{1F44A}\u{1F919}\u{270C}\u{1F929}\u{1F973}\u{1F4AF}]/u.test(message);
}

function isAffirmativeText(message?: string | null) {
  // Emoji-afirmativo (👍, 👌, ✅, 🙏...) sozinho tambem conta como "sim". Testar ANTES
  // de normalizar, pois normalizeText() remove emojis. Caso classico: lead responde
  // so um 👍 a "quer ver as fotos?" e o agente ignorava.
  if (hasPositiveEmoji(message)) return true;
  const n = normalizeText(message);
  if (!n) return false;
  // Afirmativo ISOLADO ou no INICIO da frase. Antes exigia a palavra exata ("^sim$"),
  // entao "sim por favor", "sim quero", "claro que sim", "pode sim" NAO eram aceitos —
  // e o lead que respondia "Sim por favor" a uma oferta de foto NAO recebia as fotos.
  if (/^(sim|s|ss|claro|isso|isso ai|perfeito|com certeza|pode ser|aham|uhum|ok|ta bom|beleza|blz|bora|vamos|quero|queria|pode|manda|envia)\b/.test(n)) return true;
  if (/\b(pode mandar|pode sim|pode enviar|manda pra mim|manda ai|manda sim|me manda|me envia|envia pra mim|envia sim|quero ver|quero sim|quero as fotos|gostaria de ver)\b/.test(n)) return true;
  // "por favor" e suas abreviacoes/erros de digitacao comuns como afirmacao educada
  // ("sim, por favor" / "por favor" / "pf" / "pfv" / "porfa"). Caso do print: lead
  // respondeu "Pir favor" (erro de "Por favor") a uma oferta de foto e foi ignorado.
  if (/\b(por favor|porfavor|porfa|pfvr|pfv|pff)\b/.test(n)) return true;
  if (/^pf$/.test(n)) return true;
  // Mensagem CURTA contendo "favor" pega erros de digitacao de "por favor"
  // ("pir favor", "por favr", "por favo", "favor").
  const words = n.split(/\s+/).filter(Boolean);
  if (words.length <= 3 && /\bfavor\b/.test(n)) return true;
  return false;
}

// Resposta CURTA que SELECIONA qual veiculo o lead quer ver, em reacao a uma oferta
// de fotos ("qual voce quer ver, o 2024 ou o 2020?"). O lead responde so "2024",
// "o primeiro", "o preto" — e isso significa "manda as fotos DESSE". Sem isso, o
// agente nao reconhecia "2024" como pedido de foto e o lead saia sem as imagens.
function isPhotoSelectorReply(message?: string | null) {
  const n = normalizeText(message);
  if (!n) return false;
  if (n.split(/\s+/).filter(Boolean).length > 4) return false; // so respostas curtas
  return /\b(19|20)\d{2}\b/.test(n) // ano: 2024, 2020...
    || /\b(primeiro|segundo|terceiro|o 1|o 2|o 3|numero 1|numero 2|opcao 1|opcao 2|esse|este|esse ai|aquele)\b/.test(n)
    || /\b(preto|branco|prata|cinza|vermelho|azul|verde|dourado|bege|marrom|amarelo|laranja|vinho)\b/.test(n);
}

function hasRecentPhotoOffer(input: {
  memory?: PedroV2LeadMemory | null;
  recent_history?: any[];
}) {
  const turns = [
    ...(Array.isArray(input.recent_history) ? input.recent_history : []),
    ...(Array.isArray(input.memory?.recent_turns) ? input.memory.recent_turns : []),
  ];
  const agentTurns = turns.filter((turn) => {
    const role = String(turn?.role || turn?.direction || "").toLowerCase();
    return ["agent", "assistant", "consultor", "outgoing"].includes(role);
  });
  // SO a ULTIMA mensagem do agente conta como "oferta de foto" — e a mensagem que o
  // "sim/pode" do lead esta respondendo. Se o agente ja seguiu para a qualificacao
  // (ex: "tem carro na troca?"), um "sim" responde a ISSO, nao a uma oferta de foto.
  const lastAgent = agentTurns[agentTurns.length - 1];
  if (!lastAgent) return false;
  const text = normalizeText(lastAgent?.text || lastAgent?.content || lastAgent?.message || "");
  if (!text) return false;
  // Se a ultima msg do agente foi uma PERGUNTA DE QUALIFICACAO/agendamento, nao e oferta de foto.
  if (/\b(troca|entrada|pagamento|financ|cpf|nascimento|nome|loja|visita|test ?drive|orcamento|parcela|valor)\b/.test(text)) return false;
  // Conta como "contexto de foto" se a ultima msg do agente OFERECEU/perguntou OU
  // PROMETEU enviar fotos (ex.: "vou separar as fotos", "consigo te mandar as fotos").
  // Assim a resposta-seletora do lead ("2024", "o preto") e reconhecida como pedido.
  return (/\b(quer|posso|gostaria|deseja|quer que eu|te mando|posso te mostrar|vou mandar|vou enviar|vou separar|vou te mandar|consigo te mandar|consigo mandar|te envio|separar as fotos|qual.*ver primeiro)\b/.test(text) && /\b(foto|fotos|imagem|imagens|video|videos)\b/.test(text));
}

// Resume O QUE O AGENTE ACABOU DE FAZER na ultima fala, para o planner interpretar a
// resposta do lead EM RELACAO a isso. Sem esse sinal, "👍" / "2024" / "pode" / "pir favor"
// viravam intent="unknown" porque o LLM nao sabia a que estavam respondendo.
function getLastAgentText(input: {
  memory?: PedroV2LeadMemory | null;
  recent_history?: any[];
}): string {
  const turns = [
    ...(Array.isArray(input.recent_history) ? input.recent_history : []),
    ...(Array.isArray(input.memory?.recent_turns) ? input.memory.recent_turns : []),
  ];
  const agentTurns = turns.filter((turn) =>
    ["agent", "assistant", "consultor", "outgoing"].includes(String(turn?.role || turn?.direction || "").toLowerCase())
  );
  const last = agentTurns[agentTurns.length - 1];
  return String(last?.text || last?.content || last?.message || "");
}

// Classifica o TIPO da ultima pergunta/oferta do agente, para o planner interpretar
// respostas curtas/emojis EM CONTEXTO (regra #1 do prompt do planner).
function classifyPendingQuestion(input: {
  memory?: PedroV2LeadMemory | null;
  recent_history?: any[];
}): string {
  const raw = getLastAgentText(input);
  const t = normalizeText(raw);
  if (!t) return "nenhum";
  // Oferta/promessa de fotos tem prioridade (reaproveita a mesma deteccao do enforcement).
  if (hasRecentPhotoOffer(input)) return "ofereceu_fotos";
  if (/\b(a vista|financ|parcel|entrada|consorcio)\b/.test(t) && /\b(pretende|vai|forma|paga|pagar|prefere|quer)\b/.test(t)) return "perguntou_pagamento";
  if (/\b(troca|usado na troca|carro na troca|tem (um )?carro)\b/.test(t)) return "perguntou_troca";
  if (/\b(nome|cpf|nascimento|telefone|e mail|email|whatsapp)\b/.test(t)) return "perguntou_dados";
  if (/\b(qual (carro|modelo|veiculo)|que carro|qual veiculo|esta procurando|procura|tipo de carro|qual seria)\b/.test(t)) return "perguntou_veiculo";
  if (/[?]\s*$/.test(raw.trim())) return "fez_pergunta";
  return "afirmacao";
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
    "Lead veio de anuncio/link/imagem com veiculo identificado (veja ad_context: vehicle_query tem marca/modelo/ano; summary pode ter a cor e o preco do anuncio).",
    "Consulte o estoque para CONFIRMAR esse veiculo especifico.",
    "REGRA DE MATCH (MODELO manda): o que casa o anuncio com o estoque e o MODELO. O ANO do anuncio e frequentemente IMPRECISO (arte/metadado generico do Facebook) — trate-o como detalhe secundario, NUNCA como condicao de disponibilidade.",
    "Se o estoque TEM o mesmo MODELO do anuncio (mesmo que o ANO, a COR ou a versao/trim sejam diferentes da arte), ESSE e o carro: ABRA POSITIVAMENTE confirmando que TEM ('Temos um <modelo> aqui sim!') e informe os dados REAIS da unidade (ano, cor, km, preco do estoque). NUNCA abra com 'nao temos' nem trate a unidade como 'opcao proxima' so porque o ano do anuncio nao bate (so corrija o ano se o lead insistir).",
    "So diga honestamente que NAO tem quando NENHUMA unidade do MESMO MODELO existir no estoque. Nesse caso, sem inventar specs, ofereca o(s) parecido(s) como alternativa.",
    "Nao liste alternativas/catalogo sem o lead pedir.",
    "Responda como consultor: apresente-se se for 1o contato, confirme o carro do anuncio e pergunte se quer fotos/detalhes.",
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
  const acceptedPhotoOffer = (isAffirmativeText(input.message) || isPhotoSelectorReply(input.message)) && hasRecentPhotoOffer(input);

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

  // ── REDE DE SEGURANÇA: BUSCA DE VEÍCULO (restaurada — evidência real, caso Patricia) ──
  // O agente disse "não temos Jeep Compass" SEM TER BUSCADO — e há 3 Compass no estoque.
  // PROVADO nos turn-logs: turnos com veiculo referenciado vinham action=reply_generation,
  // filtros={}, stock_total=0 (a LLM escolheu reply_only e ALUCINOU a indisponibilidade).
  // Regra: se o lead REFERENCIA um veiculo resolvivel (has_current_vehicle_signal + query)
  // e a LLM ia apenas CONVERSAR (reply_only/clarify), FORCA stock_search — o agente NUNCA
  // pode afirmar disponibilidade ("temos"/"nao temos") sem ter consultado o estoque.
  // (photo_request e handoff NAO sao tocados; so promove reply_only/clarify -> stock_search.)
  const _vr = input.vehicle_resolution;
  if (_vr?.has_current_vehicle_signal && _vr?.query && (plan.action === "reply_only" || plan.action === "clarify")) {
    plan.action = "stock_search";
    plan.intent = plan.intent === "small_talk" ? "stock_lookup" : plan.intent;
    plan.search_query = _vr.query;
    plan.search_filters = {
      ...(plan.search_filters || {}),
      modelo_desejado: _vr.query,
      tipo_veiculo: _vr.vehicle_type || (plan.search_filters as any)?.tipo_veiculo || null,
    };
    plan.use_memory_vehicle = _vr.used_memory ?? plan.use_memory_vehicle;
    plan.reason = `enforced_current_vehicle_search:${plan.reason || ""}`;
  }

  // ── REDE DE SEGURANÇA: ACEITE DE FOTO (restaurada — evidência real, caso Renê) ──
  // O agente ofereceu fotos, o lead respondeu "👍🏼" + "Pir favor", e o PLANNER LLM
  // classificou como vehicle_reference (NAO photo_request) -> nenhuma foto saiu = venda
  // perdida (PROVADO em log real do lead Rene). O LLM erra justamente esse caso, entao
  // mantemos esta rede FINA: se o lead ACEITOU uma oferta RECENTE de fotos (afirmativo/
  // emoji/cor/ano DEPOIS de o agente oferecer fotos) e ha veiculos apresentados, FORCA
  // photo_request mesmo que o LLM tenha decidido outra coisa. Narrow e seguro:
  // hasRecentPhotoOffer exige que a ULTIMA fala do agente tenha oferecido fotos — nunca
  // dispara foto "do nada". (Demais enforcements do normalizePlan ficam a cargo do LLM.)
  const hasPresentedVehicles = Array.isArray(input.memory?.veiculos_apresentados) && input.memory.veiculos_apresentados.length > 0;
  const acceptedPhotoOffer = (isAffirmativeText(input.message) || isPhotoSelectorReply(input.message)) && hasRecentPhotoOffer(input);

  if (acceptedPhotoOffer && hasPresentedVehicles && !input.vehicle_resolution?.possible_new_topic) {
    plan.action = "photo_request";
    plan.intent = "photo_request";
    plan.use_memory_vehicle = true;
    plan.reason = `enforced_accepted_recent_photo_offer:${plan.reason || ""}`;
  }

  // Anti-envio acidental: impede que a LLM envie fotos do nada se o lead não pediu de fato
  const photo = isPhotoText(input.message);
  const photoSelectorReply = isPhotoSelectorReply(input.message) && hasPresentedVehicles;
  if (plan.action === "photo_request" && !photo && !acceptedPhotoOffer && !photoSelectorReply) {
    plan.action = "reply_only";
    plan.intent = "vehicle_reference";
    plan.use_memory_vehicle = false;
    plan.photo_target = null;
    plan.reason = `blocked_unrequested_photo:${plan.reason || ""}`;
    plan.response_guidance = "O lead não pediu fotos de forma explícita. Não envie imagens. Apenas responda conversando de forma humana e continue a qualificação ou tire dúvidas.";
  }

  return plan;
}

// Schema da SAIDA ESTRUTURADA do planner (OpenAI Structured Outputs, strict). Garante
// que action/intent/confidence sempre venham validos — sem regex parseando texto livre.
const PLAN_JSON_SCHEMA = {
  name: "pedro_plan",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["lead_interpretation", "action", "intent", "confidence", "search_query", "search_filters", "photo_target", "use_memory_vehicle", "response_guidance", "reason"],
    properties: {
      lead_interpretation: { type: "string", description: "Em 1 frase: como voce leu a mensagem do lead em relacao ao pending_question." },
      action: { type: "string", enum: ["reply_only", "stock_search", "photo_request", "handoff", "clarify"] },
      intent: { type: "string", enum: ["stock_lookup", "price_question", "vehicle_reference", "photo_request", "financing", "trade_in", "location", "human_request", "seller_ack", "complaint", "small_talk", "unknown"] },
      confidence: { type: "number" },
      search_query: { type: ["string", "null"] },
      search_filters: {
        type: "object",
        additionalProperties: false,
        required: ["modelo_desejado", "tipo_veiculo", "ano", "cor", "preco_max"],
        properties: {
          modelo_desejado: { type: ["string", "null"] },
          tipo_veiculo: { type: ["string", "null"], enum: ["suv", "pickup", "hatch", "sedan", "moto", null] },
          ano: { type: ["string", "null"] },
          cor: { type: ["string", "null"] },
          preco_max: { type: ["number", "null"] },
        },
      },
      photo_target: { type: ["string", "null"] },
      use_memory_vehicle: { type: "boolean" },
      response_guidance: { type: "string" },
      reason: { type: "string" },
    },
  },
};

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
  usage_sink?: UsageSink;
}): Promise<PedroBrainPlan> {
  const fallback = fallbackPlan(input);
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) return fallback;

  // SINAIS DETERMINISTICOS de contexto: o QUE o agente acabou de fazer (pending_question)
  // e o texto da ultima fala dele. Sem isso o LLM nao interpretava respostas curtas/emojis
  // ("👍", "2024", "sim", "pir favor") e caia em intent="unknown".
  const pendingQuestion = classifyPendingQuestion(input);
  const lastAgentMessage = getLastAgentText(input).slice(0, 400);

  const systemPrompt = [
    "Voce e o CEREBRO/orquestrador do Pedro v2 (consultor de vendas de carros). Sua tarefa e DECIDIR a proxima acao — NAO escreva a resposta final ao lead.",
    "Retorne JSON valido com: lead_interpretation, action, intent, confidence, search_query, search_filters, photo_target, use_memory_vehicle, response_guidance, reason.",
    "",
    "== REGRA #1 (A MAIS IMPORTANTE): INTERPRETE A MENSAGEM DO LEAD EM RELACAO AO QUE O AGENTE ACABOU DE FAZER ==",
    "O campo 'pending_question' diz o que o agente perguntou/ofereceu na ULTIMA fala ('last_agent_message' tem o texto). Uma resposta CURTA, um EMOJI ou algo ambiguo do lead RESPONDE a isso — NUNCA classifique como 'unknown' quando ha um pending_question claro:",
    "- pending_question='ofereceu_fotos': se o lead reagir de forma POSITIVA, CURTA ou com EMOJI (ex.: 'sim', 'pode', 'quero', 'manda', 'por favor', 'pf', '👍', '👌', '🙏', uma COR, um ANO tipo '2024', 'o primeiro', 'esse', 'isso') => action='photo_request', use_memory_vehicle=true. Vale mesmo com erro de digitacao ('pir favor', 'mostra ai').",
    "- pending_question='perguntou_pagamento': se o lead responder a forma de pagamento ('a vista', 'financiado', 'financiamento', 'troca', 'parcelado') => action='reply_only' e siga a qualificacao. NAO mande fotos.",
    "- pending_question='perguntou_troca'/'perguntou_dados'/'perguntou_veiculo': trate a resposta curta como resposta AQUELA pergunta (geralmente 'reply_only'; use 'stock_search' so se o lead citar um carro NOVO de interesse).",
    "- pending_question='nenhum'/'fez_pergunta': trate conforme o conteudo da mensagem.",
    "",
    "== EXEMPLOS (pending_question -> mensagem do lead -> action) ==",
    "ofereceu_fotos -> '👍' -> photo_request",
    "ofereceu_fotos -> 'Pir favor' -> photo_request",
    "ofereceu_fotos -> 'sim, pode mandar' -> photo_request",
    "ofereceu_fotos -> '2024' (escolhendo qual ver) -> photo_request",
    "ofereceu_fotos -> 'o preto' -> photo_request",
    "perguntou_pagamento -> 'financiamento' -> reply_only (segue qualificando, sem foto)",
    "perguntou_troca -> 'tenho um Onix 2019' -> reply_only (registra a troca; NAO troca o carro de interesse pelo carro da troca)",
    "nenhum -> 'oi, tudo bem?' -> reply_only",
    "qualquer -> 'quero falar com um vendedor' -> handoff",
    "",
    "== RESOLUCAO DE VEICULOS (INTELIGENCIA SEMANTICA) ==",
    "- Identifique se a mensagem atual do lead (lead_message) ou o contexto recente cita algum veiculo (marca, modelo ou versao), mesmo com erros graves de digitacao, abreviacoes ou escrita fonetica (ex: 'reguede' -> 'Jeep Renegade', 'tcross' -> 'Volkswagen T-Cross', 'oroqui' -> 'Renault Oroch', 'mini cuper' -> 'Mini Cooper').",
    "- Se um veiculo for mencionado, defina 'action'='stock_search' e coloque o nome canonico (Marca + Modelo, ex: 'Jeep Renegade') em 'search_query'.",
    "- Preencha 'search_filters.modelo_desejado' com o modelo e 'search_filters.tipo_veiculo' com 'suv','pickup','hatch','sedan' ou 'moto'.",
    "- Nao confie cegamente no 'vehicle_resolution' heuristico se voce puder deduzir semanticamente o veiculo a partir da mensagem do lead.",
    "",
    "== ORQUESTRACAO GERAL ==",
    "- A mensagem ATUAL do lead vence a memoria antiga (se ele mudou de carro, respeite o novo).",
    "- Pedido explicito de foto de veiculo ja apresentado/em contexto => 'photo_request'.",
    "- Nunca invente que enviou fotos sem a acao 'photo_request'.",
    "- 'confidence' = 0 a 1 (quao certo voce esta da acao). Use 'lead_interpretation' para explicar em 1 frase como leu a mensagem em relacao ao pending_question.",
    "",
    "== HANDOFF ==",
    "- Defina 'action'='handoff' SOMENTE quando o lead pediu EXPLICITAMENTE falar com um humano/vendedor/consultor (ex: 'quero falar com um vendedor', 'me passa pra um atendente').",
    "  ATENCAO — NAO e handoff aqui (use 'reply_only' e deixe o agente conduzir a QUALIFICACAO do System Prompt, uma pergunta por vez, ANTES de qualquer transferencia):",
    "  - querer comprar ('quero comprar', 'vou querer', 'fechar', 'gostei');",
    "  - querer AGENDAR visita/test-drive ('quero agendar', 'posso ir ai?', 'marcar visita') — o agente coleta dia/horario + dados antes;",
    "  - interesse vago, duvida de preco, pedir foto ou so perguntar sobre um modelo.",
    "  A decisao de transferir o lead JA QUALIFICADO e tomada na resposta (campo 'pronto_para_transferir' do brain), NAO aqui.",
    "  Em 'handoff', preencha 'response_guidance' orientando uma despedida curta avisando que um consultor de vendas vai entrar em contato e agradecendo — sem prometer mais nada e sem acionar estoque.",
  ].join("\n");

  const userPayload = JSON.stringify({
    lead_message: input.message,
    enriched_message: input.enriched_message,
    pending_question: pendingQuestion,
    last_agent_message: lastAgentMessage,
    memory: input.memory || {},
    heuristic_intent: input.heuristic_intent || null,
    ad_context: input.ad_context || null,
    media_context: input.media_context || null,
    recent_history: input.recent_history || [],
    vehicle_resolution: input.vehicle_resolution,
  });

  // OTIMIZACAO DE CUSTO: o planner e DECISAO ESTRUTURADA (temp 0.1), nao a resposta ao
  // cliente — roda em gpt-4o-mini (~16x mais barato). O reply continua em gpt-4o.
  const baseBody: Record<string, any> = {
    model: "gpt-4o-mini",
    temperature: 0.1,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPayload },
    ],
  };

  const callPlanner = async (responseFormat: any) =>
    await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ...baseBody, response_format: responseFormat }),
    });

  try {
    // 1) SAIDA ESTRUTURADA ESTRITA: o schema garante action/intent/confidence sempre validos.
    let res = await callPlanner({ type: "json_schema", json_schema: PLAN_JSON_SCHEMA });
    // 2) DEGRADACAO GRACIOSA: se a API rejeitar o schema, cai p/ json_object (o prompt
    //    melhorado segue valendo) e so depois p/ o fallback heuristico. Sem regressao.
    if (!res.ok) {
      console.warn(`[PedroV2] planner json_schema rejeitado (${res.status}); degradando p/ json_object`);
      res = await callPlanner({ type: "json_object" });
    }
    if (!res.ok) return fallback;
    const data = await res.json();
    if (input.usage_sink) input.usage_sink.tokens += sumOpenAiTokens(data);
    const content = String(data?.choices?.[0]?.message?.content || "{}");
    const parsed = JSON.parse(cleanJson(content));
    return normalizePlan(parsed, fallback, input);
  } catch (error) {
    console.warn("[PedroV2] brain planner fallback:", error);
    return fallback;
  }
}
