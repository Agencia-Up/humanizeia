import type { EffectResult, ToolError } from "../../domain/decision.ts";
import type { OutboxRecord } from "../../domain/effect-intent.ts";
import { redact } from "../../domain/effect-intent.ts";
import type { Clock } from "../../domain/ports.ts";
import type { TenantAgentRef, VehiclePhotoSource } from "../../domain/read-ports.ts";
import type { JsonValue } from "../../domain/types.ts";
import type { EffectDispatcher } from "../../engine/outbox-dispatcher.ts";

export type WhatsAppReceiptLevel = "accepted" | "delivered";

export type WhatsAppSendOk = {
  readonly ok: true;
  readonly level: WhatsAppReceiptLevel;
  readonly providerMessageId?: string;
};

export type WhatsAppSendFail = {
  readonly ok: false;
  readonly code: ToolError["code"];
  readonly message: string;
  readonly retryable: boolean;
};

export type WhatsAppSendResult = WhatsAppSendOk | WhatsAppSendFail;

export type WhatsAppTextInput = {
  readonly to: string;
  readonly text: string;
  readonly idempotencyKey: string;
  // UX de transporte: somente a mensagem que vai ao lead pede presenca "digitando".
  // Notificacoes de vendedor usam a mesma porta, mas nao devem simular digitacao.
  readonly showTyping?: boolean;
};

export type WhatsAppMediaInput = {
  readonly to: string;
  readonly url: string;
  readonly photoId: string;
  readonly idempotencyKey: string;
};

export interface WhatsAppSendPort {
  sendText(input: WhatsAppTextInput): Promise<WhatsAppSendResult>;
  sendImage(input: WhatsAppMediaInput): Promise<WhatsAppSendResult>;
}

export type WhatsAppDispatcherOptions = {
  readonly ref: TenantAgentRef;
  readonly conversationId: string;
  readonly to: string;
  readonly clock: Clock;
  readonly sender: WhatsAppSendPort;
  readonly photoSource: VehiclePhotoSource;
  // Ativado pelo runtime de producao. Em testes e composicoes antigas, ausente = sem delay visual.
  readonly typingEnabled?: boolean;
};

function toolError(code: ToolError["code"], message: string, retryable: boolean): ToolError {
  return { code, message, retryable };
}

function isRecordObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function payloadOf(record: OutboxRecord): Record<string, unknown> {
  const { __redacted: _ignored, ...payload } = record.payload as Record<string, unknown>;
  return payload;
}

function stringField(payload: Record<string, unknown>, field: string): string | null {
  const value = payload[field];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function stringArrayField(payload: Record<string, unknown>, field: string): string[] | null {
  const value = payload[field];
  if (!Array.isArray(value)) return null;
  const out = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  return out.length === value.length && out.length > 0 ? out : null;
}

// ⭐CADEIA DE MÍDIA: lê o SNAPSHOT {id,url} gravado no outbox pelo turno que resolveu as fotos. Fail-closed por item:
// só entram pares íntegros; snapshot parcialmente corrompido devolve null e o envio cai no caminho legado de exceção.
// Nenhuma url pode vir da LLM — este campo é escrito exclusivamente pelo resultado da tool.
// ⭐GATE DE SEGURANÇA DE MÍDIA (auditoria Codex, 2026-07-19). O snapshot fica PERSISTIDO no outbox e pode ser
// despachado minutos depois, por outro processo. Portanto a url NÃO pode ser confiada só por ter vindo da tool:
// ela é revalidada AQUI, na borda do envio, antes de ir para o provedor.
//
// Fail-closed e por INVARIANTE, não por lista de domínio (que envelheceria a cada troca de CDN do estoque):
//   - só `https:` — mata `http:`, `data:`, `file:`, `javascript:` e qualquer esquema exótico;
//   - sem credenciais embutidas (`user:pass@host`), que vazariam segredo no envio;
//   - host presente e não-local — bloqueia SSRF para localhost / IP interno.
// A LLM nunca escreve este campo (só o resultado da tool o preenche); este guard cobre o caso de registro
// corrompido, adulterado ou vindo de uma versão antiga do contrato.
const PRIVATE_HOST_RX = /^(?:localhost|127\.|0\.0\.0\.0|10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.|\[?::1\]?)/i;
export function isSafeMediaUrl(raw: string): boolean {
  let url: URL;
  try { url = new URL(raw); } catch { return false; }
  if (url.protocol !== "https:") return false;
  if (url.username || url.password) return false;
  if (!url.hostname) return false;
  return !PRIVATE_HOST_RX.test(url.hostname);
}

function mediaSnapshotField(payload: Record<string, unknown>): { id: string; url: string }[] | null {
  const value = payload.media;
  if (!Array.isArray(value) || value.length === 0) return null;
  const out: { id: string; url: string }[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) return null;
    const rec = item as Record<string, unknown>;
    const id = typeof rec.id === "string" ? rec.id.trim() : "";
    const url = typeof rec.url === "string" ? rec.url.trim() : "";
    if (!id || !url) return null;
    out.push({ id, url });
  }
  return out;
}

function failed(record: OutboxRecord, code: ToolError["code"], message: string, retryable: boolean): EffectResult {
  return { status: "failed", effectId: record.effectId, error: toolError(code, message, retryable) };
}

function succeeded(record: OutboxRecord, level: WhatsAppReceiptLevel, at: string, providerMessageId?: string, perItem?: { photoId: string; status: "succeeded" | "failed" }[]): EffectResult {
  return {
    status: "succeeded",
    effectId: record.effectId,
    receipt: {
      effectId: record.effectId,
      level,
      at,
      providerMessageId,
      ...(perItem ? { perItem } : {}),
    },
  };
}

function uncertain(record: OutboxRecord, reason: string): EffectResult {
  return {
    status: "outcome_uncertain",
    effectId: record.effectId,
    metadata: redact({ reason } satisfies { [k: string]: JsonValue }),
  };
}

// Rotulo SEGURO de erro p/ diagnostico: nome + code (enum-like) do erro, NUNCA a mensagem (que pode
// conter token/segredo). Ex.: "SupabaseServiceGatewayError:HTTP_FAILURE" ou "Error". Sem isso, o catch
// devolvia so "sender_text_exception" e a causa do envio ficava invisivel (F2.6Q).
function safeErrLabel(error: unknown): string {
  const name = error instanceof Error && typeof error.name === "string" && error.name ? error.name : "Error";
  const codeRaw = (error as { code?: unknown } | null | undefined)?.code;
  const code = typeof codeRaw === "string" && /^[A-Za-z0-9_.:/ -]{1,80}$/.test(codeRaw) ? `:${codeRaw}` : "";
  return `${name}${code}`;
}

function combineLevels(results: readonly WhatsAppSendOk[]): WhatsAppReceiptLevel {
  return results.every((item) => item.level === "delivered") ? "delivered" : "accepted";
}

// A LLM autora os parágrafos; o transporte apenas materializa a quebra visual
// em balões. Listas estruturadas permanecem intactas para não separar itens,
// valores e o contexto da oferta.
export function splitWhatsAppTextBubbles(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed || /\n\s*\d+[.)]\s/u.test(trimmed)) return [trimmed];
  const paragraphs = trimmed.split(/\n\s*\n+/u).map((part) => part.trim()).filter(Boolean);
  if (paragraphs.length < 2) return [trimmed];
  return [paragraphs[0], paragraphs.slice(1).join("\n\n")];
}

export class WhatsAppEffectDispatcher implements EffectDispatcher {
  constructor(private readonly opts: WhatsAppDispatcherOptions) {}

  async dispatch(record: OutboxRecord): Promise<EffectResult> {
    if (record.conversationId !== this.opts.conversationId) {
      return failed(record, "FORBIDDEN", "conversation_mismatch", false);
    }

    if (record.kind === "send_message") return this.dispatchText(record);
    if (record.kind === "send_media") return this.dispatchMedia(record);

    return failed(record, "FORBIDDEN", `unsupported_effect_kind:${record.kind}`, false);
  }

  private async dispatchText(record: OutboxRecord): Promise<EffectResult> {
    const payload = payloadOf(record);
    if (!isRecordObject(payload)) return failed(record, "VALIDATION", "invalid_payload", false);

    const text = stringField(payload, "text");
    if (!text) return failed(record, "VALIDATION", "missing_text", false);

    const bubbles = splitWhatsAppTextBubbles(text);
    const successes: WhatsAppSendOk[] = [];
    for (let index = 0; index < bubbles.length; index += 1) {
      let result: WhatsAppSendResult;
      try {
        result = await this.opts.sender.sendText({
          to: this.opts.to,
          text: bubbles[index],
          idempotencyKey: bubbles.length === 1 ? record.idempotencyKey : `${record.idempotencyKey}:bubble:${index + 1}`,
          showTyping: this.opts.typingEnabled === true,
        });
      } catch (error) {
        const label = safeErrLabel(error);
        console.error(JSON.stringify({ event: "pedro_v3_send_text_exception", effectId: record.effectId, label }));
        return uncertain(record, `sender_text_exception:${label}`);
      }
      if (!result.ok) return failed(record, result.code, result.message, result.retryable);
      successes.push(result);
    }
    return succeeded(
      record,
      combineLevels(successes),
      this.opts.clock.now(),
      successes.map((item) => item.providerMessageId).filter(Boolean).join(",") || undefined,
    );
  }

  private async dispatchMedia(record: OutboxRecord): Promise<EffectResult> {
    const payload = payloadOf(record);
    if (!isRecordObject(payload)) return failed(record, "VALIDATION", "invalid_payload", false);

    const vehicleKey = stringField(payload, "vehicleKey");
    const photoIds = stringArrayField(payload, "photoIds");
    if (!vehicleKey || !photoIds) return failed(record, "VALIDATION", "missing_media_reference", false);

    // ── ⭐CADEIA DE MÍDIA (2026-07-19). O elo que estava quebrado. ────────────────────────────────────────────────
    //
    // ANTES: este ponto SEMPRE chamava `photoSource.resolveUrls`, que faz `loader.loadAll(ref)` — uma SEGUNDA leitura
    // do feed de estoque AO VIVO, agora. Se qualquer coisa tivesse mudado desde a resolução no turno (carro vendido,
    // fingerprint colidindo, UMA foto removida), a contagem divergia e caía em
    // `failed(..., "media_reference_not_resolvable", retryable:false)`: as fotos sumiam, sem retry, em silêncio.
    // O turno resolveu certo, a LLM autorizou, e o envio jogava fora o resultado. Era o oposto do N8N, onde a saída
    // de um nó É a entrada do próximo.
    //
    // AGORA: o snapshot resolvido pela tool viaja no payload e é USADO. As urls do feed não são assinadas nem expiram
    // (vêm de `vehicle.pictureJs`) — foi essa verificação que tornou o snapshot a escolha correta.
    // `resolveUrls` vira o CAMINHO DE EXCEÇÃO: só para registros antigos, gravados antes deste contrato.
    const snapshot = mediaSnapshotField(payload);
    let pairs: { photoId: string; url: string }[];
    if (snapshot && snapshot.length > 0) {
      pairs = snapshot.map((m) => ({ photoId: m.id, url: m.url }));
    } else {
      // ⭐GATE 2 (auditoria Codex): plano NOVO sem snapshot é anomalia — o caminho legado existe só para registros
      // gravados antes deste contrato. Fica OBSERVÁVEL para a gente detectar um elo que parou de propagar o snapshot,
      // em vez de descobrir de novo por um lead sem foto.
      console.warn(JSON.stringify({ event: "pedro_v3_media_missing_snapshot", effectId: record.effectId, vehicleKey }));
      const urls = await this.opts.photoSource.resolveUrls(this.opts.ref, vehicleKey, photoIds);
      // ⭐Deriva de feed deixa de ser FATAL. Antes, `urls.length !== photoIds.length` matava o envio inteiro. Agora
      // envia o que resolveu e só falha se NADA resolveu — e essa falha fica observável no motivo, não muda de
      // "as fotos sumiram" para "deu erro genérico".
      pairs = urls.map((url, i) => ({ photoId: photoIds[i] ?? `idx-${i}`, url })).filter((p) => !!p.url);
      if (pairs.length === 0) return failed(record, "VALIDATION", "media_reference_not_resolvable", false);
      if (pairs.length !== photoIds.length) {
        console.warn(JSON.stringify({
          event: "pedro_v3_media_snapshot_drift", effectId: record.effectId,
          requested: photoIds.length, resolved: pairs.length, reason: "legacy_payload_without_snapshot",
        }));
      }
    }

    // ⭐GATE 3 (auditoria Codex): valida a URL na BORDA DO ENVIO, para os DOIS caminhos. O snapshot é persistido e
    // despachado depois, possivelmente por outro processo — "veio da tool" não basta como prova no momento do envio.
    // Item inseguro é DESCARTADO (não derruba o envio inteiro) e fica observável; se NENHUM sobrar, falha explícita.
    const unsafe = pairs.filter((p) => !isSafeMediaUrl(p.url));
    if (unsafe.length > 0) {
      console.error(JSON.stringify({
        event: "pedro_v3_media_url_rejected", effectId: record.effectId, vehicleKey,
        rejected: unsafe.length, photoIds: unsafe.map((p) => p.photoId),
      }));
      pairs = pairs.filter((p) => isSafeMediaUrl(p.url));
      if (pairs.length === 0) return failed(record, "VALIDATION", "media_url_unsafe", false);
    }

    const successes: WhatsAppSendOk[] = [];
    const perItem: { photoId: string; status: "succeeded" | "failed" }[] = [];
    for (let i = 0; i < pairs.length; i += 1) {
      const photoId = pairs[i].photoId;
      const url = pairs[i].url;
      let result: WhatsAppSendResult;
      try {
        result = await this.opts.sender.sendImage({
          to: this.opts.to,
          url,
          photoId,
          idempotencyKey: `${record.idempotencyKey}:${photoId}`,
        });
      } catch (error) {
        const label = safeErrLabel(error);
        console.error(JSON.stringify({ event: "pedro_v3_send_media_exception", effectId: record.effectId, label }));
        return uncertain(record, `sender_media_exception:${label}`);
      }

      if (!result.ok) {
        perItem.push({ photoId, status: "failed" });
        if (result.retryable) return uncertain(record, "media_send_partial_retryable");
        return failed(record, result.code, result.message, false);
      }

      successes.push(result);
      perItem.push({ photoId, status: "succeeded" });
    }

    return succeeded(
      record,
      combineLevels(successes),
      this.opts.clock.now(),
      successes.map((item) => item.providerMessageId).filter(Boolean).join(",") || undefined,
      perItem,
    );
  }
}
