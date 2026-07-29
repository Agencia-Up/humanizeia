// ============================================================================
// operational-context.ts — CONTEXTO OPERACIONAL VERIFICADO (25/07). PURO: sem I/O, sem rede, sem texto imperativo.
//
// PARA QUE EXISTE: a engine precisa DIZER O QUE SABE sem DIZER O QUE FAZER. Antes, o que a engine sabia só chegava
// à LLM na forma de deny DEPOIS da resposta ("não temos prova de diesel", "isso é promessa sem mecanismo") — e um
// engine que lê a frase do agente para decidir se gostou dela é um engine que conduz. Passa a viajar como DADO
// TIPADO no TurnFrame, antes da geração, e a LLM interpreta.
//
// REGRAS DESTE MÓDULO:
//   • Só DADO. Nenhum campo é frase, recomendação ou instrução. Nada aqui manda perguntar, oferecer, dizer ou conduzir.
//   • Só FATO ESTRUTURADO: resultado real de tool executada + capacidade real do turno + o que o anúncio declarou.
//   • Nada de marca, modelo, intenção comercial ou caso específico. O contrato é o mesmo para qualquer veículo.
//   • RECALCULADO A CADA PASSO do cérebro: um contexto congelado antes da busca continuaria dizendo que o estoque
//     não foi consultado, e isso seria mentira estrutural.
//   • O prompt do portal segue sendo a autoridade sobre conversa, qualificação e funil. Isto aqui não compete com ele.
// ============================================================================
import type { QueryResult } from "./decision.ts";
import type { VehicleFact } from "./types.ts";
import type { ActiveSearchConstraints } from "./conversation-state.ts";

/** Estado da consulta de estoque NESTE turno. `not_queried` = a tool não rodou (não é "não existe"). */
export type StockQueryStatus = "not_queried" | "queried" | "failed";

export type StockRuntimeFacts = {
  readonly status: StockQueryStatus;
  /** Filtros REALMENTE aplicados pela tool (o que foi enviado, não o que se pretendia). */
  readonly filtersApplied: Readonly<Record<string, string | number | boolean | readonly string[] | readonly number[]>>;
  /** `global` = catálogo inteiro; `restricted` = só o recorte filtrado. Fora do recorte não há informação. */
  readonly scope: "global" | "restricted" | null;
  readonly resultCount: number;
  /** Chaves aterradas retornadas — a única origem legítima de uma vehicleKey. */
  readonly vehicleKeys: readonly string[];
  /** Encontrados pelo modelo-base quando a versão exata não existe (identidade relacionada, não equivalente). */
  readonly familyCandidateKeys: readonly string[];
  /** Dimensões que a fonte NÃO informa para todo o universo consultado: nem confirmável, nem descartável. */
  readonly unverifiableDimensions: readonly string[];
};

/**
 * O que este turno consegue EXECUTAR de fato. `false` aqui significa que o ato não acontece — não que é proibido falar.
 * ⭐As três constantes abaixo são DISTINTAS de propósito: dizer "não existe follow-up" seria MENTIRA (o worker
 * T1/T2/T3 existe e roda). O que não existe é mecanismo para o AGENTE cumprir uma promessa feita nesta conversa.
 */
/**
 * Memoria factual de busca entre turnos. Ela informa o recorte que estava ativo
 * e quais veiculos ja foram mostrados; nao escolhe nem executa a proxima busca.
 * A LLM continua responsavel por declarar explicitamente os filtros da nova
 * chamada de stock_search.
 */
export type StockSearchMemoryFacts = {
  readonly activeFilters: Readonly<ActiveSearchConstraints>;
  readonly shownVehicleKeys: readonly string[];
};

export type RuntimeCapabilities = {
  readonly sendMessage: boolean;
  /**
   * Disponibilidade OPERACIONAL de mídia ∩ tool de fotos permitida ao perfil. `null` = não informado a este turno.
   * ⚠️NÃO derivar de `ProviderCapability` (idempotent|queryable|none): aquilo descreve reconciliação do efeito, não
   * disponibilidade. Em produção o root passa "none" e a mídia sai normalmente — usar aquele campo aqui diria
   * `false` para agentes que ENVIAM foto, e a LLM deixaria de mandar por acreditar num fato falso.
   */
  readonly sendMedia: boolean | null;
  readonly handoff: boolean;
  /** Não existe reserva de horário executável no sistema. Constante estrutural. */
  readonly appointmentBooking: false;
  /** Não existe tarefa de "verificar depois e responder": nada re-consulta um fato após o turno. */
  readonly deferredFactCheckTask: false;
  /**
   * Não existe TAREFA INDIVIDUAL de "eu verifico e te retorno" criada por esta conversa.
   * ⚠️NÃO significa que o agente nunca mais fala: o follow-up comercial T1/T2/T3 é OUTRO mecanismo, independente,
   * e segue ativo. Uma versão anterior chamava isto de `agentAsyncReturn:false` e o prompt dizia "você não volta
   * sozinho a esta conversa" — afirmação FALSA com o worker T1/T2/T3 ligado.
   */
  readonly individualDeferredCallbackTask: false;
  /**
   * Follow-up comercial automatizado (worker T1/T2/T3) — VALOR REAL da configuração do tenant.
   * `null` = a configuração não foi informada a este turno (desconhecido; NUNCA presumir false).
   * É cadência comercial da plataforma, NÃO um canal para o agente cumprir promessa individual.
   */
  readonly automatedLeadFollowupEnabled: boolean | null;
};

/**
 * Anúncio de origem. ⭐SEPARAÇÃO EXIGIDA: `identity` é o que o anúncio DECLAROU (fato da conversa — o lead chegou
 * por ele e pode ser mencionado); `inventoryConfirmed` só vira true depois de uma consulta que retornou a chave.
 * Identidade declarada nunca é disponibilidade confirmada.
 */
export type AdRuntimeFacts = {
  readonly identity: string | null;
  readonly confidence: number | null;
  readonly vehicleKey: string | null;
  readonly inventoryConfirmed: boolean;
};

export type OperationalContext = {
  readonly stock: StockRuntimeFacts;
  readonly searchMemory: StockSearchMemoryFacts;
  readonly capabilities: RuntimeCapabilities;
  readonly ad: AdRuntimeFacts;
};

/** Structured identity declared by the ad. Taxonomy extraction lives in ad-context; proof evaluation stays pure here. */
export type AdIdentityTarget = {
  readonly identity: string;
  readonly marca: string | null;
  readonly modelo: string;
  readonly ano: number | null;
  /** Terms beyond brand/base-model/year that identify the advertised trim/version. */
  readonly variantTokens: readonly string[];
};

/**
 * ⭐EIXO 1 — EXISTÊNCIA. Estar aqui significa só isto: o veículo existe e pode ser citado/fotografado.
 * NÃO diz nada sobre ser a versão anunciada. Foto, detalhe e oferta anterior alimentam SÓ este eixo.
 */
export type GroundedVehicleRef = {
  readonly vehicleKey: string;
  readonly marca?: string | null;
  readonly modelo?: string | null;
  readonly versao?: string | null;
  readonly ano?: number | null;
  readonly referenceable: true;
};

/**
 * ⭐EIXO 2 — IDENTIDADE DO ANÚNCIO. Ortogonal ao primeiro: nunca um ranking entre os dois (ranking sempre acabava
 * promovendo "família + foto" a confirmação). A prova é do ANÚNCIO, não da chave — presa a `adFingerprint` e à
 * busca que a produziu. Sem isso, prova de um anúncio confirmaria outro anúncio do mesmo veículo depois.
 */
export type AdIdentityProofLevel = "family_only" | "exact_for_ad";
export type AdIdentityProof = {
  readonly vehicleKey: string;
  readonly adFingerprint: string;
  readonly searchFingerprint: string;
  readonly level: AdIdentityProofLevel;
};

function norm(s: string): string {
  // Provider feeds and ad vision describe the same trim with harmless formatting differences:
  // `LIMITED+`/`LIMITED PLUS`, `V6`/`V 6` and `4x4`/`4 X 4`. This normalization is restricted
  // to structured vehicle identity; assistant prose never participates in factual proof.
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\+/g, " plus ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\bv\s+(\d{1,2})\b/g, "v$1")
    .replace(/\b(\d)\s+x\s+(\d)\b/g, "$1x$2");
}

function tokens(value: string | null | undefined): string[] {
  return norm(value ?? "").split(" ").filter(Boolean);
}

/** Identidade do anúncio como chave estável. Vazio = sem anúncio (nada a provar). */
export function adFingerprintOf(ad: { readonly adId?: string | null; readonly identity: string | null }): string {
  const id = (ad.identity ?? "").trim();
  return id === "" ? "" : `${ad.adId ?? ""}|${norm(id)}`;
}

function modelFiltersOf(filtersUsed: Record<string, unknown> | undefined): string[] {
  const out: string[] = [];
  const m = filtersUsed?.modelo;
  if (typeof m === "string" && m.trim()) out.push(m);
  const ms = filtersUsed?.modelos;
  if (Array.isArray(ms)) for (const x of ms) if (typeof x === "string" && x.trim()) out.push(x);
  return out;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => [k, stableValue(v)]));
  }
  return value;
}

export function stockSearchProofFingerprint(filtersUsed: Record<string, unknown> | undefined): string {
  return JSON.stringify(stableValue(filtersUsed ?? {}));
}

function filterTargetsAd(filtersUsed: Record<string, unknown> | undefined, target: AdIdentityTarget): boolean {
  const models = modelFiltersOf(filtersUsed);
  if (models.length === 0) return false;
  // A base model scopes the query. Trim/version is proven by the returned provider fact below, never by trusting
  // the requested filter itself. This lets an ad query for "Compass" prove "Compass Limited" only when the item
  // really carries Limited in `versao`, while a base-only HB20 fact can never prove Confort Plus.
  const required = new Set(tokens(target.modelo));
  const modelMatches = models.some((m) => {
    const got = new Set(tokens(m));
    return [...required].every((t) => got.has(t));
  });
  if (!modelMatches) return false;
  if (target.ano == null) return true;
  const years = filtersUsed?.anos;
  return Array.isArray(years) && years.some((y) => Number(y) === target.ano);
}

function factMatchesAdIdentity(fact: VehicleFact, target: AdIdentityTarget): boolean {
  if (target.marca && norm(fact.marca) !== norm(target.marca)) return false;
  if (norm(fact.modelo) !== norm(target.modelo)) return false;
  if (target.ano != null && fact.ano !== target.ano) return false;
  if (target.variantTokens.length === 0) return true;
  // Version comes from the provider feed. Structured attributes may complete a label such as "Diesel 4x4",
  // but no free-form assistant text participates in proof.
  const factual = new Set(tokens([
    fact.modelo, fact.versao, fact.combustivelLabel, fact.combustivel, fact.cambio,
  ].filter(Boolean).join(" ")));
  return target.variantTokens.every((t) => factual.has(t));
}

export type AdIdentityProofEvaluation = {
  readonly status: "not_observed" | "exact" | "family_only" | "ambiguous" | "none";
  readonly proof: AdIdentityProof | null;
};

/**
 * Deriva a prova DESTE turno. `exact_for_ad` só nasce de uma busca escopada ao modelo/ano do anúncio que voltou
 * UMA única chave cujo fato estruturado confirma também os tokens de versão. Mais de uma chave = ambíguo (sem
 * prova). Candidato de família = `family_only`. Texto livre da resposta nunca participa dessa prova.
 */
export function evaluateAdIdentityProof(input: {
  readonly adFingerprint: string;
  readonly target: AdIdentityTarget | null;
  readonly facts: readonly QueryResult[];
}): AdIdentityProofEvaluation {
  if (!input.adFingerprint || !input.target) return { status: "not_observed", proof: null };
  const exactKeys = new Set<string>();
  const familyKeys = new Set<string>();
  const fingerprints = new Set<string>();
  let targetedSearchObserved = false;
  for (const f of input.facts) {
    if (!f.ok || f.tool !== "stock_search") continue;
    const filtersUsed = f.data.filtersUsed as Record<string, unknown> | undefined;
    if (!filterTargetsAd(filtersUsed, input.target)) continue;
    targetedSearchObserved = true;
    fingerprints.add(stockSearchProofFingerprint(filtersUsed));
    for (const item of f.data.items) if (factMatchesAdIdentity(item, input.target)) exactKeys.add(item.vehicleKey);
    for (const item of f.data.familyCandidates ?? []) {
      if (norm(item.modelo) === norm(input.target.modelo) && (input.target.ano == null || item.ano === input.target.ano)) {
        familyKeys.add(item.vehicleKey);
      }
    }
  }
  const searchFingerprint = [...fingerprints].sort().join("||");
  if (exactKeys.size > 1) return { status: "ambiguous", proof: null };
  if (exactKeys.size === 1) {
    const vehicleKey = [...exactKeys][0];
    return { status: "exact", proof: { vehicleKey, adFingerprint: input.adFingerprint, searchFingerprint, level: "exact_for_ad" } };
  }
  if (familyKeys.size > 0) {
    const vehicleKey = [...familyKeys].sort()[0];
    return { status: "family_only", proof: { vehicleKey, adFingerprint: input.adFingerprint, searchFingerprint, level: "family_only" } };
  }
  return targetedSearchObserved ? { status: "none", proof: null } : { status: "not_observed", proof: null };
}

/** Compatibility helper for callers that only need the proof. New engine code must inspect evaluation.status. */
export function deriveAdIdentityProof(input: {
  readonly adFingerprint: string;
  readonly target: AdIdentityTarget | null;
  readonly facts: readonly QueryResult[];
}): AdIdentityProof | null {
  return evaluateAdIdentityProof(input).proof;
}

/** A prova só atravessa o turno se o ANÚNCIO for o mesmo. Anúncio novo/identidade diferente invalida. */
export function carryForwardProof(previous: AdIdentityProof | null | undefined, currentAdFingerprint: string): AdIdentityProof | null {
  if (!previous || !currentAdFingerprint) return null;
  return previous.adFingerprint === currentAdFingerprint ? previous : null;
}

/** Confirmação = prova EXATA para este anúncio + a chave ainda aterrada agora. A prova nunca inventa estoque. */
export function resolveAdConfirmation(input: {
  readonly proof: AdIdentityProof | null;
  readonly groundedKeys: readonly string[];
}): { readonly vehicleKey: string | null; readonly inventoryConfirmed: boolean } {
  const p = input.proof;
  const confirmed = p != null && p.level === "exact_for_ad" && input.groundedKeys.includes(p.vehicleKey);
  return { vehicleKey: confirmed ? p!.vehicleKey : null, inventoryConfirmed: confirmed };
}

/**
 * EIXO DE EXISTÊNCIA do frame. Reúne num único índice todas as chaves que realmente vieram de tools ou ofertas
 * estruturadas. Este índice permite citar/fotografar o veículo, mas NUNCA prova que ele corresponde à versão do
 * anúncio. A prova de identidade é ortogonal e nasce somente em `evaluateAdIdentityProof`.
 *
 * MERGE por chave: dado atual da tool enriquece/sobrescreve metadado antigo; uma resolução de foto, que só traz a
 * chave, nunca apaga marca/modelo/versão/ano já conhecidos.
 */
export function buildGroundedFleet(input: {
  readonly previousGroundedVehicles?: readonly GroundedVehicleRef[];
  readonly previousOfferItems: readonly { readonly vehicleKey: string; readonly marca?: string | null; readonly modelo?: string | null; readonly ano?: number | null }[];
  readonly facts: readonly QueryResult[];
}): GroundedVehicleRef[] {
  const byKey = new Map<string, { vehicleKey: string; marca: string | null; modelo: string | null; versao: string | null; ano: number | null; referenceable: true }>();
  const push = (vehicleKey: string, marca: string | null | undefined, modelo: string | null | undefined, versao: string | null | undefined, ano: number | null | undefined): void => {
    if (!vehicleKey) return;
    const prev = byKey.get(vehicleKey);
    if (!prev) { byKey.set(vehicleKey, { vehicleKey, marca: marca ?? null, modelo: modelo ?? null, versao: versao ?? null, ano: ano ?? null, referenceable: true }); return; }
    // Dado ATUAL vence metadado antigo; ausência (ex.: foto só com a chave) preserva o que já se sabia.
    prev.marca = marca ?? prev.marca;
    prev.modelo = modelo ?? prev.modelo;
    prev.versao = versao ?? prev.versao;
    prev.ano = ano ?? prev.ano;
  };
  for (const i of input.previousGroundedVehicles ?? []) push(i.vehicleKey, i.marca, i.modelo, i.versao, i.ano);
  for (const i of input.previousOfferItems) push(i.vehicleKey, i.marca, i.modelo, null, i.ano);
  for (const f of input.facts) {
    if (!f.ok) continue;
    if (f.tool === "stock_search") {
      for (const v of [...f.data.items, ...(f.data.familyCandidates ?? [])]) push(v.vehicleKey, v.marca, v.modelo, v.versao, v.ano);
    } else if (f.tool === "vehicle_details") {
      push(f.data.vehicle.vehicleKey, f.data.vehicle.marca, f.data.vehicle.modelo, f.data.vehicle.versao, f.data.vehicle.ano);
    } else if (f.tool === "vehicle_photos_resolve") {
      push(f.data.vehicleKey, null, null, null, null);
    }
  }
  return [...byKey.values()];
}

/**
 * Mantem a memoria factual limitada sem perder a chave do anuncio/foco atual.
 * A ordem nao tem semantica comercial; serve apenas para limitar o JSONB.
 */
export function compactGroundedFleet(
  fleet: readonly GroundedVehicleRef[],
  preferredKeys: readonly string[] = [],
  limit = 64,
): GroundedVehicleRef[] {
  if (limit <= 0) return [];
  const byKey = new Map(fleet.map((v) => [v.vehicleKey, v] as const));
  const preferred = [...new Set(preferredKeys)].flatMap((key) => {
    const v = byKey.get(key);
    return v ? [v] : [];
  });
  const preferredSet = new Set(preferred.map((v) => v.vehicleKey));
  const room = Math.max(0, limit - preferred.length);
  const recent = fleet.filter((v) => !preferredSet.has(v.vehicleKey)).slice(-room);
  return [...preferred.slice(0, limit), ...recent];
}

/**
 * Disponibilidade de mídia = rota operacional do root ∩ tool de fotos permitida ao perfil.
 * `null` quando o root não informou (desconhecido) — nunca `false` presumido. NÃO usa `ProviderCapability`.
 */
export function deriveSendMediaAvailability(input: {
  readonly mediaDeliveryAvailable: boolean | null | undefined;
  readonly photosToolAllowed: boolean;
}): boolean | null {
  if (input.mediaDeliveryAvailable == null) return null;
  return input.mediaDeliveryAvailable && input.photosToolAllowed;
}

function jsonScalars(input: Record<string, unknown> | undefined): StockRuntimeFacts["filtersApplied"] {
  const out: Record<string, string | number | boolean | readonly string[] | readonly number[]> = {};
  for (const [k, v] of Object.entries(input ?? {})) {
    if (v === undefined || v === null) continue;
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") out[k] = v;
    else if (Array.isArray(v) && v.every((x) => typeof x === "string")) out[k] = v as readonly string[];
    else if (Array.isArray(v) && v.every((x) => typeof x === "number")) out[k] = v as readonly number[];
  }
  return out;
}

/**
 * Deriva o contexto a partir dos FATOS já executados no turno + capacidades reais + anúncio. Chamado a CADA passo
 * do cérebro, com a lista de fatos daquele instante. PURO: mesma entrada, mesma saída.
 */
export function buildOperationalContext(input: {
  readonly facts: readonly QueryResult[];
  /**
   * Tools cuja EXECUÇÃO REAL falhou (adapter chamado e devolveu erro, ou estourou timeout). ⚠️NÃO inclui rejeição
   * de controle do engine (tool bloqueada por autoridade/policy/duplicata): aquilo não é falha da fonte, e dizer
   * `failed` ali faria a LLM acreditar que o estoque está fora do ar quando ele nem foi consultado.
   */
  readonly executionFailures: readonly string[];
  readonly capabilities: {
    readonly sendMessage: boolean;
    readonly sendMedia: boolean | null;
    readonly handoff: boolean;
    readonly automatedLeadFollowupEnabled: boolean | null;
  };
  /** Todas as chaves cuja existência está aterrada no frame atual. */
  readonly groundedVehicleKeys: readonly string[];
  /** Memoria persistida da busca anterior; contexto, nunca uma ordem de tool. */
  readonly searchMemory?: {
    readonly activeFilters?: Readonly<ActiveSearchConstraints> | null;
    readonly shownVehicleKeys?: readonly string[];
  };
  /** Chave confirmada por uma `AdIdentityProof` exata e ainda presente no eixo de existência. */
  readonly ad: { readonly identity: string | null; readonly confidence: number | null; readonly referenceKey: string | null };
}): OperationalContext {
  // Última busca EXECUTADA manda: é ela que descreve o recorte vigente do turno.
  const searches = input.facts.filter((f): f is Extract<QueryResult, { ok: true; tool: "stock_search" }> => f.ok && f.tool === "stock_search");
  const last = searches[searches.length - 1];
  const stockFailed = input.executionFailures.includes("stock_search")
    || input.facts.some((f) => !f.ok && f.tool === "stock_search");
  const stock: StockRuntimeFacts = last
    ? {
        status: "queried",
        filtersApplied: jsonScalars(last.data.filtersUsed as Record<string, unknown>),
        scope: last.data.absenceScope ?? null,
        resultCount: last.data.items.length,
        vehicleKeys: last.data.items.map((v) => v.vehicleKey),
        familyCandidateKeys: (last.data.familyCandidates ?? []).map((v) => v.vehicleKey),
        unverifiableDimensions: [...(last.data.unverifiableFilters ?? [])],
      }
    : {
        status: stockFailed ? "failed" : "not_queried",
        filtersApplied: {}, scope: null, resultCount: 0, vehicleKeys: [], familyCandidateKeys: [], unverifiableDimensions: [],
      };

  // `referenceKey` já chega comprovada pelo eixo de identidade. Aqui só se verifica se a mesma chave ainda existe
  // no eixo factual. Assim, nem contagem de resultados nem oferta/foto/detalhe conseguem promover uma versão.
  const groundedKeys = new Set<string>(input.groundedVehicleKeys);
  const adKey = input.ad.referenceKey != null && groundedKeys.has(input.ad.referenceKey) ? input.ad.referenceKey : null;

  return {
    stock,
    searchMemory: {
      activeFilters: { ...(input.searchMemory?.activeFilters ?? {}) },
      shownVehicleKeys: [...new Set((input.searchMemory?.shownVehicleKeys ?? [])
        .filter((key): key is string => typeof key === "string" && key.length > 0))],
    },
    capabilities: { ...input.capabilities, appointmentBooking: false, deferredFactCheckTask: false, individualDeferredCallbackTask: false },
    ad: {
      identity: input.ad.identity,
      confidence: input.ad.confidence,
      vehicleKey: adKey,
      inventoryConfirmed: adKey != null,
    },
  };
}
