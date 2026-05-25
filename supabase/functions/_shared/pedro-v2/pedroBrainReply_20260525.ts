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

function stockFacts(stockResult: any) {
  const items = Array.isArray(stockResult?.items) ? stockResult.items.slice(0, 6) : [];
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

function buildDeterministicStockReply(input: {
  memory?: PedroV2LeadMemory | null;
  plan: PedroBrainPlan;
  intent?: PedroV2IntentResult | null;
  stock_result: any;
}) {
  const items = stockFacts(input.stock_result).slice(0, 5);
  const requested = input.plan.search_query || input.intent?.extracted?.interesse?.modelo_desejado || input.memory?.interesse?.modelo_desejado || "o que voce pediu";
  if (items.length === 0) {
    return `Conferi no estoque real e nao achei ${requested} disponivel agora.\n\nSe fizer sentido, posso procurar algo parecido por faixa de valor ou cambio.`;
  }

  const intro = `Temos sim. Separei algumas opcoes de ${requested} no estoque:`;
  const list = items.map((vehicle) => [
    `${vehicle.index}. *${vehicle.label}*`,
    vehicle.preco_formatado ? `Preco: ${vehicle.preco_formatado}` : null,
    vehicle.km_formatado ? `KM: ${vehicle.km_formatado}` : null,
    vehicle.cambio ? `Cambio: ${vehicle.cambio}` : null,
    vehicle.cor ? `Cor: ${vehicle.cor}` : null,
  ].filter(Boolean).join("\n")).join("\n\n");
  const more = Number(input.stock_result?.total || 0) > items.length
    ? `\n\nTenho mais opcoes parecidas aqui tambem.`
    : "";
  return `${intro}\n\n${list}${more}\n\nQual dessas faz mais sentido pra voce?`;
}

function fallbackReply(input: {
  memory?: PedroV2LeadMemory | null;
  intent?: PedroV2IntentResult | null;
  stock_result?: any;
  message: string;
  plan: PedroBrainPlan;
}) {
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
}) {
  const fallback = fallbackReply(input);
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) return fallback;

  const facts = stockFacts(input.stock_result);
  const currentTime = saoPauloNowInfo();
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
              "Voce escreve a resposta final do consultor Carvalho para WhatsApp. Use o system prompt do cliente como personalidade, mas respeite estas regras acima de tudo: responda a pergunta principal primeiro; use current_time_sao_paulo para cumprimentar; nao invente dado; se houver estoque, use somente os fatos recebidos; uma ideia por bloco; texto claro; sem parecer robo; nao cite ferramentas, memoria, JSON ou score. Retorne JSON valido com text e source.",
          },
          {
            role: "user",
            content: JSON.stringify({
              client_system_prompt: input.agent_system_prompt || "",
              lead_message: input.message,
              current_time_sao_paulo: currentTime,
              lead_first_name: leadFirstName(input.memory),
              plan: input.plan,
              vehicle_resolution: input.vehicle_resolution,
              ad_context: input.ad_context || null,
              media_context: input.media_context || null,
              memory_summary: {
                lead: input.memory?.lead || {},
                interesse: input.memory?.interesse || {},
                referencia: input.memory?.referencia || {},
                atendimento: input.memory?.atendimento || {},
              },
              stock: {
                success: Boolean(input.stock_result?.success),
                total: input.stock_result?.total || 0,
                facts,
                error: input.stock_result?.error || null,
              },
              hard_rules: [
                "Se stock.facts existir, use apenas esses veiculos e dados.",
                "Se o cliente mudou o modelo, nao repita o modelo antigo.",
                "Se a resposta listar veiculos, separe cada item por linha em branco.",
                "Se cumprimentar, use current_time_sao_paulo.greeting; nunca chute periodo do dia.",
                "Nao escreva [IA], ferramenta, tool ou explicacao interna.",
                "Nao peca entrada/troca antes de responder o que o cliente perguntou.",
              ],
            }),
          },
        ],
      }),
    });

    if (!res.ok) return fallback;
    const data = await res.json();
    const content = String(data?.choices?.[0]?.message?.content || "{}");
    const parsed = JSON.parse(cleanJson(content));
    const text = String(parsed?.text || "").trim();
    if (!text) return fallback;
    return {
      ok: true,
      text,
      source: facts.length > 0 ? "brain_stock_reply" : "brain_reply",
    };
  } catch (error) {
    console.warn("[PedroV2] brain reply fallback:", error);
    return fallback;
  }
}
