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

    // Fix: use getUser instead of getClaims
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = userData.user.id;

    const { instance_id, phone, content, media_url, media_type } = await req.json();

    if (!instance_id || !phone || (!content && !media_url)) {
      return new Response(JSON.stringify({ error: "instance_id, phone, and content/media_url are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch instance — allow seller to use master's instances
    // First try with user's own ID
    let { data: instance, error: instErr } = await supabase
      .from("wa_instances")
      .select("*")
      .eq("id", instance_id)
      .eq("user_id", userId)
      .single();

    // If not found, check if user is a seller and try with manager's ID
    if (!instance) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("role, manager_id")
        .eq("id", userId)
        .single();

      if (profile?.role === "seller" && profile.manager_id) {
        const svcSupabase = createClient(
          Deno.env.get("SUPABASE_URL")!,
          Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        );
        const { data: masterInst, error: masterErr } = await svcSupabase
          .from("wa_instances")
          .select("*")
          .eq("id", instance_id)
          .eq("user_id", profile.manager_id)
          .single();
        instance = masterInst;
        instErr = masterErr;
      }
    }

    if (instErr || !instance) {
      return new Response(JSON.stringify({ error: "Instance not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const apiUrl = (instance.api_url as string).replace(/\/+$/, "");
    const number = phone.replace(/\D/g, "");

    // Send via UazAPI — multiple endpoint fallbacks for robustness
    const instKey = instance.api_key_encrypted as string;
    const instName = instance.instance_name as string;
    const sendHeaders = { "Content-Type": "application/json", token: instKey, apikey: instKey };

    let sendResult;
    if (media_url && media_type) {
      // UazAPI V6: /send/media with "file" is the confirmed format.
      // Keep older body shapes as fallbacks for compatibility.
      const caption = media_type === "audio" ? "" : (content || "");
      const mediaAttempts = [
        { url: `${apiUrl}/send/media`, body: { number, file: media_url, type: media_type, caption } },
        { url: `${apiUrl}/send/media`, body: { number, file: media_url, mediatype: media_type, caption } },
        { url: `${apiUrl}/send/media`, body: { number, url: media_url, type: media_type, caption } },
        { url: `${apiUrl}/send/media`, body: { number, media: media_url, mediatype: media_type, caption } },
      ];

      let lastErr = "";
      for (const attempt of mediaAttempts) {
        try {
          const resp = await fetch(attempt.url, { method: "POST", headers: sendHeaders, body: JSON.stringify(attempt.body) });
          if (resp.ok) { sendResult = await resp.json(); break; }
          lastErr = `${resp.status} - ${await resp.text()}`;
        } catch (e) { lastErr = e instanceof Error ? e.message : String(e); }
      }
      if (!sendResult) throw new Error(`UazAPI media error: ${lastErr}`);
    } else {
      const textAttempts = [
        { url: `${apiUrl}/send/text`, body: { number, text: content } },
        { url: `${apiUrl}/message/sendText/${instName}`, body: { number, text: content } },
      ];

      let lastErr = "";
      for (const attempt of textAttempts) {
        try {
          const resp = await fetch(attempt.url, { method: "POST", headers: sendHeaders, body: JSON.stringify(attempt.body) });
          if (resp.ok) { sendResult = await resp.json(); break; }
          lastErr = `${resp.status} - ${await resp.text()}`;
        } catch (e) { lastErr = e instanceof Error ? e.message : String(e); }
      }
      if (!sendResult) throw new Error(`UazAPI text error: ${lastErr}`);
    }

    // Save to wa_inbox as outgoing
    const { error: insertErr } = await supabase.from("wa_inbox").insert({
      user_id: instance.user_id || userId,
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
