// ============================================================================
// photo-intent.ts — F2.7.8. Handler DETERMINISTICO de fotos. NUNCA finge por texto.
//
// DUAS camadas (a 2a foi adicionada na rodada 3 do Codex, apos falha em prod):
//  - LAYER 1 `resolvePhotoIntent`: pedido EXPLICITO do lead ("manda foto do onix") -> curto-circuita o LLM.
//  - LAYER 2 `resolvePhotoPromiseRepair` + `promisesPhotosWithoutMedia`: TRAVA pos-LLM. Se a decisao do LLM
//    prometer/decidir foto (action send_photos OU texto "vou enviar as fotos") SEM send_media, o engine
//    ROTEIA pelo resolvedor deterministico -> envia de verdade OU responde honesto. Deploy-independente:
//    o LLM nunca mais consegue fingir foto por texto.
//
// Resolucao do veiculo (robusta ao callback `delivered` ausente em prod, que deixa offers/foco/ledger
// VAZIOS): modelo na fala / ordinal "o segundo" na ultima oferta do agente (recentTurns) / unico da lista.
// O vehicleKey vem SEMPRE do stock_search (grounding). Sem if por frase: invariantes.
// ============================================================================
import type { ConversationState, RenderedOfferItem } from "../domain/conversation-state.ts";
import type { ClaimExtractor, ProposedDecision, TurnDecision, TurnInterpretation } from "../domain/decision.ts";
import type { Id, Iso } from "../domain/types.ts";
import type { QueryRunner, TurnOutput } from "./decision-engine.ts";
import { finalize, effectIdFor } from "./finalizer.ts";
import { normalizeText } from "./catalog-utils.ts";
import { parseOrdinal } from "./ordinal.ts";

const PHOTO_REQUEST = /\bfotos?\b|\bimagens?\b/iu;
// Reenvio sob pedido CLARO: "mais/outras fotos", "de novo", "reenviar", "novamente".
const WANTS_MORE = /\bmais\b|\boutr|\bde novo\b|\breenvi|\bnovamente\b/u;
// R10-5 (Codex): REENVIO IMPLÍCITO — "manda de novo" / "reenvia" / "manda outra vez" SEM citar "foto", logo após
// um envio de foto. Resolve deterministicamente (nunca vai ao LLM -> nunca MODEL_DECISION_INVALID/terminal-safe).
const REPEAT_SEND = /\b(?:de novo|novamente|outra vez|de nvo)\b|\breenvi\w*|\bmanda\w*\s+(?:de novo|dnv|outra vez)\b|\brepete\b|\bmanda\s+ai\b/u;
const PHOTO_WORD_NORM = /\b(?:fotos?|imagens?)\b/u;
const NEGATION_BEFORE = /\b(?:nao|nem|sem)\b/u;
const DEFERRAL = /\b(?:depois|mais tarde|outra hora|amanha|daqui a pouco)\b/u;
const CLAUSE_DELIM = /[.,;:!?\n]/g;
// Promessa de envio de foto em TEXTO (verbo de envio + palavra de foto na mesma frase).
const PHOTO_PROMISE_TEXT = /\b(?:vou|estou|irei|segue|seguem|mand\w*|envi\w*)\b[^.?!\n]{0,30}\b(?:fotos?|imagens?)\b/u;
const PHOTO_SENT_MARKER = "aqui estao as fotos"; // marcador deterministico do texto de envio (ver buildPhotoTurnOutput)

function stripAccentsLower(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// Negacao de foto ESCOPADA POR CLAUSULA (Codex rodada 3): a rajada e unida por "\n", entao um "nao" de uma
// mensagem ANTERIOR ("Tambem nao tenho carro") NAO pode negar "quero fotos" da mensagem seguinte. So conta
// negacao na MESMA clausula e ANTES da palavra de foto; deferral ("foto depois") na clausula tambem nega.
// "tem foto ou nao?" segue valido (negacao DEPOIS da palavra).
function isNegatedPhotoRequest(message: string): boolean {
  const norm = stripAccentsLower(message);
  const m = PHOTO_WORD_NORM.exec(norm);
  if (!m) return false;
  const p = m.index;
  // inicio da clausula = apos o ULTIMO delimitador (incl. \n) antes da palavra de foto
  let clauseStart = 0;
  const head = norm.slice(0, p);
  CLAUSE_DELIM.lastIndex = 0;
  let dm: RegExpExecArray | null;
  while ((dm = CLAUSE_DELIM.exec(head)) !== null) clauseStart = dm.index + 1;
  if (NEGATION_BEFORE.test(norm.slice(clauseStart, p))) return true;
  // fim da clausula da foto -> deferral antes OU depois ("agora nao, foto depois")
  const tail = /[.,;:!?\n]/.exec(norm.slice(p));
  const clauseEnd = tail ? p + tail.index : norm.length;
  return DEFERRAL.test(norm.slice(clauseStart, clauseEnd));
}

// Anti-reenvio ACCEPTED-SAFE: o photoLedger oficial so popula no `delivered` (issue C), que nao chega. Como
// `withAssistantTurn` grava a fala do agente em recentTurns no ACCEPTED, se o agente ja disse "Aqui estao as
// fotos do {modelo}" tratamos novo pedido simples como ja-enviado. NAO toca o photoLedger (gated por delivered).
function recentlySentPhotos(state: ConversationState, modelNorm: string): boolean {
  if (!modelNorm) return false;
  for (const turn of state.recentTurns ?? []) {
    if (turn.role !== "agent") continue;
    const t = stripAccentsLower(turn.text);
    if (t.includes(PHOTO_SENT_MARKER) && t.includes(modelNorm)) return true;
  }
  return false;
}

export type PhotoIntentResult =
  | { readonly kind: "send"; readonly vehicleKey: string; readonly vehicleLabel: string; readonly photoIds: string[] }
  | { readonly kind: "not_found"; readonly vehicleLabel: string }
  | { readonly kind: "already_sent"; readonly vehicleLabel: string }
  | { readonly kind: "ask_which" };

function lastAgentText(state: ConversationState): string {
  const turns = state.recentTurns ?? [];
  for (let i = turns.length - 1; i >= 0; i--) if (turns[i].role === "agent") return turns[i].text;
  return "";
}

function modelsInText(text: string, claimExtractor: ClaimExtractor): string[] {
  const normText = normalizeText(text);
  // Ordena por POSICAO no texto (nao a ordem do catalogo) — p/ "o segundo" pegar o 2o LISTADO.
  const ranked = claimExtractor.extractClaims(text)
    .filter((c) => c.kind === "model" || c.kind === "brand_model")
    .map((c) => ({ text: c.text, normalized: c.normalized, pos: normText.indexOf(c.normalized) }))
    .filter((c) => c.pos >= 0)
    .sort((a, b) => a.pos - b.pos);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const c of ranked) {
    if (!seen.has(c.normalized)) { seen.add(c.normalized); out.push(c.text); }
  }
  return out;
}

// F2.7.12.1 (Codex P1): digito so e ORDINAL em contexto ordinal EXPLICITO. Quantidade ("3 fotos") NAO e
// ordinal. FORTE = palavra (primeiro/...) OU item/opcao/numero/posicao/# + N. FRACO = do/da/de/o/a + N
// (so vence quando NAO ha modelo no texto do lead). Nunca "c3"/"hb20"/"2014"/"1.0".
function labelFromItem(item: RenderedOfferItem): string {
  return [item.marca, item.modelo, item.ano && item.ano > 0 ? String(item.ano) : null].filter(Boolean).join(" ") || item.vehicleKey;
}

// Resolve fotos de um vehicleKey ESPECIFICO (vindo da lista estruturada) — NAO faz stock_search por modelo.
// Fail-closed: o vehicleKey ja vem da ultima lista; aqui so confirmamos que ha fotos resolviveis.
async function resolvePhotosForKey(
  vehicleKey: string, label: string, modeloNorm: string,
  args: { state: ConversationState; runQuery: QueryRunner; wantsMore: boolean },
): Promise<PhotoIntentResult> {
  const { state, runQuery, wantsMore } = args;
  const photoRes = await runQuery({ tool: "vehicle_photos_resolve", input: { vehicleRef: { kind: "vehicle", key: vehicleKey } } });
  if (!photoRes.ok || photoRes.tool !== "vehicle_photos_resolve") return { kind: "not_found", vehicleLabel: label };
  if (photoRes.data.ambiguous) return { kind: "ask_which" };
  const photoIds = photoRes.data.photoIds;
  if (photoIds.length === 0) return { kind: "not_found", vehicleLabel: label };
  const sent = state.photoLedger.sentByVehicle[vehicleKey] ?? [];
  const ledgerHasAll = photoIds.every((id) => sent.includes(id));
  if (!wantsMore && (ledgerHasAll || recentlySentPhotos(state, modeloNorm))) return { kind: "already_sent", vehicleLabel: label };
  return { kind: "send", vehicleKey, vehicleLabel: label, photoIds };
}

// F2.7.12.1: resolucao UNIFICADA (Layer 1 e Layer 2). Ordem: ordinal FORTE -> modelo no TEXTO DO LEAD ->
// ordinal FRACO (so sem modelo no lead) -> modelo da interpretacao -> unico da lista estruturada -> textos
// de fallback (agente/composto). Ordinal resolve SO contra a lista estruturada (fail-closed, nunca stock_search por digito).
async function resolvePhotoTargetResult(args: {
  leadMessage: string; state: ConversationState; claimExtractor: ClaimExtractor;
  runQuery: QueryRunner; interpretation: TurnInterpretation | null | undefined;
  wantsMore: boolean; fallbackModelTexts: string[];
}): Promise<PhotoIntentResult> {
  const { leadMessage, state, claimExtractor, runQuery, interpretation, wantsMore, fallbackModelTexts } = args;
  const offerItems = state.lastRenderedOfferContext?.items ?? [];
  const resolveOrdinal = (n: number): Promise<PhotoIntentResult> => {
    if (n >= 1 && n <= offerItems.length) {
      const item = offerItems[n - 1];
      return resolvePhotosForKey(item.vehicleKey, labelFromItem(item), stripAccentsLower(item.modelo ?? ""), { state, runQuery, wantsMore });
    }
    return Promise.resolve({ kind: "ask_which" }); // fail-closed: ordinal sem item -> pergunta, NUNCA outro veiculo
  };
  const ord = parseOrdinal(leadMessage);

  if (ord?.strong) return resolveOrdinal(ord.value); // 1) ORDINAL FORTE vence ate modelo explicito
  const leadModels = modelsInText(leadMessage, claimExtractor); // 2) MODELO no TEXTO DO LEAD vence ordinal fraco
  if (leadModels.length > 1) return { kind: "ask_which" };
  if (leadModels.length === 1) return resolveTargetPhotos(leadModels[0], { state, runQuery, wantsMore });
  if (ord) return resolveOrdinal(ord.value); // 3) ORDINAL FRACO (sem modelo no lead) -> lista estruturada
  // 4) item 1 (Codex): veículo SELECIONADO pelo lead (vehicleKey EXATO). A INTERPRETAÇÃO da LLM NUNCA vence a
  //    seleção explícita — pronome "dele/desse" sem ordinal/modelo escrito resolve AQUI, nunca o "primeiro similar".
  const selected = state.vehicleContext.selected;
  if (selected?.key) return resolvePhotosForKey(selected.key, selected.label ?? "", stripAccentsLower(selected.label ?? ""), { state, runQuery, wantsMore });
  const interpModels = (interpretation?.extractedEntities?.models ?? []).filter((m) => typeof m === "string" && m.trim() !== ""); // 5) modelos INFERIDOS pela interpretação
  if (interpModels.length === 1) return resolveTargetPhotos(interpModels[0], { state, runQuery, wantsMore });
  if (interpModels.length > 1) return { kind: "ask_which" };
  if (offerItems.length === 1) return resolveOrdinal(1); // 6) unico da lista estruturada
  if (offerItems.length > 1) return { kind: "ask_which" };
  for (const t of fallbackModelTexts) { // 6) fallback: modelo no texto do agente / composto
    const fm = modelsInText(t, claimExtractor);
    if (fm.length === 1) return resolveTargetPhotos(fm[0], { state, runQuery, wantsMore });
    if (fm.length > 1) return { kind: "ask_which" };
  }
  return { kind: "ask_which" };
}

// Nucleo: resolve veiculo (estoque) + fotos + anti-reenvio. vehicleKey SEMPRE do estoque (grounding).
async function resolveTargetPhotos(
  targetModel: string,
  args: { state: ConversationState; runQuery: QueryRunner; wantsMore: boolean },
): Promise<PhotoIntentResult> {
  const { state, runQuery, wantsMore } = args;
  const stockRes = await runQuery({ tool: "stock_search", input: { modelo: targetModel } });
  const items = stockRes.ok && stockRes.tool === "stock_search" ? stockRes.data.items : [];
  if (items.length === 0) return { kind: "not_found", vehicleLabel: targetModel };
  const labelOf = (v: (typeof items)[number]): string => [v.marca, v.modelo, v.ano && v.ano > 0 ? String(v.ano) : null].filter(Boolean).join(" ");
  // P0-1 (Codex): se o veículo SELECIONADO está entre os resultados (compatível com o modelo citado), usa o
  // vehicleKey EXATO — nunca reenvia outro ano. 0 -> não encontrado; 1 -> usa; >1 sem seleção -> pergunta qual
  // (PROIBIDO items[0]). O vehicleKey vem SEMPRE do estoque; o núcleo (fotos/anti-reenvio) é resolvePhotosForKey.
  const selectedKey = state.vehicleContext.selected?.key;
  const selectedItem = selectedKey ? items.find((v) => v.vehicleKey === selectedKey) : undefined;
  const chosen = selectedItem ?? (items.length === 1 ? items[0] : null);
  if (!chosen) return { kind: "ask_which" };
  return resolvePhotosForKey(chosen.vehicleKey, labelOf(chosen), stripAccentsLower(chosen.modelo ?? ""), { state, runQuery, wantsMore });
}

// LAYER 1: pedido EXPLICITO de foto na fala do lead. null = nao e pedido (ou negacao) -> fluxo normal do LLM.
export async function resolvePhotoIntent(args: {
  readonly leadMessage: string;
  readonly state: ConversationState;
  readonly claimExtractor: ClaimExtractor;
  readonly runQuery: QueryRunner;
  readonly interpretation: TurnInterpretation | null | undefined;
}): Promise<PhotoIntentResult | null> {
  const { leadMessage, state, claimExtractor, runQuery, interpretation } = args;
  const norm = stripAccentsLower(leadMessage);
  const lastAgent = lastAgentText(state);
  // R10-5: REENVIO IMPLÍCITO — "manda de novo" (sem a palavra "foto") logo após o agente ter enviado foto
  // ("Aqui estão as fotos do X"). Resolve deterministicamente o MESMO veículo (foco/selected → modelo da
  // última fala), wantsMore=true (reenvia mesmo já-enviado). Respeita negação e ambiguidade fail-closed.
  const repeatMatch = REPEAT_SEND.exec(norm);
  if (!PHOTO_REQUEST.test(leadMessage) && repeatMatch && stripAccentsLower(lastAgent).includes(PHOTO_SENT_MARKER)) {
    // negação/deferral escopada: "não manda de novo" / "depois manda de novo" -> NÃO reenvia (fluxo normal).
    const negated = NEGATION_BEFORE.test(norm.slice(Math.max(0, repeatMatch.index - 24), repeatMatch.index)) || DEFERRAL.test(norm);
    if (!negated) return resolvePhotoTargetResult({ leadMessage, state, claimExtractor, runQuery, interpretation, wantsMore: true, fallbackModelTexts: [lastAgent] });
  }
  if (!PHOTO_REQUEST.test(leadMessage) || isNegatedPhotoRequest(leadMessage)) return null;
  const wantsMore = WANTS_MORE.test(norm);
  // Fallback de modelo (quando nao ha ordinal nem modelo no lead) = ultima fala do agente.
  return resolvePhotoTargetResult({ leadMessage, state, claimExtractor, runQuery, interpretation, wantsMore, fallbackModelTexts: [lastAgent] });
}

// LAYER 2 (trava): a decisao do LLM promete foto sem `send_media`? Resolve o veiculo (prioridade: o que o
// AGENTE prometeu no texto; senao o que o lead pediu; senao a ultima oferta) e devolve um resultado real.
export async function resolvePhotoPromiseRepair(args: {
  readonly composedText: string;
  readonly leadMessage: string;
  readonly state: ConversationState;
  readonly claimExtractor: ClaimExtractor;
  readonly runQuery: QueryRunner;
  readonly interpretation: TurnInterpretation | null | undefined;
}): Promise<PhotoIntentResult> {
  const { composedText, leadMessage, state, claimExtractor, runQuery, interpretation } = args;
  const wantsMore = WANTS_MORE.test(stripAccentsLower(leadMessage));
  // Codex P1: o repair tambem respeita ORDINAL + lista estruturada (mesmo resolvedor). Fallback de modelo:
  // o que o AGENTE prometeu no texto composto E a ultima fala — so quando nao ha ordinal nem modelo no lead.
  return resolvePhotoTargetResult({ leadMessage, state, claimExtractor, runQuery, interpretation, wantsMore, fallbackModelTexts: [composedText, lastAgentText(state)] });
}

// Reparar a promessa de foto da decisao (gerar send_media real)? Invariante GERAL (Codex r3):
// "nunca enviar midia quando o lead negou foto; nunca prometer foto sem send_media quando o lead pediu".
// Por isso a Layer 2 RESPEITA o mesmo invariante de negacao da Layer 1 (`isNegatedPhotoRequest(leadMessage)`):
// se o lead negou foto, NAO repara — mesmo que o LLM erre com `action: send_photos`.
// Intencao de foto na fala do LEAD (mesma deteccao da Layer 1; exclui negacao).
export function leadHasPhotoIntent(leadMessage: string): boolean {
  return PHOTO_REQUEST.test(leadMessage) && !isNegatedPhotoRequest(leadMessage);
}
// O TEXTO COMPOSTO promete enviar foto (verbo de envio + palavra de foto; exclui negacao).
export function composedTextPromisesPhoto(composedText: string): boolean {
  return PHOTO_PROMISE_TEXT.test(stripAccentsLower(composedText)) && !isNegatedPhotoRequest(composedText);
}

export function shouldRepairPhotoPromise(args: {
  readonly decision: TurnDecision;
  readonly composedText: string;
  readonly leadMessage: string;
}): boolean {
  const { decision, composedText, leadMessage } = args;
  if (decision.effectPlan.some((p) => p.kind === "send_media")) return false; // ja tem midia
  if (isNegatedPhotoRequest(leadMessage)) return false; // lead negou foto -> nunca midia (override total)
  // Codex r3.2: `action===send_photos` SOZINHO NAO basta (o LLM erra: "Bonito ele" virava resposta de foto).
  // So repara se ha intencao textual de foto no LEAD ou promessa explicita de foto no TEXTO COMPOSTO.
  // `decision.action` deixa de ser gatilho — send_photos sem essas evidencias = erro de decisao do LLM, ignorado.
  return leadHasPhotoIntent(leadMessage) || composedTextPromisesPhoto(composedText);
}

// Constroi o TurnOutput deterministico do caso de foto (vai direto ao commit/dispatch, sem LLM).
export function buildPhotoTurnOutput(result: PhotoIntentResult, turnId: Id, _now: Iso): TurnOutput {
  let text: string;
  let proposal: ProposedDecision;

  if (result.kind === "send") {
    text = `Aqui estão as fotos do ${result.vehicleLabel}! 📸`;
    const mediaEffectId = effectIdFor(turnId, "photos");
    proposal = {
      proposedAction: "send_photos",
      facts: [],
      proposedEffects: [
        { kind: "send_message", planId: "reply", order: 0, onSuccess: [] },
        {
          kind: "send_media", planId: "photos", order: 1,
          vehicleKey: result.vehicleKey, photoIds: result.photoIds,
          onSuccess: [{ op: "mark_photos_sent", effectId: mediaEffectId, vehicleKey: result.vehicleKey, photoIds: result.photoIds }],
        },
      ],
      responsePlan: { guidance: text },
      reasonCode: "send_photos", reasonSummary: "Enviar fotos reais do veiculo pedido", confidence: 1,
    };
  } else {
    if (result.kind === "not_found") {
      text = `Não encontrei fotos do ${result.vehicleLabel} agora, mas posso te passar mais detalhes ou já agendar uma visita. O que prefere?`;
    } else if (result.kind === "already_sent") {
      text = `Já te enviei as fotos do ${result.vehicleLabel}. Quer ver as fotos de outro veículo ou prefere agendar uma visita?`;
    } else {
      text = "De qual veículo você quer ver as fotos?";
    }
    proposal = {
      proposedAction: result.kind === "ask_which" ? "clarify" : "reply",
      facts: [],
      proposedEffects: [{ kind: "send_message", planId: "reply", order: 0, onSuccess: [] }],
      responsePlan: { guidance: text },
      reasonCode: `photo_${result.kind}`, reasonSummary: text.slice(0, 120), confidence: 1,
    };
  }

  const decision = finalize(turnId, proposal, [{ policyId: "POL-PHOTO", outcome: "allow" }], []);
  return {
    decision,
    composed: { draft: { parts: [{ type: "text", content: text }] }, text },
    facts: [],
    loopExhausted: false,
    terminalSafe: false,
    steps: 0,
  };
}
