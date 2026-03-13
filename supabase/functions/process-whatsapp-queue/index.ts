import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const BATCH_SIZE = 20;
const MAX_RETRIES = 5;
const CIRCUIT_BREAKER_THRESHOLD = 5;

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
        .select("id, prompt_base, message_template, min_delay_seconds, max_delay_seconds, rotation_messages_per_instance, regras_rodizio, regras_delay, regras_aquecimento, started_at, variation_level")
        .in("id", campaignIds);
      if (campaigns) {
        for (const c of campaigns as unknown as Campaign[]) {
          campaignMap.set(c.id, c);
        }
      }
    }

    // Fetch instances per user
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

    const rotationCounters = new Map<string, { index: number; count: number }>();
    let processed = 0, succeeded = 0, failed = 0;

    for (const item of items) {
      try {
        await supabase
          .from("wa_queue")
          .update({ status: "processing" })
          .eq("id", item.id)
          .eq("status", "pending");

        const campaign = item.campaign_id ? campaignMap.get(item.campaign_id) : null;
        const userInstances = instanceMap.get(item.user_id);

        if (!userInstances || userInstances.length === 0) {
          await markFailed(supabase, item.id, "No active WhatsApp instances available");
          failed++; processed++; continue;
        }

        // --- Smart Switcher: Instance Selection ---
        const instance = await selectSmartInstance(
          supabase, userInstances, item, campaign, rotationCounters, instanceFailures
        );

        if (!instance) {
          await markFailed(supabase, item.id, "All instances circuit-broken or at warmup limit");
          failed++; processed++; continue;
        }

        // --- Message Polymorphism: AI Generation ---
        let finalMessage = item.message;
        const variationLevel = campaign?.variation_level || "medium";

        if (campaign?.prompt_base) {
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
          } catch (aiErr) {
            console.error("AI generation failed, using template:", aiErr);
            finalMessage = campaign.message_template || item.message;
          }
        }

        const messageHash = await generateHash(finalMessage);

        // --- Anti-Ban: Random Online Presence Before Message ---
        await simulateOnlinePresence(instance, item.phone);

        // --- Anti-Ban: Typing Simulation with Variable Duration ---
        const messageLength = finalMessage.length;
        // Simulate typing speed: ~30-60 chars per second + random variation
        const baseTypingMs = (messageLength / (30 + Math.random() * 30)) * 1000;
        const typingDelay = Math.max(1500, Math.min(baseTypingMs + Math.random() * 2000, 8000));
        await simulateTyping(instance, item.phone, typingDelay);

        // --- Anti-Ban: Small random pause after typing before sending ---
        await sleep(300 + Math.random() * 700);

        // --- Send via Provider Abstraction ---
        await sendMessageByProvider(instance, item.phone, finalMessage, item.media_url, item.media_type);

        instanceFailures.set(instance.id, 0);

        // --- Anti-Ban: Simulate reading after sending (mark as read) ---
        await simulateReadReceipt(instance, item.phone);

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
        }

        succeeded++;

        // --- Anti-Ban: Variable Delay Between Messages ---
        const delayRules = campaign?.regras_delay || {};
        const minD = (delayRules.min || campaign?.min_delay_seconds || 5) * 1000;
        const maxD = (delayRules.max || campaign?.max_delay_seconds || 15) * 1000;
        // Add random "human" pause (sometimes longer pauses like checking phone)
        const humanPause = Math.random() < 0.15 ? (5000 + Math.random() * 10000) : 0; // 15% chance of 5-15s extra pause
        await sleep(minD + Math.random() * (maxD - minD) + humanPause);

        // --- Anti-Ban: Occasionally go offline between messages ---
        if (Math.random() < 0.1) { // 10% chance
          await simulateOfflinePresence(instance);
          await sleep(2000 + Math.random() * 5000);
        }

      } catch (err) {
        console.error(`Error processing queue item ${item.id}:`, err);
        const errMsg = err instanceof Error ? err.message : "Unknown error";

        // Circuit breaker
        const rotKey = item.campaign_id || item.user_id;
        const rot = rotationCounters.get(rotKey);
        const userInstances = instanceMap.get(item.user_id);
        if (rot && userInstances) {
          const failedInstance = userInstances[rot.index % userInstances.length];
          if (failedInstance) {
            const currentFailures = (instanceFailures.get(failedInstance.id) || 0) + 1;
            instanceFailures.set(failedInstance.id, currentFailures);
            if (currentFailures >= CIRCUIT_BREAKER_THRESHOLD) {
              console.warn(`Circuit breaker triggered for instance ${failedInstance.id}`);
              const { error: healthErr } = await supabase.rpc("decrement_instance_health", {
                instance_id: failedInstance.id,
                decrement_value: 30,
              });
              if (healthErr) console.error("Health decrement failed:", healthErr);

              // Trigger failover for banned instance
              try {
                const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
                await fetch(`${supabaseUrl}/functions/v1/handle-instance-ban`, {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
                  },
                  body: JSON.stringify({
                    instance_id: failedInstance.id,
                    user_id: item.user_id,
                  }),
                });
                console.log(`Failover triggered for instance ${failedInstance.id}`);
              } catch (failoverErr) {
                console.error("Failover trigger failed:", failoverErr);
              }
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
  supabase: any,
  userInstances: Instance[],
  item: QueueItem,
  campaign: Campaign | null,
  rotationCounters: Map<string, { index: number; count: number }>,
  failures: Map<string, number>
): Promise<Instance | null> {
  const aquecimento = campaign?.regras_aquecimento || {};
  const warmupDailyLimit = aquecimento.limite_diario_inicial || null;
  const warmupRampDays = aquecimento.dias_rampa || 7;

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
    if (pauseBetweenInstances > 0) await sleep(pauseBetweenInstances * 1000);
  }

  const isContactCold = !item.contact_metadata?.last_message_at;

  const sortedInstances = [...userInstances].sort((a, b) => {
    if (isContactCold) {
      const totalHealth = userInstances.reduce((sum, inst) => sum + inst.health_score, 0);
      if (totalHealth > 0) {
        const aWeight = a.health_score / totalHealth;
        const bWeight = b.health_score / totalHealth;
        return bWeight - aWeight;
      }
      return b.health_score - a.health_score;
    }
    const aTime = a.last_used_at ? new Date(a.last_used_at).getTime() : 0;
    const bTime = b.last_used_at ? new Date(b.last_used_at).getTime() : 0;
    return bTime - aTime;
  });

  let instance: Instance | null = null;

  for (let attempts = 0; attempts < sortedInstances.length; attempts++) {
    const candidate = sortedInstances[(rot.index + attempts) % sortedInstances.length];
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
    rot.index = (rot.index + attempts) % sortedInstances.length;
    break;
  }

  if (instance) rot.count++;
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

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(messageBody),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Meta API error: ${response.status} - ${errText}`);
  }
  await response.text(); // consume body
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
    // Evolution API v2 uses /message/sendMedia/{instance} for all media types
    // Try v2 endpoint first, fallback to v1 if 404
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

    // Try v2 unified endpoint
    let response = await fetch(v2Endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: instance.api_key_encrypted },
      body: JSON.stringify(mediaPayload),
    });

    // If v2 returns 404, try v1 specific endpoint
    if (response.status === 404) {
      const errBody = await response.text(); // consume v2 body
      console.log(`Evolution v2 sendMedia 404, trying v1 fallback. Response: ${errBody}`);
      const v1Action = v1Endpoints[mediaType] || "sendDocument";
      const v1Url = `${apiUrl}/message/${v1Action}/${instance.instance_name}`;
      response = await fetch(v1Url, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: instance.api_key_encrypted },
        body: JSON.stringify(mediaPayload),
      });
    }

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Evolution API error (sendMedia): ${response.status} - ${errText}`);
    }
    await response.text(); // consume body
  } else {
    // Text-only: try v2 /message/sendText first
    const response = await fetch(
      `${apiUrl}/message/sendText/${instance.instance_name}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: instance.api_key_encrypted },
        body: JSON.stringify({ number, text }),
      }
    );
    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Evolution API error (sendText): ${response.status} - ${errText}`);
    }
    await response.text(); // consume body
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
      temp: 0.5,
      instruction: "Faça PEQUENAS variações: troque sinônimos, mude a ordem de frases, mas mantenha a estrutura muito próxima do original.",
    },
    medium: {
      temp: 0.8,
      instruction: "Faça variações MODERADAS: reescreva mantendo a essência, mas variando estrutura, abordagem e vocabulário significativamente.",
    },
    high: {
      temp: 1.0,
      instruction: "Faça uma REESCRITA CRIATIVA: mude completamente a abordagem, use perspectivas diferentes, metáforas, perguntas ou afirmações inesperadas, mantendo apenas a intenção central.",
    },
  };

  const config = levelConfig[variationLevel] || levelConfig.medium;

  // Anti-ban: randomize message style patterns
  const styleVariations = [
    "Use um tom casual e direto.",
    "Seja mais formal e educado.",
    "Comece com uma pergunta envolvente.",
    "Use uma abordagem empática e calorosa.",
    "Vá direto ao ponto, sem enrolação.",
    "Comece com um dado curioso ou estatística.",
    "Use humor leve e profissional.",
    "Aborde de forma consultiva, como um especialista.",
  ];
  const randomStyle = styleVariations[Math.floor(Math.random() * styleVariations.length)];

  // Anti-ban: vary emoji usage randomly
  const emojiInstruction = Math.random() < 0.3 
    ? "NÃO use nenhum emoji nesta mensagem." 
    : `Use entre ${Math.floor(Math.random() * 3)} e ${1 + Math.floor(Math.random() * 3)} emojis com naturalidade.`;

  const systemPrompt = `Você é um redator especialista em mensagens de WhatsApp para prospecção, com foco em evitar repetição e soar 100% natural e humano.

REGRAS OBRIGATÓRIAS:
- Gere UMA ÚNICA mensagem baseada na intenção fornecida
- ${config.instruction}
- ${randomStyle}
- ${emojiInstruction}
- A mensagem deve soar natural, como enviada por uma pessoa real
- NÃO use saudações genéricas como "Olá!" em todas as mensagens — varie o início
- Varie a estrutura: pergunta, afirmação, curiosidade, oferta direta
- Mantenha entre 1-4 parágrafos curtos
- NÃO inclua o número de telefone
- Se dados do lead forem fornecidos, USE-OS para personalizar naturalmente
- Se houver histórico de conversa, CONSIDERE o contexto para continuidade natural
- Cada mensagem deve ser ÚNICA — nunca repita estruturas
- MÁXIMO de 500 caracteres
- Varie o comprimento: às vezes 1 linha, às vezes 3-4 linhas
- Tom profissional mas amigável
- NÃO use formatação de markdown (sem **, sem ##)
- Responda APENAS com o texto da mensagem, sem explicações`;

  const userPrompt = messageTemplate
    ? `Mensagem base: ${messageTemplate}\nIntenção da campanha: ${promptBase}${personalizationContext}${conversationHistory}\n\nGere uma variação única e personalizada.`
    : `Intenção da mensagem: ${promptBase}${personalizationContext}${conversationHistory}\n\nGere uma mensagem única, personalizada e natural.`;

  const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
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
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`AI gateway error: ${response.status} - ${errText}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("Empty AI response");

  // Anti-ban: strip any markdown formatting the AI might add
  return content.trim().replace(/\*\*/g, "").replace(/^#+\s*/gm, "").replace(/^[-*]\s+/gm, "");
}

// ====================== HELPERS ======================

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

    await fetch(`${apiUrl}/chat/presence/${instance.instance_name}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: instance.api_key_encrypted },
      body: JSON.stringify({ id: jid, presence: "composing" }),
    }).catch(() => {});

    await sleep(durationMs);

    await fetch(`${apiUrl}/chat/presence/${instance.instance_name}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: instance.api_key_encrypted },
      body: JSON.stringify({ id: jid, presence: "paused" }),
    }).catch(() => {});
  } catch (err) {
    // Non-critical, don't throw
  }
}

async function simulateOnlinePresence(instance: Instance, phone: string) {
  if (instance.provider === "meta") return;

  try {
    const apiUrl = instance.api_url.replace(/\/+$/, "");
    await fetch(`${apiUrl}/chat/presence/${instance.instance_name}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: instance.api_key_encrypted },
      body: JSON.stringify({ presence: "available" }),
    }).catch(() => {});
  } catch (err) {
    // Non-critical
  }
}

async function simulateOfflinePresence(instance: Instance) {
  if (instance.provider === "meta") return;

  try {
    const apiUrl = instance.api_url.replace(/\/+$/, "");
    await fetch(`${apiUrl}/chat/presence/${instance.instance_name}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: instance.api_key_encrypted },
      body: JSON.stringify({ presence: "unavailable" }),
    }).catch(() => {});
  } catch (err) {
    // Non-critical
  }
}

async function simulateReadReceipt(instance: Instance, phone: string) {
  if (instance.provider === "meta") return;

  try {
    const apiUrl = instance.api_url.replace(/\/+$/, "");
    const jid = phone.includes("@") ? phone : `${phone}@s.whatsapp.net`;

    await fetch(`${apiUrl}/chat/markChatUnread/${instance.instance_name}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", apikey: instance.api_key_encrypted },
      body: JSON.stringify({ chat: jid, lastMessage: { key: { fromMe: true } } }),
    }).catch(() => {});
  } catch (err) {
    // Non-critical
  }
}
