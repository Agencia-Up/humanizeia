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

// FAIXA de preco com PISO e TETO ("de 60 a 80 mil", "entre 60 e 80 mil", "60mil a 80mil").
// Exige o marcador "mil" (ou r$) pra NAO confundir com faixa de ANO ("de 2019 a 2021").
// Sem isso o piso era ignorado e o agente mostrava carro ABAIXO do orcamento minimo (EST-1).
function extractPriceRange(text: string): { min: number; max: number } | null {
  const compact = text.replace(/\./g, "").replace(/,/g, ".");
  const m = compact.match(/(?:de\s+|entre\s+)?(?:r\$\s*)?(\d{2,4})\s*(?:mil)?\s*(?:a|ate|e|-)\s*(?:r\$\s*)?(\d{2,4})\s*mil/i)
    || compact.match(/(?:de\s+|entre\s+)?(?:r\$\s*)?(\d{2,4})\s*mil\s*(?:a|ate|e|-)\s*(?:r\$\s*)?(\d{2,4})\s*(?:mil)?/i);
  if (!m) return null;
  let a = Number(m[1]);
  let b = Number(m[2]);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  if (a < 1000) a *= 1000;
  if (b < 1000) b *= 1000;
  const min = Math.min(a, b);
  const max = Math.max(a, b);
  if (min < 1000 || max < 1000 || min === max) return null;
  return { min, max };
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

function isPhotoRequest(text: string): boolean {
  return /\b(foto|fotos|imagem|imagens|print|prints|ver por dentro|por dentro|interior|painel|porta malas|porta-malas|traseira|lateral|frente|video|vídeo)\b/.test(text);
}

function hasPresentedVehicles(memory?: PedroV2LeadMemory | null): boolean {
  return Array.isArray(memory?.veiculos_apresentados) && memory.veiculos_apresentados.length > 0;
}

export function routePedroIntent(input: {
  message: string;
  current_memory?: PedroV2LeadMemory | null;
}): PedroV2IntentResult {
  const text = normalizeText(input.message);
  const extracted: PedroV2LeadMemory = {};
  const priceRange = extractPriceRange(text);
  const priceCeiling = priceRange?.max ?? extractPriceCeiling(text);
  const priceFloor = priceRange?.min ?? null;
  const vehicleType = extractVehicleType(text);
  const model = extractLikelyModel(text);

  if (priceCeiling || priceFloor || vehicleType || model) {
    extracted.interesse = {
      preco_max: priceCeiling,
      preco_min: priceFloor,
      tipo_veiculo: vehicleType,
      modelo_desejado: model,
      cambio: /\b(automatico|aut\.?|automatica)\b/.test(text) ? "automatico" : /\b(manual|mecanico)\b/.test(text) ? "manual" : null,
      combustivel: /\b(flex|gasolina|diesel|alcool|etanol)\b/.test(text) ? text.match(/\b(flex|gasolina|diesel|alcool|etanol)\b/)?.[1] || null : null,
    };
  }

  // MEM-2: carro citado em contexto de TROCA NAO e interesse de COMPRA. "tenho uma Strada pra
  // dar na troca, queria um SUV" -> Strada e o usado do lead (carro_troca), nao o que ele quer
  // comprar. Sem isso o modelo da troca virava interesse.modelo_desejado e a busca ia atras do
  // carro errado. Desvia o modelo pra negociacao.carro_troca quando ele aparece JUNTO de termos
  // de troca E nao foi introduzido por "por/quero/queria" (= carro DESEJADO via troca).
  if (model && /\b(troca|trocar|na troca|de entrada|dar de entrada|usado na troca)\b/.test(text)) {
    const idx = text.indexOf(model);
    const before = text.slice(Math.max(0, idx - 14), idx);
    const desiredViaPor = /\b(por|pelo|pela|quero|queria|interesse|gostaria)\b[^.!?]{0,8}$/.test(before);
    const tradeNearModel = /\b(troca|tenho|meu|minha|dar|dou|de entrada|usado)\b/.test(text.slice(Math.max(0, idx - 30), idx + model.length + 12));
    if (!desiredViaPor && tradeNearModel) {
      extracted.negociacao = { ...(extracted.negociacao || {}), carro_troca: model, tem_troca: true };
      if (extracted.interesse) extracted.interesse.modelo_desejado = null;
    }
  }

  // MEM-5: captura HEURISTICA de forma de pagamento + ja-visitou (backup do gpt-4o, que as vezes
  // nao extrai). Sem isso o agente RE-PERGUNTA "a vista ou financiar?" que o lead ja respondeu.
  const _pay = /\b(a vista|avista|pago a vista|dinheiro|pix)\b/.test(text) ? "a_vista"
    : /\b(financ|financiar|financiado|financiamento|parcel|parcelado|a prazo|prestacao)\b/.test(text) ? "financiamento"
    : /\b(consorcio|consórcio)\b/.test(text) ? "consorcio" : null;
  if (_pay) extracted.negociacao = { ...(extracted.negociacao || {}), forma_pagamento: _pay };
  if (/\b(ja fui|ja estive|ja visitei|fui (a|na|ate a|ate na) loja|estive ai|conheco a loja|fui ai)\b/.test(text)) {
    extracted.atendimento = { ...(extracted.atendimento || {}), sabe_localizacao: true };
  }

  if (isPhotoRequest(text)) {
    return {
      intent: "photo_request",
      confidence: 0.9,
      needs_stock_search: !hasPresentedVehicles(input.current_memory) && !!(model || vehicleType),
      needs_handoff: false,
      extracted: {
        ...extracted,
        referencia: {
          texto_referencia: input.message,
          confidence: 0.9,
        },
      },
      reason: "lead_requested_vehicle_photos",
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

  // TRF-2: pedido EXPLICITO de humano (vendedor/consultor/atendente) => transfere. Mas pedido
  // de LIGACAO ("me liga", "pode me ligar?", "me chama") NAO transfere lead cru — vira callback:
  // o agente qualifica (pega nome + interesse) e avisa que um consultor liga. So cai aqui o
  // pedido explicito de pessoa, nao o de telefonema.
  if (/\b(vendedor|humano|consultor|atendente|quero falar com|falar com (uma pessoa|alguem|atendente|vendedor|consultor))\b/.test(text)) {
    return {
      intent: "human_request",
      confidence: 0.78,
      needs_stock_search: false,
      needs_handoff: true,
      extracted,
      reason: "lead_requested_human_contact",
    };
  }

  // Pedido de LIGACAO/callback: nao transfere; sinaliza pra qualificar + prometer o retorno.
  if (/\b(me liga|me ligar|pode (me )?ligar|liga pra mim|me chama|pode (me )?chamar|prefiro ligacao|por telefone|liga(r)? mais tarde)\b/.test(text)) {
    return {
      intent: "callback_request",
      confidence: 0.7,
      needs_stock_search: false,
      needs_handoff: false,
      extracted,
      reason: "lead_requested_callback",
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
