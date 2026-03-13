import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const BATCH_SIZE = 20;
const MAX_RETRIES = 5;
const CIRCUIT_BREAKER_THRESHOLD = 5;

// In-memory circuit breaker tracker (per invocation)
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

    // Fetch pending queue items that are due
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

    // Group by campaign to fetch campaign configs
    const campaignIds = [...new Set(items.map((i) => i.campaign_id).filter(Boolean))];
    const campaignMap = new Map<string, Campaign>();

    if (campaignIds.length > 0) {
      const { data: campaigns } = await supabase
        .from("wa_campaigns")
        .select("id, prompt_base, message_template, min_delay_seconds, max_delay_seconds, rotation_messages_per_instance, regras_rodizio, regras_delay, regras_aquecimento, started_at")
        .in("id", campaignIds);
      if (campaigns) {
        for (const c of campaigns as unknown as Campaign[]) {
          campaignMap.set(c.id, c);
        }
      }
    }

    // Group by user to fetch instances
    const userIds = [...new Set(items.map((i) => i.user_id))];
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

    // Rotation tracker: campaign_id -> messages sent on current instance
    const rotationCounters = new Map<string, { index: number; count: number }>();

    let processed = 0;
    let succeeded = 0;
    let failed = 0;

    for (const item of items) {
      try {
        // Mark as processing to avoid double-pick
        await supabase
          .from("wa_queue")
          .update({ status: "processing" })
          .eq("id", item.id)
          .eq("status", "pending");

        const campaign = item.campaign_id ? campaignMap.get(item.campaign_id) : null;
        const userInstances = instanceMap.get(item.user_id);

        if (!userInstances || userInstances.length === 0) {
          await markFailed(supabase, item.id, "No active WhatsApp instances available");
          failed++;
          processed++;
          continue;
        }

        // --- Warmup Rules (regras_aquecimento) ---
        const aquecimento = campaign?.regras_aquecimento || {};
        const warmupDailyLimit = aquecimento.limite_diario_inicial || null;
        const warmupRampDays = aquecimento.dias_rampa || 7;

        // --- Instance Rotation Logic using regras_rodizio ---
        const rodizio = campaign?.regras_rodizio || {};
        const rotationLimit = rodizio.mensagens_por_instancia || campaign?.rotation_messages_per_instance || 10;
        const pauseBetweenInstances = rodizio.pausa_entre_instancias || 0;
        const rotKey = item.campaign_id || item.user_id;

        if (!rotationCounters.has(rotKey)) {
          rotationCounters.set(rotKey, { index: 0, count: 0 });
        }
        const rot = rotationCounters.get(rotKey)!;

        if (rot.count >= rotationLimit) {
          rot.index = (rot.index + 1) % userInstances.length;
          rot.count = 0;
          // Apply pause between instance rotation
          if (pauseBetweenInstances > 0) {
            await sleep(pauseBetweenInstances * 1000);
          }
        }

        // Pick instance, skipping circuit-broken ones
        let instance: Instance | null = null;
        let attempts = 0;
        while (attempts < userInstances.length) {
          const candidate = userInstances[(rot.index + attempts) % userInstances.length];
          const failures = instanceFailures.get(candidate.id) || 0;

          // Circuit breaker: skip instances with too many consecutive failures
          if (failures >= CIRCUIT_BREAKER_THRESHOLD) {
            attempts++;
            continue;
          }

          // Warmup check: limit messages for new instances
          if (warmupDailyLimit && candidate.created_at) {
            const instanceAgeDays = Math.floor(
              (Date.now() - new Date(candidate.created_at).getTime()) / (1000 * 60 * 60 * 24)
            );
            if (instanceAgeDays < warmupRampDays) {
              const rampMultiplier = Math.min(1, (instanceAgeDays + 1) / warmupRampDays);
              const dailyLimit = Math.floor(warmupDailyLimit * rampMultiplier);
              if (candidate.messages_sent_today >= dailyLimit) {
                attempts++;
                continue;
              }
            }
          }

          // Skip if health score too low
          if (candidate.health_score < 20) {
            attempts++;
            continue;
          }

          instance = candidate;
          rot.index = (rot.index + attempts) % userInstances.length;
          break;
        }

        if (!instance) {
          await markFailed(supabase, item.id, "All instances circuit-broken or at warmup limit");
          failed++;
          processed++;
          continue;
        }

        rot.count++;

        // --- AI Message Generation with contact personalization ---
        let finalMessage = item.message;

        if (campaign?.prompt_base) {
          try {
            finalMessage = await generateAIMessage(
              campaign.prompt_base,
              item.phone,
              item.contact_name,
              item.contact_metadata
            );
          } catch (aiErr) {
            console.error("AI generation failed, using template:", aiErr);
            finalMessage = campaign.message_template || item.message;
          }
        }

        // Generate message hash for zero-repetition tracking
        const messageHash = await generateHash(finalMessage);

        // --- Simulate Human Behavior: Typing Indicator ---
        const typingDelay = 1000 + Math.random() * 2000;
        await simulateTyping(instance, item.phone, typingDelay);

        // --- Small random delay for human-like behavior ---
        const humanDelay = 500 + Math.random() * 1500;
        await sleep(humanDelay);

        // --- Send via Evolution API ---
        await sendMessage(instance, item.phone, finalMessage, item.media_url, item.media_type);

        // Reset circuit breaker on success
        instanceFailures.set(instance.id, 0);

        // Mark success
        await supabase
          .from("wa_queue")
          .update({
            status: "sent",
            sent_at: new Date().toISOString(),
            message: finalMessage,
            instance_id: instance.id,
            message_hash: messageHash,
          })
          .eq("id", item.id);

        // Update instance counters
        await supabase
          .from("wa_instances")
          .update({
            messages_sent_today: instance.messages_sent_today + 1,
            last_message_at: new Date().toISOString(),
          })
          .eq("id", instance.id);

        // Update contact last_message_at
        if (item.contact_id) {
          await supabase
            .from("wa_contacts")
            .update({ last_message_at: new Date().toISOString() })
            .eq("id", item.contact_id);
        }

        // Update campaign sent count
        if (item.campaign_id) {
          await supabase.rpc("increment_campaign_sent", { cid: item.campaign_id });
        }

        succeeded++;

        // --- Delay between messages using regras_delay ---
        const delayRules = campaign?.regras_delay || {};
        const minD = (delayRules.min || campaign?.min_delay_seconds || 5) * 1000;
        const maxD = (delayRules.max || campaign?.max_delay_seconds || 15) * 1000;
        const delay = minD + Math.random() * (maxD - minD);
        await sleep(delay);
      } catch (err) {
        console.error(`Error processing queue item ${item.id}:`, err);
        const errMsg = err instanceof Error ? err.message : "Unknown error";

        // Circuit breaker: increment failure count for this instance
        const rotKey = item.campaign_id || item.user_id;
        const rot = rotationCounters.get(rotKey);
        const userInstances = instanceMap.get(item.user_id);
        if (rot && userInstances) {
          const failedInstance = userInstances[rot.index % userInstances.length];
          if (failedInstance) {
            const currentFailures = (instanceFailures.get(failedInstance.id) || 0) + 1;
            instanceFailures.set(failedInstance.id, currentFailures);

            // If circuit breaker triggered, degrade health score in DB
            if (currentFailures >= CIRCUIT_BREAKER_THRESHOLD) {
              console.warn(`Circuit breaker triggered for instance ${failedInstance.id}`);
              await supabase.rpc("decrement_instance_health", {
                instance_id: failedInstance.id,
                decrement_value: 30,
              }).catch((e: any) => console.error("Health decrement failed:", e));
            }
          }
        }

        if (item.retry_count < MAX_RETRIES) {
          // Exponential backoff: 1min → 3min → 9min → 27min → cap 1h
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

    // Check if any campaign is now completed
    for (const cid of campaignIds) {
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

// --- Helper Functions ---

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

async function generateAIMessage(
  promptBase: string,
  phone: string,
  contactName: string | null,
  contactMetadata: any
): Promise<string> {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) {
    throw new Error("LOVABLE_API_KEY not configured");
  }

  // Build personalization context from contact data
  let personalizationContext = "";
  if (contactName) {
    personalizationContext += `\nNome do lead: ${contactName}`;
  }
  if (contactMetadata && typeof contactMetadata === "object") {
    const extras = Object.entries(contactMetadata)
      .filter(([_, v]) => v !== null && v !== undefined && v !== "")
      .map(([k, v]) => `${k}: ${v}`)
      .join(", ");
    if (extras) {
      personalizationContext += `\nDados extras do lead: ${extras}`;
    }
  }

  const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        {
          role: "system",
          content: `Você é um assistente de WhatsApp marketing. Gere UMA ÚNICA variação de mensagem de WhatsApp baseada na intenção fornecida.

REGRAS:
- A mensagem deve soar natural e humana, como se fosse enviada por uma pessoa real
- NÃO use saudações genéricas como "Olá!" no início de TODAS as mensagens — varie
- Use emojis com moderação (0-3 por mensagem)
- Varie a estrutura: às vezes comece com pergunta, às vezes com afirmação, às vezes com emoji
- Mantenha entre 1-4 parágrafos curtos
- NÃO inclua o número de telefone na mensagem
- Se dados do lead forem fornecidos, USE-OS para personalizar a mensagem de forma natural
- Cada mensagem deve ser ÚNICA — nunca repita estruturas ou frases anteriores
- Responda APENAS com o texto da mensagem, sem explicações ou marcadores`,
        },
        {
          role: "user",
          content: `Intenção da mensagem: ${promptBase}${personalizationContext}\n\nGere uma variação única, personalizada e natural desta mensagem.`,
        },
      ],
      temperature: 0.9,
      max_tokens: 500,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`AI gateway error: ${response.status} - ${errText}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("Empty AI response");

  return content.trim();
}

async function simulateTyping(instance: Instance, phone: string, durationMs: number) {
  try {
    const apiUrl = instance.api_url.replace(/\/+$/, "");
    const jid = phone.includes("@") ? phone : `${phone}@s.whatsapp.net`;

    await fetch(`${apiUrl}/chat/presence/${instance.instance_name}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: instance.api_key_encrypted,
      },
      body: JSON.stringify({ id: jid, presence: "composing" }),
    });

    await sleep(durationMs);

    await fetch(`${apiUrl}/chat/presence/${instance.instance_name}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: instance.api_key_encrypted,
      },
      body: JSON.stringify({ id: jid, presence: "paused" }),
    });
  } catch (err) {
    console.warn("Typing simulation failed:", err);
  }
}

async function sendMessage(
  instance: Instance,
  phone: string,
  text: string,
  mediaUrl: string | null,
  mediaType: string | null
) {
  const apiUrl = instance.api_url.replace(/\/+$/, "");
  const number = phone.replace(/\D/g, "");

  if (mediaUrl && mediaType) {
    const endpoint =
      mediaType === "image" ? "sendImage"
      : mediaType === "video" ? "sendVideo"
      : mediaType === "audio" ? "sendAudio"
      : "sendDocument";

    const response = await fetch(
      `${apiUrl}/message/${endpoint}/${instance.instance_name}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: instance.api_key_encrypted,
        },
        body: JSON.stringify({ number, mediatype: mediaType, media: mediaUrl, caption: text }),
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Evolution API error (${endpoint}): ${response.status} - ${errText}`);
    }
  } else {
    const response = await fetch(
      `${apiUrl}/message/sendText/${instance.instance_name}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: instance.api_key_encrypted,
        },
        body: JSON.stringify({ number, text }),
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Evolution API error (sendText): ${response.status} - ${errText}`);
    }
  }
}
