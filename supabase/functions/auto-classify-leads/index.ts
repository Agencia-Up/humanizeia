// ============================================================================
// auto-classify-leads
// ----------------------------------------------------------------------------
// Re-classifica leads de uma conta master nos 3 níveis SDR:
//
//   1. INATIVO (inativo) — lead que NÃO respondeu até a IA transferi-lo
//      automaticamente por inatividade (após 10 min sem resposta — flag
//      usada pela cron-lead-followup quando cria registro em
//      ai_lead_transfers com transfer_reason ILIKE '%inatividade%').
//
//   2. POUCO QUALIFICADO (pouco_qualificado) — cliente conversou e deu
//      algumas informações, mas não completou os dados essenciais (nome,
//      interesse) OU encontrou objeção no meio do caminho.
//
//   3. QUALIFICADO (qualificado) — cliente respondeu corretamente, passou
//      todas as informações essenciais e tem ≥60% dos campos preenchidos.
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
import { logTransferFailure, type TransferFailureReason } from '../_shared/pedro-v2/logTransferFailure.ts';
import { classifyLeadSdr } from '../_shared/transfer/leadSdrCategory.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

// Configuração da classificação
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
  status: string | null;
  status_crm: string | null;
  assigned_to_id: string | null;
  remote_jid: string | null;
  client_name: string | null;
  vehicle_interest: string | null;
  payment_method: string | null;
  budget: string | null;
  client_city: string | null;
  visit_scheduled: string | null;
  trade_in_vehicle: string | null;
  down_payment: string | null;
  cpf: string | null;
  last_user_reply_at: string | null;
  last_interaction_at: string | null;
  created_at: string;
  summary: string | null;
}

function classify(lead: Lead, isInactiveTransfer: boolean): string {
  // FONTE UNICA da regra das 3 categorias (compartilhada com o orquestrador e o cron de
  // 12min via _shared/transfer/leadSdrCategory.ts). Garante que o status_crm que o agente
  // grava na transferencia NAO seja rebaixado aqui de hora em hora (antes, um lead
  // qualificado com poucos campos virava 'pouco_qualificado' no proximo ciclo).
  //   - INATIVO: transferido por inatividade SEM dado profundo (so anuncio/nome).
  //   - POUCO QUALIFICADO: deu CPF/troca/financiamento/entrada/cidade/agendamento e nao fechou.
  //   - QUALIFICADO: nome + interesse + dados suficientes.
  // Preserva estados movidos pelo vendedor (PROTECTED) e 'novo' (for_briefing=false).
  return String(classifyLeadSdr(lead, { by_inactivity: isInactiveTransfer }));
}

// Detecta chamada de SISTEMA (cron): o bearer e um JWT com role=service_role.
// auto-classify-leads roda com verify_jwt=true (default — nao esta no
// config.toml), entao a PLATAFORMA ja validou a assinatura do JWT antes do
// nosso codigo rodar. Confiar no claim 'role' decodificado e seguro: um token
// forjado com role=service_role seria barrado pela plataforma (assinatura
// invalida) antes de chegar aqui. So comparar com SUPABASE_SERVICE_ROLE_KEY
// nao bastava — a chave que a cron pega do vault e um JWT service_role VALIDO,
// porem string diferente da env injetada (geradas em momentos distintos).
function isServiceRoleJwt(token: string): boolean {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return false;
    let p = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const pad = p.length % 4;
    if (pad) p += '='.repeat(4 - pad);
    const payload = JSON.parse(atob(p));
    return payload?.role === 'service_role';
  } catch {
    return false;
  }
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

    const body = await req.json().catch(() => ({}));
    const dryRun = body?.dry_run === true;

    // Dois tipos de chamador:
    //  1) SISTEMA (cron 'auto-classify-leads-hourly'): manda um JWT service_role
    //     como bearer. Nao existe usuario logado, entao master_user_id no body e
    //     OBRIGATORIO (a cron sempre envia). Sem este ramo, getUser() recusa a
    //     service role e devolve 401 'Token invalido' — era exatamente o motivo
    //     do cron horario NUNCA classificar nem logar (todas as rodadas 401).
    //  2) USUARIO (botao "Reclassificar IA"): manda o JWT do master/vendedor.
    //     Resolvemos o master pelo time (resolveMasterId) ou pelo body.
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const isSystemCaller = token === serviceRoleKey || isServiceRoleJwt(token);
    let masterId: string;

    if (isSystemCaller) {
      if (!body?.master_user_id) {
        return new Response(JSON.stringify({ error: 'master_user_id obrigatório para chamada de sistema' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      masterId = body.master_user_id;
    } else {
      const { data: { user } } = await supabaseAnon.auth.getUser(token);
      if (!user) {
        return new Response(JSON.stringify({ error: 'Token inválido' }), {
          status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      masterId = body?.master_user_id || await resolveMasterId(supabaseService, user.id);
    }

    // 1. Carrega leads da conta
    const { data: leads, error } = await supabaseService
      .from('ai_crm_leads')
      .select('id, status, status_crm, assigned_to_id, remote_jid, client_name, vehicle_interest, payment_method, budget, client_city, visit_scheduled, trade_in_vehicle, down_payment, cpf, last_user_reply_at, last_interaction_at, created_at, summary')
      .eq('user_id', masterId);
    if (error) throw new Error(error.message);

    // 2. Carrega lead_ids transferidos POR INATIVIDADE (10min sem resposta)
    //    — esses viram automaticamente "Lead Inativo" no kanban
    const { data: inactiveTransfers } = await supabaseService
      .from('ai_lead_transfers')
      .select('lead_id')
      .eq('user_id', masterId)
      .ilike('transfer_reason', '%inativ%');
    const inactiveLeadIds = new Set<string>(
      (inactiveTransfers || []).map((t: any) => t.lead_id).filter(Boolean)
    );

    const changes: Array<{ id: string; from: string; to: string }> = [];
    const updates: Record<string, { newStatus: string; ids: string[] }> = {};
    // Diagnostico: leads que, ao serem (re)classificados, ficam "nao prontos
    // para transferir" e SEM vendedor. Alimenta o painel de Diagnostico.
    const failuresToLog: Array<{ lead: Lead; reason: TransferFailureReason }> = [];
    const DIAG_REASON: Record<string, TransferFailureReason> = {
      inativo: 'lead_inativo',
      pouco_qualificado: 'lead_nao_qualificado',
    };

    for (const lead of (leads || []) as Lead[]) {
      const isInactiveTransfer = inactiveLeadIds.has(lead.id);
      const newStatus = classify(lead, isInactiveTransfer);
      if (newStatus !== lead.status_crm) {
        changes.push({ id: lead.id, from: lead.status_crm || '(null)', to: newStatus });
        if (!updates[newStatus]) updates[newStatus] = { newStatus, ids: [] };
        updates[newStatus].ids.push(lead.id);
      }

      // Diagnostico: registra o motivo de TODO lead que esta ATUALMENTE
      // inativo/pouco_qualificado E sem vendedor E nao transferido — mesmo que
      // o status NAO tenha mudado nesta rodada. O backlog ja classificado pela
      // cron horaria nao muda de status, mas precisa aparecer no painel com o
      // motivo preenchido. Sem isto, so leads que TRANSICIONAM agora apareciam
      // (e o backlog ficava com a coluna "Motivo" em branco). A RPC
      // pedro_log_transfer_failure deduplica por (user, lead, motivo): em
      // re-execucoes apenas incrementa attempt_count, nunca duplica linha.
      const reason = DIAG_REASON[newStatus];
      if (reason && !lead.assigned_to_id && lead.status !== 'transferido') {
        failuresToLog.push({ lead, reason });
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

      // Diagnostico (best-effort, nunca derruba a classificacao): registra o
      // motivo de cada lead que ficou sem transferencia. Em paralelo; o helper
      // ja engole qualquer erro internamente.
      if (failuresToLog.length > 0) {
        await Promise.all(failuresToLog.map(({ lead, reason }) =>
          logTransferFailure({
            user_id: masterId,
            reason_code: reason,
            mode: 'pedro',
            lead_id: lead.id,
            lead_name: lead.client_name,
            remote_jid: lead.remote_jid,
            lead_status: lead.status,
            lead_status_crm: reason === 'lead_inativo' ? 'inativo' : 'pouco_qualificado',
            attempted_transfer: false,
            source: 'auto-classify-leads',
            reason_detail: reason === 'lead_inativo'
              ? 'Lead transferido por inatividade (sem resposta) — nao engajou.'
              : 'Lead nao completou os dados essenciais para qualificar.',
          })
        ));
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
