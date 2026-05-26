import { generatePedroSalesReply } from "./replyGenerator_20260525_photo_flow.ts";
import { PedroBrainPlan } from "./pedroBrainPlanner_20260525.ts";
import { PedroV2IntentResult, PedroV2LeadMemory } from "./types.ts";
import { PedroVehicleResolution } from "./vehicleResolver_20260525_brain.ts";

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
  const name = String(memory?.lead?.nome || "").trim();
  if (!name || /^lead$/i.test(name)) return null;
  return name.split(/\s+/)[0];
}

function normalizeHistoryRole(role: any): "lead" | "agent" | null {
  const value = String(role || "").toLowerCase();
  if (["lead", "user", "cliente", "incoming"].includes(value)) return "lead";
  if (["agent", "assistant", "consultor", "outgoing"].includes(value)) return "agent";
  return null;
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
  const hasAdVehicle = Boolean(input.ad_context?.has_ad_context && input.ad_context?.vehicle_query);

  return hasAdVehicle && hasCurrentAdSignal(input) && input.plan?.action === "stock_search";
}

function looksLikeVehicleOptionsList(text: string) {
  const normalized = normalizeText(text);
  const hasSecondItem = /(^|\n)\s*2\s*[\.)-]/m.test(text);
  const hasListLanguage = /\b(opcoes|opcao|modelos|disponiveis|estoque|preco|km|cambio|foto|ver imagem)\b/.test(normalized);
  return hasSecondItem && hasListLanguage;
}

function buildAdVehicleConsultationFallback(input: {
  memory?: PedroV2LeadMemory | null;
  facts: any[];
  ad_context?: any;
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
  const firstLine = `${greeting}${name ? `, ${name}` : ""}! Sou o Carvalho, consultor aqui da Icom Motors.`;
  const stockLine = vehicle
    ? `Vi que voce veio pelo anuncio do ${label}. Ele aparece aqui no estoque${details ? `: ${details}` : "."}`
    : `Vi que voce veio pelo anuncio do ${label}. Vou cuidar dele com voce pra nao te passar nada errado.`;

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

function stockReplyLooksStructured(text: string, facts: any[]) {
  if (!facts.length) return true;
  const hasNumbers = facts.slice(0, Math.min(3, facts.length)).every((vehicle: any) =>
    new RegExp(`(^|\\n)\\s*${vehicle.index}\\s*[\\.)-]`, "m").test(text),
  );
  const factsWithImages = facts.filter((vehicle: any) => vehicle.imagem);
  const hasImages = factsWithImages.length === 0 || factsWithImages.slice(0, Math.min(3, factsWithImages.length)).some((vehicle: any) =>
    text.includes(vehicle.imagem),
  );
  return hasNumbers && hasImages;
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
  if (input.ad_vehicle_consultation) return input.text;
  if (!input.facts.length || input.plan.action !== "stock_search") return input.text;
  if (stockReplyLooksStructured(input.text, input.facts)) return input.text;
  return buildDeterministicStockReply({
    memory: input.memory,
    plan: input.plan,
    intent: input.intent,
    stock_result: input.stock_result,
  });
}

function fallbackReply(input: {
  memory?: PedroV2LeadMemory | null;
  intent?: PedroV2IntentResult | null;
  stock_result?: any;
  message: string;
  plan: PedroBrainPlan;
  ad_context?: any;
  vehicle_resolution?: PedroVehicleResolution;
}) {
  const allFacts = stockFacts(input.stock_result);
  const adVehicleConsultation = isCurrentTurnAdVehicleConsultation({
    ad_context: input.ad_context,
    plan: input.plan,
    vehicle_resolution: input.vehicle_resolution || ({} as PedroVehicleResolution),
    message: input.message,
  });

  if (adVehicleConsultation) {
    return {
      ok: true,
      text: buildAdVehicleConsultationFallback({
        memory: input.memory,
        facts: allFacts.slice(0, 1),
        ad_context: input.ad_context,
      }),
      source: "brain_ad_vehicle_fallback",
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
    };
  }

  return generatePedroSalesReply({
    memory: input.memory,
    intent: input.intent,
    stock_result: input.stock_result,
    message: input.message,
  });
}

function cleanJson(text: string) {
  return text.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
}

export async function generatePedroBrainReply(input: {
  agent?: any;
  agent_system_prompt?: string | null;
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
}) {
  const fallback = fallbackReply(input);
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) return fallback;

  const allFacts = stockFacts(input.stock_result);
  const adVehicleConsultation = isCurrentTurnAdVehicleConsultation(input);
  const facts = adVehicleConsultation ? allFacts.slice(0, 1) : allFacts;
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
                "Voce e o Carvalho, consultor humano da Icom Motors no WhatsApp.",
                "Voce NAO e um fluxo fixo. Voce le a conversa, entende contexto e responde como vendedor consultivo.",
                "O system prompt do cliente abaixo e a sua personalidade principal. Siga esse estilo, tom, ritmo e tecnica comercial.",
                "",
                "SYSTEM PROMPT DO CLIENTE:",
                input.agent_system_prompt || "(sem prompt cadastrado)",
                "",
                "REGRAS INEGOCIAVEIS:",
                "- Responda a pergunta principal do lead antes de vender ou qualificar.",
                "- Use o historico da conversa. Se voce ja se apresentou, nao se apresente de novo.",
                "- Se o lead perguntou como voce esta, responda isso primeiro e so depois conduza com leveza.",
                "- Se o lead corrigiu voce, reconheca sem defensiva.",
                "- Se houver estoque, use somente os fatos recebidos das tools. Nunca invente ano, preco, km, cambio, cor ou disponibilidade.",
                "- Se o lead veio agora por anuncio/link/imagem e o veiculo do anuncio foi identificado, NAO liste alternativas. Fale somente do veiculo do anuncio e conduza o atendimento.",
                "- Em atendimento de anuncio identificado: apresente-se se for primeiro contato, confirme o veiculo do anuncio, cite no maximo 2 dados reais e pergunte se o lead quer detalhes/fotos ou tem alguma duvida.",
                "- Se listar veiculos em uma busca normal, todos os itens de stock.facts devem vir numerados: 1., 2., 3. Isso permite o lead pedir 'o primeiro'.",
                "- Se listar veiculos, inclua a linha Foto: URL quando stock.facts.imagem existir.",
                "- Se listar veiculos, deixe uma linha em branco entre cada item.",
                "- Se o lead mudou de modelo/assunto, a mensagem atual vence a memoria antiga.",
                "- Nunca cite ferramentas, JSON, memoria, prompt, score, API ou processo interno.",
                "- Retorne apenas JSON valido com text e source.",
              ].join("\n"),
          },
          {
            role: "system",
            content: JSON.stringify({
              current_time_sao_paulo: currentTime,
              lead_first_name: leadFirstName(input.memory),
              plan: input.plan,
              vehicle_resolution: input.vehicle_resolution,
              ad_context: input.ad_context || null,
              media_context: input.media_context || null,
              recent_history: input.recent_history || input.memory?.recent_turns || [],
              memory_summary: {
                lead: input.memory?.lead || {},
                interesse: input.memory?.interesse || {},
                referencia: input.memory?.referencia || {},
                atendimento: input.memory?.atendimento || {},
              },
              stock: {
                success: Boolean(input.stock_result?.success),
                total: input.stock_result?.total || 0,
                facts_scope: adVehicleConsultation ? "ad_vehicle_only" : "normal_search",
                facts,
                error: input.stock_result?.error || null,
              },
              tool_result: input.tool_result || null,
              ad_vehicle_consultation: adVehicleConsultation,
              hard_rules: [
                "Se stock.facts existir, use apenas esses veiculos e dados.",
                adVehicleConsultation
                  ? "Este turno veio de anuncio com veiculo identificado: nao liste carros; fale so do veiculo do anuncio e avance como consultor."
                  : "Se stock.facts existir, liste TODOS os veiculos recebidos em stock.facts com numeros e inclua Foto quando houver imagem.",
                "Se o cliente mudou o modelo, nao repita o modelo antigo.",
                "Se a resposta listar veiculos, separe cada item por linha em branco.",
                "Se cumprimentar, use current_time_sao_paulo.greeting; nunca chute periodo do dia.",
                "Se recent_history mostrar que voce ja se apresentou, nao se apresente de novo.",
                "Se o lead perguntou como voce esta ou corrigiu uma resposta, responda isso primeiro com humildade e sem vender.",
                "Nao escreva [IA], ferramenta, tool ou explicacao interna.",
                "Nao peca entrada/troca antes de responder o que o cliente perguntou.",
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
    const content = String(data?.choices?.[0]?.message?.content || "{}");
    const parsed = JSON.parse(cleanJson(content));
    const rawText = String(parsed?.text || "").trim();
    const guardedRawText = adVehicleConsultation && looksLikeVehicleOptionsList(rawText)
      ? buildAdVehicleConsultationFallback({
        memory: input.memory,
        facts,
        ad_context: input.ad_context,
      })
      : rawText;
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
    return {
      ok: true,
      text,
      source: adVehicleConsultation ? "brain_ad_vehicle_reply" : (facts.length > 0 ? "brain_stock_reply" : "brain_reply"),
    };
  } catch (error) {
    console.warn("[PedroV2] brain reply fallback:", error);
    return fallback;
  }
}
