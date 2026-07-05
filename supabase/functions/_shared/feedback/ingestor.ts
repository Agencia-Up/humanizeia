// deno-lint-ignore-file no-explicit-any
// ============================================================================
// Cérebro de Feedback — FASE 1: Ingestão (montagem do thread do lead)
// ----------------------------------------------------------------------------
// Dado um lead, monta o THREAD UNIFICADO cronológico:
//   - conversa do Pedro (IA/qualificação) -> wa_chat_history (por remote_jid)
//   - conversa do vendedor (CRM/Marcos)   -> wa_inbox (por telefone, últimos 8)
//   - sinais estruturados que o lead já traz (troca, entrada, cpf, idade...)
//   - metadados (vendedor, campanha/anúncio) p/ o cérebro (Fase 2).
// Read-only. Sem análise, sem custo. Tolera lead sem conversa de vendedor.
// ============================================================================

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

export type Papel = 'cliente' | 'vendedor' | 'ia';

export interface ThreadMessage {
  from: Papel;
  texto: string;
  timestamp: string;
  canal: 'pedro' | 'marcos';
}

export interface LeadThread {
  lead_id: string;
  lead_source: 'pedro' | 'marcos';
  tenant_id: string;
  vendedor_id: string | null;
  campanha_id: string | null;
  ad_name: string | null;
  lead_nome: string | null;
  sinais_estruturados: Record<string, unknown>;
  thread: ThreadMessage[];
}

export function digits(s?: string | null): string {
  return (s || '').replace(/\D/g, '');
}
export function last8(s?: string | null): string {
  return digits(s).slice(-8);
}

export async function buildLeadThread(
  admin: SupabaseClient,
  leadSource: 'pedro' | 'marcos',
  leadId: string,
): Promise<LeadThread | null> {
  const msgs: ThreadMessage[] = [];
  const sinais: Record<string, unknown> = {};
  let tenant = '';
  let vendedor: string | null = null;
  let campanha: string | null = null;
  let adName: string | null = null;
  let nome: string | null = null;
  let jid = '';
  let phone8 = '';

  // ── 1) Carrega o lead + sinais estruturados + metadados ──────────────────
  if (leadSource === 'pedro') {
    const { data: lead } = await admin
      .from('ai_crm_leads')
      .select('user_id, remote_jid, lead_name, assigned_to_id, campaign_id, ad_id, ad_name, trade_in_vehicle, down_payment, cpf, birth_date, temperature, vehicle_interest, payment_method, budget, summary')
      .eq('id', leadId)
      .maybeSingle();
    if (!lead) return null;
    tenant = lead.user_id;
    vendedor = lead.assigned_to_id ?? null;
    nome = lead.lead_name ?? null;
    campanha = lead.ad_id || lead.campaign_id || null;
    adName = lead.ad_name || null;
    jid = lead.remote_jid || '';
    phone8 = last8(jid.split('@')[0]);
    Object.assign(sinais, {
      trade_in_vehicle: lead.trade_in_vehicle,
      down_payment: lead.down_payment,
      cpf: lead.cpf,
      birth_date: lead.birth_date,
      temperature: lead.temperature,
      vehicle_interest: lead.vehicle_interest,
      payment_method: lead.payment_method,
      budget: lead.budget,
      summary_pedro: lead.summary,
    });
  } else {
    const { data: lead } = await admin
      .from('crm_leads')
      .select('user_id, phone, name, assigned_to, utm_campaign, vehicle_interest, consignado_modelo, custom_fields')
      .eq('id', leadId)
      .maybeSingle();
    if (!lead) return null;
    tenant = lead.user_id;
    vendedor = lead.assigned_to ?? null;
    nome = lead.name ?? null;
    campanha = lead.utm_campaign || null;
    phone8 = last8(lead.phone);
    Object.assign(sinais, {
      vehicle_interest: lead.vehicle_interest,
      consignado_modelo: lead.consignado_modelo,
      custom_fields: lead.custom_fields,
    });
  }

  // ── 2) Conversa do Pedro (IA) — wa_chat_history por remote_jid exato ──────
  if (jid) {
    const { data: hist } = await admin
      .from('wa_chat_history')
      .select('role, content, created_at')
      .eq('user_id', tenant)
      .eq('remote_jid', jid)
      .order('created_at', { ascending: true });
    for (const m of (hist || [])) {
      if (!m.content) continue;
      msgs.push({
        from: m.role === 'assistant' ? 'ia' : 'cliente',
        texto: m.content,
        timestamp: m.created_at,
        canal: 'pedro',
      });
    }
  }

  // ── 3) Conversa do vendedor — wa_inbox pelos últimos 8 dígitos do telefone ─
  //     (robusto ao DDI 55 e ao 9º dígito do celular; tolera vazio)
  if (phone8) {
    const { data: inbox } = await admin
      .from('wa_inbox')
      .select('direction, content, created_at')
      .eq('user_id', tenant)
      .ilike('phone', `%${phone8}`)
      .order('created_at', { ascending: true });
    for (const m of (inbox || [])) {
      if (!m.content) continue;
      msgs.push({
        from: m.direction === 'outgoing' ? 'vendedor' : 'cliente',
        texto: m.content,
        timestamp: m.created_at,
        canal: 'marcos',
      });
    }
  }

  // ── 4) Ordena TUDO cronologicamente (Pedro + Marcos num só fio) ──────────
  msgs.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  return {
    lead_id: leadId,
    lead_source: leadSource,
    tenant_id: tenant,
    vendedor_id: vendedor,
    campanha_id: campanha,
    ad_name: adName,
    lead_nome: nome,
    sinais_estruturados: sinais,
    thread: msgs,
  };
}
