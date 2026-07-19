// ============================================================================
// central-turn-io.ts — fronteira de entrada/saída do turno central.
//
// Só normaliza o bloco recebido e cria eventos/planos básicos. Não interpreta
// intenção comercial e não decide qual tool usar.
// ============================================================================
import type { AdContext } from "../domain/conversation-state.ts";
import type { CentralQueryCall, } from "../domain/agent-brain.ts";
import type { QueryCall, ProposedEffectPlan, TurnAction } from "../domain/decision.ts";
import type { InboxRecord, TurnEventRecord } from "../domain/effect-intent.ts";
import { redact } from "../domain/effect-intent.ts";
import type { Id, Iso, JsonValue } from "../domain/types.ts";
import { sanitizeAdContext } from "./ad-context.ts";

export function textFromInbox(rec: InboxRecord): string {
  const raw = rec.raw as Record<string, unknown>;
  const text = raw.text ?? raw.message ?? raw.body ?? raw.transcription ?? "";
  if (typeof text === "string" && text.trim() !== "") return text.trim();
  const mc = (raw.mediaContext ?? raw.media_context) as Record<string, unknown> | undefined;
  if (mc && typeof mc === "object") {
    const mcText = mc.text ?? mc.transcription ?? mc.caption;
    if (typeof mcText === "string" && mcText.trim() !== "") return mcText.trim();
    const kind = typeof mc.kind === "string" ? mc.kind : null;
    if (kind === "audio") return "[o cliente enviou um áudio que não consegui transcrever]";
    if (kind === "image") return "[o cliente enviou uma imagem, sem texto]";
    if (kind === "video") return "[o cliente enviou um vídeo]";
    if (kind === "document") return "[o cliente enviou um documento]";
    if (mc.has_media_context === true) return "[o cliente enviou uma mídia]";
  }
  return typeof text === "string" ? text.trim() : "";
}

export function leadNameHintFromInbox(records: InboxRecord[]): string | null {
  for (let i = records.length - 1; i >= 0; i--) {
    const raw = records[i]?.raw as Record<string, unknown> | undefined;
    const hint = raw?.leadNameHint;
    if (typeof hint === "string" && hint.trim().length >= 2) return hint.trim().slice(0, 60);
  }
  return null;
}

export function adContextFromInbox(records: InboxRecord[]): AdContext | null {
  const ordered = [...records].sort((a, b) => {
    const ta = Date.parse(a.receivedAt), tb = Date.parse(b.receivedAt);
    if (ta !== tb) return ta - tb;
    return a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0;
  });
  for (const rec of ordered) {
    const raw = rec.raw as Record<string, unknown>;
    const ad = raw.adContext;
    if (ad && typeof ad === "object") {
      const capturedRaw = (ad as Record<string, unknown>).capturedAtTurn;
      const sanitized = sanitizeAdContext(ad, typeof capturedRaw === "number" ? capturedRaw : 0);
      if (sanitized) return sanitized;
    }
  }
  return null;
}

export function aggregateLeadMessage(records: InboxRecord[]): string {
  const ordered = [...records].sort((a, b) => {
    const ta = Date.parse(a.receivedAt), tb = Date.parse(b.receivedAt);
    if (ta !== tb) return ta - tb;
    return a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0;
  });
  return ordered.map(textFromInbox).filter(Boolean).join("\n");
}

export function makeEvent(args: {
  conversationId: Id;
  turnId: Id;
  type: string;
  suffix: string;
  payload: { [k: string]: JsonValue };
  at: Iso;
}): TurnEventRecord {
  return {
    eventId: `${args.turnId}:${args.suffix}`,
    conversationId: args.conversationId,
    turnId: args.turnId,
    type: args.type,
    payloadSchemaVersion: 1,
    payload: redact(args.payload),
    at: args.at,
  };
}

export function deriveProposedAction(effects: readonly ProposedEffectPlan[]): TurnAction {
  if (effects.some((e) => e.kind === "send_media")) return "send_photos";
  if (effects.some((e) => e.kind === "handoff")) return "handoff";
  if (effects.some((e) => e.kind === "schedule_visit")) return "schedule_visit";
  return "reply";
}

export function ensureSendMessage(effects: readonly ProposedEffectPlan[]): ProposedEffectPlan[] {
  const list = [...effects];
  if (!list.some((e) => e.kind === "send_message")) {
    list.unshift({ kind: "send_message", planId: "reply", order: 0, onSuccess: [] } as ProposedEffectPlan);
  }
  return list;
}

export function isKernelQueryCall(call: CentralQueryCall): call is QueryCall {
  return call.tool === "stock_search" || call.tool === "vehicle_details" || call.tool === "vehicle_photos_resolve" || call.tool === "crm_read";
}
