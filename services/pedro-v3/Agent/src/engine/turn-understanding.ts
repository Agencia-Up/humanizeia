// ============================================================================
// turn-understanding.ts — FONTE ÚNICA da semântica do turno. O cérebro LLM emite um TurnUnderstanding no MESMO ciclo;
// este módulo VALIDA a evidência (cada quote ⊂ bloco; cada capability STATEFUL exige evidência DA PRÓPRIA capability) e
// deriva, SÓ do entendimento VÁLIDO DO CÉREBRO, as decisões operacionais: autorização de foto, ALVO (vinculado ao
// assunto e verificado por modelo), exigência de tool, fingerprint. Auditoria Codex F2.23:
//  - P0-1: o alvo da foto é do ASSUNTO (ordinal/modelo/pronome) e verificado por modelo; um vehicle_photos_resolve só
//    vale se sua key ∈ candidateVehicleKeys do assunto. Fato de foto incompatível é REJEITADO (nunca vira envio).
//  - P0-2: só o understanding DO CÉREBRO (fromBrain) autoriza ação comercial (send_media/tool/foco). O fallback regex
//    é HINT conservador só p/ recuperação textual — NUNCA autoriza mídia/foco/tool. "foto" solta não vira request_photos.
//  - P1: a 1ª compreensão validada TRAVA o assunto do turno (reconcile só adiciona fato; não troca sem evidência nova).
// Módulo PURO, sem ciclo. Memória = contexto/pronome, nunca vence o turno.
// ============================================================================
import { normalizeText, canonicalModel, modelIdentityMatches, modelLikelyTypoMatches, escapeRegex } from "./catalog-utils.ts";
export type KnownVehicleModel = { readonly marca: string | null; readonly modelo: string | null; readonly ano?: number | null };
import { parseOrdinal } from "./ordinal.ts";
import { institutionalTopicsRequested, mentionsContact } from "./turn-domain.ts";
import { isVisitAct } from "./visit-semantics.ts";
import type { ClaimExtractor } from "../domain/decision.ts";
import type { ConversationState } from "../domain/conversation-state.ts";
import type { FrameSignals, TurnUnderstanding, TurnCapability, TurnUnderstandingEvidence, PrimaryIntent, TurnSubjectKind } from "../domain/agent-brain.ts";
import { validateTenantPolicyDecision } from "../domain/tenant-policy-contract.ts";

// ── Validação de evidência ──────────────────────────────────────────────────────────────────────────────────────
function quoteInBlock(block: string, quote: string): boolean {
  const q = normalizeText(quote).trim();
  if (q.length < 2) return false;   // trecho trivial não conta
  return normalizeText(block).includes(q);
}
export type ValidatedUnderstanding = {
  readonly understanding: TurnUnderstanding;
  readonly trusted: boolean;                                   // há ≥1 evidência válida
  readonly fromBrain: boolean;                                 // veio do CÉREBRO (não do fallback) -> pode autorizar ação
  readonly validEvidence: readonly TurnUnderstandingEvidence[];
  readonly semanticIssues?: readonly string[];
};

const VISIT_ACT_RX = /\b(?:visit\w*|agend\w*|marc\w*\s+(?:uma\s+)?visita|presencial\w*)\b/;
const HUMAN_ACT_RX = /\b(?:quero|preciso|gostaria)\b.{0,35}\b(?:falar|atendente|vendedor|consultor|humano|pessoa)\b|\b(?:me\s+)?(?:transfira|transfere|transferir|encaminhe|encaminha|chame|chama)\b/;
const SELECTION_ACT_RX = /\b(?:gost\w*|escolh\w*|fico\s+com)\b|\bquero\s+(?:esse|essa|este|esta)\b|\b(?:item|opcao|numero|posicao)\s*[1-9]\b/;
// Atributo como PERGUNTA/consulta. Um filtro de busca ("quero SUV automatico")
// nao e vehicle_detail apenas por conter a palavra "automatico".
const VEHICLE_DETAIL_ACT_RX = /\bquantos?\s+km\b|quilometr|quanto\s+(?:custa|sai|fica)|\bqual\s+(?:a\s+)?(?:cor|cambio|ano|motor|versao)\b|\b(?:tem|ver|saber)\b[^?.!]{0,28}\b(?:cambio|motor|banco|couro|opcionais)\b|\be\s+(?:automatico|manual|hibrido)\b/;
const FINANCING_ACT_RX = /\bfinanc\w*|\bentrada\b|\bparcela\w*|\bprestac\w*/;
// normalizeText converte os separadores dos tokens internos em espacos.
const SENSITIVE_DATA_ACT_RX = /\b(?:cpf\s+valido\s+ref|data\s+nascimento\s+valida\s+ref|cpf\s+recebido\s+nao\s+armazenado|data\s+nascimento\s+recebida\s+nao\s+armazenada)\b/;

// ── P0-A (CONTINUAÇÃO SEMÂNTICA DE AGENDAMENTO): a LLM entende que "Pra segunda" / "Às 15h" continuam a visita, mas a
//    validação antiga exigia repetir "visita"/"agendar" na evidência e derrubava o understanding (retry -> technical_fallback).
//    Correção: reconhecimento GERAL de VALOR TEMPORAL (dia da semana / relativo / horário / período) + CONTEXTO legítimo de
//    visita. NÃO é frase-específico. A mensagem atual continua sendo a evidência; a memória só fornece a RELAÇÃO semântica. ──
const SCHED_WEEKDAY_RX = /\b(?:segunda|terca|quarta|quinta|sexta|sabado|domingo)(?:\s*-?\s*feira)?\b/;
const SCHED_RELATIVE_DAY_RX = /\b(?:hoje|amanha|depois\s+de\s+amanha|fim\s+de\s+semana|feriado|essa\s+semana|semana\s+que\s+vem|proxima\s+semana|qualquer\s+dia)\b/;
const SCHED_CLOCK_RX = /\b(?:as\s+)?\d{1,2}(?:\s*[:h]\s*\d{2}|\s*(?:h|hs|hrs|horas?))\b|\bmeio[-\s]?dia\b|\bmeia[-\s]?noite\b/;
const SCHED_DAYPART_RX = /\b(?:de\s+manha|pela\s+manha|a\s+tarde|de\s+tarde|final\s+da\s+tarde|comeco\s+da\s+tarde|a\s+noite|de\s+noite|depois\s+do\s+almoco|antes\s+do\s+almoco|no\s+almoco|no\s+comeco\s+da\s+manha)\b/;
// Valor TEMPORAL de agendamento no bloco (dia OU horário OU período). PURO/testável. normalizeText troca ":" por espaço,
// então o horário "HH:MM" (colon) é checado no bloco CRU minúsculo (minutos válidos 00-59) — preciso e sem ambiguidade.
export function hasSchedulingTemporalValue(block: string): boolean {
  const n = normalizeText(block);
  return SCHED_WEEKDAY_RX.test(n) || SCHED_RELATIVE_DAY_RX.test(n) || SCHED_CLOCK_RX.test(n) || SCHED_DAYPART_RX.test(n)
    || /\b\d{1,2}:[0-5]\d\b/.test(block.toLowerCase());
}
// ⭐P1 (falso-verde de resposta visível): DIA e HORÁRIO separados — para o advisory orientar a LLM a acolher o que foi
// dado e perguntar SÓ a dimensão faltante (nunca reperguntar a já informada). PUROS/testáveis.
export function scheduleHasDay(block: string): boolean {
  const n = normalizeText(block);
  return SCHED_WEEKDAY_RX.test(n) || SCHED_RELATIVE_DAY_RX.test(n);
}
export function scheduleHasTime(block: string): boolean {
  const n = normalizeText(block);
  return SCHED_CLOCK_RX.test(n) || SCHED_DAYPART_RX.test(n) || /\b\d{1,2}:[0-5]\d\b/.test(block.toLowerCase());
}
// A ÚLTIMA fala do agente pediu o DIA/HORÁRIO de uma VISITA/agendamento?
function lastAgentAskedVisitSchedule(recentTurns: readonly { readonly role: string; readonly text: string }[]): boolean {
  const lastAgent = [...recentTurns].reverse().find((t) => t.role === "agent")?.text ?? "";
  const n = normalizeText(lastAgent);
  if (!(VISIT_ACT_RX.test(n) || /\bvisit|\bagend/.test(n))) return false;
  return /\b(?:dia|horario|que\s+horas|qual\s+hora|quando|melhor\s+dia|qual\s+dia)\b/.test(n);
}
// ⭐P0-A: existe CONTEXTO LEGÍTIMO de visita em andamento? interesseVisita=true OU pergunta pendente de agendamento OU a
//    última pergunta do agente pediu dia/horário da visita. PURO/testável — a memória só dá a RELAÇÃO, nunca a evidência.
export function hasActiveVisitContext(input: {
  readonly interesseVisita: boolean;
  readonly pendingSchedulingSlot: string | null;
  readonly recentTurns: readonly { readonly role: string; readonly text: string }[];
}): boolean {
  if (input.interesseVisita) return true;
  if (input.pendingSchedulingSlot === "diaHorario" || input.pendingSchedulingSlot === "interesseVisita") return true;
  return lastAgentAskedVisitSchedule(input.recentTurns);
}

// Contexto de validação (opcional): relações semânticas que a MEMÓRIA fornece para o turno atual. Sem ele, só o ato
// EXPLÍCITO no bloco vale (comportamento legado). Nunca autoriza tool/effect — só permite aceitar um understanding coerente.
export type TurnValidationContext = {
  readonly tenantPolicies?: unknown;
  readonly visitActive?: boolean;   // há visita/agendamento em andamento (interesseVisita=true / pergunta pendente / última pergunta pediu dia-horário)
};

function semanticIssuesFor(u: TurnUnderstanding, block: string, validEvidence: readonly TurnUnderstandingEvidence[], context?: TurnValidationContext): string[] {
  const issues: string[] = [];
  const norm = normalizeText(block);
  // A LLM e a autoridade semantica do turno. Nao derive um segundo
  // primaryIntent por regex: mensagens reais frequentemente combinam loja,
  // estoque, foto e selecao no mesmo bloco. As validacoes especificas abaixo
  // continuam provando evidencia para cada acao de risco. Apenas pedidos
  // explicitamente prioritarios (humano e PII, nesta ordem) impedem que uma
  // intencao antiga da memoria tome o turno atual.
  const asksHumanNow = HUMAN_ACT_RX.test(norm) || leadRequestsHumanExplicitly(block);
  const hasSensitiveNow = SENSITIVE_DATA_ACT_RX.test(norm);
  if (asksHumanNow && u.primaryIntent !== "request_human") {
    issues.push(`o bloco atual pede atendimento humano, mas primaryIntent=${u.primaryIntent}`);
  } else if (hasSensitiveNow && u.primaryIntent !== "sensitive_data") {
    issues.push(`o bloco atual contem dado sensivel validado, mas primaryIntent=${u.primaryIntent}`);
  }
  if (u.subject === "selected_vehicle" && u.subjectSource === "current_turn") {
    issues.push("selected_vehicle vem da memoria e nao pode ter subjectSource=current_turn");
  }
  // Coerência interna do ato declarado pela própria LLM: dizer que o ato é
  // busca sem autorizar stock_search no mesmo understanding produz um agente
  // que promete/procura em texto, mas não consulta nada. O engine não infere
  // busca por palavras; ele apenas rejeita um contrato semanticamente
  // incompleto emitido pelo cérebro.
  // primaryIntent and a proposed tool call are already semantic decisions made
  // by the brain. Requiring the same decision again as a capability label made
  // real multi-request turns fail on output-shape redundancy. Current-turn
  // evidence, target resolution and grounding remain mandatory at execution.
  if (u.primaryIntent === "select_vehicle" || u.requestedCapabilities.includes("select")) {
    // O ato semantico de selecionar nao e uma tool: primaryIntent pode ser
    // comprovado por qualquer evidence valida que contenha a escolha. A
    // capability `select`, quando usada para autorizar mutation/effect, segue
    // exigindo evidence propria em selectAuthorized().
    const selectionEvidence = u.primaryIntent === "select_vehicle"
      ? validEvidence
      : validEvidence.filter((e) => e.capability === "select");
    const selectEvidence = normalizeText(selectionEvidence.map((e) => e.quote).join("\n"));
    const coherent = selectEvidence.length > 0 && (SELECTION_ACT_RX.test(selectEvidence) || parseOrdinal(selectEvidence) != null);
    if (!coherent) issues.push("select/select_vehicle sem evidencia de escolha de veiculo no bloco atual");
  }
  if (u.primaryIntent === "visit") {
    const visitEvidence = normalizeText(validEvidence.map((e) => e.quote).join("\n"));
    // ⭐DEGRAU 3: usa a FONTE ÚNICA (visit-semantics). O RX antigo só aceitava visit*/agend*/presencial, então uma
    // afirmação de deslocamento ("vou até aí, sou de SJC") era rejeitada e a LLM que classificasse CORRETAMENTE
    // levava deny -> retry -> fallback técnico. Agora vale a invariante: deslocamento + dêixis de destino = visita.
    const explicitVisit = isVisitAct(visitEvidence);
    // ⭐P0-A (continuação semântica): sem ato explícito de visita, um VALOR TEMPORAL ("pra segunda"/"às 15h") só valida
    //    quando há CONTEXTO legítimo de agendamento em andamento (visitActive). A mensagem atual é a evidência; a memória
    //    fornece só a relação. Sem contexto, "segunda" isolada NÃO inicia agendamento (fica o issue).
    const contextualScheduling = context?.visitActive === true && hasSchedulingTemporalValue(block);
    if (!explicitVisit && !contextualScheduling) issues.push("visit sem evidencia de visita/agendamento no bloco atual");
  }
  if (u.primaryIntent === "request_human") {
    const humanEvidence = normalizeText(validEvidence.map((e) => e.quote).join("\n"));
    // ⭐MISSÃO FINAL: o ATO de pedir humano está no BLOCO atual. Valida quando a evidência casa HUMAN_ACT_RX OU quando o
    //   próprio bloco pede humano explicitamente (RX ESTRITO: alvo humano concreto/verbo de transferência — NÃO casa "quero
    //   falar sobre o preço"). O LLM às vezes cita um span curto ("vendedor") que sozinho não casa o ATO; a fala LITERAL do
    //   lead é a evidência. Proveniência intacta (o pedido está no turno atual) — evita que um pedido de humano fique
    //   untrusted e o handoff nunca materialize (viraria "qual seu nome?" ou technical_fallback).
    if (!HUMAN_ACT_RX.test(humanEvidence) && !leadRequestsHumanExplicitly(block)) issues.push("request_human sem pedido de humano no bloco atual");
  }
  if (u.primaryIntent === "sensitive_data" && !SENSITIVE_DATA_ACT_RX.test(norm)) {
    issues.push("sensitive_data sem token sensivel validado no bloco atual");
  }
  const policyIssues = validateTenantPolicyDecision(u.policyDecision, block, context?.tenantPolicies);
  issues.push(...policyIssues.map((issue) => `declaração de política inválida: ${issue.message}`));
  return issues;
}

export function validateTurnUnderstanding(u: TurnUnderstanding, block: string, fromBrain: boolean, context?: TurnValidationContext): ValidatedUnderstanding {
  const validEvidence = (u.evidence ?? []).filter((e) => e != null && typeof e.quote === "string" && quoteInBlock(block, e.quote));
  const semanticIssues = semanticIssuesFor(u, block, validEvidence, context);
  return { understanding: u, trusted: validEvidence.length > 0 && semanticIssues.length === 0, fromBrain, validEvidence, semanticIssues };
}

export function understandingAuthorityFeedback(v: ValidatedUnderstanding): string | null {
  const issues = v.semanticIssues ?? [];
  if (issues.length === 0) return null;
  return `CONFLITO DE AUTORIDADE DO TURNO ATUAL: ${issues.join("; ")}. Releia SOMENTE o bloco atual; use memoria apenas como contexto e reemita understanding+decisao coerentes. Nao selecione veiculo nem retome foto/funil antigo quando o bloco atual declara outra acao.`;
}
// P1: capability STATEFUL exige evidência DA PRÓPRIA capability (não geral). "oi" ou evidência de outra capability não
// autoriza send_photos.
function capabilityHasOwnEvidence(v: ValidatedUnderstanding, cap: TurnCapability): boolean {
  return v.validEvidence.some((e) => e.capability === cap);
}
// COERÊNCIA de evidência de FOTO (substantivo, sem flexão): a evidência do send_photos TEM de mencionar foto/imagem.
const PHOTO_EVIDENCE_RX = /\bfotos?\b|\bimagens?\b|\bm[ií]dias?\b/;
function hasPhotoEvidence(v: ValidatedUnderstanding): boolean {
  return v.validEvidence.some((e) => e.capability === "send_photos" && PHOTO_EVIDENCE_RX.test(normalizeText(e.quote)));
}

// ── Negação de foto ESCOPADA POR CLÁUSULA (fail-closed): "não quero foto"/"foto depois" nunca envia mídia. ──
const PHOTO_WORD = /\b(?:fotos?|imagens?)\b/u;
const NEG_BEFORE = /\b(?:nao|nem|sem)\b/u;
const DEFERRAL = /\b(?:depois|mais tarde|outra hora|amanha|daqui a pouco|agora nao)\b/u;
const CLAUSE_DELIM = /[.,;:!?\n]/g;
export function isPhotoDeclined(block: string): boolean {
  const norm = normalizeText(block);
  const m = PHOTO_WORD.exec(norm);
  if (!m) return DEFERRAL.test(norm) && /\b(?:foto|imagem)/.test(norm);
  const p = m.index;
  let clauseStart = 0;
  const head = norm.slice(0, p);
  CLAUSE_DELIM.lastIndex = 0;
  let dm: RegExpExecArray | null;
  while ((dm = CLAUSE_DELIM.exec(head)) !== null) clauseStart = dm.index + 1;
  if (NEG_BEFORE.test(norm.slice(clauseStart, p))) return true;
  const tail = /[.,;:!?\n]/.exec(norm.slice(p));
  const clauseEnd = tail ? p + tail.index : norm.length;
  return DEFERRAL.test(norm.slice(clauseStart, clauseEnd));
}

// ── P0-2: AUTORIZAÇÃO de ENVIO de foto. SÓ com understanding DO CÉREBRO (fromBrain) + capability send_photos com
//    evidência PRÓPRIA que menciona foto + não é recall + não há negação. O fallback (fromBrain=false) NUNCA autoriza. ──
// requireBrain = central_active+llmFirst (produção): SÓ o understanding do cérebro autoriza. Sem llmFirst (replay/legado)
// o fallback validado pode autorizar (mantém a evidência coerente de foto, sem o requisito fromBrain).
export function authorizesPhotoSend(v: ValidatedUnderstanding | null, block: string, requireBrain: boolean): boolean {
  if (!v) return false;
  if (requireBrain && !v.fromBrain) return false;                    // em llmFirst, fallback/ausente nunca autoriza mídia
  const u = v.understanding;
  if (u.primaryIntent === "recall_photos") return false;             // pergunta de memória nunca envia
  if (isPhotoDeclined(block)) return false;                          // negação/adiamento = fail-closed
  const wantsPhotos = u.requestedCapabilities.includes("send_photos") || u.primaryIntent === "request_photos";
  return wantsPhotos && capabilityHasOwnEvidence(v, "send_photos") && hasPhotoEvidence(v);
}
// Pergunta de MEMÓRIA de foto (não envia mídia; nomeia o veículo lembrado).
export function isPhotoRecall(v: ValidatedUnderstanding | null): boolean {
  return v?.understanding.primaryIntent === "recall_photos" || (v?.understanding.requestedCapabilities.includes("recall") ?? false);
}
// ── MISSÃO PII (P0-B): pedido EXPLÍCITO de humano/vendedor/atendente como ATO AUTÔNOMO. Autoridade = o
//    CÉREBRO (primaryIntent request_human OU capability handoff) com evidência VALIDADA no bloco atual —
//    nunca regex comercial concorrente. Vence o funil: não exige CPF/nascimento/qualificação. ─────────────────
// ⭐MISSÃO FINAL (backstop determinístico do handoff): pedido EXPLÍCITO de humano NO BLOCO do lead. Usado APENAS para
//    NÃO deixar um pedido de humano virar coleta de dado quando o entendimento do cérebro vier fraco/sem evidência
//    (o LLM às vezes responde "qual seu nome?" a "quero falar com um vendedor" sem propor handoff nem prometê-lo no texto,
//    e aí nem requestsHuman nem promisesHumanHandoff disparam). É MAIS ESTRITO que HUMAN_ACT_RX de propósito: exige um alvo
//    humano concreto (vendedor/atendente/consultor/gerente/humano) OU verbo de transferência OU "falar com uma pessoa/
//    alguém/a equipe" — NÃO casa "quero falar sobre o preço". Não decide intenção nem escreve resposta: só garante que a
//    guarda de handoff (feedback+retry) rode para o LLM RE-AUTORAR incluindo o efeito. Autoridade = a fala LITERAL do lead.
const HUMAN_REQUEST_EXPLICIT_RX = /\b(?:vendedor|atendente|consultor|gerente)\b|\bhumano\b|\b(?:me\s+)?(?:transfir|transfer|encaminh|repass)\w*|\bfalar\s+com\s+(?:uma?\s+(?:pessoa|atendente|vendedor|consultor)|algu[eé]m|um\s+humano|a\s+equipe|o\s+time)\b/;
const HUMAN_REQUEST_NATURAL_RX = /\b(?:pode\s+|por\s+favor\s+|por\s+gentileza\s+)?(?:manda|mandem|chama|chamem|envia|enviem)\s+(?:um[ae]?\s+)?(?:pessoa|alguem|vendedor|atendente|consultor|humano)\b/;
export function leadRequestsHumanExplicitly(block: string): boolean {
  const n = normalizeText(block);
  return HUMAN_REQUEST_EXPLICIT_RX.test(n) || HUMAN_REQUEST_NATURAL_RX.test(n);
}
export function requestsHuman(v: ValidatedUnderstanding | null): boolean {
  if (!v || !v.fromBrain || !v.trusted) return false;
  // An autonomous qualified handoff is not automatically evidence that the
  // LEAD requested a human. A handoff capability counts here only when its own
  // current-block evidence actually contains an explicit human request.
  if (v.understanding.primaryIntent === "request_human") return true;
  const handoffEvidence = normalizeText(v.validEvidence
    .filter((e) => e.capability === "handoff")
    .map((e) => e.quote)
    .join("\n"));
  return v.understanding.requestedCapabilities.includes("handoff") && (HUMAN_ACT_RX.test(handoffEvidence) || HUMAN_REQUEST_NATURAL_RX.test(handoffEvidence));
}

export function commercialToolAllowedForHumanRequest(v: ValidatedUnderstanding | null, tool: string): boolean {
  if (!requestsHuman(v)) return true;
  return !["stock_search", "vehicle_details", "vehicle_photos_resolve"].includes(tool);
}

export function humanRequestDecisionFeedback(input: {
  readonly requested: boolean;
  readonly handoffPlannable: boolean;
  readonly proposedEffectKinds: readonly string[];
  readonly composedText: string;
}): string | null {
  if (!input.requested) return null;
  const hasHandoff = input.proposedEffectKinds.some((kind) => kind === "handoff" || kind === "notify_seller");
  const text = normalizeText(input.composedText);
  const collectsMoreData = /\b(?:cpf|nascimento|entrada|parcela|troca|seu nome|sobrenome|cidade)\b/.test(text);
  if (input.handoffPlannable) {
    return hasHandoff
      ? null
      : "O cliente pediu atendimento humano neste bloco. A transferencia esta disponivel: reconheca o pedido, agradeca e inclua o effect handoff com reason explicit_human_request no MESMO final. Nao colete nenhum dado adicional.";
  }
  const acknowledgesRequest = /\b(?:atendente|vendedor|humano|transfer|encaminh|equipe|pessoa)\b/.test(text);
  return hasHandoff || collectsMoreData || !acknowledgesRequest
    ? "O cliente pediu atendimento humano, mas o precheck informou indisponibilidade. Reconheca o pedido com transparencia e ofereca continuar ajudando ou registrar retorno. Nao proponha handoff e nao colete CPF, nascimento, nome, troca, entrada ou parcela."
    : null;
}

export function sensitiveAnswerCompletenessFeedback(
  kinds: readonly ("cpf" | "birthDate")[],
  composedText: string,
): string | null {
  if (kinds.length === 0) return null;
  const text = normalizeText(composedText);
  if (/\b(?:cpf_valido_ref|data_nascimento_valida_ref)\b|\b[a-f0-9]{32,64}\b/.test(text)) {
    return "A resposta expos uma referencia interna de dado sensivel. Reescreva sem token/ref e sem repetir o valor.";
  }
  const acknowledges = /\b(?:receb|anot|registr|confirm)/.test(text);
  if (!acknowledges) {
    const label = kinds.includes("cpf") && kinds.includes("birthDate")
      ? "CPF e data de nascimento"
      : kinds.includes("cpf") ? "CPF" : "data de nascimento";
    return `O cliente acabou de fornecer ${label}. Reconheca explicitamente que recebeu/registrou o dado, sem repetir o valor nem a referencia interna; depois avance com no maximo UMA pergunta util.`;
  }
  return null;
}

// ── P0 (RESOLUÇÃO ÚNICA de veículo): AUTORIZAÇÃO DETERMINÍSTICA por ORDINAL RESOLVIDO. Complementa authorizesPhotoSend
//    NO caso "me manda foto do segundo": o alvo veio de turn_ordinal (índice EXATO da última lista renderizada pela loja
//    = grounding MÁXIMO) E o texto do lead tem pedido EXPLÍCITO de foto (verbo de envio/ver + "foto"). Isto NÃO é o "foto
//    solta" que o P0-2 rejeita — aqui o alvo é o item N que a loja ACABOU de mostrar, não um palpite de modelo. Some o
//    "de qual carro?" quando o ordinal já respondeu isso. Fail-closed: negação de foto barra; SÓ turn_ordinal autoriza
//    (nunca modelo inferido/pronome/selecionado antigo). PURO. (Definido com forward-ref a PHOTO_REQUEST_STEM abaixo.) ──
export function authorizesPhotoByResolvedOrdinal(target: TargetResolution, block: string): boolean {
  if (target.kind !== "resolved" || target.source !== "turn_ordinal") return false;
  if (isPhotoDeclined(block)) return false;
  return PHOTO_REQUEST_STEM.test(normalizeText(block));
}
// ── P0-A (audit Codex smoke CTWA): FOTO PRONOMINAL do veículo EXATO do anúncio. Quando o anúncio tem marca/modelo/ANO e o
//    estoque tem EXATAMENTE esse veículo (match único, aterrado), o alvo do anúncio (source="ad_reference") é a referência
//    do pedido pronominal de foto ("me manda fotos dele/desse/esse"). Grounding MÁXIMO (o anúncio nomeou o carro, o estoque
//    tem exatamente ele) — narrow, como o turn_ordinal. Fail-closed: negação de foto barra; só ad_reference autoriza. ──
export function authorizesPhotoByAdReference(target: TargetResolution, block: string): boolean {
  if (target.kind !== "resolved" || target.source !== "ad_reference") return false;
  if (isPhotoDeclined(block)) return false;
  return PHOTO_REQUEST_STEM.test(normalizeText(block));
}
// ── P0 (audit Codex smoke CTWA #2): AUTORIZAÇÃO DE FOTO POR ALVO RESOLVIDO. Generaliza ordinal+ad_reference: quando o LEAD
//    pede foto NESTE turno (verbo de envio/ver + "foto"; negação barra) E o alvo está RESOLVIDO por QUALQUER fonte aterrada
//    (anúncio/ordinal/seleção/modelo — target.kind==="resolved"), o envio é autorizado — DIRIGIDO pelo pedido do lead, não
//    pela cooperação do cérebro (que às vezes diz "não localizei" sem consultar). Mesma exigência de grounding (alvo ÚNICO):
//    ambíguo/ausente -> não autoriza (o fluxo pergunta qual). Fail-closed. Superset de ByResolvedOrdinal/ByAdReference. PURO. ──
// O LEAD pediu foto NESTE turno (verbo de envio/ver + "foto"; negação barra)? Source-agnostic — não depende de alvo nem
// do cérebro. Base de authorizesPhotoByResolvedTarget e do clarify de conjunto-candidato do anúncio (Fix C). PURO.
export function leadRequestsPhoto(block: string): boolean {
  if (isPhotoDeclined(block)) return false;
  return PHOTO_REQUEST_STEM.test(normalizeText(block));
}
function lastAgentAskedPhotoTarget(state?: ConversationState | null): boolean {
  const lastAgent = [...(state?.recentTurns ?? [])].reverse().find((t) => t.role === "agent")?.text ?? "";
  const n = normalizeText(lastAgent);
  if (!/\b(?:fotos?|imagens?)\b/.test(n)) return false;
  return /\b(?:qual|quais|de\s+qual|numero|modelo|ano|carro|lista|opcao|item)\b/.test(n);
}
function answersPendingPhotoTargetQuestion(target: TargetResolution, state?: ConversationState | null): boolean {
  if (target.kind !== "resolved") return false;
  if (!lastAgentAskedPhotoTarget(state)) return false;
  return target.source === "turn_ordinal" || target.source === "turn_offer_reference" || target.source === "turn_explicit_model" || target.source === "ad_reference";
}
// ⭐Codex rodada 2 (smoke T4): "Sim" ACEITANDO a oferta de foto que o AGENTE acabou de fazer ("quer que eu te
// envie as fotos dele?") — com pergunta ÚNICA por design (dupla é deny), o aceite booleano curto é inequívoco.
// Exige: oferta de foto interrogativa na última fala do agente + afirmação curta + alvo RESOLVIDO (selected/
// carryover). Negação/adiamento continua barrando (isPhotoDeclined). Determinístico e grounded. PURO.
const SHORT_AFFIRMATION_RX = /^(?:sim|pode|pode sim|pode ser|quero|quero sim|manda|mande|envia|envie|claro|com certeza|por favor|bora|ok|okay|isso|aceito|show|beleza|top)[.!\s]*$/;
export function acceptsAgentPhotoOffer(block: string, state?: ConversationState | null): boolean {
  if (isPhotoDeclined(block)) return false;
  const lastAgent = [...(state?.recentTurns ?? [])].reverse().find((t) => t.role === "agent")?.text ?? "";
  if (!lastAgent.trim().endsWith("?")) return false;
  const n = normalizeText(lastAgent);
  if (!/\b(?:fotos?|imagens?)\b/.test(n)) return false;
  return SHORT_AFFIRMATION_RX.test(normalizeText(block).trim());
}
export function authorizesPhotoByResolvedTarget(target: TargetResolution, block: string, state?: ConversationState | null): boolean {
  return target.kind === "resolved" && (leadRequestsPhoto(block) || answersPendingPhotoTargetQuestion(target, state) || acceptsAgentPhotoOffer(block, state));
}
// ── P0-2: AUTORIZAÇÃO TIPADA POR TOOL. Cada tool comercial exige a capability PRÓPRIA + evidência própria, do CÉREBRO.
//    Fonte única: só a intenção declarada+evidenciada autoriza a ação. (tenant_business_info = institucional, à parte.) ──
const TOOL_CAPABILITY: Record<string, TurnCapability> = {
  stock_search: "stock_search", vehicle_details: "vehicle_details", vehicle_photos_resolve: "send_photos", knowledge_search: "knowledge_search",
};
export function toolCapabilityAuthorized(v: ValidatedUnderstanding | null, tool: string): boolean {
  if (!v || !v.fromBrain || !v.trusted) return false;
  const cap = TOOL_CAPABILITY[tool];
  if (!cap) return false;
  if (v.understanding.requestedCapabilities.includes(cap) && capabilityHasOwnEvidence(v, cap)) return true;

  // A capability is part of the LLM's decision contract, not decoration. A
  // valid quote alone must not let the engine turn an incomplete intent label
  // into a commercial tool call. The caller receives feedback and the LLM can
  // re-emit a complete decision for the current block.
  if (tool === "stock_search") return false;
  if (tool === "vehicle_details") return false;
  if (tool === "vehicle_photos_resolve") return false;
  if (tool === "knowledge_search") return v.understanding.primaryIntent !== "smalltalk" && v.validEvidence.length > 0;
  return false;
}
// select_vehicle_focus proposto pela LLM exige capability select + evidência própria (ordinal determinístico à parte).
export function selectAuthorized(v: ValidatedUnderstanding | null): boolean {
  return !!v && v.fromBrain && v.understanding.requestedCapabilities.includes("select") && capabilityHasOwnEvidence(v, "select");
}
// O turno é uma BUSCA de estoque? (autoridade do requiredToolBeforeFinal) — exige capability stock_search com evidência própria.
export function isStockSearchTurn(v: ValidatedUnderstanding | null): boolean {
  return toolCapabilityAuthorized(v, "stock_search");
}

// ── AD-1 (2026-07-18): o turno é um PEDIDO INSTITUCIONAL? Autoridade SEMÂNTICA para exigir tenant_business_info.
//
// DEFEITO CORRIGIDO: quem exigia a tool institucional era `frame.signals.mentionsStore`, um regex que casa \bloja\b em
// QUALQUER posição — inclusive no uso locativo puro. "Vcs tem na loja uma HRV?" é pergunta de ESTOQUE; o engine exigia
// informação da LOJA, a LLM (corretamente) nunca chamava a tool institucional, e o turno queimava os passos até
// `retry_exhausted` -> "Tive uma instabilidade" (incidente de produção 18/07, lead 12 98819-0301).
//
// INVARIANTE: exigência de tool nasce do ATO DECLARADO pela LLM com evidência do bloco atual — nunca de uma palavra
// isolada. Menção léxica a "loja"/"endereço"/"horário" segue existindo como FATO DE CONTEXTO no frame (a LLM lê e
// decide), mas não manda no engine. Espelha `isStockSearchTurn`, que já migrou para autoridade semântica.
//
// tenant_business_info NÃO está em TOOL_CAPABILITY (é institucional, fora do gate de tools comerciais), então a checagem
// é explícita aqui em vez de reusar toolCapabilityAuthorized. PURO.
export function isStoreInfoTurn(v: ValidatedUnderstanding | null): boolean {
  if (!v || !v.fromBrain || !v.trusted) return false;
  if (v.understanding.requestedCapabilities.includes("institutional_info") && capabilityHasOwnEvidence(v, "institutional_info")) return true;
  return v.understanding.primaryIntent === "institutional" && v.validEvidence.length > 0;
}

// ── P0-1: ALVO do turno VINCULADO ao ASSUNTO e VERIFICADO por modelo. O modelo do assunto vem do CLAIM ESCRITO (tem
//    precedência); subjectValue que CONFLITA com o claim escrito torna o entendimento INVÁLIDO (kind=conflict, zero mídia);
//    inferência (typo, sem claim exato) só vira candidato se CONFIRMADA por stock_search/catálogo. vehicle_photos_resolve
//    NUNCA confirma o modelo sozinho (knownModels só vem de stock_search/vehicle_details/oferta/identidade/seleção). ──
export type TargetResolutionSource = "turn_ordinal" | "turn_offer_reference" | "turn_explicit_model" | "carryover_selected" | "single_offer" | "ad_reference" | "ambiguous" | "none";
export type TargetResolution =
  | { readonly kind: "resolved"; readonly vehicleKey: string; readonly source: TargetResolutionSource; readonly candidateVehicleKeys: readonly string[]; readonly subjectModel: string | null }
  | { readonly kind: "ambiguous"; readonly candidateVehicleKeys: readonly string[]; readonly subjectModel: string | null }
  | { readonly kind: "conflict"; readonly subjectModel: null }   // subjectValue conflita com o modelo escrito -> inválido
  | { readonly kind: "none"; readonly subjectModel: string | null };
// Concordância subjectValue × claim ESCRITO (só p/ detectar CONFLITO): mesma identidade canônica OU diferem apenas pelo
// PREFIXO de marca ("chevroletonix" ~ "onix"). NUNCA por sufixo semântico ("onix" ≠ "onixplus"). A resolução de candidato
// (autorização real) é ESTRITA via modelIdentityMatches contra o modelo estruturado; isto só evita conflito FALSO.
function modelsAgreeUpToBrand(a: string, b: string): boolean {
  const ca = canonicalModel(a), cb = canonicalModel(b);
  if (!ca || !cb) return false;
  if (ca === cb) return true;
  const [long, short] = ca.length >= cb.length ? [ca, cb] : [cb, ca];
  return long.endsWith(short);   // marca é PREFIXO; "onixplus" NÃO termina em "onix" -> Onix≠Onix Plus continua conflito
}
function uniqueModelCandidates(subject: string, knownModels: ReadonlyMap<string, KnownVehicleModel>, fuzzy: boolean): string[] {
  const hits = [...knownModels.entries()].filter(([, m]) => fuzzy ? modelLikelyTypoMatches(subject, m) : modelIdentityMatches(subject, m)).map(([k]) => k);
  return [...new Set(hits)];
}

function explicitVehicleYear(block: string): number | null {
  const years = normalizeText(block).match(/\b(?:19|20)\d{2}\b/g)?.map(Number)
    .filter((year) => year >= 1990 && year <= 2035) ?? [];
  return years.length === 1 ? years[0] : null;
}

function leadTypoSubjectCandidate(block: string, knownModels: ReadonlyMap<string, KnownVehicleModel>, allowBareModelTypo = false): string | null {
  if (!leadRequestsPhoto(block) && !allowBareModelTypo) return null;
  const words = normalizeText(block).split(/\s+/).filter((w) => w.length >= 3 && !/^(?:foto|fotos|imagem|imagens|manda|mande|mandar|envia|enviar|mostra|mostrar|quero|ver|do|da|de|dos|das|me|o|a|um|uma|ele|ela|dele|dela)$/.test(w));
  const terms = new Set<string>();
  for (let i = 0; i < words.length; i++) {
    terms.add(words[i]);
    if (i + 1 < words.length) terms.add(`${words[i]}${words[i + 1]}`);
    if (i + 2 < words.length) terms.add(`${words[i]}${words[i + 1]}${words[i + 2]}`);
  }
  const viable = [...terms].filter((term) => uniqueModelCandidates(term, knownModels, true).length > 0);
  if (viable.length !== 1) return null;
  return viable[0];
}
export function resolveTurnTarget(args: {
  readonly understanding: TurnUnderstanding | null;
  readonly leadMessage: string;
  readonly state: ConversationState;
  readonly claimExtractor: ClaimExtractor;
  readonly knownModels: ReadonlyMap<string, KnownVehicleModel>;   // key -> {marca,modelo} ESTRUTURADO (fato/oferta/identidade)
}): TargetResolution {
  const { understanding: u, leadMessage, state, claimExtractor, knownModels } = args;
  const offerItems = state.lastRenderedOfferContext?.items ?? [];
  const pendingPhotoTargetAnswer = lastAgentAskedPhotoTarget(state);
  const uModel = u?.subject === "explicit_model" && u.subjectValue ? u.subjectValue : null;
  const textModels = claimExtractor.extractClaims(leadMessage).filter((c) => c.kind === "model" || c.kind === "brand_model").map((c) => c.text);

  // Uma afirmação curta que aceita a pergunta única de fotos não introduz um
  // novo veículo. O selected já aterrado é a autoridade do alvo; um
  // subjectValue especulativo do modelo não pode apagar esse contexto.
  const selectedForAcceptedPhoto = state.vehicleContext.selected?.key ?? null;
  if (selectedForAcceptedPhoto && acceptsAgentPhotoOffer(leadMessage, state)) {
    return { kind: "resolved", vehicleKey: selectedForAcceptedPhoto, source: "carryover_selected", candidateVehicleKeys: [selectedForAcceptedPhoto], subjectModel: null };
  }

  // A) ORDINAL explícito -> key EXATA da lista estruturada (desambigua sozinho; independe de modelo).
  const ord = parseOrdinal(leadMessage);
  if (ord && ord.value >= 1 && ord.value <= offerItems.length) {
    const key = offerItems[ord.value - 1].vehicleKey;
    return { kind: "resolved", vehicleKey: key, source: "turn_ordinal", candidateVehicleKeys: [key], subjectModel: uModel ?? textModels[0] ?? null };
  }
  // The LLM declares the semantic reference; this only resolves it against the
  // exact rendered offer. It does not classify a turn or authorize a search.
  if (u?.subject === "offer_reference") {
    const normalizedBlock = normalizeText(leadMessage);
    type OfferReferenceField = "marca" | "modelo" | "cor" | "ano";
    const fields: readonly OfferReferenceField[] = ["marca", "modelo", "cor", "ano"];
    const readReference = (item: typeof offerItems[number], field: OfferReferenceField): string => {
      const value = item[field];
      return normalizeText(value == null ? "" : String(value));
    };
    const appearsInBlock = (reference: string): boolean =>
      reference.length > 1 && new RegExp(`(^|\\s)${escapeRegex(reference)}(?=\\s|$)`).test(normalizedBlock);
    // Every grounded attribute the lead actually cited must be true for the
    // resolved item. "Corolla 2016" therefore narrows to that year instead of
    // matching every Corolla, while "o azul" stays a valid unique reference.
    const mentionedReferences = [...new Map(
      offerItems.flatMap((item) => fields.map((field) => ({ field, value: readReference(item, field) })))
        .filter((reference) => appearsInBlock(reference.value))
        .map((reference) => [`${reference.field}:${reference.value}`, reference] as const),
    ).values()];
    const matches = mentionedReferences.length === 0
      ? []
      : offerItems.filter((item) => mentionedReferences.every((reference) => readReference(item, reference.field) === reference.value));
    if (matches.length === 1) {
      return {
        kind: "resolved",
        vehicleKey: matches[0].vehicleKey,
        source: "turn_offer_reference",
        candidateVehicleKeys: [matches[0].vehicleKey],
        subjectModel: matches[0].modelo ?? null,
      };
    }
    if (matches.length > 1) return { kind: "ambiguous", candidateVehicleKeys: matches.map((item) => item.vehicleKey), subjectModel: null };
  }
  // Uma unica oferta renderizada e um pedido explicito de fotos formam uma
  // referencia inequívoca mesmo sem "dele". Isto e resolucao de contexto
  // estruturado (vehicleKey da lista), nao inferencia por palavra ou memoria
  // antiga. Listas com 2+ itens continuam exigindo ordinal/modelo.
  if (offerItems.length === 1 && leadRequestsPhoto(leadMessage) && textModels.length === 0) {
    const key = offerItems[0].vehicleKey;
    return { kind: "resolved", vehicleKey: key, source: "single_offer", candidateVehicleKeys: [key], subjectModel: null };
  }
  // Determinação do MODELO do assunto (precedência do CLAIM escrito; conflito -> inválido). Identidade EXATA (canonicalModel),
  // NUNCA substring: "Onix"!="Onix Plus", "HB20"!="HB20S", "C3"!="C3 Aircross".
  let subjectModel: string | null = null;
  if (textModels.length > 0) {
    // claim escrito é AUTORITATIVO. subjectValue que NÃO concorda com nenhum claim escrito -> CONFLITO (inválido).
    // "Concorda" = mesma identidade canônica OU só difere pelo PREFIXO de marca ("Chevrolet Onix" ~ "Onix"); NUNCA por
    // sufixo semântico ("Onix"≠"Onix Plus"). A resolução de CANDIDATO abaixo segue ESTRITA (modelIdentityMatches).
    if (uModel && !textModels.some((tm) => modelsAgreeUpToBrand(uModel, tm))) return { kind: "conflict", subjectModel: null };
    subjectModel = textModels[0];
  } else if (uModel) {
    // inferência (typo): só é assunto se CONFIRMADA por knownModels (identidade EXATA) OU pelo catálogo (claimExtractor).
    const inKnown = [...knownModels.values()].some((m) => modelIdentityMatches(uModel, m));
    const typoKnown = uniqueModelCandidates(uModel, knownModels, true).length > 0;
    const inCatalog = claimExtractor.extractClaims(uModel).some((c) => c.kind === "model" || c.kind === "brand_model");
    if (inKnown || typoKnown || inCatalog) subjectModel = uModel;   // senão: inferência não confirmada -> não vira assunto (fail-closed)
  }
  if (!subjectModel) subjectModel = leadTypoSubjectCandidate(leadMessage, knownModels, pendingPhotoTargetAnswer);

  // B) MODELO do assunto -> candidatos por IDENTIDADE EXATA primeiro; se nao houver, tolera typo com candidato unico.
  // Modelo diferente NUNCA herda selected. A tolerancia nao usa substring e preserva Onix!=Onix Plus/HB20!=HB20S.
  if (subjectModel) {
    let cands = uniqueModelCandidates(subjectModel, knownModels, false);
    if (cands.length === 0) cands = uniqueModelCandidates(subjectModel, knownModels, true);
    const statedYear = explicitVehicleYear(leadMessage);
    if (statedYear != null) cands = cands.filter((key) => knownModels.get(key)?.ano === statedYear);
    if (cands.length === 1) return { kind: "resolved", vehicleKey: cands[0], source: "turn_explicit_model", candidateVehicleKeys: cands, subjectModel };
    if (cands.length > 1) return { kind: "ambiguous", candidateVehicleKeys: cands, subjectModel };
    return { kind: "none", subjectModel };   // modelo do assunto sem candidato conhecido -> busca antes (nunca herda outro)
  }
  // Se o cérebro afirmou um modelo explícito mas ele não foi confirmado (nem claim escrito nem catálogo) -> não herda selected.
  if (uModel) return { kind: "none", subjectModel: uModel };
  // C) PRONOME / sem novo modelo -> selecionado (nunca em troca de assunto).
  const sel = state.vehicleContext.selected?.key ?? null;
  // ⭐Codex rodada 2 (smoke T4): uma AFIRMAÇÃO CURTA ("Sim"/"pode"/"quero") NUNCA é troca de assunto por
  // definição — o isTopicChange do cérebro em bloco monossílabo não é confiável e negava o carryover do
  // selected (o "dele" da oferta de foto que o próprio agente fez), derrubando o alvo para "de qual carro?".
  if (sel && (u?.isTopicChange !== true || SHORT_AFFIRMATION_RX.test(normalizeText(leadMessage).trim()))) return { kind: "resolved", vehicleKey: sel, source: "carryover_selected", candidateVehicleKeys: [sel], subjectModel: null };
  return { kind: "none", subjectModel: null };
}
// Uma vehicleKey (send_media autorado OU photo fact) é compatível com o alvo do assunto? conflict/none -> nunca.
export function targetAcceptsKey(target: TargetResolution, key: string): boolean {
  if (target.kind === "resolved") return target.vehicleKey === key || target.candidateVehicleKeys.includes(key);
  // Ambiguidade nao autoriza a LLM a escolher uma unidade arbitraria. O lead
  // precisa desambiguar por ano/ordinal ou selecionar um veiculo primeiro.
  return false;   // ambiguous/conflict/none -> nenhuma key aceita (fail-closed)
}

// ── P1 (trava do assunto): a 1ª compreensão validada é a BASE do turno. Refinamento só ADICIONA fato (subjectValue) —
//    não troca primaryIntent/subject sem EVIDÊNCIA NOVA (quote não vista na base). Ex.: search_stock -> request_photos
//    sem nova evidência de foto = mantém search_stock. ──
// A response-validation retry may replace the base understanding when the
// same LLM anchors its correction in the current block. Tool-result loops do
// not set this flag, so their subject lock remains fail-closed.
export function reconcileUnderstanding(base: TurnUnderstanding | null, next: TurnUnderstanding, block: string, options: {
  readonly acceptedPhotoOffer?: boolean;
  readonly allowCurrentEvidenceCorrection?: boolean;
} = {}): TurnUnderstanding {
  // `selected_vehicle` is necessarily a conversation reference. Smaller models
  // sometimes label it as `current_turn` because the pronoun ("dele", "desse")
  // is written in the current block. Canonicalizing only this structural label
  // does not choose an intent, target, tool, or response for the brain.
  const canonicalNext = (next.subject === "selected_vehicle" || next.subject === "offer_reference") && next.subjectSource === "current_turn"
    ? { ...next, subjectSource: "memory" as const }
    : next;
  if (!base) return canonicalNext;
  const baseQuotes = new Set((base.evidence ?? []).map((e) => normalizeText(e.quote)));
  const currentEvidence = (canonicalNext.evidence ?? []).filter((e) => quoteInBlock(block, e.quote));
  const newEvidence = (canonicalNext.evidence ?? []).filter((e) => quoteInBlock(block, e.quote) && !baseQuotes.has(normalizeText(e.quote)));
  const changesSubject = canonicalNext.primaryIntent !== base.primaryIntent || canonicalNext.subject !== base.subject;
  if (changesSubject && newEvidence.length === 0) {
    if (options.allowCurrentEvidenceCorrection === true && currentEvidence.length > 0) return canonicalNext;
    const repairsAcceptedPhoto = options.acceptedPhotoOffer === true
      && canonicalNext.primaryIntent === "request_photos"
      && canonicalNext.requestedCapabilities.includes("send_photos")
      && canonicalNext.evidence.some((e) => e.capability === "send_photos" && quoteInBlock(block, e.quote));
    if (repairsAcceptedPhoto) return canonicalNext;
    // mudança ARBITRÁRIA sem evidência nova -> mantém a base; só preenche subjectValue se faltava.
    return { ...base, subjectValue: base.subjectValue ?? canonicalNext.subjectValue };
  }
  if (canonicalNext !== next) return canonicalNext;
  return next;   // refinamento legítimo (subjectValue) ou mudança JUSTIFICADA por evidência nova
}

// ── FALLBACK conservador (só HINT p/ recuperação TEXTUAL — NUNCA autoriza ação; fromBrain=false no validate). "foto"
//    SOLTA não vira request_photos: exige verbo de envio + foto (imperativo) OU "fotos do <carro>". ──
const PHOTO_MEMORY_Q = /\b(qual|que|quais)\b[^?]*\b(foto|carro|ve[ií]culo|modelo)\b[^?]*\b(pedi|pediu|mandei|mostrei|recebi)\b/;
const PHOTO_REQUEST_STEM = /\btem\s+(?:fotos?|imagens?)\b|\b(?:tem\s+)?(?:mais|outr[ao]s?)\s+(?:fotos?|imagens?|midias?|fotografias?)\b|\b(?:fotos?|imagens?)\s+(?:a\s+)?mais\b|\b(?:mand\w*|envi\w*|mostr\w*)\b[^?]*\bfotos?\b|\b(?:quero|posso|pode|gostaria)\b[^?]*\b(?:ver|mandar|enviar)\b[^?]*\bfotos?\b|\bfotos?\s+d(?:o|a|e|esse|essa|ele|ela)\b/;
const BUDGET_RX = /\bate\s+\d|\br\$\s*\d|\b\d{2,3}\s*mil\b|\bbarat|\beconomic|\bfaixa\s+de\s+pre|\bor[çc]amento\b/;
const ATTR_RX = /\bkm\b|quilometr|rodad|\bcor\b|\bcambio\b|c[aâ]mbio|autom[aá]tic|\bmanual\b|\bpre[çc]o\b|\bvalor\b|quanto\s+(?:custa|sai|fica)|\bano\b|\bconsumo\b|\bmotor\b|\bversao\b|vers[aã]o|\bopcionais\b|\bcompleto\b/;
const ORDINAL_WORD_RX = /\b(?:primeir|segund|terceir|quart|quint|sext|ultim)\w*|\bnumero\s+\d+|\bopcao\s+\d+/;
function firstMatch(rx: RegExp, block: string): string | null { const m = rx.exec(normalizeText(block)); return m ? m[0] : null; }
// FALLBACK conservador MULTI-capability (HINT; fromBrain=false não autoriza em produção). Um turno MISTO ("horário e
// quantos km?") acumula institutional_info + vehicle_details, cada uma com evidência própria. Ordem define o primaryIntent.
export function deriveFallbackUnderstanding(block: string, signals: FrameSignals, claimExtractor: ClaimExtractor): TurnUnderstanding {
  const norm = normalizeText(block);
  const caps: TurnCapability[] = [];
  const evidence: TurnUnderstandingEvidence[] = [];
  let primaryIntent: PrimaryIntent = "other";
  const add = (cap: TurnCapability, quote: string | null, intent: PrimaryIntent): void => {
    if (!quote || caps.includes(cap)) return;
    caps.push(cap); evidence.push({ capability: cap, quote });
    if (primaryIntent === "other") primaryIntent = intent;
  };
  const cModels = claimExtractor.extractClaims(block).filter((c) => c.kind === "model" || c.kind === "brand_model" || c.kind === "brand");

  if (PHOTO_MEMORY_Q.test(norm)) add("recall", firstMatch(PHOTO_MEMORY_Q, block), "recall_photos");
  else if (PHOTO_REQUEST_STEM.test(norm) && !isPhotoDeclined(block)) add("send_photos", firstMatch(PHOTO_REQUEST_STEM, block), "request_photos");
  if (HUMAN_ACT_RX.test(norm)) add("handoff", firstMatch(HUMAN_ACT_RX, block), "request_human");
  if (SENSITIVE_DATA_ACT_RX.test(norm)) {
    primaryIntent = "sensitive_data";
    evidence.push({ capability: undefined, quote: block.slice(0, 80) });
  }
  if (institutionalTopicsRequested(block).length > 0 || mentionsContact(block)) add("institutional_info", firstMatch(/\benderec|\bhorario|\bloja|\bunidade|\binstagram|\bsite/, block), "institutional");
  // BUSCA: sinal EXPLÍCITO (tipo/mais opções/popular/orçamento) OU um modelo SOLTO sem outra intenção ("tem Onix?"). Um
  // modelo num turno de FOTO/DETALHE ("me manda foto do Onix") NÃO vira busca (evita forçar stock_search indevidamente).
  const explicitSearch = signals.mentionsVehicleType != null || signals.mentionsMoreOptions || signals.mentionsPopular === true || BUDGET_RX.test(norm);
  const searchQuote = cModels[0]?.text ?? firstMatch(BUDGET_RX, block) ?? firstMatch(/\bpopular\b|\bsuv\b|\bsedan\b|\bhatch\b|\bpicape\b|\bpick-?up\b|\bmais\s+op|\boutr[ao]s?\s+op|\bcarro\b|\bve[ií]culo\b/, block);
  // ⭐AUTORIDADE (audit Codex): pergunta de ATRIBUTO ("quanto custa o Onix?") é DETALHE mesmo citando modelo — o ATO vence
  // a keyword. Modelo-solto só vira busca quando NÃO é pergunta de atributo; explicitSearch (tipo/faixa/mais opções) vence.
  const attrQuestion = ATTR_RX.test(norm);
  if (explicitSearch || (cModels.length > 0 && primaryIntent === "other" && !attrQuestion)) add("stock_search", searchQuote, "search_stock");
  else if (attrQuestion) add("vehicle_details", firstMatch(ATTR_RX, block), "vehicle_detail");   // atributo -> detalhe (mesmo com modelo)
  const ord = parseOrdinal(block);
  if (ord) add("select", firstMatch(ORDINAL_WORD_RX, block) ?? String(ord.value), "select_vehicle");

  const subject: TurnSubjectKind = cModels.length > 0 ? "explicit_model" : ord ? "ordinal_from_last_offer" : signals.mentionsVehicleType != null ? "vehicle_type" : "none";
  const subjectValue = cModels[0]?.text ?? (ord ? String(ord.value) : null);
  return { primaryIntent, requestedCapabilities: caps, subject, subjectValue, subjectSource: "current_turn", isTopicChange: false, answeredLeadQuestions: [], evidence };
}

// ── Fingerprint de DENY: mesma rejeição repetida -> recuperar já, sem gastar tentativas idênticas. ──
export function denyFingerprint(feedback: string): string {
  return normalizeText(feedback).replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 64);
}
