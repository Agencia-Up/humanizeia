// ============================================================================
// auto-classify-leads
// ----------------------------------------------------------------------------
// Re-classifica leads de uma conta master nos 3 níveis SDR:
//   1. INATIVO (lead_inativo) — sem resposta há > N dias OU nunca respondeu
//   2. POUCO QUALIFICADO (pouco_qualificado) — conversou, deu algumas infos,
//      mas não completou os dados essenciais
//   3. QUALIFICADO (qualificado) — passou todas informações essenciais
//
// NÃO sobrescreve estados manuais finais: 'fechado', 'em_atendimento',
// 'negociacao', 'agendamento', 'perdido', 'transferido' (master/seller
// movem manualmente esses).
//
// Body: { master_user_id?: string, dry_run?: boolean }
//   - se master_user_id ausente: classifica apenas leads do JWT do user
//   - dry_run: retorna preview sem aplicar UPDATE
//
// Auth: JWT do master ou vendedor (resolve master_id automaticamente).
// ============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

// Configuração da classificação
const INACTIVE_DAYS = 3;             // > N dias sem resposta = inativo
const NEW_NO_REPLY_DAYS = 7;         // 'novo' + sem qualquer interação há N dias = inativo
const COMPLETION_THRESHOLD = 0.6;    // % de campos preenchidos pra 'qualificado'

// Campos essenciais e de completude
const REQUIRED_FIELDS = ['client_name', 'vehicle_interest'] as const;
const COMPLETION_FIELDS = [
  'client_name', 'vehicle_interest', 'payment_method',
  'budget', 'client_city', 'visit_scheduled',
] as const;

// Status que NÃO sobrescrevemos (decisões manuais ou estágios finais)
const PROTECTED_STATUSES = new Set([
  'fechado', 'em_atendimento', 'negociacao',
  'agendamento', 'perdido', 'transferido',
]);

interface Lead {
  id: string;
  status_crm: string | null;
  client_name: string | null;
  vehicle_interest: string | null;
  payment_method: string | null;
  budget: string | null;
  client_city: string | null;
  visit_scheduled: string | null;
  last_user_reply_at: string | null;
  last_interaction_at: string | null;
  created_at: string;
  summary: string | null;
}

function classify(lead: Lead, now: number): string {
  // Status protegido — preserva
  if (lead.status_crm && PROTECTED_STATUSES.has(lead.status_crm)) {
    return lead.status_crm;
  }

  // Conta campos preenchidos
  const filledFields = COMPLETION_FIELDS.filter(f => {
    const v = (lead as any)[f];
    return v !== null && v !== undefined && String(v).trim() !== '';
  });
  const completion = filledFields.length / COMPLETION_FIELDS.length;
  const hasAllRequired = REQUIRED_FIELDS.every(f => {
    const v = (lead as any)[f];
    return v !== null && v !== undefined && String(v).trim() !== '';
  });

  // Tempo desde última resposta do CLIENTE
  const lastReplyMs = lead.last_user_reply_at
    ? new Date(lead.last_user_reply_at).getTime()
    : null;
  const daysSinceReply = lastReplyMs
    ? (now - lastReplyMs) / 86_400_000
    : Infinity;

  // Tempo desde criação
  const createdMs = new Date(lead.created_at).getTime();
  const daysSinceCreation = (now - createdMs) / 86_400_000;

  // ── 1. INATIVO ────────────────────────────────────────────────────────
  // a) sem resposta há > INACTIVE_DAYS E não completo
  // b) status 'novo' há > NEW_NO_REPLY_DAYS sem qualquer reply
  if (
    (daysSinceReply > INACTIVE_DAYS && !hasAllRequired)
    || (lead.status_crm === 'novo' && daysSinceCreation > NEW_NO_REPLY_DAYS && !lastReplyMs)
  ) {
    return 'inativo';
  }

  // ── 2. QUALIFICADO ────────────────────────────────────────────────────
  // tem todos os essenciais E >= 60% dos completion fields
  if (hasAllRequired && completion >= COMPLETION_THRESHOLD) {
    return 'qualificado';
  }

  // ── 3. POUCO QUALIFICADO ──────────────────────────────────────────────
  // tem ALGUMA info coletada (cliente conversou) ou status já era pouco/medio
  if (filledFields.length > 0 || ['pouco_qualificado', 'medio_qualificado', 'interessado'].includes(lead.status_crm || '')) {
    return 'pouco_qualificado';
  }

  // Sem dados, sem indicação clara — preserva
  return lead.status_crm || 'novo';
}

async function resolveMasterId(supabaseService: any, authUserId: string): Promise<string> {
  const { data } = await supabaseService
    .from('ai_team_members')
    .select('user_id')
    .eq('auth_user_id', authUserId)
    .limit(1);
  if (data && data.length > 0) return data[0].user_id;
  return authUserId;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const supabaseService = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const supabaseAnon = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
    );

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Não autorizado' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const token = authHeader.replace('Bearer ', '');
    const { data: { user } } = await supabaseAnon.auth.getUser(token);
    if (!user) {
      return new Response(JSON.stringify({ error: 'Token inválido' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json().catch(() => ({}));
    const masterId = body?.master_user_id || await resolveMasterId(supabaseService, user.id);
    const dryRun = body?.dry_run === true;

    // Carrega leads da conta
    const { data: leads, error } = await supabaseService
      .from('ai_crm_leads')
      .select('id, status_crm, client_name, vehicle_interest, payment_method, budget, client_city, visit_scheduled, last_user_reply_at, last_interaction_at, created_at, summary')
      .eq('user_id', masterId);
    if (error) throw new Error(error.message);

    const now = Date.now();
    const changes: Array<{ id: string; from: string; to: string }> = [];
    const updates: Record<string, { newStatus: string; ids: string[] }> = {};

    for (const lead of (leads || []) as Lead[]) {
      const newStatus = classify(lead, now);
      if (newStatus !== lead.status_crm) {
        changes.push({ id: lead.id, from: lead.status_crm || '(null)', to: newStatus });
        if (!updates[newStatus]) updates[newStatus] = { newStatus, ids: [] };
        updates[newStatus].ids.push(lead.id);
      }
    }

    // Aplica updates em lotes por status (UPDATE em IN é mais eficiente)
    if (!dryRun) {
      for (const { newStatus, ids } of Object.values(updates)) {
        if (ids.length === 0) continue;
        const { error: updErr } = await supabaseService
          .from('ai_crm_leads')
          .update({ status_crm: newStatus })
          .in('id', ids);
        if (updErr) throw new Error(`Erro ao atualizar ${newStatus}: ${updErr.message}`);
      }
    }

    // Resumo por novo status
    const summaryByStatus: Record<string, number> = {};
    for (const c of changes) {
      summaryByStatus[c.to] = (summaryByStatus[c.to] || 0) + 1;
    }

    return new Response(JSON.stringify({
      success: true,
      dryRun,
      total_leads: leads?.length || 0,
      total_changes: changes.length,
      summary_by_new_status: summaryByStatus,
      sample_changes: changes.slice(0, 20),
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
