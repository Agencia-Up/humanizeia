import { PedroV2Intent, PedroV2IntentResult, PedroV2LeadMemory } from "./types.ts";
import { PedroVehicleResolution } from "./vehicleResolver_20260525_brain.ts";
import { sumOpenAiTokens, UsageSink } from "./tokenMeter.ts";
import { logAiCall } from "../observability/aiCallLog.ts";
import { keyFromCtx, recordProviderError, AiKeyCtx } from "../aiKeys.ts";
import { detectLeadDirectionChange, leadRefinesVehicleNeedsSearch, contextVehicleModel, parsePriceCeiling, buildConversationState, leadComplainsPhotoWrongOrMissing, messageIsTooVagueToAct, leadAsksAnyCarInBudget, leadAsksForMoreOptions, leadAsksBodyType, leadRespondsNoDownPaymentOrInstallmentConcern, leadRespondsTradeValueObjection } from "./decisionLogic.ts";

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
  "estoque", "novo", "novos", "usado", "usados", "seminovo", "seminovos", "repasse", "repasses",
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

// Lead pede segmento barato/de repasse/usado de forma ampla. Isso nao e modelo; deve listar os mais em conta.
function wantsCheapBroadStock(message?: string | null) {
  const n = normalizeText(message);
  if (!n) return false;
  const hasCheapSegment = /\b(repasse|repasses|carro usado|carros usados|usado barato|usados baratos|seminovo barato|seminovos baratos|barat[oa]s?|baratinh[oa]s?|mais em conta|mais economic[oa]s?|popular|populares|baixo custo|preco baixo|menor preco)\b/.test(n);
  if (!hasCheapSegment) return false;
  return /\b(carro|carros|veiculo|veiculos|automovel|automoveis|opcao|opcoes|modelo|modelos|estoque|tem|procuro|quero|queria|busco|mostra|mostrar)\b/.test(n);
}
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
  // Se aponta um carro NOVO de interesse (trocar POR / quero um ...), NAO e troca pura -> deixa buscar.
  const wantsNew = /\b(por|pel[oa])\s+(um|uma|uns|umas|outro|outra|outros|outras|o|a|esse|essa|este|esta)\b/.test(n)
    || /\b(troc\w+|interesse)\s+(por|pel[oa]|no|na)\b/.test(n)
    || /\b(quero|queria|gostaria de|prefiro|me interessa|fiquei de olho n[oa])\s+(um|uma|o|a|outro|outra)\b/.test(n);
  if (wantsNew) return false;
  const mentionsTrade = heuristicIntent === "trade_in" || /\b(troc\w+|na troca)\b/.test(n);
  // POSSE do carro do lead = troca/contexto, NAO interesse de compra (caso real lead 99627-7728:
  // "Eu tenho um cruze 2016" virava busca de Cruze -> agente negava o carro DO PROPRIO lead).
  // "(eu) tenho um/uma <X>" / "meu carro" so conta como veiculo se ha sinal (ano AAAA, "X mil", "km")
  // -> evita falso positivo em "tenho uma duvida".
  const possession = /\b(eu\s+)?(tenho|tinha|possuo)\s+(um|uma)\b/.test(n) || /\bmeu\s+(carro|veiculo|automovel|atual)\b/.test(n);
  const hasVehicleSignal = /\b(19|20)\d{2}\b/.test(n) || /\b\d{1,3}\s*mil\b/.test(n) || /\bkm\b/.test(n);
  if (possession && hasVehicleSignal) return true;
  return mentionsTrade;
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
  // PERSISTIDO (Codex) tem PRIORIDADE: setado a partir da RESPOSTA REAL do agente no turno anterior
  // (classifyAgentReplyPending) -> robusto, não depende de re-parsear a última fala (que pode vir
  // duplicada/atrasada/manual/splitada). Cai na inferência abaixo só sem valor persistido (estado antigo).
  const _persisted = (input.memory as any)?.pending_question;
  if (_persisted && typeof _persisted === "string") return _persisted;
  const raw = getLastAgentText(input);
  const t = normalizeText(raw);
  if (!t) return "nenhum";
  // Oferta/promessa de fotos tem prioridade (reaproveita a mesma deteccao do enforcement).
  if (hasRecentPhotoOffer(input)) return "ofereceu_fotos";
  // Oferta de MOSTRAR opcoes/carros: um "ok"/"sim" depois disso = ACEITE (apresentar), nao despedida.
  if (hasRecentOptionsOffer(input)) return "ofereceu_opcoes";
  if (/\b(a vista|financ|parcel|entrada|consorcio)\b/.test(t)
      && /\b(pretende|vai|forma|paga|pagar|prefere|quer|pode dar|consegue|preciso saber|\bvalor\b|quanto|qual|me diz|me fala|dar de entrada)\b/.test(t)) return "perguntou_pagamento";
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
    "MUDOU DE DIRECAO (CRITICO): a mensagem ATUAL do lead e a FONTE DA VERDADE; o carro do anuncio e HISTORICO, NUNCA uma trava. Se o lead AGORA pede um TIPO (suv/sedan/hatch/picape) ou OUTRO modelo (veja decision_context.lead_direction.changed_direction=true), ele MUDOU de ideia: SIGA o pedido atual — action=stock_search com search_query = o TIPO/modelo pedido e search_filters.tipo_veiculo correspondente; NAO devolva o modelo do anuncio nem insista nele. Um bom vendedor RE-ENTENDE a dor do cliente quando ele muda. (So continue no carro do anuncio se o lead estiver perguntando sobre ELE — 'esse', caracteristica, preco — nao quando amplia para um tipo.)",
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

// ── PILAR B (slots): vocabulario CANONICO de marcas (BR) p/ recuperar a marca que o LLM
// descarta ("so se for Honda" -> modelo:"sedan", marca vazia). alias -> canonico (bate markName).
const BRAND_ALIASES: Record<string, string> = {
  chevrolet: "chevrolet", chevy: "chevrolet", gm: "chevrolet",
  volkswagen: "volkswagen", vw: "volkswagen",
  fiat: "fiat", hyundai: "hyundai", renault: "renault", toyota: "toyota",
  honda: "honda", nissan: "nissan", jeep: "jeep", ford: "ford",
  peugeot: "peugeot", citroen: "citroen", mitsubishi: "mitsubishi",
  mini: "mini", chery: "chery", caoa: "chery", kia: "kia", bmw: "bmw",
  mercedes: "mercedes", audi: "audi", ram: "ram", byd: "byd",
  volvo: "volvo", suzuki: "suzuki",
};
// "modelo" que e so a CARROCERIA/tipo (nao modelo real) -> vira tipo_veiculo.
const TYPE_AS_MODEL: Record<string, string> = {
  sedan: "sedan", sedans: "sedan", seda: "sedan", sedas: "sedan",
  hatch: "hatch", hatches: "hatch", hatchback: "hatch",
  suv: "suv", suvs: "suv",
  picape: "pickup", picapes: "pickup", pickup: "pickup", pickups: "pickup", caminhonete: "pickup", caminhonetes: "pickup",
  utilitario: "suv", utilitarios: "suv",
  moto: "moto", motos: "moto", motocicleta: "moto", motocicletas: "moto",
};

export function normalizePlan(raw: any, fallback: PedroBrainPlan, input: {
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

  // ── NÃO PERDER O TRILHO: resposta de FINANCIAMENTO/ENTRADA não vira busca de estoque (Codex Caso H) ──
  // Caso real (lead 98123-8305): o agente perguntou a ENTRADA; o lead respondeu "Não tenho" / "se precisa
  // dar entrada não dá" / "vou pelo valor das parcelas que cabe no bolso" — e o agente DESPEJOU lista de
  // carros (ouviu "valor" e virou stock_search). Quando há pergunta de pagamento/entrada PENDENTE e o lead
  // responde com restrição de entrada / foco na parcela, é RESPOSTA ao funil, não nova busca: segura no
  // trilho de financiamento (reply_only), NUNCA estoque/foto. PRIORIDADE sobre toda a interpretação de
  // "valor/orçamento" abaixo. EXCEÇÃO: se o lead claramente STEERA uma nova busca (teto explícito, "tem
  // algum de Xk", carroceria) deixa seguir o fluxo de busca (mudou de assunto de propósito).
  {
    const _pendingPay = classifyPendingQuestion(input);
    const _steersNewSearch = leadAsksAnyCarInBudget(input.message)
      || Boolean(leadAsksBodyType(input.message))
      || Boolean(parsePriceCeiling(input.message));
    if (!_steersNewSearch
        && leadRespondsNoDownPaymentOrInstallmentConcern(input.message, _pendingPay, getLastAgentText(input))) {
      plan.action = "reply_only";
      plan.intent = "financing";
      plan.search_query = null;
      plan.search_filters = {};
      plan.photo_target = null;
      plan.use_memory_vehicle = false;
      (plan as any).precisa_qualificar = false;
      plan.response_guidance = "O lead respondeu a pergunta de ENTRADA/FINANCIAMENTO dizendo que NÃO tem entrada (ou que vai pelo valor da PARCELA que cabe no bolso). NÃO liste carros, NÃO ofereça fotos, NÃO busque estoque. Acolha que dá pra pensar SEM entrada (ou com entrada baixa) pelo valor da parcela e pergunte qual parcela mensal ficaria confortável pra ele — seguindo o funil da loja (se a loja simula com CPF/consultor, encaminhe pra simular). Mantenha o trilho de financiamento.";
      plan.reason = `finance_constraint_no_stock:${_pendingPay}:${plan.reason || ""}`;
      plan.source = "finance_constraint_guard";
      return plan;
    }
  }

  // ── NÃO PERDER O TRILHO: objeção de VALOR da TROCA não vira busca de estoque (Codex Caso I) ──
  // Caso real (Francisco/Hilux): agente perguntou sobre o carro de troca; lead disse que o usado dele
  // estava em valor maior, e o agente pulou para estoque/fotos. Isso é negociação da troca, não novo
  // pedido de veículo. EXCEÇÃO: se o lead claramente pedir uma nova busca junto, deixa buscar.
  {
    const _pendingTrade = classifyPendingQuestion(input);
    const _steersNewSearch = leadAsksAnyCarInBudget(input.message)
      || Boolean(leadAsksBodyType(input.message))
      || (Boolean(parsePriceCeiling(input.message)) && /\b(tem|teria|quero|procuro|busco|manda|mostra)\b/.test(normalizeText(input.message)));
    if (!_steersNewSearch
        && leadRespondsTradeValueObjection(input.message, _pendingTrade, getLastAgentText(input))) {
      plan.action = "reply_only";
      plan.intent = "trade_in";
      plan.search_query = null;
      plan.search_filters = {};
      plan.photo_target = null;
      plan.use_memory_vehicle = true;
      (plan as any).precisa_qualificar = false;
      plan.response_guidance = "O lead esta respondendo ao funil de TROCA com uma objecao de VALOR/avaliacao do usado dele. NAO liste carros, NAO ofereca fotos, NAO busque estoque. Acolha a preocupacao, diga que a avaliacao final depende da analise do consultor/loja e pergunte qual valor ele esperava no usado (ou peca para o consultor avaliar), sem prometer valor.";
      plan.reason = `trade_value_objection_no_stock:${_pendingTrade}:${plan.reason || ""}`;
      plan.source = "trade_value_objection_guard" as any;
      return plan;
    }
  }
  // TETO DE PRECO DETERMINISTICO (provider-independente): o LLM (esp. DeepSeek) as vezes NAO converte
  // "ate 50 mil" -> preco_max=50000. Parse deterministico garante o teto pros dois provedores (caso real
  // "corolla ate 50 mil" no DeepSeek voltava carros ACIMA de 50k). So seta se o LLM nao tiver setado.
  if (plan.action === "stock_search") {
    const _ceil = parsePriceCeiling(input.message);
    if (_ceil && !(plan.search_filters as any)?.preco_max) {
      plan.search_filters = { ...(plan.search_filters || {}), preco_max: _ceil, hard_price_ceiling: true };
      plan.reason = `enforced_price_ceiling_${_ceil}:${plan.reason || ""}`;
    }
  }

  // Categoria/carroceria pura nunca e MODELO. O LLM frequentemente devolve search_query/modelo_desejado
  // como "sedans"/"SUVs"; se isso fica como modelo, o reply diz "nao tenho sedans" mesmo com sedans
  // reais listados. Converte para busca ampla por tipo, preservando preco/ano/cambio.
  if (plan.action === "stock_search") {
    const _f: any = plan.search_filters || {};
    const _modelText = normalizeText(String(plan.search_query || _f.modelo_desejado || ""));
    const _typeOnly = TYPE_AS_MODEL[_modelText];
    if (_typeOnly) {
      plan.search_query = null;
      plan.search_filters = { ..._f, stock_broad: true, modelo_desejado: null, tipo_veiculo: _f.tipo_veiculo || _typeOnly };
      plan.use_memory_vehicle = false;
      plan.reason = `model_token_is_vehicle_type:${_typeOnly}:${plan.reason || ""}`;
    }
  }
  // "TEM ALGUM DE 34K?" — pergunta SÓ de ORÇAMENTO (qualquer carro no valor, sem modelo específico): larga
  // o modelo velho/stale e busca AMPLO filtrado por preço, MAIS EM CONTA primeiro. SEM hard ceiling: se
  // nada couber no orçamento, o reply mostra os mais baratos disponíveis sendo honesto ("não tenho até X").
  // Caso real lead 99747-0573: "Tem algum de 34k?" buscava "Zafira" e mostrava carros de 64-76k.
  // REPASSE / USADO / BARATO sem modelo real = busca ampla pelos mais em conta.
  // Caso real Avant 92005-3580: audio "carro de repasse/carro usado" herdou S10 do anuncio,
  // depois buscou modelo_lixo="carro"+tipo_hatch e zerou o estoque; o reply inventou Audi/Land Rover.
  // Invariante: termo de segmento/preco nao e modelo; a fala atual manda e nao herda anuncio antigo.
  if (plan.action === "stock_search" && wantsCheapBroadStock(input.message)) {
    const f = (plan.search_filters || {}) as any;
    const resolvedModel = normalizeText(String(plan.search_query || f.modelo_desejado || ""));
    const resolvedTokens = resolvedModel.split(/\s+/).filter(Boolean);
    const onlyGenericModel = resolvedTokens.length === 0 || resolvedTokens.every((tok) => GENERIC_STOCK_WORDS.has(tok));
    if (onlyGenericModel) {
      const msgN = normalizeText(input.message);
      const explicitType = (msgN.match(/\b(suv|sedan|seda|hatch|picape|pickup|caminhonete|camionete)\b/) || [])[1] || null;
      const typeMap: Record<string, string> = { seda: "sedan", sedan: "sedan", hatch: "hatch", suv: "suv", picape: "pickup", pickup: "pickup", caminhonete: "pickup", camionete: "pickup" };
      plan.action = "stock_search";
      plan.intent = plan.intent === "unknown" || plan.intent === "small_talk" || plan.intent === "trade_in" ? "stock_lookup" : plan.intent;
      plan.search_query = null;
      plan.use_memory_vehicle = false;
      plan.photo_target = null;
      plan.search_filters = {
        ...f,
        stock_broad: true,
        cheap_broad: true,
        modelo_desejado: null,
        query: "",
        tipo_veiculo: explicitType ? (typeMap[explicitType] || explicitType) : null,
      };
      plan.reason = `cheap_broad_stock:${plan.reason || ""}`;
      plan.response_guidance = "O lead pediu carro de repasse/usado/barato/mais em conta. NAO herde veiculo antigo do anuncio. Consulte o estoque REAL em busca ampla, ordene pelos MAIS BARATOS primeiro, apresente opcoes acessiveis e pergunte qual faixa de valor ou modelo agrada.";
    }
  }
  if (leadAsksAnyCarInBudget(input.message)) {
    const _ceil = parsePriceCeiling(input.message);
    plan.action = "stock_search";
    if (!plan.intent || plan.intent === "unknown") plan.intent = "price_question";
    plan.search_query = null;
    plan.use_memory_vehicle = false;
    plan.search_filters = {
      ...(plan.search_filters || {}),
      modelo_desejado: null, tipo_veiculo: null, stock_broad: true,
      preco_max: null, hard_price_ceiling: false,
      // orcamento_max = DICA pro reply (mostra os mais em conta + "nao tenho ate R$ X"); a BUSCA ignora
      // (preco_max=null) pra NAO zerar quando nada cabe no teto — senao o lead nao recebe nenhuma opcao.
      ...(_ceil ? { orcamento_max: _ceil } : {}),
    };
    plan.reason = `enforced_any_car_in_budget_${_ceil || "?"}:${plan.reason || ""}`;
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
    "financing", "payment", "scheduling", "schedule", "visit", "agendamento",
    "location", "small_talk", "greeting", "handoff", "human_request", "seller_ack",
    "goodbye", "farewell", "thanks", "objection",
  ].includes(String(plan.intent || ""))
    // TROCA so BLOQUEIA a busca quando ha sinal REAL de troca (carro do lead: "tenho/meu/na troca").
    // Sem sinal real, "a Hilux cabine simples" e INTERESSE DE COMPRA -> tem que BUSCAR (caso 35-98788375:
    // o LLM rotulou trade_in e o agente NEGOU a Hilux que EXISTIA, sem checar). isTradeInOffer ja
    // distingue "ofereco o MEU carro" de "quero comprar ESSE" -> nomear um veiculo vence como compra.
    || (String(plan.intent || "") === "trade_in" && isTradeInOffer(input.message, _heurIntent));
  // REFINAMENTO POR CONTEXTO (lead Ale, Compass T270): o lead especifica uma VERSAO/MOTOR ("seria o
  // modelo 270 com nova motorizacao") de um veiculo que esta no CONTEXTO (apresentado/interesse/anuncio),
  // mas NAO nomeia o modelo na frase -> o guard acima nao pega (resolver+LLM nao acham veiculo na frase).
  // Aqui o cerebro CHECA: refinou versao/motor de um modelo conhecido -> busca esse MODELO (a familia),
  // o reply apresenta a variante certa. Respeita as intencoes que NAO sao busca (troca/financiamento/etc).
  const _refinesVehicle = leadRefinesVehicleNeedsSearch(input.message, input.memory, (input.ad_context as any)?.vehicle_query);
  if (((_vr?.has_current_vehicle_signal || hasLlmVehicle) && !intentNaoEhBuscaDeVeiculo && !isPureVehicleComment(input.message) && (plan.action === "reply_only" || plan.action === "clarify"))
      || (_refinesVehicle && !intentNaoEhBuscaDeVeiculo && (plan.action === "reply_only" || plan.action === "clarify"))) {
    plan.action = "stock_search";
    plan.intent = plan.intent === "small_talk" ? "stock_lookup" : plan.intent;
    if (!plan.search_query) {
      plan.search_query = _vr?.query || plan.search_filters?.modelo_desejado
        || contextVehicleModel(input.memory, (input.ad_context as any)?.vehicle_query) || null;
    }
    plan.search_filters = {
      ...(plan.search_filters || {}),
      modelo_desejado: plan.search_query || _vr?.query || null,
      tipo_veiculo: plan.search_filters?.tipo_veiculo || _vr?.vehicle_type || null,
    };
    plan.use_memory_vehicle = _vr?.used_memory ?? plan.use_memory_vehicle;
    plan.reason = `${_refinesVehicle && !(_vr?.has_current_vehicle_signal || hasLlmVehicle) ? "enforced_refine_vehicle_search" : "enforced_llm_or_heuristic_vehicle_search"}:${plan.reason || ""}`;
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

  // PROMETE E NAO CUMPRE (foto, bug real Barbara): lead RECLAMA que a foto veio ERRADA ou NAO chegou
  // ("essas fts n sao peugeot", "vc n mandou nenhuma do carro certo"). O agente NAO tem como "enviar
  // depois" -> NUNCA prometer; re-DISPARA a foto do carro certo AGORA (o orchestrator re-ancora no
  // interesse). Forca photo_request do interesse, mesmo que o LLM tenha decidido so conversar/prometer.
  const _photoComplaint = leadComplainsPhotoWrongOrMissing(input.message)
    && Boolean(input.memory?.interesse?.modelo_desejado || hasPresentedVehicles);
  if (_photoComplaint) {
    plan.action = "photo_request";
    plan.intent = "photo_request";
    plan.use_memory_vehicle = true;
    if (!plan.search_query) plan.search_query = input.memory?.interesse?.modelo_desejado || null;
    plan.reason = `enforced_photo_complaint_resend:${plan.reason || ""}`;
  }

  // Anti-envio acidental: impede que a LLM envie fotos do nada se o lead não pediu de fato
  const photo = isPhotoText(input.message);
  const photoSelectorReply = isPhotoSelectorReply(input.message) && hasPresentedVehicles;
  if (plan.action === "photo_request" && !photo && !acceptedPhotoOffer && !photoSelectorReply && !_photoComplaint) {
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
        && !wantsOtherVehicle(input.message) && !wantsCheaperVehicle(input.message) && !wantsCheapBroadStock(input.message)) {
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
  const _asksMoreOptions = leadAsksForMoreOptions(input.message);
  if (((hasRecentOptionsOffer(input) && isAffirmativeText(input.message)) || _asksMoreOptions) && !_isDeclineOrBye
      && !expressesOtherVehicleWish(input.message) && !isPhotoText(input.message)
      && (plan.action === "reply_only" || plan.action === "clarify" || plan.action === "stock_search")) {
    const _memInterest: any = input.memory?.interesse || {};
    const _prevType = (plan.search_filters as any)?.tipo_veiculo || _memInterest.tipo_veiculo || null;
    const _prevPrice = Number((plan.search_filters as any)?.preco_max) || Number(_memInterest.preco_max) || null;
    plan.action = "stock_search";
    plan.intent = "stock_lookup";
    plan.use_memory_vehicle = false;
    plan.search_query = null;
    plan.search_filters = {
      ...(plan.search_filters || {}),
      stock_broad: true,
      modelo_desejado: null,
      query: "",
      ...(String(_prevType || "") ? { tipo_veiculo: _prevType } : {}),
      ...(_prevPrice ? { preco_max: _prevPrice } : {}),
    } as any;
    plan.reason = `${_asksMoreOptions ? "more_options_followup_to_stock" : "accepted_options_offer_to_stock"}:${plan.reason || ""}`;
    plan.response_guidance = "O lead quer MAIS opções do mesmo perfil que estava vendo. APRESENTE opções REAIS do estoque mantendo o tipo/faixa anterior quando existirem, sem misturar carroceria diferente e sem repetir os já mostrados.";
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

  // ── CASO #1: LEAD MUDOU DE DIREÇÃO depois do anúncio — backstop determinístico ──────────────
  // O cérebro (prompt + decision_context.lead_direction) já é instruído a SEGUIR a mensagem atual. Este
  // backstop pega quando o LLM AINDA devolve o modelo do anúncio: se o lead ampliou para um TIPO
  // (changed_direction) e o plano está "preso" no modelo do anúncio, troca para busca AMPLA do TIPO.
  // Invariante geral (não if-por-caso): a mensagem ATUAL manda, o anúncio é HISTÓRICO. Testado offline.
  if (plan.action === "stock_search" && input.ad_context?.has_ad_context && input.ad_context?.vehicle_query) {
    const _adVeh = String(input.ad_context.vehicle_query);
    const _dir = detectLeadDirectionChange(input.message, _adVeh);
    if (_dir.changed_direction && _dir.current_type) {
      const f = (plan.search_filters || {}) as any;
      const _adTokens = normalizeText(_adVeh).split(/\s+/).filter((t) => t.length >= 3 && !/^(?:19|20)\d{2}$/.test(t));
      const _planText = normalizeText(`${plan.search_query || ""} ${f.modelo_desejado || ""}`);
      const _lockedOnAd = _adTokens.some((t) => new RegExp(`\\b${t}\\b`).test(_planText));
      if (_lockedOnAd || f.modelo_desejado || !plan.search_query) {
        plan.search_query = _dir.current_type;
        plan.search_filters = { ...f, tipo_veiculo: _dir.current_type, modelo_desejado: null, stock_broad: true };
        plan.reason = `direction_change_to_type:${_dir.current_type}:${plan.reason || ""}`;
      }
    }
  }

  // ── PILAR B (slots) — RECUPERA A MARCA explicita que o lead citou e o LLM descartou. ──
  // Caso real (lead 99627-7728): "Sedan. So se for Honda" -> LLM punha modelo:"sedan", marca
  // vazia -> orchestrator buscava "sedan" generico (mostrava Chevrolet/Fiat) e NUNCA a Honda
  // City que EXISTE. A BUSCA ja acha a marca certa quando recebe marca+query=marca (provado no
  // harness local); aqui so garantimos que o planner NAO perca a marca. Generico p/ qualquer marca.
  if (plan.action === "stock_search") {
    const f = (plan.search_filters || {}) as any;
    const msgN = normalizeText(input.message);
    let canon: string | null = f.marca && Object.values(BRAND_ALIASES).includes(String(f.marca).toLowerCase())
      ? String(f.marca).toLowerCase() : null;
    if (!canon) {
      for (const alias of Object.keys(BRAND_ALIASES)) {
        if (new RegExp(`\\b${alias}\\b`).test(msgN)) { canon = BRAND_ALIASES[alias]; break; }
      }
    }
    if (canon) {
      const modeloN = normalizeText(String(f.modelo_desejado || plan.search_query || ""));
      const modeloEhTipo = Object.prototype.hasOwnProperty.call(TYPE_AS_MODEL, modeloN);
      // modelo == a propria MARCA ("Honda") nao e modelo real -> busca por MARCA.
      const modeloEhMarca = modeloN === canon || Object.prototype.hasOwnProperty.call(BRAND_ALIASES, modeloN);
      const limparModelo = modeloEhTipo || modeloEhMarca;
      plan.search_filters = {
        ...f,
        marca: canon,
        // marca explicita SEM modelo real = sinal p/ o orchestrator NAO embaralhar (broad/multi-modelo).
        ...(limparModelo ? { modelo_desejado: null, marca_required: true } : {}),
        ...(modeloEhTipo ? { tipo_veiculo: f.tipo_veiculo || TYPE_AS_MODEL[modeloN] } : {}),
      };
      // sem modelo real, a busca LIDERA pela marca (query=marca acha "Honda City"); com modelo
      // real (ex. "Civic"), mantem o modelo e so ganha a marca.
      if (limparModelo) plan.search_query = canon;
      else if (!plan.search_query) plan.search_query = canon;
      plan.reason = `slot_brand_recovered:${canon}:${plan.reason || ""}`;
    }
  }

  // ── "QUANDO INCERTO, PERGUNTAR — NÃO CHUTAR" (palavra final do normalizePlan) ─────────────────────
  // Mensagem genérica SEM critério ("quero um carro", "me ajuda a escolher", "qual o melhor") e SEM
  // veículo resolvido / na memória -> NUNCA despeja carros aleatórios (o "chute" que dá errado); vira
  // reply_only e o reply faz UMA pergunta de qualificação (tipo / faixa de preço / uso). Vendedor bom
  // QUALIFICA antes de apresentar; best-practice: classificar intenção ERRADA é pior que não classificar.
  // Gate: o resolver marca o GENÉRICO "carro" como sinal (query="carro", has_signal=true) — isso NÃO
  // é critério real. Por isso checamos só `canonical_model` (modelo REAL resolvido) + memória; o próprio
  // messageIsTooVagueToAct já garante ausência de tipo/preço/marca na frase.
  if (messageIsTooVagueToAct(input.message, input.memory)
      && !plan.use_memory_vehicle
      && !memoryVehicle
      && !(input.vehicle_resolution as any)?.canonical_model) {
    plan.action = "reply_only";
    plan.intent = "small_talk";
    plan.search_query = null;
    plan.search_filters = { ...(plan.search_filters || {}), stock_broad: false, modelo_desejado: null, tipo_veiculo: null };
    plan.use_memory_vehicle = false;
    (plan as any).precisa_qualificar = true;
    plan.reason = `enforced_qualify_vague:${plan.reason || ""}`;
  }

  // ── BACKSTOP CARROCERIA (palavra FINAL): lead pede um TIPO (sedan/hatch/suv/picape) = BUSCA, nunca ──
  // photo_request/ordinal. Bug real Avant (lead "Quero um sedan você teria ai?"): o planner marcou
  // photo_request (tinha oferecido fotos + "quero") e o "um" virou ordinal #1 -> mandou foto de um HATCH
  // (CAOA QQ) afirmando ser "um sedan". Invariante: nomear uma carroceria é pedido de BUSCA por tipo.
  // FICA NO FIM (depois do bloco "vago" e da recuperação de marca) pra ninguém zerar o tipo. leadAsksBodyType
  // já exclui pedido de FOTO ("manda foto do sedan") e pergunta sobre o carro EM FOCO. Puro -> testado offline.
  {
    const _bodyType = leadAsksBodyType(input.message);
    if (_bodyType) {
      // NÃO atropela busca por MODELO real que o lead nomeou ("tem civic sedan?" busca Civic, não sedan
      // genérico). Só age quando o plano não tem modelo de verdade (modelo vazio ou é a própria palavra-tipo).
      const _f = (plan.search_filters || {}) as any;
      const _modelo = normalizeText(String(_f.modelo_desejado || ""));
      const _hasRealModel = Boolean(_modelo) && !Object.prototype.hasOwnProperty.call(TYPE_AS_MODEL, _modelo)
        && !["sedan", "seda", "hatch", "hatchback", "suv", "pickup", "picape"].includes(_modelo);
      if (!_hasRealModel) {
        plan.action = "stock_search";
        plan.intent = "stock_lookup";
        (plan as any).use_memory_vehicle = false;
        (plan as any).precisa_qualificar = false;
        // busca AMPLA por categoria: o tipo vai em tipo_veiculo + stock_broad; search_query fica NULL
        // (pôr "sedan" como query poluiria a busca ampla — mesmo contrato do handler de "sedans plural").
        plan.search_query = null;
        plan.search_filters = { ..._f, tipo_veiculo: _bodyType, modelo_desejado: null, stock_broad: true };
        plan.reason = `body_type_request_to_search:${_bodyType}:${plan.reason || ""}`;
      }
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
  audit?: { client: any; userId: string; agentId?: string | null; agentName?: string | null };
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
  // ── PILAR E: CADEIA DE FAILOVER de provedor (anti degradacao silenciosa). ──────────────────
  // Incidente recorrente (3x): um provedor cai (OpenAI sem credito) -> o cerebro caia DIRETO na
  // heuristica BURRA p/ TODO o trafego, em silencio. Agora montamos uma CADEIA: tenta o PRIMARIO
  // (env/override) e, se falhar (sem credito/timeout/HTTP erro/parse), cai p/ o PROXIMO provedor
  // COM CHAVE antes do fallback heuristico. So cai na heuristica se TODOS falharem. Cada falha e
  // registrada (recordProviderError) p/ o monitor/alerta. Anthropic usa /v1/messages (incompativel
  // com OpenAI: x-api-key, system top-level, saida content[].text).
  const buildPlannerLlm = (prov: string) => {
    if (prov === "anthropic" || prov === "claude") {
      return anthropicKey
        ? { provider: "anthropic", url: "https://api.anthropic.com/v1/messages", key: anthropicKey as string, model: Deno.env.get("PEDRO_PLANNER_MODEL_ANTHROPIC") || "claude-haiku-4-5", supportsJsonSchema: false, isAnthropic: true }
        : null;
    }
    if (prov === "deepseek") {
      return deepseekKey
        ? { provider: "deepseek", url: "https://api.deepseek.com/v1/chat/completions", key: deepseekKey as string, model: Deno.env.get("PEDRO_PLANNER_MODEL_DEEPSEEK") || "deepseek-chat", supportsJsonSchema: false, isAnthropic: false }
        : null;
    }
    return openaiKey
      ? { provider: "openai", url: "https://api.openai.com/v1/chat/completions", key: openaiKey as string, model: Deno.env.get("PEDRO_PLANNER_MODEL_OPENAI") || "gpt-4o-mini", supportsJsonSchema: true, isAnthropic: false }
      : null;
  };
  // Primario primeiro (env/override), depois os demais COM chave como rede de seguranca (dedup).
  const _plannerChain = [plannerProvider, "openai", "deepseek", "anthropic"]
    .filter((p, i, a) => a.indexOf(p) === i)
    .map(buildPlannerLlm)
    .filter(Boolean) as Array<NonNullable<ReturnType<typeof buildPlannerLlm>>>;
  if (_plannerChain.length === 0) return fallback;

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
    "- REFINAMENTO DE VERSAO/MOTOR (REGRA FORTE): se o lead especifica uma VERSAO, MOTOR ou trim de um veiculo que JA esta em contexto (apresentado/interesse/anuncio) — ex.: 'nao, seria o modelo 270 com nova motorizacao', 'queria a Premier', 'so a versao turbo' — isso e um PEDIDO DE BUSCA: action='stock_search' com o MODELO do contexto em 'search_query' (o reply apresenta a variante certa). NUNCA diga 'nao temos' essa versao sem TER BUSCADO; afirmar indisponibilidade de cabeca, sem consultar o estoque, e ERRO GRAVE que perde a venda.",
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
    "== CONTEXTO DE DECISAO (decision_context) — USE SEMPRE p/ decidir o que falar/buscar ==",
    "- decision_context.vehicles_shown = carros que voce JA apresentou a este lead. NUNCA re-liste os MESMOS como se fossem novidade. Se o lead so reage a eles ('ok', 'gostei', 'achei caro', 'feios', 'nenhum desses'), NAO repita a lista: reconheca o que ele disse e AVANCE (pergunte qual interessa, ofereca foto, ou — se ele recusou/quer diferente — busque OUTRAS opcoes).",
    "- decision_context.qualification = o que voce JA sabe deste lead (nome/interesse/troca/pagamento/agendamento). NAO repergunte o que ja esta preenchido aqui. Se ja ha interesse + nome + (troca OU pagamento OU agendamento), o lead esta QUALIFICADO: avance pra fechar/transferir conforme as regras, sem ficar colhendo mais dados.",
    "- decision_context.lead_rejeitou = modelos/tipos que o lead JA RECUSOU. NUNCA re-ofereca, re-busque nem lidere com esses; se ele pede 'outro'/'os outros', traga algo FORA do que ele rejeitou. (Excecao: se ele AGORA pede explicitamente um deles de volta, vale o pedido atual.)",
    "- decision_context.estado_conversa = o FILME da conversa (origem, o que o lead quer, o que rejeitou, etapa do funil). LEIA a mensagem ATUAL contra ISTO — uma frase curta ('o outro', 'mais barato', 'esse nao', 'manda') so faz sentido no contexto. NUNCA decida olhando so a ultima frase isolada.",
    "- RECONHECA o que o lead acabou de dizer (elogio, reclamacao tipo 'ficaram horriveis', objecao, comparacao) ANTES de seguir — nunca ignore o sentimento nem responda no automatico/repetido.",
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

  // decision_context: sinais de decisao DESTILADOS da memoria (o blob `memory` e grande e o LLM nao
  // os extrai de forma confiavel). Da ao cerebro o que faltava p/ decidir sozinho — o que JA mostrou
  // (nao repetir) e o que JA sabe (nao re-perguntar / saber se qualificou). Robusto a campos ausentes.
  const _mem: any = input.memory || {};
  const _apres = Array.isArray(_mem.veiculos_apresentados) ? _mem.veiculos_apresentados : [];
  const _int = _mem.interesse || {};
  // CASO #1: o lead mudou de direção? (veio do anúncio / tinha interesse antigo e AGORA pede um TIPO).
  // O cérebro precisa RE-ENTENDER: a mensagem atual manda, o anúncio/interesse é histórico.
  const _priorVehicle = (input.ad_context?.has_ad_context && input.ad_context?.vehicle_query)
    ? String(input.ad_context.vehicle_query)
    : (_int.modelo_desejado || "");
  const _leadDirection = detectLeadDirectionChange(input.message, _priorVehicle);
  const decisionContext = {
    vehicles_shown: _apres.slice(0, 8)
      .map((v: any) => v?.label || [v?.marca, v?.modelo, v?.ano].filter(Boolean).join(" "))
      .filter(Boolean),
    // CANÔNICO (lead.nome / negociacao.* / atendimento.*) + fallback nos campos antigos. Sem isto este
    // decision_context.qualification (o que o prompt manda "NÃO repergunte") saía VAZIO -> re-perguntava tudo.
    qualification: {
      nome: _mem.lead?.nome || _mem.lead_name || _int.nome || null,
      interesse: _int.modelo_desejado || _int.tipo_veiculo || null,
      troca: _mem.negociacao?.carro_troca || _int.carro_troca || _int.trade_in_vehicle || _mem.trade_in_vehicle || null,
      pagamento: _mem.negociacao?.forma_pagamento || _int.forma_pagamento || _int.pagamento || null,
      entrada: _mem.negociacao?.valor_entrada || _int.valor_entrada || null,
      agendamento: _mem.atendimento?.dia_agendamento || _int.dia_agendamento || _int.agendamento || null,
      tem_troca: _mem.negociacao?.tem_troca ?? null,
    },
    // Fonte da verdade = mensagem ATUAL. prior_vehicle é HISTÓRICO (anúncio/interesse), nunca trava.
    lead_direction: {
      changed_direction: _leadDirection.changed_direction,
      current_message_wants_type: _leadDirection.current_type,
      prior_or_ad_vehicle: _leadDirection.prior_vehicle,
    },
    // PLANO A: o que o lead JÁ RECUSOU. NÃO re-ofereça nem lidere com esses modelos/tipos.
    lead_rejeitou: {
      modelos: Array.isArray((_mem as any).rejeitados?.modelos) ? (_mem as any).rejeitados.modelos : [],
      tipos: Array.isArray((_mem as any).rejeitados?.tipos) ? (_mem as any).rejeitados.tipos : [],
    },
    // PLANO B: o FILME da conversa (origem/interesse/rejeitou/etapa) — leia a mensagem ATUAL contra ISTO.
    estado_conversa: buildConversationState(_mem, input.ad_context),
  };

  const userPayload = JSON.stringify({
    lead_message: input.message,
    enriched_message: input.enriched_message,
    pending_question: pendingQuestion,
    last_agent_message: lastAgentMessage,
    decision_context: decisionContext,
    memory: input.memory || {},
    heuristic_intent: input.heuristic_intent || null,
    ad_context: input.ad_context || null,
    media_context: input.media_context || null,
    recent_history: input.recent_history || [],
    vehicle_resolution: input.vehicle_resolution,
  });

  // OTIMIZACAO DE CUSTO: o planner e DECISAO ESTRUTURADA (temp 0.1), nao a resposta ao cliente.
  // callPlanner agora recebe o `llm` (provedor da vez na cadeia de failover) e o modelo.
  const callPlanner = async (llm: NonNullable<ReturnType<typeof buildPlannerLlm>>, responseFormat: any, model: string) => {
    if (llm.isAnthropic) {
      // Anthropic Messages API: system top-level, sem response_format/temperature (compat. opus 4.x).
      return await fetch(llm.url, {
        method: "POST",
        headers: { "x-api-key": llm.key, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          max_tokens: 1024,
          system: `${systemPrompt}\n\nResponda APENAS com o objeto JSON pedido, sem texto extra e sem cercas de codigo.`,
          messages: [{ role: "user", content: userPayload }],
        }),
      });
    }
    return await fetch(llm.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${llm.key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, temperature: 0.1, messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPayload }], response_format: responseFormat }),
    });
  };

  // CADEIA DE FAILOVER: tenta cada provedor; se um falhar (HTTP erro/parse/excecao), TENTA O PROXIMO.
  // So devolve o fallback heuristico se TODOS falharem. O override de modelo (dry-run) vale so p/ o primario.
  for (let _ci = 0; _ci < _plannerChain.length; _ci++) {
    const llm = _plannerChain[_ci];
    const plannerModel = (_ci === 0 && input.planner_model) ? input.planner_model : llm.model;
    try {
      const _t0 = (globalThis as any)?.performance?.now?.() ?? 0;
      // 1) SAIDA ESTRUTURADA ESTRITA (so OpenAI). DeepSeek/Anthropic nao suportam -> json_object.
      let res = llm.isAnthropic
        ? await callPlanner(llm, null, plannerModel)
        : llm.supportsJsonSchema
        ? await callPlanner(llm, { type: "json_schema", json_schema: PLAN_JSON_SCHEMA }, plannerModel)
        : await callPlanner(llm, { type: "json_object" }, plannerModel);
      // 2) DEGRADACAO GRACIOSA (OpenAI/DeepSeek): se rejeitar o schema, cai p/ json_object.
      if (!res.ok && !llm.isAnthropic) {
        console.warn(`[PedroV2] planner ${llm.provider}/${plannerModel} status ${res.status}; degradando p/ json_object`);
        res = await callPlanner(llm, { type: "json_object" }, plannerModel);
      }
      if (!res.ok) {
        // Provedor falhou (sem credito/chave/rate). Registra e TENTA O PROXIMO da cadeia (failover).
        console.warn(`[PedroV2] planner ${llm.provider} status ${res.status}; failover p/ proximo provedor`);
        await recordProviderError(input.ai_key_ctx, llm.provider, "planner", res);
        continue;
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
      const _t1 = (globalThis as any)?.performance?.now?.() ?? 0;
      (plan as any)._planner_meta = {
        provider: llm.provider,
        model: plannerModel,
        prompt_tokens: llm.isAnthropic ? Number(data?.usage?.input_tokens || 0) : Number(data?.usage?.prompt_tokens || 0),
        completion_tokens: llm.isAnthropic ? Number(data?.usage?.output_tokens || 0) : Number(data?.usage?.completion_tokens || 0),
        latency_ms: Math.round(_t1 - _t0),
        failover_from: _ci > 0 ? _plannerChain[0].provider : null, // marca quando NAO foi o primario
      };
      // AUDITORIA: chamada do planner v2 (provedor REAL do failover: openai/deepseek/anthropic). logAiCall nunca lanca.
      if (input.audit?.client && input.audit?.userId) {
        const pm = (plan as any)._planner_meta;
        await logAiCall(input.audit.client, {
          userId: input.audit.userId,
          disparoTipo: "inbound_pedro",
          provedor: llm.provider,
          modelo: plannerModel,
          inputTokens: Number(pm?.prompt_tokens) || 0,
          outputTokens: Number(pm?.completion_tokens) || 0,
          nSubcalls: 1,
          agentId: input.audit.agentId ?? null,
          agentName: input.audit.agentName ?? null,
          meta: { kind: "pedro_v2_planner", failover_from: pm?.failover_from ?? null },
        });
      }
      return plan;
    } catch (error) {
      console.warn(`[PedroV2] planner ${llm.provider} excecao; failover p/ proximo:`, error);
      continue; // FAILOVER: tenta o proximo provedor antes da heuristica
    }
  }
  // Todos os provedores falharam -> heuristica (ultimo recurso).
  return fallback;
}
