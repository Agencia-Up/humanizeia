/**
 * grounding.ts — VALIDADOR DE GROUNDING (Pilar A, anti-alucinação).
 *
 * Compara o que a RESPOSTA do agente AFIRMA contra os FATOS REAIS do estoque (stock.facts),
 * de forma DETERMINISTICA (sem LLM). Pega:
 *   R1 negacao de TIPO falsa   ("nao temos picape" tendo picapes)
 *   R2 negacao de MODELO falsa ("nao temos onix" tendo Onix)
 *   R3 negacao MARCA+TIPO falsa("nao temos picape Fiat" tendo Fiat Toro)  <- caso real Jose Anisio
 *   R5 disponibilidade INVENTADA ("temos o Compass" sem ter Compass nos fatos)
 *
 * Precisao > recall: so acusa quando o negado COMPROVADAMENTE existe nos fatos, e PULA negacao
 * qualificada por ano/motor/versao (ex.: "nao temos o Onix 2015" tendo so 2017 = honesto).
 */

export interface GroundingViolation { rule: "R1" | "R2" | "R3" | "R5" | "R6"; subject: string; detail?: string; }

// Extrai PREÇOS de VEÍCULO afirmados no texto (R$ 73.990,00 / R$ 73 mil / "por 50 mil"). EXCLUI faixas
// de ORÇAMENTO do lead ("até 50 mil", "faixa de R$ 35.000") — essas não são preço de carro, são teto.
// Usado pela R6 (preço inventado): caso real Civic R$73.990 virou R$50.000 (deflacionado pro orçamento).
export function extractVehiclePriceClaims(text: string): number[] {
  let t = String(text || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  // remove faixas de orçamento (teto do lead) ANTES de extrair — não são preço de veículo.
  t = t.replace(/\b(ate|faixa(\s+de)?|orcamento|dentro\s+d\w+|no\s+maximo|maximo\s+de?|abaixo\s+de|a?\s*partir\s+de)\s*(de\s*)?(r\$\s*)?[\d.]+\s*(mil|reais)?/g, " ");
  const out: number[] = [];
  let m: RegExpExecArray | null;
  const re1 = /r\$\s*([\d][\d.]*)(?:\s*,\s*\d{2})?/g;
  while ((m = re1.exec(t)) !== null) {
    const n = Number(String(m[1]).replace(/\./g, ""));
    if (Number.isFinite(n) && n >= 5000) out.push(n); // preço de carro >= 5 mil (ignora "R$ 0", anos)
  }
  const re2 = /\b(\d{1,3})\s*mil\b/g;
  while ((m = re2.exec(t)) !== null) {
    const n = Number(m[1]) * 1000;
    if (n >= 5000) out.push(n);
  }
  return out;
}

const norm = (s: string) =>
  String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();

// Tipos + sinonimos
const TYPE_WORDS: Record<string, string[]> = {
  pickup: ["picape", "picapes", "pickup", "caminhonete", "camionete"],
  suv: ["suv", "suvs", "utilitario"],
  hatch: ["hatch", "hatchback", "hatches"],
  sedan: ["sedan", "sedans", "seda"],
  moto: ["moto", "motos", "motocicleta"],
};
const TYPE_OF_WORD: Record<string, string> = {};
for (const [type, words] of Object.entries(TYPE_WORDS)) for (const w of words) TYPE_OF_WORD[w] = type;

// Modelos conhecidos (pra R2/R5 nao acusar palavras genericas). Conjunto estavel.
const MODEL_TOKENS = new Set([
  "onix", "gol", "hb20", "hb20s", "polo", "argo", "mobi", "kwid", "sandero", "march", "up", "fox", "fit",
  "207", "208", "2008", "3008", "5008", "punto", "celta", "ka", "fiesta", "picanto", "i30", "golf",
  "virtus", "cronos", "versa", "prisma", "voyage", "siena", "cobalt", "logan", "sentra", "corolla", "civic",
  "city", "jetta", "cruze", "accent", "elantra",
  "compass", "renegade", "creta", "kicks", "hrv", "wrv", "tracker", "tcross", "nivus", "fastback", "pulse",
  "tiggo", "sw4", "ecosport", "duster", "asx", "pajero", "captur", "territory", "taos", "tiguan", "rav4",
  "kona", "sportage", "tucson", "outlander", "trailblazer", "aircross", "commander",
  "toro", "strada", "hilux", "s10", "ranger", "amarok", "frontier", "triton", "l200", "saveiro", "montana",
  "oroch", "maverick", "hoggar", "courier", "dakota",
]);

// Classifica o TIPO de um veiculo do estoque pelo texto (marca/modelo/versao).
function vehicleType(v: any): string | null {
  const t = norm(`${v?.marca || ""} ${v?.modelo || ""} ${v?.versao || ""}`);
  if (/\b(hilux|s10|ranger|amarok|toro|frontier|triton|l200|strada|saveiro|montana|oroch|maverick|hoggar|courier|dakota|picape|pickup|cabine dupla|cabine simples)\b/.test(t)) return "pickup";
  if (/\b(compass|renegade|creta|kicks|hrv|wrv|wr v|tracker|tcross|t cross|nivus|fastback|pulse|tiggo|sw4|ecosport|duster|asx|pajero|2008|3008|5008|aircross|captur|territory|taos|tiguan|rav4|kona|sportage|tucson|outlander|trailblazer|commander|suv)\b/.test(t)) return "suv";
  if (/\b(virtus|cronos|versa|prisma|voyage|siena|cobalt|logan|sentra|corolla|civic|city|jetta|cruze|accent|elantra|sedan)\b/.test(t)) return "sedan";
  if (/\b(onix|gol|hb20|polo|argo|mobi|kwid|march|sandero|up|fox|fit|208|207|punto|celta|ka|fiesta|picanto|i30|golf|hatch)\b/.test(t)) return "hatch";
  return null;
}

const factText = (v: any) => norm(`${v?.marca || ""} ${v?.modelo || ""} ${v?.versao || ""}`);
const factsHaveType = (facts: any[], type: string) => facts.some((f) => vehicleType(f) === type);
const factsHaveModel = (facts: any[], token: string) => facts.some((f) => new RegExp(`\\b${token}\\b`).test(factText(f)));
const factsHaveBrand = (facts: any[], brand: string) => facts.some((f) => norm(f?.marca || "").includes(brand));

// Negacao qualificada por ANO/MOTOR/VERSAO -> negacao legitima (pula). Ex.: "nao temos o Onix 2015".
function hasDisqualifier(subject: string): boolean {
  return /\b((19|20)\d{2}|[12]\s?[.,]?\s?[0468]\b|turbo|diesel|flex|gnv|aut|automatico|manual|completo|4x4|cabine simples)\b/.test(subject);
}

const NEG_CUE = /\b(nao\s+(temos|tem|ha|possuimos|dispomos|trabalhamos\s+com)|infelizmente\s+nao\s+(temos|tem)|no\s+momento\s+nao\s+(temos|tem)|atualmente\s+nao\s+(temos|tem))\b/;

export function validateGrounding(text: string, facts: any[]): { ok: boolean; violations: GroundingViolation[] } {
  const violations: GroundingViolation[] = [];
  if (!Array.isArray(facts) || facts.length === 0) return { ok: true, violations };
  // sentenca a sentenca (mantem limite por frase; corta tambem em "mas/porem" = mudanca de sentido).
  // Protege decimais/separadores ("2.0", "159.990") pra o ponto NAO quebrar a frase e perder o
  // qualificador de motor/preco (senao "nao temos picape 2.0 diesel" virava "...picape 2" -> falso R1).
  const sentences = String(text || "").replace(/(\d)[.,](\d)/g, "$1 $2").split(/[.!?\n]+|\bmas\b|\bporem\b|\bporém\b/i);

  for (const raw of sentences) {
    const s = norm(raw);
    if (!s) continue;

    // ── NEGACOES (R1/R2/R3) ──
    const negMatch = s.match(NEG_CUE);
    if (negMatch && typeof negMatch.index === "number") {
      const subject = s.slice(negMatch.index + negMatch[0].length).trim();
      if (subject && !hasDisqualifier(subject)) {
        const subjTokens = subject.split(/\s+/);
        const negType = subjTokens.map((w) => TYPE_OF_WORD[w]).find(Boolean) || null;
        const negModels = subjTokens.filter((w) => MODEL_TOKENS.has(w));
        // marca citada na negacao (so as que existem no estoque, pra casar R3)
        const negBrand = ["fiat", "chevrolet", "volkswagen", "vw", "renault", "ford", "toyota", "honda", "hyundai", "nissan", "jeep", "peugeot", "citroen", "mitsubishi", "caoa", "chery"].find((b) => new RegExp(`\\b${b}\\b`).test(subject)) || null;

        // R3: marca + tipo, ambos presentes nos fatos
        if (negBrand && negType && facts.some((f) => norm(f?.marca || "").includes(negBrand === "vw" ? "volks" : negBrand) && vehicleType(f) === negType)) {
          violations.push({ rule: "R3", subject, detail: `${negBrand} ${negType}` });
        } else if (negType && factsHaveType(facts, negType)) {
          // R1: tipo presente nos fatos
          violations.push({ rule: "R1", subject, detail: negType });
        }
        // R2: modelo presente nos fatos
        for (const m of negModels) {
          if (factsHaveModel(facts, m)) violations.push({ rule: "R2", subject, detail: m });
        }
      }
    }

    // ── R5: disponibilidade INVENTADA ("temos o <modelo>" mas o modelo NAO esta nos fatos) ──
    if (/\b(temos|temos\s+(o|a|um|uma)|tem\s+(o|a|um|uma))\b/.test(s) && !NEG_CUE.test(s)) {
      const claimed = s.split(/\s+/).filter((w) => MODEL_TOKENS.has(w));
      for (const m of claimed) {
        if (!factsHaveModel(facts, m)) violations.push({ rule: "R5", subject: m, detail: `modelo afirmado sem estar nos fatos` });
      }
    }
  }
  // ── R6: PREÇO inventado (valor de veículo citado NÃO bate com NENHUM preço real do estoque) ──
  // Pega o caso GRAVE dos prints: Civic real R$73.990 virou R$50.000, S10 R$91.990 virou R$59.000 — o
  // LLM deflaciona o preço pro orçamento do lead. Tolerância 2% (ou R$500) absorve arredondamento ("74
  // mil" p/ 73.990) mas pega fabricação (50k vs 73.990 = 32% fora). Preço de veículo é o número MAIS
  // crítico — errar destrói a confiança e cria problema comercial.
  const realPrices = facts.map((f) => Number(f?.preco)).filter((n) => Number.isFinite(n) && n > 0);
  if (realPrices.length > 0) {
    const claimSeen = new Set<number>();
    for (const claim of extractVehiclePriceClaims(text)) {
      if (claimSeen.has(claim)) continue;
      claimSeen.add(claim);
      const grounded = realPrices.some((rp) => Math.abs(rp - claim) <= Math.max(500, rp * 0.02));
      if (!grounded) violations.push({ rule: "R6", subject: String(claim), detail: `R$ ${claim.toLocaleString("pt-BR")}` });
    }
  }

  // dedup por (rule+detail)
  const seen = new Set<string>();
  const uniq = violations.filter((v) => { const k = `${v.rule}:${v.detail}`; if (seen.has(k)) return false; seen.add(k); return true; });
  return { ok: uniq.length === 0, violations: uniq };
}

// Instrucao corretiva pra REGERAR a resposta (1x), apontando o erro + os fatos reais.
export function buildGroundingCorrection(violations: GroundingViolation[], facts: any[]): string {
  const neg = violations.filter((v) => v.rule !== "R5" && v.rule !== "R6").map((v) => v.detail).filter(Boolean);
  const inv = violations.filter((v) => v.rule === "R5").map((v) => v.detail || v.subject);
  const badPrices = violations.filter((v) => v.rule === "R6").map((v) => v.detail || v.subject);
  const list = facts.slice(0, 6).map((f, i) => `${i + 1}. ${[f.marca, f.modelo, f.ano].filter(Boolean).join(" ")}${Number(f.preco) > 0 ? ` por R$ ${Number(f.preco).toLocaleString("pt-BR")}` : ""}`).join("\n");
  const parts = [
    "CORRECAO OBRIGATORIA (sua resposta anterior contradisse o estoque real):",
  ];
  if (neg.length) parts.push(`- Voce disse que NAO temos [${neg.join(", ")}], mas TEMOS sim no estoque abaixo. NUNCA negue isso.`);
  if (inv.length) parts.push(`- Voce afirmou ter [${inv.join(", ")}] que NAO esta no estoque. NAO cite veiculo que nao esteja na lista.`);
  if (badPrices.length) parts.push(`- Voce citou o(s) preco(s) [${badPrices.join(", ")}] que NAO existe(m) no estoque. PROIBIDO inventar ou ajustar preco pro orcamento do lead: use EXATAMENTE o preco real de cada veiculo da lista abaixo, mesmo que fique acima do que o lead pediu.`);
  parts.push("Reescreva a resposta APRESENTANDO POSITIVAMENTE estes veiculos REAIS (e SOMENTE estes), curto e natural, terminando com uma pergunta que avanca (oferecer fotos / qual interessa):");
  parts.push(list);
  parts.push("Responda APENAS o JSON pedido, com o texto corrigido em 'text'.");
  return parts.join("\n");
}

// Fallback DETERMINISTICO garantido (quando ate a regeneracao falha): monta do proprio estoque.
export function groundedFallback(facts: any[]): string {
  const top = facts.slice(0, 3).map((f) => {
    const label = [f.marca, f.modelo, f.ano].filter(Boolean).join(" ");
    return Number(f.preco) > 0 ? `${label} por R$ ${Number(f.preco).toLocaleString("pt-BR")}` : label;
  }).filter(Boolean);
  if (top.length === 0) return "Deixa eu confirmar certinho as opções no nosso estoque e já te falo. 😊";
  return `Temos sim opções aqui! Por exemplo: ${top.join("; ")}. Quer ver fotos ou mais detalhes de algum deles? 😊`;
}
