// ============================================================================
// CAMADA DE VERIFICAÇÃO PRÉ-ENVIO (Chain-of-Verification) — pega a "besteira" antes de chegar ao lead.
// ----------------------------------------------------------------------------
// Best-practice nº1 de confiabilidade (Microsoft AI Foundry, etc.): o agente CHECA a própria resposta
// antes de mandar. Consolida num lugar só os invariantes que estavam espalhados (trava do "não temos",
// re-âncora de foto, "promete e não cumpre"). PURO -> testável offline ($0). Extensível: cada novo
// "erro bobo" vira mais um check aqui, com 1 teste — em vez de remendo no orchestrator (whack-a-mole).
// O orchestrator roda verifyReplyText ANTES de enviar, LOGA as violações (eval-driven) e corrige.
// ============================================================================
import { normalizePlannerText, replyDeniesAvailability } from "./decisionLogic.ts";

export type ReplyViolation = { type: string; detail?: string };

export function verifyReplyText(replyText?: string | null, ctx?: {
  mediaCount?: number;          // fotos REALMENTE anexadas nesta resposta
  searchedThisTurn?: boolean;   // rodou busca de estoque neste turno
  hasVehicleSignal?: boolean;   // o lead nomeou/referenciou um veículo
  rejeitadosModelos?: string[]; // modelos que o lead JÁ recusou
}): ReplyViolation[] {
  const t = normalizePlannerText(replyText);
  const out: ReplyViolation[] = [];
  if (!t) return out;
  const c = ctx || {};

  const photoWord = /\b(foto|fotos|fts|imagem|imagens)\b/.test(t);
  const promiseSendVerb = /\b(vou|irei|ja vou|vou ja)\s+(te\s+)?(enviar|mandar|providenciar|verificar e (enviar|mandar)|confirmar e (enviar|mandar)|garantir que.*(enviad|sejam enviad))\b/.test(t);

  // 1) PROMETE ENVIAR FOTO mas NÃO anexou mídia (caso Bárbara: "vou verificar e enviar as corretas" + 0 fotos).
  //    Se mídia foi anexada (mediaCount>0), está ENVIANDO -> ok.
  if ((c.mediaCount || 0) === 0 && photoWord && promiseSendVerb) out.push({ type: "promise_undelivered_media" });

  // 2) PROMETE RETORNO ASSÍNCRONO em 1ª pessoa ("vou verificar e te retorno/aviso") — o agente NÃO tem
  //    como voltar depois. (NÃO casa "o consultor vai entrar em contato" = transferência legítima.)
  if (/\b(vou|irei|deixa eu)\s+(verificar|conferir|checar|confirmar|ver)\b[^.!?\n]{0,45}\b(e\s+(ja\s+)?(te\s+)?(retorno|aviso|falo|respondo|volto|envio|mando)|ja\s+(te\s+)?(retorno|aviso|falo|respondo|volto))\b/.test(t)) {
    out.push({ type: "promise_async_followup" });
  }

  // 3) NEGA disponibilidade sem ter BUSCADO (reforço da trava, no nível da resposta).
  if (c.hasVehicleSignal && !c.searchedThisTurn && replyDeniesAvailability(replyText)) out.push({ type: "denies_without_search" });

  // 4) RE-OFERECE um modelo que o lead REJEITOU.
  const rej = (c.rejeitadosModelos || []).map((s) => normalizePlannerText(s)).filter((s) => s.length >= 3);
  const hitRej = rej.find((mk) => new RegExp(`\\b${escapeRe(mk)}\\b`).test(t));
  if (hitRej) out.push({ type: "offers_rejected", detail: hitRej });

  return out;
}

function escapeRe(s: string): string { return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

// O reply cita ao menos UM dos veículos achados? Usado na apresentação de CATEGORIA: o modelo barato
// (gpt-4.1-mini) às vezes só saúda/pergunta rapport e IGNORA a lista — aí o orchestrator relista de
// forma determinística (decisão do dono v134: pediu TIPO + há vários => APRESENTA). PURO -> offline.
export function replyMentionsAnyVehicle(replyText?: string | null, vehicles?: Array<{ modelo?: any; marca?: any }> | null): boolean {
  const t = normalizePlannerText(replyText);
  if (!t || !Array.isArray(vehicles) || vehicles.length === 0) return false;
  for (const v of vehicles) {
    const modeloTokens = normalizePlannerText(String(v?.modelo || "")).split(/\s+/).filter((w) => w.length >= 3);
    if (modeloTokens.some((tok) => new RegExp(`\\b${escapeRe(tok)}\\b`).test(t))) return true;
    const marca = normalizePlannerText(String(v?.marca || ""));
    if (marca.length >= 3 && new RegExp(`\\b${escapeRe(marca)}\\b`).test(t)) return true;
  }
  return false;
}
