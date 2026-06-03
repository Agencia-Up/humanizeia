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
  diagnostics?: Record<string, unknown>;
};

const URL_RE = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/gi;
const METADATA_TIMEOUT_MS = 2500;
const IMAGE_TIMEOUT_MS = 4500;
const AD_LINK_RE = /facebook|instagram|story_fbid|post_id|fbclid|igsh|wa\.me|fb\.watch|fb\.me/i;
const AD_TEXT_MARKER_RE =
  /an[uú]ncio\s+do|anuncio\s+do|mostrar\s+detalhes|mensagem\s+de\s+sauda[cç][aã]o\s+autom[aá]tica|fb\.me/i;

function asText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function tryDecodeBase64(value?: string | null): string | null {
  const text = String(value || "").trim();
  if (!text || text.length < 8 || !/^[A-Za-z0-9+/=\r\n_-]+$/.test(text)) return null;
  try {
    const base64 = text.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = atob(base64);
    if (/^[\x00-\x7F\s\u00C0-\u00FF]*$/.test(decoded)) {
      const clean = decoded.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, " ").trim();
      return clean.length >= 3 ? clean : null;
    }
  } catch {
    // noop
  }
  return null;
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

function isLargeEncodedBlob(value: string) {
  const text = value.trim();
  return text.length > 500 && /^[A-Za-z0-9+/=\r\n_-]+$/.test(text) && !/https?:\/\//i.test(text);
}

function collectPayloadStrings(value: unknown, out: string[] = [], depth = 0, seen = new WeakSet<object>()): string[] {
  if (!value || depth > 8 || out.length > 160) return out;

  if (typeof value === "string") {
    const text = value.trim();
    if (!text || isLargeEncodedBlob(text)) return out;
    if (
      text.length >= 3 &&
      (AD_LINK_RE.test(text) ||
        AD_TEXT_MARKER_RE.test(text) ||
        /r\$\s*[\d.]+/i.test(text) ||
        /\b(20\d{2}|201\d|202\d|automatico|autom[aá]tico|flex|mec|aut|ltz|lt2|plus|drive|longitude)\b/i.test(text))
    ) {
      out.push(decodeHtmlEntities(text));
    }
    return out;
  }

  if (Array.isArray(value)) {
    for (const item of value) collectPayloadStrings(item, out, depth + 1, seen);
    return out;
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (seen.has(record)) return out;
    seen.add(record);

    const priority = [
      "title",
      "body",
      "description",
      "caption",
      "text",
      "matchedText",
      "canonicalUrl",
      "sourceUrl",
      "url",
      "preview",
      "externalAdReply",
      "contextInfo",
      "extendedTextMessage",
    ];
    for (const key of priority) {
      if (key in record) collectPayloadStrings(record[key], out, depth + 1, seen);
    }
    for (const [key, nested] of Object.entries(record)) {
      if (!priority.includes(key)) collectPayloadStrings(nested, out, depth + 1, seen);
    }
  }

  return out;
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

function isImageLikeUrl(text?: string | null) {
  const value = String(text || "").trim();
  if (!/^https?:\/\//i.test(value)) return false;
  // NUNCA tratar a foto de PERFIL do contato (pps.whatsapp.net) nem avatares como
  // "imagem do anuncio": elas terminam em .jpg e eram pescadas no lugar do anuncio,
  // fazendo a visao nao achar o carro (image_confidence=0).
  if (/pps\.whatsapp\.net|profile[-_]?pic|profilepic|\/avatar|\/pp\//i.test(value)) return false;
  return /\.(png|jpe?g|webp)(\?.*)?$/i.test(value) ||
    /(?:fbcdn|scontent|lookaside|\/ads\/image|cdninstagram|image|thumbnail|picture|media|blob\.core)/i.test(value);
}

function findFirstImageUrlCandidate(value: unknown, depth = 0): string | null {
  if (!value || depth > 8) return null;
  if (typeof value === "string") {
    const text = value.trim();
    return isImageLikeUrl(text) ? text : null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findFirstImageUrlCandidate(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const priority = [
      "jpegThumbnail",
      "thumbnail",
      "thumbnailUrl",
      "thumbnail_url",
      "preview",
      "image",
      "imageUrl",
      "image_url",
      "mediaUrl",
      "media_url",
      "largeThumbnail",
      "smallThumbnail",
    ];
    for (const key of priority) {
      if (key in record) {
        const found = findFirstImageUrlCandidate(record[key], depth + 1);
        if (found) return found;
      }
    }
    for (const nested of Object.values(record)) {
      const found = findFirstImageUrlCandidate(nested, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

function bytesToDataUrl(bytes: Uint8Array, contentType = "image/jpeg") {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.slice(i, i + 8192));
  }
  return `data:${contentType || "image/jpeg"};base64,${btoa(binary)}`;
}

async function fetchImageAsDataUrl(url?: string | null): Promise<{
  dataUrl?: string | null;
  ok: boolean;
  error?: string | null;
  sourceUrl?: string | null;
  contentType?: string | null;
}> {
  if (!url || !/^https?:\/\//i.test(url)) return { ok: false, error: "missing_url" };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), IMAGE_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; LogosIA-PedroV2/1.0)",
        "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
      },
    });
    const contentType = res.headers.get("content-type") || "image/jpeg";
    if (!res.ok) return { ok: false, error: `status_${res.status}`, sourceUrl: url, contentType };
    if (!contentType.toLowerCase().startsWith("image/")) {
      return { ok: false, error: `not_image:${contentType}`, sourceUrl: url, contentType };
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length === 0) return { ok: false, error: "empty_image", sourceUrl: url, contentType };
    if (bytes.length > 8_000_000) return { ok: false, error: "image_too_large", sourceUrl: url, contentType };
    return { ok: true, dataUrl: bytesToDataUrl(bytes, contentType), sourceUrl: url, contentType };
  } catch (error) {
    return { ok: false, error: String(error instanceof Error ? error.message : error), sourceUrl: url };
  } finally {
    clearTimeout(timeout);
  }
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

const FB_CRAWLERS = [
  "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
  "Facebot",
  "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
];

function isFacebookShortLink(url?: string | null): boolean {
  if (!url) return false;
  return /^https?:\/\/(fb\.me|fb\.watch|m\.facebook\.com\/|www\.facebook\.com\/)/i.test(url);
}

/** Tenta extrair contexto de veículo direto da URL/path do Facebook, sem precisar fazer scraping.
 *  Ex: "Fiat Argo 2024" pode estar no slug da URL. */
function inferFromFbUrl(url: string): { title: string | null; description: string | null } {
  try {
    const urlObj = new URL(url);
    const pathParts = urlObj.pathname.split("/").filter(Boolean);
    // Ex: /marketplace/item/fiat-argo-drive-2024/
    const slug = pathParts.join(" ").replace(/[-_]/g, " ").replace(/\d{10,}/g, "").trim();
    if (slug && slug.length > 5) {
      return { title: slug, description: null };
    }
  } catch {
    // noop
  }
  return { title: null, description: null };
}

async function fetchAdPageMetadata(url?: string | null): Promise<{
  title?: string | null;
  description?: string | null;
  image?: string | null;
} | null> {
  if (!url || !/^https?:\/\//i.test(url)) return null;

  const isFb = isFacebookShortLink(url);
  const userAgents = isFb ? FB_CRAWLERS : [FB_CRAWLERS[3]];

  for (const ua of userAgents) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), METADATA_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        redirect: "follow",
        headers: {
          "User-Agent": ua,
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
        },
      });
      if (!res.ok) {
        clearTimeout(timeout);
        continue;
      }
      // Try to extract from the final redirected URL if Facebook
      const finalUrl = res.url || url;
      const urlHint = isFb ? inferFromFbUrl(finalUrl) : { title: null, description: null };

      const html = (await res.text()).slice(0, 250_000);
      const title = pickMeta(html, ["og:title", "twitter:title"]) ||
        asText(html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]) ||
        urlHint.title;
      const description = pickMeta(html, ["og:description", "twitter:description", "description"]) ||
        urlHint.description;
      const image = pickMeta(html, ["og:image", "og:image:url", "twitter:image"]);

      clearTimeout(timeout);
      // If we got something useful, return it
      if (title || description) {
        return { title, description, image };
      }
      // Otherwise try next UA
    } catch {
      clearTimeout(timeout);
      // Continue to next UA
    }
  }

  // All UAs failed — try URL-only inference for Facebook links
  if (isFb) {
    const urlHint = inferFromFbUrl(url);
    if (urlHint.title) return urlHint;
  }
  return null;
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
  const payloadText = compact(collectPayloadStrings(payload).slice(0, 80));
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

  const conversionFields: string[] = [];
  const conversionPaths = [
    ["contextInfo", "conversionData"],
    ["contextInfo", "ctwaPayload"],
    ["contextInfo", "entryPointConversionSource"],
    ["contextInfo", "sourceId"],
    ["contextInfo", "sourceType"],
    ["extended", "contextInfo", "conversionData"],
    ["extended", "contextInfo", "ctwaPayload"],
    ["extended", "contextInfo", "entryPointConversionSource"],
    ["extended", "contextInfo", "sourceId"],
    ["extended", "contextInfo", "sourceType"],
  ];
  for (const path of conversionPaths) {
    const rawVal = pickByPaths({ payload, rootMessage, message, extended, contextInfo, adReply }, [path]);
    if (rawVal) {
      conversionFields.push(rawVal);
      const decoded = tryDecodeBase64(rawVal);
      if (decoded) {
        conversionFields.push(decoded);
      }
    }
  }

  const hasExplicitAdPayload = Boolean(
    contextInfo?.externalAdReply ||
    rootMessage?.externalAdReply ||
    payload?.externalAdReply ||
    payload?.data?.externalAdReply ||
    adReply?.title ||
    adReply?.body ||
    adReply?.sourceUrl ||
    conversionFields.length > 0
  );
  const hasAdLink = Boolean(sourceUrl && AD_LINK_RE.test(sourceUrl));
  const hasAdTextMarker = AD_LINK_RE.test(messageText) ||
    AD_LINK_RE.test(payloadText) ||
    AD_TEXT_MARKER_RE.test(messageText) ||
    AD_TEXT_MARKER_RE.test(payloadText) ||
    AD_TEXT_MARKER_RE.test(compact([title, description, ...conversionFields]));
  const hasAdContext = hasExplicitAdPayload || hasAdLink || hasAdTextMarker;
  const combinedText = compact([title, description, payloadText, ...conversionFields, messageText]);
  const normalizedCombined = normalizeText(combinedText);
  const source = hasAdContext
    ? hostname(sourceUrl) || (normalizeText(compact([title, description, messageText])).includes("facebook") ? "facebook" : null)
    : null;
  const rawText = combinedText;

  return {
    has_ad_context: hasAdContext,
    source: source || (normalizedCombined.includes("instagram") ? "instagram" : normalizedCombined.includes("facebook") || normalizedCombined.includes("fb.me") ? "facebook" : null),
    url: sourceUrl,
    title: hasAdContext ? title : null,
    description: hasAdContext ? description : null,
    raw_text: hasAdContext ? rawText || messageText || null : null,
    diagnostics: hasAdContext
      ? {
        payload_text_detected: Boolean(payloadText),
        payload_text_sample: payloadText.slice(0, 500) || null,
        conversion_fields_decoded: conversionFields.filter((item) => item.length < 500),
      }
      : undefined,
  };
}

function inferVehicleFromText(text: string): Pick<PedroV2AdContext, "vehicle_query" | "vehicle_type" | "confidence"> {
  const normalized = normalizeText(text);
  const knownModels = [
    "renault duster", "duster", "oroch", "strada", "toro", "saveiro", "montana", "hilux",
    "ranger", "s10", "amarok", "onix", "hb20", "creta", "renegade", "compass", "tracker",
    "corolla", "civic", "cruze", "fiat argo", "argo drive", "argo", "mobi", "kwid", "ecosport",
    "t cross", "tcross", "asx",
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

function stripAdBoilerplate(value: string): string {
  return decodeHtmlEntities(value)
    .replace(URL_RE, " ")
    .replace(/an[uú]ncio\s+do\s+(facebook|instagram)/ig, " ")
    .replace(/mostrar\s+detalhes/ig, " ")
    .replace(/mensagem\s+de\s+sauda[cç][aã]o\s+autom[aá]tica/ig, " ")
    .replace(/ol[aá]!\s*/ig, " ")
    .replace(/fale\s+conosco.*$/ig, " ")
    .replace(/para\s+mais\s+detalhes.*$/ig, " ")
    .replace(/tenho\s+interesse.*$/ig, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function prependBrandIfMissing(candidate: string): string {
  const normalized = normalizeText(candidate);
  if (/^(chevrolet|fiat|jeep|renault|hyundai|mitsubishi|volkswagen|vw|ford|toyota|honda|citroen|peugeot)\b/i.test(candidate)) {
    return candidate;
  }
  if (normalized.includes("onix") || normalized.includes("tracker") || normalized.includes("cruze")) return `Chevrolet ${candidate}`;
  if (normalized.includes("argo") || normalized.includes("mobi") || normalized.includes("strada") || normalized.includes("toro") || normalized.includes("pulse")) return `Fiat ${candidate}`;
  if (normalized.includes("compass") || normalized.includes("renegade")) return `Jeep ${candidate}`;
  if (normalized.includes("duster") || normalized.includes("oroch") || normalized.includes("kwid")) return `Renault ${candidate}`;
  if (normalized.includes("hb20") || normalized.includes("creta")) return `Hyundai ${candidate}`;
  if (normalized.includes("asx")) return `Mitsubishi ${candidate}`;
  return candidate;
}

function cleanVehicleCandidate(value?: string | null): string | null {
  let candidate = stripAdBoilerplate(String(value || ""));
  candidate = candidate
    .replace(/\b(encontrou|quer\s+saber\s+mais\s+sobre|sobre|o|a|um|uma)\b/ig, " ")
    .replace(/\s+por\s+r\$\s*[\d.,]+.*$/i, " ")
    .replace(/\?\s*$/g, " ")
    .replace(/^[\s:,-]+|[\s:,-]+$/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!candidate || candidate.length < 3) return null;
  return prependBrandIfMissing(candidate);
}

function inferVehicleFromAdCopy(text: string): Pick<PedroV2AdContext, "vehicle_query" | "vehicle_type" | "summary" | "confidence"> {
  const raw = decodeHtmlEntities(String(text || "")).replace(/\s+/g, " ").trim();
  if (!raw || (!AD_LINK_RE.test(raw) && !AD_TEXT_MARKER_RE.test(raw) && !inferVehicleFromText(raw).vehicle_query)) {
    return { confidence: 0.05 };
  }

  const patterns = [
    /encontrou\s+(?:o|a|um|uma)?\s*([^?|\n]+?)\s+por\s+r\$\s*[\d.,]+/i,
    /quer\s+saber\s+mais\s+sobre\s+(?:o|a|um|uma)?\s*([^?|\n]+?)\?/i,
    /mais\s+sobre\s+(?:o|a|um|uma)?\s*([^?|\n]+?)\s+dispon[ií]vel\s+por\s+r\$\s*[\d.,]+/i,
    /\b(?:ve[ií]culo|carro)\s+(?:do\s+an[uú]ncio|anunciado)\s*[:\-]\s*([^|?\n]+)/i,
  ];

  for (const pattern of patterns) {
    const match = raw.match(pattern);
    const candidate = cleanVehicleCandidate(match?.[1]);
    if (candidate) {
      const base = inferVehicleFromText(candidate);
      return {
        vehicle_query: candidate,
        vehicle_type: base.vehicle_type || "carro",
        summary: `Anuncio mencionou ${candidate}.`,
        confidence: 0.94,
      };
    }
  }

  const pieces = raw
    .split(/\s+\|\s+|\n|(?:An[uú]ncio do|Anuncio do|Mensagem de sauda[cç][aã]o autom[aá]tica)/i)
    .map((item) => item.trim())
    .filter(Boolean);

  for (const piece of pieces) {
    const hasVehicle = inferVehicleFromText(piece).vehicle_query;
    const hasSpecifics = /\b(20\d{2}|201\d|202\d|ltz|lt2|plus|drive|longitude|authentique|automatico|autom[aá]tico|mec|flex|r\$)\b/i.test(piece);
    const candidate = hasVehicle && hasSpecifics ? cleanVehicleCandidate(piece) : null;
    if (candidate) {
      const base = inferVehicleFromText(candidate);
      return {
        vehicle_query: candidate,
        vehicle_type: base.vehicle_type || "carro",
        summary: `Anuncio mencionou ${candidate}.`,
        confidence: 0.86,
      };
    }
  }

  const fallback = inferVehicleFromText(raw);
  return {
    ...fallback,
    summary: fallback.vehicle_query ? `Anuncio mencionou ${fallback.vehicle_query}.` : null,
    confidence: fallback.vehicle_query ? Math.max(0.62, fallback.confidence || 0) : 0.15,
  };
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
        // gpt-4o-mini: baseline que JA identificava o veiculo da imagem do anuncio.
        // (gpt-4o foi testado mas retornou nulo no fluxo — mantido mini, que funciona.)
        // O ano antes era ancorado por um EXEMPLO no prompt ("...2023"); o prompt
        // abaixo foi de-ancorado para ler o ANO impresso na arte.
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
                  "Leia o texto visivel e identifique o veiculo anunciado. vehicle_query deve ser algo pesquisavel no estoque, incluindo marca, modelo, versao e ANO. IMPORTANTE: use SEMPRE o ANO impresso na arte do anuncio (selo/etiqueta) — NUNCA o ano dos exemplos abaixo. Formato (NAO copie os anos; use o ano que estiver na imagem): 'Renault Duster Authentique 1.6 AAAA automatico'; 'Fiat Argo Drive 1.0 AAAA'. Inclua a cor do carro e o preco no summary quando aparecerem.",
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

async function inferVehicleFromAdText(text: string): Promise<Pick<PedroV2AdContext, "vehicle_query" | "vehicle_type" | "summary" | "confidence"> | null> {
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
              "Extraia o veiculo de um anuncio/link automotivo a partir do texto ou metadados fornecidos em JSON. Responda apenas com: vehicle_query (Marca + Modelo + Versao + Ano + Cambio quando disponiveis, ex: 'Chevrolet Onix LT 1.0 2023 manual'), vehicle_type ('carro', 'moto', 'suv', 'pickup'), summary (breve descricao do anuncio) e confidence (de 0.0 a 1.0). Se nao houver veiculo citado ou for muito generico, use null em vehicle_query e confidence baixo.",
          },
          {
            role: "user",
            content: text,
          },
        ],
      }),
    });

    if (!res.ok) {
      console.warn("[PedroV2] ad text analysis failed:", res.status, await res.text().catch(() => ""));
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
    console.warn("[PedroV2] ad text analysis error:", error);
    return null;
  }
}

export async function resolvePedroAdContext(payload: any, messageText: string): Promise<PedroV2AdContext> {
  const textual = extractTextualAdContext(payload, messageText);
  if (!textual.has_ad_context) {
    return {
      has_ad_context: false,
      source: null,
      url: textual.url || null,
      title: null,
      description: null,
      raw_text: null,
      vehicle_query: null,
      vehicle_type: null,
      summary: null,
      confidence: 0,
    };
  }

  const pageMetadata = textual.has_ad_context && !inferVehicleFromText(textual.raw_text || messageText).vehicle_query
    ? await fetchAdPageMetadata(textual.url)
    : null;
  const metadataText = compact([
    pageMetadata?.title,
    pageMetadata?.description,
    textual.raw_text,
    messageText,
  ]);
  const explicitAdInference = inferVehicleFromAdCopy(metadataText || textual.raw_text || messageText);
  let textInference = explicitAdInference.vehicle_query
    ? explicitAdInference
    : inferVehicleFromText(metadataText || textual.raw_text || messageText);

  if (textual.has_ad_context && (!textInference.vehicle_query || Number(textInference.confidence || 0) < 0.6)) {
    const adTextInference = await inferVehicleFromAdText(metadataText || textual.raw_text || messageText);
    if (adTextInference && adTextInference.vehicle_query && Number(adTextInference.confidence || 0) >= 0.6) {
      textInference = adTextInference;
    }
  }

  const embeddedImage = findFirstBase64Image(payload) || findFirstBase64Image(pageMetadata?.image);
  // Imagem do ANUNCIO em si: anuncios de Instagram/Facebook trazem a foto como uma
  // URL do FB Ads CDN (https://www.facebook.com/ads/image/?d=...) ou scontent/fbcdn/
  // cdninstagram dentro do texto/conversion fields. Ela tem PRIORIDADE sobre qualquer
  // imagem solta do payload (que costuma ser a FOTO DE PERFIL do contato em
  // pps.whatsapp.net — nao o carro do anuncio).
  const adImageBlob = compact([
    textual.raw_text,
    ...(((textual.diagnostics as any)?.conversion_fields_decoded as string[]) || []),
    textual.url,
  ]);
  const adImageMatch = adImageBlob.match(/https?:\/\/[^\s|"']*\/ads\/image\/?\?[^\s|"']+/i)
    || adImageBlob.match(/https?:\/\/(?:[a-z0-9.-]*\.)?(?:scontent|fbcdn|cdninstagram)[^\s|"']+/i);
  const adImageUrl = adImageMatch ? adImageMatch[0] : null;
  const imageUrlCandidate = !embeddedImage
    ? (adImageUrl || findFirstImageUrlCandidate(payload) || (isImageLikeUrl(pageMetadata?.image) ? pageMetadata?.image || null : null))
    : null;
  const fetchedImage = embeddedImage && /^https?:\/\//i.test(embeddedImage)
    ? await fetchImageAsDataUrl(embeddedImage)
    : imageUrlCandidate
      ? await fetchImageAsDataUrl(imageUrlCandidate)
      : { ok: false, error: "no_image_candidate" };
  const imageDataUrl = embeddedImage && !/^https?:\/\//i.test(embeddedImage)
    ? embeddedImage
    : fetchedImage.dataUrl || embeddedImage || imageUrlCandidate || null;
  const imageInference = imageDataUrl ? await inferVehicleFromImage(imageDataUrl) : null;
  const explicitTextIsStrong = Boolean(explicitAdInference.vehicle_query && Number(explicitAdInference.confidence || 0) >= 0.75);
  // O TEXTO do anuncio (copy do anunciante, ex.: "Compass Longitude T270 2023") e
  // AUTORITATIVO para o ANO/spec — a VISAO (OCR da imagem) erra digito (leu "2022" no
  // lugar de "2023"), o que fazia o agente dizer "nao temos o 2022" + oferecer um
  // similar errado e DEPOIS dizer "temos o 2023" (contradicao entre turnos). Por isso:
  // se a inferencia de TEXTO tem um veiculo COM ANO e confianca decente, ela vence a
  // visao. A visao so manda quando NAO ha veiculo legivel no texto (anuncio so-imagem).
  const textCandidate = explicitAdInference.vehicle_query ? explicitAdInference
    : (textInference.vehicle_query ? textInference : null);
  const textHasYear = Boolean(textCandidate?.vehicle_query
    && /\b(19|20)\d{2}\b/.test(String(textCandidate.vehicle_query))
    && Number(textCandidate.confidence || 0) >= 0.55);
  const best = (explicitTextIsStrong || textHasYear) && textCandidate
    ? textCandidate
    : imageInference && Number(imageInference.confidence || 0) >= Math.max(0.45, Number(textInference.confidence || 0))
      ? imageInference
      : textInference;

  return {
    ...textual,
    has_ad_context: true,
    title: pageMetadata?.title || textual.title || null,
    description: pageMetadata?.description || textual.description || null,
    vehicle_query: best.vehicle_query || null,
    vehicle_type: best.vehicle_type || null,
    summary: best.summary || metadataText || textual.raw_text || null,
    confidence: Number(best.confidence || 0),
    diagnostics: {
      ...(textual.diagnostics || {}),
      explicit_ad_confidence: Number(explicitAdInference.confidence || 0),
      text_confidence: Number(textInference.confidence || 0),
      image_confidence: Number(imageInference?.confidence || 0),
      image_candidate_host: hostname(embeddedImage || imageUrlCandidate || pageMetadata?.image || null),
      image_fetch_ok: fetchedImage.ok,
      image_fetch_error: fetchedImage.error || null,
      used_explicit_ad_text: best === explicitAdInference && Boolean(explicitAdInference.vehicle_query),
      used_image_inference: best === imageInference,
    },
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
    !adContext.vehicle_query && adContext.source
      ? `Lead veio de anuncio do ${adContext.source} mas nao foi possivel identificar o veiculo automaticamente. Pergunte de forma natural qual veiculo o lead estava vendo no anuncio.`
      : null,
    adContext.summary ? `Contexto do anuncio: ${adContext.summary}` : null,
    adContext.url ? `Origem/link do anuncio: ${adContext.url}` : null,
  ].filter(Boolean).join("\n");
  return [messageText || "Lead veio de um anuncio/link.", context].filter(Boolean).join("\n\n");
}
