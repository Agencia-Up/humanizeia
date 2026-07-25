// ============================================================================
// fuel.ts — COMBUSTÍVEL como FATO tipado (F2.79 / missão P0, prioridade 2). PURO: sem I/O, sem rede.
//
// INCIDENTE (smoke real Wa, 24/07): o agente respondeu "não temos outra SUV diesel mais barata"
// tendo executado apenas `stock_search {tipo:"suv"}`. Não havia como provar diesel nem a ausência
// dele: `fuelName` existia no feed mas MORRIA no adapter (VehicleFact não carregava combustível) e
// o único filtro de propulsão era o booleano `hibrido`. Afirmação de ausência sem filtro aplicado.
//
// CONTRATO: valor CANÔNICO fechado + tabela ORDENADA de padrões (nunca uma cadeia de `if` por valor;
// adicionar GNV é UMA linha aqui + UMA no enum, sem tocar engine/adapter/prompt). Cru irreconhecível
// => null = DESCONHECIDO. NUNCA existe default: ausência de dado jamais vira "não é X".
// ============================================================================

export const FUEL_KINDS = ["diesel", "flex", "gasolina", "etanol", "hibrido", "eletrico"] as const;
export type FuelKind = (typeof FUEL_KINDS)[number];

export function isFuelKind(value: unknown): value is FuelKind {
  return typeof value === "string" && (FUEL_KINDS as readonly string[]).includes(value);
}

// Normalização idêntica à do stock-normalizer (minúsculas, NFD sem acento, "-"/"/" viram espaço).
function normalizeFuelText(raw: string): string {
  return raw.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[-/]+/g, " ").replace(/\s+/g, " ").trim();
}

// ORDEM IMPORTA: híbrido antes de elétrico e de gasolina ("híbrido flex"/"híbrido elétrico" é HÍBRIDO);
// elétrico antes de gasolina; flex antes de etanol/gasolina ("álcool e gasolina" é FLEX, não etanol).
const FUEL_PATTERNS: readonly (readonly [FuelKind, RegExp])[] = [
  ["hibrido", /\b(?:hibrid\w*|hybrid\w*|hev|phev|mhev)\b/],
  ["eletrico", /\b(?:eletric\w*|electric\w*|ev|bev)\b/],
  ["diesel", /\bdiesel\b/],
  ["flex", /\b(?:flex\w*|bicombust\w*|total\s*flex|alcool\s+e\s+gasolina|gasolina\s+e\s+alcool)\b/],
  ["etanol", /\b(?:etanol|ethanol|alcool)\b/],
  ["gasolina", /\bgasolina\b/],
];

// Combustível CANÔNICO a partir do texto cru do feed (BNDV `fuelName` / RevendaMais `fuel`).
// null = DESCONHECIDO (vazio, "GNV", "Gás Natural", lixo). Nunca chuta.
export function canonicalFuel(raw: string | null | undefined): FuelKind | null {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  const text = normalizeFuelText(raw);
  if (text === "") return null;
  for (const [kind, rx] of FUEL_PATTERNS) if (rx.test(text)) return kind;
  return null;
}

// Rótulo humano do combustível (texto de recuperação honesta: "Não achei SUV diesel até 90 mil").
const FUEL_LABELS: Readonly<Record<FuelKind, string>> = {
  diesel: "diesel", flex: "flex", gasolina: "gasolina", etanol: "etanol", hibrido: "híbrido", eletrico: "elétrico",
};
export function fuelLabel(kind: FuelKind): string { return FUEL_LABELS[kind]; }

// ⭐EXTRAÇÃO CONSERVADORA da preferência de combustível. O resultado pode enriquecer uma
// chamada proposta pela LLM, mas nunca autoriza a chamada. Trechos negados ou com mais de
// uma propulsão positiva ficam sem constraint determinístico: nesses casos a decisão tipada
// da LLM é a autoridade, em vez de o engine escolher uma opção pelo lead.
export function detectFuelIntent(block: string): FuelKind | null {
  if (typeof block !== "string" || block.trim() === "") return null;
  const clauses = normalizeFuelText(block)
    .split(/[,;.!?]+|\b(?:mas|porem|contudo|e\s+sim)\b/)
    .map((part) => part.trim())
    .filter(Boolean);
  const positive = new Set<FuelKind>();
  for (const clause of clauses) {
    // Se a polaridade do trecho é negativa, omitir é mais seguro do que injetar
    // exatamente o combustível recusado. A LLM ainda recebe o bloco integral.
    if (/\b(?:nao|sem|exceto|menos)\b/.test(clause)) continue;
    const matched = FUEL_PATTERNS.filter(([, rx]) => rx.test(clause)).map(([kind]) => kind);
    if (matched.length === 0) continue;
    const compositeHybrid = /\b(?:hibrid\w*|hybrid\w*)\s+(?:flex\w*|eletric\w*|electric\w*)\b/.test(clause);
    const compositeFlex = /\b(?:bicombust\w*|total\s+flex|alcool\s+e\s+gasolina|gasolina\s+e\s+alcool)\b/.test(clause);
    if (compositeHybrid) positive.add("hibrido");
    else if (compositeFlex) positive.add("flex");
    else for (const kind of matched) positive.add(kind);
  }
  return positive.size === 1 ? [...positive][0] : null;
}

// ⭐COBERTURA (rodada 2 do Codex): a fonte sustenta uma afirmação de AUSÊNCIA desta dimensão?
// SÓ com cobertura INTEGRAL — `known === total` e `total > 0`. Maioria NÃO prova ausência: se 1 de 5
// veículos não informa o combustível, ESSE pode ser justamente o diesel procurado. Um limiar de 80%
// (a 1ª versão) era um FALSO VERDE factual. PURO/testável.
export function fuelCoverageSupportsAbsence(known: number, total: number): boolean {
  return total > 0 && known === total;
}
