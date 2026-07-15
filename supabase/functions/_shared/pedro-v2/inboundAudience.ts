import { resolveUazapiRemoteJid } from "./phone.ts";

export type UazapiInboundAudience =
  | { kind: "direct"; remoteJid: string }
  | { kind: "self"; remoteJid: string }
  | { kind: "group"; remoteJid: string }
  | { kind: "broadcast"; remoteJid: string };

function firstMessageLike(payload: any): any {
  if (Array.isArray(payload?.messages) && payload.messages.length > 0) return payload.messages[0];
  if (Array.isArray(payload?.data) && payload.data.length > 0) return payload.data[0];
  return payload?.message || payload?.data || payload || {};
}

function isTrue(value: unknown): boolean {
  return value === true || value === 1 || String(value || "").toLowerCase() === "true";
}

function hasTrue(values: readonly unknown[]): boolean {
  return values.some(isTrue);
}

/** Classifies the Uazapi envelope before CRM or a conversational engine. */
export function classifyUazapiInboundAudience(payload: any): UazapiInboundAudience {
  const message = firstMessageLike(payload);
  const key = message?.key || payload?.key || payload?.message?.key || payload?.data?.key || {};
  const remoteJid = resolveUazapiRemoteJid(payload);

  const isGroup = hasTrue([
    message?.isGroup,
    message?.IsGroup,
    message?.is_group,
    payload?.isGroup,
    payload?.IsGroup,
    payload?.is_group,
    payload?.data?.isGroup,
    payload?.data?.IsGroup,
    payload?.data?.is_group,
    message?.chat?.wa_isGroup,
    payload?.chat?.wa_isGroup,
    payload?.data?.chat?.wa_isGroup,
  ]) || /@g\.us$/i.test(remoteJid);
  if (isGroup) return { kind: "group", remoteJid };

  if (/@broadcast$|@newsletter$|status@broadcast$/i.test(remoteJid)) {
    return { kind: "broadcast", remoteJid };
  }

  const isFromMe = hasTrue([
    message?.fromMe,
    message?.FromMe,
    message?.isFromMe,
    key?.fromMe,
    payload?.fromMe,
    payload?.FromMe,
    payload?.isFromMe,
    payload?.data?.fromMe,
    payload?.data?.FromMe,
    payload?.data?.isFromMe,
  ]);
  return { kind: isFromMe ? "self" : "direct", remoteJid };
}
