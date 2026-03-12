import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const BATCH_SIZE = 20;

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
}

interface Campaign {
  id: string;
  prompt_base: string | null;
  message_template: string;
  min_delay_seconds: number;
  max_delay_seconds: number;
  rotation_messages_per_instance: number;
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
        .select("id, prompt_base, message_template, min_delay_seconds, max_delay_seconds, rotation_messages_per_instance")
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

        // --- Instance Rotation Logic ---
        const rotationLimit = campaign?.rotation_messages_per_instance || 10;
        const rotKey = item.campaign_id || item.user_id;

        if (!rotationCounters.has(rotKey)) {
          rotationCounters.set(rotKey, { index: 0, count: 0 });
        }
        const rot = rotationCounters.get(rotKey)!;

        if (rot.count >= rotationLimit) {
          rot.index = (rot.index + 1) % userInstances.length;
          rot.count = 0;
        }

        // Pick instance with health score weighting
        let instance = userInstances[rot.index % userInstances.length];
        // If instance health is too low, try next
        if (instance.health_score < 30 && userInstances.length > 1) {
          rot.index = (rot.index + 1) % userInstances.length;
          instance = userInstances[rot.index % userInstances.length];
        }
        rot.count++;

        // --- AI Message Generation (Spintax Generativo) ---
        let finalMessage = item.message;

        if (campaign?.prompt_base) {
          try {
            finalMessage = await generateAIMessage(campaign.prompt_base, item.phone);
          } catch (aiErr) {
            console.error("AI generation failed, using template:", aiErr);
            finalMessage = campaign.message_template || item.message;
          }
        }

        // --- Simulate Human Behavior: Typing Indicator ---
        const typingDelay = 1000 + Math.random() * 2000; // 1-3 seconds
        await simulateTyping(instance, item.phone, typingDelay);

        // --- Small random delay for human-like behavior ---
        const humanDelay = 500 + Math.random() * 1500;
        await sleep(humanDelay);

        // --- Send via Evolution API ---
        await sendMessage(instance, item.phone, finalMessage, item.media_url, item.media_type);

        // Mark success
        await supabase
          .from("wa_queue")
          .update({ status: "sent", sent_at: new Date().toISOString(), message: finalMessage, instance_id: instance.id })
          .eq("id", item.id);

        // Update instance counters
        await supabase
          .from("wa_instances")
          .update({
            messages_sent_today: instance.messages_sent_today + 1,
            last_message_at: new Date().toISOString(),
          })
          .eq("id", instance.id);

        // Update campaign sent count
        if (item.campaign_id) {
          await supabase.rpc("increment_campaign_sent", { cid: item.campaign_id });
        }

        succeeded++;

        // --- Delay between messages for human-like pacing ---
        if (campaign) {
          const minD = (campaign.min_delay_seconds || 5) * 1000;
          const maxD = (campaign.max_delay_seconds || 15) * 1000;
          const delay = minD + Math.random() * (maxD - minD);
          await sleep(delay);
        }
      } catch (err) {
        console.error(`Error processing queue item ${item.id}:`, err);
        const errMsg = err instanceof Error ? err.message : "Unknown error";

        if (item.retry_count < 3) {
          // Reschedule for retry
          await supabase
            .from("wa_queue")
            .update({
              status: "pending",
              retry_count: item.retry_count + 1,
              error_message: errMsg,
              scheduled_for: new Date(Date.now() + 60000).toISOString(), // retry in 1 min
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
      const { data: remaining } = await supabase
        .from("wa_queue")
        .select("id", { count: "exact", head: true })
        .eq("campaign_id", cid)
        .in("status", ["pending", "processing"]);

      if (remaining !== null) {
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

async function generateAIMessage(promptBase: string, phone: string): Promise<string> {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) {
    throw new Error("LOVABLE_API_KEY not configured");
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
- Responda APENAS com o texto da mensagem, sem explicações ou marcadores`,
        },
        {
          role: "user",
          content: `Intenção da mensagem: ${promptBase}\n\nGere uma variação única e natural desta mensagem.`,
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

    // Send "composing" presence
    await fetch(`${apiUrl}/chat/presence/${instance.instance_name}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: instance.api_key_encrypted,
      },
      body: JSON.stringify({
        id: jid,
        presence: "composing",
      }),
    });

    await sleep(durationMs);

    // Send "paused" presence
    await fetch(`${apiUrl}/chat/presence/${instance.instance_name}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: instance.api_key_encrypted,
      },
      body: JSON.stringify({
        id: jid,
        presence: "paused",
      }),
    });
  } catch (err) {
    // Non-critical: typing simulation failure shouldn't stop the message
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
    // Send media message
    const endpoint =
      mediaType === "image"
        ? "sendImage"
        : mediaType === "video"
        ? "sendVideo"
        : mediaType === "audio"
        ? "sendAudio"
        : "sendDocument";

    const response = await fetch(
      `${apiUrl}/message/${endpoint}/${instance.instance_name}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: instance.api_key_encrypted,
        },
        body: JSON.stringify({
          number,
          mediatype: mediaType,
          media: mediaUrl,
          caption: text,
        }),
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Evolution API error (${endpoint}): ${response.status} - ${errText}`);
    }
  } else {
    // Send text message
    const response = await fetch(
      `${apiUrl}/message/sendText/${instance.instance_name}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: instance.api_key_encrypted,
        },
        body: JSON.stringify({
          number,
          text,
        }),
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Evolution API error (sendText): ${response.status} - ${errText}`);
    }
  }
}
