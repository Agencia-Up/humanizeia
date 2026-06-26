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

// Escapa metacaracteres de regex. CRÍTICO: modelos/versões vêm com parênteses ("(cab. simples)"), pontos
// ("2.5"), etc. — interpolados CRUS em `new RegExp(\`\\b${tok}\\b\`)` geram regex INVÁLIDA que LANÇA e
// DERRUBA o turno inteiro (turn_failed silencioso, lead 99755-8112 Toyota Hilux "(cab. simples)" no pedido
// de foto -> sem resposta). normalizePlannerText NÃO tira pontuação (de propósito, p/ detectar "?"), então
// todo `new RegExp(\`\\b${token}\\b\`)` com token vindo de modelo/interesse/rejeitado PRECISA escapar. PURO.
export function escapeRegExp(value?: string | null): string {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function leadMessageHasExplicitPriceCeiling(message?: string | null) {
  const text = normalizePlannerText(message);
  if (!/\d/.test(text)) return false;
  // "34k" / "34 mil" / "R$ 34.000" são PREÇO por si só, mesmo sem "até" (caso real "Tem algum de 34k?"
  // = orçamento de 34 mil). Exclui quando é claramente quilometragem ("34 mil km", "34k km/rodados").
  if (/\b\d{1,3}\s*k\b/.test(text) && !/\b\d{1,3}\s*k\s*(?:km|rodad|de km)/.test(text)) return true;
  if (/\b\d{1,3}(?:[.,]\d{1,2})?\s*mil\b/.test(text) && !/\bmil\s*(?:km|rodad|de km)/.test(text)) return true;
  if (/r\$\s*\d/.test(text)) return true;
  return /\b(ate|maximo|maxima|no maximo|orcamento|budget|tenho|tenho ate|procuro ate|quero ate|faixa de|na faixa|valor maximo|limite|de ate|por ate)\b/.test(text);
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

// ── "TEM ALGUM DE 34K?": lead quer QUALQUER carro no ORÇAMENTO (não um modelo específico) ────────────
// Caso real lead 99747-0573: "Tem algum de 34k?" buscava "Zafira" (modelo velho/stale) e ignorava o
// orçamento. O lead quer QUALQUER carro até ~34 mil. Detecta teto de preço + pista de "qualquer/algum
// carro" (sem nomear modelo) -> o planner larga o modelo e busca AMPLO filtrado por preço (mais em conta).
export function leadAsksAnyCarInBudget(message?: string | null): boolean {
  const t = normalizePlannerText(message);
  if (!t) return false;
  if (parsePriceCeiling(t) === null) return false;
  return /\b(algum|alguma|algo|qualquer|o que tiver|que tiver|tem de|tem carro|algum carro|carro de|carro por|opcao|opcoes|mais em conta|mais barato|baratinho)\b/.test(t);
}

function vehicleTypeFromTypeWord(value?: string | null) {
  const t = normalizePlannerText(value);
  const map: Record<string, string> = {
    sedan: "sedan", sedans: "sedan", seda: "sedan", sedas: "sedan",
    hatch: "hatch", hatches: "hatch", hatchback: "hatch",
    suv: "suv", suvs: "suv",
    picape: "pickup", picapes: "pickup", pickup: "pickup", pickups: "pickup", caminhonete: "pickup", caminhonetes: "pickup",
    utilitario: "suv", utilitarios: "suv",
    moto: "moto", motos: "moto", motocicleta: "moto", motocicletas: "moto",
  };
  return map[t] || null;
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
  const named_prior = priorTokens.length > 0 && priorTokens.some((t) => new RegExp(`\\b${escapeRegExp(t)}\\b`).test(m));
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

// Lead pede uma CARROCERIA (sedan/hatch/suv/picape) como pedido NOVO -> retorna o tipo canônico, senão
// null. Bug real (Avant, lead "Quero um sedan você teria ai?"): o planner marcou photo_request (tinha
// oferecido fotos + "quero") e o "um" virou ordinal #1 -> mandou foto de um HATCH dizendo ser "sedan".
// PURO (offline). NÃO dispara quando: (a) pede FOTO/vídeo do tipo ("manda foto do sedan" = photo_request);
// (b) é sobre o carro EM FOCO (demonstrativo, característica, elogio "gostei/fico com").
export function leadAsksBodyType(message?: string | null): string | null {
  const m = normalizePlannerText(message);
  if (!m) return null;
  if (/\b(foto|fotos|imagem|imagens|video|videos)\b/.test(m)) return null;
  // `s?` no fim casa o PLURAL ("sedans", "suvs", "picapes") — o lead quase sempre pluraliza
  // ("queria sedans"); sem isso o backstop de carroceria não disparava (caso real Avant).
  const typeWord = Object.keys(_DIRECTION_TYPES).find((t) => new RegExp(`\\b${t}s?\\b`).test(m));
  if (!typeWord) return null;
  const aboutFocus = /\b(esse|este|essa|esta|nesse|neste|nessa|nesta|desse|deste|dele|dela|o mesmo|esse carro|este carro|gostei|gostou|fico com|vou levar|quero esse|quero este)\b/.test(m)
    || /\b(teto|cor|cores|km|quilometr|motor|consumo|completo|cambio|porta|aceita troca|financi|parcel|entrada|qual o valor|qual valor|quanto custa|quanto sai|quanto fica)\b/.test(m);
  return aboutFocus ? null : _DIRECTION_TYPES[typeWord];
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
    if (mk && new RegExp(`\\b${escapeRegExp(mk)}\\b`).test(m)) newModels.push(mk);
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
    modelos: base.modelos.filter((mk) => !new RegExp(`\\b${escapeRegExp(mk)}\\b`).test(q)),
    tipos: base.tipos.filter((tp) => !new RegExp(`\\b${escapeRegExp(tp)}\\b`).test(q)),
  };
}

// ── PLANO B: ESTADO DA CONVERSA (consolidado, determinístico) ─────────────────────────────────
// Dá ao cérebro o FILME da conversa num bloco compacto (em vez de inferir do histórico cru): de onde
// veio, o que o lead quer, o que rejeitou, quantos já viu, qualificação e a ETAPA do funil. Lê intenção
// melhor (especialmente em modelo barato) e conduz melhor. PURO -> testado offline. Sem custo de LLM.
export function buildConversationState(memory?: any, adContext?: any) {
  const m = memory || {};
  const int = m.interesse || {};
  const neg = m.negociacao || {};        // ⭐shape REAL salvo pelo agente (lead.nome/negociacao/atendimento)
  const at = m.atendimento || {};        // ⭐
  const lead = m.lead || {};             // ⭐
  const apres = Array.isArray(m.veiculos_apresentados) ? m.veiculos_apresentados : [];
  const rej = m.rejeitados || { modelos: [], tipos: [] };
  // CANÔNICO primeiro (lead.nome / negociacao.* / atendimento.*) + fallback nos campos antigos (compat).
  // Sem isto (Codex) o cérebro recebia qualificação VAZIA: lia interesse.*/lead_name, que NINGUÉM preenche
  // (o save grava em lead.nome/negociacao/atendimento) -> o planner achava que não sabia nada e RE-PERGUNTAVA
  // nome/troca/pagamento/agendamento já coletados (= "repete pergunta / perde contexto").
  const nome = lead.nome || m.lead_name || int.nome || null;
  const troca = neg.carro_troca || int.carro_troca || int.trade_in_vehicle || m.trade_in_vehicle || null;
  const pagamento = neg.forma_pagamento || int.forma_pagamento || int.pagamento || null;
  const entrada = neg.valor_entrada || int.valor_entrada || null;
  const agendamento = at.dia_agendamento || int.dia_agendamento || int.agendamento || null;
  const temInteresse = Boolean(int.modelo_desejado || int.tipo_veiculo);
  const qualificado = Boolean(nome && temInteresse && (troca || pagamento || entrada || agendamento));
  let etapa = "descobrindo";
  if (agendamento) etapa = "agendando";
  else if (qualificado) etapa = "decidindo";
  else if (apres.length > 0) etapa = "comparando";
  else if (temInteresse) etapa = "buscando";
  return {
    origem: (adContext?.has_ad_context && adContext?.vehicle_query) ? `anuncio:${adContext.vehicle_query}` : (m.origem || null),
    interesse: { tipo: int.tipo_veiculo || null, modelo: int.modelo_desejado || null, preco_max: int.preco_max || null, cambio: int.cambio || null, cor: int.cor || null },
    rejeitou: { modelos: rej.modelos || [], tipos: rej.tipos || [] },
    ja_viu_qtd: apres.length,
    qualificacao: { nome, troca, pagamento, entrada, agendamento, tem_troca: (neg.tem_troca ?? null) },
    etapa,
  };
}

// Remove dos resultados os veículos cujo MODELO o lead REJEITOU (enforcement determinístico do Plano A:
// o cérebro pode escorregar, mas a busca NUNCA re-oferece um modelo recusado). Por MODELO (não tipo —
// tipo o motor de busca já filtra). PURO -> testado offline.
export function excludeRejeitados(items: any[], rejeitados?: { modelos?: string[] } | null): any[] {
  if (!Array.isArray(items) || items.length === 0) return Array.isArray(items) ? items : [];
  const modelos = (rejeitados?.modelos || []).map((s) => normalizePlannerText(s)).filter((s) => s.length >= 3);
  if (modelos.length === 0) return items;
  return items.filter((v) => {
    const vm = normalizePlannerText(v?.modelo || "");
    return !modelos.some((mk) => new RegExp(`\\b${escapeRegExp(mk)}\\b`).test(vm));
  });
}

// ── FOTO DO CARRO CERTO: qual MODELO o lead quer ver em foto ──────────────────────────────────
// Bug real (lead Barbara): interesse="Peugeot 2008 2021" mas o pool/ancora estava ESTRAGADO com uma
// Tracker (apresentacao anterior) -> mandou foto da Tracker. Se a MENSAGEM referencia o modelo de
// INTERESSE (compartilha um token, ex.: "fotos do 2008 2021" cita "2008"/"2021" do interesse "Peugeot
// 2008 2021"), o alvo da foto e o INTERESSE — nao a ancora velha. Senao (demonstrativo "esse"/sem
// referencia), cai no fallback (search_query/resolver) e o fluxo usa a ancora normal. PURO -> offline.
export function photoRequestTargetModel(message?: string | null, memory?: any, fallbackQuery?: string | null): string | null {
  const t = normalizePlannerText(message);
  const interestRaw = memory?.interesse?.modelo_desejado || null;
  const interest = normalizePlannerText(interestRaw);
  if (t && interest) {
    const interestTokens = interest.split(/\s+/).filter((w) => w.length >= 3);
    if (interestTokens.some((tok) => new RegExp(`\\b${escapeRegExp(tok)}\\b`).test(t))) return interestRaw;
  }
  return (fallbackQuery && String(fallbackQuery).trim()) || null;
}

// ── "PROMETE E NÃO CUMPRE" (foto): lead RECLAMA que a foto veio ERRADA ou NÃO chegou ──────────
// Bug real (lead Barbara): recebeu foto da Tracker, disse "essas fts n sao peugeot / vc n mandou
// nenhuma do carro certo" -> o agente PROMETEU "vou verificar e enviar as corretas" e mandou ZERO.
// O agente NAO tem como enviar depois -> tem que RE-DISPARAR a foto do carro certo AGORA, nunca prometer.
// Detector PURO (offline) do sinal de reclamacao de foto errada/faltando. Conservador.
export function leadComplainsPhotoWrongOrMissing(message?: string | null): boolean {
  const t = normalizePlannerText(message);
  if (!t) return false;
  const photoWord = /\b(foto|fotos|fts|imagem|imagens)\b/.test(t);
  // "n" = abreviacao de "nao" no WhatsApp ("essas fts n sao peugeot", "vc n mandou").
  const nao = "(nao|n)";
  const wrongSignal = new RegExp(`\\b(errad|trocad|${nao}\\s+(sao|e|eh|era|mandou|enviou|recebi|chegou)|cade|kade|carro errado|outro carro)\\b`).test(t);
  return (photoWord && wrongSignal)
    || new RegExp(`\\b${nao}\\s+mandou\\s+nenhuma\\b`).test(t)
    || /\b(do|o)\s+carro\s+certo\b/.test(t);
}

// ── "QUANDO INCERTO, PERGUNTAR — NÃO CHUTAR" (best-practice: intenção errada é pior que nenhuma) ──────
// Mensagem GENÉRICA sem NENHUM critério ("quero um carro", "me ajuda a escolher", "qual o melhor",
// "não sei qual") -> o agente NÃO deve despejar carros aleatórios (o "chute"); deve fazer UMA pergunta
// de qualificação (tipo/faixa de preço/uso). Detector PURO + conservador: só dispara sem tipo, sem
// número (preço/ano), sem foto/financiamento/troca, sem marca/modelo nomeado, e sem interesse na
// memória. "o que vocês têm?" (pedido de mostruário) NÃO conta como vago -> apresenta amostra.
export function messageIsTooVagueToAct(message?: string | null, memory?: any): boolean {
  const t = normalizePlannerText(message);
  if (!t) return false;
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 12) return false;
  if (memory?.interesse?.modelo_desejado || memory?.interesse?.tipo_veiculo) return false;
  // Já tem CRITÉRIO -> não é vago.
  if (/\b(suv|sedan|sedã|hatch|hatchback|picape|pickup|caminhonete|utilitario|4x4|cabine|sw4)\b/.test(t)) return false;
  if (/\d/.test(t)) return false; // qualquer número (preço/ano/cilindrada) = já tem critério
  if (/\b(foto|fotos|fts|imagem|financ|troca|trocar|agendar|test ?drive|preco|valor|parcel|entrada)\b/.test(t)) return false;
  // Sinal de querer-genérico SEM critério, OU pedido de ajuda/recomendação.
  const genericWant =
    /\b(quero|queria|procuro|busco|gostaria|to querendo|estou querendo|to procurando|estou procurando|to a procura|estou a procura)\b.{0,14}\b(carro|veiculo|automovel|algo|alguma coisa)\b/.test(t)
    || /\b(me ajuda|me ajudem|pode me ajudar|preciso de ajuda|qual (o )?melhor|o que (voces|vc) (recomenda|indica)|que carro (voces|vc) (recomenda|indica)|to na duvida|nao sei qual|to indeciso|estou indeciso|to perdido)\b/.test(t);
  return genericWant;
}

// ── INTENÇÃO de VISITA/COMPRA -> AGENDAR + COLETAR DADOS antes de transferir ─────────────────────────
// Decisão do dono: lead que diz que vai à loja ou quer comprar/visitar NÃO deve ser transferido "do nada"
// — o agente deve perguntar dia/horário e colher os dados (poupa o vendedor). Caso real lead 98861-9201:
// "Irei até a loja" → transferiu cru. Detecta IR À LOJA / comprar / visitar (não "carro da loja").
export function leadExpressesVisitOrBuyIntent(message?: string | null): boolean {
  const t = normalizePlannerText(message);
  if (!t) return false;
  // VISITA: ir/passar até a loja (verbo de deslocamento + loja, sem "carro da loja" no meio)
  if (/\b(irei|vou|posso|vamos|gostaria de ir|gostaria de passar)\s*(ate\s+)?(a\s+|na\s+|a sua\s+|na sua\s+|de ir a\s+)?loja\b/.test(t)) return true;
  if (/\b(vou|quero|posso|gostaria de|vamos)\s+(passar|aparecer|dar uma passada|visitar|conhecer)\b/.test(t)) return true;
  if (/\b(passar|aparecer|dar uma passada)\s+(ai|la|na loja|ate ai|por ai)\b/.test(t)) return true;
  // COMPRA / fechamento
  if (/\b(quero|vou|gostaria de)\s+(comprar|fechar|levar)\b/.test(t)) return true;
  if (/\bvou querer\b/.test(t)) return true;
  if (/\bfechar\s+(negocio|o carro|a compra|com voces)\b/.test(t)) return true;
  return false;
}

// ── LEAD CONFIRMOU a pergunta de AGENDAMENTO do agente ("Sim" depois de "quer agendar uma visita?") ──
// Caso real lead 98198-7661: o agente perguntou "tem interesse em agendar uma visita?", o lead disse
// "Sim" e o agente TRANSFERIU sem colher dia/hora. O hold de visita (v167) só olhava a MENSAGEM do lead
// (leadExpressesVisitOrBuyIntent) — "Sim" não casa. Aqui detectamos a CONFIRMAÇÃO: a última msg do AGENTE
// perguntou sobre agendar/visita E o lead afirmou (sem ainda dar a data) → é contexto de visita → COLHER.
export function leadAffirmsSchedulingQuestion(leadText?: string | null, lastAgentText?: string | null): boolean {
  const a = normalizePlannerText(lastAgentText);
  if (!a || !a.includes("?")) return false;
  const agentAskedSchedule = /\bagendar\b|\bmarcar\b|\bvisita\b|test ?drive|passar (na|aqui|la|em|no)|vir (a|na|ate|no)|melhor dia|que dia|qual dia|dia e horario|qual horario/.test(a);
  if (!agentAskedSchedule) return false;
  const t = normalizePlannerText(leadText);
  if (!t) return false;
  return /^(sim|isso|claro|quero|pode ser|pode sim|pode|bora|vamos|com certeza|aceito|ok|okay|blz|beleza|por mim|perfeito|fechado|tranquilo|uhum|aham|isso mesmo|gostaria|quero sim|sim quero|quero agendar|vamos agendar)\b/.test(t);
}

// "Sim"/"ok"/"to aqui" respondendo a um PING DE FOLLOW-UP ("Ainda está por aí?", "Conseguiu dar uma olhada?")
// é confirmação de PRESENÇA — NÃO é aceite de foto/oferta. O planner às vezes marca esse "Sim" como
// action=photo_request e o agente RE-DESPEJA o álbum (lead 3199-6370: follow-up "ainda está por aí?" → lead
// "Sim" → 5 fotos de novo). Diferente de aceitar uma OFERTA DE FOTO ("quer ver fotos?"→"sim"), que segue
// normal. Só dispara em msg CURTA de presença/afirmação, sem pedir foto/preço/outro carro. PURO.
export function leadAffirmsPresenceToFollowupPing(leadText?: string | null, lastAgentText?: string | null): boolean {
  const a = normalizePlannerText(lastAgentText);
  const t = normalizePlannerText(leadText);
  if (!a || !t) return false;
  const lastIsFollowupPing = /ainda esta por ai|conseguiu dar uma olhada|ainda tem interesse|ainda posso (te )?ajudar|posso (te )?ajudar com mais|ainda esta ai|^e ai|o que (voce |vc )?achou|continua interessad/.test(a);
  if (!lastIsFollowupPing) return false;
  if (t.length > 26) return false;                                  // afirmação CURTA de presença
  if (/\b(foto|fotos|imagem|imagens|manda|mandar|envia|enviar|mostra|ver|preco|valor|quanto|outr|mais opc|model|agend|visit)\b/.test(t)) return false;
  return /^(sim|isso|claro|ok|okay|aham|uhum|positivo|certo|to aqui|estou aqui|estou|to|sigo aqui|sigo|aqui|presente|continuo|to sim|estou sim|sim sim|ainda estou|ainda to|opa|oi)\b/.test(t);
}

// ── PENDING_QUESTION PERSISTIDO (análise Codex): classifica O QUE A RESPOSTA DO AGENTE perguntou/ofereceu,
// pra SALVAR no estado e o PRÓXIMO turno interpretar o "sim/ok/2024/o preto/👍" do lead SEM re-parsear a
// última fala (que pode vir duplicada/atrasada/manual/splitada). Mais robusto que inferir do histórico.
// Categorias iguais às do classifyPendingQuestion do planner (ofereceu_fotos/ofereceu_opcoes/perguntou_*).
// O SOURCE (determinístico, setado pelo orquestrador) é mais forte que o texto. PURO -> testável offline.
export function classifyAgentReplyPending(replyText?: string | null, replySource?: string | null): string {
  const src = String(replySource || "");
  if (["vehicle_photos_pick_which", "vehicle_photos_need_reference", "vehicle_photos_ambiguous_model"].includes(src)) return "ofereceu_fotos";
  if (src === "trade_collecting") return "perguntou_troca";
  if (src === "visit_schedule_qualify" || src === "visit_cpf_qualify") return "perguntou_dados";
  if (src === "ad_generic_abordagem") return "perguntou_veiculo";
  if (src === "followup_ping_reengage") return "ofereceu_opcoes";
  const raw = String(replyText || "");
  const t = normalizePlannerText(raw);
  if (!t) return "nenhum";
  // Palavra de QUALIFICAÇÃO/agendamento na fala -> NÃO é oferta de foto (um "tem troca?" não é foto).
  const hasQualWord = /\b(troca|entrada|pagamento|financ|cpf|nascimento|nome|loja|visita|test ?drive|orcamento|parcela|\bvalor\b|\bdia\b|horario|agendar)\b/.test(t);
  if (!hasQualWord
      && /\b(quer|posso|gostaria|deseja|te mando|vou (mandar|enviar|separar|te mandar)|consigo (te )?mandar|te envio|separar as fotos|qual.{0,18}(ver|foto))\b/.test(t)
      && /\b(foto|fotos|imagem|imagens|video|videos)\b/.test(t)) return "ofereceu_fotos";
  if (!hasQualWord
      && /\b(posso te mostrar|posso mostrar|quer ver|gostaria de ver|te mostro|vou te mostrar|quer que eu (te )?mostre|posso te indicar|posso te oferecer|mais opcoes|outras opcoes)\b/.test(t)
      && /\b(opcao|opcoes|alternativa|carro|carros|modelo|modelos|hatch|sedan|suv|picape|veiculo|estoque|disponiveis)\b/.test(t)) return "ofereceu_opcoes";
  if (/\b(a vista|financ|parcel|entrada|consorcio)\b/.test(t) && /\b(pretende|vai|forma|paga|pagar|prefere|quer)\b/.test(t)) return "perguntou_pagamento";
  if (/\b(carro na troca|usado na troca|tem (um |algum )?carro (pra|para)? ?(dar de )?troca|algum carro (pra|para) (dar de )?troca|dar de troca|tem troca)\b/.test(t)) return "perguntou_troca";
  if (/\b(seu nome|qual.{0,8}nome|me confirma.{0,10}nome|\bcpf\b|nascimento|telefone|e[ -]?mail|whatsapp|qual.{0,6}dia|que dia|qual horario|melhor dia)\b/.test(t)) return "perguntou_dados";
  if (/\b(qual (carro|modelo|veiculo)|que carro|qual veiculo|esta procurando|o que (voce )?(esta )?(procura|procurando|busca)|tipo de carro|qual seria)\b/.test(t)) return "perguntou_veiculo";
  if (/[?]\s*$/.test(raw.trim())) return "fez_pergunta";
  return "afirmacao";
}

// ── FUNIL FORÇADO: próxima pergunta obrigatória do funil do CLIENTE ainda não respondida ─────────────
// O dono pediu pra FORÇAR o funil que está no prompt do cliente (o LLM barato não conduz sozinho). Lemos
// o funil ESTRUTURADO (agent_funnel_config.bloco4_qualificacao.questions, na ordem do cliente), mapeamos
// cada pergunta a um campo de qualificação e devolvemos a 1ª NÃO respondida (texto exato do cliente).
// Perguntas que não mapeamos (não dá pra saber se foram respondidas) são puladas — nunca forçamos o que
// não sabemos rastrear (evita loop). Genérico: cada cliente tem o seu bloco4.
export function nextFunnelQuestion(bloco4?: any, qual?: any, opts?: { hasName?: boolean; hasInterest?: boolean }): string | null {
  const questions: string[] = Array.isArray(bloco4?.questions)
    ? bloco4.questions.filter((q: any) => typeof q === "string" && q.trim().length > 1)
    : [];
  if (questions.length === 0) return null;
  const q = qual || {};
  const filled = (v: any) => v !== null && v !== undefined && String(v).trim() !== "";
  const boolSet = (v: any) => v === true || v === false;
  for (const question of questions) {
    const n = normalizePlannerText(question);
    let mappable = false, answered = false;
    if (/\bnome\b/.test(n)) { mappable = true; answered = filled(q.nome) || Boolean(opts?.hasName); }
    else if (/troca/.test(n)) { mappable = true; answered = boolSet(q.tem_troca) || filled(q.carro_troca); }
    else if (/entrada/.test(n)) { mappable = true; answered = filled(q.valor_entrada); }
    else if (/pagament|financ|a vista|parcel/.test(n)) { mappable = true; answered = filled(q.forma_pagamento); }
    else if (/loja|onde fica|localiza|conhece/.test(n)) { mappable = true; answered = boolSet(q.sabe_localizacao); }
    else if (/agendar|visita|test|\bdia\b|horario/.test(n)) { mappable = true; answered = filled(q.dia_agendamento); }
    else if (/\bcpf\b/.test(n)) { mappable = true; answered = filled(q.cpf); }
    // INTERESSE ("O que você está procurando?", "que tipo de carro?", "qual modelo?") — a pergunta-chave de
    // qualificação. Respondida quando há interesse (modelo/tipo) na conversa. Antes era unmappable -> a Avant
    // (bloco4 = nome + "o que procura?") perdia a pergunta MAIS importante do funil.
    else if (/procura|procurando|\binteresse\b|interessou|o que (voce|vc) (esta|ta|busca|quer)|que (tipo de )?carro|qual (carro|modelo|veiculo)|esta buscando/.test(n)) {
      mappable = true; answered = filled(q.interesse) || Boolean(opts?.hasInterest);
    }
    if (mappable && !answered) return question.trim();
  }
  return null;
}

// Invariante "FUNIL ANTES DO HANDOFF" (runtime: orchestrator handoff_blocked_pending_funnel) extraído p/
// função PURA testável: havendo pergunta de funil PENDENTE, o handoff deve ser BLOQUEADO (ex.: lead diz
// "gostei" mas falta nome/interesse/troca exigidos pelo funil da loja). Reusa nextFunnelQuestion — a MESMA
// fonte de verdade do guard em runtime — então não inventa política nova. Sem funil configurado -> não
// bloqueia. A ser ligada no planner/orchestrator no passo de wiring (deploy); aqui só provada offline. PURO.
export function funnelBlocksHandoff(bloco4?: any, qual?: any, opts?: { hasName?: boolean; hasInterest?: boolean }): boolean {
  return Boolean(nextFunnelQuestion(bloco4, qual, opts));
}

// A resposta JÁ pergunta algo do funil (nome/troca/entrada/pagamento/loja/agendar)? Se sim, não anexamos
// outra pergunta do funil (o agente já está conduzindo). PURO.
export function replyAsksFunnelQuestion(text?: string | null): boolean {
  const t = normalizePlannerText(text);
  if (!t || !t.includes("?")) return false;
  return /\bnome\b/.test(t)
    || /\btroca\b|de troca|na troca/.test(t)
    || /de entrada|valor de entrada|tem entrada/.test(t)
    || /\bfinanc|a vista|forma de pagament|parcel/.test(t)
    || /conhece (a |nossa )?loja|onde fica|sabe onde|nossa loja|ja foi.*loja/.test(t)
    || /agendar|marcar.*(visita|horario)|test ?drive|vir (a|na) loja|passar (aqui|na loja|la)/.test(t);
}

// A resposta tem uma pergunta que AVANÇA a conversa (funil OU engajamento de venda: foto/vídeo/visita/
// modelo/tipo/valor/o-que-procura/...)? Uma pergunta-ISCA vazia ("precisa de mais alguma informação?",
// "posso ajudar?", "alguma dúvida?") NÃO conta. Usado pelo SDR-force: se a resposta NÃO tem pergunta
// significativa, o agente está sendo PASSIVO -> puxa a próxima pergunta do funil. PURO.
export function replyHasMeaningfulQuestion(text?: string | null): boolean {
  const raw = String(text || "");
  if (!raw.includes("?")) return false;
  // Olha SÓ as frases que de fato CONTÊM "?" (uma afirmação como "Nossa loja fica em X" não vira pergunta
  // só porque o texto tem "?" em outra frase de isca). Em cada frase-pergunta, checa funil OU venda.
  const qSentences = raw.split(/(?<=[.!?…])\s+/).filter((s) => s.includes("?"));
  for (const s of qSentences) {
    const t = normalizePlannerText(s);
    if (replyAsksFunnelQuestion(t)) return true;
    if (/\b(foto|fotos|video|videos|procura|procurando|interesse|interessou|tipo de carro|que carro|qual carro|qual modelo|qual veiculo|modelo|valor|preco|parcela|financ|simul|km|\bano\b|\bcor\b|cambio|combustivel|qual desses|algum desses|gostaria de ver|quer ver|te mostr|mostrar|opcoe|op[cç]ao)\b/.test(t)) return true;
  }
  return false;
}

// A resposta é uma DESPEDIDA/FECHAMENTO gracioso ("qualquer coisa é só me chamar", "fico à disposição",
// "não vou tomar seu tempo", "até mais")? Se sim, o SDR-force NÃO acrescenta pergunta (não puxa funil em
// cima de um tchau). Blindagem caso o LLM feche sem marcar transferir_silencioso. PURO.
export function replyIsGracefulClose(text?: string | null): boolean {
  const t = normalizePlannerText(text);
  if (!t) return false;
  return /qualquer (coisa|d[uú]vida).{0,25}(chamar|chama|disposi|aqui)|n[aã]o vou (tomar|atrapalhar|te tomar)|fico (a|à) disposi|estou (a|à) disposi|(e|é) s[oó] (me )?chamar|qualquer (coisa|d[uú]vida) (e|é) s[oó]|at[eé] (mais|logo|breve|a proxima|mais ver)|tenha (um[a]? )?(bom|boa|[oó]tim)|nao tomo seu tempo/.test(t);
}

// O LEAD está de fato PERGUNTANDO algo (info/dúvida)? É o GATILHO do SDR-force ("se o lead PERGUNTA as
// coisas, qualifica"). Um PEDIDO ("me manda fotos do Ka"), uma RESPOSTA curta ("ford ka", "sim", "esse")
// ou uma AFIRMAÇÃO ("tenho um gol pra troca") NÃO é pergunta -> NÃO força qualificação (evita empilhar
// "tem troca?" em cima de pedido de foto, que deixou o agente robótico/repetitivo — lead 99742-3129). PURO.
export function leadAsksInfoQuestion(text?: string | null): boolean {
  const t = normalizePlannerText(text);
  if (!t) return false;
  // pedido/comando explicito (sem "?") NAO e pergunta de info
  if (!t.includes("?") && /\b(me )?(manda|mande|envia|envie|mostra|mostre|quero ver|queria ver|ver as? fotos?|manda as? fotos?|\bfotos?\b|\bvideos?\b)\b/.test(t)) return false;
  if (t.includes("?")) return true;
  // perguntas casuais sem "?" (texting): "vcs tem...", "qual o valor", "onde fica", "aceita financiamento"
  return /\b(voce|voces|vcs|vc)\s+(tem|teem|aceita|trabalha|financia|parcela|fica|abre|funciona|fazem|faz)\b/.test(t)
    || /\b(quanto|qual|quais|onde|quando|que horas|hor[aá]rio|aceita|financi|parcel|condic|garantia|documenta|consorcio)\b/.test(t)
    || /\btem\b[^?]*\b(carro|veiculo|suv|sedan|hatch|picape|moto|plano|financ|entrada|desconto|garantia)\b/.test(t);
}

// ── LEAD ESTÁ DESCREVENDO O CARRO DA TROCA (km/estado/itens) — COLETA crucial, NÃO transferir no meio ──
// Caso real lead 99628-7178: ofereceu Onix 2015 + agente pediu detalhes; o lead mandou "17500 km",
// "Revisado", "Embreagem, Correia dentada, freio", "Tudo ok", fotos — e o agente JÁ tinha transferido
// (silêncio), perdendo TODA a coleta. Enquanto o lead está descrevendo o carro da troca, o agente deve
// COLHER (não encaminhar). Detecta km/estado/itens revisados/condição.
export function leadProvidingTradeDetails(message?: string | null): boolean {
  const t = normalizePlannerText(message);
  if (!t) return false;
  if (/\b\d{1,3}\s*mil\s*km\b|\b\d{2,7}\s*km\b|\bkm\b|\bquilometragem\b/.test(t)) return true;
  if (/\b(revisad|revisao|otimo estado|bom estado|estado de novo|impecavel|conservad|tudo ok|tudo certo|sem detalhe|nada a fazer|zerad|sem batida|nunca bateu|original de fabrica)/.test(t)) return true;
  if (/\b(embreagem|correia|freio|pneu|suspensao|oleo|bateria|amortecedor|motor|cambio|troquei|trocada|trocado)\b/.test(t)) return true;
  if (/\b(unico dono|um dono|primeira dona|todas as revisoes|nota fiscal|manual e chave|chave reserva|ipva pago|quitado|sem multa)\b/.test(t)) return true;
  return false;
}

// ── LEAD RECUSOU EXPLICITAMENTE o atendimento/compra (≠ agradecimento/despedida educada) ─────────────
// Usado pelo guard "não encerrar lead QUALIFICADO": o silêncio (transferir_silencioso) só se preserva
// quando o lead REALMENTE recusou. "Grata!"/"obrigado"/"ok" de um lead engajado NÃO é recusa — esse vai
// pro vendedor ANUNCIANDO. Caso real lead 99603-7979 ("Grata!" → o agente encerrou um lead quente).
export function leadExplicitlyDeclined(message?: string | null): boolean {
  const t = normalizePlannerText(message);
  if (!t) return false;
  return /\b(nao quero|nao tenho interesse|nao to interessad|nao estou interessad|desisti|deixa pra la|deixa quieto|so (estava|tava|to) (olhando|pesquisando|vendo|dando uma olhada)|nao precisa|nao vou (querer|levar|comprar|fechar)|mudei de ideia|perdi o interesse|nao da|nao rola|nao curti|nao gostei)\b/.test(t);
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
  // MODELO NOMEADO vence a heurística de "busca ampla" (lead 99758-5303): o lead pediu "Onix plus sedan",
  // o planner extraiu modelo_desejado="Chevrolet Onix" certinho, MAS leadMessageAsksBroadStock viu a palavra
  // "sedan" e marcou broad -> as linhas abaixo APAGAVAM o modelo -> devolvia sedans aleatórios (Focus/Ka/
  // Cronos) com "Temos sim!". Se há MODELO nomeado (plano/intent), NÃO é busca ampla de tipo. O stock_broad
  // EXPLÍCITO do planner (categoria, v134) já vem com modelo_desejado=null -> não é afetado por este guard.
  const _modelTokenAsType = vehicleTypeFromTypeWord(brainPlan?.search_query || brainPlan?.search_filters?.modelo_desejado || intent?.extracted?.interesse?.modelo_desejado);
  const _hasNamedModel = !_modelTokenAsType && Boolean(brainPlan?.search_query || brainPlan?.search_filters?.modelo_desejado || intent?.extracted?.interesse?.modelo_desejado);
  const _moreOptionsFollowup = leadAsksForMoreOptions(options?.lead_message);
  const broadStock = !_marcaRequired && !_hasNamedModel && Boolean(_modelTokenAsType || brainPlan?.search_filters?.stock_broad || leadMessageAsksBroadStock(options?.lead_message) || _moreOptionsFollowup);
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
    if (_modelTokenAsType) {
      filters.tipo_veiculo = filters.tipo_veiculo || _modelTokenAsType;
      if (["suv", "sedan", "hatch", "pickup"].includes(String(filters.tipo_veiculo))) {
        filters.body_type = filters.body_type || filters.tipo_veiculo;
      }
    }
    if (_moreOptionsFollowup) {
      const _memInterest: any = memory?.interesse || {};
      filters.tipo_veiculo = filters.tipo_veiculo || _memInterest.tipo_veiculo || null;
      filters.preco_max = filters.preco_max || _memInterest.preco_max || null;
      filters.preco_min = filters.preco_min || _memInterest.preco_min || null;
      filters.ano_min = filters.ano_min || _memInterest.ano_min || null;
      filters.ano_max = filters.ano_max || _memInterest.ano_max || null;
      filters.cambio = filters.cambio || _memInterest.cambio || null;
      if (filters.tipo_veiculo && ["suv", "sedan", "hatch", "pickup"].includes(String(filters.tipo_veiculo))) {
        filters.body_type = filters.body_type || filters.tipo_veiculo;
      }
    }
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
  if (adHasVehicle && filters.preco_max && !explicitBudget && !_moreOptionsFollowup) {
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
