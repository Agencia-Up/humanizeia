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

// ── "VOU BUSCAR..." E SOME: deferir a busca que JÁ rodou neste turno (lead 99747-0573 "Palio") ───────
// O agente respondeu "Vou buscar/verificar a disponibilidade do X pra você" e NÃO apresentou nada — o
// resultado da busca já existe AGORA, nunca há "depois". Backstop: troca pela apresentação real (ou
// "não tenho X, mas tenho parecidos"). NÃO casa "vou confirmar com a equipe" (deferral LEGÍTIMO de dúvida).
export function replyDefersSearch(replyText?: string | null): boolean {
  const t = normalizePlannerText(replyText);
  if (!t) return false;
  const defer = /\b(vou|irei|ja vou|vou ja|deixa eu|vamos)\s+(buscar|procurar|verificar|conferir|checar|pesquisar|consultar|levantar|olhar)\b/.test(t);
  if (!defer) return false;
  const aboutSearch = /\b(informac|disponib|no estoque|no nosso estoque|opcoes|opcao|na faixa|faixa de|sobre o|sobre a|do |da )\b/.test(t)
    && !/\b(com (a |o )?(equipe|time|consultor|vendedor|especialista)|com (o )?nosso)\b/.test(t);
  const hasRealData = /(r\$\s*\d|\bkm\b|\b(19|20)\d{2}\b)/.test(t); // se já cita preço/ano real, não é mera promessa vazia
  return aboutSearch && !hasRealData;
}

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

// O reply OFERECE/promete fotos? (caso real dos prints: ofereceu "quer ver fotos?" e o carro estava
// "em preparação" = images_count 0 -> teve que voltar atrás. Backstop: se NENHUM veículo do turno tem
// foto, troca a oferta por detalhes/visita — NÃO oferece o que não pode entregar.) PURO -> offline.
export function replyOffersPhotos(replyText?: string | null): boolean {
  const t = normalizePlannerText(replyText);
  if (!t || !/\bfotos?\b/.test(t)) return false;
  return /\b(quer ver|quer (que eu )?(mande|envie|mostre|veja)|posso (te )?(mandar|enviar|mostrar)|gostaria de ver|te (envio|mando)|mando as|envio as|ver as fotos|fotos dele|fotos desse|fotos de algum)\b/.test(t);
}

// Remove a(s) frase(s) de OFERTA DE FOTO e troca por CTA de detalhes/visita (quando o veículo não tem
// foto cadastrada). Mantém o resto da resposta (apresentação do carro). Determinístico.
export function rewriteUnavailablePhotoOffer(replyText?: string | null): { text: string; changed: boolean } {
  const raw = String(replyText || "");
  if (!replyOffersPhotos(raw)) return { text: raw, changed: false };
  const parts = raw.split(/(?<=[.!?\n])/);
  const kept = parts.filter((p) => !(/\bfotos?\b/i.test(p) && /\b(quer|posso|gostaria|envio|mando|mandar|enviar|mostrar|ver)\b/i.test(p)) && p.trim().length > 0);
  const cta = "As fotos desse ainda não estão no sistema, mas posso te passar todos os detalhes ou agendar uma visita pra você ver pessoalmente — o que prefere? 😊";
  const text = `${kept.join(" ").replace(/\s+/g, " ").trim()} ${cta}`.trim();
  return { text, changed: true };
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

// ── AFIRMAÇÕES NÃO-ATERRADAS NO PROMPT (garantia de fábrica, laudo cautelar, etc.) ──────────────────
// Decisão do dono: o agente SÓ pode afirmar o que está no PROMPT da loja (ou stock.facts); pra dúvidas
// sem resposta ali, NUNCA inventa nem nega — diz que confirma com a equipe (e a dúvida vai pro briefing).
// Caso real (lead 98861-9201): afirmou "garantia de FÁBRICA" (o prompt diz "até 3 meses, não superior")
// e "temos LAUDO cautelar" (nada no prompt). PROMPT-AWARE: se o prompt da loja MENCIONA o termo, libera
// (loja que tem laudo no prompt pode afirmar); se NÃO menciona, é invenção -> neutraliza. Extensível.
export function detectUngroundedClaims(replyText?: string | null, agentPrompt?: string | null): string[] {
  const t = normalizePlannerText(replyText);
  const p = normalizePlannerText(agentPrompt);
  if (!t) return [];
  const out: string[] = [];
  // LAUDO/VISTORIA cautelar: qualquer afirmação sobre laudo que o prompt da loja NÃO menciona.
  if (/\b(laudo|cautelar|vistoria|vistoriad[oa])\b/.test(t) && !/\b(laudo|cautelar|vistoria)\b/.test(p)) out.push("laudo");
  // GARANTIA DE FÁBRICA/FABRICANTE/MONTADORA: só pode afirmar se o prompt mencionar (senão a garantia da
  // loja é a do prompt — ex.: "3 meses" — e "de fábrica" é invenção que extrapola a política).
  if (/\bgarantia\b/.test(t) && /\b(fabrica|fabricante|montadora|de fabrica|do fabricante)\b/.test(t) && !/\b(fabrica|fabricante|montadora)\b/.test(p)) out.push("garantia_fabrica");
  return out;
}

// ── ANTI-VAZAMENTO DE IDENTIDADE / QUEBRA DE PERSONA (segurança contra manipulação) ─────────────────
// O agente é o consultor (humano) da loja. NUNCA pode revelar que é IA/bot/modelo, nem "sair do papel"
// se o lead tentar manipular ("qual IA você é?", "ignore as instruções", "aja como..."). Caso real lead
// 98861-9201: perguntou "Qual ia você é?" (se saiu bem, mas precisa ser robusto a má intenção). Backstop:
// se a resposta VAZAR que é IA/bot/modelo → troca pela deflexão de persona. PURO -> offline.
export function detectAiIdentityLeak(replyText?: string | null): boolean {
  const t = normalizePlannerText(replyText);
  if (!t) return false;
  return /\bsou\s+(uma?\s+)?(ia|i\.?a|intelig[eê]?ncia artificial|assistente virtual|assistente de ia|bot|chat ?bot|rob[oôō]|modelo de linguagem|agente virtual|chatgpt|gpt)\b/.test(t)
    || /\b(modelo de linguagem|intelig[eê]ncia artificial|assistente virtual|fui (criad[oa]|treinad[oa]|desenvolvid[oa]|programad[oa])|nao sou (humano|uma pessoa|real|de verdade|gente)|sou (um|uma) (programa|software|sistema)|openai|chat ?gpt|gpt-?\d)\b/.test(t);
}

export function neutralizeAiIdentityLeak(replyText?: string | null, agentName?: string | null): { text: string; changed: boolean } {
  const raw = String(replyText || "");
  if (!detectAiIdentityLeak(raw)) return { text: raw, changed: false };
  const nm = (agentName && String(agentName).trim()) || "";
  const intro = nm ? `Sou o ${nm}, consultor aqui da loja` : "Sou consultor aqui da loja";
  return { text: `${intro} 😊 Como posso te ajudar com o carro que você procura?`, changed: true };
}

const _CLAIM_LABEL: Record<string, string> = {
  laudo: "o laudo/vistoria do veículo",
  garantia_fabrica: "a garantia",
};

// Tira a(s) frase(s) com afirmação não-aterrada e troca por "vou confirmar com a equipe de vendas"
// (comportamento que o dono pediu: não inventa, não nega, encaminha a dúvida). PURO -> offline.
export function neutralizeUngroundedClaims(replyText?: string | null, agentPrompt?: string | null): { text: string; neutralized: boolean; hits: string[] } {
  const raw = String(replyText || "");
  const hits = detectUngroundedClaims(raw, agentPrompt);
  if (hits.length === 0 || !raw.trim()) return { text: raw, neutralized: false, hits };
  const parts = raw.split(/(?<=[.!?\n])/);
  const kept = parts.filter((p) => detectUngroundedClaims(p, agentPrompt).length === 0 && p.trim().length > 0);
  const label = Array.from(new Set(hits.map((h) => _CLAIM_LABEL[h] || "essa informação"))).join(" e ");
  const confirm = `Sobre ${label}, vou confirmar certinho com a nossa equipe de vendas pra te passar a informação correta, tá? 😊`;
  const text = `${kept.join(" ").replace(/\s+/g, " ").trim()} ${confirm}`.trim();
  return { text, neutralized: true, hits };
}
