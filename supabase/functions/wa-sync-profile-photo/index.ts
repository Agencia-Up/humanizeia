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

function phoneVariantsBR(value: string | null | undefined): string[] {
  const digits = onlyDigits(value);
  const out = new Set<string>();
  if (!digits) return [];

  const add = (v: string) => {
    if (!v) return;
    out.add(v);
    out.add(`${v}@s.whatsapp.net`);
  };

  add(digits);
  const national = digits.startsWith("55") && digits.length > 11 ? digits.slice(2) : digits;
  add(national);
  if (national.length === 10) {
    const withNine = `${national.slice(0, 2)}9${national.slice(2)}`;
    add(withNine);
    add(`55${national}`);
    add(`55${withNine}`);
  } else if (national.length === 11 && national[2] === "9") {
    const withoutNine = `${national.slice(0, 2)}${national.slice(3)}`;
    add(withoutNine);
    add(`55${national}`);
    add(`55${withoutNine}`);
  }

  return [...out].filter((v) => onlyDigits(v).length >= 10);
}

function extractProfilePictureUrl(payload: unknown): string | null {
  const seen = new Set<unknown>();
  const profileKey = /(profile|perfil|avatar|picture|photo|foto|pic|image|img)/i;
  const urlLike = /^https?:\/\//i;

  const visit = (value: unknown, path = ""): string | null => {
    if (value == null) return null;
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!urlLike.test(trimmed)) return null;
      if (profileKey.test(path) || /pps\.whatsapp\.net|profile[-_]?pic|profilepic|avatar|\/pp\//i.test(trimmed)) {
        return trimmed;
      }
      return null;
    }
    if (typeof value !== "object" || seen.has(value)) return null;
    seen.add(value);

    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        const found = visit(value[i], `${path}.${i}`);
        if (found) return found;
      }
      return null;
    }

    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const found = visit(child, path ? `${path}.${key}` : key);
      if (found) return found;
    }
    return null;
  };

  return visit(payload);
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

async function resolveInstance(service: any, userId: string, phone: string, instanceId?: string | null) {
  if (instanceId) {
    const { data } = await service
      .from("wa_instances")
      .select("id, user_id, instance_name, api_url, api_key_encrypted")
      .eq("id", instanceId)
      .eq("user_id", userId)
      .maybeSingle();
    if (data?.id) return data;
  }

  const variants = phoneVariantsBR(phone);
  if (variants.length > 0) {
    const inboxPhones = variants.map(onlyDigits);
    const { data: msg } = await service
      .from("wa_inbox")
      .select("instance_id")
      .eq("user_id", userId)
      .in("phone", inboxPhones)
      .not("instance_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (msg?.instance_id) return resolveInstance(service, userId, phone, msg.instance_id);

    const { data: lead } = await service
      .from("ai_crm_leads")
      .select("instance_id")
      .eq("user_id", userId)
      .in("remote_jid", variants)
      .not("instance_id", "is", null)
      .order("last_interaction_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (lead?.instance_id) return resolveInstance(service, userId, phone, lead.instance_id);
  }

  const { data: fallback } = await service
    .from("wa_instances")
    .select("id, user_id, instance_name, api_url, api_key_encrypted")
    .eq("user_id", userId)
    .eq("is_active", true)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return fallback || null;
}

async function fetchProfilePhoto(instance: any, phone: string): Promise<string | null> {
  const apiUrl = String(instance?.api_url || "").replace(/\/+$/, "");
  const apiKey = String(instance?.api_key_encrypted || "");
  const instanceName = String(instance?.instance_name || "");
  const number = onlyDigits(phone);
  if (!apiUrl || !apiKey || !instanceName || !number) return null;

  const headers = { "Content-Type": "application/json", apikey: apiKey, token: apiKey };
  const attempts = [
    { label: "chat/fetchProfile", url: `${apiUrl}/chat/fetchProfile/${encodeURIComponent(instanceName)}`, body: { number } },
    { label: "contact/find", url: `${apiUrl}/contact/find/${encodeURIComponent(instanceName)}`, body: { numbers: [number] } },
    { label: "chat/fetchContacts", url: `${apiUrl}/chat/fetchContacts/${encodeURIComponent(instanceName)}`, body: { numbers: [number] } },
  ];

  for (const attempt of attempts) {
    try {
      const res = await fetch(attempt.url, { method: "POST", headers, body: JSON.stringify(attempt.body) });
      if (!res.ok) {
        await res.text();
        continue;
      }
      const data = await res.json();
      const url = extractProfilePictureUrl(data);
      if (url) return url;
    } catch (err) {
      console.warn(`[wa-sync-profile-photo] ${attempt.label} failed`, err);
    }
  }

  return null;
}

async function upsertContactPhoto(service: any, userId: string, phone: string, photoUrl: string) {
  const cleanPhone = onlyDigits(phone);
  const now = new Date().toISOString();
  const { data: existing } = await service
    .from("wa_contacts")
    .select("id, metadata")
    .eq("user_id", userId)
    .eq("phone", cleanPhone)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  const metadata = {
    ...((existing?.metadata && typeof existing.metadata === "object") ? existing.metadata : {}),
    profile_picture_url: photoUrl,
    profile_picture_source: "uazapi-fetch-profile",
    profile_picture_synced_at: now,
  };

  if (existing?.id) {
    await service.from("wa_contacts").update({ metadata }).eq("id", existing.id);
    return;
  }

  await service.from("wa_contacts").insert({
    user_id: userId,
    phone: cleanPhone,
    source: "inbox",
    metadata,
    last_message_at: now,
  });
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
    const instanceId = body?.instance_id ? String(body.instance_id) : null;
    if (!userId || !phone) return json({ error: "user_id and phone are required" }, 400);

    const allowed = await callerCanAccessUser(service, userData.user.id, userId);
    if (!allowed) return json({ error: "Forbidden" }, 403);

    const { data: cached } = await service
      .from("wa_contacts")
      .select("metadata")
      .eq("user_id", userId)
      .eq("phone", phone)
      .maybeSingle();
    const cachedUrl = extractProfilePictureUrl(cached?.metadata);
    if (cachedUrl) return json({ profile_picture_url: cachedUrl, cached: true });

    const instance = await resolveInstance(service, userId, phone, instanceId);
    if (!instance?.id) return json({ profile_picture_url: null, error: "Instance not found" }, 404);

    const photoUrl = await fetchProfilePhoto(instance, phone);
    if (!photoUrl) return json({ profile_picture_url: null, cached: false });

    await upsertContactPhoto(service, userId, phone, photoUrl);
    return json({ profile_picture_url: photoUrl, cached: false });
  } catch (err) {
    console.error("wa-sync-profile-photo error:", err);
    return json({ error: err instanceof Error ? err.message : "Internal error" }, 500);
  }
});
