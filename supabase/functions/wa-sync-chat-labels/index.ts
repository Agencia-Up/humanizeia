import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function onlyDigits(value: string | null | undefined): string {
  return String(value || "").replace(/\D/g, "");
}

function normalizeName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function colorForLabel(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return Math.abs(hash) % 20;
}

async function callerCanAccessUser(service: any, callerId: string, requestedUserId: string): Promise<boolean> {
  if (callerId === requestedUserId) return true;

  const { data: profile } = await service
    .from("profiles")
    .select("role, manager_id")
    .eq("id", callerId)
    .maybeSingle();
  if (profile?.role === "seller" && profile.manager_id === requestedUserId) return true;

  const { data: member } = await service
    .from("ai_team_members")
    .select("id")
    .eq("user_id", requestedUserId)
    .eq("auth_user_id", callerId)
    .limit(1)
    .maybeSingle();
  return !!member?.id;
}

async function resolveInstance(service: any, userId: string, instanceId: string) {
  const { data } = await service
    .from("wa_instances")
    .select("id, user_id, instance_name, api_url, api_key_encrypted")
    .eq("id", instanceId)
    .eq("user_id", userId)
    .maybeSingle();
  return data || null;
}

function uazapiConfig(instance: any) {
  const legacyUazapiToken = Deno.env.get("UAZAPI_API") || Deno.env.get("UAZAPI-API");
  const envApiUrl =
    Deno.env.get("UAZAPI_URL") ||
    Deno.env.get("EVOLUTION_API_URL") ||
    (legacyUazapiToken ? "https://logosiabrasilcom.uazapi.com" : "");
  const apiUrl = String(envApiUrl || instance?.api_url || "").replace(/\/+$/, "");
  const token = String(instance?.api_key_encrypted || "");
  return { apiUrl, token };
}

function headers(token: string) {
  return {
    "Content-Type": "application/json",
    token,
  };
}

async function fetchLabels(apiUrl: string, token: string): Promise<any[]> {
  const res = await fetch(`${apiUrl}/labels`, { method: "GET", headers: headers(token) });
  if (!res.ok) throw new Error(`labels_failed_${res.status}`);
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

async function createMissingLabel(apiUrl: string, token: string, name: string) {
  const res = await fetch(`${apiUrl}/label/edit`, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify({
      labelid: "new",
      name,
      color: colorForLabel(name),
      delete: false,
    }),
  });
  if (!res.ok) throw new Error(`create_label_failed_${res.status}`);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const service = createClient(supabaseUrl, serviceKey);

    const { data: userData, error: userError } = await authClient.auth.getUser();
    if (userError || !userData?.user) return json({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const userId = String(body?.user_id || "").trim();
    const phone = onlyDigits(body?.phone);
    const instanceId = String(body?.instance_id || "").trim();
    const labels = Array.isArray(body?.labels)
      ? body.labels.map((v: unknown) => String(v || "").trim()).filter(Boolean).slice(0, 20)
      : [];

    if (!userId || !phone || !instanceId) return json({ error: "user_id, phone and instance_id are required" }, 400);
    const allowed = await callerCanAccessUser(service, userData.user.id, userId);
    if (!allowed) return json({ error: "Forbidden" }, 403);

    const instance = await resolveInstance(service, userId, instanceId);
    if (!instance?.id) return json({ error: "Instance not found" }, 404);

    const { apiUrl, token } = uazapiConfig(instance);
    if (!apiUrl || !token) return json({ error: "UAZAPI instance config missing" }, 422);

    let remoteLabels = await fetchLabels(apiUrl, token);
    const remoteByName = new Map<string, any>();
    for (const label of remoteLabels) {
      if (label?.name) remoteByName.set(normalizeName(String(label.name)), label);
    }

    const created: string[] = [];
    for (const labelName of labels) {
      if (remoteByName.has(normalizeName(labelName))) continue;
      await createMissingLabel(apiUrl, token, labelName);
      created.push(labelName);
    }

    if (created.length > 0) {
      remoteLabels = await fetchLabels(apiUrl, token);
      remoteByName.clear();
      for (const label of remoteLabels) {
        if (label?.name) remoteByName.set(normalizeName(String(label.name)), label);
      }
    }

    const labelids = labels
      .map((name: string) => remoteByName.get(normalizeName(name)))
      .map((label: any) => String(label?.labelid || label?.id || "").trim())
      .filter(Boolean);

    const res = await fetch(`${apiUrl}/chat/labels`, {
      method: "POST",
      headers: headers(token),
      body: JSON.stringify({ number: phone, labelids }),
    });

    const responseText = await res.text().catch(() => "");
    const ok = res.ok;

    const { data: contact } = await service
      .from("wa_contacts")
      .select("metadata")
      .eq("user_id", userId)
      .eq("phone", phone)
      .maybeSingle();
    const metadata = {
      ...((contact?.metadata && typeof contact.metadata === "object") ? contact.metadata : {}),
      whatsapp_label_sync: {
        synced_at: new Date().toISOString(),
        ok,
        status: res.status,
        requested: labels,
        labelids,
        created,
      },
    };
    await service
      .from("wa_contacts")
      .update({ metadata } as any)
      .eq("user_id", userId)
      .eq("phone", phone);

    if (!ok) return json({ ok: false, status: res.status, error: responseText.slice(0, 300), labelids, created }, 502);
    return json({ ok: true, labelids, created });
  } catch (err) {
    console.error("wa-sync-chat-labels error:", err);
    return json({ ok: false, error: err instanceof Error ? err.message : "Internal error" }, 500);
  }
});
