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
  return ["true", "1", "yes", "on", "enabled"].includes(
    String(Deno.env.get("PEDRO_V2_ENABLED") || "").toLowerCase().trim(),
  );
}

export function isPedroV2MutationEnabled(): boolean {
  return ["true", "1", "yes", "on", "enabled"].includes(
    String(Deno.env.get("PEDRO_V2_MUTATIONS_ENABLED") || "").toLowerCase().trim(),
  );
}

export function isPedroV2SendingEnabled(): boolean {
  return ["true", "1", "yes", "on", "enabled"].includes(
    String(Deno.env.get("PEDRO_V2_SEND_ENABLED") || "").toLowerCase().trim(),
  );
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

