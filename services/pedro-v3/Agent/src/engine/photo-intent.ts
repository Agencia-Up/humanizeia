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
import type { ConversationState } from "../domain/conversation-state.ts";
import type { ClaimExtractor, ProposedDecision, TurnDecision, TurnInterpretation } from "../domain/decision.ts";
import type { Id, Iso } from "../domain/types.ts";
import type { QueryRunner, TurnOutput } from "./decision-engine.ts";
import { finalize, effectIdFor } from "./finalizer.ts";
import { normalizeText } from "./catalog-utils.ts";

const PHOTO_REQUEST = /\bfotos?\b|\bimagens?\b/iu;
// Reenvio sob pedido CLARO: "mais/outras fotos", "de novo", "reenviar", "novamente".
const WANTS_MORE = /\bmais\b|\boutr|\bde novo\b|\breenvi|\bnovamente\b/u;
const PHOTO_WORD_NORM = /\b(?:fotos?|imagens?)\b/u;
const NEGATION_BEFORE = /\b(?:nao|nem|sem)\b/u;
const DEFERRAL = /\b(?:depois|mais tarde|outra hora|amanha|daqui a pouco)\b/u;
const CLAUSE_DELIM = /[.,;:!?\n]/g;
// Promessa de envio de foto em TEXTO (verbo de envio + palavra de foto na mesma frase).
const PHOTO_PROMISE_TEXT = /\b(?:vou|estou|irei|segue|seguem|mand\w*|envi\w*)\b[^.?!\n]{0,30}\b(?:fotos?|imagens?)\b/u;
const PHOTO_SENT_MARKER = "aqui estao as fotos"; // marcador deterministico do texto de envio (ver buildPhotoTurnOutput)
const ORDINALS: Record<string, number> = {
  primeiro: 1, primeira: 1, segundo: 2, segunda: 2, terceiro: 3, terceira: 3, quarto: 4, quarta: 4, quinto: 5, quinta: 5,
};

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

// Modelos citados em uma lista de textos (ordem preservada, sem duplicar) + os da interpretacao.
function collectModels(texts: string[], claimExtractor: ClaimExtractor, interpretation: TurnInterpretation | null | undefined): string[] {
  const out: string[] = [];
  const has = (m: string) => out.some((x) => normalizeText(x) === normalizeText(m));
  for (const t of texts) for (const m of modelsInText(t, claimExtractor)) if (!has(m)) out.push(m);
  for (const m of interpretation?.extractedEntities?.models ?? []) if (!has(m)) out.push(m);
  return out;
}

function parseOrdinal(msg: string): number | null {
  const norm = normalizeText(msg);
  for (const [word, n] of Object.entries(ORDINALS)) {
    if (new RegExp(`\\b${word}\\b`).test(norm)) return n;
  }
  const m = /\b(?:o|numero|item|opcao)\s*([1-5])\b/.exec(norm);
  return m ? Number(m[1]) : null;
}

// Seleciona o modelo-alvo: explicitos (1 -> ele; varios -> ambiguo); senao ordinal na lista; senao unico da lista.
function selectTargetModel(explicitModels: string[], ordinal: number | null, fallbackModels: string[]): string | null {
  if (explicitModels.length === 1) return explicitModels[0];
  if (explicitModels.length > 1) return null; // ambiguo -> perguntar qual
  if (ordinal != null && fallbackModels.length >= ordinal) return fallbackModels[ordinal - 1];
  if (fallbackModels.length === 1) return fallbackModels[0];
  return null;
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
  const vehicle = items[0];
  const label = [vehicle.marca, vehicle.modelo, vehicle.ano && vehicle.ano > 0 ? String(vehicle.ano) : null].filter(Boolean).join(" ");

  const photoRes = await runQuery({ tool: "vehicle_photos_resolve", input: { vehicleRef: { kind: "vehicle", key: vehicle.vehicleKey } } });
  if (!photoRes.ok || photoRes.tool !== "vehicle_photos_resolve") return { kind: "not_found", vehicleLabel: label };
  if (photoRes.data.ambiguous) return { kind: "ask_which" };
  const photoIds = photoRes.data.photoIds;
  if (photoIds.length === 0) return { kind: "not_found", vehicleLabel: label };

  const sent = state.photoLedger.sentByVehicle[vehicle.vehicleKey] ?? [];
  const ledgerHasAll = photoIds.every((id) => sent.includes(id));
  const recentlySent = recentlySentPhotos(state, stripAccentsLower(vehicle.modelo));
  if (!wantsMore && (ledgerHasAll || recentlySent)) return { kind: "already_sent", vehicleLabel: label };

  return { kind: "send", vehicleKey: vehicle.vehicleKey, vehicleLabel: label, photoIds };
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
  if (!PHOTO_REQUEST.test(leadMessage) || isNegatedPhotoRequest(leadMessage)) return null;
  const wantsMore = WANTS_MORE.test(stripAccentsLower(leadMessage));
  const leadModels = collectModels([leadMessage], claimExtractor, interpretation);
  const agentModels = modelsInText(lastAgentText(state), claimExtractor);
  const target = selectTargetModel(leadModels, parseOrdinal(leadMessage), agentModels);
  if (!target) return { kind: "ask_which" };
  return resolveTargetPhotos(target, { state, runQuery, wantsMore });
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
  const explicitModels = collectModels([composedText, leadMessage], claimExtractor, interpretation);
  const agentModels = modelsInText(lastAgentText(state), claimExtractor);
  const target = selectTargetModel(explicitModels, parseOrdinal(leadMessage), agentModels);
  if (!target) return { kind: "ask_which" };
  return resolveTargetPhotos(target, { state, runQuery, wantsMore });
}

// Reparar a promessa de foto da decisao (gerar send_media real)? Invariante GERAL (Codex r3):
// "nunca enviar midia quando o lead negou foto; nunca prometer foto sem send_media quando o lead pediu".
// Por isso a Layer 2 RESPEITA o mesmo invariante de negacao da Layer 1 (`isNegatedPhotoRequest(leadMessage)`):
// se o lead negou foto, NAO repara — mesmo que o LLM erre com `action: send_photos`.
export function shouldRepairPhotoPromise(args: {
  readonly decision: TurnDecision;
  readonly composedText: string;
  readonly leadMessage: string;
}): boolean {
  const { decision, composedText, leadMessage } = args;
  if (decision.effectPlan.some((p) => p.kind === "send_media")) return false; // ja tem midia
  if (isNegatedPhotoRequest(leadMessage)) return false; // LEAD negou foto -> nunca midia (mesmo invariante da Layer 1)
  if (decision.action === "send_photos") return true; // LLM decidiu enviar foto sem midia -> reparar
  return PHOTO_PROMISE_TEXT.test(stripAccentsLower(composedText)) && !isNegatedPhotoRequest(composedText);
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
