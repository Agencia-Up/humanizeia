import { PedroV2IntentResult, PedroV2LeadMemory } from "./types.ts";

function money(value?: number | null) {
  if (!value || !Number.isFinite(Number(value))) return null;
  return Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function km(value?: number | null) {
  if (!value || !Number.isFinite(Number(value))) return null;
  return `${Number(value).toLocaleString("pt-BR")} km`;
}

function compactVehicleLabel(vehicle: any) {
  return [
    vehicle?.marca,
    vehicle?.modelo,
    vehicle?.versao,
    vehicle?.ano,
  ].filter(Boolean).join(" ");
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
  const name = leadName(input.memory);
  const items = input.stock_result.items.slice(0, 3);
  const exactish = items.some((item: any) => !item.relaxed_match && Number(item.match_score || 0) >= 6);
  const intro = exactish
    ? `${name ? `${name}, ` : ""}encontrei ${items.length === 1 ? "uma opcao" : "algumas opcoes"} no estoque que batem com o que voce pediu:`
    : `${name ? `${name}, ` : ""}nao quero te passar informacao errada: encontrei ${items.length === 1 ? "uma opcao proxima" : "opcoes proximas"} no estoque, mas preciso confirmar se atende exatamente ao que voce procura:`;

  const lines = items.map((vehicle: any, index: number) => {
    const details = [
      money(vehicle.preco),
      km(vehicle.km),
      vehicle.cambio,
      vehicle.combustivel,
      vehicle.cor,
    ].filter(Boolean).join(" | ");
    return `${index + 1}. ${compactVehicleLabel(vehicle)}${details ? ` - ${details}` : ""}`;
  });

  const ask = input.intent?.intent === "price_question"
    ? "Quer que eu te mande os detalhes da melhor opcao?"
    : "Qual dessas faz mais sentido pra voce?";

  return [intro, "", ...lines, "", ask].join("\n");
}

export function generatePedroSalesReply(input: {
  memory?: PedroV2LeadMemory | null;
  intent?: PedroV2IntentResult | null;
  stock_result?: any;
  message?: string;
}) {
  const intent = input.intent?.intent || "unknown";
  const name = leadName(input.memory);
  const greeting = saoPauloGreeting();
  const requested = input.memory?.interesse?.modelo_desejado || input.intent?.extracted?.interesse?.modelo_desejado;
  const currentTurnCameFromAd = Boolean(input.intent?.extracted?.referencia?.origem_anuncio);

  if (currentTurnCameFromAd && !requested && input.intent?.reason?.startsWith("ad_context_missing_vehicle")) {
    return {
      ok: true,
      text:
        `${greeting}! Sou o Carvalho, consultor aqui da Icom Motors.\n\nVi que voce veio por um anuncio nosso, mas o WhatsApp nao me trouxe com seguranca qual carro aparece nele. Voce consegue me confirmar o modelo ou me mandar um print do anuncio? Assim eu confiro no estoque certinho pra nao te passar informacao errada.`,
      source: "ad_context_needs_vehicle_confirmation",
    };
  }

  if (hasUsefulStock(input.stock_result)) {
    return {
      ok: true,
      text: buildStockReply({
        memory: input.memory,
        intent: input.intent,
        stock_result: input.stock_result,
      }),
      source: "stock_fact_reply",
    };
  }

  if (input.stock_result && !hasUsefulStock(input.stock_result)) {
    if (currentTurnCameFromAd && !requested) {
      return {
        ok: true,
        text:
          `${name ? `${name}, ` : `${greeting}! Sou o Carvalho, consultor aqui da Icom Motors. `}vi que voce veio por um anuncio da Icom. Pra eu conferir certinho no estoque, me diz qual modelo apareceu pra voce ou me manda um print do anuncio?`,
        source: "ad_context_needs_vehicle_confirmation",
      };
    }
    const base = requested
      ? `${name ? `${name}, ` : ""}verifiquei aqui e nao encontrei esse ${requested} disponivel no estoque agora.`
      : `${name ? `${name}, ` : ""}verifiquei aqui e nao encontrei uma opcao compativel no estoque agora.`;
    return {
      ok: true,
      text: `${base} Posso procurar por algo parecido pra voce, se me disser faixa de valor, cambio ou modelo proximo.`,
      source: "stock_empty_reply",
    };
  }

  if (intent === "small_talk" || isSimpleGreeting(input.message)) {
    return {
      ok: true,
      text: `${greeting}! Sou o Carvalho, consultor aqui da Icom Motors. Me conta qual modelo ou faixa de valor voce procura que eu confiro no estoque real pra voce.`,
      source: "greeting_reply",
    };
  }

  if (intent === "financing") {
    return {
      ok: true,
      text: `${name ? `${name}, ` : ""}consigo te ajudar com financiamento sim. Voce ja tem um valor de entrada em mente ou prefere simular com entrada menor?`,
      source: "financing_reply",
    };
  }

  if (intent === "trade_in") {
    return {
      ok: true,
      text: `${name ? `${name}, ` : ""}perfeito, avaliamos troca tambem. Qual e o modelo, ano e km do seu carro hoje?`,
      source: "trade_in_reply",
    };
  }

  if (intent === "human_request") {
    return {
      ok: true,
      text: "Perfeito, vou pedir para um consultor continuar com voce por aqui.",
      source: "handoff_reply",
    };
  }

  return {
    ok: true,
    text: `${name ? `${name}, ` : ""}me fala qual modelo ou faixa de valor voce esta procurando que eu confiro no estoque real pra voce.`,
    source: "fallback_clarifying_reply",
  };
}
