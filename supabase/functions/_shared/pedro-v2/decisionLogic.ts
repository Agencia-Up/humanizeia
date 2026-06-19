// ============================================================================
// LÓGICA DE DECISÃO PURA do Pedro v2 — SEM I/O, SEM Deno, SEM npm: (importável no Node/tsx).
// ----------------------------------------------------------------------------
// Extraído do orchestrator pra ser TESTÁVEL OFFLINE ($0): o orchestrator tem deps Deno/npm:
// no topo que travam o import no tsx. Estas funções são determinísticas (texto -> decisão) e
// foram fonte de vários bugs (broad/ad_context, detecção de foto, teto de preço). Agora o
// orchestrator importa daqui e a suíte offline testa daqui. NÃO adicionar I/O neste arquivo.
// ============================================================================

export type PhotoTarget = "overview" | "front" | "side" | "rear" | "interior" | "dashboard" | "seats" | "trunk" | "wheel";

export function normalizePlannerText(value?: string | null) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function leadMessageHasExplicitPriceCeiling(message?: string | null) {
  const text = normalizePlannerText(message);
  if (!/\d/.test(text)) return false;
  return /\b(ate|maximo|maxima|no maximo|orcamento|budget|tenho|tenho ate|procuro ate|quero ate|faixa de|na faixa|valor maximo|limite)\b/.test(text);
}

export function leadMessageAsksBroadStock(message?: string | null) {
  const text = normalizePlannerText(message);
  if (!text) return false;
  return /\b(o que tiver|que tiver|qualquer um|qualquer carro|opcoes|opcao|outros modelos|qual outro|outro modelo|tem em estoque|tem ai|tem disponivel)\b/.test(text)
    || /\b(quero|procuro|busco|preciso|tem|temos|gostaria)\b.{0,30}\b(picape|pickup|caminhonete|camionete|suv|sedan|hatch)\b/.test(text);
}

// ── CASO #1: LEAD MUDOU DE DIREÇÃO (anúncio/interesse antigo -> outra coisa AGORA) ─────────────
// Invariante de venda: a mensagem ATUAL do lead manda; o veículo do anúncio/interesse é HISTÓRICO,
// nunca uma trava. Um bom vendedor RE-ENTENDE quando o cliente muda de ideia. Detecta quando o lead,
// agora, pede um TIPO genérico (suv/sedan/hatch/picape) e NÃO está falando do carro anterior — não
// nomeia o modelo dele nem usa demonstrativo/pergunta sobre ELE. NÃO dispara em "esse suv tem teto?"
// (é sobre o carro do anúncio) nem em "tem suv tipo o tracker?" (nomeou o anterior de propósito).
// Usado em 2 lugares: (1) sinal `lead_direction` no decision_context (o cérebro re-entende); (2) backstop
// determinístico no normalizePlan quando o LLM ainda devolve o modelo do anúncio. Puro -> testado offline.
const _DIRECTION_TYPES: Record<string, string> = {
  sedan: "sedan", seda: "sedan", hatch: "hatch", hatchback: "hatch", suv: "suv",
  crossover: "suv", utilitario: "suv", picape: "pickup", pickup: "pickup", caminhonete: "pickup", camionete: "pickup",
};

export function detectLeadDirectionChange(message?: string | null, priorOrAdVehicle?: string | null) {
  const m = normalizePlannerText(message);
  const prior = normalizePlannerText(priorOrAdVehicle);
  const typeWord = Object.keys(_DIRECTION_TYPES).find((t) => new RegExp(`\\b${t}\\b`).test(m)) || null;
  const current_type = typeWord ? _DIRECTION_TYPES[typeWord] : null;
  // tokens do MODELO anterior (anúncio/interesse): ignora ano e palavras de tipo.
  const priorTokens = prior.split(/\s+/).filter((t) => t.length >= 3 && !/^(?:19|20)\d{2}$/.test(t) && !_DIRECTION_TYPES[t]);
  const named_prior = priorTokens.length > 0 && priorTokens.some((t) => new RegExp(`\\b${t}\\b`).test(m));
  // demonstrativo OU pergunta de característica/preço SOBRE aquele carro -> NÃO é mudança de direção.
  const about_that_car = /\b(esse|este|essa|esta|nesse|neste|nessa|nesta|desse|deste|dessa|desta|dele|dela|o mesmo|esse ai|esse carro|este carro)\b/.test(m)
    || /\b(teto solar|teto|cor|cores|km|quilometr|motor|consumo|completo|cambio|porta malas|porta-malas|aceita troca|financi|parcel|entrada|de quanto|qual o valor|qual valor|quanto custa|quanto sai|quanto fica|quanto ta|quanto esta|interi|na cor)\b/.test(m);
  const changed_direction = Boolean(current_type && prior && !named_prior && !about_that_car);
  return {
    changed_direction,
    current_type,
    prior_vehicle: priorOrAdVehicle ? String(priorOrAdVehicle).trim() : null,
    named_prior,
    about_that_car,
  };
}

export function buildStockFilters(intent: any, memory: any, text: string, brainPlan?: any, vehicleResolution?: any, options?: any) {
  const currentVehicleQuery = brainPlan?.search_query || vehicleResolution?.query || null;
  const allowMemoryVehicle = !vehicleResolution?.has_current_vehicle_signal && brainPlan?.use_memory_vehicle !== false;
  // marca pedida EXPLICITAMENTE (marca_required, Pilar B) NAO e busca ampla — senao o broadStock
  // APAGA a marca abaixo e "so se for Honda" vira sedan generico de qualquer marca (lead 99627-7728).
  const _marcaRequired = Boolean(brainPlan?.search_filters?.marca_required);
  const broadStock = !_marcaRequired && Boolean(brainPlan?.search_filters?.stock_broad || leadMessageAsksBroadStock(options?.lead_message));
  // MEM-1: NAO herdar filtros VELHOS do interesse (preco/tipo/cambio/cor/modelo) quando o turno
  // ATUAL nomeia um MODELO novo. Sem isso, um interesse de uma busca ANTERIOR (ex.: suv ate 80k)
  // contaminava a busca nova (ex.: "tem hilux?" herdava preco_max:80000) e filtrava/zerava errado.
  const _currentHasNewModel = Boolean(brainPlan?.search_query || vehicleResolution?.query || intent?.extracted?.interesse?.modelo_desejado);
  const _staleInteresse: Record<string, any> = { ...(memory?.interesse || {}) };
  if (_currentHasNewModel) {
    for (const k of ["preco_max", "preco_min", "orcamento", "budget", "cambio", "cor", "tipo_veiculo", "modelo_desejado", "ano", "ano_min", "ano_max"]) {
      delete _staleInteresse[k];
    }
  }
  const filters: Record<string, any> = {
    ..._staleInteresse,
    ...(intent?.extracted?.interesse || {}),
    ...(brainPlan?.search_filters || {}),
    query:
      (broadStock ? "" : currentVehicleQuery) ||
      intent?.extracted?.interesse?.modelo_desejado ||
      (allowMemoryVehicle ? memory?.interesse?.modelo_desejado : null) ||
      (allowMemoryVehicle ? memory?.referencia?.veiculo_citado : null) ||
      text,
    ad_context:
      intent?.extracted?.referencia?.texto_referencia ||
      memory?.referencia?.texto_referencia ||
      "",
  };

  if (broadStock) {
    filters.stock_broad = true;
    filters.query = "";
    delete filters.modelo_desejado;
    delete filters.modelo;
    delete filters.marca;
    // RAIZ "busca ampla zera com estoque cheio" (lead 99716-4335: "Procuro suv 2020 pra frente" -> 0
    // mesmo havendo SUVs): a frase do lead sobra em ad_context (via referencia.texto_referencia).
    // Numa busca de CATEGORIA nao ha modelo/referencia a casar; mas buildScoringText cai no fallback
    // p/ buildSearchText (que inclui ad_context) -> hasSearch=true -> os tokens da frase ("procuro",
    // "pra", "frente") viram requisito de match e o limiar (matchedTokens<2 -> score=0) ZERA todo o
    // pool. ad_context e DICA de ranking, nunca filtro DURO numa busca ampla -> limpa junto da query.
    filters.ad_context = "";
    filters.contexto_anuncio = "";
  }

  const adHasVehicle = Boolean(options?.ad_context?.has_ad_context && options?.ad_context?.vehicle_query);
  const explicitBudget = leadMessageHasExplicitPriceCeiling(options?.lead_message);
  if (adHasVehicle && filters.preco_max && !explicitBudget) {
    filters.ad_price = filters.preco_max;
    delete filters.preco_max;
  }

  // MEM-1 (reforco): turno nomeia um MODELO novo SEM o lead dizer preco agora -> remove QUALQUER
  // teto/piso herdado (de memoria OU eco do planner). Sem isso o orcamento de uma busca anterior
  // (ex.: 80k de "suv ate 80k") filtrava "tem hilux?" e podia esconder a unidade real.
  if (_currentHasNewModel && !explicitBudget) {
    for (const k of ["preco_max", "preco_min", "orcamento", "budget", "preco"]) delete filters[k];
  }

  // Teto EXPLICITO do lead ("ate 30 mil") e HARD: mesmo p/ modelo nomeado, NAO mostra unidade
  // acima do orcamento (antes "onix ate 30 mil" relaxava e mostrava Onix de R$64-76k). O
  // stockSearch usa esse flag p/ aplicar o teto ate no modo relaxed.
  if (explicitBudget && Number(filters.preco_max) > 0) {
    filters.hard_price_ceiling = true;
  }

  return filters;
}

export function normalizePhotoText(value: string) {
  return String(value || "")
    // Remove placeholders do SISTEMA ("[imagem recebida]", "[audio recebido]", "[midia recebida]"...).
    // Eles NAO sao fala do lead: a palavra "imagem" dentro deles fazia messageAsksForPhotos achar
    // que o lead "pediu fotos" sempre que mandava uma imagem (clique de anuncio quase sempre traz
    // imagem) -> o agente disparava album do nada. Tira o colchete inteiro ANTES de casar palavras.
    .replace(/\[[^\]]*\]/g, " ")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\w\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function detectPhotoTarget(message: string): PhotoTarget {
  const normalized = normalizePhotoText(message);
  if (/\b(roda|rodas|pneu|pneus|aro|calota)\b/.test(normalized)) return "wheel";
  if (/\b(painel|volante|multimidia|midia|cambio|console)\b/.test(normalized)) return "dashboard";
  if (/\b(banco|bancos|estofado|assento|assentos)\b/.test(normalized)) return "seats";
  if (/\b(interior|interno|interna|dentro|por dentro)\b/.test(normalized)) return "interior";
  if (/\b(porta malas|porta-malas|bagageiro|mala)\b/.test(normalized)) return "trunk";
  if (/\b(traseira|traseiro|atras|fundo)\b/.test(normalized)) return "rear";
  if (/\b(lado|lateral|laterais)\b/.test(normalized)) return "side";
  if (/\b(frente|dianteira|dianteiro)\b/.test(normalized)) return "front";
  return "overview";
}

// Detecta pedido EXPLICITO de fotos/imagens (mesma regra do planner.isPhotoText).
// Rede de seguranca do envio de fotos: se o lead pediu fotos e ha veiculos para
// mostrar, enviamos as imagens de verdade mesmo que o planner tenha roteado para
// stock_search (evita o agente PROMETER fotos e mandar so texto).
export function messageAsksForPhotos(message: string): boolean {
  const normalized = normalizePhotoText(message)
    // "X pra frente" / "em diante" = ANO em diante, NAO pedido de foto da "frente". Remove o idioma
    // antes de casar: senao "2020 pra frente" casava a palavra-alvo "frente" e disparava o fluxo de
    // foto do nada (RAIZ do falso-positivo leadAskedPhotosExplicitly, lead 99716-4335 / v134).
    .replace(/\b(pra|para|p ra)\s+(frente|cima)\b/g, " ")
    .replace(/\bem\s+diante\b/g, " ")
    .replace(/\s+/g, " ").trim();
  // 1) termos visuais diretos (foto/imagem/detalhes do carro) + sinonimos de
  //    "catalogo"/"album" que o lead usa para pedir as imagens.
  if (/\b(foto|fotos|fotinha|fotinhas|imagem|imagens|painel|interior|banco|bancos|roda|rodas|porta malas|porta-malas|traseira|frente|lateral|catalog|catalogo|catalogos|album|albuns|albun)\b/.test(normalized)) return true;
  // 2) pedidos por sinonimo: "me mostra", "mostra ele", "mostrar"
  if (/\b(me mostra|me mostre|mostra (a|o|ele|ela|esse|essa|mais|umas|uma|foto|as))\b/.test(normalized) || /\bmostrar\b/.test(normalized)) return true;
  // 3) "quero/queria/gostaria/posso ver" + "ver o carro / ver ele / ver esse"
  if (/\b(quero ver|queria ver|gostaria de ver|posso ver|da pra ver|deixa eu ver|consigo ver|tem como ver)\b/.test(normalized)) return true;
  if (/\bver (o carro|ele|ela|esse|essa|esse carro|essa|mais|as foto|as fotos|as imagens|melhor)\b/.test(normalized)) return true;
  return false;
}

export function requestedVehicleQueryForMediaGuard(plan: any, vehicleResolution: any, stockFilters: any) {
  const query = String(
    plan?.search_query ||
    plan?.search_filters?.modelo_desejado ||
    stockFilters?.modelo_desejado ||
    vehicleResolution?.query ||
    ""
  ).trim();
  return query || null;
}

// Nome VÁLIDO do lead? (usado pelo follow-up). Nome-lixo do WhatsApp (pushName "$", ".", emoji,
// 1 letra, só dígitos) NÃO é nome -> follow-up usa saudação genérica em vez de "Bom dia $!".
// Exige >=2 LETRAS reais (com acento). Mesma robustez do leadFirstName do reply.
export function isValidName(name: string | null | undefined): boolean {
  if (!name) return false;
  const n = name.trim().toLowerCase();
  const invalidNames = ["lead", "desconhecido", "cliente", "contato", "sem nome", "user", "desconhecida", "—", "unknown"];
  if (n === "" || invalidNames.includes(n)) return false;
  if (/^\+?\d+$/.test(n.replace(/[\s\-\(\)]/g, ""))) return false;
  if ((name.match(/\p{L}/gu) || []).length < 2) return false;
  return true;
}

export function queryIsBroadOrGenericVehicle(value?: string | null) {
  const normalized = normalizePhotoText(value || "");
  if (!normalized) return true;
  const tokens = normalized.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  return tokens.every((token) => [
    "carro", "carros", "veiculo", "veiculos", "estoque", "opcao", "opcoes",
    "outro", "outra", "picape", "pickup", "caminhonete", "camionete", "suv",
    "sedan", "hatch", "foto", "fotos",
  ].includes(token));
}
