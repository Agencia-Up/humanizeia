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
    const body = await req.json();

    // Evolution API webhook payload structure
    const event = body.event;
    const instanceName = body.instance;
    const messageData = body.data;

    // Only process incoming messages
    if (event !== "messages.upsert" || !messageData) {
      return new Response(JSON.stringify({ ok: true, skipped: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Find the instance to get user_id
    const { data: instance, error: instErr } = await supabase
      .from("wa_instances")
      .select("id, user_id")
      .eq("instance_name", instanceName)
      .single();

    if (instErr || !instance) {
      console.error("Instance not found:", instanceName, instErr);
      return new Response(JSON.stringify({ error: "Instance not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const message = messageData.message || messageData;
    const key = messageData.key || {};

    // Skip outgoing messages (fromMe)
    if (key.fromMe) {
      return new Response(JSON.stringify({ ok: true, skipped: "outgoing" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const remoteJid = key.remoteJid || "";
    const phone = remoteJid.replace("@s.whatsapp.net", "").replace("@g.us", "");
    const pushName = messageData.pushName || null;
    const remoteMessageId = key.id || null;

    // Determine message type and content
    let messageType = "text";
    let content = "";
    let mediaUrl: string | null = null;

    if (message.conversation) {
      content = message.conversation;
    } else if (message.extendedTextMessage?.text) {
      content = message.extendedTextMessage.text;
    } else if (message.imageMessage) {
      messageType = "image";
      content = message.imageMessage.caption || "";
      mediaUrl = message.imageMessage.url || null;
    } else if (message.videoMessage) {
      messageType = "video";
      content = message.videoMessage.caption || "";
      mediaUrl = message.videoMessage.url || null;
    } else if (message.audioMessage) {
      messageType = "audio";
      mediaUrl = message.audioMessage.url || null;
    } else if (message.documentMessage) {
      messageType = "document";
      content = message.documentMessage.fileName || "";
      mediaUrl = message.documentMessage.url || null;
    } else if (message.stickerMessage) {
      messageType = "sticker";
    }

    // Find existing contact
    const { data: contact } = await supabase
      .from("wa_contacts")
      .select("id")
      .eq("user_id", instance.user_id)
      .eq("phone", phone)
      .limit(1)
      .maybeSingle();

    // Insert into wa_inbox
    const { data: inboxMsg, error: insertErr } = await supabase
      .from("wa_inbox")
      .insert({
        user_id: instance.user_id,
        instance_id: instance.id,
        contact_id: contact?.id || null,
        phone,
        contact_name: pushName,
        direction: "incoming",
        message_type: messageType,
        content,
        media_url: mediaUrl,
        remote_message_id: remoteMessageId,
        is_read: false,
      })
      .select("id")
      .single();

    if (insertErr) {
      console.error("Insert inbox error:", insertErr);
      return new Response(JSON.stringify({ error: "Failed to save message" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // --- AI Categorization (async, non-blocking for webhook response) ---
    if (content && content.trim().length > 0) {
      try {
        const aiCategory = await categorizeWithAI(content);

        await supabase
          .from("wa_inbox")
          .update({
            ai_category: aiCategory.category,
            ai_sentiment: aiCategory.sentiment,
          })
          .eq("id", inboxMsg.id);

        // Auto-blacklist on opt-out
        if (aiCategory.category === "opt-out" && contact?.id) {
          await supabase
            .from("wa_contacts")
            .update({ is_valid: false, tags: ["blacklist"] } as any)
            .eq("id", contact.id);
        }
      } catch (aiErr) {
        console.error("AI categorization failed:", aiErr);
        // Non-critical: message is saved, AI categorization just didn't work
      }
    }

    return new Response(
      JSON.stringify({ ok: true, inbox_id: inboxMsg.id }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("wa-inbox-webhook error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

async function categorizeWithAI(content: string): Promise<{ category: string; sentiment: string }> {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

  const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash-lite",
      messages: [
        {
          role: "system",
          content: `Você é um classificador de mensagens de WhatsApp. Analise a mensagem e retorne APENAS um JSON com:
- "category": uma das opções: "interested", "question", "opt-out", "positive", "negative", "neutral", "spam"
- "sentiment": uma das opções: "positive", "negative", "neutral"

Regras:
- "opt-out": se a pessoa pede pra parar de receber mensagens, bloquear, sair da lista, etc.
- "interested": se demonstra interesse em comprar, saber mais, etc.
- "question": se faz uma pergunta sobre o produto/serviço
- "positive": elogio ou feedback positivo
- "negative": reclamação ou feedback negativo
- "neutral": resposta neutra ou informativa
- "spam": mensagem irrelevante

Responda APENAS o JSON, sem markdown.`,
        },
        { role: "user", content },
      ],
      temperature: 0.1,
      max_tokens: 100,
    }),
  });

  if (!response.ok) throw new Error(`AI error: ${response.status}`);

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content || "";

  try {
    return JSON.parse(text.trim());
  } catch {
    return { category: "neutral", sentiment: "neutral" };
  }
}
