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

async function fetchCreativeDataUrl(referral: PedroV3AdReferral, fetcher: FetchLike): Promise<string | null> {
  const candidates = [...new Set(referral.imageUrls)]
    .filter(isTrustedMetaCreativeUrl)
    .filter((url) => !/(?:pps\.whatsapp\.net|profilepic|\/avatar\b)/i.test(url))
    .slice(0, 2);
  for (const url of candidates) {
    try {
      const response = await fetcher(url, { signal: AbortSignal.timeout(12_000) });
      if (!response.ok) continue;
      const contentType = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
      if (!/^image\/(?:jpeg|png|webp)$/.test(contentType)) continue;
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length === 0 || bytes.length > 6 * 1024 * 1024) continue;
      return `data:${contentType};base64,${bytesToBase64(bytes)}`;
    } catch {
      // Try the next factual creative URL. Failure never blocks ingestion.
    }
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
    if (!response.ok) return null;
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
  } catch {
    return null;
  }
}
