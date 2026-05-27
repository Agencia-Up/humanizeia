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
  const agentName = input.agent?.name || "Pedro";
  const companyName = input.agent?.company_name || "Icom Motors";
  const firstLine = `${greeting}${name ? `, ${name}` : ""}! Sou o ${agentName}, consultor aqui da ${companyName}.`;
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

function ensureStockReplyFormatting(input: {
  text: string;
  facts: any[];
  memory?: PedroV2LeadMemory | null;
  plan: PedroBrainPlan;
  intent?: PedroV2IntentResult | null;
  stock_result?: any;
  ad_vehicle_consultation?: boolean;
}) {
  // Retorna o texto original da LLM diretamente para não travar a personalidade e formatação humana natural.
  return input.text;
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
}) {
  const allFacts = stockFacts(input.stock_result);
  const adVehicleConsultation = isCurrentTurnAdVehicleConsultation({
    ad_context: input.ad_context,
    plan: input.plan,
    vehicle_resolution: input.vehicle_resolution || ({} as PedroVehicleResolution),
    message: input.message,
  });

  if (input.stock_result?.is_generic_query) {
    const greeting = saoPauloNowInfo().greeting;
    const name = leadFirstName(input.memory);
    return {
      ok: true,
      text: `${greeting}${name ? `, ${name}` : ""}! Vi que você tem interesse em um de nossos carros pelo anúncio, mas não consegui identificar o modelo certinho. Qual veículo você estava vendo ou tem interesse?`,
      source: "brain_generic_fallback",
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
    agent: input.agent,
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
                `Voce e o ${input.agent?.name || "Pedro"}, consultor humano da ${input.agent?.company_name || "Icom Motors"} no WhatsApp.`,
                "Voce NAO e um fluxo fixo de conversas. Responda de forma humana, amigavel, natural e vendedora.",
                "O prompt abaixo e a sua personalidade principal fornecida pelo portal. Adote esse estilo, tom e ritmo de conversacao integralmente.",
                "",
                "PERSONALIDADE / SYSTEM PROMPT DO PORTAL:",
                input.agent_system_prompt || `(Sem prompt de personalidade cadastrado - aja como ${input.agent?.name || "Pedro"} consultor comercial educado e focado em vendas)`,
                "",
                "REGRAS DE CONDUCAO E USO DE TOOLS:",
                "- Siga a sua personalidade principal do portal na escrita das mensagens.",
                "- Se houver veiculos em stock.facts, liste as opcoes de forma natural e amigavel conforme sua personalidade. Diga os dados principais (modelo, ano, preco, km) sem formatacao mecanica, apenas integre de forma conversacional.",
                "- Se stock.facts.imagem existir, forneca a URL da imagem de forma limpa na sua mensagem para o lead.",
                "- Se o plano atual for 'photo_request', a tool de fotos ja selecionou e enviara as imagens. Escreva apenas um fechamento humano amigavel, sem prometer novas fotos.",
                "- Nunca invente veiculos ou dados (ano, preco, km) que nao estejam descritos em stock.facts.",
                "- Se o lead trocou de veiculo ou mudou de assunto, responda sobre o novo assunto. A mensagem atual sempre vence a memoria antiga.",
                "- Se voce ja se apresentou no historico recente da conversa, nao repita a apresentacao.",
                "- Nunca cite termos tecnicos, JSON, ferramentas, tools, banco de dados ou processos internos.",
                "- Retorne apenas JSON valido com as chaves 'text' e 'source'.",
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
                is_generic_query: Boolean(input.stock_result?.is_generic_query),
                response_guidance: input.stock_result?.response_guidance || null,
              },
              tool_result: input.tool_result || null,
              ad_vehicle_consultation: adVehicleConsultation,
              hard_rules: [
                "Siga a sua personalidade principal do System Prompt do Portal.",
                "Se houver estoque (stock.facts), cite os dados reais dele. Não invente carros ou especificações.",
                "Se o cliente mudou o carro de interesse, priorize o modelo atual em relação à memória.",
                "Se a tool de fotos foi ativada (tool_result.type === 'vehicle_photos'), confirme o envio das fotos sem prometer novos envios."
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
    let guardedRawText = adVehicleConsultation && rawText.includes("Encontrou o")
      ? buildAdVehicleConsultationFallback({
        memory: input.memory,
        facts,
        ad_context: input.ad_context,
        agent: input.agent,
      })
      : rawText;

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
