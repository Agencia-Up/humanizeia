// ============================================================================
// photo-intent.ts — F2.7.8. Handler DETERMINISTICO de pedido de foto.
// Em vez de confiar no LLM emitir send_media (licao da F2.6R), o engine detecta o
// pedido, resolve o veiculo e as fotos (via runQuery: estoque + vehicle_photos_resolve)
// e EMITE o EffectPlan send_media (ou um texto honesto). Nunca finge por texto.
//
// ⚠️ O callback `delivered` nao chega em prod (issue C) -> offers.last/vehicleContext.focus/
// photoLedger ficam VAZIOS. Por isso o ALVO e resolvido pela fala do lead OU pela ULTIMA
// oferta do AGENTE (recentTurns) + estoque — NAO depende do estado receipt-gated. O ledger
// anti-reenvio so atua quando populado (apos C resolvido); ate la, nota de risco no handoff.
//
// Grounding: o vehicleKey vem SEMPRE do estoque (stock_search). Sem if por frase: invariantes
// (pediu foto? alvo identificavel? fotos existem? ja enviadas?).
// ============================================================================
import type { ConversationState } from "../domain/conversation-state.ts";
import type { ClaimExtractor, ProposedDecision, QueryResult, TurnInterpretation } from "../domain/decision.ts";
import type { Id, Iso } from "../domain/types.ts";
import type { QueryRunner, TurnOutput } from "./decision-engine.ts";
import { finalize, effectIdFor } from "./finalizer.ts";
import { normalizeText } from "./catalog-utils.ts";

const PHOTO_REQUEST = /\bfotos?\b|\bimagens?\b/iu;
// Reenvio sob pedido CLARO: "mais/outras fotos", "de novo", "reenviar", "novamente".
const WANTS_MORE = /\bmais\b|\boutr|\bde novo\b|\breenvi|\bnovamente\b/u;
// Palavra de foto (normalizada) + negacao. Negacao ANTES da palavra de foto -> NAO e pedido de foto.
const PHOTO_WORD_NORM = /\b(?:fotos?|imagens?)\b/u;
const NEGATION_BEFORE = /\b(?:nao|nem|sem)\b/u;
const PHOTO_SENT_MARKER = "aqui estao as fotos"; // marcador determinístico do texto de envio (ver buildPhotoTurnOutput)
const ORDINALS: Record<string, number> = {
  primeiro: 1, primeira: 1, segundo: 2, segunda: 2, terceiro: 3, terceira: 3, quarto: 4, quarta: 4, quinto: 5, quinta: 5,
};

function stripAccentsLower(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// F2.7.8 (Codex, fix 1): "nao quero foto", "sem foto", "nao manda imagem", "agora nao, foto depois" -> NAO
// enviar. Regra GERAL (sem if por frase): negacao (nao/nem/sem) ANTES da 1a palavra de foto. "tem foto ou
// nao?" segue valendo (negacao DEPOIS da palavra).
function isNegatedPhotoRequest(message: string): boolean {
  const norm = stripAccentsLower(message);
  const m = PHOTO_WORD_NORM.exec(norm);
  if (!m) return false;
  return NEGATION_BEFORE.test(norm.slice(0, m.index));
}

// F2.7.8 (Codex, fix 2): anti-reenvio ACCEPTED-SAFE. O photoLedger oficial so popula no `delivered` (issue C),
// que nao chega -> "ja enviadas" nunca acionaria e o agente reenviaria. Como `withAssistantTurn` grava a fala
// do agente em recentTurns no ACCEPTED, se o agente ja disse "Aqui estao as fotos do {modelo}" tratamos novo
// pedido simples como ja-enviado. NAO toca o photoLedger (segue gated por delivered) — protecao operacional.
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

function parseOrdinal(msg: string): number | null {
  const norm = normalizeText(msg);
  for (const [word, n] of Object.entries(ORDINALS)) {
    if (new RegExp(`\\b${word}\\b`).test(norm)) return n;
  }
  const m = /\b(?:o|numero|item|opcao)\s*([1-5])\b/.exec(norm);
  return m ? Number(m[1]) : null;
}

export async function resolvePhotoIntent(args: {
  readonly leadMessage: string;
  readonly state: ConversationState;
  readonly claimExtractor: ClaimExtractor;
  readonly runQuery: QueryRunner;
  readonly interpretation: TurnInterpretation | null | undefined;
}): Promise<PhotoIntentResult | null> {
  const { leadMessage, state, claimExtractor, runQuery, interpretation } = args;
  // fix 1: nao e pedido de foto, OU e NEGACAO ("nao quero foto") -> fluxo normal do LLM, NUNCA envia midia.
  if (!PHOTO_REQUEST.test(leadMessage) || isNegatedPhotoRequest(leadMessage)) return null;
  const wantsMore = WANTS_MORE.test(stripAccentsLower(leadMessage));

  // ── ALVO: modelos no pedido do lead; senao na ULTIMA oferta do agente; ordinal "o segundo" ──
  const leadModels = modelsInText(leadMessage, claimExtractor);
  for (const m of interpretation?.extractedEntities?.models ?? []) {
    if (!leadModels.some((x) => normalizeText(x) === normalizeText(m))) leadModels.push(m);
  }
  const agentModels = modelsInText(lastAgentText(state), claimExtractor);
  const ordinal = parseOrdinal(leadMessage);

  let targetModel: string | null = null;
  if (leadModels.length === 1) targetModel = leadModels[0];
  else if (leadModels.length > 1) return { kind: "ask_which" };
  else if (ordinal != null && agentModels.length >= ordinal) targetModel = agentModels[ordinal - 1];
  else if (agentModels.length === 1) targetModel = agentModels[0];
  else return { kind: "ask_which" }; // varios na lista (sem ordinal) OU nenhum contexto -> perguntar qual

  // ── Resolve o vehicleKey no ESTOQUE (grounding) ──
  const stockRes = await runQuery({ tool: "stock_search", input: { modelo: targetModel } });
  const items = stockRes.ok && stockRes.tool === "stock_search" ? stockRes.data.items : [];
  if (items.length === 0) return { kind: "not_found", vehicleLabel: targetModel };
  const vehicle = items[0];
  const label = [vehicle.marca, vehicle.modelo, vehicle.ano && vehicle.ano > 0 ? String(vehicle.ano) : null].filter(Boolean).join(" ");

  // ── Resolve as FOTOS ──
  const photoRes = await runQuery({ tool: "vehicle_photos_resolve", input: { vehicleRef: { kind: "vehicle", key: vehicle.vehicleKey } } });
  if (!photoRes.ok || photoRes.tool !== "vehicle_photos_resolve") return { kind: "not_found", vehicleLabel: label };
  if (photoRes.data.ambiguous) return { kind: "ask_which" };
  const photoIds = photoRes.data.photoIds;
  if (photoIds.length === 0) return { kind: "not_found", vehicleLabel: label };

  // ── Anti-reenvio: ledger oficial (delivered, C-blocked) OU memoria textual ACCEPTED-SAFE (fix 2) ──
  const sent = state.photoLedger.sentByVehicle[vehicle.vehicleKey] ?? [];
  const ledgerHasAll = photoIds.every((id) => sent.includes(id));
  const recentlySent = recentlySentPhotos(state, stripAccentsLower(vehicle.modelo));
  if (!wantsMore && (ledgerHasAll || recentlySent)) return { kind: "already_sent", vehicleLabel: label };

  return { kind: "send", vehicleKey: vehicle.vehicleKey, vehicleLabel: label, photoIds };
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
