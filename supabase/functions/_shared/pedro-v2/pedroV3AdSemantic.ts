import type { PedroV3AdReferral } from "./pedroV3Bridge.ts";

export type PedroV3AdSemanticResult = {
  readonly vehicle_query: string | null;
  readonly vehicle_type: string | null;
  readonly summary: string | null;
  readonly confidence: number;
  readonly diagnostics: {
    readonly used_image_inference: boolean;
    readonly model: string;
  };
};

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

function asText(value: unknown, max: number): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
}

function isTrustedMetaCreativeUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase();
    return host === "facebook.com"
      || host.endsWith(".facebook.com")
      || host === "fbcdn.net"
      || host.endsWith(".fbcdn.net")
      || host === "cdninstagram.com"
      || host.endsWith(".cdninstagram.com")
      || host === "fbsbx.com"
      || host.endsWith(".fbsbx.com");
  } catch {
    return false;
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function sniffImageMime(bytes: Uint8Array): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8
      && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
      && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return "image/png";
  if (bytes.length >= 12
      && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
      && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "image/webp";
  return null;
}

function normalizeImageMime(contentType: string, bytes: Uint8Array): string | null {
  const declared = contentType.split(";")[0].trim().toLowerCase();
  if (/^image\/(?:jpeg|png|webp)$/.test(declared)) return declared;
  // Meta/CDN responses occasionally omit content-type or return
  // application/octet-stream. The bytes, not the header, are authoritative
  // for this bounded image ingestion step.
  return sniffImageMime(bytes);
}

function safeUrlHost(value: string): string {
  try { return new URL(value).hostname.slice(0, 120); } catch { return "invalid"; }
}

async function fetchCreativeDataUrl(referral: PedroV3AdReferral, fetcher: FetchLike): Promise<string | null> {
  const candidates = [...new Set(referral.imageUrls)]
    .filter(isTrustedMetaCreativeUrl)
    .filter((url) => !/(?:pps\.whatsapp\.net|profilepic|\/avatar\b)/i.test(url))
    .slice(0, 3);
  const failures: string[] = [];
  for (const url of candidates) {
    try {
      const response = await fetcher(url, {
        headers: {
          accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
          // Some Meta CDN edges reject a request with no browser-like UA.
          // This is transport hygiene only; it does not infer ad content.
          "user-agent": "PedroV3-AdContext/1.0",
        },
        signal: AbortSignal.timeout(12_000),
      });
      if (!response.ok) {
        failures.push(`${safeUrlHost(url)}:http_${response.status}`);
        continue;
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length === 0 || bytes.length > 10 * 1024 * 1024) {
        failures.push(`${safeUrlHost(url)}:size`);
        continue;
      }
      const imageMime = normalizeImageMime(response.headers.get("content-type") ?? "", bytes);
      if (!imageMime) {
        failures.push(`${safeUrlHost(url)}:not_image`);
        continue;
      }
      return `data:${imageMime};base64,${bytesToBase64(bytes)}`;
    } catch (error) {
      // Try the next factual creative URL. Failure never blocks ingestion, but
      // it must be observable; a silent null made the previous 50% failure
      // rate indistinguishable from an ad with no image.
      failures.push(`${safeUrlHost(url)}:${String((error as Error)?.name ?? "fetch_error").slice(0, 40)}`);
    }
  }
  if (candidates.length > 0) {
    console.warn("[pedro-v3-ad] creative_unavailable", JSON.stringify({ candidates: candidates.length, failures }));
  }
  return null;
}

export async function resolvePedroV3AdSemantic(
  referral: PedroV3AdReferral,
  apiKey: string,
  options: {
    readonly model?: string;
    readonly fetcher?: FetchLike;
  } = {},
): Promise<PedroV3AdSemanticResult | null> {
  if (!apiKey.trim() || referral.imageUrls.length === 0) return null;
  const fetcher = options.fetcher ?? fetch;
  const imageDataUrl = await fetchCreativeDataUrl(referral, fetcher);
  if (!imageDataUrl) return null;
  const model = options.model?.trim() || "gpt-4.1-mini";
  const metadata = [referral.greeting, referral.title, referral.body]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join("\n")
    .slice(0, 1_600);
  try {
    const response = await fetcher("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_completion_tokens: 320,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: "Voce extrai fatos de uma arte de anuncio automotivo para outro agente. Nao conduz conversa e nao escolhe ferramenta. Responda somente JSON com vehicle_query, vehicle_type, summary e confidence numerica de 0 a 1. Priorize marca/modelo/versao/ano impressos e legiveis na arte ou explicitamente nomeados nos metadados. Se nao houver UM veiculo especifico identificavel com seguranca, inclusive quando a imagem mostrar varios carros sem identificacao textual, use vehicle_query=null. Nunca adivinhe modelo apenas pela carroceria.",
          },
          {
            role: "user",
            content: [
              { type: "text", text: `Metadados textuais do anuncio:\n${metadata || "(sem texto especifico)"}\n\nExtraia somente o que estiver comprovado na arte ou nesses metadados.` },
              { type: "image_url", image_url: { url: imageDataUrl, detail: "high" } },
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      console.warn("[pedro-v3-ad] vision_http_error", JSON.stringify({ status: response.status, body: body.slice(0, 240) }));
      return null;
    }
    const envelope = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const raw = envelope.choices?.[0]?.message?.content;
    const parsed = typeof raw === "string" ? JSON.parse(raw) as Record<string, unknown> : null;
    if (!parsed) return null;
    const confidenceRaw = Number(parsed.confidence);
    const confidence = Number.isFinite(confidenceRaw) ? Math.max(0, Math.min(1, confidenceRaw)) : 0;
    const candidate = confidence >= 0.65 ? asText(parsed.vehicle_query, 300) : null;
    return {
      vehicle_query: candidate,
      vehicle_type: candidate ? asText(parsed.vehicle_type, 64) : null,
      summary: asText(parsed.summary, 800),
      confidence,
      diagnostics: { used_image_inference: candidate != null, model },
    };
  } catch (error) {
    console.warn("[pedro-v3-ad] vision_parse_or_transport_error", String((error as Error)?.message ?? error).slice(0, 240));
    return null;
  }
}
