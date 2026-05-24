import { createClient } from "npm:@supabase/supabase-js@2";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-pedro-v2-internal-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function createServiceClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

export function isPedroV2Enabled(): boolean {
  return isTruthyEnv("PEDRO_V2_ENABLED");
}

export function isPedroV2MutationEnabled(): boolean {
  return isTruthyEnv("PEDRO_V2_MUTATIONS_ENABLED");
}

export function isPedroV2SendingEnabled(): boolean {
  return isTruthyEnv("PEDRO_V2_SEND_ENABLED");
}

function isTruthyEnv(name: string): boolean {
  return ["true", "1", "yes", "on", "enabled"].includes(
    String(Deno.env.get(name) || "").toLowerCase().trim(),
  );
}

function listEnv(name: string): string[] {
  return String(Deno.env.get(name) || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function includesNormalized(value: string | null | undefined, allowed: string[]): boolean {
  if (!value) return false;
  const normalizedValue = value.toLowerCase().trim();
  return allowed.some((item) => item.toLowerCase().trim() === normalizedValue);
}

export async function isPedroV2EnabledForUser(
  supabase: ReturnType<typeof createServiceClient>,
  userId: string | null | undefined,
): Promise<{ enabled: boolean; reason: string; email?: string | null }> {
  if (isPedroV2Enabled()) {
    return { enabled: true, reason: "global_flag" };
  }

  if (!userId) {
    return { enabled: false, reason: "missing_user_id" };
  }

  if (includesNormalized(userId, listEnv("PEDRO_V2_ALLOWED_USER_IDS"))) {
    return { enabled: true, reason: "user_id_allowlist" };
  }

  const allowedEmails = listEnv("PEDRO_V2_ALLOWED_USER_EMAILS");
  if (allowedEmails.length === 0) {
    return { enabled: false, reason: "no_allowlist" };
  }

  try {
    const { data, error } = await supabase.auth.admin.getUserById(userId);
    if (error) {
      console.warn("[pedro-v2] Could not resolve user email:", error.message);
      return { enabled: false, reason: "email_lookup_failed" };
    }

    const email = data?.user?.email || null;
    if (includesNormalized(email, allowedEmails)) {
      return { enabled: true, reason: "email_allowlist", email };
    }

    return { enabled: false, reason: "email_not_allowlisted", email };
  } catch (error) {
    console.warn("[pedro-v2] Unexpected email lookup failure:", error);
    return { enabled: false, reason: "email_lookup_exception" };
  }
}

export async function authorizeToolRequest(req: Request) {
  const configuredToken = Deno.env.get("PEDRO_V2_INTERNAL_TOKEN");
  const providedToken = req.headers.get("x-pedro-v2-internal-token");

  if (configuredToken && providedToken && configuredToken === providedToken) {
    return { ok: true, mode: "internal" as const, user_id: null };
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return { ok: false, status: 401, error: "Missing Authorization bearer or internal token" };
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user) {
    return { ok: false, status: 401, error: "Invalid Authorization bearer" };
  }

  return { ok: true, mode: "user" as const, user_id: data.user.id };
}

export async function parseJson(req: Request): Promise<any> {
  try {
    return await req.json();
  } catch {
    return {};
  }
}
