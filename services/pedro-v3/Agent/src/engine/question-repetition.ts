// ============================================================================
// question-repetition.ts — P0 (ANTI-REPETIÇÃO DE PERGUNTA). PURO, sem I/O.
// Antes de a resposta sair, se a pergunta final busca um SLOT que o estado JÁ CONHECE (ex.: nome), ou repete uma
// pergunta RECENTE do agente, devolve um feedback ao MESMO cérebro (retry) em vez de reperguntar o que já sabe.
// NÃO é if-por-frase: normaliza a pergunta + classifica o SLOT esperado + compara com o histórico accepted-safe.
// O cérebro reescreve; o texto ao lead nunca sai com a mesma pergunta repetida. (Incidente real: "Qual é o seu nome?"
// e "Douglas, o que você procura?" reperguntados turno após turno, mesmo com o nome já conhecido.)
// ============================================================================
import { normalizeText } from "./catalog-utils.ts";

// Slots cuja repergunta o guard cobre (os do incidente + os mais comuns do topo do funil). Extensível.
export type SlotKnownView = {
  readonly nome: boolean;
  readonly interesse: boolean;
  readonly tipoVeiculo: boolean;
  readonly faixaPreco: boolean;
};

export type QuestionRepetition = { readonly repeatedSlot: string | null; readonly feedback: string };

// Frases INTERROGATIVAS do texto (terminam em '?'). Sem '?' -> não é pergunta (não bloqueia afirmações/acolhimentos).
function questionClauses(text: string): string[] {
  return text
    .split(/(?<=\?)/)
    .map((s) => s.trim())
    .filter((s) => s.endsWith("?"));
}

// P1 (audit Codex F2.24): ESCOLHA de um item da lista ofertada ("qual DESSES modelos você prefere?", "qual da lista?",
// "qual dos que te mostrei?") NÃO é repergunta de slot — é o próximo passo legítimo do funil. Referência à oferta =
// nunca bloqueia (mesmo com tipo/interesse já conhecidos). Opera sobre texto JÁ normalizado.
const LIST_CHOICE_RX = /\bdess\w*\b|\bdest\w*\b|\bda\s+lista\b|\bna\s+lista\b|\bda?s\s+op[cç]\w*\b|\bdentre\b|\bqual\s+del[ae]s\b|\bqual\s+dos\b|\bque\s+(?:eu\s+)?(?:te\s+)?(?:mostrei|enviei|passei|listei)\b|\bacima\b/;
function isOfferedListChoice(normQuestion: string): boolean {
  return LIST_CHOICE_RX.test(normQuestion);
}

// SLOT que a pergunta busca (padrão semântico COMPACTO por slot — não frase-a-frase). null = pergunta que não mapeia a
// um slot coberto (não bloqueia). Opera sobre o texto JÁ normalizado (sem acento, minúsculo).
function askedSlot(normQuestion: string): keyof SlotKnownView | null {
  if (/\b(?:seu|teu)\s+nome\b|\bqual\s+(?:e\s+)?(?:o\s+)?(?:seu\s+)?nome\b|\bcomo\s+(?:voce\s+)?(?:se\s+chama|te\s+chama|posso\s+te\s+chamar)\b|\bcom\s+quem\s+(?:eu\s+)?(?:falo|estou\s+falando)\b/.test(normQuestion)) return "nome";
  if (/\bque\s+tipo\s+de\s+(?:carro|veiculo)\b|\bqual\s+(?:tipo\s+de\s+)?(?:carro|veiculo|modelo)\b[^?]*\b(?:procura|busca|quer|interess|deseja|pensa)/.test(normQuestion)) return "tipoVeiculo";
  if (/\b(?:o\s+que|oque)\b[^?]*\b(?:procura|busca|precisa|deseja|interess)/.test(normQuestion) || /\b(?:ta|esta|voce\s+esta)\s+procurando\b/.test(normQuestion) || /\bprocurando\s+em\s+um\s+(?:carro|veiculo)\b/.test(normQuestion)) return "interesse";
  if (/\b(?:qual|que)\b[^?]*\b(?:faixa\s+de\s+preco|orcamento|valor\s+(?:que|pretende)|quanto\s+(?:pretende|quer)\s+(?:gastar|investir))\b/.test(normQuestion)) return "faixaPreco";
  return null;
}

// Devolve a repetição detectada (com feedback acionável ao cérebro) OU null (segue). PURO.
export function detectQuestionRepetition(args: {
  readonly finalText: string;
  readonly slotsKnown: SlotKnownView;
  readonly recentTurns: readonly { readonly role: "lead" | "agent"; readonly text: string }[];
}): QuestionRepetition | null {
  const clauses = questionClauses(args.finalText);
  if (clauses.length === 0) return null;

  // 1) SLOT JÁ CONHECIDO -> não pergunte de novo. ROBUSTO: usa o estado (slots), não depende do histórico chegar a tempo.
  //    "nome conhecido nunca repergunta" é o caso mais visível do incidente. ESCOLHA na lista ofertada é pulada (P1).
  for (const c of clauses) {
    const nc = normalizeText(c);
    if (isOfferedListChoice(nc)) continue;   // "qual desses você prefere?" = escolha de item, não repergunta de slot
    const slot = askedSlot(nc);
    if (slot && args.slotsKnown[slot]) {
      const label = slot === "nome" ? "o NOME do cliente" : slot === "interesse" ? "o que o cliente PROCURA" : slot === "tipoVeiculo" ? "o TIPO de veículo que o cliente quer" : "a FAIXA DE PREÇO do cliente";
      return {
        repeatedSlot: slot,
        feedback: `Você já sabe ${label} (está no contexto/estado). NÃO pergunte isso de novo — use a informação que já tem e AVANCE a conversa para o próximo passo. Se o cliente demonstrou que já respondeu ("já falei", "já disse"), reconheça ("perfeito", "isso") e siga, sem repetir a pergunta.`,
      };
    }
  }

  // 2) MESMA pergunta que uma RECENTE do agente (histórico accepted-safe em recentTurns) -> repetição de decisão. Bloqueia
  //    a repergunta IDÊNTICA (mesmo texto normalizado OU mesmo slot); rephrasing legítimo passa.
  const recentAgentQ = args.recentTurns
    .filter((t) => t.role === "agent")
    .slice(-4)
    .flatMap((t) => questionClauses(t.text))
    .map((q) => normalizeText(q))
    .filter((q) => q.length >= 8);
  if (recentAgentQ.length === 0) return null;
  for (const c of clauses) {
    const nq = normalizeText(c);
    if (nq.length < 8) continue;
    if (isOfferedListChoice(nq)) continue;   // P1: escolha de item ofertado nunca é "repergunta" (o lead navega a lista)
    const slot = askedSlot(nq);
    const dup = recentAgentQ.some((rq) => rq === nq || rq.includes(nq) || nq.includes(rq) || (slot != null && askedSlot(rq) === slot));
    if (dup) {
      return {
        repeatedSlot: slot,
        feedback: `Você JÁ fez essa mesma pergunta há pouco e o cliente pode já ter respondido. NÃO repita a mesma pergunta — avance para o próximo passo. Se ele disse que já respondeu, reconheça e siga, sem reperguntar.`,
      };
    }
  }
  return null;
}
