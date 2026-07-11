// ============================================================================
// slot-provenance.ts — AUTORIDADE GERAL de slots factuais (missão SEM 2026-07-10,
// invariante 2; endurecido pela auditoria Codex rodada 2). Módulo PURO.
//
// Um slot do lead só pode ser persistido por MUTAÇÃO DA LLM quando sustentado:
//   (a) a extração determinística do BLOCO ATUAL cobriu o slot — ELA é a
//       autoridade e a mutação da LLM é DESCARTADA (nunca competem); ou
//   (b) proveniência VERIFICÁVEL no bloco atual, CAMPO A CAMPO:
//       - string: o VALOR aparece no bloco;
//       - número: o valor ∈ valores monetários declarados OU dígitos no bloco;
//       - objeto composto (veiculoTroca/faixaPreco): TODOS os campos definidos
//         têm proveniência própria (⭐Codex: um campo no bloco NÃO valida o
//         objeto inteiro — "meu carro é 2020" não sustenta Ferrari Roma 99k);
//       - booleano (possuiTroca/conheceLoja/interesseVisita): SÓ resposta
//         booleana curta vinculada à PERGUNTA PENDENTE do MESMO slot (⭐Codex:
//         conter a palavra "troca"/"visita"/"loja" NÃO autoriza — "aceito troca
//         na compra" não é possuiTroca=true);
//       - formaPagamento: a raiz do MÉTODO declarado precisa estar no bloco
//         (financ/vista/consorcio/troca) — nunca por menção genérica a pagamento
//   — e SEMPRE com o TurnUnderstanding do turno VÁLIDO (trusted).
//
// Preferência de projeto: fatos vêm da EXTRAÇÃO; a LLM não é segunda autora de
// fatos. Mutações descartadas são OBSERVADAS (decision_final.droppedSlotMutations).
// ============================================================================
import { normalizeText } from "./catalog-utils.ts";
import { leadStatedMoneyValues, parseBooleanAnswer, leadAsksQuestion } from "./lead-extraction.ts";
import type { DecisionMutation } from "../domain/decision.ts";

const BOOLEAN_SLOTS = new Set(["possuiTroca", "conheceLoja", "interesseVisita"]);
// Raiz textual exigida por método de pagamento (o VALOR declarado, não o tema "pagamento").
const PAYMENT_ROOT_RX: Record<string, RegExp> = {
  financiamento: /\bfinanc/,
  a_vista: /\ba\s*vista\b|\bavista\b/,
  consorcio: /\bconsorcio\b/,
  troca: /\btroca\b/,
};

export type DroppedSlotMutation = { readonly slot: string; readonly reason: "extraction_authority" | "understanding_untrusted" | "no_provenance" };

function fieldHasProvenance(part: unknown, blockNorm: string, moneyValues: readonly number[]): boolean {
  if (typeof part === "string") {
    const v = normalizeText(part).trim();
    return v.length >= 2 && blockNorm.includes(v);
  }
  if (typeof part === "number") {
    return moneyValues.includes(part) || blockNorm.includes(String(part));
  }
  return false;   // boolean/null/objeto aninhado: sem proveniência textual própria
}

function valueHasProvenance(value: unknown, blockNorm: string, moneyValues: readonly number[]): boolean {
  if (typeof value === "string" || typeof value === "number") return fieldHasProvenance(value, blockNorm, moneyValues);
  if (value != null && typeof value === "object") {
    // ⭐Codex P0: objeto composto exige proveniência de TODOS os campos definidos (e pelo menos um).
    const parts = Object.values(value as Record<string, unknown>).filter((p) => p != null);
    return parts.length > 0 && parts.every((p) => fieldHasProvenance(p, blockNorm, moneyValues));
  }
  return false;   // boolean puro cai nas regras específicas do loop
}

// Filtra as mutações set_slot AUTORADAS PELA LLM pelo contrato de proveniência acima.
// Mutações não-slot passam intactas. PURO.
export function filterBrainSlotMutations(args: {
  readonly mutations: readonly DecisionMutation[];
  readonly block: string;                          // bloco ATUAL do lead
  readonly extractedSlots: ReadonlySet<string>;    // slots que a extração determinística JÁ setou neste turno
  readonly pendingSlot: string | null;             // pergunta pendente aceita (inferredQuestionSlot)
  readonly understandingTrusted: boolean;          // TurnUnderstanding do turno é válido (evidência ⊂ bloco)?
}): { kept: DecisionMutation[]; dropped: DroppedSlotMutation[] } {
  const kept: DecisionMutation[] = [];
  const dropped: DroppedSlotMutation[] = [];
  const blockNorm = normalizeText(args.block);
  const moneyValues = leadStatedMoneyValues(args.block);
  const questionLike = leadAsksQuestion(args.block);
  const shortBooleanAnswer = !questionLike && parseBooleanAnswer(args.block) != null;
  const nameOnlyAnswer = args.extractedSlots.has("nome") && !questionLike
    && blockNorm.split(/\s+/).filter(Boolean).length <= 3;

  for (const m of args.mutations) {
    if (m.op !== "set_slot") { kept.push(m); continue; }
    // (a) extração determinística cobriu o slot neste turno: ELA é a autoridade — a mutação da LLM
    //     (redundante ou conflitante) é descartada; o valor extraído já está nas mutações do turno.
    if (args.extractedSlots.has(m.slot)) { dropped.push({ slot: m.slot, reason: "extraction_authority" }); continue; }
    // Se a extracao reconheceu que o bloco inteiro e uma apresentacao curta,
    // esse mesmo texto nao pode aterrar interesse/modelo/cidade inventado pela LLM.
    if (nameOnlyAnswer) { dropped.push({ slot: m.slot, reason: "no_provenance" }); continue; }
    // Invariante 1: sem entendimento VÁLIDO do turno, nenhuma mutação factual da LLM é aceita.
    if (!args.understandingTrusted) { dropped.push({ slot: m.slot, reason: "understanding_untrusted" }); continue; }
    const value = (m as { value?: unknown }).value;
    // Booleanos: SÓ resposta booleana curta à pergunta pendente do MESMO slot (⭐Codex).
    if (BOOLEAN_SLOTS.has(m.slot)) {
      if (args.pendingSlot === m.slot && shortBooleanAnswer) { kept.push(m); continue; }
      dropped.push({ slot: m.slot, reason: "no_provenance" }); continue;
    }
    // formaPagamento: exige a raiz do MÉTODO declarado no bloco (nunca menção genérica).
    if (m.slot === "formaPagamento") {
      const rx = typeof value === "string" ? PAYMENT_ROOT_RX[value] : undefined;
      if (rx && rx.test(blockNorm)) { kept.push(m); continue; }
      dropped.push({ slot: m.slot, reason: "no_provenance" }); continue;
    }
    // Demais slots (string/número/objeto): proveniência do VALOR, campo a campo.
    if (valueHasProvenance(value, blockNorm, moneyValues)) { kept.push(m); continue; }
    dropped.push({ slot: m.slot, reason: "no_provenance" });
  }
  return { kept, dropped };
}
