// ============================================================================
// explicit-search.ts - F2.7.13. Invariante de PRIORIDADE DO TURNO ATUAL.
// Se a mensagem ATUAL tem intencao comercial explicita (marca/modelo/tipo/faixa), ela VENCE
// memoria antiga (slots.interesse, lastCommercialInterest, lastRenderedOfferContext). Handler
// DETERMINISTICO: roda stock_search do que o lead pediu AGORA e oferta (ancorado) OU responde
// honesto "nao encontrei X" - NUNCA cai no modelo/lista antiga.
//
// Importante: marcas/modelos v�m do TenantCatalog via ClaimExtractor. Nada hardcoded por marca.
// Memoria antiga so vale para referencia vaga (esse/dele/ordinal).
// ============================================================================
import type { ConversationState, RenderedOfferItem } from "../domain/conversation-state.ts";
import type { ClaimExtractor, DecisionMutation, ProposedDecision, QueryInputMap, QueryResult, TurnInterpretation } from "../domain/decision.ts";
import type { Id, TransmissionPreference, VehicleFact, VehicleType } from "../domain/types.ts";
import type { QueryRunner, TurnOutput } from "./decision-engine.ts";
import { finalize } from "./finalizer.ts";
import { normalizeText, normalizedTermInText } from "./catalog-utils.ts";
import { renderVehicleOfferList } from "./vehicle-offer-render.ts";
import { VEHICLE_TAXONOMY } from "../adapters/read/vehicle-taxonomy.ts";

const TYPES = /\b(suvs?|hatchback|hatch|sedans?|pickups?|picapes?)\b/g;
const TYPE_MAP: Record<string, VehicleType> = { suv: "suv", suvs: "suv", hatch: "hatch", hatchback: "hatch", sedan: "sedan", sedans: "sedan", pickup: "pickup", pickups: "pickup", picape: "pickup", picapes: "pickup" };
// Referencia VAGA (pode herdar memoria): esse/dele/ordinal/foto. NAO e intencao comercial nova.
const REFERENCE_ONLY = /\besse\b|\bessa\b|\beste\b|\besta\b|\bdele\b|\bdela\b|\bdesse\b|\bprimeir|\bsegund|\bterceir|\bquart|\bquint|\bfotos?\b|\bimagens?\b|\bmais\b|\boutr/;
const TRANSMISSION_WORDS = /\b(automatic[oa]?|automatizad[oa]|manual|cvt|dsg|dualogic|imotion|tiptronic)\b/gi;

export type TurnFrame = {
  readonly explicitModels: string[];
  readonly explicitBrands: string[];
  readonly explicitTypes: VehicleType[];
  readonly budgetMax: number | null;
  readonly transmission: TransmissionPreference | null;
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

function parseTransmission(norm: string): TransmissionPreference | null {
  const automatic = /\b(automat|automatic|cvt|dsg|dualogic|imotion|tiptronic)/.test(norm);
  const manual = /\bmanual\b/.test(norm);
  if (automatic === manual) return null;
  if (/\bnao\s+(?:quero|prefiro).{0,20}\bautomat/.test(norm)) return "manual";
  if (/\bnao\s+(?:quero|prefiro).{0,20}\bmanual\b/.test(norm)) return "automatic";
  return automatic ? "automatic" : "manual";
}

// Frame DETERMINISTICO do turno atual (sem LLM). isNewCommercialIntent -> bloqueia memoria antiga.
export function computeTurnFrame(args: { leadMessage: string; claimExtractor: ClaimExtractor; interpretation?: TurnInterpretation | null }): TurnFrame {
  const { leadMessage, claimExtractor } = args;
  const norm = normalizeText(leadMessage);
  const claims = collectClaims(leadMessage, claimExtractor, args.interpretation);
  const explicitTypes = [...new Set((norm.match(TYPES) ?? []).map((t) => TYPE_MAP[t]).filter((x): x is VehicleType => !!x))];
  const budgetMax = parseBudget(norm);
  const transmission = parseTransmission(norm);
  // item 1A.4 + busca SEM�NTICA (Codex): TIPO nunca � MODELO; e C�MBIO ("autom�tico"/"manual"/"CVT") �
  // prefer�ncia/FILTRO, jamais parte do modelo. Remove o c�mbio do modelo; se o que sobra � um TIPO puro
  // (ex.: "hatch autom�tico" -> "hatch") ou vazio, descarta -> NUNCA stock_search({modelo:"hatch automatico"}).
  const explicitModels = claims.models
    .map((m) => m.replace(TRANSMISSION_WORDS, "").replace(/\s+/g, " ").trim())
    .filter((m) => m.length > 0 && !TYPE_MAP[normalizeText(m)]);
  const isNewCommercialIntent = explicitModels.length > 0 || claims.brands.length > 0 || explicitTypes.length > 0 || budgetMax != null || transmission != null;
  const isReferenceOnly = !isNewCommercialIntent && REFERENCE_ONLY.test(norm);
  return { explicitModels, explicitBrands: claims.brands, explicitTypes, budgetMax, transmission, isNewCommercialIntent, isReferenceOnly };
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

function vehicleMatchesTransmission(vehicle: VehicleFact, preference: TransmissionPreference | null | undefined): boolean {
  if (!preference) return true;
  const cambio = normalizeText(String(vehicle.cambio ?? ""));
  if (!cambio) return false;
  const automatic = /\b(automat|automatic|cvt|dsg|dualogic|imotion|tiptronic)/.test(cambio);
  const manual = /\bmanual\b/.test(cambio) && !automatic;
  return preference === "automatic" ? automatic : manual;
}

function buildTargets(frame: TurnFrame, state?: ConversationState): SearchTarget[] {
  const storedType = state?.slots.tipoVeiculo.status === "known" ? state.slots.tipoVeiculo.value : null;
  const storedBudget = state?.slots.faixaPreco.status === "known" ? state.slots.faixaPreco.value?.max ?? null : null;
  const effectiveBudget = frame.budgetMax ?? storedBudget;
  const effectiveTransmission = frame.transmission ?? state?.searchPreferences?.transmission ?? null;
  const mayInheritType = frame.explicitModels.length === 0 && frame.explicitBrands.length === 0;
  const effectiveType = frame.explicitTypes[0] ?? (mayInheritType ? storedType : null);
  const budget = effectiveBudget != null ? { precoMax: effectiveBudget } : {};
  const tipo = effectiveType ? { tipo: effectiveType } : {};
  const cambio = effectiveTransmission ? { cambio: effectiveTransmission } : {};
  const withCommonFilters = (input: QueryInputMap["stock_search"]): QueryInputMap["stock_search"] => ({
    ...input,
    ...tipo,
    ...budget,
    ...cambio,
  });

  if (frame.explicitModels.length > 0) {
    return frame.explicitModels.map((model) => ({ label: model, input: withCommonFilters({ modelo: model }) }));
  }
  if (frame.explicitBrands.length > 0) {
    return frame.explicitBrands.map((brand) => ({ label: cap(brand), input: withCommonFilters({ modelo: brand }) }));
  }
  if (effectiveType) {
    const type = effectiveType;
    return [{
      label: labelType(type),
      input: withCommonFilters({}),
      // Defesa contra feed/API mal classificado: se o filtro por tipo vier vazio,
      // expande pelo conhecimento automotivo canonico da planilha e busca modelos reais.
      fallbackInputs: taxonomyModelInputsForType(type, { ...budget, ...cambio }),
    }];
  }
  if (effectiveBudget != null || effectiveTransmission) {
    const label = effectiveTransmission === "automatic" ? "opcoes automaticas"
      : effectiveTransmission === "manual" ? "opcoes manuais" : "nessa faixa de preco";
    return [{ label, input: withCommonFilters({ broad: true }) }];
  }
  return [];
}

// null = nao e busca comercial nova -> deixa economy/continuity/LLM. Senao roda stock_search do turno ATUAL.
export async function resolveExplicitSearchIntent(args: {
  leadMessage: string; state?: ConversationState; claimExtractor: ClaimExtractor; interpretation?: TurnInterpretation | null; runQuery: QueryRunner;
}): Promise<ExplicitSearchResult | null> {
  const { runQuery } = args;
  const frame = computeTurnFrame(args);
  if (!frame.isNewCommercialIntent) return null;
  const targets = buildTargets(frame, args.state);
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
    const items = res.ok && res.tool === "stock_search" ? res.data.items : [];
    return items.filter((vehicle) => vehicleMatchesTransmission(vehicle, input.cambio));
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
  // pediu SUV � repetia a dor do veiculo aleatorio. E tambem nao se mente "nao tenho SUV". Agora, sem match
  // ATERRADO do tipo pedido -> `none` -> o handler faz uma pergunta HONESTA e condutiva (ampliar faixa /
  // outro tipo), SEM listar carro do tipo errado. Achar os SUV reais e papel da classificacao (Fix B).
  if (vehicles.length === 0) return { kind: "none", label, frame };
  return { kind: "offer", label, vehicles, missingLabels, frame };
}

const cap = (s: string): string => s.charAt(0).toLocaleUpperCase("pt-BR") + s.slice(1);
const labelType = (t: VehicleType): string => ({ suv: "SUV", hatch: "hatch", sedan: "sedan", pickup: "picape", unknown: "esse tipo" } as Record<string, string>)[t] ?? "esse tipo";

export function buildExplicitSearchTurnOutput(result: ExplicitSearchResult, turnId: Id): TurnOutput {
  // 1B.7: o handler NAO redige o texto final � produz FATOS + GUIDANCE (principios) + fallbackText
  // (deterministico, SO p/ falha tecnica). O compose (LLM) redige seguindo o prompt do portal; o conductor
  // injeta a qualificacao. FIX C: persiste a intencao explicita do turno nos slots (intentSlotMutations).
  const slotMuts = result.frame ? intentSlotMutations(result.frame, turnId) : [];

  if (result.kind === "none") {
    // Sem match ATERRADO do que o lead pediu -> resposta HONESTA e condutiva, SEM listar tipo errado nem mentir.
    const fallbackText = result.frame && result.frame.explicitTypes.length > 0
      ? `No momento nao achei um ${result.label}${budgetPhrase(result.frame)} no nosso estoque. Quer que eu amplie a faixa de valor, ou prefere ver outro tipo (sedan, hatch, picape)?`
      : `No momento nao tenho ${result.label} no nosso estoque. Posso te mostrar opcoes parecidas - quer que eu filtre por preco, tipo (SUV, hatch, sedan) ou outra marca?`;
    const guidance = `O lead pediu ${result.label}${budgetPhrase(result.frame)}, mas esse veiculo NAO esta aterrado nos fatos (nao ha no estoque agora). Seja HONESTO: diga que nao encontrou agora ${result.label} e conduza (ampliar faixa de valor ou ver outro tipo). NUNCA liste veiculo de tipo/modelo diferente como se fosse o que ele pediu. Nao invente estoque.`;
    return composeTurn(turnId, "explicit_not_found", guidance, fallbackText, [], slotMuts, null);
  }

  // Fatos REAIS do turno (QueryResult sintetico) p/ o compose montar o vehicle_offer_list e a policy aterrar.
  const facts: QueryResult[] = [{ ok: true, tool: "stock_search", source: "handler", data: { items: result.vehicles, filtersUsed: {} } } as QueryResult];
  const items: RenderedOfferItem[] = result.vehicles.map((v, i) => ({ ordinal: i + 1, vehicleKey: v.vehicleKey, marca: v.marca ?? null, modelo: v.modelo ?? null, ano: v.ano ?? null }));
  const missingNote = result.missingLabels.length > 0 ? ` Em uma frase curta, diga que nao encontrou agora: ${result.missingLabels.join(", ")}.` : "";
  const guidance = `O lead pediu ${result.label}. Encontrei ${result.vehicles.length} veiculo(s) REAIS no estoque (nos fatos deste turno). Apresente-os com UMA parte vehicle_offer_list usando os vehicleKeys dos fatos (o sistema renderiza marca/modelo/ano/preco/km). REGRA CRITICA: NAO escreva NENHUM nome de modelo, marca, preco ou km em TEXTO livre (nem abreviado) - a lista ja mostra tudo; no texto fale de forma generica ("essas opcoes", "esse sedan").${missingNote} Siga o prompt do portal: conduza a qualificacao com no maximo UMA pergunta, sem despejar tudo de uma vez.`;
  const fallbackText = `Encontrei estas opcoes pra voce:\n\n${renderVehicleOfferList(result.vehicles, { maxItems: 5 })}${result.missingLabels.length > 0 ? `\n\nNao encontrei agora: ${result.missingLabels.join(", ")}.` : ""}\n\nQuer ver as fotos de algum desses ou prefere agendar uma visita?`;
  return composeTurn(turnId, "explicit_offer", guidance, fallbackText, facts, slotMuts, items);
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
  // lead-extraction, que AGREGA multi-modelo ("onix e argo") � Fix C nao pode clobrar com o 1o item.
  if (frame.explicitModels.length === 0 && frame.explicitBrands.length === 0 && frame.explicitTypes[0]) {
    muts.push({ op: "set_slot", slot: "interesse", value: frame.explicitTypes[0], confidence: 0.9, sourceTurnId: turnId });
  }
  if (frame.explicitTypes[0]) muts.push({ op: "set_slot", slot: "tipoVeiculo", value: frame.explicitTypes[0], confidence: 0.9, sourceTurnId: turnId });
  if (frame.budgetMax != null) muts.push({ op: "set_slot", slot: "faixaPreco", value: { max: frame.budgetMax }, confidence: 0.9, sourceTurnId: turnId });
  if (frame.transmission) muts.push({ op: "set_search_transmission", value: frame.transmission, sourceTurnId: turnId });
  return muts;
}

// 1B.7: turno que PASSA pelo compose. guidance = principios (o LLM redige seguindo o prompt); fallbackText =
// texto deterministico usado SO em falha tecnica/schema/policy repetida. `composed` aqui e placeholder.
export function composeTurn(turnId: Id, reasonCode: string, guidance: string, fallbackText: string, facts: QueryResult[], mutations: DecisionMutation[], offerItems: RenderedOfferItem[] | null): TurnOutput {
  const proposal: ProposedDecision = {
    proposedAction: "reply", facts: mutations,
    proposedEffects: [{ kind: "send_message", planId: "reply", order: 0, onSuccess: [] }],
    responsePlan: { guidance }, reasonCode, reasonSummary: guidance.slice(0, 120), confidence: 1,
  };
  const decision = finalize(turnId, proposal, [{ policyId: "POL-EXPLICIT-TURN", outcome: "allow" }], facts);
  return {
    decision,
    composed: { draft: { parts: [{ type: "text", content: fallbackText }] }, text: fallbackText },
    facts, loopExhausted: false, terminalSafe: false, steps: 0,
    needsCompose: true, fallbackText,
    ...(offerItems ? { renderedOfferContext: offerItems } : {}),
  };
}

// Util p/ outros guards (ex.: continuity) saberem se o turno atual e busca nova. (state nao usado por ora.)
export function turnHasNewCommercialIntent(leadMessage: string, claimExtractor: ClaimExtractor, _state?: ConversationState): boolean {
  return computeTurnFrame({ leadMessage, claimExtractor }).isNewCommercialIntent;
}

// -- Se��o 4 (Codex): "MAIS OP��ES" como INVARIANTE DETERMIN�STICO ----------------------------------------
// Bug do incidente v2 (e regress�o do 1B.7 quando o LLM tinha liberdade): ao pedir "mais op��es", perdia
// tipo/teto e mostrava carro aleat�rio (ou o LLM inventava ve�culos fora dos fatos -> VEHICLE_OUTSIDE_QUERYRESULTS).
// Regra: herda tipo+precoMax dos SLOTS, EXCLUI os vehicleKeys j� mostrados, roda stock_search � NUNCA depende
// do LLM lembrar os filtros. Sem contexto comercial anterior -> null (deixa o LLM). Retorna fatos p/ o compose.
const MORE_OPTIONS = /\bmais\s+(opc|carr|veicul|modelo|alternativ|algum|outr)|\boutras?\s+(opc|carr|modelo|alternativ)|\bmais alguma\b|\bmostrar? mais\b|\btem\s+(mais|outr)/;
export function looksLikeMoreOptions(leadMessage: string): boolean {
  return MORE_OPTIONS.test(normalizeText(leadMessage));
}
export async function resolveMoreOptionsIntent(args: {
  leadMessage: string; state: ConversationState; runQuery: QueryRunner; claimExtractor: ClaimExtractor;
}): Promise<ExplicitSearchResult | null> {
  const { leadMessage, state, runQuery, claimExtractor } = args;
  if (!looksLikeMoreOptions(leadMessage)) return null;
  const frame = computeTurnFrame({ leadMessage, claimExtractor });
  // Inten��o comercial NOVA por MODELO/MARCA/TIPO � papel do explicit-search. Mas um novo TETO
  // ("mais op��es at� 90 mil") N�O troca de busca � atualiza o teto e mant�m categoria+exclus�es (Codex).
  if (frame.explicitModels.length > 0 || frame.explicitBrands.length > 0 || frame.explicitTypes.length > 0) return null;

  const slots = state.slots as unknown as { tipoVeiculo?: { status?: string; value?: string }; faixaPreco?: { status?: string; value?: { max?: number | null } } };
  const tipo = slots.tipoVeiculo?.status === "known" && slots.tipoVeiculo.value ? slots.tipoVeiculo.value as VehicleType : null;
  const precoMaxSlot = slots.faixaPreco?.status === "known" ? (slots.faixaPreco.value?.max ?? null) : null;
  const precoMax = frame.budgetMax ?? precoMaxSlot; // novo teto do turno VENCE o do slot
  const transmission = frame.transmission ?? state.searchPreferences?.transmission ?? null;
  // P1 (Codex): mem�ria CUMULATIVA � exclui TODAS as chaves j� apresentadas (offers.presentedKeys, accepted-safe)
  // + a �ltima lista ordinal. Assim "mais op��es" repetido 3� NUNCA repete um ve�culo.
  const shownKeys = [...new Set([...(state.offers?.presentedKeys ?? []), ...(state.lastRenderedOfferContext?.items ?? []).map((i) => i.vehicleKey)])];
  // Sem NENHUM contexto comercial anterior -> n�o � "mais op��es" acion�vel.
  if (!tipo && precoMax == null && shownKeys.length === 0) return null;

  const input: QueryInputMap["stock_search"] = {};
  if (tipo) input.tipo = tipo; else input.broad = true;
  if (precoMax != null) input.precoMax = precoMax;
  if (transmission) input.cambio = transmission;
  if (shownKeys.length > 0) input.excludeKeys = shownKeys;
  const res = await runQuery({ tool: "stock_search", input });
  const items = res.ok && res.tool === "stock_search" ? res.data.items : [];
  // Defesa (al�m do excludeKeys do runner): exclui explicitamente os j� mostrados e sem pre�o inv�lido.
  const shown = new Set(shownKeys);
  const fresh = items
    .filter((v) => typeof v.preco === "number" && v.preco > 0 && !shown.has(v.vehicleKey) && vehicleMatchesTransmission(v, transmission))
    .sort((a, b) => a.preco - b.preco)
    .slice(0, 5);
  const label = tipo ? labelType(tipo) : "opcoes";
  return fresh.length === 0 ? { kind: "none", label } : { kind: "offer", label, vehicles: fresh, missingLabels: [] };
}
export function buildMoreOptionsTurnOutput(result: ExplicitSearchResult, turnId: Id, exhaustedCount = 0): TurnOutput {
  if (result.kind === "none") {
    // R10-4 (Codex): PROGRESS�O de "mais op��es esgotadas" � N�O repete o mesmo texto. Passa pelo compose (reda��o
    // segue o prompt do portal), com guidance que PRO�BE inventar ve�culo/vehicle_offer_list. count 0 -> ampliar
    // pre�o; 1 -> outro tipo; 2+ -> conduzir p/ rever atuais/fotos/visita. Incrementa o contador no estado.
    const bump: DecisionMutation[] = [{ op: "set_more_options_exhausted", value: exhaustedCount + 1 }];
    const noVehicles = ` NAO invente veiculo, NAO use vehicle_offer_list e NAO escreva modelos/precos - nao ha veiculos novos nos fatos deste turno.`;
    let guidance: string; let fallbackText: string;
    if (exhaustedCount === 0) {
      guidance = `O lead pediu MAIS opcoes de ${result.label}, mas nao ha veiculos novos alem dos ja mostrados.${noVehicles} Seja honesto e ofereca UMA saida: AMPLIAR a faixa de preco para buscar mais. SO UMA pergunta.`;
      fallbackText = `Por ora nao encontrei outros ${result.label} alem desses. Quer que eu amplie um pouco a faixa de preco para buscar mais opcoes?`;
    } else if (exhaustedCount === 1) {
      guidance = `Continua sem ${result.label} novos e o lead ja foi consultado sobre ampliar o preco.${noVehicles} Ofereca OUTRA dimensao: procurar em OUTRO TIPO de veiculo (SUV, sedan, hatch, picape). SO UMA pergunta, DIFERENTE da anterior.`;
      fallbackText = `Nessa faixa nao tenho outros ${result.label} no momento. Quer que eu procure em outro tipo de veiculo - SUV, sedan, hatch ou picape?`;
    } else {
      guidance = `Ja ofereci ampliar preco e trocar de tipo, ainda sem resultados novos.${noVehicles} NAO repita as perguntas anteriores. Conduza para o fechamento: rever as opcoes ja mostradas, ver as fotos delas, ou agendar uma visita.`;
      fallbackText = `Por ora essas sao as opcoes que consigo. Prefere rever as que ja te mostrei, ver as fotos, ou agendar uma visita para conhecer pessoalmente?`;
    }
    return composeTurn(turnId, "offer_more_options_none", guidance, fallbackText, [], bump, null);
  }
  const facts: QueryResult[] = [{ ok: true, tool: "stock_search", source: "handler", data: { items: result.vehicles, filtersUsed: {} } } as QueryResult];
  const items: RenderedOfferItem[] = result.vehicles.map((v, i) => ({ ordinal: i + 1, vehicleKey: v.vehicleKey, marca: v.marca ?? null, modelo: v.modelo ?? null, ano: v.ano ?? null }));
  const guidance = `O lead pediu MAIS opcoes de ${result.label}. Encontrei ${result.vehicles.length} veiculo(s) REAIS no estoque (nos fatos deste turno), DIFERENTES dos ja mostrados. Apresente-os com UMA parte vehicle_offer_list usando os vehicleKeys dos fatos (o sistema renderiza; nao escreva a lista/precos em texto). Nao repita os ja mostrados. Siga o prompt: no maximo UMA pergunta de conducao.`;
  const fallbackText = `Tenho mais estas opcoes para voce:\n\n${renderVehicleOfferList(result.vehicles, { maxItems: 5 })}\n\nQuer ver as fotos de alguma ou prefere agendar uma visita?`;
  // ve�culos novos renderizados -> RESETA a progress�o de esgotamento (o lead voltou a ver op��es).
  return composeTurn(turnId, "offer_more_options", guidance, fallbackText, facts, [{ op: "set_more_options_exhausted", value: 0 }], items);
}

