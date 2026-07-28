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

/** Timestamp do PROVEDOR em segundos (aceita ms). null quando o payload não traz. */
export function extractProviderTimestamp(payload: any): number | null {
  const m = pickIncoming(payload);
  const candidates = [
    m?.messageTimestamp, m?.timestamp, m?.t, m?.key?.timestamp,
    payload?.messageTimestamp, payload?.timestamp,
    payload?.data?.messageTimestamp, payload?.message?.messageTimestamp,
  ];
  for (const c of candidates) {
    const n = Number(c);
    if (Number.isFinite(n) && n > 0) return n > 1e12 ? Math.floor(n / 1000) : Math.floor(n);
  }
  return null;
}

/** FNV-1a 32-bit em hex (síncrono, estável entre runtimes). */
export function contentHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/**
 * REVISÃO F2 (ponto 1): chave determinística de FALLBACK quando o provedor não
 * manda message id. Entra em `remote_message_id`, então o índice único
 * (user_id, instance_id, remote_message_id) passa a deduplicar retries TAMBÉM
 * sem id — antes, id nulo escapava do índice parcial e o retry DUPLICAVA.
 *
 * Composição: direção + telefone canônico + timestamp + tipo + hash(conteúdo+mídia).
 * tenant/instância ficam de fora DE PROPÓSITO: já são colunas do índice único.
 * Timestamp: o do PROVEDOR (segundo) quando existe — retry reentrega o mesmo
 * payload → mesma chave. Sem timestamp do provedor, usa balde de 60s do relógio
 * local (retries da uazapi chegam em segundos).
 *
 * COLISÕES (documentadas):
 *  - mesma direção+fone+mesmo segundo (ou mesmo balde de 60s sem ts do provedor)
 *    +mesmo tipo+conteúdo idêntico ⇒ tratado como UMA mensagem. É indistinguível
 *    de retry; cliente real mandando a MESMA frase 2x no MESMO segundo é raro e
 *    o custo é perder o eco, não a conversa.
 *  - conteúdos DIFERENTES colidindo no hash FNV-32 dentro do MESMO segundo/fone:
 *    ~2^-32 por par — desprezível.
 *  - retry SEM ts do provedor cruzando o balde de 60s ⇒ pode duplicar (residual,
 *    só quando o provedor não manda nem id nem timestamp).
 */
export function fallbackMessageKey(args: {
  direction: PersistDirection;
  phone: string;
  providerTsSec: number | null;
  nowIso: string;
  messageType: string;
  content: string;
  mediaUrl: string | null;
}): string {
  const ts = args.providerTsSec ?? Math.floor(Date.parse(args.nowIso) / 60000);
  const tsTag = args.providerTsSec != null ? `s${ts}` : `m${ts}`;
  const h = contentHash(`${args.content}|${args.mediaUrl || ""}`);
  return `fb1:${args.direction}:${args.phone}:${tsTag}:${args.messageType}:${h}`;
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
 * Requisito 7 + REVISÃO F2 (ponto 2): classifica uma `fromMe` em relação ao V3.
 *  - "auto": o message id JÁ é uma saída automática do V3 (v3_effect_outbox tem o
 *    providerMessageId) → NÃO gravar (a RPC já a mostra como 'ia').
 *  - "manual": não é do V3 → gravar como mensagem manual da linha.
 *  - "uncertain": a CONSULTA falhou. Antes isto era fail-closed (skip) e uma
 *    mensagem MANUAL podia desaparecer em silêncio. Agora o chamador ESTACIONA a
 *    linha (is_archived=true + ai_category='v3_uncertain') — durável e observável
 *    para reconciliação, fora dos previews públicos, sem duplicar como manual.
 * Casa por provider_receipt->>providerMessageId tolerando o prefixo "<sender>:".
 */
export type V3OutboundVerdict = "auto" | "manual" | "uncertain";

export async function classifyV3Outbound(supabase: any, tenant: string, msgId: string): Promise<V3OutboundVerdict> {
  const full = String(msgId || "");
  if (!full) return "manual";
  // O id "core" (sem o prefixo "<sender>:") é alfanumérico -> seguro como sufixo de
  // LIKE. `%core` casa tanto "core" quanto "sender:core", cobrindo as duas formas em
  // que o provider grava/entrega o id, sem quebrar o parser de filtro do PostgREST.
  const core = coreMessageId(full);
  if (!core) return "manual";
  try {
    const { data, error } = await supabase
      .from("v3_effect_outbox")
      .select("effect_id")
      .eq("tenant_id", tenant)
      .in("kind", ["send_message", "send_media"])
      .like("provider_receipt->>providerMessageId", `%${core}`)
      .limit(1);
    if (error) return "uncertain";
    return Array.isArray(data) && data.length > 0 ? "auto" : "manual";
  } catch {
    return "uncertain";
  }
}

/**
 * REVISÃO F2 (ponto 2b): `fromMe` SEM message id não passava por NENHUMA checagem
 * de V3 e era gravada como manual — podendo duplicar com a automática quando o
 * eco do provedor vem sem id. Checagem por CONTEÚDO numa janela curta: efeito
 * send_message do tenant, despachado nos últimos minutos, com o MESMO texto.
 * Aproximação documentada: a janela é por tenant (o outbox não tem instance_id);
 * duas instâncias do MESMO tenant enviando o MESMO texto no MESMO minuto seriam
 * fundidas — cenário improvável e o custo é o eco, não a conversa.
 */
export async function looksLikeRecentV3SendByContent(
  supabase: any,
  tenant: string,
  content: string,
  nowIso: string,
): Promise<V3OutboundVerdict> {
  const text = String(content || "").trim();
  if (!text) return "manual";
  const since = new Date(Date.parse(nowIso) - 3 * 60 * 1000).toISOString();
  try {
    const { data, error } = await supabase
      .from("v3_effect_outbox")
      .select("effect_id")
      .eq("tenant_id", tenant)
      .eq("kind", "send_message")
      .gte("dispatched_at", since)
      .eq("payload->>text", text)
      .limit(1);
    if (error) return "uncertain";
    return Array.isArray(data) && data.length > 0 ? "auto" : "manual";
  } catch {
    return "uncertain";
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

  // REVISÃO F2 (ponto 1): remote_message_id NUNCA vai nulo — sem id do provedor,
  // usa a chave determinística de fallback. Assim o índice único
  // (user_id, instance_id, remote_message_id) deduplica retry TAMBÉM sem id.
  const effectiveMsgId = msgId ?? fallbackMessageKey({
    direction: cls.direction,
    phone,
    providerTsSec: extractProviderTimestamp(payload),
    nowIso,
    messageType,
    content,
    mediaUrl,
  });

  // Requisito 6/7 + REVISÃO F2 (ponto 2): fromMe automática do V3 -> já rastreada,
  // não gravar. Com id casa por providerMessageId; sem id casa por CONTEÚDO em
  // janela curta. "uncertain" (consulta falhou) ESTACIONA a linha (abaixo) em vez
  // de sumir com uma possível manual.
  let parkUncertain = false;
  if (cls.direction === "outgoing") {
    const verdict = msgId
      ? await classifyV3Outbound(supabase, waInstance.user_id, msgId)
      : await looksLikeRecentV3SendByContent(supabase, waInstance.user_id, content, nowIso);
    if (verdict === "auto") {
      return { status: "skipped", reason: msgId ? "from_me_v3_auto" : "from_me_v3_auto_content", remote_message_id: effectiveMsgId };
    }
    parkUncertain = verdict === "uncertain";
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
    // "uncertain" fica ESTACIONADA: durável e observável (reconciliação lê
    // ai_category='v3_uncertain'), fora dos previews públicos (que filtram
    // is_archived=false). A timeline pública passa a excluir arquivadas na
    // Fase 4 — mais um motivo pra F2 não ser implantada sozinha.
    is_archived: parkUncertain,
    ai_category: parkUncertain ? "v3_uncertain" : null,
    remote_message_id: effectiveMsgId,
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
        return { status: "deduped", reason: "dedup_unique", direction: cls.direction, remote_message_id: effectiveMsgId };
      }
      // Requisito 9: nunca esconder; reportar erro observável ao chamador.
      return {
        status: "error",
        reason: cls.reason,
        direction: cls.direction,
        remote_message_id: effectiveMsgId,
        error: String(error.message || error).slice(0, 300),
      };
    }
    return {
      status: "persisted",
      reason: parkUncertain ? "from_me_uncertain_parked" : cls.reason,
      direction: cls.direction,
      remote_message_id: effectiveMsgId,
    };
  } catch (e) {
    return {
      status: "error",
      reason: cls.reason,
      direction: cls.direction,
      remote_message_id: effectiveMsgId,
      error: String((e as any)?.message || e).slice(0, 300),
    };
  }
}
