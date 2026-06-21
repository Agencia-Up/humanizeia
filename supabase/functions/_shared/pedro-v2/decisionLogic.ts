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

// Extrai o VALOR do teto de preço de "até X mil / R$ X / Xk" (provider-independente). O planner LLM
// (esp. DeepSeek) às vezes NÃO converte "até 50 mil" -> preco_max=50000; aqui garantimos o teto pelos
// dois provedores. Gate em leadMessageHasExplicitPriceCeiling (precisa de marcador de teto + número) ->
// não pega ano/km. Testado offline.
export function parsePriceCeiling(message?: string | null): number | null {
  if (!leadMessageHasExplicitPriceCeiling(message)) return null;
  const t = normalizePlannerText(message);
  const mil = t.match(/(\d{1,3}(?:[.,]\d{1,2})?)\s*mil\b/);
  if (mil) return Math.round(parseFloat(mil[1].replace(".", "").replace(",", ".")) * 1000);
  const k = t.match(/\b(\d{1,3})\s*k\b/);
  if (k) return parseInt(k[1], 10) * 1000;
  const grouped = t.match(/r?\$?\s*(\d{1,3}(?:[.\s]\d{3})+)\b/);
  if (grouped) { const n = parseInt(grouped[1].replace(/[.\s]/g, ""), 10); if (n >= 5000) return n; }
  const plain = t.match(/\b(\d{4,7})\b/);
  if (plain) { const n = parseInt(plain[1], 10); if (n >= 5000 && n <= 2000000) return n; }
  return null;
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

// ── PLANO A (enriquecer o cérebro): o que o lead REJEITOU ─────────────────────────────────────
// O cérebro re-oferecia carro/tipo que o lead JÁ recusou, e lia mal "não, o outro". Detector PURO
// (offline) do sinal LINGUÍSTICO de recusa de veículo: "não quero/gostei/curti X", "esse não",
// "sedan não", "tira o X". Conservador (exige verbo de recusa OU tipo+não OU demonstrativo+não) p/
// NÃO confundir com "não" a uma pergunta ("não, pode mandar"), tempo ("amanhã não") etc. A RESOLUÇÃO
// de QUAL modelo (esse->foco; nome citado->apresentados) fica no orchestrator, que tem o contexto.
const _REJECT_TYPE_WORDS = "sedan|seda|hatch|hatchback|suv|crossover|utilitario|picape|pickup|caminhonete|camionete";
export function detectLeadRejection(message?: string | null): {
  has_rejection: boolean;
  rejected_type: string | null;
  rejects_focus: boolean;
} {
  const t = normalizePlannerText(message);
  const none = { has_rejection: false, rejected_type: null as string | null, rejects_focus: false };
  if (!t) return none;
  const recusaVerb = /\bnao\s+(quero|queria|gostei|gosto|curti|curto|gostaria|interessa|interessou|me interessa|me interessou|agrada|agradou)\b/.test(t)
    || /\b(tira|tirando|tirar|menos|exceto|fora)\s+(o|a|os|as|esse|este|essa|esta|esses)\b/.test(t)
    || /\b(esse|este|essa|esta|esses|desse|deste|dessa|dele|dela|esse ai|esse carro|este carro)\s+nao\b/.test(t)
    || /\bnao\s+(esse|este|essa|esta|gostei|curti)\b/.test(t)
    || new RegExp(`\\b(${_REJECT_TYPE_WORDS})\\s+nao\\b`).test(t);
  if (!recusaVerb) return none;
  const typeKey = (t.match(new RegExp(`\\b(${_REJECT_TYPE_WORDS})\\b`)) || [])[1] || null;
  const rejected_type = typeKey ? _DIRECTION_TYPES[typeKey] || null : null;
  const rejects_focus = /\b(esse|este|essa|esta|esses|desse|deste|dessa|dele|dela|esse ai|esse carro|este carro|o mesmo)\b/.test(t);
  return { has_rejection: true, rejected_type, rejects_focus };
}

// Token de MODELO de um veículo (1º token significativo do modelo, ignora ano/tipo). Pra casar recusa.
function _rejectionModelToken(vehicle: any): string {
  return normalizePlannerText(vehicle?.modelo || "")
    .split(/\s+/)
    .find((w) => w.length >= 3 && !/^\d/.test(w) && !_DIRECTION_TYPES[w]) || "";
}

// Acumula o que o lead REJEITOU. Resolve QUAL modelo: nome de modelo APRESENTADO citado na recusa, ou
// (se "esse"/demonstrativo) o ÚLTIMO apresentado (foco). Soma com o que já havia (união, deduplicado).
// Devolve o `rejeitados` anterior intacto quando não há recusa. PURO -> testado offline.
export function updateRejeitados(message: string, presentedVehicles: any[], prior?: { modelos?: string[]; tipos?: string[] } | null) {
  const base = { modelos: [...(prior?.modelos || [])], tipos: [...(prior?.tipos || [])] };
  const rej = detectLeadRejection(message);
  if (!rej.has_rejection) return base;
  const m = normalizePlannerText(message);
  const apres = Array.isArray(presentedVehicles) ? presentedVehicles : [];
  const newModels: string[] = [];
  for (const v of apres) {
    const mk = _rejectionModelToken(v);
    if (mk && new RegExp(`\\b${mk}\\b`).test(m)) newModels.push(mk);
  }
  if (rej.rejects_focus && newModels.length === 0 && apres.length > 0) {
    const mk = _rejectionModelToken(apres[apres.length - 1]);
    if (mk) newModels.push(mk);
  }
  return {
    modelos: Array.from(new Set([...base.modelos, ...newModels])).slice(0, 10),
    tipos: Array.from(new Set([...base.tipos, ...(rej.rejected_type ? [rej.rejected_type] : [])])).slice(0, 6),
  };
}

// SEGURANÇA anti-blacklist: se o lead AGORA pede explicitamente um modelo/tipo que estava rejeitado
// (mudou de ideia), remove-o da lista de rejeitados. Evita esconder pra sempre um carro que ele voltou
// a querer. PURO -> testado offline.
export function clearRejeitadoOnRequest(rejeitados: { modelos?: string[]; tipos?: string[] } | null | undefined, searchQuery?: string | null) {
  const base = { modelos: [...(rejeitados?.modelos || [])], tipos: [...(rejeitados?.tipos || [])] };
  const q = normalizePlannerText(searchQuery);
  if (!q) return base;
  return {
    modelos: base.modelos.filter((mk) => !new RegExp(`\\b${mk}\\b`).test(q)),
    tipos: base.tipos.filter((tp) => !new RegExp(`\\b${tp}\\b`).test(q)),
  };
}

// ── CASO #2: "MOSTRA MAIS OPCOES" — o lead quer ver carros DIFERENTES dos que ja viu ──────────
// Bug real (lead 99647-8589): pediu "mostra mais opcoes" e recebeu os MESMOS 5 carros. Detecta o
// pedido de MAIS/OUTRAS opcoes (continuacao da lista). NAO confundir com mudanca de TIPO (caso #1):
// aqui o lead quer mais do mesmo perfil, so que carros novos.
export function leadAsksForMoreOptions(message?: string | null) {
  const t = normalizePlannerText(message);
  if (!t) return false;
  return /\b(mais opcoes|mais opcao|mais modelos|mais carros|mais alguns|mais algumas|mais alguma opcao|outras opcoes|outros modelos|mostra mais|me mostra mais|mostrar mais|ver mais|tem mais|que mais (tem|voce tem|tem ai)|quais mais|tem outros|tem outras|mais alguma coisa)\b/.test(t);
}

// Chave estavel de veiculo p/ comparar entre conjuntos (resultado de busca x ja-apresentados).
// Marca+modelo+versao+ano+preco identificam a UNIDADE; tolera campos ausentes.
export function vehicleDedupKey(v: any): string {
  if (!v) return "";
  if (typeof v === "string") return normalizePlannerText(v).replace(/[^\w|]+/g, "-").replace(/^-+|-+$/g, "");
  return normalizePlannerText([v?.marca, v?.modelo, v?.versao, v?.ano, v?.preco]
    .filter((x) => x != null && x !== "")
    .join("|")).replace(/[^\w|]+/g, "-").replace(/^-+|-+$/g, "");
}

// Remove de `items` os veiculos que o lead JA VIU. `presented` aceita veiculos OU chaves (strings).
// Preserva a ordem/ranking de `items`. Se nada a excluir, devolve `items` intacto.
export function excludeAlreadyPresented(items: any[], presented: any[]): any[] {
  if (!Array.isArray(items) || items.length === 0) return Array.isArray(items) ? items : [];
  const seen = new Set((Array.isArray(presented) ? presented : []).map(vehicleDedupKey).filter(Boolean));
  if (seen.size === 0) return items;
  return items.filter((v) => !seen.has(vehicleDedupKey(v)));
}

// ── RODÍZIO DE VENDEDOR (round-robin) — quem NUNCA recebeu lead vai PRIMEIRO ──────────────────
// Bug real (Icom Motors): vendedores novos (last_lead_received_at = NULL) NUNCA recebiam lead. Raiz:
// o round-robin ordenava no banco por `last_lead_received_at ASC NULLS FIRST`, mas em produção o
// `NULLS FIRST` NÃO era aplicado -> Postgres usa NULLS LAST no ASC -> o vendedor novo (null) caía pro
// FIM da fila e nunca era escolhido. Aqui ordenamos no CÓDIGO (determinístico, testável offline): menor
// `total_leads_received` primeiro e, no empate, quem recebeu há mais tempo — tratando NULL ("nunca
// recebeu") como o mais antigo possível -> escolhido PRIMEIRO. Não depende do ordenamento de null do banco.
export function pickRoundRobinSeller(sellers: any[]): any | null {
  if (!Array.isArray(sellers) || sellers.length === 0) return null;
  const lastTs = (v: any): number => {
    if (!v) return 0; // nunca recebeu -> época 0 -> mais antigo -> primeiro da fila
    const t = new Date(v).getTime();
    return Number.isFinite(t) ? t : 0;
  };
  return [...sellers].sort((a, b) => {
    const ta = Number(a?.total_leads_received) || 0;
    const tb = Number(b?.total_leads_received) || 0;
    if (ta !== tb) return ta - tb;
    return lastTs(a?.last_lead_received_at) - lastTs(b?.last_lead_received_at);
  })[0] || null;
}

// ── NUNCA NEGAR SEM CHECAR: lead refina a VERSÃO/MOTOR de um veículo em contexto -> SEMPRE busca ──
// Bug real (lead Alê, Compass): apos o agente oferecer um Compass Limited 2019, o lead disse "Nao amigo.
// Seria o modelo 270 com nova motorizacao." O planner pos needs_search=false e respondeu "nao temos o
// 270" SEM buscar — e havia 2 Compass T270 no estoque. O guard de busca existente so dispara quando o
// MODELO esta NA FRASE; aqui o modelo (Compass) estava no CONTEXTO e a frase so traz a VERSAO (270).
// Um bom vendedor CHECA o estoque quando o cliente especifica uma versao/motor; nunca nega de cabeca.

// Modelo do veiculo "em jogo" na conversa (apresentado / interesse / referencia / anuncio). Prefere o
// campo `modelo` do veiculo apresentado (ex.: "Compass") p/ a busca liderar pela FAMILIA, nao pela trim.
export function contextVehicleModel(memory: any, adVehicleQuery?: string | null): string | null {
  const m = memory || {};
  const apres = Array.isArray(m.veiculos_apresentados) ? m.veiculos_apresentados : [];
  const fromPresented = apres[0]?.modelo || null;
  const fromInterest = m.interesse?.modelo_desejado || null;
  const fromRef = m.referencia?.veiculo_citado || m.referencia?.ultimo_veiculo || null;
  const out = fromPresented || fromInterest || fromRef || (adVehicleQuery || null);
  return out ? String(out).trim() || null : null;
}

// Versao/motor/trim que o lead pode estar pedindo (sinal de "checar variante especifica"). NAO usa \b no
// fim de "motoriz" (a palavra continua: motorizacao). "270"/"t270"/"modelo X" cobrem o caso real.
const _VERSION_SPEC = /(\bt\s?-?270\b|\b270\b|\bturbo\b|\btsi\b|\btgdi\b|\bpremier\b|\blimited\b|\blongitude\b|\btrailhawk\b|\bsport\b|\bdiesel\b|motoriz|\bmodelo\s+\w)/;

// ── TRAVA FINAL: o reply NEGA disponibilidade de veículo? (cinto-e-suspensório anti-alucinação) ──
// Detecta "não temos / não tenho / infelizmente não temos / não há X em estoque". Exclui "não temos
// como" (financiamento/horário — não é sobre carro). Usado pelo orchestrator: se NEGA + o cérebro NÃO
// buscou neste turno + o lead nomeou um veículo -> faz a busca que faltou em vez de deixar a mentira sair.
export function replyDeniesAvailability(text?: string | null): boolean {
  const t = normalizePlannerText(text);
  if (!t) return false;
  if (/\bnao temos como\b/.test(t)) return false;
  return /\b(infelizmente\s+)?(nao temos|nao tenho|nao trabalhamos com|nao dispomos|nao possuimos)\b/.test(t)
    || /\bnao (ha|existe|tem)\b.{0,30}\b(em estoque|no estoque|disponivel|disponiveis)\b/.test(t)
    || /\b(no momento|atualmente)\b.{0,25}\bnao (temos|tenho)\b/.test(t);
}

export function leadRefinesVehicleNeedsSearch(message?: string | null, memory?: any, adVehicleQuery?: string | null): boolean {
  const t = normalizePlannerText(message);
  if (!t) return false;
  // ha um veiculo em contexto pra refinar? (sem isso, "270" solto nao identifica nada)
  if (!contextVehicleModel(memory, adVehicleQuery)) return false;
  // despedida/agradecimento PURO (sem especificar versao) nao e refinamento -> nao forca busca.
  if (/\b(obrigado|obrigada|valeu|tchau|ate mais|era so isso|so isso mesmo)\b/.test(t) && !_VERSION_SPEC.test(t)) return false;
  return _VERSION_SPEC.test(t);
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
