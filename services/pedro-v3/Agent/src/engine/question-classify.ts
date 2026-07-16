// ============================================================================
// question-classify.ts — utilitários NEUTROS de classificação de PERGUNTA (sem depender de conductor/policy,
// para evitar import circular). Usados pelo sdr-conductor (condução) e pela policy (P0-2 congruência).
// ============================================================================
import { normalizeText } from "./catalog-utils.ts";
import type { SlotName } from "../domain/types.ts";

// A ÚLTIMA cláusula interrogativa de um texto — do último delimitador de sentença (. ! ? ⏎) até o "?" final.
// O LLM natural RECONHECE um dado antes de perguntar ("Obrigado pelo nome, Douglas. Tem carro na troca?" /
// "Que bom que já conhece a loja! Qual tipo você quer?"). A PERGUNTA real é a última cláusula; o reconhecimento
// anterior NÃO deve dominar a classificação (senão "nome"/"loja"/"entrada" do reconhecimento classificam errado).
export function lastInterrogativeClause(text: string): string {
  const t = text.trim();
  const m = /([^.!?\n]*\?)\s*$/.exec(t);
  return m ? m[1].trim() : t;
}

// Classifica uma pergunta configurada/composta no SLOT que ela coleta (ou null se não for pergunta de slot).
// Inclui "cpf" (pergunta indevida antes da hora) para o P0-2 poder negá-la.
export function classifyConfiguredQuestion(question: string): SlotName | null {
  const q = normalizeText(lastInterrogativeClause(question));
  if (/\bcpf\b/.test(q)) return "cpf";
  if (/\bnome\b|\bcomo.*cham/.test(q)) return "nome";
  if (/\bcidade\b|\bonde mora\b|\bde onde/.test(q)) return "cidade";
  if (/\bconhece.*loja\b|\bja veio.*loja|\bsabe.*onde.*loja\b|\bonde fica.*loja/.test(q)) return "conheceLoja";
  if (/\bparcela\b|\bmensal/.test(q)) return "parcelaDesejada";
  if (/\bentrada\b/.test(q)) return "entrada";
  if (/\bmodelo.*ano\b|\bano.*quilometr|\bdados.*veiculo.*troca/.test(q)) return "veiculoTroca";
  if (/\btroca\b/.test(q)) return "possuiTroca";
  if (/\bdia\b|\bhorario\b|\bquando.*visita/.test(q)) return "diaHorario";
  if (/\bvisita\b|\bagendar\b/.test(q)) return "interesseVisita";
  if (/\bpagamento\b|\bfinanc|\ba vista\b|\bconsorcio\b/.test(q)) return "formaPagamento";
  if (/\bfaixa.*valor\b|\borcamento\b|\bquanto.*invest/.test(q)) return "faixaPreco";
  // "modelo" domina: "qual modelo ou tipo de carro você procura?" é a pergunta de INTERESSE (não tipoVeiculo).
  if (/\bmodelo\b|\bcarro.*(procura|busca)\b|\bveiculo.*(procura|busca)\b|\bo que.*procura/.test(q)) return "interesse";
  if (/\bsuv\b|\bsedan\b|\bhatch\b|\bpicape\b/.test(q)) return "tipoVeiculo"; // tipo PURO (sem "tipo de carro" genérico)
  return null;
}

// A última pergunta do texto (a que "conduz" o turno).
export function trailingQuestion(text: string): string | null {
  const match = /(?:^|[\n.!]\s*)([^?\n]{2,240}\?)\s*$/u.exec(text.trim());
  return match?.[1]?.trim() ?? null;
}

// Conta quantas SENTENÇAS terminadas em "?" classificam como pergunta de slot (para "no máximo UMA pergunta").
export function countSlotQuestions(text: string): number {
  return slotQuestions(text).length;
}
// Lista os SLOTS perguntados no texto (uma entrada por sentença-com-"?" que classifica). Permite distinguir
// perguntas de DADOS de CTAs de AVANÇO (interesseVisita/diaHorario), que são fechamento legítimo do funil.
export function slotQuestions(text: string): SlotName[] {
  const parts = text.split(/(?<=\?)/).map((s) => s.trim()).filter(Boolean);
  const out: SlotName[] = [];
  // A coleta sensivel pode ser introduzida numa frase declarativa e terminar
  // com uma pergunta generica ("preciso do CPF... Pode me informar?"). Ela
  // continua sendo uma pergunta de CPF para a validacao PII, mesmo que a
  // ultima clausula nao repita a palavra CPF.
  const normalized = normalizeText(text);
  if (/\b(?:cpf|data\s+de\s+nascimento|nascimento)\b/.test(normalized)
    && /\b(?:preciso|informe|informar|envie|enviar|passe|passar|forneca|fornecer|diga|me\s+de)\b/.test(normalized)) {
    out.push("cpf");
  }
  for (const p of parts) { if (p.endsWith("?")) { const s = classifyConfiguredQuestion(p); if (s) out.push(s); } }
  return [...new Set(out)];
}
// CTAs de AVANÇO/fechamento do funil — sempre permitidos (não contam como "pergunta de qualificação" no limite,
// não disparam divergência). O LLM naturalmente oferece "quer ver fotos ou agendar visita?" numa oferta.
export const ADVANCE_SLOTS: ReadonlySet<SlotName> = new Set<SlotName>(["interesseVisita", "diaHorario"]);

// Família de DESCOBERTA — "o que o lead quer" pode ser expresso por MODELO específico OU por TIPO (SUV/hatch/
// sedan). Perguntar "qual modelo?" e "prefere SUV ou hatch?" coletam a MESMA intenção; a policy trata as duas
// como UMA pergunta (não empilhamento) e como congruentes entre si. (Alinha com objectiveType/expectedAnswerKinds
// do conductor, que já agrupam interesse+tipoVeiculo.) faixaPreco é ORÇAMENTO (outro eixo) — fora da família.
export const DISCOVERY_FAMILY: ReadonlySet<SlotName> = new Set<SlotName>(["interesse", "tipoVeiculo"]);
// Rótulo de FAMÍLIA de um slot de dados (descoberta colapsa; demais são eles mesmos) — usado na contagem "no
// máximo UMA pergunta de dados" para não penalizar "qual modelo ou tipo?" como duas perguntas.
export function slotFamily(slot: SlotName): string {
  return DISCOVERY_FAMILY.has(slot) ? "descoberta" : slot;
}
