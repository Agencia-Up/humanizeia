import { PedroV2LeadMemory } from "./types.ts";

type PedroV2AdContext = {
  has_ad_context: boolean;
  source?: string | null;
  url?: string | null;
  title?: string | null;
  description?: string | null;
  raw_text?: string | null;
  vehicle_query?: string | null;
  vehicle_type?: string | null;
  summary?: string | null;
  confidence?: number;
};

const URL_RE = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/gi;
const METADATA_TIMEOUT_MS = 2500;

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

function firstUrl(text?: string | null): string | null {
  const match = String(text || "").match(URL_RE);
  return match?.[0] || null;
}

function pickIncomingMessage(payload: any): any {
  if (Array.isArray(payload?.messages) && payload.messages.length > 0) return payload.messages[0];
  if (Array.isArray(payload?.data) && payload.data.length > 0) return payload.data[0];
  return payload?.message || payload?.data || payload;
}

function hostname(url?: string | null): string | null {
  try {
    return url ? new URL(url).hostname.replace(/^www\./, "") : null;
  } catch {
    return null;
  }
}

function compact(values: Array<string | null | undefined>) {
  return values
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .filter((value, index, arr) => arr.indexOf(value) === index)
    .join(" | ");
}

function pickByPaths(source: any, paths: string[][]): string | null {
  for (const path of paths) {
    let current = source;
    for (const key of path) current = current?.[key];
    const text = asText(current);
    if (text) return text;
  }
  return null;
}

function findFirstBase64Image(value: unknown, depth = 0): string | null {
  if (!value || depth > 8) return null;

  if (Array.isArray(value) && value.length > 20 && value.every((item) => Number.isInteger(item) && Number(item) >= 0 && Number(item) <= 255)) {
    let binary = "";
    const bytes = value as number[];
    for (let i = 0; i < bytes.length; i += 8192) {
      binary += String.fromCharCode(...bytes.slice(i, i + 8192));
    }
    return `data:image/jpeg;base64,${btoa(binary)}`;
  }

  if (typeof value === "string") {
    const text = value.trim();
    if (text.startsWith("data:image/")) return text;
    if (/^https?:\/\//i.test(text) && (
      /\.(png|jpe?g|webp)(\?.*)?$/i.test(text) ||
      /(?:fbcdn|scontent|image|thumbnail|media)/i.test(text)
    )) return text;
    if (text.length > 500 && /^[A-Za-z0-9+/=\r\n]+$/.test(text)) {
      return `data:image/jpeg;base64,${text}`;
    }
    return null;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findFirstBase64Image(item, depth + 1);
      if (found) return found;
    }
    return null;
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.data) && String(record.type || "").toLowerCase() === "buffer") {
      const found = findFirstBase64Image(record.data, depth + 1);
      if (found) return found;
    }

    const priority = [
      "jpegThumbnail",
      "thumbnail",
      "thumbnailDirectPath",
      "thumbnailUrl",
      "thumbnail_url",
      "preview",
      "image",
      "imageBase64",
      "mediaUrl",
      "media_url",
      "base64",
    ];

    for (const key of priority) {
      if (key in record) {
        const found = findFirstBase64Image(record[key], depth + 1);
        if (found) return found;
      }
    }

    for (const nested of Object.values(record)) {
      const found = findFirstBase64Image(nested, depth + 1);
      if (found) return found;
    }
  }

  return null;
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, " ");
}

function pickMeta(html: string, names: string[]): string | null {
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const patterns = [
      new RegExp(`<meta[^>]+property=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i"),
      new RegExp(`<meta[^>]+name=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i"),
      new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${escaped}["'][^>]*>`, "i"),
      new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${escaped}["'][^>]*>`, "i"),
    ];
    for (const pattern of patterns) {
      const match = html.match(pattern);
      const text = asText(match?.[1] ? decodeHtmlEntities(match[1]) : null);
      if (text) return text;
    }
  }
  return null;
}

async function fetchAdPageMetadata(url?: string | null): Promise<{
  title?: string | null;
  description?: string | null;
  image?: string | null;
} | null> {
  if (!url || !/^https?:\/\//i.test(url)) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), METADATA_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; LogosIA-PedroV2/1.0)",
        "Accept": "text/html,application/xhtml+xml",
      },
    });
    if (!res.ok) return null;
    const html = (await res.text()).slice(0, 250_000);
    const title = pickMeta(html, ["og:title", "twitter:title"]) || asText(html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]);
    const description = pickMeta(html, ["og:description", "twitter:description", "description"]);
    const image = pickMeta(html, ["og:image", "og:image:url", "twitter:image"]);
    return { title, description, image };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function extractTextualAdContext(payload: any, messageText: string): PedroV2AdContext {
  const rootMessage = pickIncomingMessage(payload);
  const message = rootMessage?.message || rootMessage;
  const extended = message?.extendedTextMessage || rootMessage?.extendedTextMessage || payload?.data?.message?.extendedTextMessage || {};
  const contextInfo = extended?.contextInfo || message?.contextInfo || rootMessage?.contextInfo || payload?.contextInfo || {};
  const adReply = contextInfo?.externalAdReply || rootMessage?.externalAdReply || payload?.externalAdReply || payload?.data?.externalAdReply || {};
  const content = typeof rootMessage?.content === "object"
    ? rootMessage.content
    : typeof payload?.content === "object"
      ? payload.content
      : {};

  const title = pickByPaths({ payload, rootMessage, message, extended, contextInfo, adReply, content }, [
    ["adReply", "title"],
    ["extended", "title"],
    ["content", "title"],
    ["content", "name"],
    ["rootMessage", "title"],
    ["rootMessage", "name"],
    ["payload", "title"],
    ["payload", "data", "title"],
    ["message", "title"],
  ]);
  const description = pickByPaths({ payload, rootMessage, message, extended, contextInfo, adReply, content }, [
    ["adReply", "body"],
    ["adReply", "description"],
    ["extended", "description"],
    ["content", "description"],
    ["content", "body"],
    ["content", "caption"],
    ["rootMessage", "body"],
    ["rootMessage", "text"],
    ["rootMessage", "caption"],
    ["payload", "description"],
    ["payload", "body"],
    ["payload", "data", "description"],
    ["message", "description"],
  ]);
  const sourceUrl = pickByPaths({ payload, rootMessage, message, extended, contextInfo, adReply, content }, [
    ["adReply", "sourceUrl"],
    ["adReply", "source_url"],
    ["adReply", "mediaUrl"],
    ["adReply", "media_url"],
    ["extended", "canonicalUrl"],
    ["extended", "matchedText"],
    ["content", "url"],
    ["content", "sourceUrl"],
    ["rootMessage", "url"],
    ["payload", "url"],
    ["payload", "data", "url"],
  ]) || firstUrl(messageText);

  const source = hostname(sourceUrl) || (normalizeText(compact([title, description, messageText])).includes("facebook") ? "facebook" : null);
  const rawText = compact([title, description, messageText]);

  return {
    has_ad_context: Boolean(sourceUrl || title || description || /facebook|instagram|story_fbid|post_id|fbclid/i.test(messageText)),
    source,
    url: sourceUrl,
    title,
    description,
    raw_text: rawText || messageText || null,
  };
}

function inferVehicleFromText(text: string): Pick<PedroV2AdContext, "vehicle_query" | "vehicle_type" | "confidence"> {
  const normalized = normalizeText(text);
  const knownModels = [
    "renault duster", "duster", "oroch", "strada", "toro", "saveiro", "montana", "hilux",
    "ranger", "s10", "amarok", "onix", "hb20", "creta", "renegade", "compass", "tracker",
    "corolla", "civic", "cruze", "argo", "mobi", "kwid", "ecosport", "t cross", "tcross", "asx",
  ];
  const model = knownModels.find((item) => normalized.includes(item));
  if (!model) return { confidence: 0.15 };

  const type = /\b(moto|motocicleta|scooter|biz|cg|fan|titan|bros|xre|pcx)\b/.test(normalized)
    ? "moto"
    : /\b(duster|oroch|renegade|compass|creta|tracker|t cross|tcross|asx|suv)\b/.test(normalized)
      ? "suv"
      : /\b(strada|toro|saveiro|montana|hilux|ranger|s10|amarok)\b/.test(normalized)
        ? "pickup"
        : "carro";

  return { vehicle_query: model, vehicle_type: type, confidence: 0.78 };
}

async function inferVehicleFromImage(imageDataUrl: string): Promise<Pick<PedroV2AdContext, "vehicle_query" | "vehicle_type" | "summary" | "confidence"> | null> {
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
              "Extraia contexto de anuncio automotivo em JSON. Responda apenas com vehicle_query, vehicle_type, summary e confidence. Se nao houver veiculo legivel, use null e confidence baixo.",
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text:
                  "Leia o texto visivel e identifique o veiculo anunciado. vehicle_query deve ser algo pesquisavel no estoque, ex: Renault Duster 1.6 2020 automatico.",
              },
              { type: "image_url", image_url: { url: imageDataUrl } },
            ],
          },
        ],
      }),
    });

    if (!res.ok) {
      console.warn("[PedroV2] ad image analysis failed:", res.status, await res.text().catch(() => ""));
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
    console.warn("[PedroV2] ad image analysis error:", error);
    return null;
  }
}

export async function resolvePedroAdContext(payload: any, messageText: string): Promise<PedroV2AdContext> {
  const textual = extractTextualAdContext(payload, messageText);
  const pageMetadata = textual.has_ad_context && !inferVehicleFromText(textual.raw_text || messageText).vehicle_query
    ? await fetchAdPageMetadata(textual.url)
    : null;
  const metadataText = compact([
    pageMetadata?.title,
    pageMetadata?.description,
    textual.raw_text,
    messageText,
  ]);
  const textInference = inferVehicleFromText(metadataText || textual.raw_text || messageText);
  const imageDataUrl = findFirstBase64Image(payload) || findFirstBase64Image(pageMetadata?.image);
  const imageInference = imageDataUrl ? await inferVehicleFromImage(imageDataUrl) : null;
  const best = imageInference && Number(imageInference.confidence || 0) > Number(textInference.confidence || 0)
    ? imageInference
    : textInference;

  return {
    ...textual,
    has_ad_context: textual.has_ad_context || Boolean(best.vehicle_query),
    title: pageMetadata?.title || textual.title || null,
    description: pageMetadata?.description || textual.description || null,
    vehicle_query: best.vehicle_query || null,
    vehicle_type: best.vehicle_type || null,
    summary: best.summary || metadataText || textual.raw_text || null,
    confidence: Number(best.confidence || 0),
  };
}

export function adContextToMemory(adContext: PedroV2AdContext): PedroV2LeadMemory {
  if (!adContext.has_ad_context) return {};
  return {
    interesse: {
      modelo_desejado: adContext.vehicle_query || null,
      tipo_veiculo: adContext.vehicle_type || null,
    },
    referencia: {
      texto_referencia: adContext.summary || adContext.raw_text || null,
      origem_anuncio: adContext.source || "anuncio",
      veiculo_citado: adContext.vehicle_query || null,
      confidence: adContext.confidence || 0.5,
    },
  };
}

export function buildMessageWithAdContext(messageText: string, adContext: PedroV2AdContext): string {
  if (!adContext.has_ad_context) return messageText;
  const context = [
    adContext.vehicle_query ? `Veiculo do anuncio: ${adContext.vehicle_query}` : null,
    adContext.summary ? `Contexto do anuncio: ${adContext.summary}` : null,
    adContext.url ? `Origem/link do anuncio: ${adContext.url}` : null,
  ].filter(Boolean).join("\n");
  return [messageText || "Lead veio de um anuncio/link.", context].filter(Boolean).join("\n\n");
}
