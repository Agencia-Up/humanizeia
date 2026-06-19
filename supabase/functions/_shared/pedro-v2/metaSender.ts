// ── Envio pela Cloud API oficial do Meta (segunda via, ao lado da UAZAPI) ─────
// Espelha a interface de uazapiSender (sendPedroText/sendPedroMedia) pra que o
// orquestrador do Pedro NAO precise saber qual provedor esta usando — a
// ramificacao por `instance.provider === 'meta'` mora no topo dos dois senders
// UAZAPI e delega pra ca. So-HTTP: usa o token POR INSTANCIA (meta_config), nao
// precisa de App ID/Secret (esses sao so do onboarding/webhook).

import { digitsOnly } from "./phone.ts";
import { splitMessageForHumanizationLLM } from "../humanization/llmMessageSplit.ts";

type MetaWaInstance = {
  api_url?: string | null;
  api_key_encrypted?: string | null;
  meta_config?: {
    phone_number_id?: string | null;
    access_token_encrypted?: string | null;
  } | null;
};

const META_GRAPH_VERSION = Deno.env.get("META_GRAPH_VERSION") || "v25.0";

function graphBase(instance: MetaWaInstance): string {
  const fromInstance = String(instance.api_url || "").replace(/\/+$/, "");
  if (fromInstance.startsWith("http")) return fromInstance;
  return `https://graph.facebook.com/${META_GRAPH_VERSION}`;
}

function metaToken(instance: MetaWaInstance): string {
  return instance.meta_config?.access_token_encrypted || instance.api_key_encrypted || "";
}

function metaPhoneNumberId(instance: MetaWaInstance): string {
  return String(instance.meta_config?.phone_number_id || "");
}

// Meta quer o destino em E.164 SEM o '+': so digitos. Mesma normalizacao de DDI
// 55 (Brasil) que o sender UAZAPI usa quando vem so DDD+numero.
function normalizeMetaTo(value: string): string {
  const digits = digitsOnly(value);
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return digits;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function calculateMetaDelayMs(text: string) {
  // Sem presenca de "digitando" no Meta; mantem um respiro proporcional ao
  // tamanho pra nao despejar varias partes instantaneamente.
  const len = String(text || "").length;
  const bySize = Math.min(4000, len * 24);
  const jitter = Math.floor(Math.random() * 1200);
  return Math.max(1200, Math.min(6000, 1200 + bySize + jitter));
}

async function postMessages(instance: MetaWaInstance, body: Record<string, unknown>) {
  const base = graphBase(instance);
  const token = metaToken(instance);
  const phoneNumberId = metaPhoneNumberId(instance);
  if (!token) throw new Error("Instancia Meta sem access token configurado");
  if (!phoneNumberId) throw new Error("Instancia Meta sem phone_number_id configurado");

  const res = await fetch(`${base}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", ...body }),
  });
  const status = res.status;
  if (res.ok) return { ok: true as const, status };
  const errText = await res.text().catch(() => "");
  return { ok: false as const, status, error: `meta HTTP ${status} ${errText}` };
}

async function sendMetaTextOnce(instance: MetaWaInstance, input: { to: string; text: string }) {
  const to = normalizeMetaTo(input.to);
  if (!to) throw new Error("Destino WhatsApp invalido");
  const result = await postMessages(instance, {
    to,
    type: "text",
    text: { preview_url: false, body: input.text },
  });
  return result.ok
    ? { ok: true, provider: "meta", attempt: "meta-text", status: result.status }
    : { ok: false, provider: "meta", error: result.error };
}

export async function sendMetaText(
  instance: MetaWaInstance,
  input: { to: string; text: string },
  options?: { humanize?: boolean; typingOnly?: boolean },
) {
  const to = normalizeMetaTo(input.to);
  if (!to) throw new Error("Destino WhatsApp invalido");

  // typingOnly nao existe no Meta (sem presenca) -> envia direto.
  if (!options?.humanize) {
    return sendMetaTextOnce(instance, { to, text: input.text });
  }

  // Mesma quebra natural usada no UAZAPI; sem "digitando", so um respiro entre partes.
  let parts: string[];
  try {
    parts = await splitMessageForHumanizationLLM(input.text, { maxParts: 3, minLength: 130 });
  } catch {
    parts = [input.text];
  }
  const attempts: any[] = [];
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index];
    if (index === 0) await sleep(calculateMetaDelayMs(part));
    const result = await sendMetaTextOnce(instance, { to, text: part });
    attempts.push(result);
    if (!result.ok) return { ...result, parts_sent: index, attempts };
    if (index < parts.length - 1) await sleep(900 + calculateMetaDelayMs(parts[index + 1]));
  }
  return { ok: true, provider: "meta", attempt: "meta-humanized-text", parts_sent: parts.length, attempts };
}

// Mídia do Meta: link público (caso comum — fotos de estoque são URLs http) ou
// upload prévio quando vier base64/data URL.
export async function sendMetaMedia(instance: MetaWaInstance, input: {
  to: string;
  file: string;
  type?: "image" | "audio" | "video" | "document";
  caption?: string;
}) {
  const to = normalizeMetaTo(input.to);
  if (!to) throw new Error("Destino WhatsApp invalido");
  const type = input.type || "image";
  const file = String(input.file || "");

  let mediaNode: Record<string, unknown>;
  if (/^https?:\/\//i.test(file)) {
    mediaNode = { link: file };
  } else {
    // base64 / data URL -> upload para /{phone_number_id}/media e envia por id.
    const uploaded = await uploadMetaMedia(instance, file, type);
    if (!uploaded.ok) return { ok: false, provider: "meta", error: uploaded.error };
    mediaNode = { id: uploaded.id };
  }
  // caption só vale p/ image/video/document (não para audio).
  if (input.caption && type !== "audio") mediaNode.caption = input.caption;

  const result = await postMessages(instance, { to, type, [type]: mediaNode });
  return result.ok
    ? { ok: true, provider: "meta", attempt: "meta-media", status: result.status }
    : { ok: false, provider: "meta", error: result.error };
}

async function uploadMetaMedia(instance: MetaWaInstance, file: string, type: string) {
  try {
    const base = graphBase(instance);
    const token = metaToken(instance);
    const phoneNumberId = metaPhoneNumberId(instance);
    const match = file.match(/^data:([^;,]+)?;base64,(.*)$/s);
    const mime = (match?.[1] || (type === "image" ? "image/jpeg" : "application/octet-stream")).trim();
    const b64 = (match?.[2] || file).replace(/\s/g, "");
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

    const form = new FormData();
    form.append("messaging_product", "whatsapp");
    form.append("type", mime);
    form.append("file", new Blob([bytes], { type: mime }), `upload.${mime.split("/")[1] || "bin"}`);

    const res = await fetch(`${base}/${phoneNumberId}/media`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data?.id) return { ok: true as const, id: String(data.id) };
    return { ok: false as const, error: `meta upload HTTP ${res.status} ${JSON.stringify(data)}` };
  } catch (err) {
    return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
  }
}
