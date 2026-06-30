import { createClient } from "npm:@supabase/supabase-js@2";
import { sendPedroText } from "../_shared/pedro-v2/uazapiSender_20260524.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-hub-signature, x-hub-signature-256, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const META_GRAPH_VERSION = Deno.env.get("META_GRAPH_VERSION") || "v25.0";
const META_GRAPH_URL = `https://graph.facebook.com/${META_GRAPH_VERSION}`;
const DEFAULT_TEMPLATE =
  "Oi, {nome}. Aqui e da {empresa}. Recebemos seu cadastro no Facebook sobre {interesse}. Posso te ajudar por aqui?";

type MetaField = { name?: string; values?: string[] };
type LeadConfig = {
  id: string;
  user_id: string;
  ad_account_id: string | null;
  page_id: string;
  page_name: string | null;
  form_id: string;
  form_name: string;
  agent_id: string | null;
  instance_id: string | null;
  is_active: boolean;
  auto_contact_enabled: boolean;
  initial_message_template: string | null;
  processing_mode: string | null;
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function adminClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

async function getAuthenticatedUser(req: Request) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );

  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return null;
  return user.id;
}

function timingSafeEqual(a: string, b: string) {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  if (left.length !== right.length) return false;
  let result = 0;
  for (let i = 0; i < left.length; i++) result |= left[i] ^ right[i];
  return result === 0;
}

async function verifyMetaSignature(rawBody: string, headerValue: string | null) {
  const appSecret = Deno.env.get("META_APP_SECRET") || "";
  if (!appSecret) {
    console.error("[meta-leadgen] META_APP_SECRET ausente");
    return false;
  }
  if (!headerValue?.startsWith("sha256=")) return false;
  const received = headerValue.slice("sha256=".length);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const expected = Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return timingSafeEqual(expected, received);
}

async function fetchMeta(endpoint: string, token: string, init?: RequestInit) {
  const clean = endpoint.replace(/^\//, "");
  const url = new URL(`${META_GRAPH_URL}/${clean}`);
  if (!url.searchParams.has("access_token")) url.searchParams.set("access_token", token);
  const res = await fetch(url.toString(), {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    const message = data?.error?.message || `Meta HTTP ${res.status}`;
    const error = new Error(message) as Error & { meta?: unknown; status?: number };
    error.meta = data?.error || data;
    error.status = res.status;
    throw error;
  }
  return data;
}

function normalizePhone(value: string | null | undefined) {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  const noLeadingZero = digits.replace(/^0+/, "");
  if (noLeadingZero.length === 10 || noLeadingZero.length === 11) return `55${noLeadingZero}`;
  return noLeadingZero;
}

function firstField(fieldMap: Record<string, string>, names: string[]) {
  for (const name of names) {
    const found = fieldMap[name.toLowerCase()];
    if (found) return found;
  }
  return "";
}

function normalizeFieldData(fields: MetaField[] | null | undefined) {
  const map: Record<string, string> = {};
  for (const field of fields || []) {
    const key = String(field?.name || "").trim().toLowerCase();
    if (!key) continue;
    map[key] = Array.isArray(field.values) ? field.values.filter(Boolean).join(", ") : "";
  }

  const firstName = firstField(map, ["first_name", "primeiro_nome"]);
  const lastName = firstField(map, ["last_name", "sobrenome"]);
  const fullName = firstField(map, ["full_name", "nome_completo", "name", "nome"]) ||
    [firstName, lastName].filter(Boolean).join(" ");
  const phone = normalizePhone(firstField(map, ["phone_number", "phone", "telefone", "whatsapp", "celular"]));
  const email = firstField(map, ["email", "e-mail"]);
  const interestKey = Object.keys(map).find((key) =>
    /veiculo|veículo|carro|modelo|interesse|interest|produto/.test(key)
  );
  const interest = interestKey ? map[interestKey] : "";

  return { map, fullName, phone, email, interest };
}

function renderTemplate(template: string | null | undefined, vars: Record<string, string>) {
  const text = template || DEFAULT_TEMPLATE;
  return text.replace(/\{(\w+)\}/g, (_match, key) => vars[key] || "");
}

async function getAccountForUser(supabase: any, userId: string, adAccountId?: string | null) {
  let query = supabase
    .from("ad_accounts")
    .select("*")
    .eq("user_id", userId)
    .eq("platform", "meta")
    .eq("is_active", true);

  if (adAccountId) query = query.eq("id", adAccountId);

  const { data, error } = await query.order("created_at", { ascending: true }).limit(1).maybeSingle();
  if (error || !data?.access_token_encrypted) {
    throw new Error("Conta Meta ativa nao encontrada ou sem token. Reconecte a Meta em Configuracoes.");
  }
  return data;
}

async function resolvePageToken(adAccountToken: string, pageId: string) {
  const pages = await fetchMeta("me/accounts?fields=id,name,access_token&limit=200", adAccountToken)
    .then((data) => data?.data || [])
    .catch(() => []);
  const page = pages.find((item: any) => String(item.id) === String(pageId));
  return page?.access_token || adAccountToken;
}

async function subscribePageLeadgen(adAccountToken: string, pageId: string) {
  const pageToken = await resolvePageToken(adAccountToken, pageId);
  try {
    await fetchMeta(`${pageId}/subscribed_apps?subscribed_fields=leadgen`, pageToken, { method: "POST" });
    return { ok: true };
  } catch (error) {
    console.warn("[meta-leadgen] Falha ao assinar pagina", pageId, error);
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function listForms(userId: string) {
  const supabase = adminClient();
  const { data: accounts, error } = await supabase
    .from("ad_accounts")
    .select("id, account_id, account_name, access_token_encrypted")
    .eq("user_id", userId)
    .eq("platform", "meta")
    .eq("is_active", true);
  if (error) throw error;

  const pages: any[] = [];
  for (const account of accounts || []) {
    const token = account.access_token_encrypted;
    if (!token) continue;

    // Coleta paginas de 3 fontes e deduplica por id:
    //  1) paginas pessoais (me/accounts)
    //  2) paginas que o Business Manager possui (owned_pages)
    //  3) paginas que o BM acessa como cliente (client_pages)
    // me/accounts sozinho NAO traz paginas de Business Manager.
    const pageFields = "id,name,category,picture{url},access_token";
    const pageMap = new Map<string, any>();
    const addPages = (list: any[]) => {
      for (const p of list || []) {
        const id = String(p?.id || "");
        if (id && !pageMap.has(id)) pageMap.set(id, p);
      }
    };

    addPages(
      await fetchMeta(`me/accounts?fields=${pageFields}&limit=200`, token)
        .then((d) => d?.data || [])
        .catch((err) => {
          console.warn("[meta-leadgen] me/accounts failed", err);
          return [];
        }),
    );

    const businesses = await fetchMeta("me/businesses?fields=id,name&limit=100", token)
      .then((d) => d?.data || [])
      .catch((err) => {
        console.warn("[meta-leadgen] me/businesses failed", err);
        return [];
      });

    for (const biz of businesses) {
      for (const edge of ["owned_pages", "client_pages"]) {
        addPages(
          await fetchMeta(`${biz.id}/${edge}?fields=${pageFields}&limit=200`, token)
            .then((d) => d?.data || [])
            .catch((err) => {
              console.warn(`[meta-leadgen] ${edge} failed`, biz.id, err);
              return [];
            }),
        );
      }
    }

    for (const page of pageMap.values()) {
      // Paginas de BM as vezes nao devolvem access_token direto — tenta resolver,
      // e cai pro token do usuario se nao vier.
      let pageToken = page.access_token;
      if (!pageToken) {
        pageToken = await fetchMeta(`${page.id}?fields=access_token`, token)
          .then((d) => d?.access_token)
          .catch(() => null) || token;
      }
      const formsData = await fetchMeta(
        `${page.id}/leadgen_forms?fields=id,name,status,leads_count,created_time&limit=100`,
        pageToken,
      ).catch((err) => {
        console.warn("[meta-leadgen] list forms failed", page.id, err);
        return { data: [] };
      });
      pages.push({
        ad_account_id: account.id,
        ad_account_name: account.account_name || account.account_id,
        page_id: page.id,
        page_name: page.name,
        page_picture: page.picture?.data?.url || null,
        forms: formsData?.data || [],
      });
    }
  }
  return pages;
}

async function saveConfig(userId: string, body: any) {
  const supabase = adminClient();
  const account = await getAccountForUser(supabase, userId, body.ad_account_id);
  const payload = {
    user_id: userId,
    ad_account_id: account.id,
    page_id: String(body.page_id || ""),
    page_name: body.page_name || null,
    form_id: String(body.form_id || ""),
    form_name: body.form_name || "Formulario Meta",
    agent_id: body.agent_id || null,
    instance_id: body.instance_id || null,
    is_active: body.is_active !== false,
    auto_contact_enabled: body.auto_contact_enabled === true,
    initial_message_template: body.initial_message_template || DEFAULT_TEMPLATE,
    processing_mode: body.processing_mode || "pedro_qualifica",
    raw_form: body.raw_form || null,
    last_sync_at: new Date().toISOString(),
  };
  if (!payload.page_id || !payload.form_id) throw new Error("Pagina e formulario sao obrigatorios.");

  const { data, error } = await supabase
    .from("meta_lead_form_configs")
    .upsert(payload, { onConflict: "user_id,form_id" })
    .select("*")
    .single();
  if (error) throw error;

  const subscription = await subscribePageLeadgen(account.access_token_encrypted, payload.page_id);
  return { config: data, subscription };
}

async function fetchLeadDetail(config: LeadConfig, adAccountToken: string, leadgenId: string) {
  const pageToken = await resolvePageToken(adAccountToken, config.page_id);
  const fields = "id,created_time,field_data,ad_id,form_id,is_organic,platform";
  const endpoints = [
    { token: pageToken, endpoint: `${leadgenId}?fields=${fields}` },
    { token: adAccountToken, endpoint: `${leadgenId}?fields=${fields}` },
  ];

  let lastError: unknown = null;
  for (const item of endpoints) {
    try {
      return await fetchMeta(item.endpoint, item.token);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Falha ao buscar lead na Meta.");
}

async function fetchAdContext(adAccountToken: string, adId?: string | null) {
  if (!adId) return {};
  try {
    const ad = await fetchMeta(
      `${adId}?fields=id,name,adset{id,name,campaign{id,name}}`,
      adAccountToken,
    );
    return {
      ad_id: ad?.id || adId,
      ad_name: ad?.name || null,
      adset_id: ad?.adset?.id || null,
      adset_name: ad?.adset?.name || null,
      campaign_id: ad?.adset?.campaign?.id || null,
      campaign_name: ad?.adset?.campaign?.name || null,
    };
  } catch (error) {
    console.warn("[meta-leadgen] ad context failed", adId, error);
    return { ad_id: adId };
  }
}

async function upsertCrmLead(supabase: any, config: LeadConfig, input: {
  remoteJid: string;
  name: string;
  phone: string;
  email: string;
  interest: string;
  leadgenId: string;
  createdTime: string | null;
  fieldMap: Record<string, string>;
  adContext: Record<string, any>;
  rawPayload: Record<string, any>;
}) {
  const baseUpdate = {
    user_id: config.user_id,
    agent_id: config.agent_id,
    instance_id: config.instance_id,
    lead_name: input.name || input.phone,
    remote_jid: input.remoteJid,
    origem: "trafico_pago",
    meta_lead_id: input.leadgenId,
    campaign_id: input.adContext.campaign_id || null,
    campaign_name: input.adContext.campaign_name || null,
    adset_id: input.adContext.adset_id || null,
    adset_name: input.adContext.adset_name || null,
    ad_id: input.adContext.ad_id || null,
    ad_name: input.adContext.ad_name || null,
    entry_channel: "meta_lead_form",
    entry_datetime: input.createdTime || new Date().toISOString(),
    paid_origin_payload: {
      source: "meta_lead_form",
      page_id: config.page_id,
      page_name: config.page_name,
      form_id: config.form_id,
      form_name: config.form_name,
      leadgen_id: input.leadgenId,
      email: input.email || null,
      interest: input.interest || null,
      field_data: input.fieldMap,
      ad_context: input.adContext,
      raw: input.rawPayload,
    },
    updated_at: new Date().toISOString(),
  };

  let existingQuery = supabase
    .from("ai_crm_leads")
    .select("id, status, status_crm, assigned_to_id")
    .eq("user_id", config.user_id)
    .eq("remote_jid", input.remoteJid);

  existingQuery = config.agent_id
    ? existingQuery.eq("agent_id", config.agent_id)
    : existingQuery.is("agent_id", null);

  const { data: existing } = await existingQuery
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing?.id) {
    const { data, error } = await supabase
      .from("ai_crm_leads")
      .update(baseUpdate)
      .eq("id", existing.id)
      .select("id")
      .single();
    if (error) throw error;
    return data.id as string;
  }

  const insertPayload = {
    ...baseUpdate,
    status: "novo",
    status_crm: "novo",
    ai_paused: false,
    last_interaction_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
  };
  const { data, error } = await supabase
    .from("ai_crm_leads")
    .insert(insertPayload)
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}

async function seedPedroMemory(supabase: any, config: LeadConfig, leadId: string, input: {
  name: string;
  phone: string;
  email: string;
  interest: string;
  leadgenId: string;
  fieldMap: Record<string, string>;
  adContext: Record<string, any>;
}) {
  if (!config.agent_id) return;
  const { data: existing } = await supabase
    .from("pedro_conversation_state")
    .select("state")
    .eq("lead_id", leadId)
    .eq("agent_id", config.agent_id)
    .maybeSingle();

  const nextState = {
    ...(existing?.state || {}),
    lead: {
      ...((existing?.state as any)?.lead || {}),
      nome: input.name || undefined,
      telefone: input.phone,
      email: input.email || undefined,
    },
    interesse: {
      ...((existing?.state as any)?.interesse || {}),
      modelo_desejado: input.interest || ((existing?.state as any)?.interesse?.modelo_desejado),
    },
    referencia: {
      ...((existing?.state as any)?.referencia || {}),
      origem_anuncio: "meta_lead_form",
      form_id: config.form_id,
      form_name: config.form_name,
      leadgen_id: input.leadgenId,
      ...input.adContext,
    },
    atendimento: {
      ...((existing?.state as any)?.atendimento || {}),
      etapa: "lead_form_recebido",
      ultimo_proximo_passo: "primeiro_contato_whatsapp",
    },
    formulario_meta: input.fieldMap,
  };

  await supabase
    .from("pedro_conversation_state")
    .upsert({
      lead_id: leadId,
      agent_id: config.agent_id,
      user_id: config.user_id,
      state: nextState,
      updated_at: new Date().toISOString(),
    }, { onConflict: "lead_id,agent_id" });
}

async function processLead(config: LeadConfig, leadgenId: string, webhookPayload: Record<string, any> = {}) {
  const supabase = adminClient();
  const account = await getAccountForUser(supabase, config.user_id, config.ad_account_id);
  const leadDetail = await fetchLeadDetail(config, account.access_token_encrypted, leadgenId);
  const { map: fieldMap, fullName, phone, email, interest } = normalizeFieldData(leadDetail.field_data);
  if (!phone) throw new Error("Lead da Meta sem telefone. Nao foi possivel criar contato WhatsApp.");

  const remoteJid = `${phone}@s.whatsapp.net`;
  const adContext = await fetchAdContext(account.access_token_encrypted, leadDetail.ad_id || webhookPayload.ad_id);
  const createdTime = leadDetail.created_time || null;
  const rawPayload = { webhook: webhookPayload, lead: leadDetail };

  const leadId = await upsertCrmLead(supabase, config, {
    remoteJid,
    name: fullName,
    phone,
    email,
    interest,
    leadgenId,
    createdTime,
    fieldMap,
    adContext,
    rawPayload,
  });

  await seedPedroMemory(supabase, config, leadId, {
    name: fullName,
    phone,
    email,
    interest,
    leadgenId,
    fieldMap,
    adContext,
  });

  await supabase.from("wa_chat_history").insert({
    user_id: config.user_id,
    agent_id: config.agent_id,
    instance_id: config.instance_id || "meta-lead-form",
    remote_jid: remoteJid,
    role: "system",
    content: `Lead recebido pelo formulario Meta "${config.form_name}".`,
    metadata: { source: "meta_lead_form", leadgen_id: leadgenId, field_data: fieldMap, ad_context: adContext },
  });

  const leadRecord = {
    user_id: config.user_id,
    config_id: config.id,
    ad_account_id: account.id,
    ai_crm_lead_id: leadId,
    page_id: config.page_id,
    page_name: config.page_name,
    form_id: config.form_id,
    form_name: config.form_name,
    leadgen_id: leadgenId,
    lead_name: fullName || null,
    phone,
    email: email || null,
    field_data: fieldMap,
    campaign_id: adContext.campaign_id || null,
    campaign_name: adContext.campaign_name || null,
    adset_id: adContext.adset_id || null,
    adset_name: adContext.adset_name || null,
    ad_id: adContext.ad_id || null,
    ad_name: adContext.ad_name || null,
    status: "crm_created",
    raw_payload: rawPayload,
    created_time_meta: createdTime,
    updated_at: new Date().toISOString(),
  };

  await supabase
    .from("meta_form_leads")
    .upsert(leadRecord, { onConflict: "leadgen_id" });

  let contactResult: any = null;
  if (config.auto_contact_enabled && config.instance_id) {
    const { data: instance } = await supabase
      .from("wa_instances")
      .select("*")
      .eq("id", config.instance_id)
      .maybeSingle();
    if (!instance) throw new Error("Instancia WhatsApp configurada nao encontrada.");
    const message = renderTemplate(config.initial_message_template, {
      nome: fullName || "tudo bem",
      empresa: config.page_name || "nossa loja",
      interesse: interest || config.form_name || "seu cadastro",
      formulario: config.form_name || "",
      campanha: adContext.campaign_name || "",
      anuncio: adContext.ad_name || "",
    });
    contactResult = await sendPedroText(instance, { to: phone, text: message }, { humanize: true });
    if (!contactResult?.ok) {
      throw new Error(contactResult?.error || "Falha ao enviar primeiro contato pelo WhatsApp.");
    }
    await supabase.from("wa_chat_history").insert({
      user_id: config.user_id,
      agent_id: config.agent_id,
      instance_id: config.instance_id || "meta-lead-form",
      remote_jid: remoteJid,
      role: "assistant",
      content: message,
      metadata: { source: "meta_lead_form_auto_contact", leadgen_id: leadgenId, send_result: contactResult },
    });
    await supabase
      .from("meta_form_leads")
      .update({
        status: "contacted",
        first_contact_sent_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("leadgen_id", leadgenId);
  }

  return { lead_id: leadId, status: contactResult ? "contacted" : "crm_created", contact_result: contactResult };
}

async function processWebhookEvent(value: any) {
  const supabase = adminClient();
  const leadgenId = String(value?.leadgen_id || value?.leadgen_id_str || "");
  const pageId = String(value?.page_id || "");
  const formId = String(value?.form_id || "");
  if (!leadgenId || !formId) return { skipped: true, reason: "payload_incompleto" };

  const { data: config } = await supabase
    .from("meta_lead_form_configs")
    .select("*")
    .eq("form_id", formId)
    .eq("page_id", pageId)
    .eq("is_active", true)
    .maybeSingle();

  await supabase.from("meta_leadgen_events").upsert({
    user_id: config?.user_id || null,
    config_id: config?.id || null,
    page_id: pageId,
    form_id: formId,
    leadgen_id: leadgenId,
    ad_id: value?.ad_id || null,
    raw_payload: value,
    processed_at: config ? new Date().toISOString() : null,
  }, { onConflict: "leadgen_id" });

  if (!config) return { skipped: true, reason: "config_nao_encontrada", leadgen_id: leadgenId };
  try {
    const result = await processLead(config as LeadConfig, leadgenId, value);
    return { leadgen_id: leadgenId, ...result };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await supabase.from("meta_leadgen_events").update({ error_message: message }).eq("leadgen_id", leadgenId);
    await supabase.from("meta_form_leads").upsert({
      user_id: config.user_id,
      config_id: config.id,
      page_id: pageId,
      page_name: config.page_name,
      form_id: formId,
      form_name: config.form_name,
      leadgen_id: leadgenId,
      status: "failed",
      last_error: message,
      raw_payload: value,
      updated_at: new Date().toISOString(),
    }, { onConflict: "leadgen_id" });
    throw error;
  }
}

async function syncConfigLeads(userId: string, configId: string, limit = 25) {
  const supabase = adminClient();
  const { data: config, error } = await supabase
    .from("meta_lead_form_configs")
    .select("*")
    .eq("id", configId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !config) throw new Error("Formulario nao encontrado para esta conta.");

  const account = await getAccountForUser(supabase, userId, config.ad_account_id);
  const pageToken = await resolvePageToken(account.access_token_encrypted, config.page_id);
  const data = await fetchMeta(
    `${config.form_id}/leads?fields=id,created_time,field_data,ad_id&limit=${Math.max(1, Math.min(100, Number(limit) || 25))}`,
    pageToken,
  );

  const results = [];
  for (const lead of data?.data || []) {
    try {
      results.push(await processLead(config as LeadConfig, String(lead.id), { sync: true, ad_id: lead.ad_id }));
    } catch (error) {
      results.push({ leadgen_id: lead.id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  await supabase.from("meta_lead_form_configs").update({ last_sync_at: new Date().toISOString() }).eq("id", configId);
  return { processed: results.length, results };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const url = new URL(req.url);
  if (req.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    const expected = Deno.env.get("META_LEADGEN_VERIFY_TOKEN") || Deno.env.get("META_WEBHOOK_VERIFY_TOKEN");
    if (mode === "subscribe" && token && token === expected) return new Response(challenge || "", { status: 200 });
    return new Response("Forbidden", { status: 403 });
  }

  try {
    const authUserId = await getAuthenticatedUser(req);
    const rawBody = await req.text();
    const body = rawBody ? JSON.parse(rawBody) : {};

    if (authUserId && body?.action) {
      if (body.action === "list_forms") return jsonResponse({ pages: await listForms(authUserId) });
      if (body.action === "save_config") return jsonResponse(await saveConfig(authUserId, body));
      if (body.action === "sync_form") return jsonResponse(await syncConfigLeads(authUserId, body.config_id, body.limit));
      return jsonResponse({ error: "Acao desconhecida." }, 400);
    }

    const signature = req.headers.get("x-hub-signature-256");
    const validSignature = await verifyMetaSignature(rawBody, signature);
    if (!validSignature) return jsonResponse({ error: "Invalid signature" }, 401);

    const changes: any[] = [];
    for (const entry of body?.entry || []) {
      for (const change of entry?.changes || []) {
        if (change?.field === "leadgen" && change?.value) changes.push(change.value);
      }
    }

    const runner = Promise.allSettled(changes.map(processWebhookEvent));
    const edgeRuntime = (globalThis as any).EdgeRuntime;
    if (edgeRuntime?.waitUntil) edgeRuntime.waitUntil(runner);
    else await runner;

    return jsonResponse({ received: true, count: changes.length });
  } catch (error) {
    console.error("[meta-leadgen] erro", error);
    return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
