import { PedroV2IntentResult, PedroV2LeadMemory } from "./types.ts";

function mergeObjects<T extends Record<string, any>>(base: T, patch: T): T {
  const out: Record<string, any> = { ...(base || {}) };
  for (const [key, value] of Object.entries(patch || {})) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      out[key] = value;
    } else if (typeof value === "object" && value !== null) {
      out[key] = mergeObjects(out[key] || {}, value);
    } else {
      out[key] = value;
    }
  }
  return out as T;
}

export async function ensurePedroV2Lead(
  supabase: any,
  input: {
    user_id: string;
    agent_id: string;
    instance_id?: string | null;
    remote_jid: string;
    lead_name?: string | null;
    previous_seller_id?: string | null;
    now?: string;
  },
) {
  const now = input.now || new Date().toISOString();
  const { data: existing } = await supabase
    .from("ai_crm_leads")
    .select("id, assigned_to_id, status, status_crm")
    .eq("agent_id", input.agent_id)
    .eq("remote_jid", input.remote_jid)
    .maybeSingle();

  if (!existing?.id) {
    const { error: upsertError } = await supabase.from("ai_crm_leads").upsert(
      {
        user_id: input.user_id,
        agent_id: input.agent_id,
        instance_id: input.instance_id || null,
        remote_jid: input.remote_jid,
        lead_name: input.lead_name || "Lead",
        message_count: 1,
        origem: "outros",
        status: "novo",
        status_crm: "novo",
        assigned_to_id: null,
        last_user_reply_at: now,
        last_interaction_at: now,
        followup_5min_sent: false,
      },
      { onConflict: "agent_id, remote_jid", ignoreDuplicates: true },
    );
    if (upsertError) {
      console.error("[ensurePedroV2Lead] Upsert error:", upsertError);
    }
  }

  const { error: updateError } = await supabase
    .from("ai_crm_leads")
    .update({
      instance_id: input.instance_id || null,
      lead_name: input.lead_name || "Lead",
      last_user_reply_at: now,
      last_interaction_at: now,
      followup_5min_sent: false,
    })
    .eq("agent_id", input.agent_id)
    .eq("remote_jid", input.remote_jid);

  if (updateError) {
    console.error("[ensurePedroV2Lead] Update error:", updateError);
  }

  const { data: lead, error } = await supabase
    .from("ai_crm_leads")
    .select("id, assigned_to_id, status, status_crm, lead_name, created_at")
    .eq("agent_id", input.agent_id)
    .eq("remote_jid", input.remote_jid)
    .maybeSingle();

  if (error) {
    console.error("[ensurePedroV2Lead] Final select error:", error);
    throw error;
  }
  return lead;
}

// Persiste atribuicao de trafego pago (utm_*) em wa_contacts a partir do
// contexto de anuncio detectado no turno. O Pedro v1 (wa-inbox-webhook) gravava
// utm_source/utm_campaign/fbclid em wa_contacts; o v2 nunca tocou nessa tabela,
// entao o painel "Trafego Pago" (CampanhaAnalytics) ficava vazio com o v2 no ar.
// Aqui replicamos a gravacao: quando a mensagem trouxe contexto de anuncio do
// Meta/CTWA, criamos/atualizamos a linha do contato com as colunas que o painel
// le. Idempotente por (user_id, phone). NUNCA lanca — so loga (nao pode quebrar
// o atendimento). So escreve quando ha sinal real de anuncio pago (rede social
// conhecida ou fbclid), evitando poluir o painel com imagens "tipo anuncio".
export async function persistPedroV2ContactUtm(
  supabase: any,
  input: {
    user_id: string;
    lead_id?: string | null;
    phone: string; // digitos
    name?: string | null;
    adContext: any; // PedroV2AdContext
  },
): Promise<void> {
  try {
    const ad = input.adContext;
    if (!ad || ad.has_ad_context !== true) return;
    const phone = String(input.phone || "").replace(/\D/g, "");
    if (!input.user_id || !phone) return;

    // Deriva utm a partir da URL do anuncio (quando houver) + da fonte detectada.
    const url = typeof ad.url === "string" ? ad.url : "";
    let params: URLSearchParams | null = null;
    try {
      if (url) params = new URL(url).searchParams;
    } catch {
      /* url malformada — ignora */
    }
    const fromUrl = (k: string) => (params?.get(k) || "").trim() || null;
    const metaId = (...keys: string[]) => {
      for (const key of keys) {
        const value = fromUrl(key);
        if (!value) continue;
        const normalized = value.replace(/^act_/, "");
        if (/^\d{5,30}$/.test(normalized)) return normalized;
      }
      return null;
    };

    const src = String(ad.source || "").toLowerCase();
    const isSocialAd = src.includes("facebook") || src.includes("fb.me") ||
      src.includes("instagram") || src.includes("meta");
    // ── Atribuicao nativa CTWA (vem do payload do anuncio, nao da URL) ──
    const ctwa_clid = (typeof ad.ctwa_clid === "string" && ad.ctwa_clid.trim()) ? ad.ctwa_clid.trim() : null;
    const meta_source_url = (typeof ad.url === "string" && ad.url.trim()) ? ad.url.trim() : null;
    const meta_headline = (typeof ad.headline === "string" && ad.headline.trim())
      ? ad.headline.trim()
      : (typeof ad.title === "string" && ad.title.trim() ? ad.title.trim() : null);
    const sourceIdAd = (typeof ad.source_id === "string" && /^\d{5,30}$/.test(ad.source_id.trim()))
      ? ad.source_id.trim() : null;
    const fbclid = fromUrl("fbclid");
    const utm_source = fromUrl("utm_source") || (isSocialAd || ctwa_clid ? "meta_ads" : null);

    // Sem NENHUM sinal de anuncio pago (utm, fbclid ou ctwa_clid)? nao grava.
    if (!utm_source && !fbclid && !ctwa_clid) return;

    const utm_campaign = fromUrl("utm_campaign") || (ad.title || null);
    const utm_medium = fromUrl("utm_medium");
    const utm_content = fromUrl("utm_content");
    const campaign_id = metaId("campaign_id", "utm_campaign_id", "hsa_cam");
    const adset_id = metaId("adset_id", "utm_adset_id", "hsa_grp");
    const ad_id = metaId("ad_id", "utm_ad_id", "hsa_ad");
    const entry_channel = src.includes("instagram") ? "Instagram" : src.includes("facebook") ? "Facebook" : "WhatsApp";

    const patch: Record<string, any> = {};
    if (utm_source) patch.utm_source = utm_source;
    if (utm_campaign) patch.utm_campaign = utm_campaign;
    if (utm_medium) patch.utm_medium = utm_medium;
    if (utm_content) patch.utm_content = utm_content;
    if (fbclid) patch.fbclid = fbclid;

    const { data: existing } = await supabase
      .from("wa_contacts")
      .select("id")
      .eq("user_id", input.user_id)
      .eq("phone", phone)
      .limit(1)
      .maybeSingle();

    if (existing?.id) {
      await supabase.from("wa_contacts").update(patch).eq("id", existing.id);
    } else {
      await supabase.from("wa_contacts").insert({
        user_id: input.user_id,
        phone,
        name: input.name || null,
        source: "meta_ads",
        last_message_at: new Date().toISOString(),
        ...patch,
      });
    }

    if (input.lead_id) {
      const leadPatch: Record<string, any> = {
        entry_channel,
        entry_datetime: new Date().toISOString(),
        paid_origin_payload: {
          source: ad.source || null,
          url: ad.url || null,
          title: ad.title || null,
          summary: ad.summary || null,
          raw_text: ad.raw_text || null,
          utm_source,
          utm_medium,
          utm_campaign,
          utm_content,
          fbclid,
          ctwa_clid,
          source_id: sourceIdAd,
          source_type: (typeof ad.source_type === "string" ? ad.source_type : null),
          headline: meta_headline,
        },
        updated_at: new Date().toISOString(),
      };
      if (campaign_id) leadPatch.campaign_id = campaign_id;
      if (utm_campaign) leadPatch.campaign_name = utm_campaign;
      if (adset_id) leadPatch.adset_id = adset_id;
      if (ad_id) leadPatch.ad_id = ad_id;
      else if (sourceIdAd) leadPatch.ad_id = sourceIdAd; // CTWA: source_id == id do anuncio
      if (utm_content) leadPatch.ad_name = utm_content;
      // Colunas CTWA dedicadas — so escreve quando ha valor (idempotente, nunca zera).
      if (ctwa_clid) leadPatch.ctwa_clid = ctwa_clid;
      if (meta_source_url) leadPatch.meta_source_url = meta_source_url;
      if (meta_headline) leadPatch.meta_headline = meta_headline;

      await supabase
        .from("ai_crm_leads")
        .update(leadPatch)
        .eq("id", input.lead_id)
        .eq("user_id", input.user_id);
    }
  } catch (e) {
    console.warn("[persistPedroV2ContactUtm] falhou (ignorado):", e);
  }
}

export async function findPedroV2Lead(
  supabase: any,
  input: { agent_id: string; remote_jid: string },
) {
  const { data, error } = await supabase
    .from("ai_crm_leads")
    .select("id, assigned_to_id, status, status_crm, lead_name, created_at")
    .eq("agent_id", input.agent_id)
    .eq("remote_jid", input.remote_jid)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function loadPedroMemory(
  supabase: any,
  input: { lead_id: string; agent_id: string },
): Promise<PedroV2LeadMemory> {
  const { data } = await supabase
    .from("pedro_conversation_state")
    .select("state")
    .eq("lead_id", input.lead_id)
    .eq("agent_id", input.agent_id)
    .maybeSingle();

  return (data?.state || {}) as PedroV2LeadMemory;
}

export async function updatePedroMemoryFromIntent(
  supabase: any,
  input: {
    lead_id: string;
    agent_id: string;
    user_id: string;
    current: PedroV2LeadMemory;
    intent: PedroV2IntentResult;
    lead_phone: string;
    lead_name?: string | null;
  },
) {
  const patch: PedroV2LeadMemory = {
    lead: {
      telefone: input.lead_phone,
      nome: input.lead_name || input.current?.lead?.nome || null,
    },
    atendimento: {
      etapa: input.intent.needs_stock_search ? "consultando_estoque" : input.current?.atendimento?.etapa || "entendendo_interesse",
      ultimo_proximo_passo: input.intent.needs_stock_search ? "consultar_estoque" : null,
    },
    ...input.intent.extracted,
  };
  const state = mergeObjects(input.current || {}, patch);

  await supabase.from("pedro_conversation_state").upsert(
    {
      lead_id: input.lead_id,
      agent_id: input.agent_id,
      user_id: input.user_id,
      state,
      qualificacao_score: calculateBasicScore(state),
      last_extracted_at: new Date().toISOString(),
    },
    { onConflict: "lead_id,agent_id" },
  );

  return state;
}

export function calculateBasicScore(state: PedroV2LeadMemory): number {
  let score = 0;
  if (state.lead?.nome) score += 10;
  if (state.lead?.telefone) score += 10;
  if (state.interesse?.modelo_desejado) score += 20;
  if (state.interesse?.tipo_veiculo) score += 10;
  if (state.interesse?.preco_max) score += 10;
  if (state.negociacao?.forma_pagamento) score += 15;
  if (state.negociacao?.tem_troca !== undefined && state.negociacao?.tem_troca !== null) score += 10;
  if ((state.veiculos_apresentados || []).length > 0) score += 15;
  return Math.min(100, score);
}
