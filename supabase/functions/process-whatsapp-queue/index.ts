import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Process a small fair batch per invocation. The SQL claim returns at most one
// ready item per campaign, so one old overdue campaign cannot block newer ones.
const BATCH_SIZE = 3;
const MAX_RETRIES = 5;
const CIRCUIT_BREAKER_THRESHOLD = 5;
const OUTBOUND_FETCH_TIMEOUT_MS = 10_000;
const PRESENCE_FETCH_TIMEOUT_MS = 2_500;
const AI_FETCH_TIMEOUT_MS = 12_000;
const SCHEDULED_CAMPAIGN_LOOKBACK_MS = 24 * 60 * 60 * 1000;
const SCHEDULED_CAMPAIGN_AUTO_START_LIMIT = 20;

// ===== ANTI-BAN: Default safety limits =====
const DEFAULT_DAILY_LIMIT_NEW_INSTANCE = 10; // New numbers (<3 days): max 10 msgs/day
const DEFAULT_DAILY_LIMIT_MATURE_INSTANCE = 200; // Mature numbers (>14 days): max 200 msgs/day
// Aquecimento (warmup) — piso/alvo padrão quando a campanha liga o aquecimento
// mas não preenche os campos. Curva sobe do piso (dia 0) até o alvo (fim da rampa).
const DEFAULT_WARMUP_INITIAL_DAILY = 20; // dia 0: um número ativo aguenta pelo menos isto
const DEFAULT_WARMUP_TARGET_DAILY = 50;  // alvo ao fim da rampa, sem config explícita
const WARMUP_RAMP_DAYS = 14; // Days to reach full capacity
const COLD_CONTACT_MIN_DELAY_SECONDS = 45; // Minimum delay for cold contacts (no prior interaction)
const COLD_CONTACT_MAX_DELAY_SECONDS = 120; // Maximum delay for cold contacts
// TRAVA ANTI-BAN (Marcos): minimo 5min (300s) entre disparos da MESMA campanha.
// O MAXIMO o vendedor define na campanha; o MINIMO e travado aqui no codigo e
// nao pode ser burlado (mesmo que a campanha tenha min menor). Robusto contra
// acumulo de itens vencidos via cooldown por campanha.
const MARCOS_MIN_DELAY_FLOOR_SECONDS = 120; // piso ABSOLUTO entre mensagens: 2 min (o vendedor pode descer ate aqui)
const DEFAULT_DELAY_MIN_SECONDS = 300;  // padrao quando a campanha nao define: 5 min
const DEFAULT_DELAY_MAX_SECONDS = 1620; // padrao quando a campanha nao define: 27 min

// AVISO (#3): cria notificacao no portal (sino) quando um disparo TRAVA por numero
// desconectado. Dedupe: no maximo 1 aviso por campanha a cada 30min (nao spamma o
// sino a cada ciclo de 1min do cron). Nao bloqueante.
async function notifyCampaignStalled(supabase: any, opts: { user_id?: string | null; campaign_id?: string | null; campaign_name?: string | null; reason: string }) {
  if (!opts.user_id || !opts.campaign_id) return;
  try {
    const since = new Date(Date.now() - 30 * 60_000).toISOString();
    const { data: recent } = await supabase
      .from("notifications")
      .select("id")
      .eq("reference_type", "campaign_stalled")
      .eq("reference_id", opts.campaign_id)
      .gte("created_at", since)
      .limit(1);
    if (recent && recent.length > 0) return;
    await supabase.from("notifications").insert({
      user_id: opts.user_id,
      type: "warning",
      title: "⚠️ Disparo pausado",
      message: `A campanha "${opts.campaign_name || "disparo em massa"}" parou: ${opts.reason}. Reconecte o WhatsApp e ela retoma de onde parou.`,
      reference_type: "campaign_stalled",
      reference_id: opts.campaign_id,
      action_url: "/marcos",
    });
  } catch (_e) { /* nao bloqueante */ }
}
const NUMBER_VALIDATION_TIMEOUT_MS = 5_000;

// BUG-NOVO-05: o Map de failures era em escopo de MÓDULO. Deno Deploy cria
// nova runtime a cada invocação, então o contador zerava sempre — circuit
// breaker NUNCA disparava + handle-instance-ban virava dead code.
// Solução: o Map agora é populado a cada invocação A PARTIR da coluna
// wa_instances.consecutive_undelivered (persistente), e cada increment/reset
// também escreve no banco. Variável global removida em favor de instância
// per-request (criada no Deno.serve handler).
//
// O Map ainda existe como CACHE LOCAL dentro do request — evita SELECTs
// repetidos quando o mesmo lote processa N itens da mesma instância.
//
// Helpers ficam aqui pra reuso:

/**
 * Pré-carrega failure counts de wa_instances.consecutive_undelivered.
 * Chamado uma vez no início de cada invocação do queue processor.
 */
async function loadInstanceFailureCounts(
  supabase: any,
  instanceIds: string[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (instanceIds.length === 0) return map;
  const { data } = await supabase
    .from("wa_instances")
    .select("id, consecutive_undelivered")
    .in("id", instanceIds);
  for (const row of (data || []) as Array<{ id: string; consecutive_undelivered: number | null }>) {
    map.set(row.id, row.consecutive_undelivered ?? 0);
  }
  return map;
}

/**
 * Incrementa o contador no banco E no cache local. Retorna novo valor.
 * Usa a função SQL increment_consecutive_undelivered que já existe (atômica).
 */
async function incrementInstanceFailureCount(
  supabase: any,
  failuresCache: Map<string, number>,
  instanceId: string,
): Promise<number> {
  try {
    await supabase.rpc("increment_consecutive_undelivered", { iid: instanceId });
  } catch (rpcErr) {
    console.warn("[circuit-breaker] increment_consecutive_undelivered RPC falhou:", rpcErr);
  }
  // Lê valor novo do banco (RPC pode ter side effects extras como shadow_ban_suspect)
  const { data } = await supabase
    .from("wa_instances")
    .select("consecutive_undelivered")
    .eq("id", instanceId)
    .maybeSingle();
  const newCount = (data as any)?.consecutive_undelivered ?? ((failuresCache.get(instanceId) || 0) + 1);
  failuresCache.set(instanceId, newCount);
  return newCount;
}

/**
 * Zera o contador no banco E no cache local. Chamado a cada envio bem-sucedido.
 */
async function resetInstanceFailureCount(
  supabase: any,
  failuresCache: Map<string, number>,
  instanceId: string,
): Promise<void> {
  failuresCache.set(instanceId, 0);
  try {
    await supabase
      .from("wa_instances")
      .update({ consecutive_undelivered: 0 })
      .eq("id", instanceId);
  } catch (err) {
    console.warn("[circuit-breaker] reset consecutive_undelivered falhou:", err);
  }
}

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
  seller_member_id: string | null;
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
  media_url: string | null;
  media_type: string | null;
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
  include_optout_buttons: boolean;
  seller_member_id: string | null;
}

interface SendResult {
  remoteMessageId: string | null;
}

async function autoStartDueScheduledCampaigns(supabase: any) {
  const now = new Date();
  const nowIso = now.toISOString();
  const lookbackIso = new Date(now.getTime() - SCHEDULED_CAMPAIGN_LOOKBACK_MS).toISOString();

  const { error: expireError } = await supabase
    .from("wa_campaigns")
    .update({ status: "paused", updated_at: nowIso })
    .eq("status", "scheduled")
    .not("end_time", "is", null)
    .lt("end_time", nowIso);

  if (expireError) {
    console.warn("[scheduled-campaigns] Failed to pause expired schedules:", expireError);
  }

  const { data: dueCampaigns, error } = await supabase
    .from("wa_campaigns")
    .select("id, scheduled_at, end_time")
    .eq("status", "scheduled")
    .not("scheduled_at", "is", null)
    .lte("scheduled_at", nowIso)
    .gte("scheduled_at", lookbackIso)
    .order("scheduled_at", { ascending: true })
    .limit(SCHEDULED_CAMPAIGN_AUTO_START_LIMIT);

  if (error) {
    console.warn("[scheduled-campaigns] Failed to fetch due campaigns:", error);
    return 0;
  }

  const campaigns = (dueCampaigns || []).filter((campaign: any) => {
    if (!campaign.end_time) return true;
    return new Date(campaign.end_time).getTime() >= now.getTime();
  });

  if (campaigns.length === 0) return 0;

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    console.warn("[scheduled-campaigns] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    return 0;
  }

  let started = 0;
  for (const campaign of campaigns) {
    try {
      const response = await fetchWithTimeout(`${supabaseUrl}/functions/v1/enqueue-campaign`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceKey}`,
        },
        body: JSON.stringify({ campaign_id: campaign.id, __cron: true }),
      }, OUTBOUND_FETCH_TIMEOUT_MS);

      if (response.ok) {
        started++;
      } else {
        const body = await response.text().catch(() => "");
        console.warn(`[scheduled-campaigns] Enqueue failed for ${campaign.id}: ${response.status} ${body}`);
      }
    } catch (err) {
      console.warn(`[scheduled-campaigns] Enqueue exception for ${campaign.id}:`, err);
    }
  }

  if (started > 0) {
    console.log(`[scheduled-campaigns] Auto-started ${started} scheduled campaign(s)`);
  }
  return started;
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

    // BUG-NOVO-05: cache local de failures por instância. Populated do banco
    // (wa_instances.consecutive_undelivered) e atualizado a cada increment/reset.
    // Per-request, NÃO mais escopo de módulo — assim circuit breaker funciona
    // mesmo quando Deno cria nova runtime.
    const instanceFailures = new Map<string, number>();

    await autoStartDueScheduledCampaigns(supabase);

    // ===== ATOMIC CLAIM =====
    // Do not SELECT pending rows and lock them later. Cron can overlap, and a delayed
    // worker would otherwise see the same row. The SQL function uses
    // UPDATE ... FOR UPDATE SKIP LOCKED and returns rows already marked as processing.
    const { data: queueItems, error: queueErr } = await supabase.rpc(
      "claim_wa_queue_items",
      { p_limit: BATCH_SIZE },
    );

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
        .select("id, name, prompt_base, message_template, media_url, media_type, min_delay_seconds, max_delay_seconds, rotation_messages_per_instance, regras_rodizio, regras_delay, regras_aquecimento, started_at, variation_level, sent_count, instance_id, include_optout_buttons, seller_member_id")
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
          console.log(`Campaign ${cid} is ${freshStatus.status}, deferring its pending queue items to unblock queue`);
          // Push ALL pending items of this paused/cancelled campaign 24h into the future
          // so they don't block pending items of active campaigns in the queue
          await supabase
            .from("wa_queue")
            .update({
              status: "pending",
              scheduled_for: new Date(Date.now() + 24 * 3600_000).toISOString(),
            })
            .eq("campaign_id", cid)
            .in("status", ["processing", "pending"]);
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
    const todaySentByInstance = new Map<string, number>();
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const startOfTodayIso = startOfToday.toISOString();

    for (const uid of userIds) {
      // Busca TODAS as instâncias da conta (master + dos vendedores).
      // A filtragem por seller_member_id da campanha acontece no momento do envio,
      // logo antes de chamar selectSmartInstance — assim o pool fica unificado aqui.
      const { data: instances } = await supabase
        .from("wa_instances")
        .select("*")
        .eq("user_id", uid)
        .eq("status", "connected")
        .order("is_active", { ascending: false })
        .order("health_score", { ascending: false });

      if (instances && instances.length > 0) {
        const typedInstances = instances as unknown as Instance[];
        instanceMap.set(uid, typedInstances);

        const instanceIds = typedInstances.map((inst) => inst.id);

        // BUG-NOVO-05: popula instanceFailures a partir de wa_instances.
        // consecutive_undelivered (persistente) em vez de Map global zerado.
        const failureCounts = await loadInstanceFailureCounts(supabase, instanceIds);
        for (const [id, count] of failureCounts) {
          instanceFailures.set(id, count);
        }
        const { data: todaySentRows } = await supabase
          .from("wa_queue")
          .select("instance_id")
          .in("instance_id", instanceIds)
          .in("status", ["sent", "delivered", "read"])
          .gte("sent_at", startOfTodayIso);

        if (todaySentRows) {
          for (const row of todaySentRows as Array<{ instance_id: string | null }>) {
            if (!row.instance_id) continue;
            todaySentByInstance.set(row.instance_id, (todaySentByInstance.get(row.instance_id) || 0) + 1);
          }
        }
      }
    }

    // ===== TRAVA ANTI-BAN: ultimo envio por campanha (cooldown >= 5min) =====
    // Snapshot do ultimo sent_at de cada campanha ativa; atualizado em memoria a
    // cada envio nesta rodada (BATCH_SIZE pode trazer varios itens da mesma campanha).
    const campaignLastSent = new Map<string, number>();
    for (const cid of activeCampaignIds) {
      const { data: lastRow } = await supabase
        .from("wa_queue")
        .select("sent_at")
        .eq("campaign_id", cid)
        .eq("status", "sent")
        .order("sent_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (lastRow?.sent_at) campaignLastSent.set(cid, new Date(lastRow.sent_at).getTime());
    }

    let processed = 0, succeeded = 0, failed = 0;
    const skipReasons: Array<{ item_id: string; reason: string; details?: unknown }> = [];

    // Track recent message hashes to prevent duplicate messages
    const recentMessageHashes = new Set<string>();

    for (const item of activeItems) {
      let selectedInstance: Instance | null = null;
      try {
        // ===== TRAVA ANTI-BAN: cooldown de >= 5min por campanha =====
        // Se esta campanha enviou ha menos de 300s, adia este item (mesmo que
        // varios itens estejam "vencidos", so 1 sai por janela de 5min).
        if (item.campaign_id) {
          const lastTs = campaignLastSent.get(item.campaign_id);
          if (lastTs) {
            const sinceMs = Date.now() - lastTs;
            const floorMs = MARCOS_MIN_DELAY_FLOOR_SECONDS * 1000;
            if (sinceMs < floorMs) {
              await supabase
                .from("wa_queue")
                .update({ status: "pending", scheduled_for: new Date(Date.now() + (floorMs - sinceMs)).toISOString() })
                .eq("id", item.id);
              processed++; continue;
            }
          }
        }

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
            skipReasons.push({ item_id: item.id, reason: "campaign_paused_mid_batch", details: { status: liveStatus.status } });
            processed++;
            continue;
          }
        }

        const campaign = item.campaign_id ? campaignMap.get(item.campaign_id) : null;
        const allUserInstances = instanceMap.get(item.user_id);

        if (!allUserInstances || allUserInstances.length === 0) {
          // No instance connected — incrementa retry_count. Após MAX_RETRIES, marca FAILED.
          // Antes ficava em loop infinito de "defer +60s" e travava a fila inteira (item órfão
          // de master sem instância bloqueava todos os outros porque BATCH_SIZE=1).
          if (item.retry_count >= MAX_RETRIES) {
            await markFailed(supabase, item.id, "Master/conta sem instância WhatsApp conectada após várias tentativas. Conecte um número e re-inicie a campanha.");
            skipReasons.push({ item_id: item.id, reason: "no_user_instances_max_retries", details: { user_id: item.user_id, retry_count: item.retry_count } });
            failed++; processed++; continue;
          }
          await supabase
            .from("wa_queue")
            .update({
              status: "pending",
              retry_count: item.retry_count + 1,
              scheduled_for: new Date(Date.now() + 60_000).toISOString(),
              error_message: `Aguardando instância WhatsApp conectada — tentativa ${item.retry_count + 1}/${MAX_RETRIES}`,
            })
            .eq("id", item.id);
          skipReasons.push({ item_id: item.id, reason: "no_user_instances", details: { user_id: item.user_id, retry_count: item.retry_count + 1 } });
          processed++; continue;
        }

        // ===== ISOLAMENTO POR VENDEDOR =====
        // Se a campanha foi criada por um vendedor (seller_member_id NOT NULL),
        // o disparo DEVE usar a instância DELE (número WhatsApp do vendedor).
        // Master fica de fora — o cliente final precisa ver o número do vendedor.
        // Se a campanha é do master (seller_member_id IS NULL), usa pool master
        // (instâncias com seller_member_id IS NULL).
        let userInstances: Instance[];
        if (campaign?.seller_member_id) {
          userInstances = allUserInstances.filter(
            (i) => i.seller_member_id === campaign.seller_member_id,
          );
          if (userInstances.length === 0) {
            // Vendedor sem instância — incrementa retry_count. Após MAX_RETRIES, marca FAILED.
            // (Mesmo motivo do bug anterior: defer infinito travava a fila inteira.)
            if (item.retry_count >= MAX_RETRIES) {
              await markFailed(supabase, item.id, "Vendedor sem instância WhatsApp conectada após várias tentativas. Conecte um número na conta do vendedor.");
              await notifyCampaignStalled(supabase, { user_id: item.user_id, campaign_id: item.campaign_id, campaign_name: campaign?.name, reason: "o número do vendedor ficou desconectado" });
              skipReasons.push({ item_id: item.id, reason: "seller_no_instance_max_retries", details: { seller_member_id: campaign.seller_member_id, retry_count: item.retry_count } });
              failed++; processed++; continue;
            }
            console.warn(`[seller-isolation] Vendedor ${campaign.seller_member_id} sem instância conectada — adiando 5 min (tentativa ${item.retry_count + 1}/${MAX_RETRIES})`);
            // AVISO #3: a partir da 2a tentativa (~5-10min travado), avisa o dono no portal.
            if (item.retry_count >= 1) {
              await notifyCampaignStalled(supabase, { user_id: item.user_id, campaign_id: item.campaign_id, campaign_name: campaign?.name, reason: "o número do vendedor está desconectado" });
            }
            await supabase
              .from("wa_queue")
              .update({
                status: "pending",
                retry_count: item.retry_count + 1,
                scheduled_for: new Date(Date.now() + 300_000).toISOString(),
                error_message: `Vendedor sem instância WhatsApp — tentativa ${item.retry_count + 1}/${MAX_RETRIES}. Conecte um número na conta do vendedor.`,
              })
              .eq("id", item.id);
            skipReasons.push({ item_id: item.id, reason: "seller_no_instance", details: { seller_member_id: campaign.seller_member_id, retry_count: item.retry_count + 1 } });
            processed++; continue;
          }
        } else {
          // Campanha do master: usa apenas instâncias do pool master (sem dono específico)
          userInstances = allUserInstances.filter((i) => !i.seller_member_id);
          if (userInstances.length === 0) {
            // Sem instância do master — tenta qualquer ativa como último recurso
            userInstances = allUserInstances;
          }
        }

        // --- Smart Switcher: Instance Selection ---
        const instance = await selectSmartInstance(
          supabase,
          userInstances,
          item,
          campaign,
          instanceFailures,
          todaySentByInstance,
        );

        if (!instance) {
          // Circuit broken or at daily limit — defer retry instead of permanently failing
          await supabase
            .from("wa_queue")
            .update({
              status: "pending",
              scheduled_for: new Date(Date.now() + 300_000).toISOString(),
              error_message: "Instâncias no limite ou circuit-breaker ativo — tentando novamente em 5 min",
            })
            .eq("id", item.id);
          skipReasons.push({ item_id: item.id, reason: "select_smart_instance_returned_null", details: { user_instances_count: userInstances.length, instance_ids: userInstances.map(i => i.id) } });
          processed++; continue;
        }

        selectedInstance = instance;

        // --- Generate UNIQUE AI message for EACH contact ---
        let finalMessage = item.message;
        const variationLevel = campaign?.variation_level || "medium";

        if (campaign?.prompt_base) {
          const fixedTemplate = normalizeFixedTemplate(campaign.message_template);
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
                fixedTemplate,
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
              finalMessage = buildFallbackAIMessage(campaign.prompt_base, item.contact_name, item.contact_metadata, variationLevel, fixedTemplate || normalizeFixedTemplate(item.message));
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

        // ===== ANTI-BAN: Validate number exists on WhatsApp before sending =====
        // Skip for UazAPI — endpoint not available; UazAPI only.
        if (instance.provider === "evolution" && !isUazAPIInstance(instance)) {
          const numberValid = await validateWhatsAppNumber(instance, item.phone);
          if (!numberValid) {
            console.log(`Number ${item.phone} not on WhatsApp, skipping`);
            await supabase
              .from("wa_queue")
              .update({ status: "failed", error_message: "Número não possui WhatsApp" })
              .eq("id", item.id);
            failed++; processed++; continue;
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
            skipReasons.push({ item_id: item.id, reason: "campaign_paused_before_send", details: { status: statusBeforeSend.status } });
            processed++;
            continue;
          }
        }

        // Decide if opt-in/opt-out buttons should be sent
        // Buttons only work on standard UazAPI — UazAPI uses plain text.
        const shouldSendOptoutButtons = campaign?.include_optout_buttons &&
          !item.contact_metadata?.last_message_at && // only for first-time contacts
          !isUazAPIInstance(instance);

        const effectiveMediaUrl = item.media_url || campaign?.media_url || null;
        const effectiveMediaType = item.media_type || campaign?.media_type || null;

        let sendResult: SendResult;
        if (shouldSendOptoutButtons && instance.provider === "evolution") {
          // Send message with interactive buttons via UazAPI
          sendResult = await sendEvolutionButtonMessage(instance, item.phone, finalMessage, [
            { buttonId: "optout_continue", buttonText: { displayText: "✅ Quero Continuar Recebendo" } },
            { buttonId: "optout_stop", buttonText: { displayText: "❌ Não Quero Mais Receber" } },
          ]);
        } else {
          sendResult = await sendMessageByProvider(instance, item.phone, finalMessage, effectiveMediaUrl, effectiveMediaType);
        }
        // BUG-NOVO-05: zera contador no banco E cache local
        await resetInstanceFailureCount(supabase, instanceFailures, instance.id);

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
            media_url: effectiveMediaUrl,
            media_type: effectiveMediaType,
            instance_id: instance.id,
            message_hash: messageHash,
          })
          .eq("id", item.id);

        // ===== SHADOW BAN DETECTION: Increment consecutive_undelivered =====
        // When a delivery receipt arrives, it will reset this counter.
        // If it reaches 10+, the instance is flagged as shadow-banned.
        try {
          const { error: undeliveredErr } = await supabase.rpc("increment_consecutive_undelivered", { iid: instance.id });
          if (undeliveredErr) console.warn("increment_consecutive_undelivered failed:", undeliveredErr);
        } catch (rpcEx: any) {
          console.warn("increment_consecutive_undelivered exception:", rpcEx);
        }

        // ===== SAVE TO CRM INBOX =====
        // Store every outgoing message so conversations appear in the unified inbox
        const { error: inboxErr } = await supabase.from("wa_inbox").insert({
          user_id: item.user_id,
          campaign_id: item.campaign_id || null,
          instance_id: instance.id,
          phone: item.phone.replace(/\D/g, ""),
          contact_name: item.contact_name || null,
          direction: "outgoing",
          message_type: effectiveMediaType || "text",
          content: finalMessage,
          media_url: effectiveMediaUrl || null,
          remote_message_id: sendResult.remoteMessageId,
          is_read: true,
          created_at: sentAt,
        });
        if (inboxErr) {
          console.warn("Failed to save outgoing message to inbox:", inboxErr);
        }

        // Update instance counters based on real sent count of the current day
        const nextTodaySent = (todaySentByInstance.get(instance.id) ?? instance.messages_sent_today ?? 0) + 1;
        todaySentByInstance.set(instance.id, nextTodaySent);

        await supabase
          .from("wa_instances")
          .update({
            is_active: true,
            status: "connected",
            messages_sent_today: nextTodaySent,
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
        // TRAVA: marca o envio desta campanha (cooldown de 5min nos proximos itens desta rodada).
        if (item.campaign_id) campaignLastSent.set(item.campaign_id, Date.now());

        // ===== SCHEDULE NEXT ITEM WITH HUMANIZED DELAY =====
        // Instead of sleeping (which can timeout the edge function),
        // we push the scheduled_for of the next pending item forward.
        const delayRules = campaign?.regras_delay || {};
        const rotationRules = campaign?.regras_rodizio || {};
        
        // ===== ANTI-BAN: Use MUCH longer delays for cold contacts =====
        const isCurrentContactCold = !item.contact_metadata?.last_message_at;
        // TRAVA: piso absoluto de 120s (2 min). O vendedor define min/max na campanha
        // (padrao 5-27 min); nunca cai abaixo de 2 min. Sem config => 5-27 min.
        const configuredMinD = Math.max(MARCOS_MIN_DELAY_FLOOR_SECONDS, Number(delayRules.min) || campaign?.min_delay_seconds || DEFAULT_DELAY_MIN_SECONDS);
        const configuredMaxD = Math.max(configuredMinD, Number(delayRules.max) || campaign?.max_delay_seconds || DEFAULT_DELAY_MAX_SECONDS);
        
        const minD = isCurrentContactCold
          ? Math.max(configuredMinD, COLD_CONTACT_MIN_DELAY_SECONDS)
          : configuredMinD;
        const maxD = isCurrentContactCold
          ? Math.max(configuredMaxD, COLD_CONTACT_MAX_DELAY_SECONDS)
          : configuredMaxD;
        
        const delaySec = minD + Math.random() * (maxD - minD);
        // 30% chance of longer pause for cold contacts (was 20%)
        const longPauseChance = isCurrentContactCold ? 0.35 : 0.20;
        const longPauseSec = Math.random() < longPauseChance ? (60 + Math.random() * 120) : 0;

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
        console.log(`Next message scheduled in ${Math.round(totalDelaySec)}s (cold=${isCurrentContactCold})`);

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

        // ===== DETECT DISCONNECTED INSTANCE (503 "session is not reconnectable") =====
        // UazAPI returns 503 with "disconnected" or "not reconnectable" when the WhatsApp
        // session is dead. Mark the instance as disconnected immediately in the DB so
        // subsequent queue items don't keep retrying against a dead instance.
        const isDisconnectedError = errMsg.includes("disconnected") ||
                                     errMsg.includes("not reconnectable") ||
                                     errMsg.includes("session closed");
        if (selectedInstance && isDisconnectedError) {
          console.warn(`[DISCONNECT] Instance ${selectedInstance.id} (${selectedInstance.instance_name}) is disconnected. Marking as inactive.`);
          await supabase
            .from("wa_instances")
            .update({ status: "disconnected", is_active: false, health_score: 0 })
            .eq("id", selectedInstance.id);
          // Remove from in-memory map so no more items use it this invocation
          const userInsts = instanceMap.get(item.user_id);
          if (userInsts) {
            instanceMap.set(item.user_id, userInsts.filter(i => i.id !== selectedInstance.id));
          }
        }

        // Circuit breaker (for non-disconnect errors)
        if (selectedInstance && !isDisconnectedError) {
          // BUG-NOVO-05: incrementa contador PERSISTENTE (banco + cache local)
          const currentFailures = await incrementInstanceFailureCount(supabase, instanceFailures, selectedInstance.id);
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

        if (isInvalidNumberError(errMsg)) {
          // NUMERO ERRADO/INVALIDO: nao adianta re-tentar (vai falhar sempre).
          // Marca como erro NA HORA e a fila segue pro proximo numero — nunca
          // trava por causa de um numero que nao da pra disparar.
          console.warn(`[INVALID-NUMBER] item ${item.id} phone=${item.phone} -> failed sem retry: ${errMsg}`);
          await markFailed(supabase, item.id, `Numero invalido ou errado (pulado): ${errMsg}`.slice(0, 480));
        } else if (item.retry_count < MAX_RETRIES) {
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

    // Check campaign completion — BUG-NOVO-08: distinguir 'completed' (sucessos) de 'failed' (100% falhas)
    // Antes: count pending+processing = 0 → marcava 'completed'. Se TODOS os itens da campanha
    // falharam (instância morta, retries esgotados, etc.), campanha aparecia "✅ Concluída" enquanto
    // 0 mensagens chegaram. Master só percebia depois de horas conferindo manualmente.
    for (const cid of campaignIds) {
      if (!activeCampaignIds.has(cid)) continue; // Don't mark paused as completed

      // Conta itens restantes (pending/processing) + outcomes finais (sent/failed)
      const { count: pendingCount } = await supabase
        .from("wa_queue")
        .select("id", { count: "exact", head: true })
        .eq("campaign_id", cid)
        .in("status", ["pending", "processing"]);

      if (pendingCount !== 0) continue; // Ainda processando

      // Sem itens pending — checa balance sent vs failed pra decidir status final
      const { count: sentCount } = await supabase
        .from("wa_queue")
        .select("id", { count: "exact", head: true })
        .eq("campaign_id", cid)
        .eq("status", "sent");

      const { count: failedCount } = await supabase
        .from("wa_queue")
        .select("id", { count: "exact", head: true })
        .eq("campaign_id", cid)
        .eq("status", "failed");

      const totalFinal = (sentCount ?? 0) + (failedCount ?? 0);
      if (totalFinal === 0) {
        // Edge case raro: campanha sem itens. Marca completed sem alerta.
        await supabase.from("wa_campaigns")
          .update({ status: "completed", completed_at: new Date().toISOString() })
          .eq("id", cid);
        continue;
      }

      const failRate = (failedCount ?? 0) / totalFinal;
      let finalStatus: string;
      let errorMessage: string | null = null;

      if (failRate >= 1.0) {
        // 100% failed → não é "completed", é "failed"
        finalStatus = "failed";
        errorMessage = `Todos os ${failedCount} itens falharam ao enviar. Verifique instância WhatsApp e tente reenviar.`;
        console.error(`[campaign-completion] Campanha ${cid} marcada como FAILED — ${failedCount}/${totalFinal} itens falharam (100%)`);
      } else if (failRate >= 0.5) {
        // Mais de metade falhou → completed mas com alerta
        finalStatus = "completed_with_errors";
        errorMessage = `${failedCount} de ${totalFinal} itens falharam (${Math.round(failRate * 100)}%). Revise antes de re-enviar.`;
        console.warn(`[campaign-completion] Campanha ${cid} concluída com erros — ${failedCount}/${totalFinal} falharam`);
      } else {
        // Maioria sucesso → completed normal
        finalStatus = "completed";
        if ((failedCount ?? 0) > 0) {
          errorMessage = `${failedCount} de ${totalFinal} itens falharam.`;
        }
      }

      const updatePayload: any = {
        status: finalStatus,
        completed_at: new Date().toISOString(),
      };
      if (errorMessage) updatePayload.error_message = errorMessage;

      await supabase.from("wa_campaigns")
        .update(updatePayload)
        .eq("id", cid);
    }

    return new Response(
      JSON.stringify({ processed, succeeded, failed, skipReasons }),
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
  failures: Map<string, number>,
  todaySentByInstance: Map<string, number>,
): Promise<Instance | null> {
  const aquecimento = campaign?.regras_aquecimento || {};
  // O aquecimento SÓ vale quando a chave está explicitamente LIGADA (enabled === true).
  // Com a chave desligada, o número é tratado como pronto — sem rampa nenhuma.
  const warmupEnabled = (aquecimento as any).enabled === true;
  // Piso (dia 0) = initial_messages configurado. Alvo (fim da rampa) = limite_diario_inicial.
  const warmupInitial = Math.max(1, Number((aquecimento as any).initial_messages) || DEFAULT_WARMUP_INITIAL_DAILY);
  const warmupTarget = Math.max(warmupInitial, Number((aquecimento as any).limite_diario_inicial) || DEFAULT_WARMUP_TARGET_DAILY);
  const warmupRampDays = Math.max(1, Number((aquecimento as any).dias_rampa) || WARMUP_RAMP_DAYS);

  const rodizio = campaign?.regras_rodizio || {};
  const rotationLimit = Math.max(1, rodizio.mensagens_por_instancia || campaign?.rotation_messages_per_instance || 10);

  // Se a campanha tem instância específica, usar APENAS ela.
  // Só usa rodízio geral quando a campanha não especifica instância.
  const scopedInstances = campaign?.instance_id
    ? userInstances.filter((inst) => inst.id === campaign.instance_id)
    : userInstances;

  // Fallback: se a instância específica não estiver ativa, usa todas
  const finalInstances = scopedInstances.length > 0 ? scopedInstances : userInstances;

  if (finalInstances.length === 0) {
    return null;
  }

  // ===== ROTATION FIX: Query REAL per-instance sent counts for THIS campaign =====
  // This is the source of truth — no race conditions with campaign.sent_count
  const campaignInstanceCounts = new Map<string, number>();
  for (const inst of finalInstances) {
    campaignInstanceCounts.set(inst.id, 0);
  }

  if (item.campaign_id && finalInstances.length > 1) {
    const instanceIds = finalInstances.map(i => i.id);
    const { data: perInstCounts } = await supabase
      .from("wa_queue")
      .select("instance_id")
      .eq("campaign_id", item.campaign_id)
      .in("instance_id", instanceIds)
      .in("status", ["sent", "delivered", "read"]);

    if (perInstCounts) {
      for (const row of perInstCounts as Array<{ instance_id: string }>) {
        if (!row.instance_id) continue;
        campaignInstanceCounts.set(row.instance_id, (campaignInstanceCounts.get(row.instance_id) || 0) + 1);
      }
    }
  }

  // Determine which instance should be active based on real counts
  // Strategy: Fill each instance up to rotationLimit before moving to next
  // Order instances deterministically (by id to be stable across invocations)
  const orderedInstances = [...finalInstances].sort((a, b) => a.id.localeCompare(b.id));

  // Find the "current" instance: the first one that hasn't reached rotationLimit yet in its current slot
  // Total sent across all instances for this campaign
  const totalCampaignSent = Array.from(campaignInstanceCounts.values()).reduce((a, b) => a + b, 0);
  const rotationCycle = Math.floor(totalCampaignSent / rotationLimit);
  const currentInstanceIndex = rotationCycle % orderedInstances.length;

  console.log(`[ROTATION] totalSent=${totalCampaignSent}, rotationLimit=${rotationLimit}, cycle=${rotationCycle}, currentIdx=${currentInstanceIndex}, perInstance=${JSON.stringify(Object.fromEntries(campaignInstanceCounts))}`);

  let instance: Instance | null = null;

  // Try the current rotation instance first, then fall back to others
  for (let attempts = 0; attempts < orderedInstances.length; attempts++) {
    const candidate = orderedInstances[(currentInstanceIndex + attempts) % orderedInstances.length];
    const candidateFailures = failures.get(candidate.id) || 0;

    if (candidateFailures >= CIRCUIT_BREAKER_THRESHOLD) continue;

    // ===== ANTI-BAN: Enforce daily limits (warmup OR default) =====
    const instanceAgeDays = candidate.created_at
      ? Math.floor((Date.now() - new Date(candidate.created_at).getTime()) / (1000 * 60 * 60 * 24))
      : 999;

    let dailyLimit: number;

    if (!warmupEnabled) {
      // Aquecimento DESLIGADO → sem rampa. Número tratado como pronto, no teto
      // maduro de segurança (200/dia). É escolha do cliente desligar a chave.
      dailyLimit = DEFAULT_DAILY_LIMIT_MATURE_INSTANCE;
    } else if (instanceAgeDays >= warmupRampDays) {
      // Rampa concluída → capacidade alvo configurada.
      dailyLimit = warmupTarget;
    } else {
      // Rampa LINEAR do piso (initial_messages, dia 0) até o alvo (limite_diario_inicial).
      // Nunca abaixo do piso configurado — corrige o bug antigo que ramping de ~0
      // dava floor(50*2/14)=7/dia num número de 1 dia.
      const ramped = warmupInitial + (warmupTarget - warmupInitial) * (instanceAgeDays / warmupRampDays);
      dailyLimit = Math.max(warmupInitial, Math.floor(ramped));
    }

    const candidateSentToday = todaySentByInstance.get(candidate.id) ?? candidate.messages_sent_today ?? 0;

    if (candidateSentToday >= dailyLimit) {
      console.log(`Instance ${candidate.instance_name} hit daily limit (${candidateSentToday}/${dailyLimit}), skipping`);
      continue;
    }

    if (candidate.health_score < 20) continue;

    if (candidate.provider === "meta") {
      const metaLimit = candidate.health_score >= 80 ? 1000 : 250;
      if (candidateSentToday >= metaLimit) continue;
    }

    instance = candidate;
    break;
  }

  // Never sleep here: long pauses must be applied by scheduling the NEXT item
  const pauseBetweenInstances = rodizio.pausa_entre_instancias || 0;
  void pauseBetweenInstances;

  return instance;
}

// ====================== PROVIDER ABSTRACTION ======================

// UazAPI (logos-ia.uazapi.com) can expose either the V6 send endpoints
// or the legacy Evolution-compatible message endpoints with the instance name.
// Erro de NUMERO invalido/errado (numero nao existe / nao e WhatsApp / formato
// recusado pela API). Nesses casos NAO adianta re-tentar — marca failed e pula.
function isInvalidNumberError(msg: string): boolean {
  const m = (msg || "").toLowerCase();
  return (
    m.includes("the number") ||
    m.includes("invalid number") ||
    m.includes("not a valid") ||
    m.includes("number not") ||
    m.includes("not registered") ||
    m.includes("not on whatsapp") ||
    m.includes("no whatsapp") ||
    m.includes("numero invalido") || m.includes("número inválido") ||
    m.includes('"exists":false') || m.includes('"exists": false')
  );
}

function isUazAPIInstance(instance: Instance): boolean {
  return instance.api_url.includes("uazapi");
}

async function sendMessageByProvider(
  instance: Instance,
  phone: string,
  text: string,
  mediaUrl: string | null,
  mediaType: string | null
): Promise<SendResult> {
  if (instance.provider === "meta") {
    return await sendToMetaAPI(instance, phone, text, mediaUrl, mediaType);
  }
  if (isUazAPIInstance(instance)) {
    return await sendToUazAPI(instance, phone, text, mediaUrl, mediaType);
  }
  return await sendToEvolutionAPI(instance, phone, text, mediaUrl, mediaType);
}

// ====================== UAZAPI (logos-ia.uazapi.com) ======================
// UazAPI uses token-based auth (header "token"), no instance name in path.
// Endpoint: POST /send/text  Body: { number, text }

async function sendToUazAPI(
  instance: Instance,
  phone: string,
  text: string,
  mediaUrl: string | null,
  mediaType: string | null
): Promise<SendResult> {
  const apiUrl = instance.api_url.replace(/\/+$/, "");
  const number = phone.replace(/\D/g, "");
  const remoteJid = number + "@s.whatsapp.net";
  const token = instance.api_key_encrypted;

  const authHeaders = { "Content-Type": "application/json", token, apikey: token };

  if (mediaUrl && mediaType) {
    // UazAPI V6: /send/media works with the "file" field. Keep older body
    // shapes as fallbacks because some self-hosted instances lag behind.
    const caption = mediaType === "audio" ? "" : (text || "");
    const mediaTextFields = caption
      ? { text: caption, caption }
      : {};
    const mediaAttempts = [
      { number, file: mediaUrl, type: mediaType, ...mediaTextFields },
      { number, file: mediaUrl, mediatype: mediaType, ...mediaTextFields },
      { number, url: mediaUrl, type: mediaType, ...mediaTextFields },
      { number, media: mediaUrl, mediatype: mediaType, ...mediaTextFields },
      { remoteJid, file: mediaUrl, type: mediaType, ...mediaTextFields },
      { remoteJid, url: mediaUrl, type: mediaType, ...mediaTextFields },
    ];

    let lastMediaError = "";
    for (const body of mediaAttempts) {
      const mediaResponse = await fetchWithTimeout(
        `${apiUrl}/send/media`,
        {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify(body),
        },
        OUTBOUND_FETCH_TIMEOUT_MS
      ).catch((err) => {
        lastMediaError = err instanceof Error ? err.message : String(err);
        return null;
      });

      if (mediaResponse && mediaResponse.ok) {
        const data = await mediaResponse.json().catch(() => ({}));
        return { remoteMessageId: data?.messageId || data?.id || data?.key?.id || null };
      }

      if (mediaResponse) {
        lastMediaError = `${mediaResponse.status} - ${await mediaResponse.text().catch(() => "")}`;
      }
    }

    throw new Error(`UazAPI error (sendMedia): ${lastMediaError}`);
  }

  const textAttempts = [
    { label: "send-text-number", url: `${apiUrl}/send/text`, body: { number, text } },
    { label: "send-text-remotejid", url: `${apiUrl}/send/text`, body: { remoteJid, text } },
    {
      label: "message-sendText",
      url: `${apiUrl}/message/sendText/${encodeURIComponent(instance.instance_name)}`,
      body: { number, text },
    },
  ];

  const textErrors: string[] = [];
  for (const attempt of textAttempts) {
    const response = await fetchWithTimeout(
      attempt.url,
      {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify(attempt.body),
      },
      OUTBOUND_FETCH_TIMEOUT_MS
    ).catch((err) => {
      textErrors.push(`${attempt.label}: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    });

    if (response && response.ok) {
      const data = await response.json().catch(() => ({}));
      const remoteMessageId = data?.messageId || data?.id || data?.key?.id || null;
      if (remoteMessageId) {
        console.log(`[UazAPI] Message sent successfully via ${attempt.label}: ${remoteMessageId}`);
      }
      return { remoteMessageId };
    }

    if (response) {
      textErrors.push(`${attempt.label}: ${response.status} - ${await response.text().catch(() => "")}`);
    }
  }

  throw new Error(`UazAPI error (sendText): ${textErrors.join(" | ")}`);
}

async function sendToMetaAPI(
  instance: Instance,
  phone: string,
  text: string,
  mediaUrl: string | null,
  mediaType: string | null
): Promise<SendResult> {
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

  const data = await response.json().catch(() => ({}));
  const remoteMessageId = data?.messages?.[0]?.id || data?.message_id || null;

  return { remoteMessageId };
}

// ====================== EVOLUTION API (V2 COMPATIBLE) ======================

async function sendToEvolutionAPI(
  instance: Instance,
  phone: string,
  text: string,
  mediaUrl: string | null,
  mediaType: string | null
): Promise<SendResult> {
  const apiUrl = instance.api_url.replace(/\/+$/, "");
  const number = phone.replace(/\D/g, "");

  // ===== PRE-FLIGHT: Verify instance is actually connected =====
  await verifyEvolutionConnection(instance);

  if (mediaUrl && mediaType) {
    // UazAPI: /message/sendMedia/{instance}
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
      throw new Error(`UazAPI error (sendMedia): ${response.status} - ${errText}`);
    }
    const responseBody = await response.text();
    const remoteMessageId = validateEvolutionResponse(responseBody, "sendMedia");
    return { remoteMessageId };
  }

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
    throw new Error(`UazAPI error (sendText): ${response.status} - ${errText}`);
  }
  const responseBody = await response.text();
  const remoteMessageId = validateEvolutionResponse(responseBody, "sendText");
  return { remoteMessageId };
}

// ===== Verify instance connection status before sending =====
async function verifyEvolutionConnection(instance: Instance) {
  // UazAPI does not expose a connection-state endpoint in the same format — skip.
  if (isUazAPIInstance(instance)) return;

  const apiUrl = instance.api_url.replace(/\/+$/, "");
  try {
    const response = await fetchWithTimeout(
      `${apiUrl}/instance/connectionState/${instance.instance_name}`,
      {
        method: "GET",
        headers: { "Content-Type": "application/json", apikey: instance.api_key_encrypted },
      },
      5000
    );

    if (!response.ok) {
      const errText = await response.text();
      // 404 = instância não existe no servidor (deletada/removida) — tratar como aviso, não erro fatal
      if (response.status === 404) {
        console.warn(`Instance ${instance.instance_name} not found on server (404) — skipping connection check`);
        return;
      }
      throw new Error(`Instance ${instance.instance_name} connection check failed: ${response.status} - ${errText}`);
    }

    const data = await response.json();
    // UazAPI returns { instance: { state: "open" } } when connected
    const state = data?.instance?.state || data?.state || data?.connectionState;

    if (state && state !== "open" && state !== "connected") {
      throw new Error(`Instance ${instance.instance_name} is not connected (state: ${state}). Reconnect the WhatsApp number.`);
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes("not connected")) {
      throw err; // Re-throw apenas erros reais de desconexão
    }
    // Timeout, rede ou endpoint não disponível — log aviso e prossegue
    console.warn(`Connection check for ${instance.instance_name} failed (non-critical):`, err);
  }
}

// ===== Validate UazAPI response body for actual delivery =====
function validateEvolutionResponse(responseBody: string, action: string): string | null {
  try {
    const data = JSON.parse(responseBody);

    // Check for error indicators in response body even with 200 status
    if (data.error) {
      throw new Error(`Evolution API ${action} returned error in body: ${JSON.stringify(data.error)}`);
    }

    // Check for "not connected" or similar states in response
    if (data.status === "ERROR" || data.status === "error") {
      throw new Error(`Evolution API ${action} returned error status: ${data.message || JSON.stringify(data)}`);
    }

    const remoteMessageId =
      data.key?.id ||
      data.messageId ||
      data.id ||
      data.message?.key?.id ||
      null;

    if (remoteMessageId) {
      console.log(`Message sent successfully via ${action}: ${remoteMessageId}`);
      return remoteMessageId;
    }

    console.warn(`UazAPI ${action} response has no message ID - delivery uncertain: ${responseBody.substring(0, 200)}`);
    return null;
  } catch (err) {
    if (err instanceof Error && (err.message.includes("returned error") || err.message.includes("returned error status"))) {
      throw err;
    }
    // JSON parse error — log but don't block (some versions return plain text on success)
    console.warn(`Could not parse UazAPI ${action} response: ${responseBody.substring(0, 200)}`);
    return null;
  }
}

// ====================== EVOLUTION INTERACTIVE BUTTONS ======================

async function sendEvolutionButtonMessage(
  instance: Instance,
  phone: string,
  text: string,
  buttons: Array<{ buttonId: string; buttonText: { displayText: string } }>,
): Promise<SendResult> {
  const apiUrl = instance.api_url.replace(/\/+$/, "");
  const number = phone.replace(/\D/g, "");

  // Verify connection before sending
  await verifyEvolutionConnection(instance);

  // Try UazAPI buttons endpoint first
  const payload = {
    number,
    title: "",
    description: text,
    buttons: buttons.map(b => ({
      type: "reply",
      title: b.buttonText.displayText.slice(0, 20), // WhatsApp button limit
    })),
    footer: "",
  };

  let response = await fetchWithTimeout(
    `${apiUrl}/message/sendButtons/${instance.instance_name}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: instance.api_key_encrypted },
      body: JSON.stringify(payload),
    },
    OUTBOUND_FETCH_TIMEOUT_MS,
  );

  // Fallback: if buttons endpoint fails, send as plain text with button text appended
  if (!response.ok) {
    const errText = await response.text();
    console.warn(`[optout-buttons] Button send failed (${response.status}): ${errText}. Falling back to text.`);

    const buttonLabels = buttons.map(b => `▪️ ${b.buttonText.displayText}`).join("\n");
    const fallbackText = `${text}\n\n📋 _Responda com uma das opções:_\n${buttonLabels}`;

    response = await fetchWithTimeout(
      `${apiUrl}/message/sendText/${instance.instance_name}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: instance.api_key_encrypted },
        body: JSON.stringify({ number, text: fallbackText }),
      },
      OUTBOUND_FETCH_TIMEOUT_MS,
    );

    if (!response.ok) {
      const errText2 = await response.text();
      throw new Error(`UazAPI error (sendText fallback): ${response.status} - ${errText2}`);
    }
  }
  const responseBody = await response.text();
  const remoteMessageId = validateEvolutionResponse(responseBody, "sendButtons");
  return { remoteMessageId };
}

// ====================== MESSAGE POLYMORPHISM ======================

function normalizeFixedTemplate(template?: string | null): string | null {
  const trimmed = (template || "").trim();
  if (!trimmed || /^\[IA\]\s*/i.test(trimmed)) return null;
  return trimmed;
}

function buildFallbackAIMessage(
  promptBase: string,
  contactName: string | null,
  _contactMetadata: any,
  variationLevel: string,
  messageTemplate: string | null,
): string {
  const base = (messageTemplate || promptBase || "").replace(/^\[IA\]\s*/i, "").trim();
  const name = contactName?.trim();
  const intro = name ? `${name}, ` : "";

  const conservative = [
    `Oi, ${intro}${base}. Posso te passar mais detalhes por aqui?`,
    `Ola, ${intro}passando para falar sobre: ${base}. Faz sentido para voce?`,
    `${intro}${base}. Se quiser, eu te explico rapidinho por aqui.`,
  ];
  const moderate = [
    `Oi, ${intro}tudo bem? Separei essa mensagem para voce: ${base}. Me responde por aqui se quiser seguir.`,
    `${intro}pensei que isso poderia te interessar: ${base}. Quer que eu te mostre o proximo passo?`,
    `Passando rapido, ${intro}${base}. Se fizer sentido, me chama aqui e eu te ajudo.`,
  ];
  const creative = [
    `${intro}deixa eu te mostrar uma oportunidade: ${base}. Quer receber os detalhes agora?`,
    `Oi! Tenho algo que pode encaixar bem para voce: ${base}. Me responde com "quero" que eu continuo.`,
    `${intro}antes que passe batido: ${base}. Quer que eu te explique em uma mensagem curta?`,
  ];

  const pool = variationLevel === "low"
    ? conservative
    : variationLevel === "high"
      ? creative
      : moderate;
  const selected = pool[Math.floor(Math.random() * pool.length)] || base;
  return selected.slice(0, 500);
}

async function generateAIMessage(
  promptBase: string,
  phone: string,
  contactName: string | null,
  _contactMetadata: any,
  variationLevel: string,
  messageTemplate: string | null,
  supabaseClient?: any,
  userId?: string
): Promise<string> {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

  let personalizationContext = "";
  if (contactName) personalizationContext += `\nNome do lead: ${contactName}`;

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
- Use apenas o nome do lead quando ele for fornecido. Nao cite campos de planilha como cargo, empresa, origem, tag, metadata ou dados extras
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

// ====================== ANTI-BAN: NUMBER VALIDATION ======================

async function validateWhatsAppNumber(instance: Instance, phone: string): Promise<boolean> {
  try {
    const apiUrl = instance.api_url.replace(/\/+$/, "");
    const number = phone.replace(/\D/g, "");

    const response = await fetchWithTimeout(
      `${apiUrl}/chat/whatsappNumbers/${instance.instance_name}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: instance.api_key_encrypted },
        body: JSON.stringify({ numbers: [number] }),
      },
      NUMBER_VALIDATION_TIMEOUT_MS,
    );

    if (!response.ok) {
      // If endpoint not available, don't block sending
      console.warn(`Number validation endpoint returned ${response.status}, proceeding anyway`);
      return true;
    }

    const data = await response.json();
    // UazAPI returns array: [{ exists: true/false, jid: "...", number: "..." }]
    const results = Array.isArray(data) ? data : data?.data || data?.result || [];
    
    if (results.length > 0) {
      const result = results[0];
      if (result.exists === false) {
        return false;
      }
    }

    return true;
  } catch (err) {
    // On any error, don't block the send (validation is best-effort)
    console.warn(`Number validation failed for ${phone}, proceeding:`, err);
    return true;
  }
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
  if (instance.provider === "meta" || isUazAPIInstance(instance)) return;

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
  if (instance.provider === "meta" || isUazAPIInstance(instance)) return;
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
  if (instance.provider === "meta" || isUazAPIInstance(instance)) return;
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
  if (instance.provider === "meta" || isUazAPIInstance(instance)) return;
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
