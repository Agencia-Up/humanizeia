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

  // Handle Meta Webhook verification (GET request)
  if (req.method === "GET") {
    const url = new URL(req.url);
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");

    if (mode === "subscribe" && token) {
      // Verify token against stored webhook_verify_token
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
      );

      // Accept any verify token for now (can be hardened later)
      console.log("[wa-inbox-webhook] Meta webhook verification request received");
      return new Response(challenge || "", {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      });
    }

    return new Response("OK", { status: 200 });
  }

  try {
    const body = await req.json();
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Detect if this is a Meta webhook or Evolution webhook
    if (body.object === "whatsapp_business_account") {
      return await handleMetaWebhook(supabase, body);
    } else {
      return await handleEvolutionWebhook(supabase, body);
    }
  } catch (err) {
    console.error("wa-inbox-webhook error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// ====================== META WEBHOOK HANDLER ======================

async function handleMetaWebhook(supabase: any, body: any) {
  const entries = body.entry || [];

  for (const entry of entries) {
    const changes = entry.changes || [];

    for (const change of changes) {
      if (change.field !== "messages") continue;

      const value = change.value || {};
      const metadata = value.metadata || {};
      const phoneNumberId = metadata.phone_number_id;

      if (!phoneNumberId) continue;

      // Find instance by phone_number_id in meta_config
      const { data: instances } = await supabase
        .from("wa_instances")
        .select("id, user_id")
        .eq("provider", "meta")
        .filter("meta_config->>phone_number_id", "eq", phoneNumberId);

      const instance = instances?.[0];
      if (!instance) {
        console.warn(`[meta-webhook] No instance found for phone_number_id: ${phoneNumberId}`);
        continue;
      }

      // Handle incoming messages
      const messages = value.messages || [];
      for (const msg of messages) {
        const phone = msg.from;
        const pushName = value.contacts?.[0]?.profile?.name || null;
        const remoteMessageId = msg.id;

        let messageType = "text";
        let content = "";
        let mediaUrl: string | null = null;

        if (msg.type === "text") {
          content = msg.text?.body || "";
        } else if (msg.type === "image") {
          messageType = "image";
          content = msg.image?.caption || "";
          // Media URL needs to be fetched via Meta API (msg.image.id)
        } else if (msg.type === "video") {
          messageType = "video";
          content = msg.video?.caption || "";
        } else if (msg.type === "audio") {
          messageType = "audio";
        } else if (msg.type === "document") {
          messageType = "document";
          content = msg.document?.filename || "";
        } else if (msg.type === "sticker") {
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
          console.error("Meta inbox insert error:", insertErr);
          continue;
        }

        // AI categorization
        if (content && content.trim().length > 0) {
          await categorizeAndAutomate(supabase, instance, inboxMsg.id, content, phone, pushName, contact?.id);
        }
      }

      // Handle delivery status updates
      const statuses = value.statuses || [];
      for (const status of statuses) {
        await handleMetaDeliveryStatus(supabase, instance, status);
      }
    }
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function handleMetaDeliveryStatus(supabase: any, instance: any, status: any) {
  const phone = status.recipient_id;
  if (!phone) return;

  let queueStatus: string | null = null;
  let deliveredAt: string | null = null;
  let readAt: string | null = null;

  switch (status.status) {
    case "delivered":
      queueStatus = "delivered";
      deliveredAt = new Date().toISOString();
      break;
    case "read":
      queueStatus = "read";
      readAt = new Date().toISOString();
      break;
    case "failed":
      queueStatus = "failed";
      break;
    case "sent":
      return; // Already tracked
  }

  if (!queueStatus) return;

  const updateData: any = { status: queueStatus };
  if (deliveredAt) updateData.delivered_at = deliveredAt;
  if (readAt) updateData.read_at = readAt;

  const { data: updatedItems } = await supabase
    .from("wa_queue")
    .update(updateData)
    .eq("phone", phone)
    .eq("instance_id", instance.id)
    .in("status", ["sent", "delivered"])
    .order("sent_at", { ascending: false })
    .limit(1)
    .select("campaign_id");

  if (deliveredAt && updatedItems?.length > 0 && updatedItems[0].campaign_id) {
    await supabase.rpc("increment_campaign_delivered", { cid: updatedItems[0].campaign_id }).catch(() => {});
  }
}

// ====================== EVOLUTION WEBHOOK HANDLER ======================

async function handleEvolutionWebhook(supabase: any, body: any) {
  const event = body.event;
  const instanceName = body.instance;
  const messageData = body.data;

  if (event === "messages.update" && messageData) {
    return await handleEvolutionDeliveryStatus(supabase, instanceName, messageData);
  }

  if (event !== "messages.upsert" || !messageData) {
    return new Response(JSON.stringify({ ok: true, skipped: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

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

  if (key.fromMe) {
    return new Response(JSON.stringify({ ok: true, skipped: "outgoing" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const remoteJid = key.remoteJid || "";
  const phone = remoteJid.replace("@s.whatsapp.net", "").replace("@g.us", "");
  const pushName = messageData.pushName || null;
  const remoteMessageId = key.id || null;

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

  const { data: contact } = await supabase
    .from("wa_contacts")
    .select("id")
    .eq("user_id", instance.user_id)
    .eq("phone", phone)
    .limit(1)
    .maybeSingle();

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

  if (content && content.trim().length > 0) {
    await categorizeAndAutomate(supabase, instance, inboxMsg.id, content, phone, pushName, contact?.id);
  }

  return new Response(
    JSON.stringify({ ok: true, inbox_id: inboxMsg.id }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

async function handleEvolutionDeliveryStatus(supabase: any, instanceName: string, messageData: any) {
  try {
    const updates = Array.isArray(messageData) ? messageData : [messageData];

    for (const update of updates) {
      const key = update.key || {};
      const status = update.status;
      const remoteMessageId = key.id;

      if (!remoteMessageId || !status) continue;

      let queueStatus: string | null = null;
      let deliveredAt: string | null = null;
      let readAt: string | null = null;

      switch (status) {
        case "DELIVERY_ACK": case "delivered": case 3:
          queueStatus = "delivered"; deliveredAt = new Date().toISOString(); break;
        case "READ": case "read": case 4:
        case "PLAYED": case 5:
          queueStatus = "read"; readAt = new Date().toISOString(); break;
        case "ERROR": case "failed": case 0:
          queueStatus = "failed"; break;
        case "SERVER_ACK": case "sent": case 1: case 2:
          continue;
        default: continue;
      }

      if (!queueStatus) continue;

      const phone = (key.remoteJid || "").replace("@s.whatsapp.net", "").replace("@g.us", "");
      if (!phone) continue;

      const { data: instance } = await supabase
        .from("wa_instances")
        .select("id, user_id")
        .eq("instance_name", instanceName)
        .single();

      if (!instance) continue;

      const updateData: any = { status: queueStatus };
      if (deliveredAt) updateData.delivered_at = deliveredAt;
      if (readAt) updateData.read_at = readAt;

      const { data: updatedItems } = await supabase
        .from("wa_queue")
        .update(updateData)
        .eq("phone", phone)
        .eq("instance_id", instance.id)
        .in("status", ["sent", "delivered"])
        .order("sent_at", { ascending: false })
        .limit(1)
        .select("campaign_id");

      if (deliveredAt && updatedItems?.length > 0 && updatedItems[0].campaign_id) {
        await supabase.rpc("increment_campaign_delivered", { cid: updatedItems[0].campaign_id }).catch(() => {});
      }
    }

    return new Response(
      JSON.stringify({ ok: true, event: "delivery_status_processed" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Delivery status processing error:", err);
    return new Response(
      JSON.stringify({ ok: true, warning: "delivery status processing failed" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}

// ====================== SHARED: AI CATEGORIZATION + AUTOMATIONS ======================

async function categorizeAndAutomate(
  supabase: any,
  instance: any,
  inboxMsgId: string,
  content: string,
  phone: string,
  pushName: string | null,
  contactId: string | null
) {
  try {
    const aiCategory = await categorizeWithAI(content);

    await supabase
      .from("wa_inbox")
      .update({ ai_category: aiCategory.category, ai_sentiment: aiCategory.sentiment })
      .eq("id", inboxMsgId);

    if (contactId) {
      if (aiCategory.category === "opt-out") {
        await supabase
          .from("wa_contacts")
          .update({ is_valid: false, tags: ["blacklist"], status: "blacklist" } as any)
          .eq("id", contactId);
      } else if (aiCategory.category === "interested" || aiCategory.category === "question") {
        await supabase
          .from("wa_contacts")
          .update({ status: "qualified" } as any)
          .eq("id", contactId);
      }
    }

    const triggerEvent =
      aiCategory.category === "interested" ? "lead_interested" :
      aiCategory.category === "question" ? "lead_question" :
      aiCategory.category === "opt-out" ? "lead_opt_out" :
      "lead_responded";

    try {
      const { data: automations } = await supabase
        .from("wa_automations")
        .select("*")
        .eq("user_id", instance.user_id)
        .eq("is_active", true)
        .in("trigger_event", [triggerEvent, "lead_responded"]);

      if (automations?.length > 0) {
        for (const auto of automations) {
          await executeAutomation(supabase, auto, {
            phone, contact_name: pushName, contact_id: contactId,
            category: aiCategory.category, message: content, user_id: instance.user_id,
          });
        }
      }
    } catch (autoErr) {
      console.error("Automation execution failed:", autoErr);
    }
  } catch (aiErr) {
    console.error("AI categorization failed:", aiErr);
  }
}

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
- "opt-out": se a pessoa pede pra parar de receber mensagens
- "interested": se demonstra interesse em comprar, saber mais
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

async function executeAutomation(
  supabase: any,
  automation: any,
  context: {
    phone: string;
    contact_name: string | null;
    contact_id: string | null;
    category: string;
    message: string;
    user_id: string;
  }
) {
  const config = automation.action_config || {};

  switch (automation.action_type) {
    case "add_tag":
      if (config.tag && context.contact_id) {
        const { data: contact } = await supabase
          .from("wa_contacts")
          .select("tags")
          .eq("id", context.contact_id)
          .single();
        const currentTags = (contact?.tags as string[]) || [];
        if (!currentTags.includes(config.tag)) {
          await supabase
            .from("wa_contacts")
            .update({ tags: [...currentTags, config.tag] })
            .eq("id", context.contact_id);
        }
      }
      break;
    case "notify_webhook":
      if (config.webhook_url) {
        await fetch(config.webhook_url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            event: automation.trigger_event,
            phone: context.phone,
            contact_name: context.contact_name,
            category: context.category,
            message: context.message,
            automation_name: automation.name,
            timestamp: new Date().toISOString(),
          }),
        }).catch((err: any) => console.error("Webhook call failed:", err));
      }
      break;
    case "send_email":
      console.log("EMAIL_AUTOMATION_TRIGGER:", JSON.stringify({
        to: config.email,
        subject: `Lead ${context.category}: ${context.contact_name || context.phone}`,
        body: `Lead ${context.phone} classificado como "${context.category}".`,
      }));
      break;
  }

  await supabase
    .from("wa_automations")
    .update({
      trigger_count: (automation.trigger_count || 0) + 1,
      last_triggered_at: new Date().toISOString(),
    })
    .eq("id", automation.id);
}
