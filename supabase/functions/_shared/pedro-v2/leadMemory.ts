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
