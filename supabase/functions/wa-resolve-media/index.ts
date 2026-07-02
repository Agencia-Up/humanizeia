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

function extFromMime(mime: string): string {
  const m = (mime || "").toLowerCase();
  if (m.includes("jpeg") || m.includes("jpg")) return "jpg";
  if (m.includes("png")) return "png";
  if (m.includes("webp")) return "webp";
  if (m.includes("gif")) return "gif";
  if (m.includes("ogg")) return "ogg";
  if (m.includes("mpeg") || m.includes("mp3")) return "mp3";
  if (m.includes("mp4")) return "mp4";
  if (m.includes("3gpp") || m.includes("3gp")) return "3gp";
  if (m.includes("webm")) return "webm";
  if (m.includes("wav")) return "wav";
  if (m.includes("pdf")) return "pdf";
  return "bin";
}

function decodeBase64ToBytes(base64: string): Uint8Array {
  const bin = atob(String(base64 || "").replace(/\s/g, ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function isRenderableUrl(url: string | null | undefined) {
  const u = String(url || "").toLowerCase();
  if (!u) return false;
  if (u.startsWith("data:") || u.startsWith("blob:")) return true;
  if (u.includes("mmg.whatsapp.net") || u.includes(".enc")) return false;
  return /^https?:\/\//.test(u);
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
    const authClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const service = createClient(supabaseUrl, serviceKey);

    const { data: userData, error: userError } = await authClient.auth.getUser();
    if (userError || !userData?.user) return json({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const messageId = String(body?.message_id || "").trim();
    if (!messageId) return json({ error: "message_id is required" }, 400);

    // First read through RLS with the caller token. If the caller cannot read the
    // row, we do not resolve media with service-role.
    const { data: readableRow, error: readableError } = await authClient
      .from("wa_inbox")
      .select("id")
      .eq("id", messageId)
      .maybeSingle();
    if (readableError || !readableRow?.id) return json({ error: "Message not found" }, 404);

    const { data: msg, error: msgError } = await service
      .from("wa_inbox")
      .select("id, user_id, instance_id, phone, message_type, media_url, remote_message_id")
      .eq("id", messageId)
      .maybeSingle();
    if (msgError || !msg) return json({ error: "Message not found" }, 404);
    if (isRenderableUrl(msg.media_url)) return json({ media_url: msg.media_url, cached: true });
    if (!msg.instance_id || !msg.remote_message_id) {
      return json({ error: "Mensagem sem identificador de midia para recuperar" }, 422);
    }

    const { data: instance, error: instanceError } = await service
      .from("wa_instances")
      .select("id, user_id, instance_name, api_url, api_key_encrypted")
      .eq("id", msg.instance_id)
      .maybeSingle();
    if (instanceError || !instance) return json({ error: "Instance not found" }, 404);

    const baseUrl = String(instance.api_url || "").replace(/\/+$/, "");
    const instKey = String(instance.api_key_encrypted || "");
    if (!baseUrl || !instKey) return json({ error: "Instance credentials missing" }, 422);

    const downloadRes = await fetch(`${baseUrl}/message/download?instance=${instance.instance_name}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: instKey, token: instKey },
      body: JSON.stringify({ id: msg.remote_message_id, return_base64: true }),
    });
    if (!downloadRes.ok) {
      return json({ error: `UAZAPI download failed: ${downloadRes.status}` }, 502);
    }

    const media = await downloadRes.json();
    const base64 = media.base64Data || media.base64 || media.file || "";
    const mimetype = media.mimetype || (msg.message_type === "audio" ? "audio/ogg" : msg.message_type === "image" ? "image/jpeg" : "application/octet-stream");
    if (!base64) {
      const fallbackUrl = media.fileURL || media.fileUrl || media.url || null;
      if (isRenderableUrl(fallbackUrl)) {
        await service.from("wa_inbox").update({ media_url: fallbackUrl }).eq("id", msg.id);
        return json({ media_url: fallbackUrl, cached: false });
      }
      return json({ error: "UAZAPI did not return media bytes" }, 422);
    }

    const bytes = decodeBase64ToBytes(base64);
    const safePhone = String(msg.phone || "").replace(/\D/g, "") || "lead";
    const path = `${msg.user_id}/${safePhone}/${Date.now()}-${crypto.randomUUID()}.${extFromMime(mimetype)}`;
    const { error: uploadError } = await service.storage
      .from("wa-media")
      .upload(path, bytes, { contentType: mimetype, upsert: true });
    if (uploadError) return json({ error: uploadError.message }, 500);

    const { data: pub } = service.storage.from("wa-media").getPublicUrl(path);
    const publicUrl = pub?.publicUrl;
    if (!publicUrl) return json({ error: "Failed to build public URL" }, 500);

    await service.from("wa_inbox").update({ media_url: publicUrl }).eq("id", msg.id);
    return json({ media_url: publicUrl, cached: false });
  } catch (err) {
    console.error("wa-resolve-media error:", err);
    return json({ error: err instanceof Error ? err.message : "Internal error" }, 500);
  }
});
