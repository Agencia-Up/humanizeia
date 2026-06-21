import { generatePedroSalesReply } from "./replyGenerator_20260525_photo_flow.ts";
import { PedroBrainPlan } from "./pedroBrainPlanner_20260525.ts";
import { PedroV2IntentResult, PedroV2LeadMemory } from "./types.ts";
import { PedroVehicleResolution } from "./vehicleResolver_20260525_brain.ts";
import { sumOpenAiTokens, UsageSink } from "./tokenMeter.ts";
import { logAiCall } from "../observability/aiCallLog.ts";
import { keyFromCtx, recordProviderError, AiKeyCtx } from "../aiKeys.ts";
import { validateGrounding, buildGroundingCorrection, groundedFallback } from "./grounding.ts";

// Remove perguntas-isca / fillers de cortesia PROIBIDOS pelo prompt quando aparecem no FIM da
// mensagem ("Posso ajudar com mais alguma coisa?", "Voce gostaria de saber mais sobre X?",
// "Tem alguma duvida?", "Fico a disposicao"...). O LLM as vezes desobedece a regra de FORMA; este
// strip deterministico garante. So mexe no FIM e em fillers GENERICOS — NUNCA em pergunta de venda
// (ex.: "Quer ver fotos?", "Quer agendar uma visita?", "Consigo te receber sexta?").
function stripFillerClosers(text: string): string {
  const original = String(text || "").trim();
  // Padroes de FILLER de cortesia (testados como substring na ultima frase/clausula).
  const fillerTest = [
    /posso (te |lhe )?ajudar (com|em|a)?\s*(mais )?(alguma coisa|algo|mais alguma)/i,
    /gostaria de saber mais/i,
    /tem (mais )?alguma (d[uú]vida|pergunta)/i,
    /(estou|fico|estarei|sigo|seguimos)\s+(à |a )?(sua )?disposi[cç][aã]o/i,
    /(estou|fico)\s+(aqui|por aqui)( (se|caso) precisar)?/i,
    /se precisar (de (mais )?(informa[cç][oõ]es|ajuda|algo)|de qualquer coisa)/i,
    /qualquer (d[uú]vida|coisa)[, ]/i,
    /\bo que (voc[eê] )?ach(a|ou)\b/i,
  ];
  // Hooks de VENDA legitimos: NUNCA remover uma frase/clausula que tenha isso (pergunta que avanca).
  const salesHook = /\b(foto|fotos|v[ií]deo|visita|test ?drive|agendar|agend|valor|pre[cç]o|parcel|financ|simul|ver o carro|te mostrar|mostrar|op[cç][oõ]es|receber|amanh[aã]|hoje|sexta|s[aá]bado|segunda|cor|km|ano)\b/i;
  const isFiller = (s: string) => fillerTest.some((re) => re.test(s)) && !salesHook.test(s);
  // Tira CLAUSULAS-filler do fim de uma frase (separadas por virgula), em loop.
  const stripClauses = (s: string) => {
    const cs = s.split(/,\s*/);
    while (cs.length > 1 && isFiller(cs[cs.length - 1])) cs.pop();
    return cs.join(", ").replace(/[\s,]+$/, "").trim();
  };

  const parts = original.split(/(?<=[.!?…])\s+/);
  // Da ULTIMA frase pra tras: limpa as clausulas-filler; se a frase ficar vazia OU virar pura
  // filler, remove a frase inteira e repete. Senao, mantem a versao limpa e para. Assim nao
  // perde conteudo real que vinha colado ao filler (ex.: "Pode pesquisar no Google, se precisar
  // de mais informacoes, estou a disposicao" -> "Pode pesquisar no Google.").
  while (parts.length > 0) {
    const i = parts.length - 1;
    const stripped = stripClauses(parts[i]);
    if (parts.length > 1 && (!stripped || isFiller(stripped))) { parts.pop(); continue; }
    if (stripped && stripped !== parts[i]) parts[i] = /[.!?…]$/.test(stripped) ? stripped : stripped + ".";
    break;
  }
  return parts.join(" ").trim() || original; // nunca devolve vazio (mensagem so-filler fica como veio)
}

function sanitizeAgentName(name?: string | null) {
  const clean = String(name || "").trim();
  if (!clean || /^(agente ia|agenteia|ia agente|robo|bot)$/i.test(clean)) {
    return "Carvalho";
  }
  return clean;
}

function checkAgentHasPresented(recentHistory?: any[], recentTurns?: any[]) {
  const merged = [
    ...(Array.isArray(recentHistory) ? recentHistory : []),
    ...(Array.isArray(recentTurns) ? recentTurns : []),
  ];
  let agentTurns = 0;
  for (const turn of merged) {
    const role = normalizeHistoryRole(turn?.role || turn?.direction);
    if (role !== "agent") continue;
    agentTurns++;
    const text = String(turn?.text || turn?.content || turn?.message || "").toLowerCase();
    if (/\b(sou o|sou a|meu nome|aqui da|aqui de|sou consultor|sou consultora)\b/i.test(text)) {
      return true;
    }
  }
  // Fallback ROBUSTO: se ja houve QUALQUER resposta do agente, a apresentacao
  // (saudacao + nome) ja aconteceu no 1o contato -> NAO reapresentar. Evita o
  // re-cumprimento ("Boa noite, Sou o Carvalho...") em toda mensagem quando a
  // frase exata de apresentacao nao casa no historico.
  return agentTurns >= 1;
}

function money(value?: number | null) {
  if (!value || !Number.isFinite(Number(value))) return null;
  return Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function km(value?: number | null) {
  if (!value || !Number.isFinite(Number(value))) return null;
  return `${Number(value).toLocaleString("pt-BR")} km`;
}

function sanitizeModel(model?: string | null) {
  const raw = String(model || "").trim();
  if (!raw) return "gpt-4o";
  const withoutProvider = raw.includes("/") ? raw.split("/").pop() || raw : raw;
  if (/^(gpt-|o\d|chatgpt-)/i.test(withoutProvider)) return withoutProvider;
  return "gpt-4o";
}

function saoPauloNowInfo(date = new Date()) {
  const dateTime = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "short",
    timeStyle: "short",
    hour12: false,
  }).format(date);
  const hourText = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    hour12: false,
  }).format(date);
  const hour = Number(hourText);
  const greeting = hour >= 5 && hour < 12
    ? "Bom dia"
    : hour >= 12 && hour < 18
      ? "Boa tarde"
      : "Boa noite";

  return { date_time: dateTime, hour, greeting };
}

function cleanVehiclePart(value?: string | number | null) {
  return String(value || "")
    .replace(/([A-Za-z])(\d)/g, "$1 $2")
    .replace(/(\d)([A-Za-z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeText(value?: string | null) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function removeDuplicatedModelFromVersion(model: string, version: string) {
  const normalizedModel = normalizeText(model);
  const normalizedVersion = normalizeText(version);
  if (!normalizedModel || !normalizedVersion.startsWith(normalizedModel)) return version;
  const modelWords = normalizedModel.split(/\s+/).filter(Boolean).length;
  const versionWords = version.split(/\s+/).filter(Boolean);
  return versionWords.slice(modelWords).join(" ").trim() || version;
}

function vehicleLabel(vehicle: any) {
  const marca = cleanVehiclePart(vehicle?.marca);
  const modelo = cleanVehiclePart(vehicle?.modelo);
  const versao = removeDuplicatedModelFromVersion(modelo, cleanVehiclePart(vehicle?.versao));
  return [marca, modelo, versao, vehicle?.ano].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

export function leadFirstName(memory?: PedroV2LeadMemory | null) {
  let name = String(memory?.lead?.nome || "").trim();
  if (!name || /^lead$/i.test(name)) return null;
  // O nome do WhatsApp do lead costuma vir com EMOJIS/simbolos ("RUTH ❤️🤩🍀💋").
  // Sem limpar, o agente escrevia "RUTH❤️🤩🍀🍀💋💋, consigo..." como vocativo (horrivel).
  // Mantem so letras (com acento), espaco, hifen e apostrofo; pega o 1o nome; capitaliza.
  name = name.replace(/[^\p{L}\s'-]/gu, " ").replace(/\s+/g, " ").trim();
  const first = name.split(/\s+/)[0] || "";
  if (first.length < 2) return null;
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}

function normalizeHistoryRole(role: any): "lead" | "agent" | null {
  const value = String(role || "").toLowerCase();
  if (["lead", "user", "cliente", "incoming"].includes(value)) return "lead";
  if (["agent", "assistant", "consultor", "outgoing"].includes(value)) return "agent";
  return null;
}

// Remove o primeiro nome do lead usado como VOCATIVO (", Douglas!", "Douglas, ...",
// " Douglas?") para o agente nao repetir o nome a cada mensagem (soa robotico).
function stripLeadNameVocatives(text: string, firstName?: string | null): string {
  const name = String(firstName || "").trim();
  if (!text || name.length < 2) return text;
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let out = text;
  out = out.replace(new RegExp(`,\\s*${esc}(?=[\\s!?.,;:]|$)`, "gi"), "");      // ", Douglas!" -> "!"
  out = out.replace(new RegExp(`(^|[.!?]\\s+)${esc}\\s*,\\s*`, "gi"), "$1");      // "Douglas, ..." inicio -> "..."
  out = out.replace(new RegExp(`\\s+${esc}(?=\\s*[!?.])`, "gi"), "");             // " Douglas!" -> "!"
  out = out.replace(/[ \t]{2,}/g, " ").replace(/\s+([!?.,;:])/g, "$1").trim();
  // Recapitaliza o inicio de frase apos remover o nome vocativo ("Douglas, vamos" -> "Vamos").
  out = out.replace(/(^|[.!?]\s+)([a-zàáâãéêíóôõúç])/g, (_m, p, c) => p + c.toUpperCase());
  return out || text;
}

// Verdadeiro se o agente JA usou o primeiro nome do lead nas ultimas ~3 mensagens
// (para nao repetir o nome em sequencia).
function agentUsedNameRecently(recentHistory: any[] | undefined, firstName?: string | null): boolean {
  const name = String(firstName || "").trim();
  if (name.length < 2 || !Array.isArray(recentHistory)) return false;
  const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
  return recentHistory
    .filter((t) => normalizeHistoryRole(t?.role || t?.direction) === "agent")
    .slice(-3)
    .some((t) => re.test(String(t?.text || t?.content || "")));
}

function buildChatHistory(turns: any[] | undefined, currentMessage: string) {
  const normalizedCurrent = normalizeText(currentMessage);
  const history = (Array.isArray(turns) ? turns : [])
    .map((turn) => {
      const role = normalizeHistoryRole(turn?.role || turn?.direction);
      const text = String(turn?.text || turn?.content || turn?.message || "").trim();
      if (!role || !text) return null;
      return {
        role,
        content: text.slice(0, 1800),
      };
    })
    .filter(Boolean) as Array<{ role: "lead" | "agent"; content: string }>;

  const deduped: Array<{ role: "lead" | "agent"; content: string }> = [];
  for (const turn of history) {
    const previous = deduped[deduped.length - 1];
    if (previous?.role === turn.role && normalizeText(previous.content) === normalizeText(turn.content)) continue;
    deduped.push(turn);
  }

  const trimmed = deduped.slice(-20);
  const last = trimmed[trimmed.length - 1];
  const withoutCurrent = last?.role === "lead" && normalizedCurrent && normalizeText(last.content) === normalizedCurrent
    ? trimmed.slice(0, -1)
    : trimmed;

  return withoutCurrent.map((turn) => ({
    role: turn.role === "agent" ? "assistant" : "user",
    content: turn.content,
  }));
}

function stockFacts(stockResult: any) {
  const items = Array.isArray(stockResult?.items) ? stockResult.items.slice(0, 24) : [];
  return items.map((vehicle: any, index: number) => ({
    index: index + 1,
    label: vehicleLabel(vehicle) || vehicle?.label || vehicle?.modelo || "Veiculo",
    marca: vehicle?.marca || null,
    modelo: vehicle?.modelo || null,
    versao: vehicle?.versao || null,
    ano: vehicle?.ano || null,
    cor: vehicle?.cor || null,
    km: vehicle?.km || null,
    km_formatado: km(vehicle?.km),
    cambio: vehicle?.cambio || null,
    combustivel: vehicle?.combustivel || null,
    preco: vehicle?.preco || null,
    preco_formatado: money(vehicle?.preco),
    // Carro EXISTE mas sem preco cadastrado (R$0/null): o reply apresenta pelo modelo/ano/
    // km/cor e diz que CONFIRMA o valor — nunca mostra R$0 nem nega o carro (regra C2).
    preco_a_confirmar: Boolean(vehicle?.preco_a_confirmar) || !(Number(vehicle?.preco) > 0),
    imagem: vehicle?.principal_image || vehicle?.fotos?.[0] || null,
    match_score: vehicle?.match_score || null,
    relaxed_match: Boolean(vehicle?.relaxed_match),
  }));
}

function adSignalText(input: {
  ad_context?: any;
  message?: string | null;
  plan?: PedroBrainPlan | null;
}) {
  return normalizeText([
    input.message,
    input.ad_context?.source,
    input.ad_context?.url,
    input.ad_context?.title,
    input.ad_context?.description,
    input.ad_context?.raw_text,
    input.ad_context?.summary,
    input.plan?.reason,
    input.plan?.response_guidance,
  ].filter(Boolean).join(" "));
}

function hasCurrentAdSignal(input: {
  ad_context?: any;
  plan: PedroBrainPlan;
  vehicle_resolution: PedroVehicleResolution;
  message: string;
}) {
  const signal = adSignalText(input);
  return Boolean(
    input.vehicle_resolution?.source === "ad_context" ||
      input.vehicle_resolution?.source === "media_context" ||
      /facebook|instagram|story_fbid|post_id|fbclid|anuncio|propaganda|campanha|link|thumbnail|imagem|media/.test(signal),
  );
}

function isCurrentTurnAdVehicleConsultation(input: {
  ad_context?: any;
  plan: PedroBrainPlan;
  vehicle_resolution: PedroVehicleResolution;
  message: string;
}) {
  if (String(input.plan?.reason || "").startsWith("enforced_ad_vehicle_consultation")) return true;
  const adVehicle = normalizeText(input.ad_context?.vehicle_query || "");
  if (!input.ad_context?.has_ad_context || !adVehicle || input.plan?.action !== "stock_search") return false;
  // LEAD AMPLIOU P/ TIPO GENERICO (lead 99716-4335): clicou no anuncio do Tracker mas disse "procuro
  // um suv 2020 pra frente" — pedido de CATEGORIA, sem nomear o modelo do anuncio. Nao e consulta do
  // anuncio: o agente deve APRESENTAR os SUVs (a busca ja veio ampla), nao reduzir os fatos a so o
  // Tracker e fixar nele. So pula quando o lead cita um TIPO e NAO cita o modelo do anuncio.
  // SO a parte do LEAD: o enriched_message anexa "Veiculo/Contexto do anuncio: <Tracker...>" — sem
  // tirar isso, "tracker" do anuncio contaminaria o check e o lead "pareceria" ter nomeado o modelo.
  const _leadOnlyMsg = String(input.message || "").split(/\n*(?:ve[ií]culo do an[úu]ncio|contexto do an[úu]ncio|origem\s*\/\s*link)/i)[0];
  const _msgN = normalizeText(_leadOnlyMsg);
  const _leadNamedType = /\b(suv|utilitario|sedan|seda|hatch|hatchback|picape|pickup|caminhonete|camionete)\b/.test(_msgN);
  const _adModelTokens = adVehicle.split(/\s+/).filter((t) =>
    t.length >= 3 && !/^(19|20)\d{2}$/.test(t)
    && !["premier", "activ", "sense", "midnight", "turbo", "flex", "aut", "mec", "manual", "automatico"].includes(t));
  const _leadNamedAdModel = _adModelTokens.some((t) => _msgN.includes(t));
  if (_leadNamedType && !_leadNamedAdModel) return false;
  const planVehicle = normalizeText(input.plan?.search_query || input.plan?.search_filters?.modelo_desejado || "");
  const resolvedVehicle = normalizeText(input.vehicle_resolution?.query || "");
  return Boolean(
    (planVehicle && (planVehicle.includes(adVehicle) || adVehicle.includes(planVehicle))) ||
    (resolvedVehicle && (resolvedVehicle.includes(adVehicle) || adVehicle.includes(resolvedVehicle))) ||
    input.vehicle_resolution?.source === "ad_context" ||
    input.vehicle_resolution?.source === "media_context"
  );
}

function looksLikePhotoPromise(text: string) {
  const normalized = normalizeText(text);
  return /\b(aqui estao as fotos|segue as fotos|seguem as fotos|vou te mandar as fotos|vou mandar as fotos|te mando as fotos|te envio as fotos|enviei as fotos|mandei as fotos|vou enviar as fotos|separei fotos)\b/.test(normalized);
}

function buildPhotoPromiseGuardReply(input: {
  memory?: PedroV2LeadMemory | null;
  vehicle_resolution?: PedroVehicleResolution | null;
  ad_context?: any;
}) {
  const name = leadFirstName(input.memory);
  const vehicle =
    input.vehicle_resolution?.query ||
    input.ad_context?.vehicle_query ||
    input.memory?.referencia?.ultimo_veiculo_label ||
    input.memory?.interesse?.modelo_desejado ||
    "esse carro";

  return [
    `${name ? `${name}, ` : ""}consigo te mandar sim.`,
    `So vou separar as fotos certas do ${vehicle} pra nao te enviar imagem errada.`,
  ].join("\n\n");
}

function buildAdVehicleConsultationFallback(input: {
  memory?: PedroV2LeadMemory | null;
  facts: any[];
  ad_context?: any;
  agent?: any;
  has_presented?: boolean;
}) {
  const name = leadFirstName(input.memory);
  const vehicle = input.facts[0];
  const label = vehicle?.label || input.ad_context?.vehicle_query || "esse carro do anuncio";
  const details = [
    vehicle?.preco_formatado,
    vehicle?.km_formatado,
    vehicle?.cambio,
    vehicle?.cor,
  ].filter(Boolean).join(" | ");
  const greeting = saoPauloNowInfo().greeting;
  const agentName = sanitizeAgentName(input.agent?.name);
  const companyName = input.agent?.company_name || "Icom Motors";

  // Abertura POSITIVA por MODELO (espelha a logica MODELO-first do caminho LLM). O rotulo
  // do anuncio sai SEM o ano (impreciso); os dados reais vem do fato do estoque. Quando o
  // modelo NAO existe (facts vazio), versao honesta oferecendo parecidos.
  const modeloAnuncio = String(input.ad_context?.vehicle_query || "").replace(/\b(?:19|20)\d{2}\b/g, "").replace(/\s+/g, " ").trim() || "esse carro do anuncio";
  const modeloReal = vehicle?.modelo || modeloAnuncio;
  const stockLine = vehicle
    ? `Temos um ${modeloReal} aqui sim! No estoque tem ${vehicle.label}${details ? ` — ${details}` : "."}`
    : `Vi que voce veio pelo anuncio do ${modeloAnuncio}. Esse modelo eu nao tenho agora, mas consigo te mostrar uns parecidos — quer ver?`;

  if (input.has_presented) {
    return [
      stockLine,
      "Quer que eu te mande mais detalhes ou fotos dele?",
    ].join("\n\n");
  }

  const firstLine = `${greeting}${name ? `, ${name}` : ""}! Sou o ${agentName}, consultor aqui da ${companyName}.`;

  return [
    firstLine,
    stockLine,
    "Quer que eu te mande mais detalhes ou fotos dele?",
  ].join("\n\n");
}

export function buildDeterministicStockReply(input: {
  memory?: PedroV2LeadMemory | null;
  plan: PedroBrainPlan;
  intent?: PedroV2IntentResult | null;
  stock_result: any;
}) {
  const items = stockFacts(input.stock_result);
  const requested = input.plan.search_query || input.intent?.extracted?.interesse?.modelo_desejado || input.memory?.interesse?.modelo_desejado || "o que voce pediu";
  if (items.length === 0) {
    return `Conferi no estoque real e nao achei ${requested} disponivel agora.\n\nSe fizer sentido, posso procurar algo parecido por faixa de valor ou cambio.`;
  }

  // NUNCA despejar a lista inteira (polui a conversa) nem colar URL de foto (o WhatsApp nao
  // renderiza — sai link cru, feio). Mostra ATE 5, formato limpo (1 linha por carro), insinua
  // que ha mais e fecha com pergunta que desenrola (padrao SDR). Vale mesmo quando o LLM cai
  // e este fallback assume.
  const shown = items.slice(0, 5);
  const list = shown.map((vehicle) => {
    const det = [
      vehicle.preco_formatado || null,
      vehicle.km_formatado || null,
      vehicle.cambio || null,
      vehicle.cor || null,
    ].filter(Boolean).join(" · ");
    return `${vehicle.index}. *${vehicle.label}*${det ? ` — ${det}` : ""}`;
  }).join("\n");
  const more = items.length > shown.length
    ? `\n\nEsses sao alguns dos nossos modelos — tenho mais opcoes tambem.`
    : "";
  return `Temos sim! Olha algumas opcoes:\n\n${list}${more}\n\nQuer ver fotos de algum desses ou prefere que eu te mostre mais opcoes?`;
}

// Limpa MARKDOWN/URLs que o WhatsApp NAO renderiza (saiam crus pro cliente, feio):
// - [texto](url) e ![alt](url) de imagem/blob viram nada (fotos vao como MIDIA, nao link);
// - links markdown comuns mantem so o texto; URLs cruas de imagem/blob somem;
// - **negrito** vira *negrito* (sintaxe do WhatsApp).
function stripMarkdownForWhatsApp(text: string): string {
  let t = String(text || "");
  t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, ""); // imagem markdown
  t = t.replace(/\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g, (_m, label, url) =>
    /blob\.core\.windows\.net|bndv|\.(jpe?g|png|webp|gif)(\?|$)/i.test(url) ? "" : String(label)
  );
  t = t.replace(/https?:\/\/\S*(?:blob\.core\.windows\.net|bndv)\S*/gi, "");
  t = t.replace(/https?:\/\/\S+\.(?:jpe?g|png|webp|gif)(?:\?\S*)?/gi, "");
  t = t.replace(/\*\*([^*\n]+)\*\*/g, "*$1*");
  t = t.replace(/^[ \t]*(?:Foto|Imagem|Veja a foto|Veja a imagem)\s*:?\s*$/gim, "");
  t = t.replace(/[ \t]{2,}/g, " ").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return t;
}

export function ensureStockReplyFormatting(input: {
  text: string;
  facts: any[];
  memory?: PedroV2LeadMemory | null;
  plan: PedroBrainPlan;
  intent?: PedroV2IntentResult | null;
  stock_result?: any;
  ad_vehicle_consultation?: boolean;
}) {
  // Mantem a formatacao humana da LLM, mas LIMPA markdown/URLs que o WhatsApp nao
  // renderiza (link de imagem cru "[Veja a foto](https://...blob...)" vazava pro cliente).
  let text = stripMarkdownForWhatsApp(input.text);
  // LISTA DE VEICULOS LEGIVEL (lead 99214-4889: "1. Onix... R$64.990. 2. Onix... R$66.990. 3. ..."
  // tudo na MESMA linha -> ilegivel no WhatsApp). Poe cada item NUMERADO em sua propria linha.
  // So dispara com >=2 itens "<digito>. <LETRA>" (exige espaco+digito(s)+ponto+espaco+LETRA, entao
  // NAO casa preco "64.990" nem "R$ 2.000": apos o ponto do preco vem digito, nunca espaco+letra).
  const itemRe = /(?:^|\s)\d{1,2}\.\s+(?=[A-Za-zÀ-ÿ])/g;
  if ((text.match(itemRe) || []).length >= 2) {
    text = text.replace(/[ \t]*\n?\s*(\d{1,2})\.\s+(?=[A-Za-zÀ-ÿ])/g, "\n$1. ").trim();
  }
  return text;
}

function fallbackReply(input: {
  agent?: any;
  memory?: PedroV2LeadMemory | null;
  intent?: PedroV2IntentResult | null;
  stock_result?: any;
  message: string;
  plan: PedroBrainPlan;
  ad_context?: any;
  vehicle_resolution?: PedroVehicleResolution;
  recent_history?: any[];
}) {
  const allFacts = stockFacts(input.stock_result);
  const adVehicleConsultation = isCurrentTurnAdVehicleConsultation({
    ad_context: input.ad_context,
    plan: input.plan,
    vehicle_resolution: input.vehicle_resolution || ({} as PedroVehicleResolution),
    message: input.message,
  });

  const hasPresented = checkAgentHasPresented(input.recent_history, input.memory?.recent_turns);
  const agentName = sanitizeAgentName(input.agent?.name);
  const companyName = input.agent?.company_name || "Icom Motors";

  if (input.stock_result?.is_generic_query) {
    const greeting = saoPauloNowInfo().greeting;
    const name = leadFirstName(input.memory);
    const text = hasPresented
      ? `Ainda não consegui identificar qual era o veículo do anúncio que você estava vendo. Qual veículo você tem interesse?`
      : `${greeting}${name ? `, ${name}` : ""}! Sou o ${agentName}, consultor aqui da ${companyName}. Vi que você veio pelo anúncio, mas não consegui identificar o modelo certinho. Qual veículo você estava vendo ou tem interesse?`;
    return {
      ok: true,
      text,
      source: "brain_generic_fallback",
      presented_vehicle_indices: [],
    };
  }

  if (adVehicleConsultation) {
    return {
      ok: true,
      text: buildAdVehicleConsultationFallback({
        memory: input.memory,
        facts: allFacts.slice(0, 1),
        ad_context: input.ad_context,
        agent: input.agent,
        has_presented: hasPresented,
      }),
      source: "brain_ad_vehicle_fallback",
      presented_vehicle_indices: allFacts.length > 0 ? [1] : [],
    };
  }

  if (Array.isArray(input.stock_result?.items)) {
    return {
      ok: true,
      text: buildDeterministicStockReply({
        memory: input.memory,
        intent: input.intent,
        plan: input.plan,
        stock_result: input.stock_result,
      }),
      source: "brain_stock_fallback",
      presented_vehicle_indices: allFacts.map((item) => item.index),
    };
  }

  return generatePedroSalesReply({
    memory: input.memory,
    intent: input.intent,
    stock_result: input.stock_result,
    message: input.message,
    agent: input.agent,
    recent_history: input.recent_history,
  });
}

function cleanJson(text: string) {
  return text.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
}

// Resolve o provedor+modelo do REPLY a partir do agent.model ("provider/model" do dropdown do
// painel). Default (vazio/desconhecido/legado) = Claude Haiku 4.5 — medido igual/melhor que o
// gpt-4o nos turnos de estoque/conversa e ~2,4x mais barato. So suportamos OpenAI (gpt-4o/mini),
// Claude Haiku 4.5 e DeepSeek no reply; Gemini ainda nao e suportado (cai no default).
function resolveReplyTarget(agentModel?: string | null): { provider: "openai" | "anthropic" | "deepseek"; model: string } {
  const raw = String(agentModel || "").toLowerCase().trim();
  if (raw.startsWith("anthropic/") || raw.includes("claude") || raw.includes("haiku") || raw.includes("sonnet")) {
    return { provider: "anthropic", model: "claude-haiku-4-5" };
  }
  if (raw.startsWith("deepseek")) {
    return { provider: "deepseek", model: "deepseek-chat" };
  }
  if (raw.startsWith("openai/") || raw.startsWith("gpt")) {
    return { provider: "openai", model: raw.includes("mini") ? "gpt-4o-mini" : "gpt-4o" };
  }
  return { provider: "anthropic", model: "claude-haiku-4-5" };
}

export async function generatePedroBrainReply(input: {
  agent?: any;
  agent_system_prompt?: string | null;
  assigned_seller_name?: string | null;
  memory?: PedroV2LeadMemory | null;
  intent?: PedroV2IntentResult | null;
  stock_result?: any;
  message: string;
  plan: PedroBrainPlan;
  vehicle_resolution: PedroVehicleResolution;
  ad_context?: any;
  media_context?: any;
  recent_history?: any[];
  tool_result?: any;
  usage_sink?: UsageSink;
  audit?: { client: any; userId: string; agentId?: string | null; agentName?: string | null };
  reply_provider_override?: string | null;
  reply_model_override?: string | null;
  ai_key_ctx?: AiKeyCtx | null;
}) {
  const hasPresented = checkAgentHasPresented(input.recent_history, input.memory?.recent_turns);
  const agentName = sanitizeAgentName(input.agent?.name);
  // Vendedor dono do lead (modo assistente): quando presente, o agente vira ASSISTENTE
  // do vendedor — nao requalifica, nao manda foto, roteia tudo para ele.
  const assignedSellerName = (input.assigned_seller_name || "").trim() || null;
  const fallback = fallbackReply({ ...input, recent_history: input.recent_history });
  // BYOK: chave de OpenAI da conta (cliente > nossa-se-grandfathered). keyFromCtx ja recebe a
  // openai_key resolvida no gate do orchestrator (sem RPC extra). Sem ctx (legado) -> env.
  const apiKey = await keyFromCtx(input.ai_key_ctx, "openai");

  const allFacts = stockFacts(input.stock_result);
  const adVehicleConsultation = isCurrentTurnAdVehicleConsultation(input);
  // CONSULTA DE ANUNCIO = MODELO-first. O ANO do anuncio (metadado/arte do Facebook) e
  // IMPRECISO; antes o fato era escolhido pelo ANO ("Mini Cooper 2023") e, como o estoque
  // era 2019, _adMatchedFact ficava null -> o LLM dizia "nao temos o 2023". Agora casamos
  // pelo MODELO (o que o estoque TEM) e usamos o ano so como DESEMPATE, nunca eliminatorio.
  const _adQuery = String(input.ad_context?.vehicle_query || "");
  const _adYear = (_adQuery.match(/\b(?:19|20)\d{2}\b/) || [])[0] || null;
  // Preserva o modelo numerico "2008" da Peugeot ao remover o ano (bug ANU-1: "Peugeot 2008"
  // virava "peugeot" e casava QUALQUER Peugeot). Demais modelos numericos nao casam o regex de ano.
  const _adModelo = normalizeText(_adQuery.replace(/\b(?:19|20)\d{2}\b/g, (m) =>
    (/peugeot/i.test(_adQuery) && m === "2008") ? m : " "));
  const _adModelFacts = _adModelo
    ? allFacts.filter((f: any) => {
        const m = normalizeText(f?.modelo || "");
        const l = normalizeText(f?.label || "");
        // Casa se o LABEL do estoque contem o modelo do anuncio, OU se o modelo do anuncio
        // contem o modelName do estoque (token >=3 p/ evitar falso-positivo). NUNCA usar
        // l.includes(m): o label sempre contem o proprio modelName -> casaria TODO carro.
        return l.includes(_adModelo) || (m.length >= 3 && _adModelo.includes(m));
      })
    : [];
  const _adExactYear = _adYear ? _adModelFacts.find((f: any) => String(f?.ano || "").includes(_adYear)) : null;
  const _adMatchedFact = _adExactYear || _adModelFacts[0] || null;
  const _adModelInStock = _adModelFacts.length > 0;
  const _adYearMatched = Boolean(_adExactYear);
  const facts = adVehicleConsultation
    ? (_adMatchedFact ? [_adMatchedFact] : allFacts.slice(0, 1))
    : allFacts;
  // LEAD AMPLIOU P/ UM TIPO (suv/sedan/...) sem nomear o modelo do anuncio = esta NAVEGANDO a
  // categoria (lead 99716-4335: clicou no Tracker, disse "procuro um suv 2020 pra frente"). NAO ha
  // "veiculo em foco" unico -> o reply deve APRESENTAR as opcoes (stock.facts), nao liderar com o
  // carro do anuncio. So a parte do LEAD (sem o anexo "Veiculo/Contexto do anuncio: <Tracker...>").
  const _leadMsgOnly = String(input.message || "").split(/\n*(?:ve[ií]culo do an[úu]ncio|contexto do an[úu]ncio|origem\s*\/\s*link)/i)[0];
  const _leadMsgN = normalizeText(_leadMsgOnly);
  const _adModelTok = normalizeText(input.ad_context?.vehicle_query || "").split(/\s+/)
    .filter((t) => t.length >= 3 && !/^(19|20)\d{2}$/.test(t)
      && !["premier", "activ", "sense", "midnight", "turbo", "flex", "aut", "mec", "manual", "automatico"].includes(t));
  const _leadBroadenedToType = /\b(suv|utilitario|sedan|seda|hatch|hatchback|picape|pickup|caminhonete|camionete)\b/.test(_leadMsgN)
    && !_adModelTok.some((t) => _leadMsgN.includes(t))
    && allFacts.length > 1;
  // VEICULO EM FOCO: o carro que o lead esta de fato discutindo (resolvido OU o
  // ultimo apresentado), com FATOS explicitos. Serve para o LLM responder
  // perguntas de atributo (preco/km/cor/ano) sobre ELE — e NUNCA sobre o carro
  // de TROCA do cliente (que pode ter contaminado memory.interesse.modelo_desejado).
  const focusVehicle = (() => {
    if (_leadBroadenedToType) return null; // navegando categoria -> sem foco unico, apresenta a lista
    const apres = Array.isArray(input.memory?.veiculos_apresentados) ? input.memory.veiculos_apresentados : [];
    if (apres.length === 0) return null;
    const q = normalizeText(input.vehicle_resolution?.query || "");
    const match = q
      ? apres.find((v: any) => {
          const lbl = normalizeText(v?.label || v?.modelo || "");
          const mod = normalizeText(v?.modelo || "");
          return (lbl && lbl.includes(q)) || (mod && q.includes(mod));
        })
      : null;
    const v: any = match || apres[0];
    if (!v) return null;
    return {
      label: v.label || [v.marca, v.modelo, v.ano].filter(Boolean).join(" ") || null,
      marca: v.marca ?? null, modelo: v.modelo ?? null, versao: v.versao ?? null,
      ano: v.ano ?? null, preco: v.preco ?? null, km: v.km ?? null,
      cor: v.cor ?? null, cambio: v.cambio ?? null, combustivel: v.combustivel ?? null,
    };
  })();
  // CONJUNTO APRESENTADO (working set da conversa): os veiculos que o agente JA mostrou neste
  // atendimento, COM fotos salvas. RAIZ do "agente mente sobre o proprio estoque" (lead 99214-4889:
  // apresentou 3 Onix, lead pediu "E os outros" e o agente disse "so tenho as fotos do Activ 2017" —
  // FALSO, tinha fotos dos 3). O reply so recebia `veiculo_em_foco` (1 carro) + stock.facts (busca do
  // turno, VAZIA em follow-up tipo "os outros") -> alucina que so tem 1. Damos a lista inteira como
  // VERDADE pro reply: ele nunca nega ter um carro/fotos que ESTAO aqui, e resolve "os outros / o
  // segundo / o branco / o de 2022" contra ela. Generico p/ qualquer lista de qualquer modelo.
  const presentedVehicles = (Array.isArray(input.memory?.veiculos_apresentados) ? input.memory!.veiculos_apresentados : [])
    .slice(0, 12)
    .map((v: any, i: number) => ({
      n: i + 1,
      label: v?.label || [v?.marca, v?.modelo, v?.ano].filter(Boolean).join(" ") || null,
      ano: v?.ano ?? null,
      cor: v?.cor ?? null,
      preco: v?.preco ?? null,
      km: v?.km ?? null,
      tem_fotos: Array.isArray(v?.fotos) ? v.fotos.length > 0 : Number(v?.images_count) > 0,
    }))
    .filter((v: any) => v.label);
  const currentTime = saoPauloNowInfo();
  const chatHistory = buildChatHistory(input.recent_history || input.memory?.recent_turns || [], input.message);
  // ── PROVEDOR DA RESPOSTA (conversa com o cliente): Claude principal (teste) / OpenAI / DeepSeek. ──
  // Env PEDRO_REPLY_PROVIDER (anthropic|openai|deepseek), default 'anthropic'. Claude NAO e compativel
  // com OpenAI: /v1/messages, x-api-key, 'system' top-level, sem response_format, saida content[].text.
  // Default SEGURO = openai (gpt-4o afinado e confiavel p/ apresentar estoque). Claude (anthropic) fica
  // ligavel por env, mas QUEBRA nos turnos de estoque ate o prompt/JSON ser adaptado p/ ele.
  // ── PROVEDOR/MODELO DO REPLY — agora POR AGENTE (agent.model = "provider/model" do dropdown). ──
  // Default = Claude Haiku 4.5. Ordem de precedencia: override de dry-run (A/B) > FORCE global de
  // emergencia (env PEDRO_REPLY_FORCE_PROVIDER, normalmente VAZIO) > escolha do agente > Haiku.
  // (O antigo PEDRO_REPLY_PROVIDER deixou de mandar: a escolha agora e por agente.)
  const agentTarget = resolveReplyTarget(input.agent?.model);
  const envForceProvider = String(Deno.env.get("PEDRO_REPLY_FORCE_PROVIDER") || "").toLowerCase();
  const replyProvider = String(input.reply_provider_override || envForceProvider || agentTarget.provider).toLowerCase();
  // BYOK: chaves dos provedores tambem resolvem por conta (cliente > nossa-se-grandfathered).
  const anthropicKeyR = await keyFromCtx(input.ai_key_ctx, "anthropic");
  const deepseekKeyR = await keyFromCtx(input.ai_key_ctx, "deepseek");
  // ── PILAR E: CADEIA DE FAILOVER do REPLY. Primario (override/env-force/agente) primeiro; rede de
  // seguranca = OpenAI e DeepSeek (NAO Anthropic no failover: o reply de ESTOQUE quebra no Claude ate
  // o prompt ser adaptado). Se o provedor da vez falhar, tenta o proximo ANTES do fallback deterministico
  // — resolve a degradacao silenciosa quando um provedor cai (OpenAI sem credito -> brush-off burro).
  const buildReplyLlm = (prov: string) => {
    if (prov === "anthropic" || prov === "claude") {
      return anthropicKeyR
        ? { provider: "anthropic", isAnthropic: true, isDeepseek: false, key: anthropicKeyR as string, model: (agentTarget.provider === "anthropic" && !envForceProvider ? agentTarget.model : (Deno.env.get("PEDRO_REPLY_MODEL_ANTHROPIC") || "claude-haiku-4-5")) }
        : null;
    }
    if (prov === "deepseek") {
      return deepseekKeyR
        ? { provider: "deepseek", isAnthropic: false, isDeepseek: true, key: deepseekKeyR as string, model: Deno.env.get("PEDRO_REPLY_MODEL_DEEPSEEK") || "deepseek-chat" }
        : null;
    }
    return apiKey
      ? { provider: "openai", isAnthropic: false, isDeepseek: false, key: apiKey as string, model: (agentTarget.provider === "openai" ? agentTarget.model : (sanitizeModel(input.agent?.model) || "gpt-4o")) }
      : null;
  };
  const _replyChain = [replyProvider, "openai", "deepseek"]
    .filter((p, i, a) => a.indexOf(p) === i)
    .map(buildReplyLlm)
    .filter(Boolean) as Array<NonNullable<ReturnType<typeof buildReplyLlm>>>;
  if (_replyChain.length === 0) return fallback;
  const callReply = async (llm: NonNullable<ReturnType<typeof buildReplyLlm>>, model: string, msgs: any[]) => {
    if (llm.isAnthropic) {
      const sys = `${String(msgs[0]?.content ?? "")}\n\nResponda APENAS com o objeto JSON pedido, sem texto fora do JSON e sem cercas de codigo.`;
      const conv = msgs.slice(1).map((m: any) => ({ role: m?.role === "assistant" ? "assistant" : "user", content: String(m?.content ?? "") }));
      return await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": llm.key, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
        body: JSON.stringify({ model, max_tokens: 4096, system: sys, messages: conv }),
      });
    }
    const url = llm.isDeepseek ? "https://api.deepseek.com/v1/chat/completions" : "https://api.openai.com/v1/chat/completions";
    return await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${llm.key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, temperature: 0.35, response_format: { type: "json_object" }, messages: msgs }),
    });
  };
  try {
    const replyMessages: any[] = [
          {
            role: "system",
            content:
              [
                `Voce e o ${agentName}, consultor humano da ${input.agent?.company_name || "Icom Motors"} no WhatsApp.`,
                ...(assignedSellerName ? [
                  `== MODO ASSISTENTE DO VENDEDOR (REGRA MAXIMA — PREVALECE SOBRE TUDO, INCLUSIVE O PORTAL) ==`,
                  `Este lead JA esta em atendimento com o vendedor ${assignedSellerName}. Voce NAO e o vendedor dele agora — voce e um ASSISTENTE que da um suporte rapido e PASSA a bola pro ${assignedSellerName}.`,
                  `- PROIBIDO requalificar: NAO pergunte nome, CPF, troca, entrada, forma de pagamento, e NAO ofereca agendar visita. O ${assignedSellerName} ja cuida disso. NUNCA pergunte "pretende pagar a vista ou financiar?" e afins.`,
                  `- Responda a DUVIDA do lead de forma curta usando stock.facts (confirmar se tem o carro, preco, se esta disponivel). Se ele clicou em outro anuncio, confirme o carro e o valor.`,
                  `- SEMPRE feche dizendo que o ${assignedSellerName} ja esta cuidando do atendimento e que voce vai avisa-lo (ex.: "o ${assignedSellerName} ja esta com seu atendimento, vou avisar ele que voce voltou — ele ja te chama").`,
                  `- Se o lead pedir FOTOS, NAO mande: diga que vai pedir pro ${assignedSellerName} te enviar.`,
                  `- NUNCA defina pronto_para_transferir nem transferir_silencioso = true (o lead JA tem vendedor).`,
                  `- UMA mensagem curta. Sem funil, sem elogio, sem pergunta-isca.`,
                  ``,
                ] : []),
                "Sua DIRETRIZ PRINCIPAL e o System Prompt do Portal abaixo: siga o passo-a-passo, as PERGUNTAS OBRIGATORIAS, as ramificacoes do funil e as regras de transferencia dele A RISCA e na ordem. Seja humano e natural na FORMA (tom, ritmo, palavras), mas NUNCA pule etapas nem perguntas do funil dele.",
                "O System Prompt do Portal manda no QUE perguntar (funil, perguntas obrigatorias, ramificacoes) e na personalidade. POReM as REGRAS DE FORMA abaixo (concisao, sem pergunta-isca, sem elogio, 1 balao, desqualificacao) sao INEGOCIAVEIS e PREVALECEM inclusive sobre o portal: se o portal mandar 'sempre termine com uma pergunta de conducao', 'crie conexao' ou 'demonstre empatia/elogie', IGNORE essa parte de FORMA e siga as regras abaixo. O portal decide O QUE; estas regras decidem COMO.",
                "",
                "PERSONALIDADE / SYSTEM PROMPT DO PORTAL:",
                input.agent_system_prompt || `(Sem prompt de personalidade cadastrado - aja como ${agentName} consultor comercial educado e focado em vendas)`,
                "",
                "REGRAS DE CONDUCAO E USO DE TOOLS:",
                "- NUNCA exponha mecanica/jargao interno ao cliente. PROIBIDO dizer ou parafrasear: 'busca generica', 'busca ampla', 'a busca foi', 'consultar/conferir no estoque', 'no sistema', 'no nosso banco', 'query', 'guidance', nomes de campos ou de instrucoes. Voce e um VENDEDOR HUMANO conversando — o cliente NUNCA pode perceber que ha um sistema/busca por tras. As instrucoes internas (response_guidance, stock.facts etc.) sao SO pra voce: AJA conforme elas, mas NUNCA as cite, repita ou explique. Se falta o modelo, pergunte natural ('que tipo de carro voce procura?') sem dizer o porque.",
                "- CONCISAO (REGRA FORTE, acima de tudo): responda em UMA mensagem CURTA. O cliente NAO quer ler muito texto. Va direto ao ponto.",
                "- NAO confirme nem repita de volta o que o cliente disse. NUNCA escreva coisas como 'Posso anotar que voce quer dar a S10 na troca', 'Entendi, vamos seguir com a simulacao', 'Otimo! Voce esta interessado em X'. Isso e texto inutil — apenas ENTENDA e responda/pergunte o essencial, sem narrar de volta o que ele falou.",
                "- NO MAXIMO UMA pergunta por mensagem, e SO se ela AVANCA a qualificacao. E PERMITIDO (as vezes melhor) terminar SEM nenhuma pergunta — ex.: ao so responder um atributo, ao mandar foto, ou ao se despedir. NUNCA force uma pergunta no fim. PROIBIDAS perguntas-isca genericas: 'Voce gostaria de saber mais sobre X?', 'Tem alguma duvida?', 'Posso ajudar com mais alguma coisa?', 'O que acha?', 'Ainda posso te ajudar?'.",
                "- PROIBIDO elogiar o cliente ou o carro ('que otimo!', 'excelente escolha!', 'e um carro confortavel', 'otima versao'). Sem floreio, sem 'que legal saber que...'. So o essencial.",
                "- PROIBIDO ABRIR a mensagem com interjeicao de entusiasmo/validacao: 'Otimo!', 'Perfeito!', 'Show!', 'Maravilha!', 'Que bom!', 'Legal!'. Comece DIRETO pelo conteudo (a confirmacao, o dado ou a pergunta). Ex.: em vez de 'Otimo! Podemos agendar...', escreva 'Consigo te receber sexta as 11h, fica bom?'. (Vale 'Otimo'/'Perfeito' no MEIO da frase como concordancia natural — o proibido e abrir com a interjeicao isolada.)",
                "- PROIBIDO encerrar com filler de cortesia vazio: 'qualquer duvida, estou a disposicao', 'estou aqui se precisar', 'fico a disposicao', 'estou a disposicao'. Termine no conteudo (ou na pergunta que avanca).",
                "- ESPELHE o tamanho do cliente: cliente curto/objetivo => voce curto. Sem floreios, sem frases de preenchimento, sem repetir o que ja foi dito. Uma ideia por mensagem.",
                "- Siga a sua personalidade principal do portal na escrita das mensagens.",
                "- Se houver veiculos em stock.facts, liste as opcoes de forma natural e amigavel conforme sua personalidade, com os dados principais (modelo, ano, preco, km). Ao listar VARIOS veiculos, coloque CADA UM em sua PROPRIA LINHA (uma quebra de linha entre eles) — NUNCA enfileire varios carros na mesma linha, fica ilegivel no WhatsApp.",
                "- DESENVOLVA A CONVERSA quando o criterio e AMPLO (ex.: 'SUV ate 120 mil') e ha VARIAS opcoes em stock.facts: apresente NO MAXIMO ~5 opcoes (pode ser as mais em conta — stock.facts ja vem ordenado por preco). NUNCA despeje a lista inteira: mandar 10+ veiculos POLUI a conversa e espanta o cliente. SINALIZE que ha mais ('esses sao alguns dos nossos modelos', 'temos outras opcoes tambem'). E SEMPRE termine com UMA pergunta que DESENROLA pra qualificar o lead: oferecer fotos de algum, mostrar mais opcoes, OU afunilar (marca/ano/cambio/uso). Ex.: 'Quer ver fotos de algum desses ou prefere que eu te mostre mais opcoes?'. Mantendo o padrao SDR (1 pergunta por vez, sem textao).",
                "- VARIOS MODELOS: se o lead cita MAIS DE UM modelo ('Tcross ou Compass', 'os dois', 'A e B'), trate TODOS os que ele pediu — fale/mostre cada um que exista em stock.facts. NUNCA responda so um e ignore o resto; se um deles nao tiver no estoque, diga isso e foque no(s) que tem.",
                "- VARIAS UNIDADES DO MESMO MODELO/VERSAO (REGRA FORTE): quando o lead pergunta por um MODELO ou VERSAO especifico (ex.: 'o Compass T270', 'a Premier', 'o modelo 270') e stock.facts tem MAIS DE UMA unidade que corresponde (mesmo modelo/versao, com ano/cor/km/preco diferentes), apresente TODAS as unidades correspondentes — CADA UMA em sua propria linha (ano, cor, km, preco) — NUNCA mostre so uma e esconda as outras: o lead quer comparar e escolher. Ex.: 'Temos 2 Compass T270 2023 aqui: um azul, 60.700 km, R$ 133.990; e um preto, 49.500 km, R$ 134.990. Quer ver fotos de algum deles?'.",
                "- NAO REPITA A MESMA LISTA, mas TAMBEM nao trave: se voce JA apresentou alguns veiculos e o lead reforca o criterio ou quer ver mais, MOSTRE OUTROS de stock.facts que voce ainda NAO apresentou (quase sempre ha mais). So pergunte/afunile depois de mostrar uma boa variedade. NUNCA repita a lista identica.",
                "- NUNCA diga 'nao temos mais' / 'nao ha outras opcoes' se stock.facts AINDA tem veiculos que batem com o que o lead pediu — a loja tem DEZENAS de carros, quase sempre HA mais pra mostrar. So diga que esgotou se stock.facts REALMENTE nao tiver mais nenhum do tipo/criterio. Dizer 'nao temos mais' tendo carro no estoque e ERRO GRAVE que perde a venda.",
                "- TIPO DE VEICULO (use seu conhecimento de carros): se o lead pede um TIPO (SUV, sedan, hatch, picape), apresente SO veiculos desse tipo — voce SABE quais sao (ex.: Compass, Renegade, Creta, Tracker, Peugeot 2008, Kicks, Nivus, Pulse, ASX, Pajero TR4 = SUV; Onix, Peugeot 208, Polo, Mini Cooper = hatch; Virtus, Cronos, Versa = sedan). NUNCA trate um SUV como se nao fosse SUV, e nao misture tipos que ele nao pediu.",
                "- NUNCA cole URL de imagem nem use markdown/links ('[texto](url)' ou '![..](..)') — o WhatsApp NAO renderiza e a URL crua aparece feia pro cliente. Para mostrar o carro, OFERECA enviar as fotos (a ferramenta de fotos manda a midia de verdade).",
                "- Se o plano atual for 'photo_request', a tool de fotos ja selecionou e enviara as imagens. Escreva apenas um fechamento humano amigavel, sem prometer novas fotos.",
                "- Nunca invente veiculos ou dados (ano, preco, km) que nao estejam descritos em stock.facts.",
                "- PROIBIDO afirmar que um veiculo NAO existe ('nao temos', 'infelizmente nao temos', 'nao trabalhamos com') quando stock.facts NAO foi preenchido por uma busca (vazio/ausente). Sem ter CONSULTADO o estoque voce NAO SABE se tem — entao NAO negue de cabeca. Conduza: confirme com o lead qual modelo exatamente ele quer (que sera buscado) ou ofereca verificar. So afirme indisponibilidade quando stock.facts FOI consultado e realmente nao tem o que ele pediu. Dizer 'nao temos' sem ter buscado e ERRO GRAVE que perde a venda.",
                "- Se o lead trocou de veiculo ou mudou de assunto, responda sobre o novo assunto. A mensagem atual sempre vence a memoria antiga.",
                hasPresented
                  ? `- SAUDACAO/APRESENTACAO (status: JA APRESENTADO — REGRA FORTE): voce JA cumprimentou e se apresentou nesta conversa. E PROIBIDO recomecar com saudacao de horario ('Bom dia'/'Boa tarde'/'Boa noite'/'Ola') E PROIBIDO repetir a apresentacao ('Sou o ${agentName}, consultor aqui da ${input.agent?.company_name || "Icom Motors"}'). Va DIRETO ao ponto da resposta. Reapresentar/recumprimentar irrita o cliente.`
                  : `- SAUDACAO/APRESENTACAO (primeira mensagem): cumprimente e apresente-se UMA unica vez como ${agentName}, consultor da ${input.agent?.company_name || "Icom Motors"}.`,
                "- NOME DO LEAD (REGRA FORTE): use o primeiro nome do lead com MUITA moderacao — raramente, e quase nunca no inicio da frase. NAO comece mensagens com o nome ('Otima escolha, Douglas!' / 'Entendi, Douglas!' / 'Sem problemas, Douglas!'). NUNCA use o nome em mensagens seguidas. Repetir o nome a cada resposta soa robotico e incomoda. NA DUVIDA, NAO use o nome — fale de forma natural sem ele. (Isso vale mesmo que o System Prompt do Portal mande tratar pelo nome: tratar pelo nome != repetir o nome toda hora.)",
                "- Nunca cite termos tecnicos, JSON, ferramentas, tools, banco de dados ou processos internos.",
                "- Retorne apenas JSON valido com as chaves 'text', 'source', 'presented_vehicle_indices', 'qualificacao_coletada', 'pronto_para_transferir' e 'transferir_silencioso'.",
                "- Na chave 'presented_vehicle_indices', retorne um array de inteiros contendo os indices (de 1 a N, conforme o campo 'index' dos fatos em stock.facts) dos veiculos que voce de fato apresentou/citou no texto da sua resposta. Se nao apresentou nenhum ou nao havia estoque, retorne um array vazio [].",
                "",
                "DIRETRIZES DE APOIO (use SOMENTE quando o seu System Prompt do Portal nao especificar o passo a passo — o Portal sempre prevalece; e SEMPRE respeitando a regra de CONCISAO: no maximo UM gancho curto por mensagem, nunca empilhado com outra pergunta):",
                "- O GANCHO VISUAL: Sempre que houver veículo no estoque (stock.facts), ofereça proativamente enviar FOTOS adicionais para atrair o interesse. (Você só envia FOTOS — NUNCA ofereça vídeo, a loja não envia vídeo por aqui.)",
                "- O GANCHO DA SOLUÇÃO ALTERNATIVA: Se o MODELO procurado não existir no estoque (nenhuma unidade), não encerre a conversa de mãos vazias. Ofereça opções semelhantes (mesma categoria, valor ou câmbio) e chame para fotos. (Se o modelo EXISTE com ano/cor diferentes, NÃO use este gancho — apresente a unidade real de forma positiva.)",
                "- O GANCHO DA QUALIFICAÇÃO: Conduza a conversa para as etapas seguintes de forma amigável: pergunte se tem carro na troca, ofereça simular financiamento perguntando sobre a entrada, ou convide para visitar a loja e fazer um test drive.",
                "- FINANCIAMENTO / SIMULAÇÃO (REGRA FORTE — você NÃO simula, você TRANSFERE): você é o SDR e NÃO calcula prestações, NÃO roda simulação e NÃO 'verifica opções de financiamento' — quem faz a simulação é o VENDEDOR/especialista. É TERMINANTEMENTE PROIBIDO prometer que vai 'verificar as opções e te retornar', 'simular e te aviso', 'já te retorno com as condições', 'estou verificando' ou QUALQUER coisa que deixe o lead esperando uma resposta sua que nunca vem — você NÃO tem como voltar depois, e isso queima o lead. Assim que o lead QUER simular/financiar de fato (ex.: 'podemos ver as prestações/parcelas?', 'quero financiar', 'como ficam as parcelas?', 'quero fechar', OU já informou um valor de entrada) E você tem no mínimo nome + interesse (veículo), TRANSFIRA IMEDIATAMENTE: defina 'pronto_para_transferir' = true e escreva UMA frase curta avisando que um especialista de financiamento vai cuidar da simulação e já entra em contato (ex.: 'já passei seu atendimento pro nosso especialista de financiamento, ele já vai te chamar com as melhores condições 😊'). NESSE CASO, NÃO fique perguntando troca, localização ou outras etapas do funil — o especialista coleta o resto e fecha; insistir no funil aqui é justamente o erro que queima o lead quente. (ÚNICA exceção: se o lead SÓ perguntou se a loja financia, sem querer simular agora, responda que sim e siga o funil normal — sem prometer 'verificar'.)",
                "",
                "QUALIFICAÇÃO OBRIGATÓRIA (siga o passo-a-passo do seu System Prompt do Portal):",
                "- Quando o lead demonstrar interesse de compra (ex: 'vou querer', 'quero comprar', 'gostei'), CONDUZA a qualificação obrigatória do seu prompt fazendo UMA pergunta por vez, na ordem, PULANDO o que já foi respondido (consulte memory_summary e o histórico recente). Tipicamente: nome, se tem carro na troca, se tem valor de entrada, e se conhece a loja.",
                "- UM 'NÃO' ISOLADO NÃO DESQUALIFICA: 'tem entrada?'→'não' ou 'conhece a loja?'→'não' apenas registra e segue para a próxima etapa com UMA pergunta. NÃO encerre por causa disso.",
                "- MAS LEIA O TOM (prioridade máxima): se a última mensagem tiver SINAL NEGATIVO — deboche/sarcasmo ('rsss','kkk','aff', ironia), desmerecer a oferta ('a minha vale mais','tá velho'), objeção forte ('tá caro','muito longe'), desconfiança ('é golpe','não confio'), ou evasão/silêncio ('vou pensar','depois', respostas de 1 palavra sem perguntar nada) — PARE de empurrar o funil. NUNCA ignore um sinal negativo para continuar perguntando avaliação/entrada/visita.",
                "- REGRA DE 1 RESGATE (nunca insista 2x): no PRIMEIRO sinal negativo, faça NO MÁXIMO uma tentativa curta e leve, sem pressão, adequada ao caso ('muito longe' → oferecer avaliação/proposta à distância; 'tá caro'/desmerece → 1 info de valor como garantia/condição). Se o lead mantiver o sinal, NÃO tente de novo.",
                "- 'É GOLPE'/desconfiança: responda no MÁXIMO UMA vez, curto, com credibilidade real (loja física, endereço em Taubaté, 'pode pesquisar no Google') — sem se defender demais nem listar provas. Se persistir, encerre. NUNCA siga empurrando avaliação/entrada/visita por cima de uma acusação de golpe.",
                "- AGENDAMENTO: se o lead quer agendar visita/test-drive, pergunte e confirme o dia/horário antes de encaminhar (vai no briefing).",
                "- TRANSFERIR (qualificado o suficiente): depois de conduzir as perguntas do funil (MESMO com respostas 'não') e tendo no mínimo nome + interesse, defina 'pronto_para_transferir' = true e escreva uma despedida curta avisando que um consultor de vendas vai ENTRAR EM CONTATO com o cliente. NUNCA diga que ele vai falar/dar continuidade 'por aqui', 'neste número' ou 'aqui mesmo' — o vendedor chama de OUTRO número (ex.: 'já passei seu atendimento para um consultor de vendas, ele já vai entrar em contato com você 😊'). NÃO exija respostas perfeitas — colete o que der e ENCAMINHE. Enquanto ainda houver etapa do funil a conduzir, 'pronto_para_transferir' = false e siga com UMA pergunta por vez.",
                "- TRANSFERIR SILENCIOSO (lead esfriou/recusou -> VAI PRO VENDEDOR, nao morre num tchau): defina 'transferir_silencioso' = true quando (a) o lead RECUSAR de forma clara ou ENCERRAR o interesse agora — ex.: 'não, obrigado', 'não quero', 'deixa pra lá', 'só estava olhando', recusou a oferta/o próximo passo e não quis seguir — JÁ NA PRIMEIRA VEZ, desde que você tenha no mínimo nome + interesse (o vendedor humano vai tentar recuperar; NÃO fique dando 'estou à disposição' sem encaminhar); OU (b) MANTIVER um sinal negativo recuperável ('muito longe','tá caro') APÓS a sua 1 tentativa de resgate; OU (c) acusar de golpe / for hostil; OU (d) se DESPEDIR / ENCERRAR a conversa de forma EDUCADA — 'obrigado' (de saida), 'valeu', 'tchau', 'vou indo', 'falamos depois'/'amanha falamos', 'por enquanto e so', 'vou pensar e te falo', 'depois eu vejo' — SEM fazer nenhuma outra pergunta ou pedido (e uma despedida, NAO uma duvida). Despedida do lead = FIM do atendimento: ele vai em SILENCIO pro vendedor e o follow-up NAO pode ficar perseguindo quem ja se despediu. Nesses casos faça uma DESPEDIDA GRACIOSA curta (agradeça + porta aberta, ex.: 'Tranquilo, [nome]! Não vou tomar seu tempo. Qualquer coisa é só me chamar. 👍') SEM pergunta de venda — o lead vai em SILÊNCIO para o vendedor. ATENÇÃO: um 'não' a uma PERGUNTA DO FUNIL ('tem entrada?'→'não', 'conhece a loja?'→'não') NÃO conta como recusa — isso só registra e segue; transferir_silencioso é pra desinteresse/recusa do ATENDIMENTO, não pra resposta negativa de uma etapa.",
                "- Em 'temperatura', classifique o lead AGORA: 'quente' (pediu preço/agenda, deu dados, quer avançar), 'morno' (interesse sem urgência), 'frio' (evasivo, 'muito longe'/'tá caro' educado, pouco engajado), 'desqualificado' (acusou golpe, hostil, deboche/desmerecimento persistente). Quando marcar transferir_silencioso, use 'frio' ou 'desqualificado'.",
                "- Em 'qualificacao_coletada', devolva um objeto com o que você JÁ apurou na conversa inteira (use null no que ainda não souber). ATENÇÃO: 'interesse' é o veículo que o lead QUER COMPRAR; 'carro_troca' é o carro que ele tem para dar de TROCA — NÃO confunda os dois. O 'cpf' só preencha se o lead INFORMAR o CPF dele (só dígitos); NUNCA invente nem peça CPF fora de hora. Formato: { \"nome\": string|null, \"interesse\": string|null, \"tem_troca\": true|false|null, \"carro_troca\": string|null, \"valor_entrada\": string|null, \"forma_pagamento\": \"financiamento\"|\"a_vista\"|null, \"sabe_localizacao\": true|false|null, \"dia_agendamento\": string|null, \"cpf\": string|null, \"cidade\": string|null }.",
              ].join("\n"),
          },
          {
            role: "system",
            content: JSON.stringify({
              current_time_sao_paulo: currentTime,
              lead_first_name: leadFirstName(input.memory),
              plan: input.plan,
              vehicle_resolution: input.vehicle_resolution,
              veiculo_em_foco: focusVehicle,
              veiculos_ja_apresentados: presentedVehicles,
              ad_context: input.ad_context || null,
              media_context: input.media_context || null,
              recent_history: input.recent_history || input.memory?.recent_turns || [],
              memory_summary: {
                lead: input.memory?.lead || {},
                interesse: input.memory?.interesse || {},
                negociacao: input.memory?.negociacao || {},
                referencia: input.memory?.referencia || {},
                atendimento: input.memory?.atendimento || {},
              },
              stock: {
                success: Boolean(input.stock_result?.success),
                total: input.stock_result?.total || 0,
                facts_scope: adVehicleConsultation ? "ad_vehicle_only" : "normal_search",
                facts,
                error: input.stock_result?.error || null,
                is_generic_query: Boolean(input.stock_result?.is_generic_query),
                response_guidance: input.stock_result?.response_guidance || null,
                ad_model_in_stock: adVehicleConsultation ? _adModelInStock : null,
                ad_year_from_ad: adVehicleConsultation ? _adYear : null,
                ad_year_matched: adVehicleConsultation ? _adYearMatched : null,
                ad_year_is_approximate: adVehicleConsultation ? true : null,
              },
              tool_result: input.tool_result || null,
              ad_vehicle_consultation: adVehicleConsultation,
              hard_rules: [
                "Siga a sua personalidade principal do System Prompt do Portal.",
                "ÁUDIO NÃO ENTENDIDO: se media_context.kind for 'audio' e media_context.audio_transcribed for false (ou o texto da vez for só '[áudio recebido]'), você NÃO conseguiu ouvir o áudio. NUNCA prometa 'vou escutar o áudio e já respondo' nem finja ter ouvido — você não tem como voltar depois. Peça com gentileza pro cliente mandar por TEXTO (ou um áudio curtinho de novo) o que ele precisa.",
                "VÍDEO: você só envia FOTOS, não vídeos. Se o cliente pedir vídeo, NÃO mande fotos fingindo que é vídeo: diga que por aqui você consegue mandar FOTOS na hora e que vídeo você pede pro consultor — e ofereça as fotos.",
                "SPEC TÉCNICA: NÃO invente números exatos que NÃO estejam em stock.facts — litros do porta-malas, consumo (km/l), potência (cv), nº de lugares, tamanho do tanque, etc. Se não tiver o dado certo, NÃO chute: diga que confirma certinho com o time e já retorna, OU responda de forma geral sem cravar número. Errar uma ficha técnica destrói a confiança do cliente.",
                "Se houver estoque (stock.facts), cite os dados reais dele. Não invente carros ou especificações.",
                "Se o cliente mudou o carro de interesse, priorize o modelo atual em relação à memória.",
                "VEICULO EM FOCO: perguntas de ATRIBUTO (preço, km, cor, ano, câmbio, versão, combustível) e referências ('dele', 'desse', 'esse carro') são SEMPRE sobre o 'veiculo_em_foco' (ou stock.facts) — NUNCA sobre o carro de TROCA do cliente. Se 'veiculo_em_foco' tiver o dado, responda direto com ele; NUNCA diga que não tem a informação de um carro que está em 'veiculo_em_foco'.",
                "Se 'memory_summary.interesse.modelo_desejado' divergir de 'veiculo_em_foco', o 'veiculo_em_foco' PREVALECE (o campo interesse pode estar desatualizado ou conter o carro de troca por engano).",
                "Se a tool de fotos foi ativada (tool_result.type === 'vehicle_photos'), confirme o envio das fotos sem prometer novos envios.",
                "Retorne no JSON a chave 'presented_vehicle_indices' listando os indices (1-baseados, campo 'index') dos veiculos citados no texto.",
                "CONSULTA DE ANUNCIO (quando ad_vehicle_consultation=true): o ANO do anuncio (stock.ad_year_from_ad) e APROXIMADO e pode estar errado (vem da arte/metadado do Facebook). NUNCA abra com 'nao temos'. Se stock.ad_model_in_stock=true, ABRA POSITIVAMENTE confirmando que TEM ('Temos um <modelo> aqui sim!') e apresente o carro de stock.facts com o ano/cor/preco REAIS do estoque, com naturalidade, SEM destacar que o ano do anuncio era outro (so mencione/corrija se o lead perguntar). So diga honestamente que NAO tem quando stock.ad_model_in_stock=false — ai ofereca um parecido, sem inventar specs.",
                "DISPONIBILIDADE POR MODELO (NUNCA minta 'nao temos'): se o lead pede uma ESPECIFICACAO (combustivel/cambio/cor/versao/ano) que o estoque nao tem MAS o MODELO existe em stock.facts com outra spec, NUNCA diga 'nao temos o <modelo> <spec>'. Apresente POSITIVAMENTE o que TEM informando a spec REAL (ex.: lead quer 'Toro flex' e o estoque tem Toro diesel -> 'A Toro que tenho aqui e a diesel, nao a flex — quer ver?'). So diga que NAO tem quando o MODELO inteiro nao existir no estoque.",
                "PRECO A CONFIRMAR: se um item de stock.facts tiver preco_a_confirmar=true, o carro EXISTE e voce DEVE apresenta-lo pelo modelo/ano/km/cor REAIS — NUNCA diga R$0, NUNCA mostre preco zerado, NUNCA negue esse carro. Em vez do valor, diga com naturalidade que vai CONFIRMAR o preco com o time e ja retorna (ex.: 'Esse eu preciso confirmar o valor certinho pra voce, ja te falo'). So omita o preco DESSE item; os demais itens com preco seguem normais.",
                "NUNCA afirme 'nao temos' um carro SEM que o estoque tenha sido consultado neste fluxo: se stock.success for false ou stock.facts vier vazio por falta de busca (e nao porque o modelo realmente nao existe), NAO negue — confirme/pergunte qual modelo ou diga que vai verificar. So negue disponibilidade com base em stock.facts real.",
                "VEICULOS JA APRESENTADOS (veiculos_ja_apresentados): sao os carros que voce JA mostrou neste atendimento e voce TEM as fotos de TODOS eles (tem_fotos=true). Quando o lead disser 'os outros', 'e os outros', 'mais', 'tem mais', 'o segundo'/'o terceiro', 'o de 2022', 'o branco', 'o mais barato/caro' etc., ele se refere a ESTA lista. NUNCA diga que 'so tem as fotos de um', que 'nao tem os outros' ou que 'nao tenho mais fotos': se ha mais de um item em veiculos_ja_apresentados, voce TEM os outros e as fotos deles. Essa lista e VERDADE mesmo com stock.facts vazio (turno sem busca).",
                "PEDIU UM TIPO/CATEGORIA (suv, sedan, hatch, picape...) E HA VARIOS em stock.facts: APRESENTE as opcoes (liste 3-5, uma por LINHA, modelo/ano/cor/km/preco) e pergunte qual interessa / se quer ver fotos. NUNCA lidere com UM unico veiculo (nem o do anuncio) ignorando os demais quando o lead pediu uma CATEGORIA — ele quer ver as opcoes do tipo, nao so um carro. Se veiculo_em_foco vier null, e exatamente esse caso: foque na LISTA.",
                "QUAL DELES (extrair o que o lead quer, NAO despejar): se o lead pede 'os outros'/'mais' e ha VARIOS em veiculos_ja_apresentados, NAO prometa 'vou te enviar as fotos de X e Y' (varios de uma vez) — apresente os OUTROS de forma curta (modelo/ano/cor/preco, um por LINHA) e PERGUNTE de QUAL deles ele quer ver as fotos. Idem se ele so disse 'sim/quero' a uma oferta de fotos sem dizer qual: pergunte qual antes de mandar. So mande/prometa as fotos de UM veiculo quando ele deixar claro QUAL (pelo modelo, ano, cor ou ordinal).",
                "TRANSFERENCIA — COMO FALAR DO CONSULTOR: ao avisar que um consultor/vendedor vai assumir, diga SEMPRE que ele 'vai entrar em contato' com o cliente. NUNCA prometa que o consultor vai 'falar por aqui', 'dar continuidade por aqui', 'responder neste numero' ou 'aqui mesmo' — o vendedor humano atende de OUTRO numero de WhatsApp, entao prometer 'por aqui' e MENTIRA e frustra o cliente. Ex. certo: 'Seu atendimento ja esta com um dos nossos consultores de vendas, ele ja vai entrar em contato com voce. 😊'."
              ],
            }),
          },
          ...chatHistory,
          {
            role: "user",
            content: input.message,
          },
    ];
    // FAILOVER do reply (Pilar E): tenta cada provedor da cadeia ate um responder ok; lembra o
    // provedor ATIVO (reusado na regeneracao do grounding). So cai no fallback deterministico se
    // TODOS falharem. recordProviderError em cada falha alimenta o monitor/alerta.
    let res: Response | null = null;
    let activeLlm: NonNullable<ReturnType<typeof buildReplyLlm>> | null = null;
    let activeModel = "";
    for (let _ci = 0; _ci < _replyChain.length; _ci++) {
      const llm = _replyChain[_ci];
      const model = (_ci === 0 && input.reply_model_override) ? input.reply_model_override : llm.model;
      try {
        const r = await callReply(llm, model, replyMessages);
        if (r.ok) { res = r; activeLlm = llm; activeModel = model; break; }
        console.warn(`[PedroV2] reply ${llm.provider} status ${r.status}; failover p/ proximo provedor`);
        await recordProviderError(input.ai_key_ctx, llm.provider, "reply", r);
      } catch (e) { console.warn(`[PedroV2] reply ${llm.provider} excecao; failover:`, e); }
    }
    if (!res || !activeLlm) return fallback;
    const data = await res.json();
    // SAIDA: OpenAI/DeepSeek -> choices[0].message.content ; Anthropic -> content[].text
    if (input.usage_sink) {
      input.usage_sink.tokens += activeLlm.isAnthropic
        ? Number(data?.usage?.input_tokens || 0) + Number(data?.usage?.output_tokens || 0)
        : sumOpenAiTokens(data);
    }
    // AUDITORIA: chamada do reply v2 (provedor REAL do failover: openai/deepseek/anthropic). logAiCall nunca lanca.
    if (input.audit?.client && input.audit?.userId) {
      const u = data?.usage || {};
      await logAiCall(input.audit.client, {
        userId: input.audit.userId,
        disparoTipo: "inbound_pedro",
        provedor: activeLlm.provider,
        modelo: activeModel,
        inputTokens: activeLlm.isAnthropic ? (Number(u.input_tokens) || 0) : (Number(u.prompt_tokens) || 0),
        outputTokens: activeLlm.isAnthropic ? (Number(u.output_tokens) || 0) : (Number(u.completion_tokens) || 0),
        nSubcalls: 1,
        agentId: input.audit.agentId ?? null,
        agentName: input.audit.agentName ?? null,
        meta: { kind: "pedro_v2_reply" },
      });
    }
    const content = activeLlm.isAnthropic
      ? String((Array.isArray(data?.content) ? data.content.filter((b: any) => b?.type === "text").map((b: any) => b?.text || "").join("") : "") || "{}")
      : String(data?.choices?.[0]?.message?.content || "{}");
    const parsed = JSON.parse(cleanJson(content));
    const rawText = String(parsed?.text || "").trim();
    let presented_vehicle_indices = Array.isArray(parsed?.presented_vehicle_indices)
      ? parsed.presented_vehicle_indices.map((idx: any) => Number(idx)).filter((n: number) => !isNaN(n))
      : [];
    const qualificacao_coletada = (parsed?.qualificacao_coletada && typeof parsed.qualificacao_coletada === "object")
      ? parsed.qualificacao_coletada
      : null;
    // Modo assistente: lead com vendedor dono NUNCA dispara transferencia (ja tem dono).
    const pronto_para_transferir = parsed?.pronto_para_transferir === true && !assignedSellerName;
    const transferir_silencioso = parsed?.transferir_silencioso === true && !assignedSellerName;
    const temperatura = ["quente", "morno", "frio", "desqualificado"].includes(String(parsed?.temperatura || "").toLowerCase())
      ? String(parsed.temperatura).toLowerCase()
      : null;

    let guardedRawText = adVehicleConsultation && rawText.includes("Encontrou o")
      ? buildAdVehicleConsultationFallback({
        memory: input.memory,
        facts,
        ad_context: input.ad_context,
        agent: input.agent,
        has_presented: hasPresented,
      })
      : rawText;

    if (adVehicleConsultation && rawText.includes("Encontrou o")) {
      presented_vehicle_indices = [1];
    }

    // Finaliza um texto BRUTO do LLM: guarda anti-promessa-de-foto -> formatacao de estoque ->
    // anti-nome-repetido -> anti-filler. Reusado na geracao normal E na regeneracao do grounding.
    const _firstName = leadFirstName(input.memory);
    const finalizeFrom = (g0: string): string => {
      let g = g0;
      if (input.tool_result?.type !== "vehicle_photos" && looksLikePhotoPromise(g)) {
        g = buildPhotoPromiseGuardReply({ memory: input.memory, vehicle_resolution: input.vehicle_resolution, ad_context: input.ad_context });
      }
      const t = ensureStockReplyFormatting({ text: g, facts, memory: input.memory, plan: input.plan, intent: input.intent, stock_result: input.stock_result, ad_vehicle_consultation: adVehicleConsultation });
      if (!t) return "";
      const nc = agentUsedNameRecently(input.recent_history, _firstName) ? stripLeadNameVocatives(t, _firstName) : t;
      return stripFillerClosers(nc || t) || nc || t;
    };

    let finalText = finalizeFrom(guardedRawText);
    if (!finalText) return fallback;

    // ── GROUNDING (Pilar A, anti-alucinacao): a resposta NAO pode contradizer o estoque real. ──
    // Valida (determinístico): se afirmou "nao temos X" havendo X nos fatos, ou inventou um modelo,
    // REGERA 1x com correcao; se ainda violar, cai num fallback DETERMINISTICO montado dos fatos.
    let grounding_corrected = false;
    if (Array.isArray(facts) && facts.length > 0) {
      const gv = validateGrounding(finalText, facts);
      if (!gv.ok) {
        grounding_corrected = true;
        console.warn("[PedroV2] grounding_violation", JSON.stringify({ violations: gv.violations }));
        let fixed = "";
        try {
          const res2 = await callReply(activeLlm, activeModel, [...replyMessages, { role: "system", content: buildGroundingCorrection(gv.violations, facts) }]);
          if (res2.ok) {
            const data2 = await res2.json();
            if (input.usage_sink) input.usage_sink.tokens += activeLlm.isAnthropic ? Number(data2?.usage?.input_tokens || 0) + Number(data2?.usage?.output_tokens || 0) : sumOpenAiTokens(data2);
            const content2 = activeLlm.isAnthropic
              ? String((Array.isArray(data2?.content) ? data2.content.filter((b: any) => b?.type === "text").map((b: any) => b?.text || "").join("") : "") || "{}")
              : String(data2?.choices?.[0]?.message?.content || "{}");
            fixed = finalizeFrom(String(JSON.parse(cleanJson(content2))?.text || "").trim());
          }
        } catch (e) { console.warn("[PedroV2] grounding regen failed:", e); }
        finalText = (fixed && validateGrounding(fixed, facts).ok) ? fixed : groundedFallback(facts);
      }
    }

    return {
      ok: true,
      text: finalText,
      source: adVehicleConsultation ? "brain_ad_vehicle_reply" : (facts.length > 0 ? "brain_stock_reply" : "brain_reply"),
      presented_vehicle_indices,
      qualificacao_coletada,
      pronto_para_transferir,
      transferir_silencioso,
      temperatura,
      grounding_corrected,
      _reply_model: activeModel,
      _reply_provider: activeLlm.provider,
      _reply_failover_from: activeLlm.provider !== _replyChain[0].provider ? _replyChain[0].provider : null,
    };
  } catch (error) {
    console.warn("[PedroV2] brain reply fallback:", error);
    return fallback;
  }
}
