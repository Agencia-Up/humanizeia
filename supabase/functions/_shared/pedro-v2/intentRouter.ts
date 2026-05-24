import { PedroV2IntentResult, PedroV2LeadMemory } from "./types.ts";

function normalizeText(value?: string | null): string {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s$.,-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractPriceCeiling(text: string): number | null {
  const compact = text.replace(/\./g, "").replace(/,/g, ".");
  const match = compact.match(/(?:ate|abaixo de|menos de|maximo|no maximo)\s*(?:r\$)?\s*(\d{2,6})(?:\s*mil)?/i);
  if (!match) return null;
  const raw = Number(match[1]);
  if (!Number.isFinite(raw)) return null;
  return raw < 1000 ? raw * 1000 : raw;
}

function extractVehicleType(text: string): string | null {
  if (/\b(moto|motos|motocicleta|scooter|biz|cg|fan|titan|bros|xre|pcx)\b/.test(text)) return "moto";
  if (/\b(picape|pickup|caminhonete|camionete|strada|toro|saveiro|montana|oroch|hilux|ranger|s10|amarok)\b/.test(text)) return "pickup";
  if (/\b(suv|renegade|compass|creta|kicks|hrv|tracker|duster|tcross|t cross)\b/.test(text)) return "suv";
  if (/\b(sedan|corolla|civic|cruze|virtus|versa|logan)\b/.test(text)) return "sedan";
  if (/\b(hatch|onix|hb20|argo|kwid|mobi|gol|fox|sandero)\b/.test(text)) return "hatch";
  if (/\b(carro|carros|veiculo|veiculos|auto|automovel)\b/.test(text)) return "carro";
  return null;
}

function extractLikelyModel(text: string): string | null {
  const knownModels = [
    "strada", "toro", "oroch", "saveiro", "montana", "hilux", "ranger", "s10",
    "onix", "hb20", "creta", "renegade", "compass", "duster", "tracker",
    "corolla", "civic", "cruze", "argo", "mobi", "kwid", "ecosport", "tcross",
    "t cross", "asx", "jeep", "fiat", "chevrolet", "hyundai", "renault",
  ];
  return knownModels.find((model) => text.includes(model)) || null;
}

export function routePedroIntent(input: {
  message: string;
  current_memory?: PedroV2LeadMemory | null;
}): PedroV2IntentResult {
  const text = normalizeText(input.message);
  const extracted: PedroV2LeadMemory = {};
  const priceCeiling = extractPriceCeiling(text);
  const vehicleType = extractVehicleType(text);
  const model = extractLikelyModel(text);

  if (priceCeiling || vehicleType || model) {
    extracted.interesse = {
      preco_max: priceCeiling,
      tipo_veiculo: vehicleType,
      modelo_desejado: model,
      cambio: /\b(automatico|aut\.?|automatica)\b/.test(text) ? "automatico" : /\b(manual|mecanico)\b/.test(text) ? "manual" : null,
      combustivel: /\b(flex|gasolina|diesel|alcool|etanol)\b/.test(text) ? text.match(/\b(flex|gasolina|diesel|alcool|etanol)\b/)?.[1] || null : null,
    };
  }

  if (/\b(esse|essa|este|esta|aquele|aquela|do anuncio|da propaganda|do instagram)\b/.test(text)) {
    return {
      intent: "vehicle_reference",
      confidence: 0.82,
      needs_stock_search: true,
      needs_handoff: false,
      extracted: {
        ...extracted,
        referencia: {
          texto_referencia: input.message,
          confidence: 0.82,
        },
      },
      reason: "message_references_previous_vehicle_or_ad",
    };
  }

  if (/\b(ok|okay|blz|beleza|assumo|vou atender|pode deixar)\b/.test(text)) {
    return {
      intent: "seller_ack",
      confidence: 0.75,
      needs_stock_search: false,
      needs_handoff: false,
      extracted,
      reason: "possible_seller_ack_token",
    };
  }

  if (/\b(vendedor|humano|consultor|atendente|liga|ligar|me chama)\b/.test(text)) {
    return {
      intent: "human_request",
      confidence: 0.78,
      needs_stock_search: false,
      needs_handoff: true,
      extracted,
      reason: "lead_requested_human_contact",
    };
  }

  if (model || vehicleType || priceCeiling || /\b(tem|voces tem|estoque|disponivel|opcoes|carro|veiculo)\b/.test(text)) {
    return {
      intent: "stock_lookup",
      confidence: model ? 0.9 : 0.72,
      needs_stock_search: true,
      needs_handoff: false,
      extracted,
      reason: "vehicle_or_stock_terms_detected",
    };
  }

  if (/\b(financia|financiamento|parcela|entrada|score)\b/.test(text)) {
    return {
      intent: "financing",
      confidence: 0.82,
      needs_stock_search: false,
      needs_handoff: false,
      extracted,
      reason: "financing_terms_detected",
    };
  }

  if (/\b(troca|trocar|meu carro|usado na troca)\b/.test(text)) {
    return {
      intent: "trade_in",
      confidence: 0.82,
      needs_stock_search: false,
      needs_handoff: false,
      extracted,
      reason: "trade_in_terms_detected",
    };
  }

  return {
    intent: text ? "unknown" : "small_talk",
    confidence: text ? 0.35 : 0.5,
    needs_stock_search: false,
    needs_handoff: false,
    extracted,
    reason: "no_high_confidence_intent",
  };
}

