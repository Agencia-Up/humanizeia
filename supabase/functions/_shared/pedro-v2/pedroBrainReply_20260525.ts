import { generatePedroSalesReply } from "./replyGenerator_20260525_photo_flow.ts";
import { PedroBrainPlan } from "./pedroBrainPlanner_20260525.ts";
import { PedroV2IntentResult, PedroV2LeadMemory } from "./types.ts";
import { PedroVehicleResolution } from "./vehicleResolver_20260525_brain.ts";
import { sumOpenAiTokens, UsageSink } from "./tokenMeter.ts";

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

function leadFirstName(memory?: PedroV2LeadMemory | null) {
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
  return String(input.plan?.reason || "").startsWith("enforced_ad_vehicle_consultation");
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

function buildDeterministicStockReply(input: {
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

  const intro = `Temos sim. Encontrei ${items.length} opcao${items.length === 1 ? "" : "es"} de ${requested} no estoque:`;
  const list = items.map((vehicle) => [
    `${vehicle.index}. *${vehicle.label}*`,
    vehicle.preco_formatado ? `Preco: ${vehicle.preco_formatado}` : null,
    vehicle.km_formatado ? `KM: ${vehicle.km_formatado}` : null,
    vehicle.cambio ? `Cambio: ${vehicle.cambio}` : null,
    vehicle.cor ? `Cor: ${vehicle.cor}` : null,
    vehicle.imagem ? `Foto: ${vehicle.imagem}` : null,
  ].filter(Boolean).join("\n")).join("\n\n");
  const more = Number(input.stock_result?.total || 0) > items.length
    ? `\n\nTenho mais opcoes parecidas aqui tambem.`
    : "";
  return `${intro}\n\n${list}${more}\n\nQual dessas faz mais sentido pra voce?`;
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

function ensureStockReplyFormatting(input: {
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
  return stripMarkdownForWhatsApp(input.text);
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
}) {
  const hasPresented = checkAgentHasPresented(input.recent_history, input.memory?.recent_turns);
  const agentName = sanitizeAgentName(input.agent?.name);
  // Vendedor dono do lead (modo assistente): quando presente, o agente vira ASSISTENTE
  // do vendedor — nao requalifica, nao manda foto, roteia tudo para ele.
  const assignedSellerName = (input.assigned_seller_name || "").trim() || null;
  const fallback = fallbackReply({ ...input, recent_history: input.recent_history });
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) return fallback;

  const allFacts = stockFacts(input.stock_result);
  const adVehicleConsultation = isCurrentTurnAdVehicleConsultation(input);
  // CONSULTA DE ANUNCIO = MODELO-first. O ANO do anuncio (metadado/arte do Facebook) e
  // IMPRECISO; antes o fato era escolhido pelo ANO ("Mini Cooper 2023") e, como o estoque
  // era 2019, _adMatchedFact ficava null -> o LLM dizia "nao temos o 2023". Agora casamos
  // pelo MODELO (o que o estoque TEM) e usamos o ano so como DESEMPATE, nunca eliminatorio.
  const _adQuery = String(input.ad_context?.vehicle_query || "");
  const _adYear = (_adQuery.match(/\b(?:19|20)\d{2}\b/) || [])[0] || null;
  const _adModelo = normalizeText(_adQuery.replace(/\b(?:19|20)\d{2}\b/g, ""));
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
  // VEICULO EM FOCO: o carro que o lead esta de fato discutindo (resolvido OU o
  // ultimo apresentado), com FATOS explicitos. Serve para o LLM responder
  // perguntas de atributo (preco/km/cor/ano) sobre ELE — e NUNCA sobre o carro
  // de TROCA do cliente (que pode ter contaminado memory.interesse.modelo_desejado).
  const focusVehicle = (() => {
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
  const currentTime = saoPauloNowInfo();
  const chatHistory = buildChatHistory(input.recent_history || input.memory?.recent_turns || [], input.message);
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: sanitizeModel(input.agent?.model),
        temperature: 0.35,
        response_format: { type: "json_object" },
        messages: [
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
                "- CONCISAO (REGRA FORTE, acima de tudo): responda em UMA mensagem CURTA. O cliente NAO quer ler muito texto. Va direto ao ponto.",
                "- NAO confirme nem repita de volta o que o cliente disse. NUNCA escreva coisas como 'Posso anotar que voce quer dar a S10 na troca', 'Entendi, vamos seguir com a simulacao', 'Otimo! Voce esta interessado em X'. Isso e texto inutil — apenas ENTENDA e responda/pergunte o essencial, sem narrar de volta o que ele falou.",
                "- NO MAXIMO UMA pergunta por mensagem, e SO se ela AVANCA a qualificacao. E PERMITIDO (as vezes melhor) terminar SEM nenhuma pergunta — ex.: ao so responder um atributo, ao mandar foto, ou ao se despedir. NUNCA force uma pergunta no fim. PROIBIDAS perguntas-isca genericas: 'Voce gostaria de saber mais sobre X?', 'Tem alguma duvida?', 'Posso ajudar com mais alguma coisa?', 'O que acha?', 'Ainda posso te ajudar?'.",
                "- PROIBIDO elogiar o cliente ou o carro ('que otimo!', 'excelente escolha!', 'e um carro confortavel', 'otima versao'). Sem floreio, sem 'que legal saber que...'. So o essencial.",
                "- PROIBIDO ABRIR a mensagem com interjeicao de entusiasmo/validacao: 'Otimo!', 'Perfeito!', 'Show!', 'Maravilha!', 'Que bom!', 'Legal!'. Comece DIRETO pelo conteudo (a confirmacao, o dado ou a pergunta). Ex.: em vez de 'Otimo! Podemos agendar...', escreva 'Consigo te receber sexta as 11h, fica bom?'. (Vale 'Otimo'/'Perfeito' no MEIO da frase como concordancia natural — o proibido e abrir com a interjeicao isolada.)",
                "- PROIBIDO encerrar com filler de cortesia vazio: 'qualquer duvida, estou a disposicao', 'estou aqui se precisar', 'fico a disposicao', 'estou a disposicao'. Termine no conteudo (ou na pergunta que avanca).",
                "- ESPELHE o tamanho do cliente: cliente curto/objetivo => voce curto. Sem floreios, sem frases de preenchimento, sem repetir o que ja foi dito. Uma ideia por mensagem.",
                "- Siga a sua personalidade principal do portal na escrita das mensagens.",
                "- Se houver veiculos em stock.facts, liste as opcoes de forma natural e amigavel conforme sua personalidade. Diga os dados principais (modelo, ano, preco, km) sem formatacao mecanica, apenas integre de forma conversacional.",
                "- NUNCA cole URL de imagem nem use markdown/links ('[texto](url)' ou '![..](..)') — o WhatsApp NAO renderiza e a URL crua aparece feia pro cliente. Para mostrar o carro, OFERECA enviar as fotos (a ferramenta de fotos manda a midia de verdade).",
                "- Se o plano atual for 'photo_request', a tool de fotos ja selecionou e enviara as imagens. Escreva apenas um fechamento humano amigavel, sem prometer novas fotos.",
                "- Nunca invente veiculos ou dados (ano, preco, km) que nao estejam descritos em stock.facts.",
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
                "- O GANCHO VISUAL: Sempre que houver veículo no estoque (stock.facts), ofereça proativamente enviar fotos ou vídeos adicionais para atrair o interesse.",
                "- O GANCHO DA SOLUÇÃO ALTERNATIVA: Se o MODELO procurado não existir no estoque (nenhuma unidade), não encerre a conversa de mãos vazias. Ofereça opções semelhantes (mesma categoria, valor ou câmbio) e chame para fotos. (Se o modelo EXISTE com ano/cor diferentes, NÃO use este gancho — apresente a unidade real de forma positiva.)",
                "- O GANCHO DA QUALIFICAÇÃO: Conduza a conversa para as etapas seguintes de forma amigável: pergunte se tem carro na troca, ofereça simular financiamento perguntando sobre a entrada, ou convide para visitar a loja e fazer um test drive.",
                "",
                "QUALIFICAÇÃO OBRIGATÓRIA (siga o passo-a-passo do seu System Prompt do Portal):",
                "- Quando o lead demonstrar interesse de compra (ex: 'vou querer', 'quero comprar', 'gostei'), CONDUZA a qualificação obrigatória do seu prompt fazendo UMA pergunta por vez, na ordem, PULANDO o que já foi respondido (consulte memory_summary e o histórico recente). Tipicamente: nome, se tem carro na troca, se tem valor de entrada, e se conhece a loja.",
                "- UM 'NÃO' ISOLADO NÃO DESQUALIFICA: 'tem entrada?'→'não' ou 'conhece a loja?'→'não' apenas registra e segue para a próxima etapa com UMA pergunta. NÃO encerre por causa disso.",
                "- MAS LEIA O TOM (prioridade máxima): se a última mensagem tiver SINAL NEGATIVO — deboche/sarcasmo ('rsss','kkk','aff', ironia), desmerecer a oferta ('a minha vale mais','tá velho'), objeção forte ('tá caro','muito longe'), desconfiança ('é golpe','não confio'), ou evasão/silêncio ('vou pensar','depois', respostas de 1 palavra sem perguntar nada) — PARE de empurrar o funil. NUNCA ignore um sinal negativo para continuar perguntando avaliação/entrada/visita.",
                "- REGRA DE 1 RESGATE (nunca insista 2x): no PRIMEIRO sinal negativo, faça NO MÁXIMO uma tentativa curta e leve, sem pressão, adequada ao caso ('muito longe' → oferecer avaliação/proposta à distância; 'tá caro'/desmerece → 1 info de valor como garantia/condição). Se o lead mantiver o sinal, NÃO tente de novo.",
                "- 'É GOLPE'/desconfiança: responda no MÁXIMO UMA vez, curto, com credibilidade real (loja física, endereço em Taubaté, 'pode pesquisar no Google') — sem se defender demais nem listar provas. Se persistir, encerre. NUNCA siga empurrando avaliação/entrada/visita por cima de uma acusação de golpe.",
                "- AGENDAMENTO: se o lead quer agendar visita/test-drive, pergunte e confirme o dia/horário antes de encaminhar (vai no briefing).",
                "- TRANSFERIR (qualificado o suficiente): depois de conduzir as perguntas do funil (MESMO com respostas 'não') e tendo no mínimo nome + interesse, defina 'pronto_para_transferir' = true e escreva uma despedida curta avisando que um consultor vai dar continuidade. NÃO exija respostas perfeitas — colete o que der e ENCAMINHE. Enquanto ainda houver etapa do funil a conduzir, 'pronto_para_transferir' = false e siga com UMA pergunta por vez.",
                "- TRANSFERIR SILENCIOSO (encerrar lead frio/desqualificado): defina 'transferir_silencioso' = true quando (a) o lead disser EXPLICITAMENTE que não quer / pede para parar; OU (b) MANTIVER sinal negativo (deboche, desmerecimento, 'muito longe', 'tá caro' hostil) APÓS a sua 1 tentativa de resgate; OU (c) acusar de golpe/for hostil. Nesses casos faça uma DESPEDIDA GRACIOSA curta (agradeça + reconheça sem rebater + porta aberta, ex.: 'Tranquilo, [nome]! Não vou tomar seu tempo. Se quiser ver outras opções é só me chamar. 👍') SEM nenhuma pergunta de venda — o lead vai em SILÊNCIO para o vendedor fazer follow-up futuro. NÃO marque por um 'não' isolado a uma pergunta do funil.",
                "- Em 'temperatura', classifique o lead AGORA: 'quente' (pediu preço/agenda, deu dados, quer avançar), 'morno' (interesse sem urgência), 'frio' (evasivo, 'muito longe'/'tá caro' educado, pouco engajado), 'desqualificado' (acusou golpe, hostil, deboche/desmerecimento persistente). Quando marcar transferir_silencioso, use 'frio' ou 'desqualificado'.",
                "- Em 'qualificacao_coletada', devolva um objeto com o que você JÁ apurou na conversa inteira (use null no que ainda não souber). ATENÇÃO: 'interesse' é o veículo que o lead QUER COMPRAR; 'carro_troca' é o carro que ele tem para dar de TROCA — NÃO confunda os dois. Formato: { \"nome\": string|null, \"interesse\": string|null, \"tem_troca\": true|false|null, \"carro_troca\": string|null, \"valor_entrada\": string|null, \"forma_pagamento\": \"financiamento\"|\"a_vista\"|null, \"sabe_localizacao\": true|false|null, \"dia_agendamento\": string|null }.",
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
                "Se houver estoque (stock.facts), cite os dados reais dele. Não invente carros ou especificações.",
                "Se o cliente mudou o carro de interesse, priorize o modelo atual em relação à memória.",
                "VEICULO EM FOCO: perguntas de ATRIBUTO (preço, km, cor, ano, câmbio, versão, combustível) e referências ('dele', 'desse', 'esse carro') são SEMPRE sobre o 'veiculo_em_foco' (ou stock.facts) — NUNCA sobre o carro de TROCA do cliente. Se 'veiculo_em_foco' tiver o dado, responda direto com ele; NUNCA diga que não tem a informação de um carro que está em 'veiculo_em_foco'.",
                "Se 'memory_summary.interesse.modelo_desejado' divergir de 'veiculo_em_foco', o 'veiculo_em_foco' PREVALECE (o campo interesse pode estar desatualizado ou conter o carro de troca por engano).",
                "Se a tool de fotos foi ativada (tool_result.type === 'vehicle_photos'), confirme o envio das fotos sem prometer novos envios.",
                "Retorne no JSON a chave 'presented_vehicle_indices' listando os indices (1-baseados, campo 'index') dos veiculos citados no texto.",
                "CONSULTA DE ANUNCIO (quando ad_vehicle_consultation=true): o ANO do anuncio (stock.ad_year_from_ad) e APROXIMADO e pode estar errado (vem da arte/metadado do Facebook). NUNCA abra com 'nao temos'. Se stock.ad_model_in_stock=true, ABRA POSITIVAMENTE confirmando que TEM ('Temos um <modelo> aqui sim!') e apresente o carro de stock.facts com o ano/cor/preco REAIS do estoque, com naturalidade, SEM destacar que o ano do anuncio era outro (so mencione/corrija se o lead perguntar). So diga honestamente que NAO tem quando stock.ad_model_in_stock=false — ai ofereca um parecido, sem inventar specs.",
                "DISPONIBILIDADE POR MODELO (NUNCA minta 'nao temos'): se o lead pede uma ESPECIFICACAO (combustivel/cambio/cor/versao/ano) que o estoque nao tem MAS o MODELO existe em stock.facts com outra spec, NUNCA diga 'nao temos o <modelo> <spec>'. Apresente POSITIVAMENTE o que TEM informando a spec REAL (ex.: lead quer 'Toro flex' e o estoque tem Toro diesel -> 'A Toro que tenho aqui e a diesel, nao a flex — quer ver?'). So diga que NAO tem quando o MODELO inteiro nao existir no estoque.",
                "PRECO A CONFIRMAR: se um item de stock.facts tiver preco_a_confirmar=true, o carro EXISTE e voce DEVE apresenta-lo pelo modelo/ano/km/cor REAIS — NUNCA diga R$0, NUNCA mostre preco zerado, NUNCA negue esse carro. Em vez do valor, diga com naturalidade que vai CONFIRMAR o preco com o time e ja retorna (ex.: 'Esse eu preciso confirmar o valor certinho pra voce, ja te falo'). So omita o preco DESSE item; os demais itens com preco seguem normais.",
                "NUNCA afirme 'nao temos' um carro SEM que o estoque tenha sido consultado neste fluxo: se stock.success for false ou stock.facts vier vazio por falta de busca (e nao porque o modelo realmente nao existe), NAO negue — confirme/pergunte qual modelo ou diga que vai verificar. So negue disponibilidade com base em stock.facts real."
              ],
            }),
          },
          ...chatHistory,
          {
            role: "user",
            content: input.message,
          },
        ],
      }),
    });

    if (!res.ok) return fallback;
    const data = await res.json();
    if (input.usage_sink) input.usage_sink.tokens += sumOpenAiTokens(data);
    const content = String(data?.choices?.[0]?.message?.content || "{}");
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

    if (input.tool_result?.type !== "vehicle_photos" && looksLikePhotoPromise(guardedRawText)) {
      guardedRawText = buildPhotoPromiseGuardReply({
        memory: input.memory,
        vehicle_resolution: input.vehicle_resolution,
        ad_context: input.ad_context,
      });
    }

    const text = ensureStockReplyFormatting({
      text: guardedRawText,
      facts,
      memory: input.memory,
      plan: input.plan,
      intent: input.intent,
      stock_result: input.stock_result,
      ad_vehicle_consultation: adVehicleConsultation,
    });
    if (!text) return fallback;
    // Anti-repeticao de nome: se o agente ja usou o primeiro nome do lead nas ultimas
    // mensagens, remove o vocativo desta resposta (o nome nao aparece em sequencia).
    const _firstName = leadFirstName(input.memory);
    const finalText = agentUsedNameRecently(input.recent_history, _firstName)
      ? stripLeadNameVocatives(text, _firstName)
      : text;
    return {
      ok: true,
      text: finalText || text,
      source: adVehicleConsultation ? "brain_ad_vehicle_reply" : (facts.length > 0 ? "brain_stock_reply" : "brain_reply"),
      presented_vehicle_indices,
      qualificacao_coletada,
      pronto_para_transferir,
      transferir_silencioso,
      temperatura,
    };
  } catch (error) {
    console.warn("[PedroV2] brain reply fallback:", error);
    return fallback;
  }
}
