// ============================================================================
// model-context-view.ts - F2.7.4 (E). Deriva, de forma PURA e deterministica, o
// CONTEXTO EXPLICITO que o modelo recebe a cada turno, em vez de garimpar o state
// cru: transcript recente, ultima fala do agente, se JA SE APRESENTOU, fatos
// conhecidos da conversa, objetivo ativo e interesse comercial.
//
// F2.7.13: quando o TURNO ATUAL tem intencao comercial nova, o contexto marca o
// currentTurnFrame e NAO promove slots.interesse antigo como interesse atual.
// Memoria antiga so orienta referencia vaga; nao pode vencer o que o lead pediu agora.
// ============================================================================
import type { ConversationState } from "../domain/conversation-state.ts";
import type { ClaimExtractor, TurnInterpretation } from "../domain/decision.ts";
import type { ModelConversationContext } from "../domain/conversation-model.ts";
import { computeTurnFrame, type TurnFrame } from "./explicit-search.ts";

export type { ModelConversationContext, ModelTranscriptTurn } from "../domain/conversation-model.ts";

const MAX_TRANSCRIPT_TURNS = 12;

type DeriveOptions = {
  readonly leadMessage?: string | null;
  readonly claimExtractor?: ClaimExtractor | null;
};

type PublicTurnFrame = ModelConversationContext["currentTurnFrame"];

function publicFrame(frame: TurnFrame | null): PublicTurnFrame {
  if (!frame) return null;
  return {
    explicitModels: frame.explicitModels,
    explicitBrands: frame.explicitBrands,
    explicitTypes: frame.explicitTypes,
    budgetMax: frame.budgetMax,
    isNewCommercialIntent: frame.isNewCommercialIntent,
    isReferenceOnly: frame.isReferenceOnly,
  };
}

export function deriveModelContext(
  state: ConversationState,
  interpretation?: TurnInterpretation | null,
  options: DeriveOptions = {},
): ModelConversationContext {
  const turns = Array.isArray(state.recentTurns) ? state.recentTurns : [];
  const recentTranscript = turns
    .slice(-MAX_TRANSCRIPT_TURNS)
    .map((t) => ({ role: t.role, text: t.text }));

  let lastAgentMessage: string | null = null;
  for (let i = turns.length - 1; i >= 0; i--) {
    if (turns[i].role === "agent") { lastAgentMessage = turns[i].text; break; }
  }

  // E (anti-reapresentacao): determinismo a partir do HISTORICO/ESTADO, sem if por frase.
  const alreadyIntroduced = turns.some((t) => t.role === "agent") || state.turnNumber > 1;

  const currentFrame = options.leadMessage && options.claimExtractor
    ? computeTurnFrame({ leadMessage: options.leadMessage, claimExtractor: options.claimExtractor, interpretation })
    : null;
  const hasCurrentCommercialIntent = currentFrame?.isNewCommercialIntent === true;

  const s = state.slots;
  const facts: string[] = [];
  if (s.nome.status === "known" && s.nome.value) facts.push(`nome do lead: ${s.nome.value}`);
  if (s.cidade.status === "known" && s.cidade.value) facts.push(`cidade: ${s.cidade.value}`);
  if (s.conheceLoja.status === "known" && s.conheceLoja.value != null) facts.push(`ja conhece a loja: ${s.conheceLoja.value ? "sim" : "nao"}`);
  // Se o lead trouxe uma intencao comercial nova neste turno, o interesse antigo fica fora dos fatos
  // que o modelo usa para decidir. Isso evita respostas como "Jeep -> Argo".
  if (!hasCurrentCommercialIntent && s.interesse.status === "known" && s.interesse.value) facts.push(`interesse declarado: ${s.interesse.value}`);
  if (s.tipoVeiculo.status === "known" && s.tipoVeiculo.value) facts.push(`tipo de veiculo: ${s.tipoVeiculo.value}`);
  if (s.faixaPreco.status === "known" && s.faixaPreco.value) {
    const fp = s.faixaPreco.value;
    if (fp.min != null || fp.max != null) facts.push(`faixa de preco: ${fp.min ?? "?"} a ${fp.max ?? "?"}`);
  }
  if (s.formaPagamento.status === "known" && s.formaPagamento.value) facts.push(`forma de pagamento: ${s.formaPagamento.value}`);
  if (s.possuiTroca.status === "known" && s.possuiTroca.value != null) facts.push(`possui troca: ${s.possuiTroca.value ? "sim" : "nao"}`);
  if (s.parcelaDesejada.status === "known" && s.parcelaDesejada.value != null) facts.push(`parcela desejada: ${s.parcelaDesejada.value}`);
  if (s.entrada.status === "known" && s.entrada.value != null) facts.push(`entrada: ${s.entrada.value}`);
  if (s.diaHorario.status === "known" && s.diaHorario.value) facts.push(`dia/horario preferido: ${s.diaHorario.value}`);
  if (state.vehicleContext.focus?.label) facts.push(`veiculo em foco: ${state.vehicleContext.focus.label}`);
  else if (state.vehicleContext.focus?.key) facts.push(`veiculo em foco: ${state.vehicleContext.focus.key}`);
  if (state.offers.last && state.offers.last.vehicleKeys.length > 0) facts.push(`ultima oferta: ${state.offers.last.vehicleKeys.length} veiculo(s)`);
  if (state.rejected.modelos.length > 0) facts.push(`modelos ja rejeitados: ${state.rejected.modelos.join(", ")}`);

  const currentObjective = state.currentObjective
    ? { type: state.currentObjective.type, slot: state.currentObjective.slot ?? null, status: state.currentObjective.status }
    : null;

  const currentModel = hasCurrentCommercialIntent
    ? [...(currentFrame?.explicitModels ?? []), ...(currentFrame?.explicitBrands ?? [])].join(", ") || null
    : null;
  const historicalModel = interpretation?.extractedEntities?.model
    ?? (s.interesse.status === "known" ? s.interesse.value : null)
    ?? null;
  const interestModel = hasCurrentCommercialIntent ? currentModel : historicalModel;
  const interestTipo = hasCurrentCommercialIntent
    ? (currentFrame?.explicitTypes[0] ?? null)
    : (s.tipoVeiculo.status === "known" ? (s.tipoVeiculo.value ?? null) : null);
  const interestPrecoMax = hasCurrentCommercialIntent
    ? (currentFrame?.budgetMax ?? null)
    : (s.faixaPreco.status === "known" ? (s.faixaPreco.value?.max ?? null) : null);
  const lastCommercialInterest = (interestModel || interestTipo || interestPrecoMax != null)
    ? { model: interestModel, tipo: interestTipo, precoMax: interestPrecoMax }
    : null;

  return {
    recentTranscript,
    lastAgentMessage,
    alreadyIntroduced,
    conversationFacts: facts,
    currentObjective,
    lastCommercialInterest,
    currentTurnFrame: publicFrame(currentFrame),
  };
}
