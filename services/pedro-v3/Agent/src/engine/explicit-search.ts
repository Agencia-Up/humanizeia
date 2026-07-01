// ============================================================================
// explicit-search.ts - F2.7.13. Invariante de PRIORIDADE DO TURNO ATUAL.
// Se a mensagem ATUAL tem intencao comercial explicita (marca/modelo/tipo/faixa), ela VENCE
// memoria antiga (slots.interesse, lastCommercialInterest, lastRenderedOfferContext). Handler
// DETERMINISTICO: roda stock_search do que o lead pediu AGORA e oferta (ancorado) OU responde
// honesto "nao encontrei X" - NUNCA cai no modelo/lista antiga.
//
// Importante: marcas/modelos vêm do TenantCatalog via ClaimExtractor. Nada hardcoded por marca.
// Memoria antiga so vale para referencia vaga (esse/dele/ordinal).
// ============================================================================
import type { ConversationState, RenderedOfferItem } from "../domain/conversation-state.ts";
import type { ClaimExtractor, DecisionMutation, ProposedDecision, QueryInputMap, TurnInterpretation } from "../domain/decision.ts";
import type { Id, VehicleFact, VehicleType } from "../domain/types.ts";
import type { QueryRunner, TurnOutput } from "./decision-engine.ts";
import { finalize } from "./finalizer.ts";
import { normalizeText, normalizedTermInText } from "./catalog-utils.ts";
import { renderVehicleOfferList } from "./vehicle-offer-render.ts";
import { VEHICLE_TAXONOMY } from "../adapters/read/vehicle-taxonomy.ts";

const TYPES = /\b(suvs?|hatchback|hatch|sedans?|pickups?|picapes?)\b/g;
const TYPE_MAP: Record<string, VehicleType> = { suv: "suv", suvs: "suv", hatch: "hatch", hatchback: "hatch", sedan: "sedan", sedans: "sedan", pickup: "pickup", pickups: "pickup", picape: "pickup", picapes: "pickup" };
// Referencia VAGA (pode herdar memoria): esse/dele/ordinal/foto. NAO e intencao comercial nova.
const REFERENCE_ONLY = /\besse\b|\bessa\b|\beste\b|\besta\b|\bdele\b|\bdela\b|\bdesse\b|\bprimeir|\bsegund|\bterceir|\bquart|\bquint|\bfotos?\b|\bimagens?\b|\bmais\b|\boutr/;

export type TurnFrame = {
  readonly explicitModels: string[];
  readonly explicitBrands: string[];
  readonly explicitTypes: VehicleType[];
  readonly budgetMax: number | null;
  readonly isNewCommercialIntent: boolean;
  readonly isReferenceOnly: boolean;
};

function collectClaims(text: string, claimExtractor: ClaimExtractor, interpretation?: TurnInterpretation | null): { models: string[]; brands: string[] } {
  const models: string[] = [];
  const brands: string[] = [];
  const seenModels = new Set<string>();
  const seenBrands = new Set<string>();

  for (const c of claimExtractor.extractClaims(text)) {
    if ((c.kind === "model" || c.kind === "brand_model") && !seenModels.has(c.normalized)) {
      seenModels.add(c.normalized);
      models.push(c.text);
    }
    if ((c.kind === "brand" || c.kind === "brand_model") && !seenBrands.has(c.normalized)) {
      seenBrands.add(c.normalized);
      brands.push(c.text);
    }
  }

  // Complemento seguro: a interpretacao pode apontar um modelo fora do catalogo atual.
  // So aceitamos se o termo aparece literalmente no texto do lead e contem letras.
  const entities = interpretation?.extractedEntities;
  for (const candidate of [entities?.model, ...(entities?.models ?? [])]) {
    const n = normalizeText(candidate ?? "");
    if (!/[a-z]/.test(n)) continue;
    if (!normalizedTermInText(text, n)) continue;
    if (!seenModels.has(n)) { seenModels.add(n); models.push(n); }
  }
  return { models, brands };
}

function parseBudget(norm: string): number | null {
  const mil = /\b(\d{1,3})\s*mil\b/.exec(norm);
  if (mil) return Number(mil[1]) * 1000;
  const reais = /\br?\$?\s*(\d{4,7})\b/.exec(norm);
  if (reais && /\bate\b|\br\$|\bfaixa\b|\bmaxim|\bteto\b/.test(norm)) return Number(reais[1]);
  return null;
}

// Frame DETERMINISTICO do turno atual (sem LLM). isNewCommercialIntent -> bloqueia memoria antiga.
export function computeTurnFrame(args: { leadMessage: string; claimExtractor: ClaimExtractor; interpretation?: TurnInterpretation | null }): TurnFrame {
  const { leadMessage, claimExtractor } = args;
  const norm = normalizeText(leadMessage);
  const claims = collectClaims(leadMessage, claimExtractor, args.interpretation);
  const explicitTypes = [...new Set((norm.match(TYPES) ?? []).map((t) => TYPE_MAP[t]).filter((x): x is VehicleType => !!x))];
  const budgetMax = parseBudget(norm);
  const isNewCommercialIntent = claims.models.length > 0 || claims.brands.length > 0 || explicitTypes.length > 0 || budgetMax != null;
  const isReferenceOnly = !isNewCommercialIntent && REFERENCE_ONLY.test(norm);
  return { explicitModels: claims.models, explicitBrands: claims.brands, explicitTypes, budgetMax, isNewCommercialIntent, isReferenceOnly };
}

export type ExplicitSearchResult =
  | { readonly kind: "offer"; readonly label: string; readonly vehicles: VehicleFact[]; readonly missingLabels: readonly string[]; readonly frame?: TurnFrame }
  | { readonly kind: "none"; readonly label: string; readonly frame?: TurnFrame };

type SearchTarget = {
  readonly label: string;
  readonly input: QueryInputMap["stock_search"];
  readonly fallbackInputs?: readonly QueryInputMap["stock_search"][];
};

function taxonomyModelInputsForType(type: VehicleType, budget: Partial<QueryInputMap["stock_search"]>): QueryInputMap["stock_search"][] {
  return VEHICLE_TAXONOMY
    .filter((entry) => entry.type === type)
    .map((entry) => ({ modelo: entry.model, ...budget }));
}

function buildTargets(frame: TurnFrame): SearchTarget[] {
  const budget = frame.budgetMax != null ? { precoMax: frame.budgetMax } : {};
  const tipo = frame.explicitTypes[0] ? { tipo: frame.explicitTypes[0] } : {};
  const withCommonFilters = (input: QueryInputMap["stock_search"]): QueryInputMap["stock_search"] => ({
    ...input,
    ...tipo,
    ...budget,
  });

  if (frame.explicitModels.length > 0) {
    return frame.explicitModels.map((model) => ({ label: model, input: withCommonFilters({ modelo: model }) }));
  }
  if (frame.explicitBrands.length > 0) {
    return frame.explicitBrands.map((brand) => ({ label: cap(brand), input: withCommonFilters({ modelo: brand }) }));
  }
  if (frame.explicitTypes.length > 0) {
    const type = frame.explicitTypes[0];
    return [{
      label: labelType(type),
      input: withCommonFilters({}),
      // Defesa contra feed/API mal classificado: se o filtro por tipo vier vazio,
      // expande pelo conhecimento automotivo canonico da planilha e busca modelos reais.
      fallbackInputs: taxonomyModelInputsForType(type, budget),
    }];
  }
  if (frame.budgetMax != null) {
    return [{ label: "nessa faixa de preco", input: { precoMax: frame.budgetMax, broad: true } }];
  }
  return [];
}

// null = nao e busca comercial nova -> deixa economy/continuity/LLM. Senao roda stock_search do turno ATUAL.
export async function resolveExplicitSearchIntent(args: {
  leadMessage: string; claimExtractor: ClaimExtractor; interpretation?: TurnInterpretation | null; runQuery: QueryRunner;
}): Promise<ExplicitSearchResult | null> {
  const { runQuery } = args;
  const frame = computeTurnFrame(args);
  if (!frame.isNewCommercialIntent) return null;
  const targets = buildTargets(frame);
  if (targets.length === 0) return null;

  const byKey = new Map<string, VehicleFact>();
  const missingLabels: string[] = [];
  const addVehicles = (items: readonly VehicleFact[]): number => {
    const valid = items.filter((v) => typeof v.preco === "number" && v.preco > 0);
    for (const vehicle of valid) {
      if (!byKey.has(vehicle.vehicleKey)) byKey.set(vehicle.vehicleKey, vehicle);
    }
    return valid.length;
  };
  const runStock = async (input: QueryInputMap["stock_search"]): Promise<readonly VehicleFact[]> => {
    const res = await runQuery({ tool: "stock_search", input });
    return res.ok && res.tool === "stock_search" ? res.data.items : [];
  };

  for (const target of targets) {
    let added = addVehicles(await runStock(target.input));
    if (added === 0 && target.fallbackInputs && target.fallbackInputs.length > 0) {
      for (const fallbackInput of target.fallbackInputs) {
        added += addVehicles(await runStock(fallbackInput));
      }
    }
    if (added === 0) missingLabels.push(target.label);
  }

  const vehicles = [...byKey.values()].sort((a, b) => a.preco - b.preco).slice(0, 5);
  const label = targets.map((t) => t.label).join(", ");
  // FIX A (revisado apos auditoria P1, 2026-07-01): NUNCA mostrar veiculo de tipo ERRADO como "opcao".
  // Antes, quando a busca por tipo zerava, um broad-rescue exibia C3/Gol como "opcoes que encaixam" p/ quem
  // pediu SUV — repetia a dor do veiculo aleatorio. E tambem nao se mente "nao tenho SUV". Agora, sem match
  // ATERRADO do tipo pedido -> `none` -> o handler faz uma pergunta HONESTA e condutiva (ampliar faixa /
  // outro tipo), SEM listar carro do tipo errado. Achar os SUV reais e papel da classificacao (Fix B).
  if (vehicles.length === 0) return { kind: "none", label, frame };
  return { kind: "offer", label, vehicles, missingLabels, frame };
}

const cap = (s: string): string => s.charAt(0).toLocaleUpperCase("pt-BR") + s.slice(1);
const labelType = (t: VehicleType): string => ({ suv: "SUV", hatch: "hatch", sedan: "sedan", pickup: "picape", unknown: "esse tipo" } as Record<string, string>)[t] ?? "esse tipo";

export function buildExplicitSearchTurnOutput(result: ExplicitSearchResult, turnId: Id): TurnOutput {
  // FIX C (2026-07-01): persiste a intencao explicita do turno nos slots (ver intentSlotMutations).
  // frame e opcional (compat: um caller pode montar o result a mao, sem frame) -> nesse caso, sem slots.
  const slotMuts = result.frame ? intentSlotMutations(result.frame, turnId) : [];

  if (result.kind === "none") {
    // Busca por TIPO sem match ATERRADO -> pergunta HONESTA e condutiva, SEM listar carro do tipo errado
    // (Finding 1 da auditoria) e SEM mentir "nao tenho SUV". Marca/modelo mantem a negacao verificavel.
    const text = result.frame && result.frame.explicitTypes.length > 0
      ? `No momento nao achei um ${result.label}${budgetPhrase(result.frame)} no nosso estoque. Quer que eu amplie a faixa de valor, ou prefere ver outro tipo (sedan, hatch, picape)?`
      : `No momento nao tenho ${result.label} no nosso estoque. Posso te mostrar opcoes parecidas - quer que eu filtre por preco, tipo (SUV, hatch, sedan) ou outra marca?`;
    return textTurn(turnId, text, "explicit_not_found", `Sem ${result.label} aterrado - honesto e condutivo, sem listar tipo errado.`, slotMuts);
  }

  const list = renderVehicleOfferList(result.vehicles, { maxItems: 5 });
  const items: RenderedOfferItem[] = result.vehicles.map((v, i) => ({ ordinal: i + 1, vehicleKey: v.vehicleKey, marca: v.marca ?? null, modelo: v.modelo ?? null, ano: v.ano ?? null }));

  const missing = result.missingLabels.length > 0
    ? `\n\nNao encontrei agora: ${result.missingLabels.join(", ")}.`
    : "";
  const text = `Encontrei estas opcoes pra voce:\n\n${list}${missing}\n\nQuer ver as fotos de algum desses ou prefere agendar uma visita?`;
  return { ...textTurn(turnId, text, "explicit_offer", `Oferta da busca explicita do turno (${result.label}), ancorada no estoque.`, slotMuts), renderedOfferContext: items };
}

function budgetPhrase(frame: TurnFrame | undefined): string {
  return frame?.budgetMax != null ? ` ate R$ ${frame.budgetMax.toLocaleString("pt-BR")}` : "";
}

// FIX C (2026-07-01): o handler que AGE sobre a intencao explicita do turno PERSISTE essa intencao nos
// slots (tipoVeiculo/interesse/faixaPreco). Sem isso, o sdr-conductor achava o interesse "unknown" e
// REPERGUNTAVA "qual modelo ou tipo?" logo apos ofertar. Mesmo mecanismo do lead-extraction (set_slot).
function intentSlotMutations(frame: TurnFrame, turnId: Id): DecisionMutation[] {
  const muts: DecisionMutation[] = [];
  // interesse: SO quando o turno e por TIPO puro (sem modelo/marca). Modelo/marca ficam com o
  // lead-extraction, que AGREGA multi-modelo ("onix e argo") — Fix C nao pode clobrar com o 1o item.
  if (frame.explicitModels.length === 0 && frame.explicitBrands.length === 0 && frame.explicitTypes[0]) {
    muts.push({ op: "set_slot", slot: "interesse", value: frame.explicitTypes[0], confidence: 0.9, sourceTurnId: turnId });
  }
  if (frame.explicitTypes[0]) muts.push({ op: "set_slot", slot: "tipoVeiculo", value: frame.explicitTypes[0], confidence: 0.9, sourceTurnId: turnId });
  if (frame.budgetMax != null) muts.push({ op: "set_slot", slot: "faixaPreco", value: { max: frame.budgetMax }, confidence: 0.9, sourceTurnId: turnId });
  return muts;
}

function textTurn(turnId: Id, text: string, reasonCode: string, reasonSummary: string, mutations: DecisionMutation[] = []): TurnOutput {
  const proposal: ProposedDecision = {
    proposedAction: "reply", facts: mutations,
    proposedEffects: [{ kind: "send_message", planId: "reply", order: 0, onSuccess: [] }],
    responsePlan: { guidance: text }, reasonCode, reasonSummary, confidence: 1,
  };
  const decision = finalize(turnId, proposal, [{ policyId: "POL-EXPLICIT-TURN", outcome: "allow" }], []);
  return { decision, composed: { draft: { parts: [{ type: "text", content: text }] }, text }, facts: [], loopExhausted: false, terminalSafe: false, steps: 0 };
}

// Util p/ outros guards (ex.: continuity) saberem se o turno atual e busca nova. (state nao usado por ora.)
export function turnHasNewCommercialIntent(leadMessage: string, claimExtractor: ClaimExtractor, _state?: ConversationState): boolean {
  return computeTurnFrame({ leadMessage, claimExtractor }).isNewCommercialIntent;
}

