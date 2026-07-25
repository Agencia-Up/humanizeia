// ============================================================================
// future-commitment.ts — DESFECHO TIPADO: uma promessa só vale se existir MECANISMO que a cumpra (F2.80 / missão P0,
// prioridade 3). PURO: sem I/O.
//
// INCIDENTE: o agente fecha turnos com "vou confirmar com a equipe e já te retorno", "te aviso assim que souber",
// "vou verificar isso e te falo". NADA disso cria uma tarefa individual: o Pedro v3 não tem agendador, lembrete,
// fila de callback nem tarefa de verificação posterior. A cadência automática T1/T2/T3 existe, mas é independente
// e não cumpre uma promessa individual. O turno termina e o lead fica esperando um contato que não foi criado. É mentira
// operacional — a mesma classe de defeito de "a visita está agendada" e de "não temos diesel" sem busca.
//
// O QUE O SISTEMA REALMENTE FAZ DEPOIS DESTA MENSAGEM (mecanismos, não intenções):
//   • `handoff`  -> a saga de transferência entrega o lead a um consultor humano, que continua o atendimento.
//   • `send_media` -> a mídia sai NESTE turno (não é futuro).
//   • ...e mais nada. Não existe callback, cron de retorno nem tarefa pendente do próprio agente.
// Logo: CONTATO POSTERIOR só é verdade com `handoff` no plano; VERIFICAÇÃO POSTERIOR só é honesta se a consulta foi
// FEITA neste turno (tool executada) ou se um humano assume (handoff).
//
// CONTRATO tipado (nunca lista de frases proibidas):
//   1. Só ASSERÇÕES contam. Pergunta ("posso verificar pra você?") e oferta ("se quiser, eu confirmo") não prometem.
//   2. PROSPECTIVIDADE: auxiliar de futuro (vou/vamos/irei/vai) + infinitivo, ou forma finita de 1ª pessoa com
//      advérbio prospectivo ("já confirmo", "verifico depois"). Complemento com "que" é asserção do PRESENTE
//      ("já te aviso QUE o carro é 2020") e não promete nada.
//   3. CLASSE do ato prometido, por tabela do domínio:
//        CONTATO POSTERIOR  — retornar/avisar/ligar/contatar/chamar/acionar, "entrar em contato", "dar um retorno".
//                             Nenhum deles pode ser cumprido pela mensagem atual: são atos de DEPOIS.
//        VERIFICAÇÃO POSTERIOR — verificar/confirmar/checar/consultar/conferir/apurar/validar/descobrir/levantar.
//      Verbos de ENTREGA (mandar/passar/mostrar/trazer) ficam FORA: eles podem ser cumpridos na própria mensagem e
//      já têm dono (guarda de foto, lista de oferta, completude do turno). Buscar/procurar também: dono é a guarda
//      de promessa de busca, que tem feedback próprio ("chame stock_search AGORA").
// ============================================================================
import { normalizeText } from "./catalog-utils.ts";

export type FutureCommitmentKind = "later_contact" | "deferred_check";
export type FutureCommitment = { readonly kind: FutureCommitmentKind; readonly sentence: string; readonly cue: string };

/** O que ESTE turno realmente produz — é isto, e só isto, que pode tornar uma promessa verdadeira. */
export type TurnMechanisms = {
  /** Efeito handoff/notify_seller no plano: um humano assume e continua o atendimento. */
  readonly handoffPlanned: boolean;
  /** Alguma tool de FATO retornou ok neste turno (a verificação foi FEITA, não adiada). */
  readonly factObtainedThisTurn: boolean;
};

// Pergunta e oferta não são promessa: quem pergunta não se compromete, quem oferece espera resposta.
const OFFER_MODAL_RX = /\b(?:posso|possa|poderia|podemos|quer\s+que|queira|se\s+quiser|caso\s+queira|se\s+preferir|prefere|deseja|gostaria|quiser)\b/;
const PROSPECTIVE_AUX_RX = /^(?:vou|vamos|irei|iremos|vai|vao|ira|irao)$/;
// Clíticos/advérbios que podem separar o auxiliar do verbo ("vou JÁ TE confirmar").
const AUX_GAP_RX = /^(?:ja|te|lhe|me|nos|se|logo|entao|agora|tambem|so|ainda|depois)$/;
const PROSPECTIVE_ADVERB_RX = /\b(?:ja|jaja|depois|em\s+breve|logo|mais\s+tarde|ainda\s+hoje|amanha|em\s+seguida|assim\s+que|na\s+sequencia|mais\s+pra\s+frente)\b/;

// CONTATO POSTERIOR: atos que, por definição, só podem acontecer DEPOIS desta mensagem.
const LATER_CONTACT_INF_RX = /^(?:retornar|avisar|ligar|contatar|chamar|acionar)$/;
// ⭐`chamar` é o único do grupo com leitura NÃO-COMUNICATIVA corriqueira no domínio: "esse carro vai CHAMAR A
// ATENÇÃO", "chamar de". Sem alvo explícito ele não é ato de contato. Por isso — e só por isso — ele exige o LEAD
// como alvo adjacente (clítico antes, ou "pra você" logo depois). Os demais verbos não são ambíguos assim.
const AMBIGUOUS_CONTACT_RX = /^chamar$|^chamo$|^chamamos$/;
const LEAD_CLITIC_RX = /^(?:te|lhe|o|a)$/;
function contactTargetsLead(tokens: readonly string[], verbIdx: number): boolean {
  if (verbIdx > 0 && LEAD_CLITIC_RX.test(tokens[verbIdx - 1])) return true;
  const after = tokens.slice(verbIdx + 1, verbIdx + 4).join(" ");
  return /\bp(?:ra|ara)\s+(?:voce|vc|ti|o\s+senhor|a\s+senhora)\b/.test(after);
}
const LATER_CONTACT_FINITE_RX = /^(?:retorno|retornamos|aviso|avisamos|ligo|ligamos|chamo|chamamos|contato|contatamos|aciono|acionamos)$/;
const LATER_CONTACT_IDIOM_RX = /\b(?:entrar\s+em\s+contato|entro\s+em\s+contato|entramos\s+em\s+contato|entra\s+em\s+contato|entrara\s+em\s+contato|d(?:ar|ou|amos|a)\s+(?:um\s+)?retorno|d(?:ar|ou|amos|a)\s+(?:uma\s+)?posicao)\b/;
// VERIFICAÇÃO POSTERIOR.
const LATER_CHECK_INF_RX = /^(?:verificar|confirmar|checar|consultar|conferir|apurar|averiguar|validar|descobrir|levantar)$/;
const LATER_CHECK_FINITE_RX = /^(?:verifico|verificamos|confirmo|confirmamos|checo|checamos|consulto|consultamos|confiro|conferimos|apuro|apuramos|averiguo|valido|descubro|levanto)$/;

function sentencesOf(text: string): string[] {
  return text.split(/(?<=[.!?\n])/).map((s) => s.trim()).filter(Boolean);
}

// "já te aviso QUE o carro é 2020" / "confirmo QUE temos" -> asserção do PRESENTE, não promessa de ato futuro.
function introducesComplement(tokens: readonly string[], index: number): boolean {
  return tokens[index + 1] === "que";
}

// ⭐Várias formas finitas são homógrafas de SUBSTANTIVO do mesmo campo: "obrigado pelo CONTATO", "aguardo seu
// RETORNO", "o AVISO chegou". Determinante à esquerda = sintagma NOMINAL, não predicado — logo, não é promessa.
const DETERMINER_RX = /^(?:o|a|os|as|um|uma|uns|umas|ao|aos|pelo|pela|pelos|pelas|do|da|dos|das|no|na|nos|nas|esse|essa|esses|essas|este|esta|aquele|aquela|seu|sua|seus|suas|meu|minha|nosso|nossa|algum|alguma|qualquer|sem|em|de)$/;
function isNounPhraseHead(tokens: readonly string[], index: number): boolean {
  return index > 0 && DETERMINER_RX.test(tokens[index - 1]);
}

/** Todas as promessas de ato FUTURO feitas pelo texto. Uma por sentença (a mais forte). PURO. */
export function detectFutureCommitments(text: string): FutureCommitment[] {
  const found: FutureCommitment[] = [];
  for (const sentence of sentencesOf(text)) {
    if (sentence.includes("?")) continue;                       // (1) pergunta não promete
    const normalized = normalizeText(sentence);
    if (OFFER_MODAL_RX.test(normalized)) continue;              // (1) oferta condicionada não promete
    const tokens = normalized.split(/\s+/).filter(Boolean);
    let contact: string | null = null;
    let check: string | null = null;

    if (LATER_CONTACT_IDIOM_RX.test(normalized)) contact = LATER_CONTACT_IDIOM_RX.exec(normalized)?.[0] ?? "contato futuro";
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      // (2a) auxiliar de futuro + infinitivo da classe (aceita clíticos/advérbios no meio)
      if (PROSPECTIVE_AUX_RX.test(token)) {
        for (let j = i + 1; j < tokens.length && j <= i + 3; j++) {
          if (AUX_GAP_RX.test(tokens[j])) continue;
          if (LATER_CONTACT_INF_RX.test(tokens[j]) && !introducesComplement(tokens, j)
              && (!AMBIGUOUS_CONTACT_RX.test(tokens[j]) || contactTargetsLead(tokens, j))) contact ??= `${token} ${tokens[j]}`;
          else if (LATER_CHECK_INF_RX.test(tokens[j]) && !introducesComplement(tokens, j)) check ??= `${token} ${tokens[j]}`;
          break;
        }
        continue;
      }
      // (2b) forma finita prospectiva. Contato é prospectivo por natureza; verificação exige advérbio de futuro
      // (senão "confirmo o valor" — asserção do presente — viraria promessa).
      if (isNounPhraseHead(tokens, i)) continue;
      if (LATER_CONTACT_FINITE_RX.test(token) && !introducesComplement(tokens, i)
          && (!AMBIGUOUS_CONTACT_RX.test(token) || contactTargetsLead(tokens, i))) contact ??= token;
      else if (LATER_CHECK_FINITE_RX.test(token) && !introducesComplement(tokens, i) && PROSPECTIVE_ADVERB_RX.test(normalized)) check ??= token;
    }
    // Contato posterior é a promessa mais forte da sentença (exige mecanismo mais estrito).
    if (contact) found.push({ kind: "later_contact", sentence, cue: contact });
    else if (check) found.push({ kind: "deferred_check", sentence, cue: check });
  }
  return found;
}

/** A promessa tem mecanismo que a cumpra? Contato posterior só com handoff; verificação, se foi FEITA agora. */
export function commitmentIsSupported(commitment: FutureCommitment, mechanisms: TurnMechanisms): boolean {
  if (commitment.kind === "later_contact") return mechanisms.handoffPlanned;
  return mechanisms.handoffPlanned || mechanisms.factObtainedThisTurn;
}

export function unsupportedCommitments(text: string, mechanisms: TurnMechanisms): FutureCommitment[] {
  return detectFutureCommitments(text).filter((c) => !commitmentIsSupported(c, mechanisms));
}

/** Feedback do deny: diz o que é FALSO e lista os desfechos REAIS. Não entrega frase pronta — quem redige é a LLM. */
export function futureCommitmentFeedback(commitment: FutureCommitment): string {
  const head = commitment.kind === "later_contact"
    ? `Você prometeu um CONTATO POSTERIOR individual ("${commitment.cue}"). Isso é FALSO neste sistema: a conversa não criou agendador, lembrete, fila de callback nem tarefa de retorno. A cadência automática T1/T2/T3 é independente e não cumpre essa promessa. O turno acaba aqui e ele ficaria esperando.`
    : `Você prometeu VERIFICAR DEPOIS ("${commitment.cue}") sem ter consultado nada neste turno. Não existe tarefa pendente no sistema: essa verificação simplesmente nunca aconteceria.`;
  return `${head} Reescreva escolhendo um DESFECHO REAL para este turno: `
    + `(a) responder AGORA com o que você já tem; `
    + `(b) consultar AGORA o que falta (stock_search, vehicle_details, vehicle_photos_resolve, knowledge_search, tenant_business_info) e responder no MESMO turno; `
    + `(c) se um humano deve assumir e a transferência estiver disponível, encaminhar de verdade incluindo o effect handoff neste turno; `
    + `(d) dizer com honestidade que não tem esse dado agora, sem prometer retorno. `
    + `Continue conduzindo você mesmo — pode terminar com UMA pergunta objetiva ao cliente.`;
}
