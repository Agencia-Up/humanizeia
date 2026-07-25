// ============================================================================
// fuel-claims.ts — INTERPRETAÇÃO TIPADA do que a RESPOSTA afirma sobre COMBUSTÍVEL (F2.79, rodada 3 do Codex).
//
// DEFEITO CORRIGIDO: a 1ª POL-FUEL-ABSENCE tratava QUALQUER "não" perto de um combustível como afirmação de
// ausência de ESTOQUE, e só aceitava prova de escopo GLOBAL. Isso gerava DOIS falsos bloqueios reais:
//   "Não consegui confirmar se esses carros são diesel."  -> não afirma estoque; é NÃO-VERIFICAÇÃO honesta.
//   "Não encontrei SUV diesel nessa faixa."               -> ausência VERDADEIRA no recorte pesquisado.
//
// CONTRATO — tipado, nunca por frase:
//  1. TIPO da afirmação. A negação em português escopa à DIREITA e liga no predicado MAIS PRÓXIMO. Basta então
//     classificar esse predicado por CLASSE (duas tabelas do domínio, como `canonicalFuel`):
//       EXISTENCIAL (ter/haver/existir/dispor/encontrar/restar/vender/estoque/disponível) -> `inventory_absence`
//       EPISTÊMICO  (conseguir/poder/saber/confirmar/verificar/garantir/certeza/informação) -> `attribute_unverified`
//     `attribute_unverified` NUNCA exige prova: dizer que não confirmou é exatamente o ato honesto que a policy quer.
//  2. ESCOPO da afirmação. Os RESTRITORES nomeados na própria frase, extraídos pelo MESMO detector comercial que
//     alimenta a busca (marca/modelo/tipo/preço/ano/câmbio) + retomada ANAFÓRICA do recorte ("nessa faixa", "desse
//     valor", "outra"). Sem nenhum restritor => afirmação GLOBAL.
//  3. AUTORIZAÇÃO por CONTENÇÃO DE CONJUNTOS. A busca provou vazio no recorte F; a frase afirma vazio no recorte R.
//     A frase só é verdadeira se R ⊆ F. Condição verificável: para CADA restrição de F, ou a frase declara valor
//     CONTIDO nela (igual no discreto, teto menor-ou-igual, anos subconjunto), ou ela OMITE a dimensão e a anáfora
//     a herda. Restritor a mais só ESTREITA (R∩x ⊆ R), então é sempre seguro.
//     ⭐A anáfora herda só o OMITIDO — nunca apaga ou alarga o que a frase DECLAROU (rodada 4 do Codex: "até 120 mil
//     nessa faixa" continua afirmando 120 mil e não é sustentado por uma prova de 90 mil).
//     Corolário automático, sem regra própria: prova RESTRITA nunca autoriza a frase GLOBAL (R=∅ não contém F≠∅);
//     prova GLOBAL autoriza qualquer recorte (se não existe nenhum diesel, não existe SUV diesel nessa faixa).
// PURO: sem I/O. Toda a semântica vive aqui; a policy só compara e nega.
// ============================================================================
import type { ClaimExtractor } from "../domain/decision.ts";
import type { FrameSignals } from "../domain/agent-brain.ts";
import type { FuelKind } from "../domain/fuel.ts";
import { canonicalFuel, fuelLabel } from "../domain/fuel.ts";
import type { CommercialConstraints } from "./commercial-constraints.ts";
import { activeConstraintsFromStockInput, canonicalBrand, describeConstraints, detectCommercialConstraints } from "./commercial-constraints.ts";
import { canonicalModel, normalizeText } from "./catalog-utils.ts";

export type FuelClaimKind = "inventory_absence" | "attribute_unverified";
export type FuelClaimScope = "global" | "restricted";

export type FuelClaim = {
  readonly fuel: FuelKind;
  readonly kind: FuelClaimKind;
  readonly scope: FuelClaimScope;
  /** Dimensões comerciais nomeadas na PRÓPRIA frase (o recorte que ela afirma). */
  readonly restrictors: CommercialConstraints;
  /** A frase retoma o recorte ativo por referência ("nessa faixa", "desse valor", "outra"). */
  readonly anaphoric: boolean;
  readonly clause: string;
};

// ── Léxico do domínio (tabelas, não cadeias de `if`) ─────────────────────────────────────────────
// NEGADOR próprio: escopa à direita ("não temos diesel"). O combustível precisa estar DENTRO desse escopo, senão
// "esse diesel não tem teto solar" viraria falsa afirmação de ausência (a negação ali é sobre o teto).
const NEGATOR_RX = /^(?:nao|nem|nunca|jamais|sem|nenhum|nenhuma|nenhuns|nenhumas)$/;
// AUTO-NEGATIVO: o próprio predicado já nega a existência e o combustível é seu SUJEITO ("diesel esgotado").
const SELF_NEGATIVE_RX = /^(?:indisponivel|indisponiveis|esgotad\w*|inexistente|inexistentes|acabou|acabaram|zerad\w*)$/;
// ⭐PREPOSIÇÃO DE ADJUNTO: marca que o sintagma do combustível MODIFICA outra coisa em vez de ser o argumento do
// predicado — "o teto solar está indisponível NESSE diesel", "a garantia DOS carros diesel". Sem isso o predicado
// auto-negativo grudava em qualquer combustível da cláusula. Não entram aqui "com"/"a" (argumento do verbo:
// "não trabalhamos COM elétrico", "carro A diesel").
const ADJUNCT_PREP_RX = /^(?:em|no|na|nos|nas|ness[ae]s?|nest[ae]s?|do|da|dos|das|dess[ae]s?|dest[ae]s?|pel[oa]s?)$/;
// Núcleo de ESTOQUE: "estoque DE diesel esgotado" continua sendo afirmação sobre o estoque de diesel.
const STOCK_HEAD_RX = /^(?:estoque|estoques|disponibilidade|unidade|unidades|opcao|opcoes)$/;
// EXISTENCIAL: a negação fala do ESTOQUE.
const EXISTENTIAL_RX = /^(?:tem|temos|tenho|ter|tinha|tinham|tinhamos|tiver|tivemos|teve|possui|possuem|possuo|possuimos|ha|havia|houve|haviam|havera|existe|existem|existia|existiam|existir|dispomos|dispoe|dispoem|disponho|dispor|encontr\w*|ach\w*|localiz\w*|resta|restam|restou|restaram|restante|restantes|sobrou|sobra|sobram|sobraram|trabalh\w*|vend\w*|ofere\w*|estoque|disponivel|disponiveis|disponibilidade|indisponivel|indisponiveis|esgotad\w*|inexistente|inexistentes|acabou|acabaram|zerad\w*)$/;
// EPISTÊMICO: a negação fala da CAPACIDADE DE VERIFICAR do próprio agente (verbos E substantivos).
const EPISTEMIC_RX = /^(?:consegu\w*|consig\w*|posso|possa|possamos|pode|podemos|podia|podiamos|poderia|poderiamos|pud\w*|sei|sabe|sabemos|sabia|saber|soube|confirm\w*|verific\w*|chec\w*|garant\w*|assegur\w*|identific\w*|constat\w*|certeza|confirmacao|informacao|informacoes|dado|dados|acesso|visibilidade|clareza|ideia|nocao)$/;
// Retomada ANAFÓRICA do recorte em discussão: demonstrativo + substantivo de ESCOPO, ou dêitico de subconjunto.
const ANAPHORIC_RX = /\b(?:ness[ae]s?|dess[ae]s?|nest[ae]s?|dest[ae]s?|ess[ae]s?|est[ae]s?)\s+(?:faixa|faixas|valor|valores|preco|precos|orcamento|perfil|criterio|criterios|condicao|condicoes|configuracao|especificacao|recorte|busca|filtro|filtros|categoria|linha|selecao)\b|\b(?:outr[oa]s?|demais|restantes?)\b|\b(?:dentro|abaixo|acima|alem)\s+(?:diss[eo]|dess[ae]s?)\b/;

const NEUTRAL_SIGNALS: FrameSignals = {
  mentionsPhoto: false, mentionsStore: false, mentionsMoreOptions: false,
  mentionsVehicleType: null, isMemoryQuestion: false, relation: "ambiguous",
};

// A negação liga no predicado mais próximo à sua direita. Exceção tipada: um EXISTENCIAL cujo complemento imediato
// é EPISTÊMICO continua epistêmico ("não tenho certeza", "não temos como confirmar") — é o objeto que decide.
function predicateFrom(tokens: readonly string[], from: number): { kind: FuelClaimKind; index: number } | null {
  for (let i = from; i < tokens.length; i++) {
    const token = tokens[i];
    if (EPISTEMIC_RX.test(token)) return { kind: "attribute_unverified", index: i };
    if (EXISTENTIAL_RX.test(token)) {
      for (let j = i + 1; j <= i + 2 && j < tokens.length; j++) if (EPISTEMIC_RX.test(tokens[j])) return { kind: "attribute_unverified", index: i };
      return { kind: "inventory_absence", index: i };
    }
  }
  return null;
}

// ⭐O combustível é o ARGUMENTO do predicado (e não o modificador de outra coisa)? Duas checagens sintáticas, sem
// nenhuma frase específica: (1) não há preposição de adjunto ENTRE o combustível e o predicado — "não temos teto
// solar NESSE diesel"; (2) o sintagma do combustível não está ele mesmo dentro de um adjunto — "a garantia DOS
// carros diesel está indisponível". Exceção: núcleo de estoque ("estoque DE diesel esgotado") continua ligado.
function fuelIsArgumentOfPredicate(tokens: readonly string[], fuelIdx: number, predIdx: number): boolean {
  const lo = Math.min(fuelIdx, predIdx) + 1, hi = Math.max(fuelIdx, predIdx);
  for (let i = lo; i < hi; i++) if (ADJUNCT_PREP_RX.test(tokens[i])) return false;
  // A 2ª checagem só cabe quando o combustível está ANTES do predicado (posição de sujeito): aí a preposição que o
  // subordina fica à esquerda dele. Depois do predicado, o trecho entre os dois já foi varrido acima — varrer o
  // início da cláusula ali pegaria adjuntos de outro constituinte ("NO momento não temos SUV diesel").
  if (fuelIdx < predIdx) {
    for (let i = fuelIdx - 1; i >= 0; i--) {
      if (!ADJUNCT_PREP_RX.test(tokens[i])) continue;
      return tokens.slice(0, i).some((t) => STOCK_HEAD_RX.test(t));
    }
  }
  return true;
}

function firstFuelIndex(tokens: readonly string[], from: number, to: number): number {
  for (let i = Math.max(0, from); i < Math.min(to, tokens.length); i++) if (canonicalFuel(tokens[i]) != null) return i;
  return -1;
}

function hasAnyRestrictor(c: CommercialConstraints): boolean {
  return c.marca != null || (c.modelos?.length ?? 0) > 0 || c.tipo != null
    || c.precoMax != null || c.cambio != null || c.popular === true || (c.anos?.length ?? 0) > 0;
}

/**
 * Classifica TODAS as afirmações sobre combustível do texto — uma por cláusula que negue dentro do escopo do
 * combustível. Cláusula sem predicado reconhecido não gera afirmação (a frase não fala de estoque nem de verificação).
 */
export function classifyFuelClaims(text: string, claimExtractor: ClaimExtractor, splitClauses: (t: string) => string[]): FuelClaim[] {
  const claims: FuelClaim[] = [];
  for (const clause of splitClauses(text)) {
    const normalized = normalizeText(clause);
    const tokens = normalized.split(/\s+/).filter(Boolean);
    const negIdx = tokens.findIndex((t) => NEGATOR_RX.test(t));
    const selfIdx = tokens.findIndex((t) => SELF_NEGATIVE_RX.test(t));
    if (negIdx < 0 && selfIdx < 0) continue;
    // Com negador próprio, o combustível precisa estar DENTRO do escopo da negação (à direita dela). Sem negador,
    // o predicado auto-negativo predica sobre o SUJEITO, que em português vem ANTES dele ("diesel esgotado") —
    // por isso "o teto solar está indisponível nesse diesel" não fala do estoque de diesel.
    const predicate = negIdx >= 0 ? predicateFrom(tokens, negIdx) : { kind: "inventory_absence" as const, index: selfIdx };
    if (predicate == null) continue;
    const fuelIdx = negIdx >= 0 ? firstFuelIndex(tokens, negIdx + 1, tokens.length) : firstFuelIndex(tokens, 0, selfIdx);
    if (fuelIdx < 0) continue;
    const fuel = canonicalFuel(tokens[fuelIdx]);
    if (fuel == null) continue;
    const kind = predicate.kind;
    // A ligação sujeito↔predicado só é exigida da afirmação de ESTOQUE: é ela que precisa de prova factual.
    if (kind === "inventory_absence" && !fuelIsArgumentOfPredicate(tokens, fuelIdx, predicate.index)) continue;
    const detected = detectCommercialConstraints({ block: clause, signals: NEUTRAL_SIGNALS, claimExtractor });
    const { combustivel: _own, ...restrictors } = detected;   // a própria dimensão do claim não é restritor
    const anaphoric = ANAPHORIC_RX.test(normalized);
    claims.push({
      fuel, kind, restrictors,
      scope: hasAnyRestrictor(restrictors) || anaphoric ? "restricted" : "global",
      anaphoric, clause,
    });
  }
  return claims;
}

// ── Autorização por contenção de conjuntos ───────────────────────────────────────────────────────
export type FuelAbsenceEvidence = {
  readonly filtersUsed: Record<string, unknown>;
  readonly absenceScope: FuelClaimScope;
};

const DISCRETE_DIMS = ["marca", "tipo", "cambio"] as const;
type DiscreteDim = (typeof DISCRETE_DIMS)[number];

function discreteValue(c: CommercialConstraints, dim: DiscreteDim): string | null {
  if (dim === "marca") return c.marca != null ? canonicalBrand(c.marca) : null;
  if (dim === "tipo") return c.tipo ?? null;
  return c.cambio ?? null;
}
function modelsOf(c: CommercialConstraints): string[] {
  return (c.modelos ?? []).map((m) => canonicalModel(m)).filter((m) => m.length > 0);
}

/**
 * A prova (busca vazia com `absenceAssertable`) sustenta ESTA afirmação? Retorna `null` quando autoriza, ou a razão
 * factual da recusa (vai no feedback para a LLM reescrever — o engine nunca redige a resposta comercial).
 */
export function absenceEvidenceAuthorizesClaim(claim: FuelClaim, evidence: FuelAbsenceEvidence): string | null {
  const proof = activeConstraintsFromStockInput(evidence.filtersUsed);
  const claimModels = modelsOf(claim.restrictors);
  const proofModels = modelsOf(proof);
  // Duas listas com destinos DIFERENTES, e é aí que mora a correção da rodada 4:
  //  `omitted`  = dimensão da prova que a frase NÃO menciona   -> a anáfora ("nessa faixa") pode herdar.
  //  `wider`    = dimensão que a frase MENCIONA e que EXTRAPOLA a prova -> NADA preenche, nem anáfora. Dizer
  //               "até 120 mil nessa faixa" continua afirmando 120 mil; uma prova de 90 mil não sustenta isso.
  const omitted: string[] = [];
  const wider: string[] = [];

  for (const dim of DISCRETE_DIMS) {
    const proofValue = discreteValue(proof, dim);
    if (proofValue == null) continue;
    const claimValue = discreteValue(claim.restrictors, dim);
    if (claimValue == null) omitted.push(`${dim}=${proofValue}`);
    else if (claimValue !== proofValue) wider.push(`${dim}='${claimValue}' fora do que a busca filtrou (${dim}='${proofValue}')`);
  }
  if (proofModels.length > 0) {
    if (claimModels.length === 0) omitted.push(`modelo=${proof.modelos?.join(" ou ")}`);
    else if (!claimModels.every((m) => proofModels.includes(m))) wider.push(`modelo fora do que a busca filtrou (buscado: ${proof.modelos?.join(" ou ")})`);
  }
  if (proof.precoMax != null) {
    if (claim.restrictors.precoMax == null) omitted.push(`precoMax=${proof.precoMax}`);
    else if (claim.restrictors.precoMax > proof.precoMax) wider.push(`teto de preço ${claim.restrictors.precoMax} acima do pesquisado (${proof.precoMax})`);
  }
  if ((proof.anos?.length ?? 0) > 0) {
    if ((claim.restrictors.anos?.length ?? 0) === 0) omitted.push(`anos=${proof.anos?.join("/")}`);
    else if (!claim.restrictors.anos!.every((y) => proof.anos!.includes(y))) wider.push(`ano(s) ${claim.restrictors.anos?.join("/")} fora do que a busca filtrou (${proof.anos?.join("/")})`);
  }
  if (proof.popular === true && claim.restrictors.popular !== true) omitted.push("popular");
  if (Array.isArray(evidence.filtersUsed.excludeKeys) && (evidence.filtersUsed.excludeKeys as unknown[]).length > 0) omitted.push("exclusões da busca anterior");

  if (wider.length > 0) return `a frase afirma ${wider.join("; ")}`;
  if (omitted.length > 0 && !claim.anaphoric) {
    return `a busca provou ausência apenas no recorte [${describeConstraints(proof) || "—"}] e a frase não declara nem retoma ${omitted.join(", ")}`;
  }
  return null;
}

/** Provas de ausência DESTE combustível produzidas NESTE turno (busca que aplicou o filtro e declarou cobertura). */
export function fuelAbsenceEvidenceFor(
  facts: ReadonlyArray<{ readonly ok: boolean; readonly tool: string; readonly data?: unknown }>,
  kind: FuelKind,
): FuelAbsenceEvidence[] {
  const out: FuelAbsenceEvidence[] = [];
  for (const fact of facts) {
    if (!fact.ok || fact.tool !== "stock_search") continue;
    const data = fact.data as { filtersUsed?: Record<string, unknown>; absenceAssertable?: unknown; absenceScope?: unknown } | undefined;
    if (!data || data.absenceAssertable !== true) continue;
    if (data.filtersUsed?.combustivel !== kind) continue;
    out.push({ filtersUsed: data.filtersUsed ?? {}, absenceScope: data.absenceScope === "global" ? "global" : "restricted" });
  }
  return out;
}

/** Feedback do deny: factual, com as SAÍDAS possíveis por TIPO de afirmação — nunca uma frase pronta para copiar. */
export function fuelAbsenceDenyReason(claim: FuelClaim, reason: string): string {
  const label = fuelLabel(claim.fuel);
  const scope = claim.scope === "global"
    ? "GLOBAL (a frase não limita marca, modelo, tipo, ano, câmbio nem faixa de preço)"
    : `restrito a [${describeConstraints(claim.restrictors) || "recorte retomado por referência"}]`;
  return `afirma AUSÊNCIA de '${label}' em escopo ${scope} sem prova neste turno: ${reason}. `
    + `Saídas: (a) rodar stock_search com combustivel='${claim.fuel}' cobrindo exatamente o recorte que você vai afirmar; `
    + `(b) limitar a afirmação ao recorte realmente pesquisado; (c) declarar que não conseguiu confirmar o combustível.`;
}
