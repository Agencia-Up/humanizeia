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
          console.error("Meta inbox insert error:", insertErr);
          continue;
        }

        if (content && content.trim().length > 0) {
          await categorizeAndAutomate(supabase, instance, inboxMsg.id, content, phone, pushName, contact?.id);
        }
      }

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
      return;
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

  // DEBUG: Log full messageData structure to understand LID format
  console.log("[wa-inbox-webhook] Full messageData keys:", JSON.stringify(Object.keys(messageData)));
  console.log("[wa-inbox-webhook] key:", JSON.stringify(key));
  if (messageData.pushName) console.log("[wa-inbox-webhook] pushName:", messageData.pushName);
  if (messageData.participant) console.log("[wa-inbox-webhook] participant:", messageData.participant);
  if (messageData.messageTimestamp) console.log("[wa-inbox-webhook] timestamp:", messageData.messageTimestamp);

  if (key.fromMe) {
    return new Response(JSON.stringify({ ok: true, skipped: "outgoing" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const remoteJid = key.remoteJid || "";
  const remoteJidAlt = key.remoteJidAlt || "";

  // contact phone used for DB/history; replyTarget used to send back via Evolution
  let phone = "";
  let replyTarget = "";

  const toDigits = (value: string) => value.replace(/\D/g, "");

  if (remoteJid.endsWith("@lid")) {
    // Prefer real phone when Evolution provides remoteJidAlt
    if (remoteJidAlt.endsWith("@s.whatsapp.net")) {
      phone = toDigits(remoteJidAlt);
      replyTarget = phone; // send using real phone number
    } else {
      // Fallback: keep LID JID as destination (required for some LID-only contacts)
      phone = toDigits(remoteJid.replace("@lid", ""));
      replyTarget = remoteJid;
      console.warn(`[wa-inbox-webhook] LID without remoteJidAlt for ${remoteJid}; using LID as reply target`);
    }
  } else {
    phone = toDigits(remoteJid);
    replyTarget = phone;
  }

  // Final fallback to avoid empty destination
  if (!phone) phone = toDigits(remoteJidAlt || remoteJid);
  if (!replyTarget) replyTarget = phone;

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
    await categorizeAndAutomate(supabase, instance, inboxMsg.id, content, phone, pushName, contact?.id, replyTarget);
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

// ====================== SHARED: AI CATEGORIZATION + AUTOMATIONS + AI AGENT ======================

async function categorizeAndAutomate(
  supabase: any,
  instance: any,
  inboxMsgId: string,
  content: string,
  phone: string,
  pushName: string | null,
  contactId: string | null,
  replyTarget?: string,
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
          .update({ is_valid: false, tags: ["blacklist"] } as any)
          .eq("id", contactId);
      } else if (aiCategory.category === "interested" || aiCategory.category === "question") {
        const { data: currentContact } = await supabase
          .from("wa_contacts")
          .select("tags")
          .eq("id", contactId)
          .maybeSingle();

        const currentTags = (currentContact?.tags as string[] | null) || [];
        if (!currentTags.includes("qualified")) {
          await supabase
            .from("wa_contacts")
            .update({ tags: [...currentTags, "qualified"] } as any)
            .eq("id", contactId);
        }
      }
    }

    // ===== AI Agent Auto-Reply =====
    await handleAIAgentReply(supabase, instance, content, phone, pushName, aiCategory.category, replyTarget);

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

// ====================== AI AGENT AUTO-REPLY ======================

async function handleAIAgentReply(
  supabase: any,
  instance: any,
  content: string,
  phone: string,
  pushName: string | null,
  category: string,
  replyTarget?: string,
) {
  try {
    // Find active AI agent for this instance or user
    // Supports multi-instance assignment via instance_ids array
    const { data: agents } = await supabase
      .from("wa_ai_agents")
      .select("*")
      .eq("user_id", instance.user_id)
      .eq("is_active", true);

    if (!agents || agents.length === 0) return;

    // Find the best matching agent:
    // 1. Agent with this instance in instance_ids array
    // 2. Agent with instance_id matching this instance
    // 3. Agent with no instances assigned (global)
    const agent = agents.find((a: any) => {
      const ids = a.instance_ids || [];
      return Array.isArray(ids) && ids.length > 0 && ids.includes(instance.id);
    }) || agents.find((a: any) => a.instance_id === instance.id)
       || agents.find((a: any) => {
      const ids = a.instance_ids || [];
      return (!ids || ids.length === 0) && !a.instance_id;
    });

    if (!agent) {
      console.log("[ai-agent] No matching agent for instance:", instance.id);
      return;
    }

    // Check blocked categories
    const blockedCategories = agent.blocked_categories || ["opt-out", "spam"];
    if (blockedCategories.includes(category)) {
      console.log(`[ai-agent] Skipping reply for blocked category: ${category}`);
      return;
    }

    // Check business hours
    if (agent.business_hours_only) {
      const now = new Date();
      const hours = now.getHours();
      const minutes = now.getMinutes();
      const currentTime = hours * 60 + minutes;
      
      const [startH, startM] = (agent.business_hours_start || "08:00").split(":").map(Number);
      const [endH, endM] = (agent.business_hours_end || "18:00").split(":").map(Number);
      const startTime = startH * 60 + startM;
      const endTime = endH * 60 + endM;

      if (currentTime < startTime || currentTime > endTime) {
        console.log("[ai-agent] Outside business hours, skipping");
        return;
      }
    }

    // Fetch conversation history for context
    const { data: history } = await supabase
      .from("wa_inbox")
      .select("direction, content, created_at")
      .eq("user_id", instance.user_id)
      .eq("phone", phone)
      .order("created_at", { ascending: false })
      .limit(10);

    const conversationContext = (history || [])
      .reverse()
      .map((m: any) => `${m.direction === "incoming" ? "Cliente" : "Atendente"}: ${m.content}`)
      .join("\n");

    // Generate AI reply
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      console.error("[ai-agent] LOVABLE_API_KEY not configured");
      return;
    }

    const systemPrompt = agent.system_prompt + `\n\nContexto da conversa:\n${conversationContext}\n\nNome do cliente: ${pushName || "Desconhecido"}`;

    // Map model - stabilize provider compatibility and avoid unsupported params
    const modelMap: Record<string, string> = {
      "google/gemini-3-flash-preview": "google/gemini-2.5-flash",
      "gemini-3-flash-preview": "google/gemini-2.5-flash",
      "openai/gpt-5": "google/gemini-2.5-pro",
      "openai/gpt-5-mini": "google/gemini-2.5-flash",
      "openai/gpt-5-nano": "google/gemini-2.5-flash-lite",
      "openai/gpt-5.2": "google/gemini-2.5-pro",
    };
    const rawModel = agent.model || "google/gemini-2.5-flash";
    const selectedModel = modelMap[rawModel] || rawModel;

    const maxTokensValue = agent.max_tokens || 500;
    const isOpenAI = selectedModel.startsWith("openai/");
    const aiPayload = {
      model: selectedModel,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content },
      ],
      temperature: parseFloat(agent.temperature) || 0.7,
      ...(isOpenAI ? { max_completion_tokens: maxTokensValue } : { max_tokens: maxTokensValue }),
    };

    console.log(`[ai-agent] Calling AI with model: ${selectedModel}`);

    let aiData: any = null;
    const modelsToTry = [selectedModel, "google/gemini-2.5-flash"];
    const uniqueModels = [...new Set(modelsToTry)];

    for (const model of uniqueModels) {
      // Adjust token param based on model provider
      const isModelOpenAI = model.startsWith("openai/");
      const { max_tokens, max_completion_tokens, ...basePayload } = aiPayload as any;
      const tokenParam = isModelOpenAI
        ? { max_completion_tokens: max_completion_tokens || max_tokens || 500 }
        : { max_tokens: max_tokens || max_completion_tokens || 500 };

      const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ...basePayload, ...tokenParam, model }),
      });

      if (res.ok) {
        aiData = await res.json();
        break;
      }

      const errBody = await res.text().catch(() => "");
      console.error(`[ai-agent] AI error with model ${model}: ${res.status} - ${errBody}`);
    }

    if (!aiData) {
      console.error("[ai-agent] All AI models failed");
      return;
    }

    const replyText = aiData.choices?.[0]?.message?.content?.trim();

    if (!replyText) {
      console.log("[ai-agent] Empty AI response, skipping");
      return;
    }

    // Simulate typing delay
    const delay = agent.reply_delay_ms || 3000;
    await new Promise(resolve => setTimeout(resolve, Math.min(delay, 10000)));

    // Send the reply via Evolution API
    const evolutionApiUrl = Deno.env.get("EVOLUTION_API_URL");
    const evolutionApiKey = Deno.env.get("EVOLUTION_API_KEY");

    // Get instance details for sending
    const { data: instanceData } = await supabase
      .from("wa_instances")
      .select("instance_name, provider, api_url, api_key_encrypted")
      .eq("id", instance.id)
      .single();

    if (!instanceData) return;

    let sendSuccess = false;

    if (instanceData.provider === "evolution") {
      const apiUrl = (evolutionApiUrl || instanceData.api_url).replace(/\/+$/, "");
      const apiKey = evolutionApiKey || instanceData.api_key_encrypted;

      const destination = replyTarget || phone;
      console.log(`[ai-agent] Sending reply to destination: ${destination}`);

      const sendRes = await fetch(`${apiUrl}/message/sendText/${instanceData.instance_name}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: apiKey,
        },
        body: JSON.stringify({ number: destination, text: replyText }),
      });

      sendSuccess = sendRes.ok;
      if (!sendSuccess) {
        const errText = await sendRes.text();
        console.error(`[ai-agent] Evolution send error: ${sendRes.status} - ${errText}`);
      }
    } else if (instanceData.provider === "meta") {
      // Meta API send
      const metaConfig = instanceData.meta_config || {};
      const phoneNumberId = metaConfig.phone_number_id;
      const accessToken = metaConfig.access_token_encrypted || instanceData.api_key_encrypted;

      if (phoneNumberId && accessToken) {
        const sendRes = await fetch(
          `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              messaging_product: "whatsapp",
              to: phone,
              type: "text",
              text: { body: replyText },
            }),
          }
        );
        sendSuccess = sendRes.ok;
      }
    }

    if (sendSuccess) {
      // Save outgoing message to inbox
      await supabase.from("wa_inbox").insert({
        user_id: instance.user_id,
        instance_id: instance.id,
        phone,
        direction: "outgoing",
        message_type: "text",
        content: replyText,
        is_read: true,
        contact_name: pushName,
      });

      // Increment agent reply count
      await supabase
        .from("wa_ai_agents")
        .update({ total_replies: (agent.total_replies || 0) + 1, updated_at: new Date().toISOString() })
        .eq("id", agent.id);

      console.log(`[ai-agent] Reply sent to ${phone}: ${replyText.substring(0, 50)}...`);
    }
  } catch (err) {
    console.error("[ai-agent] Auto-reply error:", err);
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
