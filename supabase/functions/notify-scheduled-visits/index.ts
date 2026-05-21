// =============================================================================
// notify-scheduled-visits — Fase 6 (alerta de visita agendada hoje via WhatsApp)
// =============================================================================
//
// Roda diariamente (cron externo OU pg_cron). Pega leads com visit_scheduled
// que se parseia como HOJE e ainda não foram notificados (visit_notified_at IS
// NULL). Manda mensagem WhatsApp pro vendedor responsável usando UazAPI da
// instância do master. Marca visit_notified_at pra não duplicar.
//
// Aceita chamada sem auth (vai ser chamada via cron público com secret).
// Pode ser invocada manualmente via POST com body {} pra teste.
// =============================================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface LeadRow {
  id: string;
  lead_name: string | null;
  remote_jid: string;
  visit_scheduled: string | null;
  vehicle_interest: string | null;
  assigned_to_id: string | null;
  user_id: string;
  client_city: string | null;
}

interface MemberRow {
  id: string;
  name: string;
  whatsapp_number: string | null;
}

interface InstanceRow {
  id: string;
  api_url: string | null;
  api_key_encrypted: string | null;
}

/** Tenta extrair Date do visit_scheduled (texto livre). Retorna null se não conseguir. */
function tryParseScheduledDate(input: string | null): Date | null {
  if (!input) return null;
  const t = input.trim();
  // ISO direto: 2026-05-21 ou 2026-05-21T10:00
  let m = t.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(`${m[1]}-${m[2]}-${m[3]}T12:00:00`);
  // BR: 21/05 ou 21/05/2026
  m = t.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/);
  if (m) {
    const day = m[1].padStart(2, '0');
    const month = m[2].padStart(2, '0');
    let year = m[3] || String(new Date().getFullYear());
    if (year.length === 2) year = '20' + year;
    return new Date(`${year}-${month}-${day}T12:00:00`);
  }
  return null;
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

function normalizePhone(raw: string | null | undefined): string {
  const digits = (raw || '').replace(/\D/g, '');
  if (digits.length === 10 || digits.length === 11) return '55' + digits;
  return digits;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } }
  );

  const today = new Date();
  const result = {
    checked: 0,
    notified: 0,
    skipped_no_today: 0,
    skipped_no_member: 0,
    skipped_no_phone: 0,
    skipped_no_instance: 0,
    errors: [] as string[],
  };

  try {
    // 1) Lê leads pendentes de notificação
    const { data: leads, error: leadsErr } = await supabase
      .from('ai_crm_leads')
      .select('id, lead_name, remote_jid, visit_scheduled, vehicle_interest, assigned_to_id, user_id, client_city')
      .not('visit_scheduled', 'is', null)
      .is('visit_notified_at', null)
      .limit(500);
    if (leadsErr) throw leadsErr;
    result.checked = (leads || []).length;

    for (const lead of (leads || []) as LeadRow[]) {
      const parsed = tryParseScheduledDate(lead.visit_scheduled);
      if (!parsed || !isSameDay(parsed, today)) {
        result.skipped_no_today++;
        continue;
      }
      if (!lead.assigned_to_id) {
        result.skipped_no_member++;
        continue;
      }

      // 2) Resolve vendedor
      const { data: member } = await supabase
        .from('ai_team_members')
        .select('id, name, whatsapp_number')
        .eq('id', lead.assigned_to_id)
        .maybeSingle();
      if (!member) {
        result.skipped_no_member++;
        continue;
      }
      const sellerPhone = normalizePhone((member as MemberRow).whatsapp_number);
      if (!sellerPhone) {
        result.skipped_no_phone++;
        continue;
      }

      // 3) Pega instância WhatsApp ativa do master (qualquer 1)
      const { data: instance } = await supabase
        .from('wa_instances')
        .select('id, api_url, api_key_encrypted')
        .eq('user_id', lead.user_id)
        .eq('is_active', true)
        .limit(1)
        .maybeSingle();
      if (!instance || !(instance as InstanceRow).api_url || !(instance as InstanceRow).api_key_encrypted) {
        result.skipped_no_instance++;
        continue;
      }
      const inst = instance as InstanceRow;
      const baseUrl = (inst.api_url as string).replace(/\/+$/, '');
      const token = inst.api_key_encrypted as string;

      // 4) Monta mensagem
      const lines = [
        '🔔 *Lembrete: visita hoje*',
        '',
        `👤 Cliente: ${lead.lead_name || '(sem nome)'}`,
        lead.client_city ? `📍 Cidade: ${lead.client_city}` : '',
        lead.vehicle_interest ? `🚗 Interesse: ${lead.vehicle_interest}` : '',
        `📅 Visita: ${lead.visit_scheduled}`,
        '',
        `📱 Cliente: https://wa.me/${normalizePhone(lead.remote_jid?.replace(/@.*/, ''))}`,
      ].filter(Boolean).join('\n');

      // 5) Envia via UazAPI
      try {
        const res = await fetch(`${baseUrl}/send/text`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', token },
          body: JSON.stringify({ number: sellerPhone, text: lines }),
        });
        if (!res.ok) {
          const errText = await res.text();
          result.errors.push(`Lead ${lead.id}: HTTP ${res.status} ${errText.slice(0, 120)}`);
          continue;
        }
      } catch (sendErr: any) {
        result.errors.push(`Lead ${lead.id}: ${sendErr.message}`);
        continue;
      }

      // 6) Marca como notificado
      await supabase
        .from('ai_crm_leads')
        .update({ visit_notified_at: new Date().toISOString() })
        .eq('id', lead.id);

      result.notified++;
    }

    return new Response(JSON.stringify({ success: true, ...result }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ success: false, error: err.message, ...result }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
