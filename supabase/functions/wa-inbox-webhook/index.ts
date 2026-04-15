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
          console.log(`[wa-inbox-webhook] Audio message detected from Meta. audioId: ${msg.audio?.id}`);
          const audioId = msg.audio?.id;
          if (audioId) {
            try {
              const transcription = await transcribeAudioFromMeta(supabase, instance, audioId);
              if (transcription) {
                content = transcription;
                console.log(`[wa-inbox-webhook] Meta audio transcribed: ${content.substring(0, 80)}`);
              } else {
                content = "[Mensagem de áudio recebida]";
                console.warn("[wa-inbox-webhook] Meta audio transcription returned null");
              }
            } catch (transcErr) {
              content = "[Mensagem de áudio recebida]";
              console.error("[wa-inbox-webhook] Meta audio transcription error:", transcErr);
            }
          } else {
            content = "[Mensagem de áudio recebida]";
          }
        } else if (msg.type === "document") {
          messageType = "document";
          const fileName = msg.document?.filename || "Arquivo";
          content = `[Arquivo recebido: ${fileName}]`;
        } else if (msg.type === "sticker") {
          messageType = "sticker";
        }

        // ===== Extract UTMs/fbclid from Meta referral or message text =====
        const referral = msg.referral || value.referral || null;
        const utmParams = extractUTMParams(content, referral);

        const { data: contact } = await supabase
          .from("wa_contacts")
          .select("id")
          .eq("user_id", instance.user_id)
          .eq("phone", phone)
          .limit(1)
          .maybeSingle();

        // Update contact with UTM data if available
        if (contact?.id && Object.keys(utmParams).length > 0) {
          await supabase
            .from("wa_contacts")
            .update(utmParams)
            .eq("id", contact.id);
          console.log(`[utm-extract] Updated contact ${phone} with:`, Object.keys(utmParams));
        }

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

  await updateQueueStatusFromDeliverySignal(supabase, {
    instanceId: instance.id,
    userId: instance.user_id,
    phone,
    remoteMessageId: status.id || null,
    queueStatus,
    deliveredAt,
    readAt,
  });
}

// ====================== EVOLUTION WEBHOOK HANDLER ======================

async function handleEvolutionWebhook(supabase: any, body: any) {
  const event = body.event;
  const normalizedEvent = String(event || "").toLowerCase().replace(/_/g, ".");
  const instanceName = body.instance;
  const messageData = body.data;

  if (normalizedEvent === "messages.update" && messageData) {
    return await handleEvolutionDeliveryStatus(supabase, instanceName, messageData);
  }

  if (normalizedEvent !== "messages.upsert" || !messageData) {
    return new Response(JSON.stringify({ ok: true, skipped: true, event }), {
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
  } else if (message.buttonsResponseMessage) {
    // Interactive button response
    messageType = "text";
    content = message.buttonsResponseMessage.selectedDisplayText || 
              message.buttonsResponseMessage.selectedButtonId || "";
  } else if (message.listResponseMessage) {
    messageType = "text";
    content = message.listResponseMessage.title || message.listResponseMessage.singleSelectReply?.selectedRowId || "";
  } else if (message.templateButtonReplyMessage) {
    messageType = "text";
    content = message.templateButtonReplyMessage.selectedDisplayText || 
              message.templateButtonReplyMessage.selectedId || "";
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
    console.log(`[wa-inbox-webhook] Audio message detected from Evolution. mediaUrl: ${mediaUrl}, mimetype: ${message.audioMessage.mimetype}`);
    // Transcribe audio to text
    try {
      const transcription = await transcribeAudioFromEvolution(supabase, instance, messageData, instanceName);
      if (transcription) {
        content = transcription;
        console.log(`[wa-inbox-webhook] Audio transcribed successfully: ${content.substring(0, 80)}`);
      } else {
        content = "[Mensagem de áudio recebida]";
        console.warn("[wa-inbox-webhook] Audio transcription returned null, using fallback content");
      }
    } catch (transcErr) {
      content = "[Mensagem de áudio recebida]";
      console.error("[wa-inbox-webhook] Audio transcription threw error:", transcErr);
    }
  } else if (message.documentMessage) {
    messageType = "document";
    const fileName = message.documentMessage.fileName || "Arquivo";
    content = `[Arquivo recebido: ${fileName}]`;
    mediaUrl = message.documentMessage.url || null;
  } else if (message.stickerMessage) {
    messageType = "sticker";
  }

    // ===== Extract UTMs/fbclid from Evolution message text =====
    const utmParams = extractUTMParams(content, null);

    const { data: contact } = await supabase
      .from("wa_contacts")
      .select("id")
      .eq("user_id", instance.user_id)
      .eq("phone", phone)
      .limit(1)
      .maybeSingle();

    // Update contact with UTM data if available
    if (contact?.id && Object.keys(utmParams).length > 0) {
      await supabase
        .from("wa_contacts")
        .update(utmParams)
        .eq("id", contact.id);
      console.log(`[utm-extract] Updated contact ${phone} with:`, Object.keys(utmParams));
    }

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

    const { data: instance } = await supabase
      .from("wa_instances")
      .select("id, user_id")
      .eq("instance_name", instanceName)
      .single();

    if (!instance) {
      return new Response(
        JSON.stringify({ ok: true, warning: "instance_not_found" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    for (const update of updates) {
      const key = update.key || {};
      const statusRaw = update.status;
      const statusNormalized = String(statusRaw ?? "").toLowerCase();
      const remoteMessageId = key.id || update.id || update.messageId || null;

      let queueStatus: string | null = null;
      let deliveredAt: string | null = null;
      let readAt: string | null = null;

      if (statusRaw === 3 || statusNormalized === "delivered" || statusNormalized === "delivery_ack") {
        queueStatus = "delivered";
        deliveredAt = new Date().toISOString();
      } else if (
        statusRaw === 4 ||
        statusRaw === 5 ||
        statusNormalized === "read" ||
        statusNormalized === "played"
      ) {
        queueStatus = "read";
        readAt = new Date().toISOString();
      } else if (statusRaw === 0 || statusNormalized === "error" || statusNormalized === "failed") {
        queueStatus = "failed";
      } else {
        // Ignore server ACK / sent
        continue;
      }

      if (!queueStatus) continue;

      const phone = normalizePhone(key.remoteJid || key.remoteJidAlt || update.recipient || "");

      await updateQueueStatusFromDeliverySignal(supabase, {
        instanceId: instance.id,
        userId: instance.user_id,
        phone,
        remoteMessageId,
        queueStatus,
        deliveredAt,
        readAt,
      });
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

function normalizePhone(value: string | null | undefined): string {
  return (value || "").replace(/\D/g, "");
}

async function updateQueueStatusFromDeliverySignal(
  supabase: any,
  params: {
    instanceId: string;
    userId: string;
    phone: string | null | undefined;
    remoteMessageId: string | null;
    queueStatus: string;
    deliveredAt: string | null;
    readAt: string | null;
  }
) {
  const { instanceId, userId, phone, remoteMessageId, queueStatus, deliveredAt, readAt } = params;

  const updateData: any = { status: queueStatus };
  if (deliveredAt) {
    updateData.delivered_at = deliveredAt;
    updateData.delivery_confirmed_at = deliveredAt;
  }
  if (readAt) {
    updateData.read_at = readAt;
    if (!updateData.delivery_confirmed_at) {
      updateData.delivery_confirmed_at = readAt;
    }
  }

  let matchedPhone = normalizePhone(phone);
  let matchedCampaignId: string | null = null;
  let matchedCreatedAt: string | null = null;

  if (remoteMessageId) {
    const { data: outMsg } = await supabase
      .from("wa_inbox")
      .select("phone, campaign_id, created_at")
      .eq("user_id", userId)
      .eq("instance_id", instanceId)
      .eq("direction", "outgoing")
      .eq("remote_message_id", remoteMessageId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (outMsg) {
      matchedPhone = normalizePhone(outMsg.phone);
      matchedCampaignId = outMsg.campaign_id || null;
      matchedCreatedAt = outMsg.created_at || null;
    }
  }

  let query = supabase
    .from("wa_queue")
    .update(updateData)
    .eq("instance_id", instanceId)
    .in("status", ["sent", "delivered"]);

  if (matchedPhone) {
    query = query.eq("phone", matchedPhone);
  }

  if (matchedCampaignId) {
    query = query.eq("campaign_id", matchedCampaignId);
  }

  if (matchedCreatedAt) {
    const matchedAtMs = new Date(matchedCreatedAt).getTime();
    const lowerBound = new Date(matchedAtMs - 6 * 60 * 60 * 1000).toISOString();
    const upperBound = new Date(matchedAtMs + 15 * 60 * 1000).toISOString();
    query = query.gte("sent_at", lowerBound).lte("sent_at", upperBound);
  }

  const { data: updatedItems } = await query
    .order("sent_at", { ascending: false })
    .limit(1)
    .select("campaign_id");

  const campaignId = updatedItems?.[0]?.campaign_id || matchedCampaignId;
  if (deliveredAt && campaignId) {
    await supabase.rpc("increment_campaign_delivered", { cid: campaignId }).catch(() => {});
  }

  // ===== SHADOW BAN DETECTION: Reset consecutive_undelivered on confirmed delivery =====
  if (queueStatus === "delivered" || queueStatus === "read") {
    await supabase
      .from("wa_instances")
      .update({ consecutive_undelivered: 0, shadow_ban_suspect: false })
      .eq("id", instanceId);
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
    // ===== Check for opt-in/opt-out button responses first =====
    const lowerContent = content.toLowerCase().trim();
    const isOptoutButton = lowerContent.includes("não quero mais receber") ||
      lowerContent.includes("optout_stop") ||
      lowerContent === "❌ não quero mais receber";
    const isOptinButton = lowerContent.includes("quero continuar recebendo") ||
      lowerContent.includes("optout_continue") ||
      lowerContent === "✅ quero continuar recebendo";

    if (isOptoutButton && contactId) {
      // Move to blacklist
      await supabase
        .from("wa_contacts")
        .update({ is_valid: false, tags: ["blacklist", "opt-out"] } as any)
        .eq("id", contactId);

      // Send confirmation message
      await sendOptoutConfirmation(supabase, instance, phone, replyTarget);

      await supabase
        .from("wa_inbox")
        .update({ ai_category: "opt-out", ai_sentiment: "negative" })
        .eq("id", inboxMsgId);

      console.log(`[opt-out] Contact ${phone} moved to blacklist`);
      return;
    }

    if (isOptinButton && contactId) {
      // Mark as engaged
      const { data: currentContact } = await supabase
        .from("wa_contacts")
        .select("tags")
        .eq("id", contactId)
        .maybeSingle();

      const currentTags = (currentContact?.tags as string[] | null) || [];
      const newTags = [...currentTags.filter(t => t !== "blacklist" && t !== "opt-out")];
      if (!newTags.includes("opt-in")) newTags.push("opt-in");
      if (!newTags.includes("engaged")) newTags.push("engaged");

      await supabase
        .from("wa_contacts")
        .update({ is_valid: true, tags: newTags } as any)
        .eq("id", contactId);

      // Send confirmation
      await sendOptinConfirmation(supabase, instance, phone, replyTarget);

      await supabase
        .from("wa_inbox")
        .update({ ai_category: "interested", ai_sentiment: "positive" })
        .eq("id", inboxMsgId);

      console.log(`[opt-in] Contact ${phone} confirmed engagement`);
      return;
    }

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

    // ===== Campaign Auto-Tag & Auto-Reply =====
    await handleCampaignAutoReply(supabase, instance, phone, contactId, replyTarget);

    // ===== AI Agent Auto-Reply =====
    await handleAIAgentReply(supabase, instance, content, phone, pushName, aiCategory.category, replyTarget);

    // ===== CAPI Full-Funnel Tracking =====
    if (aiCategory.category === "interested" || aiCategory.category === "question") {
      // Stage 1: Lead event (first meaningful contact)
      await sendCAPIEvent(supabase, instance.user_id, phone, "Lead", {
        lead_category: aiCategory.category,
        source: "whatsapp",
      });
    }

    if (aiCategory.category === "interested") {
      // Stage 2: Qualified Lead (contact shows buying intent)
      await sendCAPIEvent(supabase, instance.user_id, phone, "CompleteRegistration", {
        lead_category: "qualified",
        source: "whatsapp",
        status: "qualified",
      });
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

// ====================== CAMPAIGN AUTO-TAG & AUTO-REPLY ======================

async function handleCampaignAutoReply(
  supabase: any,
  instance: any,
  phone: string,
  contactId: string | null,
  replyTarget?: string,
) {
  try {
    // Find recent campaigns that sent to this phone number (last 30 days)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const { data: queueItems } = await supabase
      .from("wa_queue")
      .select("campaign_id")
      .eq("phone", phone)
      .eq("user_id", instance.user_id)
      .in("status", ["sent", "delivered", "read"])
      .gte("sent_at", thirtyDaysAgo)
      .order("sent_at", { ascending: false })
      .limit(5);

    if (!queueItems || queueItems.length === 0) return;

    // Get unique campaign IDs
    const campaignIds = [...new Set(queueItems.map((q: any) => q.campaign_id).filter(Boolean))];
    if (campaignIds.length === 0) return;

    // Fetch campaigns with auto-tag or auto-reply configured
    const { data: campaigns } = await supabase
      .from("wa_campaigns")
      .select("id, reply_auto_tag, reply_auto_message")
      .in("id", campaignIds)
      .or("reply_auto_tag.neq.,reply_auto_message.neq.");

    if (!campaigns || campaigns.length === 0) return;

    // Track if we already sent an auto-reply to avoid duplicates
    let autoReplySent = false;

    for (const campaign of campaigns) {
      // ===== Auto-Tag =====
      if (campaign.reply_auto_tag && contactId) {
        const { data: currentContact } = await supabase
          .from("wa_contacts")
          .select("tags")
          .eq("id", contactId)
          .maybeSingle();

        const currentTags: string[] = (currentContact?.tags as string[] | null) || [];
        const newTag = campaign.reply_auto_tag.trim();
        if (!currentTags.includes(newTag)) {
          await supabase
            .from("wa_contacts")
            .update({ tags: [...currentTags, newTag] } as any)
            .eq("id", contactId);
          console.log(`[campaign-auto-tag] Added tag "${newTag}" to contact ${phone} (campaign ${campaign.id})`);
        }
      }

      // ===== Auto-Reply (send only once, from the most recent campaign) =====
      if (campaign.reply_auto_message && !autoReplySent) {
        // Check if we already sent an auto-reply for this campaign to this phone
        const { data: existingReply } = await supabase
          .from("wa_inbox")
          .select("id")
          .eq("user_id", instance.user_id)
          .eq("phone", phone)
          .eq("direction", "outgoing")
          .eq("campaign_id", campaign.id)
          .ilike("content", campaign.reply_auto_message.substring(0, 50) + "%")
          .limit(1);

        if (existingReply && existingReply.length > 0) {
          console.log(`[campaign-auto-reply] Already sent auto-reply to ${phone} for campaign ${campaign.id}`);
          continue;
        }

        // Send the auto-reply message
        const destination = replyTarget || phone;
        await sendAutoReplyMessage(supabase, instance, destination, campaign.reply_auto_message, campaign.id, phone);
        autoReplySent = true;
        console.log(`[campaign-auto-reply] Sent follow-up to ${phone} for campaign ${campaign.id}`);
      }
    }
  } catch (err) {
    console.error("[campaign-auto-reply] Error:", err);
  }
}

async function sendAutoReplyMessage(
  supabase: any,
  instance: any,
  destination: string,
  message: string,
  campaignId: string,
  phone: string,
) {
  try {
    // Get instance details for sending
    const { data: inst } = await supabase
      .from("wa_instances")
      .select("instance_name, provider, meta_config")
      .eq("id", instance.id)
      .single();

    if (!inst) return;

    if (inst.provider === "meta") {
      // Send via Meta API
      const metaConfig = inst.meta_config || {};
      const accessToken = metaConfig.access_token;
      const phoneNumberId = metaConfig.phone_number_id;
      if (!accessToken || !phoneNumberId) return;

      await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: phone,
          type: "text",
          text: { body: message },
        }),
      });
    } else {
      // Send via Evolution API
      const EVOLUTION_API_URL = Deno.env.get("EVOLUTION_API_URL");
      const EVOLUTION_API_KEY = Deno.env.get("EVOLUTION_API_KEY");
      if (!EVOLUTION_API_URL || !EVOLUTION_API_KEY) return;

      const isJid = destination.includes("@");
      const sendPayload: any = { text: message };
      if (isJid) {
        sendPayload.number = destination;
      } else {
        sendPayload.number = destination;
      }

      await fetch(`${EVOLUTION_API_URL}/message/sendText/${inst.instance_name}`, {
        method: "POST",
        headers: { "apikey": EVOLUTION_API_KEY, "Content-Type": "application/json" },
        body: JSON.stringify(sendPayload),
      });
    }

    // Save to inbox
    await supabase.from("wa_inbox").insert({
      user_id: instance.user_id,
      instance_id: instance.id,
      phone,
      direction: "outgoing",
      message_type: "text",
      content: message,
      campaign_id: campaignId,
      is_read: true,
    });
  } catch (err) {
    console.error("[sendAutoReplyMessage] Error:", err);
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

    // Fetch conversation history for context (more messages = better context)
    const { data: history } = await supabase
      .from("wa_inbox")
      .select("direction, content, created_at, message_type")
      .eq("user_id", instance.user_id)
      .eq("phone", phone)
      .order("created_at", { ascending: false })
      .limit(20);

    // Build conversation as proper alternating messages for better AI context
    const historyMessages = (history || [])
      .reverse()
      .filter((m: any) => m.content && m.content.trim())
      .map((m: any) => ({
        role: m.direction === "incoming" ? "user" as const : "assistant" as const,
        content: m.content,
      }));

    // Fetch recent AI replies to avoid repetition (deduplication)
    const recentReplies = (history || [])
      .filter((m: any) => m.direction === "outgoing")
      .slice(0, 8)
      .map((m: any) => m.content?.trim().toLowerCase() || "");

    // Generate AI reply
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");

    const rawModel = agent.model || "google/gemini-2.5-flash";
    const isAnthropicModel = rawModel.startsWith("anthropic/");

    if (!isAnthropicModel && !LOVABLE_API_KEY) {
      console.error("[ai-agent] LOVABLE_API_KEY not configured");
      return;
    }
    if (isAnthropicModel && !ANTHROPIC_API_KEY) {
      console.error("[ai-agent] ANTHROPIC_API_KEY not configured for Anthropic model");
      return;
    }

    const humanizationRules = `

REGRAS AVANÇADAS DE HUMANIZAÇÃO (PRIORIDADE MÁXIMA):

🎭 PERSONA:
- Você é uma PESSOA REAL, não um chatbot. Nunca diga "sou uma IA" ou "como assistente virtual"
- Tenha personalidade: seja caloroso, genuíno, autêntico
- Responda como alguém que realmente se importa com o cliente

💬 ESTILO DE ESCRITA (WhatsApp real):
- Escreva EXATAMENTE como uma pessoa digita no WhatsApp: frases curtas, informais, diretas
- Use letras minúsculas quando natural (ex: "oi", "beleza", "show")
- Abreviações naturais quando o tom permitir: "vc", "tb", "pq", "blz", "msg"
- Máximo 3 linhas por mensagem — quebre em blocos se precisar explicar algo longo
- NUNCA use formatação markdown (**negrito**, *itálico*, listas com •)
- NUNCA use cabeçalhos, bullets ou formatação de documento

🎲 VARIAÇÃO OBRIGATÓRIA:
- NUNCA comece duas mensagens consecutivas da mesma forma
- Alterne entre estilos: às vezes comece respondendo direto, às vezes com uma interjeição
- Interjeições naturais: "Ahh", "Hmm", "Poxa", "Eita", "Show", "Massa", "Boa", "Olha só"
- Evite SEMPRE: "Olá! Como posso ajudar?", "Estou aqui para ajudar", "Claro!", "Com certeza!"
- Se já usou "oi" na última resposta, use outra coisa agora
- Varie cumprimentos: "E aí", "Fala", "Opa", "Eii", "Oi oi"

🧠 CONSCIÊNCIA CONTEXTUAL:
- Leia TODO o histórico antes de responder
- Referencie coisas que o cliente disse antes naturalmente
- Se o cliente já perguntou algo, não peça de novo
- Adapte seu tom ao tom do cliente: formal → formal, descontraído → descontraído
- Se o cliente mandou áudio (transcrito), responda naturalmente como se tivesse ouvido

😊 EMPATIA REAL:
- Valide sentimentos: "Entendo sua preocupação", "faz total sentido"
- Se o cliente está frustrado, reconheça antes de resolver
- Comemore conquistas do cliente: "Que legal!", "Show demais!"
- Use humor leve quando apropriado

⚠️ ANTI-ROBÔ (evite a todo custo):
- Nunca liste benefícios com bullets ou numeração
- Nunca use "Espero ter ajudado!" ou "Fico à disposição!"
- Nunca responda com parágrafos longos e estruturados
- Nunca use linguagem corporativa engessada
- Nunca repita o nome do cliente em toda mensagem
- Se precisar listar algo, faça de forma conversacional: "tem o plano X que custa Y, e tem também o Z que..."

[REGRAS DE CONDUTA ANTE MÍDIAS E ARQUIVOS]
- Se o usuário enviar uma Imagem (será indicado com "[Imagem recebida]"), análise com precisão fotográfica se conseguir visualizar o anexo no seu array.
- Se o usuário enviar Áudio, a transcrição é entregue como texto direto para você interpretar, lide naturalmente como se tivesse ouvido.
- Se o usuário anexar Documentos/PDFs (indicado com "[Arquivo recebido: <nome>]"), VOCÊ NÃO PODE ABRIR ARQUIVOS e NÃO DEVE INVENTAR DADOS. Responda educadamente sem fugir do personagem: informe que a plataforma limitou sua visão ou que não consegue abrir documentos, sugerindo que o cliente resuma o que há no arquivo ou envie as dúvidas em áudio/texto. Nunca dê respostas genéricas e nunca ofereça "mais informações" se não sabe o conteúdo.

RESPOSTAS ANTERIORES DO AGENTE (para NÃO repetir frases/aberturas):
${recentReplies.slice(0, 5).map((r, i) => `[${i+1}]: ${r.substring(0, 80)}`).join("\n")}
Gere uma resposta DIFERENTE de todas as anteriores em estrutura, abertura e vocabulário.
`;

    const clientName = pushName || null;
    const nameInstruction = clientName 
      ? `\nNome do cliente: ${clientName} (use o nome com moderação, não em toda mensagem)`
      : `\nNome do cliente: desconhecido (não pergunte o nome a menos que seja necessário para o atendimento)`;

    const crmToolInstruction = `

FERRAMENTA DE CRM - QUALIFICAÇÃO DE LEADS:
Você tem acesso a uma ferramenta chamada "atualizar_etapa_crm" que deve ser usada para classificar o status do lead durante a conversa.

USE esta ferramenta quando:
- O cliente demonstrar interesse real no produto/serviço → status: "interessado"
- O cliente pedir preço, condições, ou quiser avançar → status: "qualificado"  
- O cliente disser que não tem interesse → status: "encerrado"
- No início da conversa → status: "novo"

IMPORTANTE: Quando o status for "qualificado", você DEVE:
1. Chamar a ferramenta com status "qualificado" e um resumo detalhado da conversa
2. O resumo deve incluir: nome do cliente, o que ele procura, principais dúvidas, orçamento mencionado, e qualquer informação relevante
3. Após qualificar, responda ao cliente informando que um especialista vai entrar em contato
`;

    const systemPrompt = agent.system_prompt + "\n" + humanizationRules + nameInstruction + crmToolInstruction;

    // CRM Tool definition for function calling
    const crmTools = [
      {
        type: "function",
        function: {
          name: "atualizar_etapa_crm",
          description: "Atualiza o status do lead no CRM e registra um resumo da conversa. Use quando identificar mudança de etapa do cliente.",
          parameters: {
            type: "object",
            properties: {
              status: {
                type: "string",
                enum: ["novo", "interessado", "qualificado", "encerrado"],
                description: "Status atual do lead baseado na conversa"
              },
              resumo: {
                type: "string",
                description: "Resumo detalhado da conversa com o cliente incluindo: nome, interesse, dúvidas, orçamento, e informações captadas"
              }
            },
            required: ["status", "resumo"],
            additionalProperties: false
          }
        }
      }
    ];

    const maxTokensValue = agent.max_tokens || 500;
    const effectiveTemp = Math.max(parseFloat(agent.temperature) || 0.7, 0.75);

    let aiData: any = null;

    if (isAnthropicModel) {
      // ── Direct Anthropic API call ──
      const anthropicModel = rawModel.replace("anthropic/", "");
      const anthropicMessages = [
        ...historyMessages.slice(-14).map((m: any) => ({
          role: m.role === "system" ? "user" : m.role,
          content: m.content,
        })),
        { role: "user", content },
      ];

      console.log(`[ai-agent] Calling Anthropic directly with model: ${anthropicModel}`);

      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": ANTHROPIC_API_KEY!,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: anthropicModel,
          system: systemPrompt,
          messages: anthropicMessages,
          max_tokens: maxTokensValue,
          temperature: effectiveTemp,
        }),
      });

      if (res.ok) {
        const anthropicData = await res.json();
        // Normalize to OpenAI-like format
        aiData = {
          choices: [{
            message: {
              content: anthropicData.content?.[0]?.text || "",
            },
          }],
        };
      } else {
        const errBody = await res.text().catch(() => "");
        console.error(`[ai-agent] Anthropic error: ${res.status} - ${errBody}`);
      }
    } else {
      // ── Lovable AI Gateway call ──
      const modelMap: Record<string, string> = {
        "google/gemini-3-flash-preview": "google/gemini-2.5-flash",
        "gemini-3-flash-preview": "google/gemini-2.5-flash",
        "openai/gpt-5": "google/gemini-2.5-pro",
        "openai/gpt-5-mini": "google/gemini-2.5-flash",
        "openai/gpt-5-nano": "google/gemini-2.5-flash-lite",
        "openai/gpt-5.2": "google/gemini-2.5-pro",
      };
      const selectedModel = modelMap[rawModel] || rawModel;
      const isOpenAI = selectedModel.startsWith("openai/");

      const aiMessages = [
        { role: "system", content: systemPrompt },
        ...historyMessages.slice(-14),
        { role: "user", content },
      ];

      const aiPayload: any = {
        model: selectedModel,
        messages: aiMessages,
        temperature: effectiveTemp,
        tools: crmTools,
        tool_choice: "auto",
        ...(isOpenAI ? { max_completion_tokens: maxTokensValue } : { max_tokens: maxTokensValue }),
      };

      console.log(`[ai-agent] Calling AI Gateway with model: ${selectedModel}, history: ${historyMessages.length} msgs`);

      const modelsToTry = [selectedModel, "google/gemini-2.5-flash"];
      const uniqueModels = [...new Set(modelsToTry)];

      for (const model of uniqueModels) {
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
    }

    if (!aiData) {
      console.error("[ai-agent] All AI models failed");
      return;
    }

    let replyText = aiData.choices?.[0]?.message?.content?.trim() || "";
    const aiMessage = aiData.choices?.[0]?.message;

    // ===== Handle CRM Tool Calls (Lead Qualification & Transfer) =====
    if (aiMessage?.tool_calls && aiMessage.tool_calls.length > 0) {
      const toolCall = aiMessage.tool_calls.find((t: any) => t.function?.name === "atualizar_etapa_crm");
      if (toolCall) {
        try {
          const args = JSON.parse(toolCall.function.arguments);
          console.log(`[ai-agent-crm] Lead ${phone} → status: ${args.status}`);

          // Update CRM lead status
          const { data: existingLead } = await supabase
            .from("ai_crm_leads")
            .select("id")
            .eq("agent_id", agent.id)
            .eq("remote_jid", phone)
            .maybeSingle();

          if (existingLead) {
            await supabase.from("ai_crm_leads").update({
              status: args.status,
              summary: args.resumo,
              last_interaction_at: new Date().toISOString(),
            }).eq("id", existingLead.id);
          } else {
            await supabase.from("ai_crm_leads").insert({
              user_id: instance.user_id,
              agent_id: agent.id,
              instance_id: instance.id,
              remote_jid: phone,
              lead_name: pushName || phone,
              status: args.status,
              summary: args.resumo,
              last_interaction_at: new Date().toISOString(),
            });
          }

          // ===== TRANSFER TO SELLER (Round-Robin) when QUALIFICADO =====
          if (args.status === "qualificado") {
            await transferLeadToSeller(supabase, instance, agent, phone, pushName, args.resumo, historyMessages);
          }

          // If AI only called tool without text, request a follow-up response
          if (!replyText) {
            console.log("[ai-agent-crm] No text response, requesting follow-up...");
            // Make a second call to get the text response
            const followUpMessages = [
              { role: "system", content: systemPrompt },
              ...historyMessages.slice(-14),
              { role: "user", content },
              aiMessage,
              { role: "tool", tool_call_id: toolCall.id, content: JSON.stringify({ success: true, status: args.status }) },
            ];

            const followUpRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
              method: "POST",
              headers: {
                Authorization: `Bearer ${LOVABLE_API_KEY}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                model: "google/gemini-2.5-flash",
                messages: followUpMessages,
                temperature: effectiveTemp,
                max_tokens: maxTokensValue,
              }),
            });

            if (followUpRes.ok) {
              const followUpData = await followUpRes.json();
              replyText = followUpData.choices?.[0]?.message?.content?.trim() || "";
            }
          }
        } catch (err) {
          console.error("[ai-agent-crm] Tool call processing error:", err);
        }
      }
    }

    if (!replyText) {
      console.log("[ai-agent] Empty AI response, skipping");
      return;
    }

    // Post-process: clean up any markdown formatting the AI might add
    replyText = replyText
      .replace(/\*\*(.*?)\*\*/g, "$1")  // Remove **bold**
      .replace(/\*(.*?)\*/g, "$1")      // Remove *italic*
      .replace(/^[-•]\s/gm, "")         // Remove bullet points
      .replace(/^\d+\.\s/gm, "")        // Remove numbered lists
      .replace(/^#+\s/gm, "")           // Remove headers
      .trim();

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

      // ===== Forward to n8n webhook if configured =====
      if (agent.n8n_webhook_url) {
        try {
          const webhookPayload = {
            event: "ai_agent_reply",
            agent_id: agent.id,
            agent_name: agent.name,
            agent_type: agent.agent_type || "generic",
            company_name: agent.company_name || "",
            services: agent.services || "",
            phone,
            contact_name: pushName,
            contact_id: contactId,
            incoming_message: content,
            ai_reply: replyText,
            category,
            instance_id: instance.id,
            user_id: instance.user_id,
            timestamp: new Date().toISOString(),
          };

          const n8nRes = await fetch(agent.n8n_webhook_url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(webhookPayload),
          });

          console.log(`[ai-agent] n8n webhook response: ${n8nRes.status}`);
        } catch (n8nErr) {
          console.error("[ai-agent] n8n webhook error:", n8nErr);
        }
      }
    }
  } catch (err) {
    console.error("[ai-agent] Auto-reply error:", err);
  }
}

// ====================== LEAD TRANSFER TO SELLER (Round-Robin) ======================

async function transferLeadToSeller(
  supabase: any,
  instance: any,
  agent: any,
  phone: string,
  pushName: string | null,
  summary: string,
  historyMessages: { role: string; content: string }[],
) {
  try {
    // 1. Get active sellers for this agent
    const { data: sellers } = await supabase
      .from("ai_team_members")
      .select("*")
      .eq("agent_id", agent.id)
      .eq("is_active", true)
      .order("last_lead_received_at", { ascending: true, nullsFirst: true });

    if (!sellers || sellers.length === 0) {
      console.log("[transfer] No active sellers found for agent:", agent.id);
      return;
    }

    // 1.5. Prevent Duplicate Transfers via Concurrency Hook
    const { data: existingLead } = await supabase
      .from("ai_crm_leads")
      .select("status, assigned_to_member_id")
      .eq("agent_id", agent.id)
      .eq("remote_jid", phone)
      .maybeSingle();

    if (existingLead && existingLead.assigned_to_member_id) {
       console.log(`[transfer] Lead ${phone} already assigned to member ${existingLead.assigned_to_member_id}. Aborting duplicate broadcast.`);
       return;
    }

    // 2. Round-Robin: pick seller with fewest leads OR oldest last_lead_received_at
    const selectedSeller = sellers[0]; // Already sorted by last_lead_received_at ASC (oldest first)
    console.log(`[transfer] Selected seller: ${selectedSeller.name} (${selectedSeller.whatsapp_number})`);

    // 3. Build detailed conversation summary for the seller
    const conversationText = historyMessages
      .slice(-10)
      .map((m) => `${m.role === "user" ? "Cliente" : "Agente IA"}: ${m.content}`)
      .join("\n");

    const sellerMsg = `🚨 *LEAD QUALIFICADO - ATENDIMENTO IMEDIATO*

👤 *Nome do Cliente:* ${pushName || "Não informado"}
📱 *Contato:* ${phone}
🤖 *Agente IA:* ${agent.name}
🏢 *Empresa:* ${agent.company_name || "—"}

━━━━━━━━━━━━━━━━━━━━

📝 *Resumo do Atendimento pela IA:*
${summary}

━━━━━━━━━━━━━━━━━━━━

💬 *Últimas mensagens da conversa:*
${conversationText}

━━━━━━━━━━━━━━━━━━━━

👉 *Atender agora:* https://wa.me/${phone.replace(/\D/g, "")}

⚡ O cliente está esperando! Ele já foi informado que um especialista entrará em contato.`;

    // 4. Send message to selected seller via WhatsApp
    let sellerPhone = selectedSeller.whatsapp_number.replace(/\D/g, "");
    if (sellerPhone.length === 10 || sellerPhone.length === 11) {
      sellerPhone = `55${sellerPhone}`;
    }

    const evolutionApiUrl = Deno.env.get("EVOLUTION_API_URL");
    const evolutionApiKey = Deno.env.get("EVOLUTION_API_KEY");

    const { data: instanceData } = await supabase
      .from("wa_instances")
      .select("instance_name, provider, api_url, api_key_encrypted, meta_config")
      .eq("id", instance.id)
      .single();

    if (instanceData) {
      if (instanceData.provider === "evolution") {
        const apiUrl = (evolutionApiUrl || instanceData.api_url).replace(/\/+$/, "");
        const apiKey = evolutionApiKey || instanceData.api_key_encrypted;

        const sRes = await fetch(`${apiUrl}/message/sendText/${instanceData.instance_name}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", apikey: apiKey },
          body: JSON.stringify({ number: sellerPhone, text: sellerMsg }),
        });
        if (!sRes.ok) {
           console.error(`[transfer] Evolution Error sending to seller: ${sRes.status} - ${await sRes.text()}`);
        } else {
           console.log(`[transfer] Message sent to seller ${selectedSeller.name} at ${sellerPhone}`);
        }
      } else if (instanceData.provider === "meta") {
        const metaConfig = instanceData.meta_config || {};
        const phoneNumberId = metaConfig.phone_number_id;
        const accessToken = metaConfig.access_token_encrypted || instanceData.api_key_encrypted;

        if (phoneNumberId && accessToken) {
          await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              messaging_product: "whatsapp",
              to: sellerPhone,
              type: "text",
              text: { body: sellerMsg },
            }),
          });
        }
      }
    }

    // 5. Update seller's stats (round-robin tracking)
    await supabase.from("ai_team_members").update({
      last_lead_received_at: new Date().toISOString(),
      total_leads_received: (selectedSeller.total_leads_received || 0) + 1,
    }).eq("id", selectedSeller.id);

    // 6. Record transfer in ai_lead_transfers
    const { data: leadData } = await supabase
      .from("ai_crm_leads")
      .select("id")
      .eq("agent_id", agent.id)
      .eq("remote_jid", phone)
      .maybeSingle();

    if (leadData) {
      await supabase.from("ai_lead_transfers").insert({
        user_id: instance.user_id,
        lead_id: leadData.id,
        from_agent_id: agent.id,
        to_member_id: selectedSeller.id,
        transfer_reason: summary,
        notes: `Transferido automaticamente para ${selectedSeller.name} via round-robin`,
      });

      // Update lead with transfer info
      await supabase.from("ai_crm_leads").update({
        status: "transferido",
        assigned_to_member_id: selectedSeller.id,
        transferred_at: new Date().toISOString(),
        transfer_reason: `Encaminhado para ${selectedSeller.name}`,
      }).eq("id", leadData.id);
    }

    console.log(`[transfer] Lead ${phone} transferred to ${selectedSeller.name} successfully`);
  } catch (err) {
    console.error("[transfer] Error transferring lead:", err);
  }
}

// ====================== OPT-IN/OPT-OUT CONFIRMATION MESSAGES ======================

async function sendOptoutConfirmation(supabase: any, instance: any, phone: string, replyTarget?: string) {
  try {
    const confirmMsg = "✅ Sua solicitação foi processada. Você não receberá mais mensagens nossas. Caso mude de ideia, basta nos enviar uma mensagem. Obrigado! 🙏";
    await sendAutoReply(supabase, instance, phone, confirmMsg, replyTarget);
  } catch (err) {
    console.error("[opt-out] Failed to send confirmation:", err);
  }
}

async function sendOptinConfirmation(supabase: any, instance: any, phone: string, replyTarget?: string) {
  try {
    const confirmMsg = "🎉 Que bom que você quer continuar! Vamos enviar apenas conteúdos relevantes para você. Obrigado pela confiança! 💚";
    await sendAutoReply(supabase, instance, phone, confirmMsg, replyTarget);
  } catch (err) {
    console.error("[opt-in] Failed to send confirmation:", err);
  }
}

async function sendAutoReply(supabase: any, instance: any, phone: string, text: string, replyTarget?: string) {
  const { data: instanceData } = await supabase
    .from("wa_instances")
    .select("instance_name, provider, api_url, api_key_encrypted, meta_config")
    .eq("id", instance.id)
    .single();

  if (!instanceData) return;

  const destination = replyTarget || phone;

  if (instanceData.provider === "evolution") {
    const evolutionApiUrl = Deno.env.get("EVOLUTION_API_URL");
    const evolutionApiKey = Deno.env.get("EVOLUTION_API_KEY");
    const apiUrl = (evolutionApiUrl || instanceData.api_url).replace(/\/+$/, "");
    const apiKey = evolutionApiKey || instanceData.api_key_encrypted;

    const res = await fetch(`${apiUrl}/message/sendText/${instanceData.instance_name}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: apiKey },
      body: JSON.stringify({ number: destination, text }),
    });

    if (!res.ok) {
      console.error("[auto-reply] Evolution send error:", await res.text());
    }
  } else if (instanceData.provider === "meta") {
    const config = instanceData.meta_config || {};
    const phoneNumberId = config.phone_number_id;
    const accessToken = config.access_token_encrypted || instanceData.api_key_encrypted;

    if (phoneNumberId && accessToken) {
      await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ messaging_product: "whatsapp", to: phone, type: "text", text: { body: text } }),
      });
    }
  }

  // Save to inbox
  await supabase.from("wa_inbox").insert({
    user_id: instance.user_id,
    instance_id: instance.id,
    phone,
    direction: "outgoing",
    message_type: "text",
    content: text,
    is_read: true,
  });
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

// ====================== AUDIO TRANSCRIPTION ======================

async function transcribeAudioFromEvolution(
  supabase: any,
  instance: any,
  messageData: any,
  instanceName: string,
): Promise<string | null> {
  try {
    const evolutionApiUrl = Deno.env.get("EVOLUTION_API_URL");
    const evolutionApiKey = Deno.env.get("EVOLUTION_API_KEY");

    const { data: instanceData } = await supabase
      .from("wa_instances")
      .select("api_url, api_key_encrypted")
      .eq("id", instance.id)
      .single();

    const apiUrl = (evolutionApiUrl || instanceData?.api_url || "").replace(/\/+$/, "");
    const apiKey = evolutionApiKey || instanceData?.api_key_encrypted;

    if (!apiUrl || !apiKey) {
      console.error("[audio-transcribe] Missing Evolution API credentials");
      return null;
    }

    const key = messageData.key || {};
    const message = messageData.message || messageData;
    console.log(`[audio-transcribe] Requesting base64 from Evolution: ${apiUrl}/chat/getBase64FromMediaMessage/${instanceName}`);
    console.log(`[audio-transcribe] Key: ${JSON.stringify(key)}`);

    // Try V2 endpoint first, then V1
    let base64Audio: string | null = null;
    let mimetype = "audio/ogg";

    // Attempt 1: Standard endpoint with full message body
    const mediaRes = await fetch(`${apiUrl}/chat/getBase64FromMediaMessage/${instanceName}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: apiKey,
      },
      body: JSON.stringify({ message: { key, message: message } }),
    });

    console.log(`[audio-transcribe] Evolution response status: ${mediaRes.status}`);

    if (mediaRes.ok) {
      const mediaData = await mediaRes.json();
      console.log(`[audio-transcribe] Evolution response keys: ${JSON.stringify(Object.keys(mediaData))}`);
      base64Audio = mediaData.base64 || mediaData.data?.base64 || mediaData.mediaBase64 || null;
      mimetype = mediaData.mimetype || mediaData.data?.mimetype || message.audioMessage?.mimetype || "audio/ogg";
    } else {
      const errText = await mediaRes.text();
      console.error(`[audio-transcribe] Evolution getBase64 failed: ${mediaRes.status} - ${errText}`);
      
      // Attempt 2: Try with just key (some Evolution versions)
      const mediaRes2 = await fetch(`${apiUrl}/chat/getBase64FromMediaMessage/${instanceName}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: apiKey,
        },
        body: JSON.stringify({ message: { key }, convertToMp4: false }),
      });

      console.log(`[audio-transcribe] Evolution retry status: ${mediaRes2.status}`);
      if (mediaRes2.ok) {
        const mediaData2 = await mediaRes2.json();
        base64Audio = mediaData2.base64 || mediaData2.data?.base64 || mediaData2.mediaBase64 || null;
        mimetype = mediaData2.mimetype || mediaData2.data?.mimetype || message.audioMessage?.mimetype || "audio/ogg";
      } else {
        await mediaRes2.text(); // consume body
      }
    }

    if (!base64Audio) {
      console.error("[audio-transcribe] No base64 audio returned from Evolution after all attempts");
      return null;
    }

    console.log(`[audio-transcribe] Got base64 audio, length: ${base64Audio.length}, mimetype: ${mimetype}`);
    return await transcribeWithGemini(base64Audio, mimetype);
  } catch (err) {
    console.error("[audio-transcribe] Evolution transcription error:", err);
    return null;
  }
}

async function transcribeAudioFromMeta(
  supabase: any,
  instance: any,
  mediaId: string,
): Promise<string | null> {
  try {
    const { data: instanceData } = await supabase
      .from("wa_instances")
      .select("api_key_encrypted, meta_config")
      .eq("id", instance.id)
      .single();

    const metaConfig = instanceData?.meta_config || {};
    const accessToken = metaConfig.access_token_encrypted || instanceData?.api_key_encrypted;

    if (!accessToken) {
      console.error("[audio-transcribe] Missing Meta access token");
      return null;
    }

    // Step 1: Get media URL from Meta
    const mediaInfoRes = await fetch(`https://graph.facebook.com/v21.0/${mediaId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!mediaInfoRes.ok) {
      console.error(`[audio-transcribe] Meta media info error: ${mediaInfoRes.status}`);
      return null;
    }

    const mediaInfo = await mediaInfoRes.json();
    const mediaUrl = mediaInfo.url;
    const mimetype = mediaInfo.mime_type || "audio/ogg";

    if (!mediaUrl) return null;

    // Step 2: Download the audio
    const audioRes = await fetch(mediaUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!audioRes.ok) {
      console.error(`[audio-transcribe] Meta audio download error: ${audioRes.status}`);
      return null;
    }

    const audioBuffer = await audioRes.arrayBuffer();
    const { encode: base64Encode } = await import("https://deno.land/std@0.168.0/encoding/base64.ts");
    const base64Audio = base64Encode(audioBuffer);

    return await transcribeWithGemini(base64Audio, mimetype);
  } catch (err) {
    console.error("[audio-transcribe] Meta transcription error:", err);
    return null;
  }
}

async function transcribeWithGemini(base64Audio: string, mimetype: string): Promise<string | null> {
  const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
  if (!GEMINI_API_KEY) {
    console.error("[audio-transcribe] GEMINI_API_KEY not configured");
    return null;
  }

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  inlineData: {
                    mimeType: mimetype,
                    data: base64Audio,
                  },
                },
                {
                  text: "Transcreva este áudio de forma precisa. Retorne APENAS o texto falado, sem comentários adicionais, formatação ou prefixos como 'Transcrição:'. Se o áudio estiver vazio ou inaudível, retorne exatamente: [áudio inaudível]",
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 1000,
          },
        }),
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      console.error(`[audio-transcribe] Gemini error: ${response.status} - ${errText}`);
      return null;
    }

    const data = await response.json();
    const transcription = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

    if (!transcription || transcription === "[áudio inaudível]") {
      console.log("[audio-transcribe] No transcription available");
      return null;
    }

    console.log(`[audio-transcribe] Transcribed: ${transcription.substring(0, 80)}...`);
    return transcription;
  } catch (err) {
    console.error("[audio-transcribe] Gemini transcription error:", err);
    return null;
  }
}

// ====================== CAPI FULL-FUNNEL EVENT SENDER ======================

async function sendCAPIEvent(
  supabase: any,
  userId: string,
  phone: string,
  eventName: string,
  customData: Record<string, any> = {},
  extraUserData: Record<string, any> = {},
) {
  try {
    // Find user's active pixel
    const { data: pixel } = await supabase
      .from("meta_pixels")
      .select("id, pixel_id, access_token_encrypted, events_today, events_total")
      .eq("user_id", userId)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();

    if (!pixel) {
      console.log(`[capi] No active pixel found, skipping ${eventName}`);
      return;
    }

    // Get access token from pixel or ad_accounts
    const { data: adAccount } = await supabase
      .from("ad_accounts")
      .select("access_token_encrypted")
      .eq("user_id", userId)
      .eq("platform", "meta")
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();

    const accessToken = pixel.access_token_encrypted || adAccount?.access_token_encrypted;
    if (!accessToken) {
      console.log(`[capi] No access token, queuing ${eventName}`);
      await supabase.from("meta_capi_events").insert({
        user_id: userId,
        pixel_id: pixel.id,
        event_name: eventName,
        action_source: "system_generated",
        user_data: { ph: [phone], ...extraUserData },
        custom_data: customData,
        status: "pending",
      });
      return;
    }

    // Hash phone for CAPI (SHA256)
    const encoder = new TextEncoder();
    const hashBuffer = await crypto.subtle.digest("SHA-256", encoder.encode(phone));
    const hashedPhone = Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    const eventTime = Math.floor(Date.now() / 1000);

    const metaRes = await fetch(`https://graph.facebook.com/v21.0/${pixel.pixel_id}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        data: [
          {
            event_name: eventName,
            event_time: eventTime,
            action_source: "system_generated",
            user_data: {
              ph: [hashedPhone],
              ...extraUserData,
            },
            custom_data: {
              ...customData,
              source: customData.source || "whatsapp",
            },
          },
        ],
        access_token: accessToken,
      }),
    });

    const metaData = await metaRes.json();

    // Log event
    await supabase.from("meta_capi_events").insert({
      user_id: userId,
      pixel_id: pixel.id,
      event_name: eventName,
      event_time: new Date().toISOString(),
      action_source: "system_generated",
      user_data: { ph: [hashedPhone], ...extraUserData },
      custom_data: { ...customData, source: customData.source || "whatsapp" },
      status: metaData.error ? "failed" : "sent",
      response_code: metaRes.status,
      response_body: metaData,
      error_message: metaData.error?.message || null,
      sent_at: new Date().toISOString(),
    });

    // Update pixel stats
    await supabase
      .from("meta_pixels")
      .update({
        last_event_at: new Date().toISOString(),
        events_today: (pixel.events_today || 0) + 1,
        events_total: (pixel.events_total || 0) + 1,
      })
      .eq("id", pixel.id);

    if (metaData.error) {
      console.error(`[capi] ${eventName} error:`, metaData.error.message);
    } else {
      console.log(`[capi] ${eventName} sent for ${phone.substring(0, 6)}***`);
    }
  } catch (err) {
    console.error(`[capi] Error sending ${eventName}:`, err);
  }
}

// ====================== UTM/FBCLID EXTRACTION ======================

function extractUTMParams(
  messageText: string,
  referral: any | null,
): Record<string, string> {
  const params: Record<string, string> = {};

  // 1. Extract from Meta referral object (Click-to-WhatsApp ads)
  if (referral) {
    if (referral.source_url) {
      try {
        const url = new URL(referral.source_url);
        const fbclid = url.searchParams.get("fbclid");
        const utmSource = url.searchParams.get("utm_source");
        const utmCampaign = url.searchParams.get("utm_campaign");
        if (fbclid) params.fbclid = fbclid;
        if (utmSource) params.utm_source = utmSource;
        if (utmCampaign) params.utm_campaign = utmCampaign;
      } catch { /* invalid URL */ }
    }
    // Meta ad referral fields
    if (referral.headline) params.utm_campaign = params.utm_campaign || referral.headline;
    if (referral.source_type === "ad" && !params.utm_source) params.utm_source = "meta_ads";
  }

  // 2. Extract from URLs found in message text
  const urlRegex = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/gi;
  const urls = messageText.match(urlRegex) || [];

  for (const rawUrl of urls) {
    try {
      const url = new URL(rawUrl);
      const fbclid = url.searchParams.get("fbclid");
      const utmSource = url.searchParams.get("utm_source");
      const utmCampaign = url.searchParams.get("utm_campaign");
      if (fbclid && !params.fbclid) params.fbclid = fbclid;
      if (utmSource && !params.utm_source) params.utm_source = utmSource;
      if (utmCampaign && !params.utm_campaign) params.utm_campaign = utmCampaign;
    } catch { /* invalid URL */ }
  }

  return params;
}
