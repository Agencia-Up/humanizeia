type PedroV2MediaContext = {
  has_media_context: boolean;
  kind?: string | null;
  source?: string | null;
  message_id?: string | null;
  media_data_url?: string | null;
  media_url?: string | null;
  text?: string | null;
  vehicle_query?: string | null;
  vehicle_type?: string | null;
  summary?: string | null;
  confidence?: number;
  diagnostics?: Record<string, unknown>;
};

const IMAGE_MIME_RE = /^image\/(png|jpe?g|webp)$/i;
const MEDIA_KEYS = [
  "imageMessage",
  "videoMessage",
  "audioMessage",
  "documentMessage",
  "stickerMessage",
  "jpegThumbnail",
  "thumbnail",
  "thumbnailUrl",
  "thumbnail_url",
  "thumbnailDirectPath",
  "mediaUrl",
  "media_url",
  "fileUrl",
  "file_url",
  "imageUrl",
  "image_url",
  "directPath",
  "url",
  "base64",
  "file",
  "media",
  "mimetype",
  "mimeType",
];

function asText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeText(value?: string | null): string {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function pickIncomingMessage(payload: any): any {
  if (Array.isArray(payload?.messages) && payload.messages.length > 0) return payload.messages[0];
  if (Array.isArray(payload?.data) && payload.data.length > 0) return payload.data[0];
  return payload?.message || payload?.data || payload;
}

function compact(values: Array<string | null | undefined>) {
  return values
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .filter((value, index, arr) => arr.indexOf(value) === index)
    .join(" | ");
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return values
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .filter((value, index, arr) => arr.indexOf(value) === index);
}

function collectKeys(value: unknown, found = new Set<string>(), depth = 0) {
  if (!value || depth > 7) return found;
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 20)) collectKeys(item, found, depth + 1);
    return found;
  }
  if (typeof value === "object") {
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (MEDIA_KEYS.includes(key)) found.add(key);
      collectKeys(nested, found, depth + 1);
    }
  }
  return found;
}

function pickMessageId(payload: any): string | null {
  const message = pickIncomingMessage(payload);
  const candidates = [
    message?.id,
    message?.messageid,
    message?.messageId,
    message?.message_id,
    message?.id?.id,
    message?.key?.id,
    message?.msgId,
    message?.data?.id,
    message?.data?.id?.id,
    message?.data?.messageid,
    message?.data?.messageId,
    message?.data?.message_id,
    message?.data?.key?.id,
    payload?.id,
    payload?.id?.id,
    payload?.messageid,
    payload?.messageId,
    payload?.message_id,
    payload?.data?.id,
    payload?.data?.id?.id,
    payload?.data?.messageid,
    payload?.data?.messageId,
    payload?.data?.message_id,
    payload?.data?.key?.id,
    payload?.message?.id,
    payload?.message?.id?.id,
    payload?.message?.messageid,
    payload?.message?.messageId,
    payload?.message?.message_id,
    payload?.message?.key?.id,
  ];
  return candidates.map(asText).find(Boolean) || null;
}

function expandMessageIdCandidates(messageId: string | null): string[] {
  const id = asText(messageId);
  const afterColon = id?.includes(":") ? id.split(":").filter(Boolean).pop() : null;
  return uniqueStrings([id, afterColon]);
}

function pickKind(payload: any): string | null {
  const text = normalizeText(JSON.stringify(collectKeys(payload)));
  const message = pickIncomingMessage(payload);
  const mime = asText(message?.mimetype || message?.mimeType || payload?.mimetype || payload?.mimeType);
  if (mime?.startsWith("image/") || text.includes("imagemessage") || text.includes("jpegthumbnail")) return "image";
  if (mime?.startsWith("audio/") || text.includes("audiomessage")) return "audio";
  if (mime?.startsWith("video/") || text.includes("videomessage")) return "video";
  if (mime || text.includes("documentmessage")) return "document";
  return null;
}

function pickCaption(payload: any): string | null {
  const message = pickIncomingMessage(payload);
  const nested = message?.message || payload?.data?.message || payload?.message || {};
  const content = message?.content || payload?.content || {};
  const candidates = [
    message?.caption,
    message?.text,
    message?.body,
    nested?.imageMessage?.caption,
    nested?.videoMessage?.caption,
    nested?.documentMessage?.caption,
    nested?.conversation,
    nested?.extendedTextMessage?.text,
    content?.caption,
    content?.text,
    payload?.caption,
    payload?.text,
    payload?.body,
    payload?.data?.caption,
    payload?.data?.text,
    payload?.data?.body,
  ];
  return candidates.map(asText).find(Boolean) || null;
}

function bytesToDataUrl(bytes: number[], mime = "image/jpeg"): string | null {
  if (!bytes.length) return null;
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.slice(i, i + 8192));
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

function findFirstImageCandidate(value: unknown, depth = 0): string | null {
  if (!value || depth > 9) return null;

  if (Array.isArray(value) && value.length > 20 && value.every((item) => Number.isInteger(item) && Number(item) >= 0 && Number(item) <= 255)) {
    return bytesToDataUrl(value as number[]);
  }

  if (typeof value === "string") {
    const text = value.trim();
    if (text.startsWith("data:image/")) return text;
    if (/^https?:\/\//i.test(text) && (
      /\.(png|jpe?g|webp)(\?.*)?$/i.test(text) ||
      /(?:fbcdn|scontent|image|thumbnail|media|blob\.core)/i.test(text)
    )) return text;
    if (text.length > 80 && /^[A-Za-z0-9+/=\r\n]+$/.test(text)) {
      return `data:image/jpeg;base64,${text}`;
    }
    return null;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findFirstImageCandidate(item, depth + 1);
      if (found) return found;
    }
    return null;
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const mime = asText(record.mimetype || record.mimeType) || "image/jpeg";
    if (Array.isArray(record.data) && String(record.type || "").toLowerCase() === "buffer") {
      return bytesToDataUrl(record.data as number[], IMAGE_MIME_RE.test(mime) ? mime : "image/jpeg");
    }

    const priority = [
      "jpegThumbnail",
      "thumbnail",
      "thumbnailUrl",
      "thumbnail_url",
      "preview",
      "image",
      "imageBase64",
      "mediaUrl",
      "media_url",
      "fileUrl",
      "file_url",
      "imageUrl",
      "image_url",
      "base64",
      "file",
      "media",
      "url",
    ];

    for (const key of priority) {
      if (key in record) {
        const found = findFirstImageCandidate(record[key], depth + 1);
        if (found) return found;
      }
    }

    for (const nested of Object.values(record)) {
      const found = findFirstImageCandidate(nested, depth + 1);
      if (found) return found;
    }
  }

  return null;
}

function pickDownloadPayload(data: any): { dataUrl?: string | null; url?: string | null; text?: string | null } {
  const nested = data?.data || data?.result || data?.message || {};
  const mime = asText(
    data?.mimetype ||
      data?.mimeType ||
      data?.mediaType ||
      data?.type ||
      nested?.mimetype ||
      nested?.mimeType ||
      nested?.mediaType ||
      nested?.type,
  ) || "image/jpeg";
  const base64 = asText(
    data?.base64Data ||
      data?.base64_data ||
      data?.base64 ||
      data?.fileBase64 ||
      data?.mediaBase64 ||
      nested?.base64Data ||
      nested?.base64_data ||
      nested?.base64 ||
      nested?.fileBase64 ||
      nested?.mediaBase64,
  );
  const url = asText(
    data?.fileURL ||
      data?.fileUrl ||
      data?.file_url ||
      data?.mediaURL ||
      data?.mediaUrl ||
      data?.media_url ||
      data?.url ||
      nested?.fileURL ||
      nested?.fileUrl ||
      nested?.file_url ||
      nested?.mediaURL ||
      nested?.mediaUrl ||
      nested?.media_url ||
      nested?.url,
  );
  const text = asText(data?.text || data?.caption || data?.message || data?.transcription || nested?.text || nested?.caption || nested?.transcription);
  if (base64?.startsWith("data:image/")) return { dataUrl: base64, url, text };
  if (base64 && !/^https?:\/\//i.test(base64) && /^[A-Za-z0-9+/=\r\n]+$/.test(base64)) {
    return { dataUrl: `data:${IMAGE_MIME_RE.test(mime) ? mime : "image/jpeg"};base64,${base64}`, url, text };
  }
  return { dataUrl: findFirstImageCandidate(data), url, text };
}

async function downloadUazapiMedia(instance: any, messageId: string | null): Promise<{ dataUrl?: string | null; url?: string | null; text?: string | null; ok: boolean; error?: string | null }> {
  if (!messageId || !instance?.api_url) return { ok: false, error: "missing_message_id_or_instance" };
  const baseUrl = String(instance.api_url).replace(/\/$/, "");
  const token = instance.api_key_encrypted || instance.api_key;
  if (!token) return { ok: false, error: "missing_instance_token" };
  const instanceName = asText(instance.instance_name || instance.name || instance.instance);
  const ids = expandMessageIdCandidates(messageId);
  const endpoints = uniqueStrings([
    instanceName ? `${baseUrl}/message/download?instance=${encodeURIComponent(instanceName)}` : null,
    `${baseUrl}/message/download`,
  ]);

  let lastError = "download_not_attempted";

  for (const endpoint of endpoints) {
    for (const id of ids) {
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "token": token,
            "apikey": token,
          },
          body: JSON.stringify({ id, return_base64: true }),
        });
        const raw = await res.text();
        let data: any = null;
        try {
          data = raw ? JSON.parse(raw) : null;
        } catch {
          data = raw;
        }
        if (!res.ok) {
          lastError = `${res.status}:${String(raw || "").slice(0, 160)}`;
          continue;
        }

        const payload = pickDownloadPayload(data);
        if (payload.dataUrl || payload.url || payload.text) {
          return { ok: true, ...payload };
        }
        lastError = "empty_download_payload";
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
    }
  }

  return { ok: false, error: lastError };
}

function inferVehicleFromText(text: string): Pick<PedroV2MediaContext, "vehicle_query" | "vehicle_type" | "confidence"> {
  const normalized = normalizeText(text);
  const knownModels = [
    "renault duster", "duster", "oroch", "strada", "toro", "saveiro", "montana", "hilux",
    "ranger", "s10", "amarok", "onix", "hb20", "creta", "renegade", "compass", "tracker",
    "corolla", "civic", "cruze", "argo", "mobi", "kwid", "ecosport", "t cross", "tcross", "asx",
    "fastback", "pulse", "fiesta", "gol", "fox", "polo",
  ];
  const model = knownModels.find((item) => normalized.includes(item));
  if (!model) return { confidence: 0.1 };
  const type = /\b(moto|motocicleta|scooter|biz|cg|fan|titan|bros|xre|pcx)\b/.test(normalized)
    ? "moto"
    : /\b(duster|oroch|renegade|compass|creta|tracker|t cross|tcross|asx|suv|fastback|pulse)\b/.test(normalized)
      ? "suv"
      : /\b(strada|toro|saveiro|montana|hilux|ranger|s10|amarok)\b/.test(normalized)
        ? "pickup"
        : "carro";
  return { vehicle_query: model, vehicle_type: type, confidence: 0.76 };
}

async function inferMediaWithVision(imageDataUrl: string, caption?: string | null): Promise<Pick<PedroV2MediaContext, "vehicle_query" | "vehicle_type" | "summary" | "confidence"> | null> {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) return null;

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "Voce analisa imagens, thumbnails, prints e cards de anuncios automotivos para um vendedor. Responda apenas JSON valido com: vehicle_query, vehicle_type, summary, confidence. Leia textos visiveis no card, como modelo, versao, ano, cambio e preco. vehicle_query deve ser pesquisavel no estoque, por exemplo 'Fiat Argo Drive 1.0 2023'. Nunca invente se a imagem nao estiver legivel.",
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text:
                  `Leia todo texto visivel da imagem e identifique o veiculo anunciado. Se for um card de Facebook/Instagram/WhatsApp, o texto dentro da imagem vale mais que a URL. Priorize modelo, versao, ano, cambio, preco e tipo. Caption/mensagem do lead: ${caption || "(sem caption)"}`,
              },
              { type: "image_url", image_url: { url: imageDataUrl } },
            ],
          },
        ],
      }),
    });

    if (!res.ok) {
      console.warn("[PedroV2] media vision failed:", res.status, await res.text().catch(() => ""));
      return null;
    }

    const data = await res.json();
    const parsed = JSON.parse(data?.choices?.[0]?.message?.content || "{}");
    return {
      vehicle_query: asText(parsed.vehicle_query),
      vehicle_type: asText(parsed.vehicle_type),
      summary: asText(parsed.summary),
      confidence: Number(parsed.confidence || 0),
    };
  } catch (error) {
    console.warn("[PedroV2] media vision error:", error);
    return null;
  }
}

export async function resolvePedroMediaContext(payload: any, instance?: any): Promise<PedroV2MediaContext> {
  const caption = pickCaption(payload);
  const kind = pickKind(payload);
  const messageId = pickMessageId(payload);
  const embeddedImage = findFirstImageCandidate(payload);
  const effectiveKind = kind || (embeddedImage ? "image" : null);
  const keysFound = [...collectKeys(payload)].slice(0, 60);
  const downloaded = effectiveKind === "image" && messageId
    ? await downloadUazapiMedia(instance, messageId)
    : { ok: false, error: effectiveKind === "image" ? "missing_message_id" : "not_image_or_missing" };
  const imageData = downloaded.dataUrl || downloaded.url || embeddedImage || null;
  const usedDownloadedImage = Boolean(downloaded.ok && (downloaded.dataUrl || downloaded.url));
  const hasMediaPayload = Boolean(effectiveKind || imageData || downloaded.ok);

  if (!hasMediaPayload) {
    return {
      has_media_context: false,
      kind: null,
      source: null,
      message_id: messageId,
      media_data_url: null,
      media_url: null,
      text: null,
      vehicle_query: null,
      vehicle_type: null,
      summary: null,
      confidence: 0,
      diagnostics: {
        keys_found: keysFound,
        download_ok: downloaded.ok,
        download_error: downloaded.ok ? null : downloaded.error,
        has_embedded_image: false,
        used_downloaded_image: false,
        has_image_for_vision: false,
      },
    };
  }

  const visibleText = compact([caption, downloaded.text]);
  const textInference = inferVehicleFromText(visibleText);
  const visionInference = imageData ? await inferMediaWithVision(imageData, visibleText) : null;
  const best = visionInference && Number(visionInference.confidence || 0) >= Number(textInference.confidence || 0)
    ? visionInference
    : textInference;

  return {
    has_media_context: true,
    kind: effectiveKind,
    source: usedDownloadedImage ? "uazapi_download" : embeddedImage ? "webhook_embedded" : downloaded.ok ? "uazapi_download_no_image" : kind ? "media_unavailable" : null,
    message_id: messageId,
    media_data_url: imageData?.startsWith("data:image/") ? imageData : null,
    media_url: imageData && /^https?:\/\//i.test(imageData) ? imageData : null,
    text: visibleText || null,
    vehicle_query: best.vehicle_query || null,
    vehicle_type: best.vehicle_type || null,
    summary: visionInference?.summary || visibleText || null,
    confidence: Number(best.confidence || 0),
    diagnostics: {
      keys_found: keysFound,
      download_ok: downloaded.ok,
      download_error: downloaded.ok ? null : downloaded.error,
      has_embedded_image: Boolean(embeddedImage),
      used_downloaded_image: usedDownloadedImage,
      has_image_for_vision: Boolean(imageData),
    },
  };
}

export function sanitizePedroMediaContext(context: PedroV2MediaContext): Record<string, unknown> {
  return {
    has_media_context: context.has_media_context,
    kind: context.kind || null,
    source: context.source || null,
    message_id: context.message_id || null,
    has_media_data_url: Boolean(context.media_data_url),
    has_media_url: Boolean(context.media_url),
    text: context.text || null,
    vehicle_query: context.vehicle_query || null,
    vehicle_type: context.vehicle_type || null,
    summary: context.summary || null,
    confidence: context.confidence || 0,
    diagnostics: context.diagnostics || {},
  };
}

export function mediaContextToAdLikeContext(context: PedroV2MediaContext) {
  if (!context.has_media_context || !context.vehicle_query) return null;
  return {
    has_ad_context: true,
    source: context.source || "media",
    url: context.media_url || null,
    title: null,
    description: context.text || null,
    raw_text: context.text || context.summary || null,
    vehicle_query: context.vehicle_query || null,
    vehicle_type: context.vehicle_type || null,
    summary: context.summary || context.text || null,
    confidence: context.confidence || 0.8,
  };
}
