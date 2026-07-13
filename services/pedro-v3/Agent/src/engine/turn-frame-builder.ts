// ============================================================================
// turn-frame-builder.ts — R13 Inc2/C. Monta o TurnFrame que o AgentBrain recebe.
//
// Bloco do lead + prompt (sha) + WorkingMemory + transcript recente + signals. Os `signals` são regex/léxico
// que ENRIQUECEM o frame como EVIDÊNCIA auxiliar — NUNCA decidem a ação (Brain/11 §5/§6). PURO.
// ============================================================================
import type { ConversationState } from "../domain/conversation-state.ts";
import type { TurnInterpretation } from "../domain/decision.ts";
import type { CurrentTurnIntent, FrameSignals, FrameTranscriptTurn, TurnFrame, WorkingMemoryV1 } from "../domain/agent-brain.ts";
import type { Iso } from "../domain/types.ts";
import { normalizeText } from "./catalog-utils.ts";
import { contactPhoneKnownFromChannel } from "./turn-domain.ts";

const PHOTO_RX = /\bfotos?\b|\bimagens?\b|\bfotografi/;
const STORE_RX = /\bloja\b|\bendereco\b|\bfica\s+onde\b|\bonde\s+(fica|e|esta)\b|\bhorario\b|\bque\s+horas\b|\bunidade\b|\bfuncionament/;
// F2.29 (invariante 2): cobre "mais opções", "outros/outras", "mais carros", "mais algum(a)", "tem outros", "tem mais"
// (exceto "tem mais informações/detalhe/sobre/dados" — pedido de INFO do carro atual, não de outros veículos).
const MORE_RX = /\bmais\s+op|\boutr[ao]s?\b|\bmais\s+carr|\bmais\s+algum|\btem\s+outr|\btem\s+mais\b(?!\s+(?:informa|detalhe|sobre|dado))/;
const MORE_PHOTOS_RX = /\b(?:tem\s+)?(?:mais|outr[ao]s?)\s+(?:fotos?|imagens?|midias?|fotografias?)\b|\b(?:fotos?|imagens?)\s+(?:a\s+)?mais\b/;
const POPULAR_RX = /\bpopular(?:es)?\b/;
const MEMORY_Q_RX = /\bqual\b[^?]*\b(carro|ve[ií]culo|foto|modelo)\b|\bpedi\b|\bmandei\b|\bmostrei\b|\bmandou\b|\benviou\b|\bquais?\b[^?]*\bfotos?\b/;

function mentionsVehicleType(norm: string): string | null {
  if (/\bsuvs?\b/.test(norm)) return "suv";
  if (/\bsedans?\b/.test(norm)) return "sedan";
  if (/\bhatch/.test(norm)) return "hatch";
  if (/\bpicapes?\b|\bpickups?\b/.test(norm)) return "pickup";
  return null;
}

// Sinais determinísticos (evidência auxiliar). O cérebro decide; isto só descreve o que a regex viu.
export function buildFrameSignals(block: string, interpretation: TurnInterpretation): FrameSignals {
  const norm = normalizeText(block);
  const hasQ = /\?/.test(block);
  const isMorePhotos = MORE_PHOTOS_RX.test(norm);
  return {
    mentionsPhoto: PHOTO_RX.test(norm),
    mentionsStore: STORE_RX.test(norm),
    mentionsMoreOptions: MORE_RX.test(norm) && !isMorePhotos,
    mentionsPopular: POPULAR_RX.test(norm),
    mentionsVehicleType: mentionsVehicleType(norm),
    isMemoryQuestion: (hasQ || /\bqual\b|\bquais\b/.test(norm)) && MEMORY_Q_RX.test(norm),
    relation: interpretation.relation,
  };
}

export function buildRecentTranscript(state: ConversationState, max = 12): FrameTranscriptTurn[] {
  const turns = state.recentTurns ?? [];
  return turns.slice(-max).map((t) => ({ role: t.role, text: t.text }));
}

export function buildTurnFrame(args: {
  readonly turnId: string;
  readonly now: Iso;
  readonly block: string;
  readonly portalPromptSha256: string;
  readonly workingMemory: WorkingMemoryV1;
  readonly interpretation: TurnInterpretation;
  readonly state: ConversationState;
  readonly currentTurnIntent?: CurrentTurnIntent;   // P0 (audit): intenção do turno atual, computada pelo engine
  readonly adVehicleHint?: string | null;           // F2.32 (CTWA): veículo do anúncio (resolvido/aterrado pelo engine)
  readonly adGenericEntry?: boolean;                // Fix B (audit CTWA): entrada por anúncio genérico -> abre com discovery
  readonly firstContactNoCommercialTarget?: boolean; // PARTE A (missão): 1º contato sem anúncio/alvo -> discovery, não nome
  readonly specificAdEntry?: boolean;               // PARTE A (missão): entrada por anúncio específico -> fala do veículo
  readonly disengagementOnly?: boolean;
  readonly acceptedPhotoOffer?: boolean;
  readonly selectedOfferThisTurn?: boolean;
  readonly handoffAvailable?: boolean;
  // ⭐RD1 (2026-07-13): orientações de condução injetadas ANTES da geração (advisory; ver turn-advisories.ts).
  readonly advisories?: readonly string[];
}): TurnFrame {
  const base = buildFrameSignals(args.block, args.interpretation);
  // INC2 (P0): telefone de contato conhecido pelo canal (conversationId "wa:") -> o cérebro NÃO deve pedir telefone.
  const signals = {
    ...base,
    ...(args.currentTurnIntent ? { currentTurnIntent: args.currentTurnIntent } : {}),
    contactPhoneKnown: contactPhoneKnownFromChannel(args.state.conversationId),
    ...(args.adVehicleHint ? { adVehicle: args.adVehicleHint } : {}),
    ...(args.adGenericEntry ? { adGenericEntry: true } : {}),
    ...(args.firstContactNoCommercialTarget ? { firstContactNoCommercialTarget: true } : {}),
    ...(args.specificAdEntry ? { specificAdEntry: true } : {}),
    ...(args.disengagementOnly ? { disengagementOnly: true } : {}),
    ...(args.acceptedPhotoOffer ? { acceptedPhotoOffer: true } : {}),
    ...(args.selectedOfferThisTurn ? { selectedOfferThisTurn: true } : {}),
    ...(args.handoffAvailable ? { handoffAvailable: true } : {}),
  };
  return {
    turnId: args.turnId,
    now: args.now,
    block: args.block,
    portalPromptSha256: args.portalPromptSha256,
    workingMemory: args.workingMemory,
    recentTranscript: buildRecentTranscript(args.state),
    signals,
    ...(args.advisories && args.advisories.length > 0 ? { advisories: args.advisories } : {}),
  };
}
