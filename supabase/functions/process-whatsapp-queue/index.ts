import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Process ONE item per invocation to avoid edge function timeout with humanized delays
const BATCH_SIZE = 1;
const MAX_RETRIES = 5;
// Items stuck in "processing" for more than this time (ms) are considered stale
const STALE_LOCK_MS = 90_000; // 90 seconds
const CIRCUIT_BREAKER_THRESHOLD = 5;
const OUTBOUND_FETCH_TIMEOUT_MS = 10_000;
const PRESENCE_FETCH_TIMEOUT_MS = 2_500;
const AI_FETCH_TIMEOUT_MS = 12_000;

const instanceFailures = new Map<string, number>();

interface QueueItem {
  id: string;
  user_id: string;
  campaign_id: string;
  contact_id: string | null;
  phone: string;
  message: string;
  media_url: string | null;
  media_type: string | null;
  status: string;
  retry_count: number;
  scheduled_for: string | null;
  contact_metadata: any;
  contact_name: string | null;
}

interface Instance {
  id: string;
  user_id: string;
  instance_name: string;
  api_url: string;
  api_key_encrypted: string;
  phone_number: string | null;
  status: string;
  is_active: boolean;
  health_score: number;
  messages_sent_today: number;
  created_at: string;
  provider: string;
  meta_config: any;
  last_used_at: string | null;
  last_message_at: string | null;
}

interface Campaign {
  id: string;
  prompt_base: string | null;
  message_template: string;
  min_delay_seconds: number;
  max_delay_seconds: number;
  rotation_messages_per_instance: number;
  regras_rodizio: any;
  regras_delay: any;
  regras_aquecimento: any;
  started_at: string | null;
  variation_level: string;
  sent_count: number;
  instance_id: string | null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // ===== RECOVER STALE LOCKS =====
    // Reset items stuck in "processing" for too long (edge function timed out previously)
    const staleThreshold = new Date(Date.now() - STALE_LOCK_MS).toISOString();
    const { data: staleItems, error: staleErr } = await supabase
      .from("wa_queue")
      .update({ status: "pending" })
      .eq("status", "processing")
      .lt("scheduled_for", staleThreshold)
      .select("id");

    if (!staleErr && staleItems && staleItems.length > 0) {
      console.log(`Recovered ${staleItems.length} stale processing items back to pending`);
    }

    const { data: queueItems, error: queueErr } = await supabase
      .from("wa_queue")
      .select("*")
      .eq("status", "pending")
      .lte("scheduled_for", new Date().toISOString())
      .order("scheduled_for", { ascending: true })
      .limit(BATCH_SIZE);

    if (queueErr) {
      console.error("Queue fetch error:", queueErr);
      return new Response(JSON.stringify({ error: "Queue fetch failed" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!queueItems || queueItems.length === 0) {
      return new Response(JSON.stringify({ processed: 0, message: "No pending items" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const items = queueItems as unknown as QueueItem[];

    // Fetch campaign configs
    const campaignIds = [...new Set(items.map((i) => i.campaign_id).filter(Boolean))];
    const campaignMap = new Map<string, Campaign>();

    if (campaignIds.length > 0) {
      const { data: campaigns } = await supabase
        .from("wa_campaigns")
        .select("id, prompt_base, message_template, min_delay_seconds, max_delay_seconds, rotation_messages_per_instance, regras_rodizio, regras_delay, regras_aquecimento, started_at, variation_level, sent_count, instance_id")
        .in("id", campaignIds);
      if (campaigns) {
        for (const c of campaigns as unknown as Campaign[]) {
          campaignMap.set(c.id, c);
        }
      }
    }

    // ===== CHECK: Skip campaigns that are paused/cancelled BEFORE fetching instances =====
    const activeCampaignIds = new Set<string>();
    for (const cid of campaignIds) {
      const campaign = campaignMap.get(cid);
      if (campaign) {
        // Re-check status from DB (in case it was just paused)
        const { data: freshStatus } = await supabase
          .from("wa_campaigns")
          .select("status")
          .eq("id", cid)
          .single();
        if (freshStatus && (freshStatus.status === "paused" || freshStatus.status === "cancelled")) {
          console.log(`Campaign ${cid} is ${freshStatus.status}, returning all its items to pending`);
          await supabase
            .from("wa_queue")
            .update({ status: "pending" })
            .eq("campaign_id", cid)
            .eq("status", "processing");
        } else {
          activeCampaignIds.add(cid);
        }
      }
    }

    // Filter items to only process active campaigns
    const activeItems = items.filter(
      (i) => !i.campaign_id || activeCampaignIds.has(i.campaign_id)
    );

    if (activeItems.length === 0) {
      return new Response(JSON.stringify({ processed: 0, message: "All campaigns paused" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch instances per user
    const userIds = [...new Set(activeItems.map((i) => i.user_id))];
    const instanceMap = new Map<string, Instance[]>();

    for (const uid of userIds) {
      const { data: instances } = await supabase
        .from("wa_instances")
        .select("*")
        .eq("user_id", uid)
        .eq("is_active", true)
        .eq("status", "connected")
        .order("health_score", { ascending: false });
      if (instances && instances.length > 0) {
        instanceMap.set(uid, instances as unknown as Instance[]);
      }
    }

    let processed = 0, succeeded = 0, failed = 0;

    // Track recent message hashes to prevent duplicate messages
    const recentMessageHashes = new Set<string>();

    for (const item of activeItems) {
      let selectedInstance: Instance | null = null;
      try {
        // ===== RE-CHECK campaign status before EVERY single message =====
        if (item.campaign_id) {
          const { data: liveStatus } = await supabase
            .from("wa_campaigns")
            .select("status")
            .eq("id", item.campaign_id)
            .single();

          if (liveStatus && (liveStatus.status === "paused" || liveStatus.status === "cancelled")) {
            console.log(`Campaign ${item.campaign_id} paused/cancelled mid-batch, stopping`);
            await supabase
              .from("wa_queue")
              .update({ status: "pending" })
              .eq("id", item.id);
            processed++;
            continue;
          }
        }

        const { data: lockRow, error: lockErr } = await supabase
          .from("wa_queue")
          .update({
            status: "processing",
            // Reuse scheduled_for as lock timestamp for reliable stale-lock recovery
            scheduled_for: new Date().toISOString(),
          })
          .eq("id", item.id)
          .eq("status", "pending")
          .select("id")
          .maybeSingle();

        if (lockErr) {
          throw new Error(`Failed to lock queue item: ${lockErr.message}`);
        }

        // Another worker already took this item
        if (!lockRow) {
          continue;
        }

        const campaign = item.campaign_id ? campaignMap.get(item.campaign_id) : null;
        const userInstances = instanceMap.get(item.user_id);

        if (!userInstances || userInstances.length === 0) {
          await markFailed(supabase, item.id, "No active WhatsApp instances available");
          failed++; processed++; continue;
        }

        // --- Smart Switcher: Instance Selection ---
        const instance = await selectSmartInstance(
          userInstances, item, campaign, instanceFailures
        );

        if (!instance) {
          await markFailed(supabase, item.id, "All instances circuit-broken or at warmup limit");
          failed++; processed++; continue;
        }

        selectedInstance = instance;

        // --- Generate UNIQUE AI message for EACH contact ---
        let finalMessage = item.message;
        const variationLevel = campaign?.variation_level || "medium";

        if (campaign?.prompt_base) {
          let genAttempts = 0;
          const maxGenAttempts = 3;
          let messageIsUnique = false;

          while (genAttempts < maxGenAttempts && !messageIsUnique) {
            try {
              finalMessage = await generateAIMessage(
                campaign.prompt_base,
                item.phone,
                item.contact_name,
                item.contact_metadata,
                variationLevel,
                campaign.message_template,
                supabase,
                item.user_id
              );

              const hash = await generateHash(finalMessage);
              if (!recentMessageHashes.has(hash)) {
                recentMessageHashes.add(hash);
                messageIsUnique = true;
              } else {
                console.log(`Duplicate message detected, regenerating (attempt ${genAttempts + 1})`);
                genAttempts++;
              }
            } catch (aiErr) {
              console.error("AI generation failed, using template with variation:", aiErr);
              // Fallback: add random suffix to template
              const suffixes = ["", " 😊", " 👋", "!", " 🙂", " ✨", ".", " 💡", " 🚀", " 📲"];
              const suffix = suffixes[Math.floor(Math.random() * suffixes.length)];
              finalMessage = (campaign.message_template || item.message) + suffix;
              messageIsUnique = true;
            }
          }
        }

        const messageHash = await generateHash(finalMessage);
        recentMessageHashes.add(messageHash);

        // Cleanup old hashes (keep last 30)
        if (recentMessageHashes.size > 30) {
          const arr = Array.from(recentMessageHashes);
          for (let i = 0; i < arr.length - 30; i++) {
            recentMessageHashes.delete(arr[i]);
          }
        }

        // ===== HUMANIZED SENDING SEQUENCE (kept short to fit edge function timeout) =====

        // Step 1: Go online (simulate opening WhatsApp)
        await simulateOnlinePresence(instance, item.phone);
        await sleep(300 + Math.random() * 600); // keep fast to stay inside edge timeout

        // Step 2: Type with realistic speed (bounded)
        const messageLength = finalMessage.length;
        const typingSpeedCps = 18 + Math.random() * 10;
        const totalTypingMs = Math.max(800, Math.min((messageLength / typingSpeedCps) * 1000, 4000));
        await simulateTyping(instance, item.phone, totalTypingMs);

        // Step 3: Brief review before hitting send
        await sleep(200 + Math.random() * 500);

        // Step 5: SEND (re-check pause right before sending)
        if (item.campaign_id) {
          const { data: statusBeforeSend } = await supabase
            .from("wa_campaigns")
            .select("status")
            .eq("id", item.campaign_id)
            .single();

          if (statusBeforeSend && (statusBeforeSend.status === "paused" || statusBeforeSend.status === "cancelled")) {
            await supabase
              .from("wa_queue")
              .update({ status: "pending" })
              .eq("id", item.id);
            processed++;
            continue;
          }
        }

        await sendMessageByProvider(instance, item.phone, finalMessage, item.media_url, item.media_type);
        instanceFailures.set(instance.id, 0);

        // Step 6: Read receipt
        await sleep(200 + Math.random() * 500);
        await simulateReadReceipt(instance, item.phone);

        // Mark success
        const sentAt = new Date().toISOString();
        await supabase
          .from("wa_queue")
          .update({
            status: "sent",
            sent_at: sentAt,
            message: finalMessage,
            instance_id: instance.id,
            message_hash: messageHash,
          })
          .eq("id", item.id);

        // ===== SAVE TO CRM INBOX =====
        // Store every outgoing message so conversations appear in the unified inbox
        const { error: inboxErr } = await supabase.from("wa_inbox").insert({
          user_id: item.user_id,
          instance_id: instance.id,
          phone: item.phone.replace(/\D/g, ""),
          contact_name: item.contact_name || null,
          direction: "outgoing",
          message_type: item.media_type || "text",
          content: finalMessage,
          media_url: item.media_url || null,
          is_read: true,
          created_at: sentAt,
        });
        if (inboxErr) {
          console.warn("Failed to save outgoing message to inbox:", inboxErr);
        }

        // Update instance counters
        await supabase
          .from("wa_instances")
          .update({
            messages_sent_today: instance.messages_sent_today + 1,
            last_message_at: new Date().toISOString(),
            last_used_at: new Date().toISOString(),
          })
          .eq("id", instance.id);

        if (item.contact_id) {
          await supabase
            .from("wa_contacts")
            .update({ last_message_at: new Date().toISOString() })
            .eq("id", item.contact_id);
        }

        if (item.campaign_id) {
          const { error: rpcErr } = await supabase.rpc("increment_campaign_sent", { cid: item.campaign_id });
          if (rpcErr) console.error("increment_campaign_sent failed:", rpcErr);
          if (campaign) campaign.sent_count = (campaign.sent_count || 0) + 1;
        }

        succeeded++;

        // ===== SCHEDULE NEXT ITEM WITH HUMANIZED DELAY =====
        // Instead of sleeping (which can timeout the edge function),
        // we push the scheduled_for of the next pending item forward.
        const delayRules = campaign?.regras_delay || {};
        const rotationRules = campaign?.regras_rodizio || {};
        const minD = delayRules.min || campaign?.min_delay_seconds || 20;
        const maxD = delayRules.max || campaign?.max_delay_seconds || 60;
        const delaySec = minD + Math.random() * (maxD - minD);
        // 20% chance of longer pause (60-120s extra) for human-like behavior
        const longPauseSec = Math.random() < 0.20 ? (60 + Math.random() * 60) : 0;

        const rotationLimit = Math.max(
          1,
          rotationRules.mensagens_por_instancia || campaign?.rotation_messages_per_instance || 10,
        );
        const rotationPauseSec =
          campaign &&
          rotationRules.pausa_entre_instancias > 0 &&
          campaign.sent_count > 0 &&
          campaign.sent_count % rotationLimit === 0
            ? rotationRules.pausa_entre_instancias
            : 0;

        const totalDelaySec = delaySec + longPauseSec + rotationPauseSec;

        const nextScheduledFor = new Date(Date.now() + totalDelaySec * 1000).toISOString();
        console.log(`Next message scheduled in ${Math.round(totalDelaySec)}s`);

        // Update the next pending item for this campaign to respect the delay
        if (item.campaign_id) {
          const { data: nextItems } = await supabase
            .from("wa_queue")
            .select("id")
            .eq("campaign_id", item.campaign_id)
            .eq("status", "pending")
            .order("scheduled_for", { ascending: true })
            .limit(1);

          if (nextItems && nextItems.length > 0) {
            await supabase
              .from("wa_queue")
              .update({ scheduled_for: nextScheduledFor })
              .eq("id", nextItems[0].id);
          }
        }

      } catch (err) {
        console.error(`Error processing queue item ${item.id}:`, err);
        const errMsg = err instanceof Error ? err.message : "Unknown error";

        // Circuit breaker
        if (selectedInstance) {
          const currentFailures = (instanceFailures.get(selectedInstance.id) || 0) + 1;
          instanceFailures.set(selectedInstance.id, currentFailures);
          if (currentFailures >= CIRCUIT_BREAKER_THRESHOLD) {
            console.warn(`Circuit breaker triggered for instance ${selectedInstance.id}`);
            const { error: healthErr } = await supabase.rpc("decrement_instance_health", {
              instance_id: selectedInstance.id,
              decrement_value: 30,
            });
            if (healthErr) console.error("Health decrement failed:", healthErr);

              try {
                const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
                await fetchWithTimeout(`${supabaseUrl}/functions/v1/handle-instance-ban`, {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
                  },
                  body: JSON.stringify({
                    instance_id: selectedInstance.id,
                    user_id: item.user_id,
                  }),
                }, OUTBOUND_FETCH_TIMEOUT_MS);
            } catch (failoverErr) {
              console.error("Failover trigger failed:", failoverErr);
            }
          }
        }

        if (item.retry_count < MAX_RETRIES) {
          const retryDelay = Math.min(60000 * Math.pow(3, item.retry_count), 3600000);
          await supabase
            .from("wa_queue")
            .update({
              status: "pending",
              retry_count: item.retry_count + 1,
              error_message: errMsg,
              scheduled_for: new Date(Date.now() + retryDelay).toISOString(),
            })
            .eq("id", item.id);
        } else {
          await markFailed(supabase, item.id, errMsg);
        }
        failed++;
      }
      processed++;
    }

    // Check campaign completion
    for (const cid of campaignIds) {
      if (!activeCampaignIds.has(cid)) continue; // Don't mark paused as completed
      const { count } = await supabase
        .from("wa_queue")
        .select("id", { count: "exact", head: true })
        .eq("campaign_id", cid)
        .in("status", ["pending", "processing"]);
      if (count === 0) {
        await supabase
          .from("wa_campaigns")
          .update({ status: "completed", completed_at: new Date().toISOString() })
          .eq("id", cid);
      }
    }

    return new Response(
      JSON.stringify({ processed, succeeded, failed }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("process-whatsapp-queue error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// ====================== SMART SWITCHER ======================

async function selectSmartInstance(
  userInstances: Instance[],
  item: QueueItem,
  campaign: Campaign | null,
  failures: Map<string, number>
): Promise<Instance | null> {
  const aquecimento = campaign?.regras_aquecimento || {};
  const warmupDailyLimit = aquecimento.limite_diario_inicial || null;
  const warmupRampDays = aquecimento.dias_rampa || 7;

  const rodizio = campaign?.regras_rodizio || {};
  const rotationLimit = Math.max(1, rodizio.mensagens_por_instancia || campaign?.rotation_messages_per_instance || 10);
  const pauseBetweenInstances = rodizio.pausa_entre_instancias || 0;

  // If campaign is pinned to one instance, respect it
  const scopedInstances = campaign?.instance_id
    ? userInstances.filter((inst) => inst.id === campaign.instance_id)
    : userInstances;

  if (scopedInstances.length === 0) {
    return null;
  }

  const isContactCold = !item.contact_metadata?.last_message_at;

  const sortedInstances = [...scopedInstances].sort((a, b) => {
    if (isContactCold) {
      const totalHealth = scopedInstances.reduce((sum, inst) => sum + inst.health_score, 0);
      if (totalHealth > 0) {
        return (b.health_score / totalHealth) - (a.health_score / totalHealth);
      }
      return b.health_score - a.health_score;
    }
    const aTime = a.last_used_at ? new Date(a.last_used_at).getTime() : 0;
    const bTime = b.last_used_at ? new Date(b.last_used_at).getTime() : 0;
    return bTime - aTime;
  });

  // Persistent rotation based on already sent messages from database
  const sentCount = Math.max(0, campaign?.sent_count || 0);
  const rotationCycle = Math.floor(sentCount / rotationLimit);
  const startIndex = rotationCycle % sortedInstances.length;

  let instance: Instance | null = null;

  for (let attempts = 0; attempts < sortedInstances.length; attempts++) {
    const candidate = sortedInstances[(startIndex + attempts) % sortedInstances.length];
    const candidateFailures = failures.get(candidate.id) || 0;

    if (candidateFailures >= CIRCUIT_BREAKER_THRESHOLD) continue;

    if (warmupDailyLimit && candidate.created_at) {
      const instanceAgeDays = Math.floor(
        (Date.now() - new Date(candidate.created_at).getTime()) / (1000 * 60 * 60 * 24)
      );
      if (instanceAgeDays < warmupRampDays) {
        const rampMultiplier = Math.min(1, (instanceAgeDays + 1) / warmupRampDays);
        const dailyLimit = Math.floor(warmupDailyLimit * rampMultiplier);
        if (candidate.messages_sent_today >= dailyLimit) continue;
      }
    }

    if (candidate.health_score < 20) continue;

    if (candidate.provider === "meta") {
      const metaLimit = candidate.health_score >= 80 ? 1000 : 250;
      if (candidate.messages_sent_today >= metaLimit) continue;
    }

    instance = candidate;
    break;
  }

  // Never sleep here: long pauses must be applied by scheduling the NEXT item,
  // otherwise the edge function can hit timeout and leave the queue locked.
  void pauseBetweenInstances;

  return instance;
}

// ====================== PROVIDER ABSTRACTION ======================

async function sendMessageByProvider(
  instance: Instance,
  phone: string,
  text: string,
  mediaUrl: string | null,
  mediaType: string | null
) {
  if (instance.provider === "meta") {
    await sendToMetaAPI(instance, phone, text, mediaUrl, mediaType);
  } else {
    await sendToEvolutionAPI(instance, phone, text, mediaUrl, mediaType);
  }
}

async function sendToMetaAPI(
  instance: Instance,
  phone: string,
  text: string,
  mediaUrl: string | null,
  mediaType: string | null
) {
  const config = instance.meta_config || {};
  const phoneNumberId = config.phone_number_id;
  const accessToken = config.access_token_encrypted;

  if (!phoneNumberId || !accessToken) {
    throw new Error("Meta API config incomplete: missing phone_number_id or access_token");
  }

  const number = phone.replace(/\D/g, "");
  const url = `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`;

  let messageBody: any;

  if (mediaUrl && mediaType) {
    const metaMediaType = mediaType === "image" ? "image" :
      mediaType === "video" ? "video" :
      mediaType === "audio" ? "audio" : "document";

    messageBody = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: number,
      type: metaMediaType,
      [metaMediaType]: {
        link: mediaUrl,
        ...(text && metaMediaType !== "audio" ? { caption: text } : {}),
      },
    };
  } else {
    messageBody = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: number,
      type: "text",
      text: { preview_url: false, body: text },
    };
  }

  const response = await fetchWithTimeout(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(messageBody),
  }, OUTBOUND_FETCH_TIMEOUT_MS);

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Meta API error: ${response.status} - ${errText}`);
  }
  await response.text();
}

// ====================== EVOLUTION API (V2 COMPATIBLE) ======================

async function sendToEvolutionAPI(
  instance: Instance,
  phone: string,
  text: string,
  mediaUrl: string | null,
  mediaType: string | null
) {
  const apiUrl = instance.api_url.replace(/\/+$/, "");
  const number = phone.replace(/\D/g, "");

  if (mediaUrl && mediaType) {
    // Evolution API v2: /message/sendMedia/{instance}
    const v2Endpoint = `${apiUrl}/message/sendMedia/${instance.instance_name}`;
    const v1Endpoints: Record<string, string> = {
      image: "sendImage",
      video: "sendVideo",
      audio: "sendAudio",
      document: "sendDocument",
    };

    const mediaPayload = {
      number,
      mediatype: mediaType,
      media: mediaUrl,
      caption: text || "",
      fileName: mediaType === "document" ? "file" : undefined,
    };

    let response = await fetchWithTimeout(v2Endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: instance.api_key_encrypted },
      body: JSON.stringify(mediaPayload),
    }, OUTBOUND_FETCH_TIMEOUT_MS);

    if (response.status === 404) {
      await response.text(); // consume v2 body
      const v1Action = v1Endpoints[mediaType] || "sendDocument";
      response = await fetchWithTimeout(`${apiUrl}/message/${v1Action}/${instance.instance_name}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: instance.api_key_encrypted },
        body: JSON.stringify(mediaPayload),
      }, OUTBOUND_FETCH_TIMEOUT_MS);
    }

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Evolution API error (sendMedia): ${response.status} - ${errText}`);
    }
    await response.text();
  } else {
    const response = await fetchWithTimeout(
      `${apiUrl}/message/sendText/${instance.instance_name}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: instance.api_key_encrypted },
        body: JSON.stringify({ number, text }),
      },
      OUTBOUND_FETCH_TIMEOUT_MS
    );
    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Evolution API error (sendText): ${response.status} - ${errText}`);
    }
    await response.text();
  }
}

// ====================== MESSAGE POLYMORPHISM ======================

async function generateAIMessage(
  promptBase: string,
  phone: string,
  contactName: string | null,
  contactMetadata: any,
  variationLevel: string,
  messageTemplate: string | null,
  supabaseClient?: any,
  userId?: string
): Promise<string> {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

  let personalizationContext = "";
  if (contactName) personalizationContext += `\nNome do lead: ${contactName}`;
  if (contactMetadata && typeof contactMetadata === "object") {
    const extras = Object.entries(contactMetadata)
      .filter(([_, v]) => v !== null && v !== undefined && v !== "")
      .map(([k, v]) => `${k}: ${v}`)
      .join(", ");
    if (extras) personalizationContext += `\nDados extras do lead: ${extras}`;
  }

  let conversationHistory = "";
  if (supabaseClient && userId && phone) {
    try {
      const { data: recentMsgs } = await supabaseClient
        .from("wa_inbox")
        .select("content, direction, created_at")
        .eq("phone", phone.replace(/\D/g, ""))
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(5);

      if (recentMsgs && recentMsgs.length > 0) {
        conversationHistory = "\nHistórico recente da conversa:\n" +
          recentMsgs
            .reverse()
            .map((m: any) => `${m.direction === "incoming" ? "Lead" : "Nós"}: ${m.content || "[mídia]"}`)
            .join("\n");
      }
    } catch (err) {
      console.warn("Failed to fetch conversation history:", err);
    }
  }

  const levelConfig: Record<string, { temp: number; instruction: string }> = {
    low: {
      temp: 0.6,
      instruction: "Faça PEQUENAS variações: troque sinônimos, mude a ordem de frases, mas mantenha a estrutura próxima do original.",
    },
    medium: {
      temp: 0.85,
      instruction: "Faça variações MODERADAS: reescreva mantendo a essência, mas variando estrutura, abordagem e vocabulário significativamente. Cada mensagem DEVE ser completamente diferente da anterior.",
    },
    high: {
      temp: 1.0,
      instruction: "Faça uma REESCRITA TOTALMENTE CRIATIVA: mude completamente a abordagem, use perspectivas diferentes, perguntas inesperadas, mantendo apenas a intenção central. NUNCA repita padrões.",
    },
  };

  const config = levelConfig[variationLevel] || levelConfig.medium;

  // Randomize style for each message
  const styleVariations = [
    "Use um tom casual e direto, como um amigo indicando algo.",
    "Seja mais formal e profissional.",
    "Comece com uma pergunta envolvente que gere curiosidade.",
    "Use uma abordagem empática e calorosa.",
    "Vá direto ao ponto sem enrolação.",
    "Comece com um dado curioso ou fato interessante.",
    "Use humor leve e sutil.",
    "Aborde como um consultor especialista dando uma dica valiosa.",
    "Comece mencionando uma dor ou problema comum do mercado.",
    "Use uma história curta ou analogia para prender a atenção.",
  ];
  const randomStyle = styleVariations[Math.floor(Math.random() * styleVariations.length)];

  // Vary emoji usage
  const emojiCount = Math.floor(Math.random() * 4); // 0-3
  const emojiInstruction = emojiCount === 0
    ? "NÃO use nenhum emoji nesta mensagem."
    : `Use exatamente ${emojiCount} emoji(s) de forma natural.`;

  // Vary message length
  const lengthVariation = Math.random();
  const lengthInstruction = lengthVariation < 0.3
    ? "Mantenha a mensagem CURTA: 1-2 frases apenas."
    : lengthVariation < 0.7
    ? "Mensagem de tamanho MÉDIO: 2-3 parágrafos curtos."
    : "Mensagem um pouco mais LONGA: 3-4 parágrafos curtos com mais contexto.";

  // Random seed to ensure uniqueness
  const randomSeed = Math.random().toString(36).substring(2, 10);

  const systemPrompt = `Você é um redator especialista em mensagens de WhatsApp para prospecção. Cada mensagem que você gera deve ser ABSOLUTAMENTE ÚNICA.

REGRAS OBRIGATÓRIAS:
- Gere UMA ÚNICA mensagem baseada na intenção fornecida
- ${config.instruction}
- ${randomStyle}
- ${emojiInstruction}
- ${lengthInstruction}
- A mensagem deve soar 100% natural, como enviada por uma pessoa real digitando no celular
- NÃO use saudações genéricas repetitivas
- NÃO inclua o número de telefone
- Se dados do lead forem fornecidos, USE-OS naturalmente
- Se houver histórico de conversa, CONSIDERE o contexto
- MÁXIMO de 500 caracteres
- NÃO use formatação de markdown (sem **, sem ##, sem *)
- Responda APENAS com o texto da mensagem
- SEED DE UNICIDADE: ${randomSeed} (use para garantir que esta mensagem seja diferente de todas as outras)`;

  const userPrompt = messageTemplate
    ? `Mensagem base para reescrever: "${messageTemplate}"\nIntenção da campanha: ${promptBase}${personalizationContext}${conversationHistory}\n\nCrie uma variação COMPLETAMENTE DIFERENTE e ÚNICA. Não copie a estrutura da mensagem base.`
    : `Intenção da mensagem: ${promptBase}${personalizationContext}${conversationHistory}\n\nGere uma mensagem 100% única, personalizada e natural.`;

  const response = await fetchWithTimeout("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: config.temp,
      max_tokens: 500,
    }),
  }, AI_FETCH_TIMEOUT_MS);

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`AI gateway error: ${response.status} - ${errText}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("Empty AI response");

  // Strip any markdown formatting
  return content.trim().replace(/\*\*/g, "").replace(/\*/g, "").replace(/^#+\s*/gm, "").replace(/^[-]\s+/gm, "");
}

// ====================== HELPERS ======================

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = OUTBOUND_FETCH_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error(`Request timeout after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

async function markFailed(supabase: any, itemId: string, errorMessage: string) {
  await supabase
    .from("wa_queue")
    .update({ status: "failed", error_message: errorMessage })
    .eq("id", itemId);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function generateHash(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("").substring(0, 16);
}

// ====================== ANTI-BAN: HUMAN BEHAVIOR SIMULATION ======================

async function simulateTyping(instance: Instance, phone: string, durationMs: number) {
  if (instance.provider === "meta") return;

  try {
    const apiUrl = instance.api_url.replace(/\/+$/, "");
    const jid = phone.includes("@") ? phone : `${phone}@s.whatsapp.net`;

    await fetchWithTimeout(`${apiUrl}/chat/presence/${instance.instance_name}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: instance.api_key_encrypted },
      body: JSON.stringify({ id: jid, presence: "composing" }),
    }, PRESENCE_FETCH_TIMEOUT_MS).catch(() => {});

    await sleep(durationMs);

    await fetchWithTimeout(`${apiUrl}/chat/presence/${instance.instance_name}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: instance.api_key_encrypted },
      body: JSON.stringify({ id: jid, presence: "paused" }),
    }, PRESENCE_FETCH_TIMEOUT_MS).catch(() => {});
  } catch (_) {
    // Non-critical
  }
}

async function simulateOnlinePresence(instance: Instance, _phone: string) {
  if (instance.provider === "meta") return;
  try {
    const apiUrl = instance.api_url.replace(/\/+$/, "");
    await fetchWithTimeout(`${apiUrl}/chat/presence/${instance.instance_name}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: instance.api_key_encrypted },
      body: JSON.stringify({ presence: "available" }),
    }, PRESENCE_FETCH_TIMEOUT_MS).catch(() => {});
  } catch (_) {}
}

async function simulateOfflinePresence(instance: Instance) {
  if (instance.provider === "meta") return;
  try {
    const apiUrl = instance.api_url.replace(/\/+$/, "");
    await fetchWithTimeout(`${apiUrl}/chat/presence/${instance.instance_name}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: instance.api_key_encrypted },
      body: JSON.stringify({ presence: "unavailable" }),
    }, PRESENCE_FETCH_TIMEOUT_MS).catch(() => {});
  } catch (_) {}
}

async function simulateReadReceipt(instance: Instance, phone: string) {
  if (instance.provider === "meta") return;
  try {
    const apiUrl = instance.api_url.replace(/\/+$/, "");
    const jid = phone.includes("@") ? phone : `${phone}@s.whatsapp.net`;
    await fetchWithTimeout(`${apiUrl}/chat/markChatUnread/${instance.instance_name}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", apikey: instance.api_key_encrypted },
      body: JSON.stringify({ chat: jid, lastMessage: { key: { fromMe: true } } }),
    }, PRESENCE_FETCH_TIMEOUT_MS).catch(() => {});
  } catch (_) {}
}
