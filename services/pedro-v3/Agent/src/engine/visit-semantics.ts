// ============================================================================
// visit-semantics.ts — DEGRAU 3 (2026-07-18). FONTE ÚNICA do ato de VISITA.
//
// DEFEITO CORRIGIDO: o reconhecimento de visita vivia DUPLICADO em dois arquivos, com vocabulários que divergiram:
//   - turn-understanding.ts:35 (valida primaryIntent="visit"): só visit*/agend*/marcar visita/presencial —
//     NENHUM verbo de deslocamento;
//   - lead-extraction.ts:457 (extrai o slot interesseVisita): + "ir aí" / "passar aí" — SÓ INFINITIVO.
// Consequência medida em produção (18/07, lead 12 99143-5454): "Vou até ai sou de sjc." — 1ª pessoa do futuro —
// não casava nenhum dos dois. O lead avisou que ia à loja, o engine classificou o turno como `other`, e uma LLM que
// classificasse CORRETAMENTE `visit` seria DERRUBADA pelo validador (invariante invertido).
//
// INVARIANTE (semântica, não frase): um ato de visita é
//   (a) um TERMO explícito de visita/agendamento, OU
//   (b) um VERBO DE DESLOCAMENTO + uma DÊIXIS DE DESTINO que aponta para a loja.
// A FORMA VERBAL (infinitivo vs. conjugado) não pode decidir isso — era exatamente o bug. Por isso a lista é de
// CLASSE DE VERBO (com stem \w* onde a conjugação é regular), nunca de frase específica.
//
// FALSO-POSITIVO É O RISCO REAL, e o desenho protege contra ele: deslocamento SOZINHO nunca basta. "vou pensar",
// "vou ver com minha esposa", "vou fazer uma proposta" NÃO têm dêixis de destino => não são visita.
// PURO, sem I/O, testável offline ($0).
// ============================================================================
import { normalizeText } from "./catalog-utils.ts";

// Para ONDE o lead diz que vai. Nunca a palavra solta "aí" — sempre ancorada como destino.
const STORE_DEIXIS_SRC = String.raw`(?:a[ií]\b|l[aá]\b|na\s+loja|ate\s+(?:a[ií]\b|a\s+loja|voce?s)|em\s+voce?s|no\s+local|de\s+perto|pessoal?mente)`;

// Classe de verbos de DESLOCAMENTO, em qualquer conjugação. "ir" é irregular (vou/vai/vamos/irei), então as formas
// são listadas; os regulares usam stem + \w* (passo/passar/passarei/passando, chego/chegar, apareço/aparecer...).
const DISPLACEMENT_SRC = String.raw`(?:ir|vou|vamos|vai|irei|iremos|indo|pass\w*|cheg\w*|aparec\w*|comparec\w*|estarei|estou\s+indo|d(?:ou|ar)\s+um\s+pulo)`;

// Termos que JÁ nomeiam o ato, sem depender de deslocamento.
const VISIT_TERM_SRC = String.raw`(?:visit\w*|agend\w*|marc\w*\s+(?:uma\s+)?visita|presencial\w*|conhecer\s+(?:o\s+carro|a\s+loja|de\s+perto|voce?s))`;

const VISIT_TERM_RX = new RegExp(String.raw`\b${VISIT_TERM_SRC}\b`);
// Deslocamento + destino, tolerando poucas palavras entre eles ("vou amanhã cedo até aí"), sem cruzar frase.
const VISIT_MOVE_RX = new RegExp(String.raw`\b${DISPLACEMENT_SRC}\b[^.?!]{0,24}?${STORE_DEIXIS_SRC}`);

// Negação LIGADA ao ato de visitar. Usa os MESMOS blocos, então cobre tanto "não quero visitar" quanto
// "não vou aí" — que a versão antiga deixava passar como visita (o deslocamento negado virava interesse).
const VISIT_REFUSAL_RX = new RegExp(
  String.raw`\bn[aã]o\s+(?:quero|posso|vou|pretendo|preciso|gostaria|consigo|tenho\s+interesse)\b[^.?!]{0,30}?(?:${VISIT_TERM_SRC}|${STORE_DEIXIS_SRC})`,
);

/** O texto AFIRMA um ato de visita (ir à loja / agendar / conhecer presencialmente)? */
export function isVisitAct(text: string): boolean {
  const n = normalizeText(text);
  if (isVisitRefusal(n)) return false;   // recusa vence: "não vou aí" não é interesse em visitar
  return VISIT_TERM_RX.test(n) || VISIT_MOVE_RX.test(n);
}

/** O texto RECUSA a visita? (negação ancorada no ato ou no destino) */
export function isVisitRefusal(text: string): boolean {
  return VISIT_REFUSAL_RX.test(normalizeText(text));
}

/**
 * INTERESSE em visitar ≠ AGENDAMENTO com dia/horário (Degrau 3, item 3).
 * "Vou até aí" declara INTERESSE — não marca horário. Quem informa dia/hora é `hasSchedulingTemporalValue`
 * (turn-understanding). Manter os dois separados evita o funil rígido: o lead interessado mas sem horário é um
 * estado LEGÍTIMO — vira `handoff_after_closure`, nunca uma pergunta obrigatória de dia/hora.
 */
export function declaresVisitInterestWithoutSchedule(text: string, hasTemporalValue: boolean): boolean {
  return isVisitAct(text) && !hasTemporalValue;
}
