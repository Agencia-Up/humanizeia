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
    console.log(
      `[wa-inbox-webhook] Incoming request | object=${body?.object || "evolution"} | event=${body?.event || "n/a"} | instance=${body?.instance || "n/a"}`
    );
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
          content = buildImageContent(msg.image?.caption || "");
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
                content = buildAudioFallbackContent();
                console.warn("[wa-inbox-webhook] Meta audio transcription returned null");
              }
            } catch (transcErr) {
              content = buildAudioFallbackContent();
              console.error("[wa-inbox-webhook] Meta audio transcription error:", transcErr);
            }
          } else {
            content = buildAudioFallbackContent();
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

  console.log(
    `[wa-inbox-webhook] Evolution event received: ${normalizedEvent || "unknown"} | instance: ${instanceName || "unknown"}`
  );
  if (messageData && typeof messageData === "object" && !Array.isArray(messageData)) {
    console.log("[wa-inbox-webhook] UazAPI data keys:", JSON.stringify(Object.keys(messageData)));
  }

  if (normalizedEvent === "messages.update" && messageData) {
    return await handleEvolutionDeliveryStatus(supabase, instanceName, messageData);
  }

  const messageEntries = extractEvolutionMessageEntries(messageData);
  const shouldProcessIncoming =
    EVOLUTION_INCOMING_EVENTS.has(normalizedEvent) || messageEntries.length > 0;

  if (!shouldProcessIncoming || messageEntries.length === 0) {
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

  const processedInboxIds: string[] = [];

  for (const entry of messageEntries) {
    const inboxId = await processEvolutionIncomingMessage(supabase, instance, entry, instanceName);
    if (inboxId) {
      processedInboxIds.push(inboxId);
    }
  }

  return new Response(
    JSON.stringify({ ok: true, processed: processedInboxIds.length, inbox_ids: processedInboxIds }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

async function processEvolutionIncomingMessage(
  supabase: any,
  instance: any,
  messageData: any,
  instanceName: string,
) {
  const message = messageData.message || messageData;
  const key = messageData.key || {};

  console.log("[wa-inbox-webhook] Full messageData keys:", JSON.stringify(Object.keys(messageData || {})));
  console.log("[wa-inbox-webhook] key:", JSON.stringify(key));
  if (messageData.pushName) console.log("[wa-inbox-webhook] pushName:", messageData.pushName);
  if (messageData.participant) console.log("[wa-inbox-webhook] participant:", messageData.participant);
  if (messageData.messageTimestamp) console.log("[wa-inbox-webhook] timestamp:", messageData.messageTimestamp);

  if (key.fromMe) {
    return null;
  }

  const remoteJid = key.remoteJid || "";
  const remoteJidAlt = key.remoteJidAlt || "";

  let phone = "";
  let replyTarget = "";

  const toDigits = (value: string) => value.replace(/\D/g, "");

  if (remoteJid.endsWith("@lid")) {
    if (remoteJidAlt.endsWith("@s.whatsapp.net")) {
      phone = toDigits(remoteJidAlt);
      replyTarget = phone;
    } else {
      phone = toDigits(remoteJid.replace("@lid", ""));
      replyTarget = remoteJid;
      console.warn(`[wa-inbox-webhook] LID without remoteJidAlt for ${remoteJid}; using LID as reply target`);
    }
  } else {
    phone = toDigits(remoteJid);
    replyTarget = phone;
  }

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
    content = buildImageContent(message.imageMessage.caption || "");
    mediaUrl = message.imageMessage.url || null;
  } else if (message.videoMessage) {
    messageType = "video";
    content = message.videoMessage.caption || "";
    mediaUrl = message.videoMessage.url || null;
  } else if (message.audioMessage) {
    messageType = "audio";
    mediaUrl = message.audioMessage.url || null;
    console.log(`[wa-inbox-webhook] Audio message detected from UazAPI. mediaUrl: ${mediaUrl}, mimetype: ${message.audioMessage.mimetype}`);
    try {
      const transcription = await transcribeAudioFromEvolution(supabase, instance, messageData, instanceName);
      if (transcription) {
        content = transcription;
        console.log(`[wa-inbox-webhook] Audio transcribed successfully: ${content.substring(0, 80)}`);
      } else {
        content = buildAudioFallbackContent();
        console.warn("[wa-inbox-webhook] Audio transcription returned null, using fallback content");
      }
    } catch (transcErr) {
      content = buildAudioFallbackContent();
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

  const utmParams = extractUTMParams(content, null);

  const { data: contact } = await supabase
    .from("wa_contacts")
    .select("id")
    .eq("user_id", instance.user_id)
    .eq("phone", phone)
    .limit(1)
    .maybeSingle();

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
    return null;
  }

  if (content && content.trim().length > 0) {
    await categorizeAndAutomate(supabase, instance, inboxMsg.id, content, phone, pushName, contact?.id, replyTarget, messageType, remoteMessageId, instanceName);
  }

  return inboxMsg.id;
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

const EVOLUTION_INCOMING_EVENTS = new Set([
  "messages.upsert",
  "messages.set",
  "message.upsert",
  "message.set",
  "messages.insert",
]);

function extractEvolutionMessageEntries(messageData: any): any[] {
  if (!messageData) return [];

  if (Array.isArray(messageData)) {
    return messageData.filter(Boolean);
  }

  if (Array.isArray(messageData.messages)) {
    return messageData.messages.filter(Boolean);
  }

  return [messageData];
}

function buildImageContent(caption: string | null | undefined): string {
  const trimmedCaption = (caption || "").trim();
  if (!trimmedCaption) {
    return "[Imagem recebida sem legenda]";
  }

  return `[Imagem recebida]\nLegenda: ${trimmedCaption}`;
}

function buildAudioFallbackContent(): string {
  return "[Mensagem de audio recebida sem transcricao]";
}

function parseStoredIntegrationCredentials(raw: string | null) {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return { api_token: raw };
  }
}

function normalizeBndvText(value?: string | null) {
  return String(value || "").toLowerCase().trim();
}

function bndvIncludes(haystack?: string | null, needle?: string | null) {
  if (!needle || !String(needle).trim()) return true;
  return normalizeBndvText(haystack).includes(normalizeBndvText(needle));
}

function bndvMatchesQuery(vehicle: any, query?: string | null) {
  if (!query || !String(query).trim()) return true;

  const indexed = [
    vehicle?.markName,
    vehicle?.modelName,
    vehicle?.versionName,
    vehicle?.color,
    vehicle?.fuelName,
    vehicle?.transmissionName,
    vehicle?.year?.toString?.(),
  ].filter(Boolean).join(" ").toLowerCase();

  return indexed.includes(normalizeBndvText(query));
}

async function consultarEstoqueBndv(supabase: any, userId: string, filters: any) {
  const BNDV_API_URL = "https://api-estoque.azurewebsites.net/graphql";

  const { data: integration, error: integrationError } = await supabase
    .from("platform_integrations")
    .select("api_key_encrypted, is_active")
    .eq("user_id", userId)
    .eq("platform", "bndv")
    .maybeSingle();

  if (integrationError) throw integrationError;

  if (!integration?.is_active) {
    return { success: false, error: "A integraÃ§Ã£o BNDV nÃ£o estÃ¡ conectada para este cliente." };
  }

  const credentials = parseStoredIntegrationCredentials(integration.api_key_encrypted);
  const token = String(credentials?.api_token || "").trim();

  if (!token) {
    return { success: false, error: "O token do BNDV nÃ£o foi encontrado na integraÃ§Ã£o salva." };
  }

  const response = await fetch(BNDV_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      query: `
        query BndvVehicles {
          vehiclesBy {
            modelName
            markName
            year
            km
            saleValue
            color
            fuelName
            transmissionName
            versionName
            pictureJs
          }
        }
      `,
    }),
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    return {
      success: false,
      error: payload?.errors?.[0]?.message || payload?.message || `BNDV retornou status ${response.status}.`,
    };
  }

  if (Array.isArray(payload?.errors) && payload.errors.length > 0) {
    return {
      success: false,
      error: payload.errors[0]?.message || "A API do BNDV retornou um erro.",
    };
  }

  const {
    query,
    marca,
    modelo,
    versao,
    combustivel,
    cambio,
    cor,
    ano_min,
    ano_max,
    preco_max,
    km_max,
    limite,
  } = filters || {};

  const items = Array.isArray(payload?.data?.vehiclesBy) ? payload.data.vehiclesBy : [];
  const filtered = items
    .filter((vehicle: any) => {
      const year = Number(vehicle?.year || 0);
      const price = Number(vehicle?.saleValue || 0);
      const mileage = Number(vehicle?.km || 0);

      return (
        bndvMatchesQuery(vehicle, query) &&
        bndvIncludes(vehicle?.markName, marca) &&
        bndvIncludes(vehicle?.modelName, modelo) &&
        bndvIncludes(vehicle?.versionName, versao) &&
        bndvIncludes(vehicle?.fuelName, combustivel) &&
        bndvIncludes(vehicle?.transmissionName, cambio) &&
        bndvIncludes(vehicle?.color, cor) &&
        (!ano_min || year >= Number(ano_min)) &&
        (!ano_max || year <= Number(ano_max)) &&
        (!preco_max || price <= Number(preco_max)) &&
        (!km_max || mileage <= Number(km_max))
      );
    })
    .sort((left: any, right: any) => {
      const leftPrice = Number(left?.saleValue || 0);
      const rightPrice = Number(right?.saleValue || 0);
      if (leftPrice !== rightPrice) return leftPrice - rightPrice;
      return Number(right?.year || 0) - Number(left?.year || 0);
    });

  const capped = filtered.slice(0, Number(limite || 8)).map((vehicle: any) => {
    // Parse pictureJs to extract photo URLs
    let fotos: string[] = [];
    try {
      const pics = vehicle?.pictureJs ? JSON.parse(vehicle.pictureJs) : [];
      if (Array.isArray(pics)) {
        // Sort: Principal first, then take up to 5
        const sorted = pics.sort((a: any, b: any) =>
          (b?.Principal === "true" ? 1 : 0) - (a?.Principal === "true" ? 1 : 0)
        );
        fotos = sorted.slice(0, 5).map((p: any) => p?.Link).filter(Boolean);
      }
    } catch {}

    return {
      marca: vehicle?.markName || null,
      modelo: vehicle?.modelName || null,
      versao: vehicle?.versionName || null,
      ano: vehicle?.year || null,
      km: vehicle?.km || null,
      preco: vehicle?.saleValue || null,
      cor: vehicle?.color || null,
      combustivel: vehicle?.fuelName || null,
      cambio: vehicle?.transmissionName || null,
      fotos,
      label: [vehicle?.markName, vehicle?.modelName, vehicle?.versionName].filter(Boolean).join(" "),
    };
  });

  return {
    success: true,
    total: filtered.length,
    items: capped,
  };
}

function shouldSkipAICategorization(content: string): boolean {
  const normalized = (content || "").trim().toLowerCase();
  // Apenas documentos pulam categorizacao — imagens e audios sao processados pela IA
  return normalized.startsWith("[arquivo recebido:");
}

function getMediaFallbackReply(content: string): string | null {
  const normalized = (content || "").trim().toLowerCase();

  // Imagens e audios NAO usam fallback — sao processados pela IA
  // A IA recebe o texto indicativo e responde naturalmente

  if (normalized.startsWith("[arquivo recebido:")) {
    return "Recebi seu arquivo aqui, mas por enquanto eu nao consigo abrir documentos direto. Se quiser, me resume o ponto principal em texto ou audio que eu te ajudo daqui.";
  }

  return null;
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
  msgType?: string,
  remoteMessageId?: string | null,
  instanceName?: string,
) {
  try {
    // ===== Check for opt-in/opt-out button responses first =====
    const lowerContent = content.toLowerCase().trim();
    const isOptoutButton = lowerContent.includes("nÃ£o quero mais receber") ||
      lowerContent.includes("optout_stop") ||
      lowerContent === "âŒ nÃ£o quero mais receber";
    const isOptinButton = lowerContent.includes("quero continuar recebendo") ||
      lowerContent.includes("optout_continue") ||
      lowerContent === "âœ… quero continuar recebendo";

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

    const aiCategory = shouldSkipAICategorization(content)
      ? { category: "question", sentiment: "neutral" }
      : await categorizeWithAI(content);

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
    await handleAIAgentReply(supabase, instance, content, phone, pushName, aiCategory.category, replyTarget, msgType, remoteMessageId, instanceName);

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
      // Send via UazAPI
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
  msgType?: string,
  remoteMessageId?: string | null,
  instanceName?: string,
) {
  try {
    const mediaFallbackReply = getMediaFallbackReply(content);

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

    const nowIso = new Date().toISOString();
    const { data: currentLead, error: currentLeadErr } = await supabase
      .from("ai_crm_leads")
      .select("id, message_count")
      .eq("agent_id", agent.id)
      .eq("remote_jid", phone)
      .maybeSingle();

    if (currentLeadErr) {
      console.warn("[ai-agent] Failed to read CRM lead before reply:", currentLeadErr.message);
    } else if (currentLead?.id) {
      const updatePayload: any = {
        instance_id: instance.id,
        last_interaction_at: nowIso,
        message_count: (currentLead.message_count || 0) + 1,
      };
      if (pushName) updatePayload.lead_name = pushName;

      await supabase
        .from("ai_crm_leads")
        .update(updatePayload)
        .eq("id", currentLead.id);
    } else {
      const { error: leadInsertErr } = await supabase
        .from("ai_crm_leads")
        .insert({
          user_id: instance.user_id,
          agent_id: agent.id,
          instance_id: instance.id,
          remote_jid: phone,
          lead_name: pushName || phone,
          status: "novo",
          last_interaction_at: nowIso,
          message_count: 1,
        });

      if (leadInsertErr) {
        console.warn("[ai-agent] Failed to register CRM lead before reply:", leadInsertErr.message);
      }
    }

    // Check if AI is paused for this specific conversation (human takeover)
    const { data: leadForPause } = await supabase
      .from("ai_crm_leads")
      .select("ai_paused")
      .eq("agent_id", agent.id)
      .eq("remote_jid", phone)
      .maybeSingle();

    if (leadForPause?.ai_paused) {
      console.log(`[ai-agent] AI paused for conversation ${phone} — human takeover active, skipping`);
      return;
    }

    // NOTA: business_hours_only NÃO bloqueia mais o atendimento da IA.
    // A IA responde e transfere leads para vendedores 24/7 via rodízio.
    // O que pausa fora do horário (19:30–10:11) é apenas o REPASSE
    // automático por falta de confirmação — controlado pelo
    // transfer-timeout-checker (edge function separada).

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
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");

    const rawModel = agent.model || "google/gemini-2.5-flash";
    const isAnthropicModel = rawModel.startsWith("anthropic/");

    if (!mediaFallbackReply && !isAnthropicModel && !LOVABLE_API_KEY && !OPENAI_API_KEY) {
      console.error("[ai-agent] LOVABLE_API_KEY and OPENAI_API_KEY not configured");
      return;
    }
    if (!mediaFallbackReply && isAnthropicModel && !ANTHROPIC_API_KEY) {
      console.error("[ai-agent] ANTHROPIC_API_KEY not configured for Anthropic model");
      return;
    }

    const humanizationRules = `

REGRAS AVANÃ‡ADAS DE HUMANIZAÃ‡ÃƒO (PRIORIDADE MÃXIMA):

ðŸŽ­ PERSONA:
- VocÃª Ã© uma PESSOA REAL, nÃ£o um chatbot. Nunca diga "sou uma IA" ou "como assistente virtual"
- Tenha personalidade: seja caloroso, genuÃ­no, autÃªntico
- Responda como alguÃ©m que realmente se importa com o cliente

ðŸ’¬ ESTILO DE ESCRITA (WhatsApp real):
- Escreva EXATAMENTE como uma pessoa digita no WhatsApp: frases curtas, informais, diretas
- Use letras minÃºsculas quando natural (ex: "oi", "beleza", "show")
- AbreviaÃ§Ãµes naturais quando o tom permitir: "vc", "tb", "pq", "blz", "msg"
- MÃ¡ximo 3 linhas por mensagem â€” quebre em blocos se precisar explicar algo longo
- NUNCA use formataÃ§Ã£o markdown (**negrito**, *itÃ¡lico*, listas com â€¢)
- NUNCA use cabeÃ§alhos, bullets ou formataÃ§Ã£o de documento

ðŸŽ² VARIAÃ‡ÃƒO OBRIGATÃ“RIA:
- NUNCA comece duas mensagens consecutivas da mesma forma
- Alterne entre estilos: Ã s vezes comece respondendo direto, Ã s vezes com uma interjeiÃ§Ã£o
- InterjeiÃ§Ãµes naturais: "Ahh", "Hmm", "Poxa", "Eita", "Show", "Massa", "Boa", "Olha sÃ³"
- Evite SEMPRE: "OlÃ¡! Como posso ajudar?", "Estou aqui para ajudar", "Claro!", "Com certeza!"
- Se jÃ¡ usou "oi" na Ãºltima resposta, use outra coisa agora
- Varie cumprimentos: "E aÃ­", "Fala", "Opa", "Eii", "Oi oi"

ðŸ§  CONSCIÃŠNCIA CONTEXTUAL:
- Leia TODO o histÃ³rico antes de responder
- Referencie coisas que o cliente disse antes naturalmente
- Se o cliente jÃ¡ perguntou algo, nÃ£o peÃ§a de novo
- Adapte seu tom ao tom do cliente: formal â†’ formal, descontraÃ­do â†’ descontraÃ­do
- Se o cliente mandou Ã¡udio (transcrito), responda naturalmente como se tivesse ouvido

ðŸ˜Š EMPATIA REAL:
- Valide sentimentos: "Entendo sua preocupaÃ§Ã£o", "faz total sentido"
- Se o cliente estÃ¡ frustrado, reconheÃ§a antes de resolver
- Comemore conquistas do cliente: "Que legal!", "Show demais!"
- Use humor leve quando apropriado

âš ï¸ ANTI-ROBÃ” (evite a todo custo):
- Nunca liste benefÃ­cios com bullets ou numeraÃ§Ã£o
- Nunca use "Espero ter ajudado!" ou "Fico Ã  disposiÃ§Ã£o!"
- Nunca responda com parÃ¡grafos longos e estruturados
- Nunca use linguagem corporativa engessada
- Nunca repita o nome do cliente em toda mensagem
- Se precisar listar algo, faÃ§a de forma conversacional: "tem o plano X que custa Y, e tem tambÃ©m o Z que..."

[REGRAS DE CONDUTA ANTE MIDIAS E ARQUIVOS]
- IMAGEM: quando a imagem vier junto com a mensagem, voce CONSEGUE ver e analisar a foto. Descreva o que ve naturalmente, como um vendedor real faria no WhatsApp: identifique o veiculo (marca, modelo, cor), detalhes visiveis, e responda de forma util. Se tem legenda, use como contexto. Quando receber apenas "[Imagem recebida sem legenda]" sem a foto anexada, pergunte sobre o que e a imagem de forma natural.
- AUDIO: quando receber "[Mensagem de audio recebida sem transcricao]", significa que o audio chegou mas nao foi possivel transcrever. Peca educadamente para o cliente repetir por texto ou mandar outro audio: "opa, seu audio nao chegou nitido aqui, me manda por texto ou tenta de novo?" - NUNCA ignore, NUNCA de respostas genericas.
- AUDIO TRANSCRITO: quando a transcricao funciona, o texto do audio chega direto pra voce. Responda naturalmente como se tivesse ouvido o audio.
- DOCUMENTOS/PDFs: (indicado com "[Arquivo recebido: <nome>]"), voce NAO pode abrir arquivos. Peca pro cliente resumir o conteudo em texto ou audio.
- LINKS/URLs: quando o cliente enviar uma mensagem contendo links ou URLs (ex: anuncios do Facebook, Instagram, sites), voce NAO consegue abrir ou acessar links. Mas NUNCA diga "nao consigo acessar links" ou qualquer variacao disso. Em vez disso, USE O TEXTO que acompanha o link como contexto (titulo do anuncio, descricao, nome do produto/veiculo). Responda de forma natural como se tivesse entendido o contexto: "vi que voce ta olhando esse [produto/veiculo] - conta mais, o que te chamou atencao nele?" Se nao houver texto alem do link, pergunte naturalmente: "me conta mais sobre esse link, o que voce viu la que te interessou?"
- ENCERRAMENTO/DESPEDIDA: quando o cliente disser "obrigado", "valeu", "ate mais", "tchau", "falou" ou qualquer despedida, NUNCA responda apenas com "De nada, ate mais!" ou encerre a conversa diretamente. ANTES de se despedir, voce DEVE tentar captar informacoes de contato (nome completo, telefone, email) e entender o interesse do cliente. Exemplo: "que bom que pude ajudar! antes de a gente se despedir, me passa seu nome completo e um telefone pra contato? assim consigo te avisar quando surgir algo especial pra voce". So encerre a conversa DEPOIS de tentar essa captacao.

RESPOSTAS ANTERIORES DO AGENTE (para NÃƒO repetir frases/aberturas):
${recentReplies.slice(0, 5).map((r, i) => `[${i+1}]: ${r.substring(0, 80)}`).join("\n")}
Gere uma resposta DIFERENTE de todas as anteriores em estrutura, abertura e vocabulÃ¡rio.
`;

    const clientName = pushName || null;
    const nameInstruction = clientName 
      ? `\nNome do cliente: ${clientName} (use o nome com moderaÃ§Ã£o, nÃ£o em toda mensagem)`
      : `\nNome do cliente: desconhecido (nÃ£o pergunte o nome a menos que seja necessÃ¡rio para o atendimento)`;

    const crmToolInstruction = `

FERRAMENTA DE CRM - COLETA DE DADOS E QUALIFICACAO:
Voce tem acesso a ferramenta "atualizar_etapa_crm" para salvar dados do cliente e atualizar o status do lead.
Esta ferramenta agora aceita CAMPOS ESTRUTURADOS alem do status e resumo.

REGRA CRITICA - COLETA DE DADOS DO CLIENTE:
Voce DEVE coletar dados do cliente ao longo da conversa e salvar usando a ferramenta.
NAO espere ter todos os dados para chamar a ferramenta. Chame SEMPRE que coletar uma informacao nova.

DADOS A COLETAR (um por vez, de forma natural na conversa):
1. ABORDAGEM: nome completo do cliente, cidade
2. MODELAGEM: veiculo de interesse, forma de pagamento (a_vista, troca, financiamento)
3. SE FINANCIAMENTO: CPF, data de nascimento, valor de parcela ideal, valor de entrada
4. SE TROCA: descricao do carro de troca (modelo, ano, km), como pagar a diferenca
5. SE A VISTA: tentar agendar visita
6. FECHAMENTO: confirmar todos os dados e qualificar

QUANDO CHAMAR A FERRAMENTA:
- Primeira mensagem do cliente -> status: "novo", salve nome e cidade se souber
- Cliente informou nome ou cidade -> chame com os dados coletados (mantenha status atual)
- Cliente demonstrou interesse real -> status: "interessado", salve veiculo_interesse
- Cliente informou forma de pagamento -> salve forma_pagamento, atualize etapa_funil para "modelagem"
- Cliente deu dados de financiamento (CPF, entrada, parcela) -> salve cada dado conforme coletar
- Cliente pronto para comprar/visitar/falar com consultor -> status: "qualificado", etapa_funil: "fechamento"
- Cliente sem interesse ou despedida definitiva -> status: "encerrado"

CAMPOS DISPONIVEIS NA FERRAMENTA (todos opcionais exceto status e resumo):
- status: "novo", "interessado", "qualificado", "encerrado"
- resumo: texto livre com resumo da conversa
- nome_cliente: nome REAL do cliente (NAO o nome do WhatsApp)
- cidade: cidade do cliente
- veiculo_interesse: modelo/tipo de veiculo que o cliente quer
- forma_pagamento: "a_vista", "troca" ou "financiamento"
- orcamento: faixa de preco ou valor maximo
- carro_troca: descricao do carro de troca (ex: "Gol 2018, 95mil km, prata")
- entrada: valor de entrada mencionado
- parcela_ideal: valor de parcela que cabe no bolso do cliente
- cpf: CPF do cliente (somente para financiamento)
- data_nascimento: data de nascimento (somente para financiamento)
- etapa_funil: "abordagem", "modelagem" ou "fechamento"
- temperatura: "frio", "morno" ou "quente"
- visita_agendada: dia/horario da visita se agendada (ex: "quinta-feira as 15h")
- observacoes: qualquer info extra relevante (familiar que vai consultar, urgencia, etc.)

COMO DEFINIR TEMPERATURA:
- "frio": cliente so perguntou algo basico, sem engajamento
- "morno": cliente demonstrou interesse, fez perguntas, mas nao avancou para pagamento
- "quente": cliente perguntou preco, financiamento, troca, quer visitar, ou esta pronto para fechar

REGRA DE OURO: NUNCA deixe uma conversa terminar sem tentar coletar pelo menos nome e cidade.
Se o cliente se despedir sem dar dados, chame a ferramenta com status "encerrado" e observacoes explicando o motivo.

QUANDO STATUS FOR "qualificado":
1. Certifique-se de que coletou: nome_cliente, cidade, veiculo_interesse, forma_pagamento
2. Preencha o resumo com TUDO que sabe sobre o cliente
3. Defina temperatura como "quente"
4. Apos chamar a ferramenta, informe ao cliente que um consultor especialista vai continuar o atendimento

FERRAMENTA DE ESTOQUE BNDV:
Voce tambem tem acesso a ferramenta "consultar_estoque_bndv".
USE esta ferramenta sempre que o cliente perguntar sobre:
- carros disponiveis no estoque
- preco de veiculo
- ano, versao, cambio, combustivel, quilometragem ou cor
- opcoes ate um orcamento especifico

IMPORTANTE:
- Nunca invente estoque ou preco sem consultar a ferramenta.
- Se nao encontrar veiculos, informe claramente e sugira alternativas do MESMO SEGMENTO.

FOTOS DE VEICULOS:
Quando a consulta de estoque retornar veiculos, cada veiculo tera um campo "fotos" com URLs de imagens reais.
Use a ferramenta "enviar_foto" para enviar fotos ao cliente pelo WhatsApp.

REGRAS PARA FOTOS (PRIORIDADE MAXIMA):
- NUNCA cole ou escreva URLs de fotos na mensagem de texto. O cliente nao quer ver links.
- SEMPRE use a ferramenta "enviar_foto" para enviar cada foto. Isso envia a IMAGEM real no WhatsApp.
- Envie 1 foto por chamada da ferramenta. Para multiplas fotos, chame a ferramenta varias vezes.
- Sempre adicione uma legenda descritiva (ex: "Vista frontal do Onix 2024", "Interior em couro").
- Se nao ha fotos disponiveis, informe ao cliente.
- SEMPRE que apresentar um veiculo com fotos, OFERECA envia-las proativamente.
- Se o cliente pedir fotos sem consulta previa, primeiro use "consultar_estoque_bndv".
- Na sua resposta em texto, diga algo como "mandei as fotos ai" ou "olha so as fotos" — SEM colar nenhum link.
`;

    const systemPrompt = agent.system_prompt + "\n" + humanizationRules + nameInstruction + crmToolInstruction;

    // CRM Tool definition for function calling
    const crmTools = [
      {
        type: "function",
        function: {
          name: "enviar_foto",
          description: "Envia uma foto/imagem para o cliente pelo WhatsApp. Use sempre que precisar enviar fotos de veiculos do estoque. A URL deve ser uma das fotos retornadas pela ferramenta consultar_estoque_bndv (campo 'fotos'). Pode chamar esta ferramenta varias vezes para enviar multiplas fotos.",
          parameters: {
            type: "object",
            properties: {
              url: {
                type: "string",
                description: "URL completa da imagem a ser enviada (ex: URL do campo fotos do BNDV)"
              },
              legenda: {
                type: "string",
                description: "Legenda curta para a foto (ex: 'Vista frontal', 'Interior', 'Painel'). Opcional."
              }
            },
            required: ["url"],
            additionalProperties: false
          }
        }
      },
      {
        type: "function",
        function: {
          name: "atualizar_etapa_crm",
          description: "Atualiza o status do lead no CRM, salva dados estruturados do cliente e registra um resumo. Use SEMPRE que coletar qualquer informacao nova do cliente (nome, cidade, veiculo, pagamento, etc). Pode chamar multiplas vezes na mesma conversa conforme coletar mais dados.",
          parameters: {
            type: "object",
            properties: {
              status: {
                type: "string",
                enum: ["novo", "interessado", "qualificado", "encerrado"],
                description: "Status atual do lead: novo (primeiro contato), interessado (demonstrou interesse), qualificado (pronto para consultor), encerrado (sem interesse)"
              },
              resumo: {
                type: "string",
                description: "Resumo detalhado da conversa incluindo contexto, interesse, duvidas e informacoes relevantes"
              },
              nome_cliente: {
                type: "string",
                description: "Nome REAL completo do cliente coletado na conversa (nao o nome do WhatsApp)"
              },
              cidade: {
                type: "string",
                description: "Cidade do cliente"
              },
              veiculo_interesse: {
                type: "string",
                description: "Veiculo que o cliente busca (ex: 'Jeep Renegade', 'SUV automatico', 'Onix 2020')"
              },
              forma_pagamento: {
                type: "string",
                enum: ["a_vista", "troca", "financiamento"],
                description: "Forma de pagamento escolhida pelo cliente"
              },
              orcamento: {
                type: "string",
                description: "Faixa de preco ou valor maximo (ex: 'ate 90 mil', 'entre 70 e 85 mil')"
              },
              carro_troca: {
                type: "string",
                description: "Detalhes do carro de troca (ex: 'Gol 2018, 95mil km, prata, manual')"
              },
              entrada: {
                type: "string",
                description: "Valor de entrada mencionado (ex: '15 mil', 'R$ 20.000')"
              },
              parcela_ideal: {
                type: "string",
                description: "Valor de parcela que cabe no bolso (ex: 'ate 1.500', 'entre 1.000 e 1.200')"
              },
              cpf: {
                type: "string",
                description: "CPF do cliente (somente para financiamento)"
              },
              data_nascimento: {
                type: "string",
                description: "Data de nascimento do cliente (somente para financiamento)"
              },
              etapa_funil: {
                type: "string",
                enum: ["abordagem", "modelagem", "fechamento"],
                description: "Etapa atual no funil de vendas: abordagem (conexao inicial), modelagem (entendendo perfil/pagamento), fechamento (conduzindo para decisao)"
              },
              temperatura: {
                type: "string",
                enum: ["frio", "morno", "quente"],
                description: "Temperatura do lead: frio (pouco interesse), morno (interesse medio), quente (pronto para comprar)"
              },
              visita_agendada: {
                type: "string",
                description: "Data/horario da visita agendada (ex: 'quinta-feira as 15h', 'semana que vem')"
              },
              observacoes: {
                type: "string",
                description: "Informacoes extras relevantes (ex: 'vai consultar esposa', 'cliente de fora - litoral SP', 'urgencia para trocar')"
              }
            },
            required: ["status", "resumo"],
            additionalProperties: false
          }
        }
      },
      {
        type: "function",
        function: {
          name: "consultar_estoque_bndv",
          description: "Consulta o estoque real de veÃ­culos do cliente integrado ao BNDV. Use quando o cliente perguntar por carro disponÃ­vel, preÃ§o, ano, versÃ£o, cÃ¢mbio, combustÃ­vel, cor ou faixa de valor. Nunca invente estoque sem usar esta ferramenta.",
          parameters: {
            type: "object",
            properties: {
              query: { type: "string", description: "Busca livre do cliente, como 'nivus automÃ¡tico atÃ© 110 mil'." },
              marca: { type: "string", description: "Marca do veÃ­culo, ex: Chevrolet, Jeep, Hyundai." },
              modelo: { type: "string", description: "Modelo do veÃ­culo, ex: Onix, Renegade, Creta." },
              versao: { type: "string", description: "VersÃ£o ou detalhe do veÃ­culo, ex: LTZ, EX, Touring." },
              combustivel: { type: "string", description: "CombustÃ­vel desejado, ex: Flex, Diesel." },
              cambio: { type: "string", description: "Tipo de cÃ¢mbio, ex: AutomÃ¡tico, Manual." },
              cor: { type: "string", description: "Cor desejada, se o cliente pedir." },
              ano_min: { type: "number", description: "Ano mÃ­nimo desejado." },
              ano_max: { type: "number", description: "Ano mÃ¡ximo desejado." },
              preco_max: { type: "number", description: "PreÃ§o mÃ¡ximo desejado pelo cliente." },
              km_max: { type: "number", description: "Quilometragem mÃ¡xima desejada pelo cliente." },
              limite: { type: "number", description: "Quantidade mÃ¡xima de veÃ­culos para retornar." }
            },
            additionalProperties: false
          }
        }
      }
    ];

    const maxTokensValue = agent.max_tokens || 500;
    const effectiveTemp = Math.max(parseFloat(agent.temperature) || 0.7, 0.75);

    // ── IMAGE VISION: download image and build vision content ──
    let visionContent: any = null; // will hold [{type:"text",...},{type:"image_url",...}] if image available
    if (msgType === "image" && remoteMessageId && instanceName) {
      try {
        // Get instance API details for download
        const { data: waInst } = await supabase
          .from("wa_instances")
          .select("api_url, api_key_encrypted")
          .eq("id", instance.id)
          .maybeSingle();

        if (waInst?.api_url && waInst?.api_key_encrypted) {
          const baseUrl = (waInst.api_url || '').replace(/\/+$/, '');
          const instKey = waInst.api_key_encrypted;

          console.log(`[ai-agent] 🖼️ Downloading image for vision, msgId: ${remoteMessageId}`);
          const dRes = await fetch(`${baseUrl}/message/download?instance=${instanceName}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'apikey': instKey, 'token': instKey },
            body: JSON.stringify({ id: remoteMessageId, return_base64: true }),
          });

          if (dRes.ok) {
            const dData = await dRes.json();
            const base64 = dData.base64Data || dData.base64 || dData.file || '';
            const mimeType = dData.mimetype || 'image/jpeg';
            if (base64 && base64.length > 100) {
              const captionText = content.replace(/\[Imagem recebida[^\]]*\]\n?/g, '').replace(/Legenda:\s*/g, '').trim() || '[Imagem recebida]';
              visionContent = [
                { type: "text", text: captionText },
                { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64}` } },
              ];
              console.log(`[ai-agent] ✅ Image downloaded for vision (${base64.length} chars, mime: ${mimeType})`);
            } else {
              console.warn(`[ai-agent] ⚠️ Image download returned empty/small base64`);
            }
          } else {
            const errText = await dRes.text().catch(() => '');
            console.error(`[ai-agent] ❌ Image download failed: ${dRes.status} - ${errText}`);
          }
        }
      } catch (imgErr) {
        console.error('[ai-agent] ❌ Image vision error:', imgErr);
      }
    }

    let aiData: any = null;

    // Anthropic vision content (declared here for scope across initial call and follow-up)
    let anthropicUserContent: any = content;

    if (!mediaFallbackReply && isAnthropicModel) {
      // â"€â"€ Direct Anthropic API call with tool calling â"€â"€
      const anthropicModelRaw = rawModel.replace("anthropic/", "");
      // Normalize short aliases to full valid model IDs
      const anthropicModelMap: Record<string, string> = {
        "claude-3-5-sonnet": "claude-3-5-sonnet-20241022",
        "claude-3.5-sonnet": "claude-3-5-sonnet-20241022",
        "claude-3-sonnet": "claude-3-sonnet-20240229",
        "claude-3-haiku": "claude-3-haiku-20240307",
      };
      const anthropicModel = anthropicModelMap[anthropicModelRaw] || anthropicModelRaw;
      if (visionContent) {
        const textPart = visionContent.find((c: any) => c.type === "text");
        const imgPart = visionContent.find((c: any) => c.type === "image_url");
        if (imgPart?.image_url?.url?.startsWith("data:")) {
          const [header, b64] = imgPart.image_url.url.split(",");
          const mime = header.replace("data:", "").replace(";base64", "");
          anthropicUserContent = [
            { type: "text", text: textPart?.text || "[Imagem recebida]" },
            { type: "image", source: { type: "base64", media_type: mime, data: b64 } },
          ];
        }
      }
      const anthropicMessages = [
        ...historyMessages.slice(-14).map((m: any) => ({
          role: m.role === "system" ? "user" : m.role,
          content: m.content,
        })),
        { role: "user", content: anthropicUserContent },
      ];

      // Convert OpenAI-format tools to Anthropic format
      const anthropicTools = crmTools.map((t: any) => ({
        name: t.function.name,
        description: t.function.description,
        input_schema: t.function.parameters,
      }));

      console.log(`[ai-agent] Calling Anthropic directly with model: ${anthropicModel}, tools: ${anthropicTools.length}`);

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
          tools: anthropicTools,
        }),
      });

      if (res.ok) {
        const anthropicData = await res.json();
        // Check if response contains tool_use blocks
        const toolUseBlocks = (anthropicData.content || []).filter((b: any) => b.type === "tool_use");
        const textBlocks = (anthropicData.content || []).filter((b: any) => b.type === "text");
        const textContent = textBlocks.map((b: any) => b.text).join("\n").trim();

        if (toolUseBlocks.length > 0) {
          // Normalize Anthropic tool_use to OpenAI-like tool_calls format
          const toolCalls = toolUseBlocks.map((b: any) => ({
            id: b.id,
            type: "function",
            function: {
              name: b.name,
              arguments: JSON.stringify(b.input),
            },
          }));
          aiData = {
            choices: [{
              message: {
                content: textContent,
                tool_calls: toolCalls,
              },
            }],
          };
        } else {
          // No tool calls, just text
          aiData = {
            choices: [{
              message: {
                content: textContent,
              },
            }],
          };
        }
      } else {
        const errBody = await res.text().catch(() => "");
        console.error(`[ai-agent] Anthropic error: ${res.status} - ${errBody}`);
      }
    } else if (!mediaFallbackReply) {
      // â”€â”€ Lovable AI Gateway call â”€â”€
      const modelMap: Record<string, string> = {
        "google/gemini-3-flash-preview": "google/gemini-2.5-flash",
        "gemini-3-flash-preview": "google/gemini-2.5-flash",
        "google/gemini-2.0-flash": "google/gemini-2.5-flash",
        "openai/gpt-3.5-turbo": "openai/gpt-4o-mini",
        "openai/gpt-5": "google/gemini-2.5-pro",
        "openai/gpt-5-mini": "google/gemini-2.5-flash",
        "openai/gpt-5-nano": "google/gemini-2.5-flash-lite",
        "openai/gpt-5.2": "google/gemini-2.5-pro",
      };
      const selectedModel = modelMap[rawModel] || rawModel;
      const isOpenAI = selectedModel.startsWith("openai/");

      // If we have vision content and model supports it, upgrade to gpt-4o
      let effectiveModel = selectedModel;
      if (visionContent && (selectedModel === 'openai/gpt-4o-mini' || selectedModel === 'openai/gpt-3.5-turbo')) {
        effectiveModel = 'openai/gpt-4o';
        console.log(`[ai-agent] 🖼️ Image detected — upgrade model from ${selectedModel} to ${effectiveModel} for vision`);
      }

      const aiMessages = [
        { role: "system", content: systemPrompt },
        ...historyMessages.slice(-14),
        { role: "user", content: visionContent || content },
      ];

      const aiPayload: any = {
        model: effectiveModel,
        messages: aiMessages,
        temperature: effectiveTemp,
        tools: crmTools,
        tool_choice: "auto",
        ...(isOpenAI ? { max_completion_tokens: maxTokensValue } : { max_tokens: maxTokensValue }),
      };

      console.log(`[ai-agent] Calling AI Gateway with model: ${effectiveModel}, history: ${historyMessages.length} msgs${visionContent ? ', WITH IMAGE VISION' : ''}`);

      const modelsToTry = [effectiveModel, "google/gemini-2.5-flash"];
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

    if (!mediaFallbackReply && !aiData) {
      console.error("[ai-agent] All AI models failed");
      return;
    }

    let replyText = mediaFallbackReply || aiData?.choices?.[0]?.message?.content?.trim() || "";
    const aiMessage = aiData?.choices?.[0]?.message;
    if (!mediaFallbackReply && aiMessage?.tool_calls && aiMessage.tool_calls.length > 0) {
      const toolMessages: any[] = [];

      for (const toolCall of aiMessage.tool_calls) {
        try {
          if (toolCall.function?.name === "atualizar_etapa_crm") {
            const args = JSON.parse(toolCall.function.arguments);
            console.log(`[ai-agent-crm] Lead ${phone} -> status: ${args.status}, fields: ${Object.keys(args).join(",")}`);

            // Build structured update data from all available fields
            const updateData: any = {
              status: args.status,
              summary: args.resumo,
              last_interaction_at: new Date().toISOString(),
            };

            // Map tool parameters to database columns
            if (args.nome_cliente) {
              updateData.client_name = args.nome_cliente;
              updateData.lead_name = args.nome_cliente; // Update lead_name with real name
            }
            if (args.cidade) updateData.client_city = args.cidade;
            if (args.veiculo_interesse) updateData.vehicle_interest = args.veiculo_interesse;
            if (args.forma_pagamento) updateData.payment_method = args.forma_pagamento;
            if (args.orcamento) updateData.budget = args.orcamento;
            if (args.carro_troca) updateData.trade_in_vehicle = args.carro_troca;
            if (args.entrada) updateData.down_payment = args.entrada;
            if (args.parcela_ideal) updateData.desired_installment = args.parcela_ideal;
            if (args.cpf) updateData.cpf = args.cpf;
            if (args.data_nascimento) updateData.birth_date = args.data_nascimento;
            if (args.etapa_funil) updateData.funnel_stage = args.etapa_funil;
            if (args.temperatura) updateData.temperature = args.temperatura;
            if (args.visita_agendada) updateData.visit_scheduled = args.visita_agendada;
            if (args.observacoes) updateData.additional_notes = args.observacoes;

            const { data: existingLead } = await supabase
              .from("ai_crm_leads")
              .select("id")
              .eq("agent_id", agent.id)
              .eq("remote_jid", phone)
              .maybeSingle();

            if (existingLead) {
              await supabase.from("ai_crm_leads").update(updateData).eq("id", existingLead.id);
            } else {
              await supabase.from("ai_crm_leads").insert({
                user_id: instance.user_id,
                agent_id: agent.id,
                instance_id: instance.id,
                remote_jid: phone,
                lead_name: args.nome_cliente || pushName || phone,
                ...updateData,
              });
            }

            if (args.status === "qualificado") {
              await transferLeadToSeller(supabase, instance, agent, phone, pushName, args.resumo, historyMessages);
            }

            toolMessages.push({
              role: "tool",
              tool_call_id: toolCall.id,
              content: JSON.stringify({ success: true, status: args.status, dados_salvos: Object.keys(updateData).length }),
            });
          }

          if (toolCall.function?.name === "consultar_estoque_bndv") {
            const args = JSON.parse(toolCall.function.arguments || "{}");
            const stockResult = await consultarEstoqueBndv(supabase, instance.user_id, args);
            console.log(`[ai-agent-bndv] Consulta executada | success: ${stockResult.success} | total: ${stockResult.total || 0}`);
            toolMessages.push({
              role: "tool",
              tool_call_id: toolCall.id,
              content: JSON.stringify(stockResult),
            });
          }

          if (toolCall.function?.name === "enviar_foto") {
            const args = JSON.parse(toolCall.function.arguments || "{}");
            const imageUrl = args.url;
            const caption = args.legenda || "";

            if (imageUrl) {
              try {
                // Get instance details for sending
                const { data: instForPhoto } = await supabase
                  .from("wa_instances")
                  .select("instance_name, provider, api_url, api_key_encrypted, meta_config")
                  .eq("id", instance.id)
                  .single();

                if (instForPhoto) {
                  const evolutionApiUrl = Deno.env.get("EVOLUTION_API_URL");
                  const evolutionApiKey = Deno.env.get("EVOLUTION_API_KEY");
                  const destination = replyTarget || phone;

                  if (instForPhoto.provider === "evolution") {
                    const apiUrl = (evolutionApiUrl || instForPhoto.api_url).replace(/\/+$/, "");
                    const apiKey = evolutionApiKey || instForPhoto.api_key_encrypted;

                    const imgRes = await fetch(`${apiUrl}/message/sendMedia/${instForPhoto.instance_name}`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json", apikey: apiKey },
                      body: JSON.stringify({
                        number: destination,
                        mediatype: "image",
                        media: imageUrl,
                        caption: caption,
                      }),
                    });

                    if (imgRes.ok) {
                      console.log(`[ai-agent-foto] Foto enviada para ${destination}: ${imageUrl.substring(0, 60)}...`);
                      // Save to inbox
                      await supabase.from("wa_inbox").insert({
                        user_id: instance.user_id,
                        instance_id: instance.id,
                        phone,
                        direction: "outgoing",
                        message_type: "image",
                        content: caption || "[Foto enviada]",
                        media_url: imageUrl,
                        is_read: true,
                        contact_name: pushName,
                      });
                    } else {
                      const errText = await imgRes.text().catch(() => "");
                      console.error(`[ai-agent-foto] Erro ao enviar: ${imgRes.status} - ${errText}`);
                    }
                  } else if (instForPhoto.provider === "meta") {
                    const metaConfig = instForPhoto.meta_config || {};
                    const phoneNumberId = metaConfig.phone_number_id;
                    const accessToken = metaConfig.access_token_encrypted || instForPhoto.api_key_encrypted;

                    if (phoneNumberId && accessToken) {
                      const imgRes = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
                        method: "POST",
                        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
                        body: JSON.stringify({
                          messaging_product: "whatsapp",
                          to: phone,
                          type: "image",
                          image: { link: imageUrl, caption: caption },
                        }),
                      });
                      if (imgRes.ok) {
                        console.log(`[ai-agent-foto] Foto Meta enviada para ${phone}`);
                        await supabase.from("wa_inbox").insert({
                          user_id: instance.user_id,
                          instance_id: instance.id,
                          phone,
                          direction: "outgoing",
                          message_type: "image",
                          content: caption || "[Foto enviada]",
                          media_url: imageUrl,
                          is_read: true,
                          contact_name: pushName,
                        });
                      }
                    }
                  }
                }
              } catch (photoErr) {
                console.error("[ai-agent-foto] Erro:", photoErr);
              }
            }

            toolMessages.push({
              role: "tool",
              tool_call_id: toolCall.id,
              content: JSON.stringify({ success: true, message: "Foto enviada com sucesso ao cliente." }),
            });
          }
        } catch (err) {
          console.error(`[ai-agent] Tool call processing error (${toolCall.function?.name}):`, err);
          toolMessages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: JSON.stringify({ success: false, error: err instanceof Error ? err.message : "Erro inesperado na ferramenta." }),
          });
        }
      }

      if (toolMessages.length > 0) {
        console.log(`[ai-agent] Follow-up após ${toolMessages.length} tool(s)`);

        if (isAnthropicModel) {
          // Anthropic follow-up: convert messages to Anthropic format
          const anthropicModel = rawModel.replace("anthropic/", "");
          // Build Anthropic-format follow-up: user msg, assistant with tool_use, tool results
          const anthropicFollowUpMessages = [
            ...historyMessages.slice(-14).map((m: any) => ({
              role: m.role === "system" ? "user" : m.role,
              content: m.content,
            })),
            { role: "user", content: anthropicUserContent || content },
            {
              role: "assistant",
              content: [
                ...(aiMessage.content ? [{ type: "text", text: aiMessage.content }] : []),
                ...aiMessage.tool_calls.map((tc: any) => ({
                  type: "tool_use",
                  id: tc.id,
                  name: tc.function.name,
                  input: JSON.parse(tc.function.arguments),
                })),
              ],
            },
            {
              role: "user",
              content: toolMessages.map((tm: any) => ({
                type: "tool_result",
                tool_use_id: tm.tool_call_id,
                content: tm.content,
              })),
            },
          ];

          const followUpRes = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
              "x-api-key": ANTHROPIC_API_KEY!,
              "anthropic-version": "2023-06-01",
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: anthropicModel,
              system: systemPrompt,
              messages: anthropicFollowUpMessages,
              max_tokens: maxTokensValue,
              temperature: effectiveTemp,
            }),
          });

          if (followUpRes.ok) {
            const followUpData = await followUpRes.json();
            const followUpText = (followUpData.content || [])
              .filter((b: any) => b.type === "text")
              .map((b: any) => b.text)
              .join("\n")
              .trim();
            replyText = followUpText || replyText || "";
          }
        } else {
          // Gateway follow-up (OpenAI-format)
          const followUpMessages = [
            { role: "system", content: systemPrompt },
            ...historyMessages.slice(-14),
            { role: "user", content: visionContent || content },
            aiMessage,
            ...toolMessages,
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
            replyText = followUpData.choices?.[0]?.message?.content?.trim() || replyText || "";
          }
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
      .replace(/^[-â€¢]\s/gm, "")         // Remove bullet points
      .replace(/^\d+\.\s/gm, "")        // Remove numbered lists
      .replace(/^#+\s/gm, "")           // Remove headers
      .trim();

    // Simulate typing delay
    const delay = agent.reply_delay_ms || 3000;
    await new Promise(resolve => setTimeout(resolve, Math.min(delay, 10000)));

    // Send the reply via UazAPI
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
        console.error(`[ai-agent] UazAPI send error: ${sendRes.status} - ${errText}`);
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
      .eq("user_id", instance.user_id)
      .eq("is_active", true)
      .order("last_lead_received_at", { ascending: true, nullsFirst: true });

    if (!sellers || sellers.length === 0) {
      console.log("[transfer] No active sellers found for agent:", agent.id);
      return;
    }

    // 1.5. Fetch full lead data with structured fields for the notification
    const { data: leadRecord } = await supabase
      .from("ai_crm_leads")
      .select("id, status, assigned_to_id, client_name, client_city, vehicle_interest, payment_method, budget, trade_in_vehicle, down_payment, desired_installment, cpf, birth_date, funnel_stage, temperature, visit_scheduled, additional_notes")
      .eq("agent_id", agent.id)
      .eq("remote_jid", phone)
      .maybeSingle();

    // Prevent duplicate transfers
    if (leadRecord && leadRecord.assigned_to_id) {
       console.log(`[transfer] Lead ${phone} already assigned to member ${leadRecord.assigned_to_id}. Aborting duplicate broadcast.`);
       return;
    }

    // 2. Round-Robin: pick seller with oldest last_lead_received_at
    const selectedSeller = sellers[0]; // Already sorted by last_lead_received_at ASC (oldest first)
    console.log(`[transfer] Selected seller: ${selectedSeller.name} (${selectedSeller.whatsapp_number})`);

    // 3. Build structured seller notification with all collected client data
    const ld = leadRecord || {} as any;
    const clientName = ld.client_name || pushName || "Nao informado";
    const clientCity = ld.client_city || "Nao informada";
    const vehicleInterest = ld.vehicle_interest || "Nao informado";
    const paymentLabels: Record<string, string> = { a_vista: "A vista", troca: "Troca", financiamento: "Financiamento" };
    const paymentMethod = paymentLabels[ld.payment_method] || ld.payment_method || "Nao informada";
    const tempLabels: Record<string, string> = { frio: "Frio", morno: "Morno", quente: "QUENTE" };
    const tempLabel = tempLabels[ld.temperature] || "Morno";
    const funnelLabels: Record<string, string> = { abordagem: "Abordagem", modelagem: "Modelagem", fechamento: "Fechamento" };
    const funnelLabel = funnelLabels[ld.funnel_stage] || "Modelagem";

    // Build optional sections only if data exists
    let financingSection = "";
    if (ld.payment_method === "financiamento") {
      const parts: string[] = [];
      if (ld.cpf) parts.push(`CPF: ${ld.cpf}`);
      if (ld.birth_date) parts.push(`Nascimento: ${ld.birth_date}`);
      if (ld.desired_installment) parts.push(`Parcela ideal: ${ld.desired_installment}`);
      if (ld.down_payment) parts.push(`Entrada: ${ld.down_payment}`);
      if (parts.length > 0) {
        financingSection = `\n*Dados p/ financiamento:*\n${parts.join("\n")}\n`;
      }
    }

    let tradeSection = "";
    if (ld.payment_method === "troca" && ld.trade_in_vehicle) {
      tradeSection = `\n*Carro de troca:* ${ld.trade_in_vehicle}\n`;
      if (ld.down_payment) tradeSection += `*Diferenca:* ${ld.down_payment}\n`;
    }

    let visitSection = "";
    if (ld.visit_scheduled) {
      visitSection = `\n*Visita agendada:* ${ld.visit_scheduled}\n`;
    }

    let notesSection = "";
    if (ld.additional_notes) {
      notesSection = `\n*Obs:* ${ld.additional_notes}\n`;
    }

    const conversationText = historyMessages
      .slice(-8)
      .map((m) => `${m.role === "user" ? "Cliente" : "IA"}: ${m.content}`)
      .join("\n");

    const sellerMsg = `*LEAD QUALIFICADO - ${tempLabel.toUpperCase()}*

*Nome:* ${clientName}
*Contato:* ${phone}
*Cidade:* ${clientCity}

*Veiculo:* ${vehicleInterest}
*Pagamento:* ${paymentMethod}
${ld.budget ? `*Orcamento:* ${ld.budget}
` : ""}${financingSection}${tradeSection}${visitSection}${notesSection}
*Etapa:* ${funnelLabel}
*Temperatura:* ${tempLabel}

*Resumo da IA:*
${summary}

*Ultimas mensagens:*
${conversationText}

*Atender agora:* https://wa.me/${phone.replace(/\D/g, "")}

O cliente esta esperando!`;

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
           console.error(`[transfer] UazAPI error sending to seller: ${sRes.status} - ${await sRes.text()}`);
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

    // 6. Record transfer in ai_lead_transfers (reuse leadRecord from step 1.5)
    if (leadRecord) {
      await supabase.from("ai_lead_transfers").insert({
        user_id: instance.user_id,
        lead_id: leadRecord.id,
        to_member_id: selectedSeller.id,
        transfer_reason: "round_robin",
        notes: `Transferido para ${selectedSeller.name}. Cliente: ${clientName}, Cidade: ${clientCity}, Veiculo: ${vehicleInterest}, Pagamento: ${paymentMethod}`,
        transfer_status: "pending",
        is_confirmed: false,
        confirmation_timeout_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      });

      // Update lead with transfer info
      await supabase.from("ai_crm_leads").update({
        status: "transferido",
        assigned_to_id: selectedSeller.id,
        last_interaction_at: new Date().toISOString(),
      }).eq("id", leadRecord.id);
    }

    console.log(`[transfer] Lead ${phone} (${clientName}) transferred to ${selectedSeller.name} successfully`);
  } catch (err) {
    console.error("[transfer] Error transferring lead:", err);
  }
}

// ====================== OPT-IN/OPT-OUT CONFIRMATION MESSAGES ======================

async function sendOptoutConfirmation(supabase: any, instance: any, phone: string, replyTarget?: string) {
  try {
    const confirmMsg = "âœ… Sua solicitaÃ§Ã£o foi processada. VocÃª nÃ£o receberÃ¡ mais mensagens nossas. Caso mude de ideia, basta nos enviar uma mensagem. Obrigado! ðŸ™";
    await sendAutoReply(supabase, instance, phone, confirmMsg, replyTarget);
  } catch (err) {
    console.error("[opt-out] Failed to send confirmation:", err);
  }
}

async function sendOptinConfirmation(supabase: any, instance: any, phone: string, replyTarget?: string) {
  try {
    const confirmMsg = "ðŸŽ‰ Que bom que vocÃª quer continuar! Vamos enviar apenas conteÃºdos relevantes para vocÃª. Obrigado pela confianÃ§a! ðŸ’š";
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
      console.error("[auto-reply] UazAPI send error:", await res.text());
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
          content: `VocÃª Ã© um classificador de mensagens de WhatsApp. Analise a mensagem e retorne APENAS um JSON com:
- "category": uma das opÃ§Ãµes: "interested", "question", "opt-out", "positive", "negative", "neutral", "spam"
- "sentiment": uma das opÃ§Ãµes: "positive", "negative", "neutral"

Regras:
- "opt-out": se a pessoa pede pra parar de receber mensagens
- "interested": se demonstra interesse em comprar, saber mais
- "question": se faz uma pergunta sobre o produto/serviÃ§o
- "positive": elogio ou feedback positivo
- "negative": reclamaÃ§Ã£o ou feedback negativo
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
      console.error("[audio-transcribe] Missing UazAPI credentials");
      return null;
    }

    const key = messageData.key || {};
    const message = messageData.message || messageData;
    console.log(`[audio-transcribe] Requesting base64 from UazAPI: ${apiUrl}/chat/getBase64FromMediaMessage/${instanceName}`);
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

    console.log(`[audio-transcribe] UazAPI response status: ${mediaRes.status}`);

    if (mediaRes.ok) {
      const mediaData = await mediaRes.json();
      console.log(`[audio-transcribe] UazAPI response keys: ${JSON.stringify(Object.keys(mediaData))}`);
      base64Audio = mediaData.base64 || mediaData.data?.base64 || mediaData.mediaBase64 || null;
      mimetype = mediaData.mimetype || mediaData.data?.mimetype || message.audioMessage?.mimetype || "audio/ogg";
    } else {
      const errText = await mediaRes.text();
      console.error(`[audio-transcribe] UazAPI getBase64 failed: ${mediaRes.status} - ${errText}`);
      
      // Attempt 2: Try with just key (some UazAPI versions)
      const mediaRes2 = await fetch(`${apiUrl}/chat/getBase64FromMediaMessage/${instanceName}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: apiKey,
        },
        body: JSON.stringify({ message: { key }, convertToMp4: false }),
      });

      console.log(`[audio-transcribe] UazAPI retry status: ${mediaRes2.status}`);
      if (mediaRes2.ok) {
        const mediaData2 = await mediaRes2.json();
        base64Audio = mediaData2.base64 || mediaData2.data?.base64 || mediaData2.mediaBase64 || null;
        mimetype = mediaData2.mimetype || mediaData2.data?.mimetype || message.audioMessage?.mimetype || "audio/ogg";
      } else {
        await mediaRes2.text(); // consume body
      }
    }

    if (!base64Audio) {
      console.error("[audio-transcribe] No base64 audio returned from UazAPI after all attempts");
      return null;
    }

    console.log(`[audio-transcribe] Got base64 audio, length: ${base64Audio.length}, mimetype: ${mimetype}`);
    return await transcribeWithGemini(base64Audio, mimetype);
  } catch (err) {
    console.error("[audio-transcribe] UazAPI transcription error:", err);
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
                  text: "Transcreva este Ã¡udio de forma precisa. Retorne APENAS o texto falado, sem comentÃ¡rios adicionais, formataÃ§Ã£o ou prefixos como 'TranscriÃ§Ã£o:'. Se o Ã¡udio estiver vazio ou inaudÃ­vel, retorne exatamente: [Ã¡udio inaudÃ­vel]",
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

    if (!transcription || transcription === "[Ã¡udio inaudÃ­vel]") {
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


