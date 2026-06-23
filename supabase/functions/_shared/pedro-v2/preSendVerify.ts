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

// ── ANTI-ALUCINAÇÃO DE FICHA TÉCNICA (Solução D da análise Antigravity) ──────────────────────────────
// O estoque (BNDV/RevendaMais) NÃO traz consumo (km/l), potência (cv) nem litros (porta-malas/tanque).
// A regra "não invente" JÁ existe no prompt, mas o modelo barato (gpt-4.1-mini) às vezes a ignora e
// CRAVA um número (ex.: "faz 12 km/l", "tem 150cv") — destrói a confiança. Aqui detectamos o número de
// spec que NÃO está aterrado nos fatos do estoque e o orchestrator neutraliza ("confirmo com o time").
// PURO -> offline ($0). `factsText` = TEXTO descritivo do(s) veículo(s) real(is) (label/versão): se o
// número aparece lá (ex.: versão "1.0 TURBO 116CV"), está aterrado e NÃO é alucinação.
const _SPEC_PATTERNS: Array<{ key: string; re: string }> = [
  { key: "consumo", re: "(\\d{1,2}(?:[.,]\\d)?)\\s*(?:km\\s*\\/\\s*l|km por litro|km\\/litro|kml)" },
  { key: "potencia", re: "(\\d{2,3})\\s*(?:cv|cavalos|hp)\\b" },
  { key: "litros", re: "(\\d{2,3})\\s*litros\\b" },
];

export function detectUngroundedSpecs(replyText?: string | null, factsText?: string | null): string[] {
  const t = normalizePlannerText(replyText);
  const facts = normalizePlannerText(factsText);
  if (!t) return [];
  const out: string[] = [];
  for (const { key, re } of _SPEC_PATTERNS) {
    const rx = new RegExp(re, "g");
    let m: RegExpExecArray | null;
    while ((m = rx.exec(t)) !== null) {
      const num = m[1];
      // o número aparece no TEXTO real do veículo (versão/label)? então é dado REAL, não alucinação.
      // boundary só ANTES + não-seguido-de-dígito: casa "116" em "116CV" e "116 ", mas não em "1160".
      if (facts && new RegExp(`\\b${escapeRe(num)}(?!\\d)`).test(facts)) continue;
      out.push(`${key}:${num}`);
    }
  }
  return out;
}

const _SPEC_LABEL: Record<string, string> = {
  consumo: "o consumo (km/l)",
  potencia: "a potência (cavalos)",
  litros: "a capacidade exata em litros",
};

// Reescreve a resposta tirando a(s) FRASE(S) com spec inventada e acrescentando uma confirmação
// graciosa (mantém o resto: oferta, pergunta de foto). Determinístico -> nunca passa número mentiroso.
export function neutralizeUngroundedSpecs(replyText?: string | null, factsText?: string | null): { text: string; neutralized: boolean; hits: string[] } {
  const raw = String(replyText || "");
  const hits = detectUngroundedSpecs(raw, factsText);
  if (hits.length === 0 || !raw.trim()) return { text: raw, neutralized: false, hits };
  const kinds = Array.from(new Set(hits.map((h) => h.split(":")[0])));
  // quebra em frases preservando o delimitador; descarta as que têm spec não-aterrada.
  const parts = raw.split(/(?<=[.!?\n])/);
  const kept = parts.filter((p) => detectUngroundedSpecs(p, factsText).length === 0 && p.trim().length > 0);
  const label = kinds.map((k) => _SPEC_LABEL[k] || "esse dado técnico").join(" e ");
  const confirm = `Sobre ${label}, deixa eu confirmar certinho com o nosso time pra não te passar nada errado e já te falo! 😊`;
  const text = `${kept.join(" ").replace(/\s+/g, " ").trim()} ${confirm}`.trim();
  return { text, neutralized: true, hits };
}
