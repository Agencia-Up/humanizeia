import { PedroV2IntentResult, PedroV2LeadMemory } from "./types.ts";

function normalizeHistoryRole(role: any): "lead" | "agent" | null {
  const value = String(role || "").toLowerCase();
  if (["lead", "user", "cliente", "incoming"].includes(value)) return "lead";
  if (["agent", "assistant", "consultor", "outgoing"].includes(value)) return "agent";
  return null;
}

function checkAgentHasPresented(recentHistory?: any[], recentTurns?: any[]) {
  const history = recentHistory || recentTurns || [];
  if (!Array.isArray(history)) return false;
  for (const turn of history) {
    const role = normalizeHistoryRole(turn?.role || turn?.direction);
    if (role === "agent") {
      const text = String(turn?.text || turn?.content || turn?.message || "").toLowerCase();
      if (/\b(sou o|sou a|meu nome|aqui da|aqui de|sou consultor|sou consultora)\b/i.test(text)) {
        return true;
      }
    }
  }
  return false;
}

function sanitizeAgentName(name?: string | null) {
  const clean = String(name || "").trim();
  if (!clean || /^(agente ia|agenteia|ia agente|robo|bot)$/i.test(clean)) {
    return "Carvalho";
  }
  return clean;
}

function money(value?: number | null) {
  if (!value || !Number.isFinite(Number(value))) return null;
  return Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function km(value?: number | null) {
  if (!value || !Number.isFinite(Number(value))) return null;
  return `${Number(value).toLocaleString("pt-BR")} km`;
}

function normalizeVehicleText(value?: string | null) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanVehiclePart(value?: string | number | null) {
  return String(value || "")
    .replace(/([A-Za-z])(\d)/g, "$1 $2")
    .replace(/(\d)([A-Za-z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
}

function removeDuplicatedModelFromVersion(model: string, version: string) {
  const normalizedModel = normalizeVehicleText(model);
  const normalizedVersion = normalizeVehicleText(version);
  if (!normalizedModel || !normalizedVersion.startsWith(normalizedModel)) return version;
  const modelWords = normalizedModel.split(/\s+/).filter(Boolean).length;
  const versionWords = version.split(/\s+/).filter(Boolean);
  return versionWords.slice(modelWords).join(" ").trim() || version;
}

function compactVehicleLabel(vehicle: any) {
  const marca = cleanVehiclePart(vehicle?.marca);
  const modelo = cleanVehiclePart(vehicle?.modelo);
  const versao = removeDuplicatedModelFromVersion(modelo, cleanVehiclePart(vehicle?.versao));
  return [marca, modelo, versao, vehicle?.ano].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

function requestedVehicleLabel(input: {
  memory?: PedroV2LeadMemory | null;
  intent?: PedroV2IntentResult | null;
}) {
  return (
    input.intent?.extracted?.interesse?.modelo_desejado ||
    input.memory?.interesse?.modelo_desejado ||
    input.intent?.extracted?.referencia?.veiculo_citado ||
    input.memory?.referencia?.veiculo_citado ||
    ""
  );
}

function leadName(memory?: PedroV2LeadMemory | null) {
  const name = memory?.lead?.nome?.trim();
  if (!name || /^lead$/i.test(name)) return null;
  return name.split(/\s+/)[0];
}

function hasUsefulStock(stockResult: any) {
  return stockResult?.success && Array.isArray(stockResult.items) && stockResult.items.length > 0;
}

function saoPauloGreeting(date = new Date()) {
  const hour = Number(new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    hour12: false,
  }).format(date));
  if (hour >= 5 && hour < 12) return "Bom dia";
  if (hour >= 12 && hour < 18) return "Boa tarde";
  return "Boa noite";
}

function isSimpleGreeting(message?: string | null) {
  const normalized = String(message || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return /^(oi|ola|bom dia|boa tarde|boa noite|e ai|opa|tudo bem|td bem|blz|beleza)$/.test(normalized);
}

function buildStockReply(input: {
  memory?: PedroV2LeadMemory | null;
  intent?: PedroV2IntentResult | null;
  stock_result: any;
}) {
  const items = input.stock_result.items.slice(0, 5);
  const requested = requestedVehicleLabel(input);
  const exactish = items.some((item: any) => !item.relaxed_match && Number(item.match_score || 0) >= 6);
  const intro = exactish
    ? `Temos sim! Vou te mostrar algumas opcoes de ${requested || "veiculos"} que temos no momento:`
    : `Olha so, encontrei ${items.length === 1 ? "uma opcao proxima" : "algumas opcoes proximas"} no estoque real:`;

  const lines = items.map((vehicle: any, index: number) => {
    const image = vehicle.principal_image || vehicle.fotos?.[0];
    return [
      `${index + 1}. *${compactVehicleLabel(vehicle)}*`,
      vehicle.cor ? `- Cor: ${vehicle.cor}` : null,
      km(vehicle.km) ? `- KM: ${km(vehicle.km)}` : null,
      vehicle.cambio ? `- Cambio: ${vehicle.cambio}` : null,
      money(vehicle.preco) ? `- Preco: ${money(vehicle.preco)}` : null,
      image ? `- ![Imagem](${image})` : null,
    ].filter(Boolean).join("\n");
  });

  const extraCount = Number(input.stock_result.total || 0) - items.length;
  const more = extraCount > 0
    ? `Tenho mais ${extraCount} ${extraCount === 1 ? "opcao parecida" : "opcoes parecidas"} aqui tambem.`
    : "";
  const ask = input.intent?.intent === "price_question"
    ? "Quer que eu te mande os detalhes da melhor opcao?"
    : "Qual desses voce quer ver melhor?";

  return [intro, "", ...lines, "", more, ask].filter(Boolean).join("\n\n");
}

export function generatePedroSalesReply(input: {
  memory?: PedroV2LeadMemory | null;
  intent?: PedroV2IntentResult | null;
  stock_result?: any;
  message?: string;
  agent?: any;
  recent_history?: any[];
}) {
  const intent = input.intent?.intent || "unknown";
  const name = leadName(input.memory);
  const greeting = saoPauloGreeting();
  const requested = input.memory?.interesse?.modelo_desejado || input.intent?.extracted?.interesse?.modelo_desejado;
  const currentTurnCameFromAd = Boolean(input.intent?.extracted?.referencia?.origem_anuncio);
  const agentName = sanitizeAgentName(input.agent?.name);
  const companyName = input.agent?.company_name || "Icom Motors";
  const hasPresented = checkAgentHasPresented(input.recent_history, input.memory?.recent_turns);

  if (currentTurnCameFromAd && !requested && input.intent?.reason?.startsWith("ad_context_missing_vehicle")) {
    const text = hasPresented
      ? `Vi que voce veio por um anuncio nosso, mas o WhatsApp nao me trouxe com seguranca qual carro aparece nele. Voce consegue me confirmar o modelo ou me mandar um print do anuncio? Assim eu confiro no estoque certinho pra nao te passar informacao errada.`
      : `${greeting}! Sou o ${agentName}, consultor aqui da ${companyName}.\n\nVi que voce veio por um anuncio nosso, mas o WhatsApp nao me trouxe com seguranca qual carro aparece nele. Voce consegue me confirmar o modelo ou me mandar um print do anuncio? Assim eu confiro no estoque certinho pra nao te passar informacao errada.`;
    return {
      ok: true,
      text,
      source: "ad_context_needs_vehicle_confirmation",
      presented_vehicle_indices: [],
    };
  }

  if (hasUsefulStock(input.stock_result)) {
    const items = input.stock_result.items.slice(0, 5);
    return {
      ok: true,
      text: buildStockReply({
        memory: input.memory,
        intent: input.intent,
        stock_result: input.stock_result,
      }),
      source: "stock_fact_reply",
      presented_vehicle_indices: Array.from({ length: items.length }, (_, i) => i + 1),
    };
  }

  if (input.stock_result && !hasUsefulStock(input.stock_result)) {
    if (currentTurnCameFromAd && !requested) {
      const text = hasPresented
        ? `Vi que voce veio por um anuncio da ${companyName}. Pra eu conferir certinho no estoque, me diz qual modelo apareceu pra voce ou me manda um print do anuncio?`
        : `${name ? `${name}, ` : `${greeting}! Sou o ${agentName}, consultor aqui da ${companyName}. `}vi que voce veio por um anuncio da ${companyName}. Pra eu conferir certinho no estoque, me diz qual modelo apareceu pra voce ou me manda um print do anuncio?`;
      return {
        ok: true,
        text,
        source: "ad_context_needs_vehicle_confirmation",
        presented_vehicle_indices: [],
      };
    }
    const base = requested
      ? `${name ? `${name}, ` : ""}verifiquei aqui e nao encontrei esse ${requested} disponivel no estoque agora.`
      : `${name ? `${name}, ` : ""}verifiquei aqui e nao encontrei uma opcao compativel no estoque agora.`;
    return {
      ok: true,
      text: `${base} Posso procurar por algo parecido pra voce, se me disser faixa de valor, cambio ou modelo proximo.`,
      source: "stock_empty_reply",
      presented_vehicle_indices: [],
    };
  }

  if (intent === "small_talk" || isSimpleGreeting(input.message)) {
    if (hasPresented) {
      return {
        ok: true,
        text: `${greeting}! Tudo bem? 😊\n\nComo posso te ajudar hoje?`,
        source: "greeting_reply",
        presented_vehicle_indices: [],
      };
    } else {
      const isIcom = /icom/i.test(companyName);
      const connectionQuestion = isIcom
        ? "Você é aqui de Taubaté mesmo ou já conhece a nossa loja?"
        : "Me conta - o que voce esta procurando hoje?";
      return {
        ok: true,
        text: `${greeting}! Tudo bem? 😊\n\nSou o ${agentName}, consultor aqui da ${companyName}.\n\n${connectionQuestion}`,
        source: "greeting_reply",
        presented_vehicle_indices: [],
      };
    }
  }

  if (intent === "financing") {
    return {
      ok: true,
      text: `${name ? `${name}, ` : ""}consigo te ajudar com financiamento sim. Voce ja tem um valor de entrada em mente ou prefere simular com entrada menor?`,
      source: "financing_reply",
      presented_vehicle_indices: [],
    };
  }

  if (intent === "trade_in") {
    return {
      ok: true,
      text: `${name ? `${name}, ` : ""}perfeito, avaliamos troca tambem. Qual e o modelo, ano e km do seu carro hoje?`,
      source: "trade_in_reply",
      presented_vehicle_indices: [],
    };
  }

  if (intent === "human_request") {
    return {
      ok: true,
      text: "Perfeito, vou pedir para um consultor continuar com voce por aqui.",
      source: "handoff_reply",
      presented_vehicle_indices: [],
    };
  }

  return {
    ok: true,
    text: `${name ? `${name}, ` : ""}me fala qual modelo ou faixa de valor voce esta procurando que eu confiro no estoque real pra voce.`,
    source: "fallback_clarifying_reply",
    presented_vehicle_indices: [],
  };
}
