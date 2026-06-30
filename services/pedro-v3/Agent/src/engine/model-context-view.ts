// ============================================================================
// model-context-view.ts — F2.7.4 (E). Deriva, de forma PURA e deterministica, o
// CONTEXTO EXPLICITO que o modelo recebe a cada turno, em vez de garimpar o state
// cru: transcript recente, ultima fala do agente, se JA SE APRESENTOU, fatos
// conhecidos da conversa, objetivo ativo e ultimo interesse comercial.
//
// Fonte = ConversationState (memoria/recentTurns) + interpretacao do turno.
// NAO faz I/O, NAO chama modelo, NAO inventa: espelha o estado. Mesmo state ->
// mesmo contexto (deterministico, testavel offline). Brain/02 §2.1.
// ============================================================================
import type { ConversationState } from "../domain/conversation-state.ts";
import type { TurnInterpretation } from "../domain/decision.ts";
import type { ModelConversationContext } from "../domain/conversation-model.ts";

export type { ModelConversationContext, ModelTranscriptTurn } from "../domain/conversation-model.ts";

const MAX_TRANSCRIPT_TURNS = 12;

export function deriveModelContext(
  state: ConversationState,
  interpretation?: TurnInterpretation | null,
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

  const s = state.slots;
  const facts: string[] = [];
  if (s.nome.status === "known" && s.nome.value) facts.push(`nome do lead: ${s.nome.value}`);
  if (s.cidade.status === "known" && s.cidade.value) facts.push(`cidade: ${s.cidade.value}`);
  if (s.conheceLoja.status === "known" && s.conheceLoja.value != null) facts.push(`ja conhece a loja: ${s.conheceLoja.value ? "sim" : "nao"}`);
  if (s.interesse.status === "known" && s.interesse.value) facts.push(`interesse declarado: ${s.interesse.value}`);
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

  const interestModel = interpretation?.extractedEntities?.model
    ?? (s.interesse.status === "known" ? s.interesse.value : null)
    ?? null;
  const interestTipo = s.tipoVeiculo.status === "known" ? (s.tipoVeiculo.value ?? null) : null;
  const interestPrecoMax = s.faixaPreco.status === "known" ? (s.faixaPreco.value?.max ?? null) : null;
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
  };
}
