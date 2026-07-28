// ─────────────────────────────────────────────────────────────────────────────
// FASE 2 — Persistência garantida da conversa privada na linha de IA.
//
// PROBLEMA (causas 4/5/6 do gateway): na instância de IA, o webhook retornava
// ANTES de gravar em `wa_inbox` quando o agente estava inativo (agent_not_found),
// quando a mensagem era `fromMe` (from_me), ou a gravação do gate de pausa ficava
// DEPOIS do `selectActiveAgent`. Resultado: mensagens reais de cliente sumiam de
// "Conversas IA" sempre que a automação não estava rodando.
//
// PRINCÍPIO: "A automação pode parar, mas o rastreamento nunca pode parar."
// Este módulo grava TODA mensagem privada real ANTES de qualquer decisão de IA
// (selectActiveAgent / is_active / horário / ai_paused / despacho V3), de forma
// idempotente e sem nunca disparar inteligência, resposta ou follow-up.
//
// Ele NÃO decide envio, NÃO chama V2/V3, NÃO mexe em CRM/transferência/follow-up.
// Só classifica + persiste. A decisão HTTP (retry/200) fica no webhook chamador.
// ─────────────────────────────────────────────────────────────────────────────

import type { UazapiInboundAudience } from "./inboundAudience.ts";
import { phonesMatch, resolveUazapiPhone, resolveUazapiText } from "./phone.ts";

// ── Tipos ────────────────────────────────────────────────────────────────────

export type PersistDirection = "incoming" | "outgoing";

export type PersistClassification =
  | { persist: false; reason: string }
  | { persist: true; direction: PersistDirection; fromMe: boolean; reason: string };

export type PersistStatus = "persisted" | "deduped" | "skipped" | "error";

export interface PersistResult {
  status: PersistStatus;
  reason: string;
  direction?: PersistDirection;
  remote_message_id?: string | null;
  /** Só presente em status "error": permite ao webhook decidir retry x seguir. */
  error?: string;
}

export interface PersistDeps {
  supabase: any;
  waInstance: { id: string; user_id: string; phone_number?: string | null };
  agentsList: any[];
  payload: any;
  audience: UazapiInboundAudience;
  isMessageUpdate: boolean;
  /** injeção para teste; default = agora */
  now?: () => string;
}

// ── Helpers puros de extração (espelham o branch de vendedor do webhook) ───────

function pickIncoming(payload: any): any {
  if (Array.isArray(payload?.messages) && payload.messages.length > 0) return payload.messages[0];
  if (Array.isArray(payload?.data) && payload.data.length > 0) return payload.data[0];
  return payload?.message || payload?.data || payload || {};
}

export function detectMessageType(payload: any): "text" | "image" | "audio" | "video" | "document" {
  const m = pickIncoming(payload);
  const t = String(m?.messageType || m?.type || m?.mediaType || "").toLowerCase();
  if (t.includes("image") || m?.message?.imageMessage) return "image";
  if (t.includes("audio") || t.includes("ptt") || m?.message?.audioMessage) return "audio";
  if (t.includes("video") || m?.message?.videoMessage) return "video";
  if (t.includes("document") || m?.message?.documentMessage) return "document";
  return "text";
}

export function extractMediaUrl(payload: any, type: string): string | null {
  if (type === "text") return null;
  const m = pickIncoming(payload);
  const nested =
    m?.message?.imageMessage?.url ||
    m?.message?.audioMessage?.url ||
    m?.message?.videoMessage?.url ||
    m?.message?.documentMessage?.url ||
    null;
  return m?.mediaUrl || m?.directUrl || m?.media_url || m?.url || nested || null;
}

export function extractContent(payload: any, type: string): string {
  const raw = resolveUazapiText(payload);
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  if (type === "image") return "[imagem recebida]";
  if (type === "audio") return "[áudio recebido]";
  if (type === "video") return "[vídeo recebido]";
  if (type === "document") return "[documento recebido]";
  return "[mensagem recebida]";
}

export function extractMessageId(payload: any): string | null {
  const m = pickIncoming(payload);
  const candidates = [
    m?.key?.id,
    m?.messageid,
    m?.messageId,
    m?.id,
    payload?.message?.key?.id,
    payload?.data?.key?.id,
    payload?.messageid,
    payload?.messageId,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  return null;
}

export function extractContactName(payload: any): string | null {
  const m = pickIncoming(payload);
  const name = m?.pushName || m?.senderName || m?.notifyName || payload?.pushName || payload?.senderName || null;
  return typeof name === "string" && name.trim() ? name.trim() : null;
}

/** Número do provedor pode vir "<sender>:<id>"; devolve o id "core" após o ':'. */
export function coreMessageId(msgId: string): string {
  const s = String(msgId || "");
  return s.includes(":") ? s.split(":").pop() || s : s;
}

/** Números internos conhecidos SEM custo de DB (linha da própria instância + gerentes). */
export function collectInternalNumbers(deps: Pick<PersistDeps, "waInstance" | "agentsList">): string[] {
  const nums: Array<string | null | undefined> = [deps.waInstance?.phone_number];
  for (const a of deps.agentsList || []) {
    nums.push(a?.gerente_phone, a?.gerente_phone_2, a?.human_whatsapp);
  }
  return nums.map((n) => String(n || "").trim()).filter(Boolean);
}

// ── Classificação (requisito 1), pura e testável ──────────────────────────────

export function classifyForPersist(
  audience: UazapiInboundAudience,
  opts: { isMessageUpdate: boolean },
): PersistClassification {
  // Receipt/status callback NUNCA é mensagem.
  if (opts.isMessageUpdate) return { persist: false, reason: "message_update_receipt" };
  // Defesa: grupo/broadcast já foram barrados no webhook; nunca persistir aqui.
  if (audience.kind === "group" || audience.kind === "broadcast") {
    return { persist: false, reason: audience.kind };
  }
  // fromMe = saída da nossa linha (manual OU automática — desambiguado no efeito).
  if (audience.kind === "self") {
    return { persist: true, direction: "outgoing", fromMe: true, reason: "from_me_outbound" };
  }
  // direct = inbound real do cliente.
  return { persist: true, direction: "incoming", fromMe: false, reason: "client_inbound" };
}

// ── Checagens efetivas (idempotência / V3-auto) ───────────────────────────────

function isUniqueViolation(error: any): boolean {
  if (!error) return false;
  if (String(error.code) === "23505") return true;
  const msg = String(error.message || error.details || "").toLowerCase();
  return msg.includes("wa_inbox_remote_msg_unique") || msg.includes("duplicate key");
}

/**
 * Requisito 7: uma `fromMe` cujo message id JÁ é uma saída automática do V3 não
 * pode ser gravada como manual (o V3 já a registra em v3_effect_outbox e a RPC a
 * mostra como 'ia'). Casa por provider_receipt->>providerMessageId, tolerando o
 * prefixo "<sender>:<id>". Fail-CLOSED: na dúvida (erro), tratamos como automática
 * e NÃO gravamos — evitar duplicar/relabelar é mais importante que capturar uma
 * eventual manual (o inbound do cliente, que é o essencial, é tratado à parte).
 */
export async function isV3AutoOutbound(supabase: any, tenant: string, msgId: string): Promise<boolean> {
  const full = String(msgId || "");
  if (!full) return false;
  // O id "core" (sem o prefixo "<sender>:") é alfanumérico -> seguro como sufixo de
  // LIKE. `%core` casa tanto "core" quanto "sender:core", cobrindo as duas formas em
  // que o provider grava/entrega o id, sem quebrar o parser de filtro do PostgREST.
  const core = coreMessageId(full);
  if (!core) return false;
  try {
    const { data, error } = await supabase
      .from("v3_effect_outbox")
      .select("effect_id")
      .eq("tenant_id", tenant)
      .in("kind", ["send_message", "send_media"])
      .like("provider_receipt->>providerMessageId", `%${core}`)
      .limit(1);
    if (error) return true; // fail-closed: na dúvida, trata como automática (não duplica)
    return Array.isArray(data) && data.length > 0;
  } catch {
    return true; // fail-closed
  }
}

// ── Persistência (orquestra classificação + efeito) ───────────────────────────

export async function persistPrivateInboundMessage(deps: PersistDeps): Promise<PersistResult> {
  const { supabase, waInstance, payload, audience, isMessageUpdate } = deps;
  const nowIso = (deps.now || (() => new Date().toISOString()))();

  const cls = classifyForPersist(audience, { isMessageUpdate });
  if (!cls.persist) return { status: "skipped", reason: cls.reason };

  const phone = resolveUazapiPhone(payload);
  if (!phone) return { status: "skipped", reason: "no_phone" };

  // Requisito 1: mensagem interna (gerente/linha-da-instância) não é conversa de
  // cliente. Vendedores já retornam antes (seller-ACK); a RPC de listagem também
  // exclui internos (logos_internal_keys) — aqui é a barreira barata em memória.
  const internalNumbers = collectInternalNumbers(deps);
  if (internalNumbers.some((n) => phonesMatch(phone, n))) {
    return { status: "skipped", reason: "internal_identity" };
  }

  const msgId = extractMessageId(payload);
  const messageType = detectMessageType(payload);
  const content = extractContent(payload, messageType);
  const mediaUrl = extractMediaUrl(payload, messageType);
  const contactName = extractContactName(payload);

  // Requisito 6/7: fromMe automática do V3 -> já rastreada, não gravar.
  if (cls.direction === "outgoing" && msgId) {
    if (await isV3AutoOutbound(supabase, waInstance.user_id, msgId)) {
      return { status: "skipped", reason: "from_me_v3_auto", remote_message_id: msgId };
    }
  }

  const row = {
    user_id: waInstance.user_id,
    instance_id: waInstance.id,
    phone,
    contact_name: contactName,
    direction: cls.direction,
    message_type: messageType,
    content,
    media_url: mediaUrl,
    is_read: cls.direction === "outgoing", // saída nossa já nasce "lida"
    is_archived: false,
    remote_message_id: msgId,
    created_at: nowIso,
  };

  // Requisito 8: idempotência por (user_id, instance_id, remote_message_id).
  // O índice é PARCIAL (WHERE remote_message_id IS NOT NULL), então `onConflict`
  // via PostgREST não é confiável — usamos o padrão já vigente no codebase: insert
  // e captura da unique-violation (23505) como "deduped".
  try {
    const { error } = await supabase.from("wa_inbox").insert(row);
    if (error) {
      if (isUniqueViolation(error)) {
        return { status: "deduped", reason: "dedup_unique", direction: cls.direction, remote_message_id: msgId };
      }
      // Requisito 9: nunca esconder; reportar erro observável ao chamador.
      return {
        status: "error",
        reason: cls.reason,
        direction: cls.direction,
        remote_message_id: msgId,
        error: String(error.message || error).slice(0, 300),
      };
    }
    return { status: "persisted", reason: cls.reason, direction: cls.direction, remote_message_id: msgId };
  } catch (e) {
    return {
      status: "error",
      reason: cls.reason,
      direction: cls.direction,
      remote_message_id: msgId,
      error: String((e as any)?.message || e).slice(0, 300),
    };
  }
}
