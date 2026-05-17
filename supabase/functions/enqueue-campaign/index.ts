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
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const body = await req.json();
    const { campaign_id, __cron } = body;
    if (!campaign_id) {
      return new Response(JSON.stringify({ error: "campaign_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── BRANCH 1: invocação por cron (service_role) ────────────────────────
    // O cron passa __cron=true + Bearer service_role_key. Nesse caso bypassa
    // auth.getUser() e usa o user_id/seller_member_id que JÁ está em wa_campaigns.
    let isSeller = false;
    let effectiveUserId: string;
    let sellerMemberId: string | null = null;

    const incomingToken = authHeader.replace("Bearer ", "").trim();
    const isCronCall = __cron === true && incomingToken === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (isCronCall) {
      // Cron: pega user_id/seller_member_id direto da campanha
      const { data: c } = await serviceClient
        .from("wa_campaigns")
        .select("user_id, seller_member_id")
        .eq("id", campaign_id)
        .maybeSingle();
      if (!c?.user_id) {
        return new Response(JSON.stringify({ error: "Campaign not found (cron)" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      effectiveUserId = c.user_id;
      sellerMemberId = c.seller_member_id;
      isSeller = !!sellerMemberId;
      console.log(`[enqueue-campaign] CRON invocation campaign=${campaign_id} user=${effectiveUserId} seller=${sellerMemberId}`);
    } else {
      // ── BRANCH 2: invocação por usuário (master ou vendedor) via JWT ─────────
      const userClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: authHeader } } }
      );
      const { data: userData, error: userError } = await userClient.auth.getUser();
      if (userError || !userData?.user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const userId = userData.user.id;

      // Detect seller. O save-campaign aceita o modelo de profiles (role=seller
      // + manager_id), enquanto o disparo usa ai_team_members para isolar a
      // instancia do vendedor. Precisamos aceitar os dois modelos, senão a
      // campanha é criada no master mas o enqueue procura no user_id do vendedor.
      const { data: memberRow } = await serviceClient
        .from("ai_team_members")
        .select("id, user_id")
        .eq("auth_user_id", userId)
        .order("is_active", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const { data: profileRow } = await serviceClient
        .from("profiles")
        .select("role, manager_id")
        .eq("id", userId)
        .maybeSingle();

      const profileManagerId =
        profileRow?.role === "seller" && profileRow.manager_id
          ? profileRow.manager_id
          : null;

      isSeller = !!memberRow?.user_id || !!profileManagerId;
      effectiveUserId = memberRow?.user_id || profileManagerId || userId;
      sellerMemberId = memberRow?.id || null;
      console.log(`[enqueue-campaign] USER invocation requester=${userId} isSeller=${isSeller} effectiveUser=${effectiveUserId} sellerMember=${sellerMemberId}`);
    }

    // Fetch campaign using serviceClient + effectiveUserId (seller sees master's campaigns)
    const { data: campaign, error: campErr } = await serviceClient
      .from("wa_campaigns")
      .select("*")
      .eq("id", campaign_id)
      .eq("user_id", effectiveUserId)
      .single();

    if (campErr || !campaign) {
      return new Response(JSON.stringify({ error: "Campaign not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Se é vendedor: confirma que a campanha é DELE (seller_member_id bate)
    if (isSeller && sellerMemberId && campaign.seller_member_id !== sellerMemberId) {
      console.warn(`[enqueue-campaign] Vendedor ${sellerMemberId} tentou iniciar campanha ${campaign_id} (dono=${campaign.seller_member_id})`);
      return new Response(JSON.stringify({ error: "Você não tem permissão pra iniciar esta campanha" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!["draft", "paused", "scheduled"].includes(campaign.status)) {
      return new Response(
        JSON.stringify({ error: "Campanha precisa estar em rascunho, pausada ou agendada para iniciar" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const listIds: string[] = (
      Array.isArray(campaign.listas_alvo) && campaign.listas_alvo.length > 0
        ? campaign.listas_alvo
        : Array.isArray(campaign.list_ids) && campaign.list_ids.length > 0
          ? campaign.list_ids
          : []
    );

    // Use regras_delay if available, fallback to legacy columns
    const delayRules = campaign.regras_delay || {};
    const minDelay = delayRules.min || campaign.min_delay_seconds || 5;
    const maxDelay = delayRules.max || campaign.max_delay_seconds || 15;

    // ── PAUSED RESUME WITHOUT LISTS: reactivate existing queue entries ──────────
    // When a paused campaign has no list IDs saved (older campaigns or direct imports),
    // skip contact fetch and just reactivate what's already in the queue.
    if (listIds.length === 0 && campaign.status === "paused") {
      const { data: existingPending, error: queueReadErr } = await serviceClient
        .from("wa_queue")
        .select("id")
        .eq("campaign_id", campaign_id)
        .in("status", ["pending", "failed", "processing"]);

      if (queueReadErr) {
        return new Response(JSON.stringify({ error: "Erro ao ler fila da campanha." }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (!existingPending || existingPending.length === 0) {
        return new Response(JSON.stringify({ error: "Nenhum contato pendente na fila. Edite a campanha e selecione uma lista de contatos." }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: claimedCampaign, error: claimErr } = await serviceClient
        .from("wa_campaigns")
        .update({
          status: "running",
          started_at: campaign.started_at || new Date().toISOString(),
        })
        .eq("id", campaign_id)
        .eq("user_id", effectiveUserId)
        .eq("status", campaign.status)
        .select("id")
        .maybeSingle();

      if (claimErr) {
        console.error("Campaign claim error:", claimErr);
        return new Response(JSON.stringify({ error: "Erro ao iniciar campanha." }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (!claimedCampaign) {
        return new Response(
          JSON.stringify({ success: true, enqueued: 0, total_contacts: existingPending.length, message: "Campanha ja estava em processamento." }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const ids = existingPending.map((r: any) => r.id);
      const baseTime = Date.now();
      let cursor = baseTime;
      const updates = ids.map((id: string) => {
        const scheduledFor = new Date(cursor).toISOString();
        const randomDelay = minDelay + Math.random() * (maxDelay - minDelay);
        cursor += randomDelay * 1000;
        return { id, status: "pending", scheduled_for: scheduledFor, retry_count: 0, error_message: null };
      });

      for (let i = 0; i < updates.length; i += 500) {
        const { error: updErr } = await serviceClient
          .from("wa_queue")
          .upsert(updates.slice(i, i + 500), { onConflict: "id" });
        if (updErr) {
          console.error("Queue reactivate error:", updErr);
          return new Response(JSON.stringify({ error: "Erro ao reativar fila." }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }

      return new Response(
        JSON.stringify({ success: true, enqueued: updates.length, total_contacts: updates.length }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── NO LISTS FOR DRAFT: clear error message ──────────────────────────────
    if (listIds.length === 0) {
      return new Response(JSON.stringify({ error: "Nenhuma lista de contatos selecionada. Edite a campanha e adicione uma lista antes de iniciar." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch all contacts from selected lists WITH metadata for AI personalization
    // Use serviceClient + effectiveUserId so seller can access master's contacts
    const { data: contacts, error: contactsErr } = await serviceClient
      .from("wa_contacts")
      .select("id, phone, name, metadata")
      .in("list_id", listIds)
      .eq("is_valid", true)
      .eq("user_id", effectiveUserId);

    if (contactsErr) {
      return new Response(JSON.stringify({ error: "Erro ao buscar contatos das listas." }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!contacts || contacts.length === 0) {
      return new Response(JSON.stringify({ error: "Nenhum contato válido nas listas selecionadas." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Deduplicate by phone
    const uniqueContacts = new Map<string, { id: string; phone: string; name: string | null; metadata: any }>();
    for (const c of contacts) {
      const normalized = c.phone.replace(/\D/g, "");
      if (!uniqueContacts.has(normalized)) {
        uniqueContacts.set(normalized, { id: c.id, phone: normalized, name: c.name, metadata: c.metadata });
      }
    }

    const contactArr = Array.from(uniqueContacts.values());

    const { data: claimedCampaign, error: claimErr } = await serviceClient
      .from("wa_campaigns")
      .update({
        status: "running",
        started_at: campaign.started_at || new Date().toISOString(),
      })
      .eq("id", campaign_id)
      .eq("user_id", effectiveUserId)
      .eq("status", campaign.status)
      .select("id")
      .maybeSingle();

    if (claimErr) {
      console.error("Campaign claim error:", claimErr);
      return new Response(JSON.stringify({ error: "Erro ao iniciar campanha." }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!claimedCampaign) {
      return new Response(
        JSON.stringify({ success: true, enqueued: 0, total_contacts: contactArr.length, message: "Campanha ja estava em processamento." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Use scheduled_at from campaign as base time, fallback to now
    const baseTime = campaign.scheduled_at
      ? new Date(campaign.scheduled_at).getTime()
      : Date.now();

    // Ensure base time is in the future
    const now = Date.now();
    const effectiveBaseTime = Math.max(baseTime, now);

    // Read current queue rows so resume/edit works from where it stopped
    const { data: existingQueue, error: existingQueueErr } = await serviceClient
      .from("wa_queue")
      .select("id, contact_id, phone, status")
      .eq("campaign_id", campaign_id);

    if (existingQueueErr) {
      console.error("Queue read error:", existingQueueErr);
      return new Response(JSON.stringify({ error: "Failed to read existing queue" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const existingByContactId = new Map<string, { id: string; status: string }>();
    const existingByPhone = new Map<string, { id: string; status: string }>();

    for (const row of existingQueue || []) {
      if (row.contact_id) existingByContactId.set(row.contact_id, { id: row.id, status: row.status });
      if (row.phone) existingByPhone.set(String(row.phone).replace(/\D/g, ""), { id: row.id, status: row.status });
    }

    const terminalStatuses = new Set(["sent", "delivered", "read"]);

    const rowsToReactivate: Array<Record<string, unknown>> = [];
    const rowsToInsert: Array<Record<string, unknown>> = [];

    let scheduleCursor = effectiveBaseTime;
    const nextSchedule = () => {
      const scheduledFor = new Date(scheduleCursor).toISOString();
      const randomDelay = minDelay + Math.random() * (maxDelay - minDelay);
      scheduleCursor += randomDelay * 1000;
      return scheduledFor;
    };

    for (const c of contactArr) {
      const existing = existingByContactId.get(c.id) || existingByPhone.get(c.phone);

      // Keep already sent/delivered/read contacts untouched when resuming
      if (existing && terminalStatuses.has(existing.status)) {
        continue;
      }

      const scheduledFor = nextSchedule();

      if (existing) {
        // Resume paused/cancelled/processing from where campaign stopped
        rowsToReactivate.push({
          id: existing.id,
          user_id: effectiveUserId,
          campaign_id,
          contact_id: c.id,
          phone: c.phone,
          status: "pending",
          scheduled_for: scheduledFor,
          retry_count: 0,
          error_message: null,
          message: campaign.message_template || "",
          media_url: campaign.media_url || null,
          media_type: campaign.media_type || null,
          contact_metadata: c.metadata || null,
          contact_name: c.name || null,
        });
      } else {
        rowsToInsert.push({
          user_id: effectiveUserId,
          campaign_id,
          contact_id: c.id,
          phone: c.phone,
          message: campaign.message_template || "",
          media_url: campaign.media_url || null,
          media_type: campaign.media_type || null,
          status: "pending",
          scheduled_for: scheduledFor,
          contact_metadata: c.metadata || null,
          contact_name: c.name || null,
          retry_count: 0,
        });
      }
    }

    const batchSize = 500;

    for (let i = 0; i < rowsToReactivate.length; i += batchSize) {
      const batch = rowsToReactivate.slice(i, i + batchSize);
      const { error: reactivateErr } = await serviceClient
        .from("wa_queue")
        .upsert(batch, { onConflict: "id" });

      if (reactivateErr) {
        console.error("Queue reactivate error:", reactivateErr);
        return new Response(
          JSON.stringify({ error: `Failed to reactivate queue batch at offset ${i}` }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    for (let i = 0; i < rowsToInsert.length; i += batchSize) {
      const batch = rowsToInsert.slice(i, i + batchSize);
      const { error: insertErr } = await serviceClient
        .from("wa_queue")
        .upsert(batch, { onConflict: "campaign_id,contact_id", ignoreDuplicates: true });

      if (insertErr) {
        console.error("Queue insert error:", insertErr);
        return new Response(
          JSON.stringify({ error: `Failed to enqueue batch at offset ${i}` }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    const enqueuedCount = rowsToReactivate.length + rowsToInsert.length;

    // Update campaign status and total_contacts
    await serviceClient
      .from("wa_campaigns")
      .update({
        status: "running",
        total_contacts: contactArr.length,
        started_at: campaign.started_at || new Date().toISOString(),
      })
      .eq("id", campaign_id);

    return new Response(
      JSON.stringify({
        success: true,
        enqueued: enqueuedCount,
        total_contacts: contactArr.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("enqueue-campaign error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
