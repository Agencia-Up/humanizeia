const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_TOKENS = 3_000;

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function bearer(request: Request): string | null {
  const match = /^Bearer\s+(.+)$/i.exec(request.headers.get("authorization") ?? "");
  return match?.[1]?.trim() || null;
}

function hasServiceRole(token: string | null): boolean {
  if (!token) return false;
  const segments = token.split(".");
  if (segments.length !== 3) return false;
  try {
    const normalized = segments[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const payload = JSON.parse(atob(padded)) as { role?: unknown };
    return payload.role === "service_role";
  } catch {
    return false;
  }
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json(405, { code: "METHOD_NOT_ALLOWED" });

  const deepSeekKey = Deno.env.get("DEEPSEEK_API_KEY")?.trim();
  // The Supabase gateway verifies the JWT before this function runs. We also
  // require the verified token to carry the service_role claim so rotated but
  // still-valid service keys keep working without opening this eval endpoint.
  if (!hasServiceRole(bearer(request))) return json(401, { code: "UNAUTHORIZED" });
  if (!deepSeekKey) return json(503, { code: "DEEPSEEK_NOT_CONFIGURED" });

  const raw = await request.text();
  if (!raw || new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
    return json(413, { code: "PAYLOAD_TOO_LARGE" });
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return json(400, { code: "INVALID_JSON" });
  }
  if (payload.model !== "deepseek-chat" || !Array.isArray(payload.messages)) {
    return json(400, { code: "REQUEST_NOT_ALLOWED" });
  }

  const requestedTokens = Number(payload.max_tokens ?? 1_600);
  const safePayload = {
    ...payload,
    model: "deepseek-chat",
    stream: false,
    max_tokens: Number.isFinite(requestedTokens)
      ? Math.max(1, Math.min(MAX_TOKENS, Math.trunc(requestedTokens)))
      : 1_600,
  };

  let upstream: Response;
  try {
    upstream = await fetch(DEEPSEEK_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${deepSeekKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(safePayload),
      signal: AbortSignal.timeout(70_000),
    });
  } catch {
    return json(502, { code: "DEEPSEEK_UNAVAILABLE" });
  }

  const responseBody = await upstream.text();
  return new Response(responseBody, {
    status: upstream.status,
    headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" },
  });
});
