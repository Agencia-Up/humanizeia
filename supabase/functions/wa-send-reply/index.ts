import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = claimsData.claims.sub as string;

    const { instance_id, phone, content, media_url, media_type } = await req.json();

    if (!instance_id || !phone || (!content && !media_url)) {
      return new Response(JSON.stringify({ error: "instance_id, phone, and content/media_url are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch instance (RLS ensures ownership)
    const { data: instance, error: instErr } = await supabase
      .from("wa_instances")
      .select("*")
      .eq("id", instance_id)
      .eq("user_id", userId)
      .single();

    if (instErr || !instance) {
      return new Response(JSON.stringify({ error: "Instance not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const apiUrl = (instance.api_url as string).replace(/\/+$/, "");
    const number = phone.replace(/\D/g, "");

    // Send via Evolution API
    let sendResult;
    if (media_url && media_type) {
      const endpoint =
        media_type === "image" ? "sendImage" :
        media_type === "video" ? "sendVideo" :
        media_type === "audio" ? "sendAudio" : "sendDocument";

      const resp = await fetch(`${apiUrl}/message/${endpoint}/${instance.instance_name}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: instance.api_key_encrypted as string,
        },
        body: JSON.stringify({ number, mediatype: media_type, media: media_url, caption: content || "" }),
      });
      if (!resp.ok) throw new Error(`Evolution API error: ${resp.status} - ${await resp.text()}`);
      sendResult = await resp.json();
    } else {
      const resp = await fetch(`${apiUrl}/message/sendText/${instance.instance_name}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: instance.api_key_encrypted as string,
        },
        body: JSON.stringify({ number, text: content }),
      });
      if (!resp.ok) throw new Error(`Evolution API error: ${resp.status} - ${await resp.text()}`);
      sendResult = await resp.json();
    }

    // Save to wa_inbox as outgoing
    const { error: insertErr } = await supabase.from("wa_inbox").insert({
      user_id: userId,
      instance_id,
      phone: number,
      direction: "outgoing",
      message_type: media_type || "text",
      content: content || "",
      media_url: media_url || null,
      is_read: true,
      remote_message_id: sendResult?.key?.id || null,
    });

    if (insertErr) {
      console.error("Failed to save outgoing message:", insertErr);
    }

    return new Response(
      JSON.stringify({ success: true, message_id: sendResult?.key?.id }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("wa-send-reply error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
