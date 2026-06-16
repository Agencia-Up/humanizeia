import { PedroV2Intent, PedroV2IntentResult, PedroV2LeadMemory } from "./types.ts";
import { PedroVehicleResolution } from "./vehicleResolver_20260525_brain.ts";
import { sumOpenAiTokens, UsageSink } from "./tokenMeter.ts";
import { keyFromCtx, recordProviderError, AiKeyCtx } from "../aiKeys.ts";

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
  // Tira placeholders do sistema ("[imagem recebida]" etc.) antes de detectar: "imagem" dentro
  // deles NAO e pedido de foto do lead (ver normalizePhotoText no orchestrator).
  const normalized = normalizeText(String(message || "").replace(/\[[^\]]*\]/g, " "));
  if (/\b(foto|fotos|fotinha|fotinhas|imagem|imagens|painel|interior|banco|bancos|roda|rodas|porta malas|traseira|frente|lateral|catalog|catalogo|catalogos|album|albuns|albun)\b/.test(normalized)) return true;
  if (/\b(me mostra|me mostre|mostra (a|o|ele|ela|esse|essa|mais|umas|uma|foto|as))\b/.test(normalized) || /\bmostrar\b/.test(normalized)) return true;
  if (/\b(quero ver|queria ver|gostaria de ver|posso ver|da pra ver|deixa eu ver|consigo ver|tem como ver)\b/.test(normalized)) return true;
  if (/\bver (o carro|ele|ela|esse|essa|esse carro|mais|as foto|as fotos|as imagens|melhor)\b/.test(normalized)) return true;
  return false;
}

// Palavras GENERICAS de estoque: se o "modelo" resolvido e composto SO por estas, nao e um
// modelo de verdade (o lead so quer "ver o que tem"). Conjunto finito e estavel (NAO typos).
const GENERIC_STOCK_WORDS = new Set([
  "carro", "carros", "veiculo", "veiculos", "automovel", "automoveis", "auto", "autos",
  "mais", "outro", "outros", "outra", "outras", "algum", "alguns", "alguma", "algumas",
  "qualquer", "quaisquer", "opcao", "opcoes", "modelo", "modelos", "disponivel", "disponiveis",
  "estoque", "novo", "novos", "usado", "usados", "seminovo", "seminovos",
]);

// ELOGIO/COMENTARIO puro sobre carro ("lindo esse carro", "gostei dos carros") NAO e pedido de
// busca — e conversa. Achado em log real: viravam busca a toa porque "carro" e tratado como
// sinal de veiculo. Aqui detectamos elogio SEM pedido de info, p/ deixar o cerebro conversar.
function isPureVehicleComment(message?: string | null) {
  const n = normalizeText(message);
  if (!n) return false;
  const hasCompliment = /\b(lindo|linda|lindos|lindas|gostei|gostl|amei|adorei|maravilhoso|maravilhosa|perfeito|perfeita|top|show|massa|bonito|bonita|belo|bela|legal|otimo|otima|incrivel|sensacional|esp?etacular|que carro|que maquina)\b/.test(n);
  if (!hasCompliment) return false;
  // se junto houver QUALQUER pedido de info/compra/foto, NAO e so comentario -> segue o fluxo normal.
  const hasRequest = /\b(tem|temos|quero|queria|gostaria|procuro|busco|preciso|mostra|mostrar|ver|quanto|preco|valor|km|ano|disponivel|financia|financiar|parcela|entrada|comprar|agendar|visita|foto|fotos|qual|quais|outro|outros|mais)\b/.test(n);
  return !hasRequest;
}

function hasStockQuestionSignal(message?: string | null) {
  const normalized = normalizeText(message);
  if (!normalized) return false;
  if (/\b(km|quilometragem|rodado|rodagem|ano|valor|preco|quanto|custa|disponivel|estoque|tem|venderam|vendeu|diesel|disel|automatico|manual)\b/.test(normalized)) return true;
  if (/\b(qual outro|outro|outra|opcao|opcoes|parecido|similar|semelhante|o que tiver|que tiver)\b/.test(normalized)) return true;
  if (/\b(picape|pickup|caminhonete|camionete|suv|sedan|hatch)\b/.test(normalized)) return true;
  // pedido de SUGESTAO de CARRO ou carro por Nº de portas => pergunta de estoque.
  if (isSuggestVehicleRequest(normalized)) return true;
  return false;
}

// Pedido de SUGESTAO/indicacao que e REALMENTE sobre veiculo. Evita o VAZAMENTO DE ESCOPO achado em
// prod ("me indica uma cerveja" virava busca de estoque por causa de "indica"): bare ("pode sugerir")
// ou com contexto de veiculo CONTA; recomendacao com objeto NAO-veicular (cerveja/pizza...) NAO conta.
function isSuggestVehicleRequest(normalized: string): boolean {
  if (!normalized) return false;
  // (a) pedidos BARE — num bot de carro, sem objeto = sobre carro.
  if (/\b(pode sugerir|me ajuda a escolher|o que (voce )?(tem|recomenda|sugere|indica|tiver))\b/.test(normalized)) return true;
  // (b) mostrar / quais / quero ver + objeto de ESTOQUE.
  if (/\b(me mostra|mostra|quais|quero ver|me passa)\b.{0,14}\b(opcoes|opcao|carros|veiculos|modelos|seminovos|usados|disponiveis)\b/.test(normalized)) return true;
  // (c) sugerir/recomendar/indicar COM contexto de veiculo na mensagem.
  if (/\b(sugere|sugira|sugerir|sugestao|sugestoes|recomenda|recomende|recomendar|indica|indique)\b/.test(normalized)
      && /\b(carro|carros|veiculo|veiculos|automovel|automoveis|modelo|modelos|suv|sedan|hatch|pickup|picape|caminhonete|moto|seminovo|seminovos|usado|usados|novo|novos|opcao|opcoes)\b/.test(normalized)) return true;
  // (d) carro por Nº de portas.
  if (/\b(\d+|duas|dois|tres|quatro|cinco)\s*portas\b/.test(normalized)) return true;
  // (e) recomendacao/escolha + FAIXA DE PRECO: num bot de carro, "me indica algo ate 80 mil" /
  //     "quero algo ate 50k" = pedido de veiculo por ORCAMENTO. O preco e o contexto que
  //     desambigua (ninguem pede "uma cerveja ate 80 mil") -> e busca de estoque por orcamento.
  if (/\b(sugere|sugira|sugerir|recomenda|recomende|indica|indique|me mostra|mostra|quero|queria|procuro|busco|tem)\b/.test(normalized)
      && /(\bate\b|\bpor\b|r\$).{0,8}\d|\b\d+\s*mil\b/.test(normalized)) return true;
  return false;
}

function asksBroadStock(message?: string | null) {
  const normalized = normalizeText(message);
  if (!normalized) return false;
  return /\b(o que tiver|que tiver|qualquer um|qualquer carro|opcoes|opcao|outros modelos|qual outro|outro modelo|tem em estoque|tem ai|tem disponivel)\b/.test(normalized)
    || /\b(quero|procuro|busco|preciso|tem|temos|gostaria)\b.{0,30}\b(picape|pickup|caminhonete|camionete|suv|sedan|hatch)\b/.test(normalized)
    || isSuggestVehicleRequest(normalized);
}

function memoryVehicleQuery(memory?: PedroV2LeadMemory | null) {
  return String(
    memory?.interesse?.modelo_desejado ||
    memory?.referencia?.veiculo_citado ||
    memory?.veiculos_apresentados?.[0]?.label ||
    [memory?.veiculos_apresentados?.[0]?.marca, memory?.veiculos_apresentados?.[0]?.modelo].filter(Boolean).join(" ") ||
    ""
  ).trim() || null;
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

// Lead quer um veiculo MAIS BARATO que o em foco (ex.: viu Polo R$110k e respondeu
// "queria um mais barato"). NAO e aceite de foto NEM do veiculo em foco — e um pedido
// para mostrar opcoes mais em conta. (caso real 5512974108975.)
function wantsCheaperVehicle(message?: string | null) {
  const n = normalizeText(message);
  if (!n) return false;
  return /\b(mais barat[oa]s?|mais em conta|baratinh[oa]|mais economic[oa]s?|mais acessivel|preco menor|menor preco|mais baix[oa] de preco|abaixo dele|abaixo desse|gastar menos|mais conta)\b/.test(n);
}

// Lead pede explicitamente OUTRO veiculo / nao gostou do em foco. Tambem invalida o
// aceite de foto (a palavra "queria/quero" no inicio nao pode disparar foto do carro
// que ele esta justamente recusando).
function wantsOtherVehicle(message?: string | null) {
  const n = normalizeText(message);
  if (!n) return false;
  return /\b(outro carro|outra opcao|outras opcoes|outro modelo|outros modelos|tem outro|tem outra|outro veiculo|prefiro outro|prefiro outra|queria outro|queria outra|quero outro|quero outra|um diferente|nao quero esse|nao gostei desse|nao gostei dele|nao curti esse)\b/.test(n);
}

// Aceite de foto/veiculo em foco NAO vale quando o lead, na mesma fala, redireciona
// para OUTRO veiculo ou para um MAIS BARATO. (Bug: "queria um mais barato" comecava
// com "queria" -> isAffirmativeText=true -> forcava foto do carro recusado.)
function expressesOtherVehicleWish(message?: string | null) {
  return wantsCheaperVehicle(message) || wantsOtherVehicle(message);
}

// Lead esta OFERECENDO o carro DELE na troca (nao quer comprar o carro que citou).
// "Seria trocar com minha Strada 2022", "tenho um Onix pra trocar", "aceita na troca?".
// Distinto de "trocar meu Gol POR um Civic" (= interesse num carro NOVO -> buscar).
function isTradeInOffer(message?: string | null, heuristicIntent?: string | null) {
  const n = normalizeText(message);
  if (!n) return false;
  const mentionsTrade = heuristicIntent === "trade_in" || /\b(troc\w+|na troca)\b/.test(n);
  if (!mentionsTrade) return false;
  // Se aponta um carro NOVO de interesse (trocar POR / interesse no/na), NAO bloquear a busca.
  const wantsNew = /\b(por|pel[oa])\s+(um|uma|uns|umas|outro|outra|outros|outras|o|a|esse|essa|este|esta)\b/.test(n)
    || /\b(troc\w+|interesse)\s+(por|pel[oa]|no|na)\b/.test(n)
    || /\b(quero|queria|gostaria de|prefiro|me interessa|fiquei de olho n[oa])\s+(um|uma|o|a|outro|outra)\b/.test(n);
  return !wantsNew;
}

// Resposta CURTA que SELECIONA qual veiculo o lead quer ver, em reacao a uma oferta
// de fotos ("qual voce quer ver, o 2024 ou o 2020?"). O lead responde so "2024",
// "o primeiro", "o preto" — e isso significa "manda as fotos DESSE". Sem isso, o
// agente nao reconhecia "2024" como pedido de foto e o lead saia sem as imagens.
function isPhotoSelectorReply(message?: string | null) {
  const n = normalizeText(String(message || "").replace(/\[[^\]]*\]/g, " "));
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

// O agente ofereceu MOSTRAR opcoes/carros/modelos (NAO fotos, NAO qualificacao) na ULTIMA fala?
// Ex.: "Posso te mostrar outras opcoes de hatch?", "Quer ver os modelos que temos?". Usado pra
// interpretar um "Ok"/"sim" do lead como ACEITE -> APRESENTAR o estoque (e nao se despedir).
// Caso real lead Jefferson: agente ofereceu "outras opcoes de hatch", lead respondeu "Ok" e o
// agente se DESPEDIU ("nao vou tomar seu tempo") = lead quente perdido.
function hasRecentOptionsOffer(input: {
  memory?: PedroV2LeadMemory | null;
  recent_history?: any[];
}) {
  const t = normalizeText(getLastAgentText(input));
  if (!t) return false;
  if (/\b(troca|entrada|pagamento|financ|cpf|nascimento|visita|test ?drive|parcela)\b/.test(t)) return false;
  if (/\b(foto|fotos|imagem|imagens|video|videos)\b/.test(t)) return false;
  const offers = /\b(posso te mostrar|posso mostrar|quer ver|gostaria de ver|te mostro|vou te mostrar|posso te apresentar|quer que eu (te )?mostre|posso sugerir|posso te indicar|posso te oferecer)\b/.test(t);
  const things = /\b(opcao|opcoes|alternativa|alternativas|carro|carros|modelo|modelos|hatch|sedan|suv|picape|veiculo|veiculos|o que temos|nosso estoque|estoque|disponiveis)\b/.test(t);
  return offers && things;
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
  // Oferta de MOSTRAR opcoes/carros: um "ok"/"sim" depois disso = ACEITE (apresentar), nao despedida.
  if (hasRecentOptionsOffer(input)) return "ofereceu_opcoes";
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
  const acceptedPhotoOffer = (isAffirmativeText(input.message) || isPhotoSelectorReply(input.message)) && hasRecentPhotoOffer(input) && !expressesOtherVehicleWish(input.message);

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

  if (hasStockQuestionSignal(input.message) && !["trade_in", "financing", "location"].includes(String(heuristic?.intent || ""))) {
    const broadStock = asksBroadStock(input.message);
    const memoryVehicle = memoryVehicleQuery(input.memory);
    if (broadStock || memoryVehicle || heuristic?.needs_stock_search) {
      return {
        action: "stock_search",
        intent: heuristic?.intent === "unknown" ? "stock_lookup" : (heuristic?.intent || "stock_lookup"),
        confidence: Math.max(0.72, heuristic?.confidence || 0),
        search_query: broadStock ? null : memoryVehicle,
        search_filters: {
          ...(heuristic?.extracted?.interesse || {}),
          ...(broadStock ? { stock_broad: true } : { modelo_desejado: memoryVehicle }),
        },
        photo_target: null,
        use_memory_vehicle: !broadStock && Boolean(memoryVehicle),
        response_guidance: broadStock
          ? "Cliente pediu opcoes/estoque de forma ampla. Consulte o estoque real e apresente poucas opcoes relevantes; nao diga que precisa de modelo especifico."
          : "Cliente perguntou dado objetivo do veiculo em contexto. Consulte o estoque real antes de responder valor, ano, km ou disponibilidade.",
        reason: broadStock ? "fallback_broad_stock_question" : "fallback_memory_vehicle_stock_question",
        source: "fallback",
      };
    }
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

  const _heurIntent = String(input.heuristic_intent?.intent || "");
  // ── TROCA: lead OFERECE o carro dele (nao quer comprar o que citou) — caso 5512997468490 ──
  // "Seria trocar com outra estrada 2022" virava busca de "strada 2022" -> "nao temos no estoque".
  // E uma TROCA: o carro citado e o usado DELE, nao um novo interesse. Forca trade_in/reply_only.
  if (isTradeInOffer(input.message, _heurIntent)) {
    plan.action = "reply_only";
    plan.intent = "trade_in";
    plan.search_query = null;
    plan.use_memory_vehicle = true;
    plan.search_filters = {};
    plan.photo_target = null;
    plan.reason = `enforced_trade_in_offer:${plan.reason || ""}`;
    plan.response_guidance = "O lead esta OFERECENDO o carro DELE na TROCA (nao quer COMPRAR o carro que ele citou). NUNCA diga que 'nao temos' o carro que ele mencionou e NAO busque ele no estoque. Reconheca a troca de forma positiva (avaliamos o usado dele na troca), mantenha o foco no veiculo do anuncio/interesse, e siga: pergunte detalhes do usado (modelo/ano/km/versao) OU encaminhe pra avaliacao. Nao invente valor de avaliacao.";
  }
  // ── MAIS BARATO: lead achou o carro em foco caro e quer opcoes mais em conta — caso 5512974108975 ──
  // "Queria um mais barato" comecava com "queria" -> isAffirmativeText -> forcava FOTO do carro caro,
  // e nunca buscava alternativas. Agora vira busca AMPLA capada pelo preco do foco / orcamento conhecido.
  else if (wantsCheaperVehicle(input.message)) {
    const presented = Array.isArray(input.memory?.veiculos_apresentados) ? input.memory.veiculos_apresentados : [];
    const focus = presented[presented.length - 1] || presented[0] || null;
    const focusPrice = Number((focus as any)?.preco) || null;
    const budget = Number((input.memory?.interesse as any)?.preco_max) || null;
    const caps = [focusPrice, budget].filter((v) => v && v > 0) as number[];
    const precoMax = caps.length ? Math.min(...caps) : null;
    const tipo = (input.memory?.interesse as any)?.tipo_veiculo || plan.search_filters?.tipo_veiculo || null;
    plan.action = "stock_search";
    plan.intent = "stock_lookup";
    plan.search_query = null;
    plan.use_memory_vehicle = false;
    plan.photo_target = null;
    plan.search_filters = {
      ...(plan.search_filters || {}),
      // flag lida pelo orquestrador: faz busca LIMPA por tipo+preco (sem poluicao de
      // ad_context/interesse velho, que zerava a busca ampla em leads existentes).
      cheaper_followup: true,
      modelo_desejado: null,
      tipo_veiculo: tipo,
      ...(precoMax ? { preco_max: precoMax } : {}),
    };
    plan.reason = `enforced_cheaper_followup:${plan.reason || ""}`;
    plan.response_guidance = "O lead achou o veiculo em foco CARO e quer um MAIS BARATO. NAO reapresente o caro nem mande fotos dele. Mostre 2-4 opcoes REAIS do estoque MAIS BARATAS (priorize as de MENOR preco), do mesmo tipo quando fizer sentido, e pergunte se alguma agrada. NAO pergunte 'qual marca/ano' sem antes MOSTRAR opcoes.";
  }
  // ── CALLBACK: lead pediu pra LIGAR ("me liga") — NAO transfere lead cru; qualifica antes ──
  else if (_heurIntent === "callback_request" || /\b(me liga|me ligar|pode (me )?ligar|liga pra mim|me chama|prefiro ligacao|liga(r)? mais tarde)\b/.test(normalizeText(input.message))) {
    plan.action = "reply_only";
    plan.intent = "human_request";
    plan.use_memory_vehicle = false;
    plan.search_query = null;
    plan.photo_target = null;
    plan.reason = `enforced_callback_qualify:${plan.reason || ""}`;
    plan.response_guidance = "O lead pediu pra um consultor LIGAR. Confirme de forma calorosa que SIM, um consultor pode ligar — MAS antes pegue o que falta pra passar um bom atendimento: o NOME e o que ele procura (modelo/tipo ou faixa de preco). NAO transfira agora nem prometa horario exato; deixe claro que o consultor entra em contato. Uma pergunta curta de cada vez.";
  }

  // ── REDE DE SEGURANÇA: BUSCA DE VEÍCULO (restaurada — evidência real, caso Patricia) ──
  // O agente disse "não temos Jeep Compass" SEM TER BUSCADO — e há 3 Compass no estoque.
  // ── REDE DE SEGURANÇA: BUSCA DE VEÍCULO (restaurada — evidência real, caso Patricia) ──
  // O agente disse "não temos Jeep Compass" SEM TER BUSCADO — e há 3 Compass no estoque.
  // PROVADO nos turn-logs: turnos com veiculo referenciado vinham action=reply_generation,
  // filtros={}, stock_total=0 (a LLM escolheu reply_only e ALUCINOU a indisponibilidade).
  // Regra: se o lead REFERENCIA um veiculo resolvivel (has_current_vehicle_signal + query)
  // ou se a LLM identificou um modelo_desejado/search_query e a LLM ia apenas CONVERSAR
  // (reply_only/clarify), FORCA stock_search — o agente NUNCA pode afirmar disponibilidade
  // ("temos"/"nao temos") sem ter consultado o estoque.
  // (photo_request e handoff NAO sao tocados; so promove reply_only/clarify -> stock_search.)
  const _vr = input.vehicle_resolution;
  const hasLlmVehicle = !!plan.search_query || !!plan.search_filters?.modelo_desejado;
  const stockQuestion = hasStockQuestionSignal(input.message);
  const broadStockQuestion = asksBroadStock(input.message);
  const memoryVehicle = memoryVehicleQuery(input.memory);
  // A rede so deve forcar busca quando o lead esta PERGUNTANDO disponibilidade/preco de veiculo.
  // Intencoes que NAO sao isso (financiamento, agendamento, localizacao, troca, despedida, etc.)
  // nao podem virar busca so porque ha um carro na memoria — senao o agente re-busca e cospe fotos
  // no meio de uma conversa de financiamento (caso real 98863-4239: "quero ver financiamento" -> 5 fotos).
  const intentNaoEhBuscaDeVeiculo = [
    "trade_in", "financing", "payment", "scheduling", "schedule", "visit", "agendamento",
    "location", "small_talk", "greeting", "handoff", "human_request", "seller_ack",
    "goodbye", "farewell", "thanks", "objection",
  ].includes(String(plan.intent || ""));
  if ((_vr?.has_current_vehicle_signal || hasLlmVehicle) && !intentNaoEhBuscaDeVeiculo && !isPureVehicleComment(input.message) && (plan.action === "reply_only" || plan.action === "clarify")) {
    plan.action = "stock_search";
    plan.intent = plan.intent === "small_talk" ? "stock_lookup" : plan.intent;
    if (!plan.search_query) {
      plan.search_query = _vr?.query || plan.search_filters?.modelo_desejado || null;
    }
    plan.search_filters = {
      ...(plan.search_filters || {}),
      modelo_desejado: plan.search_query || _vr?.query || null,
      tipo_veiculo: plan.search_filters?.tipo_veiculo || _vr?.vehicle_type || null,
    };
    plan.use_memory_vehicle = _vr?.used_memory ?? plan.use_memory_vehicle;
    plan.reason = `enforced_llm_or_heuristic_vehicle_search:${plan.reason || ""}`;
  }

  if (stockQuestion && plan.intent !== "trade_in" && (plan.action === "reply_only" || plan.action === "clarify")) {
    const resolvedVehicle = plan.search_query || _vr?.query || plan.search_filters?.modelo_desejado || memoryVehicle || null;
    // Pergunta de estoque SEM modelo definido (ex.: "qual o valor que voce tem?") => mostrar estoque
    // como busca AMPLA. Nunca rodar busca vazia que devolve "nao temos nenhum veiculo".
    const effectiveBroad = broadStockQuestion || !resolvedVehicle;
    plan.action = "stock_search";
    plan.intent = plan.intent === "small_talk" || plan.intent === "unknown" ? "stock_lookup" : plan.intent;
    plan.search_query = effectiveBroad ? null : resolvedVehicle;
    plan.search_filters = {
      ...(plan.search_filters || {}),
      ...(effectiveBroad ? { stock_broad: true } : {}),
      modelo_desejado: effectiveBroad ? null : resolvedVehicle,
      tipo_veiculo: plan.search_filters?.tipo_veiculo || _vr?.vehicle_type || null,
    };
    plan.use_memory_vehicle = !effectiveBroad && Boolean(_vr?.used_memory || memoryVehicle || plan.use_memory_vehicle);
    plan.reason = `enforced_stock_question_search${effectiveBroad ? "_broad" : ""}:${plan.reason || ""}`;
  }

  // ── B1: "modelo" GENERICO (carros/veiculos/mais/outros) => BUSCA AMPLA, nunca busca vazia ──
  // Achado em log REAL: "Vc tem mais carros" devolvia 0 ("qual modelo?") mesmo com 24 carros.
  // O resolver as vezes extrai um "modelo" lixo ("carros") que nao casa com nada -> 0 result.
  // Criterio SISTEMICO (conjunto finito e estavel, NAO lista de typo): se o termo resolvido
  // e composto SO de palavras genericas de estoque, nao e modelo de verdade => mostrar estoque.
  // Um modelo plausivel fora do estoque (ex.: "palio") NAO e generico => segue p/ "nao temos" (correto).
  if (plan.action === "stock_search" && !plan.search_filters?.stock_broad) {
    const f = plan.search_filters || {};
    const resolvedModelB1 = String(plan.search_query || _vr?.query || f.modelo_desejado || "").trim();
    const tokensB1 = normalizeText(resolvedModelB1).split(/\s+/).filter(Boolean);
    const onlyGenericB1 = tokensB1.length === 0 || tokensB1.every((t) => GENERIC_STOCK_WORDS.has(t));
    const hasPriceB1 = [f.preco_max, f.preco_min, f.orcamento, f.preco, f.budget].some(
      (v) => v !== null && v !== undefined && v !== "",
    );
    // tipo_veiculo so conta se o lead REALMENTE citou o tipo na fala. O gpt-4o-mini as vezes
    // ALUCINA tipo_veiculo:"suv" num "tem mais carros" generico -> isso travava o B1 e ainda
    // filtrava a busca ampla so por SUV. Se nao ha palavra de tipo na mensagem, ignoramos o tipo.
    const typeWordInMsgB1 = /\b(picape|pickup|caminhonete|camionete|suv|sedan|hatch|utilitario|conversivel|cupe|coupe|perua|minivan|van|moto|motos|motocicleta)\b/.test(
      normalizeText(input.message),
    );
    const hasTypeB1 = Boolean(f.tipo_veiculo) && typeWordInMsgB1;
    const hasMemoryModelB1 = Boolean(memoryVehicle); // "tem mais?" com carro na memoria: deixa o fluxo normal
    // B1/B2: sem modelo real => busca AMPLA. Vale TAMBEM quando ha so faixa de preco (sem modelo):
    // achado em log real que "carro de 60 a 70 mil" voltava 0 mesmo com 8 carros na faixa, porque
    // sem modelo o fluxo caia em "qual modelo?" e DESCARTAVA o preco. Aqui mantemos o preco no
    // broad (mostra o estoque dentro do orcamento). So o tipo ALUCINADO e limpo.
    if (onlyGenericB1 && !hasTypeB1 && !hasMemoryModelB1) {
      plan.search_query = null;
      plan.search_filters = { ...f, stock_broad: true, modelo_desejado: null, tipo_veiculo: null };
      plan.use_memory_vehicle = false;
      plan.reason = `enforced_broad_no_model${hasPriceB1 ? "_price" : ""}:${plan.reason || ""}`;
    }
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
  const acceptedPhotoOffer = (isAffirmativeText(input.message) || isPhotoSelectorReply(input.message)) && hasRecentPhotoOffer(input) && !expressesOtherVehicleWish(input.message);

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
    if (stockQuestion) {
      plan.action = "stock_search";
      plan.intent = plan.intent === "photo_request" ? "stock_lookup" : plan.intent;
      plan.search_query = broadStockQuestion ? null : (plan.search_query || _vr?.query || memoryVehicle || null);
      plan.search_filters = {
        ...(plan.search_filters || {}),
        ...(broadStockQuestion ? { stock_broad: true } : {}),
        modelo_desejado: broadStockQuestion ? null : (plan.search_query || _vr?.query || memoryVehicle || null),
      };
      plan.use_memory_vehicle = !broadStockQuestion && Boolean(memoryVehicle || plan.use_memory_vehicle);
      plan.photo_target = null;
      plan.reason = `blocked_unrequested_photo_to_stock_search:${plan.reason || ""}`;
      plan.response_guidance = "O lead nao pediu fotos, mas pediu estoque/opcoes/dados do veiculo. Consulte estoque real e responda sem enviar imagens.";
    } else {
      plan.action = "reply_only";
      plan.intent = "vehicle_reference";
      plan.use_memory_vehicle = false;
      plan.photo_target = null;
      plan.reason = `blocked_unrequested_photo:${plan.reason || ""}`;
    plan.response_guidance = "O lead não pediu fotos de forma explícita. Não envie imagens. Apenas responda conversando de forma humana e continue a qualificação ou tire dúvidas.";
    }
  }

  // USAR INTERESSE CONHECIDO em pergunta GENERICA de preco/disponibilidade: o lead pergunta sobre
  // preco/o-que-anunciaram/disponibilidade SEM nomear modelo, e o plano caiu em "carro"/generico,
  // MAS a memoria tem um interesse de TIPO (picape/suv/...) ou modelo. Busca por ESSE interesse —
  // senao o agente negava "nao temos picape Fiat" buscando "carro" generico (caso real Jose Anisio:
  // a loja tinha Fiat Toro 2024 + Strada 2025). So dispara em pergunta de preco/disponibilidade, p/
  // nao estreitar um "o que voces tem?" amplo de verdade.
  {
    const _msgN = normalizeText(input.message);
    const _priceOrAvailQ = /\b(preco|valor|quanto|anunci|anuncio|real|disponivel|disponiveis|ainda tem|esse carro|esse veiculo|essa picape|esse preco)\b/.test(_msgN);
    const _genericTok = /^(carro|carros|veiculo|veiculos)$/i;
    const _planQ = String(plan.search_query || "").trim();
    const _planModelo = String(plan.search_filters?.modelo_desejado || "").trim();
    const _planIsGeneric = (!_planQ || _genericTok.test(_planQ)) && (!_planModelo || _genericTok.test(_planModelo));
    const _memTipo = String((input.memory?.interesse as any)?.tipo_veiculo || "").toLowerCase();
    const _memModelo = memoryVehicleQuery(input.memory);
    const _memTypeSpecific = ["suv", "pickup", "hatch", "sedan", "moto"].includes(_memTipo);
    const _memModelSpecific = Boolean(_memModelo) && !_genericTok.test(String(_memModelo))
      && !["pickup", "suv", "hatch", "sedan", "moto", "carro"].includes(String(_memModelo).toLowerCase());
    if (plan.action === "stock_search" && _planIsGeneric && _priceOrAvailQ && (_memTypeSpecific || _memModelSpecific)
        && !wantsOtherVehicle(input.message) && !wantsCheaperVehicle(input.message)) {
      if (_memModelSpecific) {
        plan.search_query = String(_memModelo);
        plan.search_filters = { ...(plan.search_filters || {}), modelo_desejado: String(_memModelo), ...(_memTypeSpecific ? { tipo_veiculo: _memTipo } : {}) } as any;
      } else {
        plan.search_query = null;
        plan.search_filters = { ...(plan.search_filters || {}), stock_broad: true, modelo_desejado: null, tipo_veiculo: _memTipo } as any;
      }
      plan.use_memory_vehicle = true;
      plan.reason = `used_memory_interest_for_generic_q:${plan.reason || ""}`;
      plan.response_guidance = `O lead perguntou de forma generica (preco/disponibilidade/anuncio) sobre o que ele JA procura (${_memModelSpecific ? _memModelo : _memTipo}). APRESENTE de forma CURTA as opcoes REAIS desse tipo no estoque (stock.facts). NUNCA diga 'nao temos' esse tipo havendo unidades no estoque.`;
    }
  }

  // ACEITE DE OFERTA DE OPCOES: o agente ofereceu MOSTRAR opcoes/carros ("posso te mostrar outras
  // opcoes de hatch?") e o lead AFIRMOU ("Ok"/"sim"/"pode"). O LLM as vezes le esse "ok" como
  // desinteresse e SE DESPEDE (caso real lead Jefferson). FORCA stock_search pra APRESENTAR.
  // Narrow: so quando a ULTIMA fala do agente foi oferta de opcoes (nao foto/qualificacao) e o
  // lead so afirmou (sem pedir outro carro/foto).
  const _okText = normalizeText(input.message);
  const _isDeclineOrBye = /\b(obrigad|tchau|valeu|flw|falou|depois|mais tarde|outra hora|vou pensar|pensar|nao quero|nao precisa|nao obrigado|deixa|to so olhando|so olhando|agradeco)\b/.test(_okText);
  if (hasRecentOptionsOffer(input) && isAffirmativeText(input.message) && !_isDeclineOrBye
      && !expressesOtherVehicleWish(input.message) && !isPhotoText(input.message)
      && (plan.action === "reply_only" || plan.action === "clarify")) {
    const _prevType = (plan.search_filters as any)?.tipo_veiculo || null;
    plan.action = "stock_search";
    plan.intent = "stock_lookup";
    plan.use_memory_vehicle = false;
    plan.search_query = null;
    plan.search_filters = { ...(plan.search_filters || {}), stock_broad: true, modelo_desejado: null, tipo_veiculo: _prevType } as any;
    plan.reason = `accepted_options_offer_to_stock:${plan.reason || ""}`;
    plan.response_guidance = "O lead ACEITOU sua oferta de ver opcoes (respondeu 'ok'/'sim'). APRESENTE de forma CURTA as opcoes REAIS do estoque (stock.facts) e pergunte qual interessa ou se quer ver fotos. NUNCA se despeca nem trate como desinteresse — ele QUER ver os carros.";
  }

  // FAIXA DE ANO: o planner emite search_filters.ano como STRING ("2013-2018", "2013 a 2018"). O
  // motor filtra por ano_min/ano_max -> sem converter, a FAIXA era IGNORADA (mostrava carro fora do
  // ano; caso real "hatch de 2013 a 2018" trazia 2011/2024). Converte SO faixas (2+ anos) p/ nao
  // mexer no comportamento de ano unico (que ja e tratado pelo cerebro/recuperacao).
  if (plan.search_filters && (plan.search_filters as any).ano != null) {
    const _yrs = (String((plan.search_filters as any).ano).match(/(?:19|20)\d{2}/g) || []).map(Number);
    if (_yrs.length >= 2) {
      (plan.search_filters as any).ano_min = Math.min(..._yrs);
      (plan.search_filters as any).ano_max = Math.max(..._yrs);
    }
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
  planner_provider?: string | null;
  planner_model?: string | null;
  ai_key_ctx?: AiKeyCtx | null;
}): Promise<PedroBrainPlan> {
  const fallback = fallbackPlan(input);
  // ── PROVEDOR DO CEREBRO (planner): OpenAI (default) ou DeepSeek (mais barato p/ intencao) ──
  // Precedencia: override por-request (SO dry-run, vem do orchestrator) > env PEDRO_PLANNER_PROVIDER > 'openai'.
  // DeepSeek tem API compativel com OpenAI; nao suporta json_schema estrito -> usamos json_object (prompt ja pede JSON).
  const plannerProvider = String(
    input.planner_provider || Deno.env.get("PEDRO_PLANNER_PROVIDER") || "openai",
  ).toLowerCase();
  // BYOK: chaves resolvem por conta (cliente > nossa-se-grandfathered). ai_key_ctx vem do gate.
  const openaiKey = await keyFromCtx(input.ai_key_ctx, "openai");
  const deepseekKey = await keyFromCtx(input.ai_key_ctx, "deepseek");
  const anthropicKey = await keyFromCtx(input.ai_key_ctx, "anthropic");
  const useDeepseek = plannerProvider === "deepseek" && !!deepseekKey;
  const useAnthropic = (plannerProvider === "anthropic" || plannerProvider === "claude") && !!anthropicKey;
  // Anthropic NAO e compativel com OpenAI: endpoint /v1/messages, header x-api-key + anthropic-version,
  // 'system' top-level, saida em content[].text. Modelo default = haiku (planner e classificacao barata
  // de alto volume; opus/sonnet ligaveis por env PEDRO_PLANNER_MODEL_ANTHROPIC ou override no dry-run).
  const llm = useAnthropic
    ? {
        provider: "anthropic",
        url: "https://api.anthropic.com/v1/messages",
        key: anthropicKey as string,
        model: Deno.env.get("PEDRO_PLANNER_MODEL_ANTHROPIC") || "claude-haiku-4-5",
        supportsJsonSchema: false,
        isAnthropic: true,
      }
    : useDeepseek
    ? {
        provider: "deepseek",
        url: "https://api.deepseek.com/v1/chat/completions",
        key: deepseekKey as string,
        model: Deno.env.get("PEDRO_PLANNER_MODEL_DEEPSEEK") || "deepseek-chat",
        supportsJsonSchema: false,
        isAnthropic: false,
      }
    : {
        provider: "openai",
        url: "https://api.openai.com/v1/chat/completions",
        key: openaiKey || "",
        model: Deno.env.get("PEDRO_PLANNER_MODEL_OPENAI") || "gpt-4o-mini",
        supportsJsonSchema: true,
        isAnthropic: false,
      };
  if (!llm.key) return fallback;

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
    "- Se um veiculo for mencionado, defina 'action'='stock_search' e coloque o nome canonico (Marca + Modelo, ex: 'Jeep Renegade') em 'search_query'. ATENÇÃO: se o cliente estiver apenas OFERECENDO o veículo dele como TROCA/entrada (intent='trade_in'), defina 'action'='reply_only' e NÃO coloque o carro da troca em 'search_query' (e nem faça busca dele no estoque).",
    "- Preencha 'search_filters.modelo_desejado' com o modelo e 'search_filters.tipo_veiculo' com 'suv','pickup','hatch','sedan' ou 'moto'.",
    "- FAIXA DE PRECO / ORCAMENTO como resposta (REGRA FORTE): se o lead der um valor ou faixa de preco ('na faixa de 120 mil', 'ate 80 mil', 'uns 50 mil', 'tenho 100 mil pra gastar') e a conversa JA esta definindo um carro pra comprar (voce perguntou tipo/faixa, ou ha tipo/modelo no last_agent_message/memory), defina action='stock_search' e preencha 'search_filters.preco_max' com o valor EM REAIS (120 mil = 120000) + HERDE o 'tipo_veiculo'/'modelo_desejado' do contexto. O lead quer VER os carros nessa faixa — NUNCA responda 'reply_only' sem buscar. Ex.: agente perguntou 'picape ou SUV? qual faixa?' e o lead responde 'na faixa de 120 mil' => action='stock_search', tipo_veiculo do contexto, preco_max=120000.",
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
  // cliente. Roda em gpt-4o-mini por padrao; pode rodar em DeepSeek/Anthropic (override por env/dry-run).
  const plannerModel = input.planner_model || llm.model;
  const baseBody: Record<string, any> = {
    model: plannerModel,
    temperature: 0.1,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPayload },
    ],
  };

  const callPlanner = async (responseFormat: any) => {
    if (llm.isAnthropic) {
      // Anthropic Messages API: system top-level, sem response_format/temperature (compat. opus 4.x).
      return await fetch(llm.url, {
        method: "POST",
        headers: {
          "x-api-key": llm.key,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: plannerModel,
          max_tokens: 1024,
          system: `${systemPrompt}\n\nResponda APENAS com o objeto JSON pedido, sem texto extra e sem cercas de codigo.`,
          messages: [{ role: "user", content: userPayload }],
        }),
      });
    }
    return await fetch(llm.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${llm.key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ...baseBody, response_format: responseFormat }),
    });
  };

  try {
    const _t0 = (globalThis as any)?.performance?.now?.() ?? 0;
    // 1) SAIDA ESTRUTURADA ESTRITA (so OpenAI): o schema garante action/intent/confidence validos.
    //    DeepSeek nao suporta json_schema -> ja vai direto p/ json_object (o prompt pede JSON).
    let res = llm.isAnthropic
      ? await callPlanner(null)
      : llm.supportsJsonSchema
      ? await callPlanner({ type: "json_schema", json_schema: PLAN_JSON_SCHEMA })
      : await callPlanner({ type: "json_object" });
    // 2) DEGRADACAO GRACIOSA (OpenAI/DeepSeek): se rejeitar o schema, cai p/ json_object. Sem regressao.
    if (!res.ok && !llm.isAnthropic) {
      console.warn(`[PedroV2] planner ${llm.provider}/${plannerModel} status ${res.status}; degradando p/ json_object`);
      res = await callPlanner({ type: "json_object" });
    }
    if (!res.ok) {
      if (llm.isAnthropic) console.warn(`[PedroV2] planner anthropic/${plannerModel} status ${res.status}`);
      // Registra a falha (sem credito / chave invalida / etc) pro orchestrator decidir alertar o dono.
      await recordProviderError(input.ai_key_ctx, llm.provider, "planner", res);
      return fallback;
    }
    const data = await res.json();
    // SAIDA: OpenAI/DeepSeek -> choices[0].message.content ; Anthropic -> content[].text
    const content = llm.isAnthropic
      ? String((Array.isArray(data?.content) ? data.content.filter((b: any) => b?.type === "text").map((b: any) => b?.text || "").join("") : "") || "{}")
      : String(data?.choices?.[0]?.message?.content || "{}");
    if (input.usage_sink) {
      input.usage_sink.tokens += llm.isAnthropic
        ? Number(data?.usage?.input_tokens || 0) + Number(data?.usage?.output_tokens || 0)
        : sumOpenAiTokens(data);
    }
    const parsed = JSON.parse(cleanJson(content));
    const plan = normalizePlan(parsed, fallback, input);
    // META p/ medir custo/latencia/provedor (aparece no dry-run e ajuda monitorar producao).
    const _t1 = (globalThis as any)?.performance?.now?.() ?? 0;
    (plan as any)._planner_meta = {
      provider: llm.provider,
      model: plannerModel,
      prompt_tokens: llm.isAnthropic ? Number(data?.usage?.input_tokens || 0) : Number(data?.usage?.prompt_tokens || 0),
      completion_tokens: llm.isAnthropic ? Number(data?.usage?.output_tokens || 0) : Number(data?.usage?.completion_tokens || 0),
      latency_ms: Math.round(_t1 - _t0),
    };
    return plan;
  } catch (error) {
    console.warn("[PedroV2] brain planner fallback:", error);
    return fallback;
  }
}
