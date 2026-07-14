// deno-lint-ignore-file no-explicit-any
// ============================================================================
// delete-responsavel — Remocao DEFINITIVA de um responsavel (vendedor/gerente/
// trafego) da conta, funcionando para Pedro E Marcos. Ponto UNICO chamado pelas
// 3 telas (Configuracoes>Responsaveis, Pedro>Vendedores, Marcos>Equipe).
// Regras (auditoria 10/07 + remocao definitiva 14/07):
//  - So o MASTER da propria conta remove: opera SOMENTE em linhas com
//    user_id = quem chamou. Vendedor e barrado. Master nao remove a si mesmo.
//  - Alvo por member_id | whatsapp | email (>=1). Casa pelo numero NACIONAL
//    COMPLETO (55+DDD+numero), NUNCA pelos ultimos 8 digitos.
//  - NUNCA apaga historico: soft-delete do membro (is_active/active_in_system/
//    show_in_live=false, visible_features={}); leads/conversas/feedbacks ficam.
//  - Bloqueio REAL de login: bane auth.users + mata sessoes SOMENTE se o login
//    nao tiver mais NENHUM vinculo ativo valido (RPC revoke_seller_login, com
//    todas as travas: nao-master, role seller, sem agentes). Master nunca bane.
//  - Pedro: leads ativos entram em job de repasse programado (lead_redistribution_jobs).
//  - Marcos: leads ATIVOS vao para o proximo vendedor ativo em round-robin
//    (RPC redistribute_marcos_leads_on_remove), atualizando assigned_to +
//    custom_fields.seller_member_id/seller_name; sem vendedor ativo => bolsao
//    (assigned_to null) + diagnostico. Leads fechados ficam no historico.
//  - Desvincula wa_instances e profiles.manager_id.
//  - Log de auditoria enriquecido (responsavel_exclusao_log): reason, contagem
//    Pedro/Marcos, redistribuicoes, banimentos, casos sem vendedor.
// verify_jwt=true: chamador precisa de sessao valida; ainda validamos o dono.
// ============================================================================
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const onlyDigits = (v?: string | null) => String(v || '').replace(/\D/g, '');
// Numero nacional canonico: 55 + DDD + numero. Remove DDI 55 duplicado quando ja
// vem junto (nacional 10/11 digitos; com DDI 12/13). NUNCA usa ultimos 8.
function normalizePhoneBR(raw?: string | null): string {
  const d = onlyDigits(raw);
  if (!d) return '';
  const nat = d.startsWith('55') && d.length > 11 ? d.slice(2) : d;
  return nat ? '55' + nat : '';
}

const DONE_STATUS = ['fechado', 'perdido', 'transferido', 'vendido'];

async function countPedroLeads(admin: any, userId: string, memberId: string): Promise<number> {
  const { count } = await admin.from('ai_crm_leads')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('assigned_to_id', memberId)
    .not('status_crm', 'in', `(${DONE_STATUS.join(',')})`);
  return count || 0;
}

async function ensureRedistributionJob(admin: any, userId: string, member: any, createdBy: string): Promise<{ created: boolean; total: number; skipped?: string }> {
  const total = await countPedroLeads(admin, userId, member.id);
  if (total <= 0) return { created: false, total, skipped: 'sem_leads_pedro' };

  const { data: existing } = await admin.from('lead_redistribution_jobs')
    .select('id,status')
    .eq('tenant_id', userId)
    .eq('from_member_id', member.id)
    .in('status', ['ativo', 'pausado'])
    .limit(1);
  if (existing && existing.length > 0) return { created: false, total, skipped: 'job_existente' };

  const { error } = await admin.from('lead_redistribution_jobs').insert({
    tenant_id: userId,
    from_member_id: member.id,
    from_member_name: member.name || null,
    por_vendedor: 5,
    intervalo_min: 15,
    seller_ids: null,
    status: 'ativo',
    total_alvo: total,
    total_repassados: 0,
    ultimo_lote: 0,
    next_run_at: new Date().toISOString(),
    created_by: createdBy,
  });
  if (error && !String(error.message || '').includes('uq_lrj_um_vivo')) throw error;
  return { created: !error, total, skipped: error ? 'job_existente' : undefined };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ success: false, error: 'Method not allowed' }, 405);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const authHeader = req.headers.get('Authorization') || '';
    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: authData, error: authError } = await userClient.auth.getUser();
    if (authError || !authData.user) return json({ success: false, error: 'Unauthorized' }, 401);
    const requesterId = authData.user.id;

    const admin = createClient(supabaseUrl, serviceKey);

    // Vendedor nunca exclui responsavel. (Nao barramos "manager" pelo role porque
    // em algumas contas o master aparece rotulado assim; a garantia dura e o escopo
    // por user_id = requesterId abaixo — quem nao e dono das rows nao remove nada.)
    const { data: profile } = await admin
      .from('profiles').select('role').eq('id', requesterId).maybeSingle();
    if (profile?.role === 'seller') {
      return json({ success: false, error: 'Apenas a conta master pode excluir responsaveis.' }, 403);
    }

    // Entrada flexivel: member_id | whatsapp | email | reason (>=1 identificador).
    const body = await req.json().catch(() => ({}));
    const rawMemberId: string | null = body?.member_id ? String(body.member_id) : null;
    const rawEmail: string = String(body?.email || '').trim().toLowerCase();
    const reason: string | null = (body?.reason ? String(body.reason) : '').slice(0, 300) || null;
    let targetNat = normalizePhoneBR(body?.whatsapp);

    if (!targetNat && !rawMemberId && !rawEmail) {
      return json({ success: false, error: 'Informe whatsapp, member_id ou email do responsavel.' }, 400);
    }

    // Membros da conta (inclui email pra casar por e-mail).
    const { data: allMembers, error: mErr } = await admin
      .from('ai_team_members')
      .select('id, auth_user_id, whatsapp_number, name, is_manager, email')
      .eq('user_id', requesterId);
    if (mErr) throw mErr;

    // Deriva o numero nacional a partir de member_id/email quando o whatsapp nao veio.
    const seedById = rawMemberId ? (allMembers || []).find((m: any) => m.id === rawMemberId) : null;
    if (!targetNat && seedById) targetNat = normalizePhoneBR(seedById.whatsapp_number);
    const seedByEmail = rawEmail ? (allMembers || []).find((m: any) => String(m.email || '').toLowerCase() === rawEmail) : null;
    if (!targetNat && seedByEmail) targetNat = normalizePhoneBR(seedByEmail.whatsapp_number);

    // Agrupa as linhas-matriz da MESMA pessoa (mesmo auth) mesmo sem telefone.
    const seedAuth = new Set<string>();
    if (seedById?.auth_user_id) seedAuth.add(seedById.auth_user_id);
    if (seedByEmail?.auth_user_id) seedAuth.add(seedByEmail.auth_user_id);

    // Alvos: SO da conta do requester. Casa por numero nacional COMPLETO (primario)
    // ou mesmo auth (matriz) ou member_id/email exatos (entradas alternativas).
    const members = (allMembers || []).filter((m: any) =>
      (targetNat && normalizePhoneBR(m.whatsapp_number) === targetNat) ||
      (seedAuth.size > 0 && m.auth_user_id && seedAuth.has(m.auth_user_id)) ||
      (rawMemberId && m.id === rawMemberId) ||
      (rawEmail && String(m.email || '').toLowerCase() === rawEmail)
    );
    const memberIds = members.map((m: any) => m.id).filter(Boolean);
    const authUserIds = Array.from(new Set(members.map((m: any) => m.auth_user_id).filter(Boolean)));

    // Trava: master nao exclui a propria conta/login.
    if (authUserIds.includes(requesterId)) {
      return json({ success: false, error: 'Voce nao pode excluir a propria conta master por aqui.' }, 400);
    }

    // Entregas (Atendimento/Trafego/Alertas) na conta_responsaveis — casa pelo numero.
    const { data: allResp } = await admin
      .from('conta_responsaveis').select('id, whatsapp, nome').eq('user_id', requesterId);
    const respRows = (allResp || []).filter((r: any) => targetNat && normalizePhoneBR(r.whatsapp) === targetNat);
    const responsavelIds = respRows.map((r: any) => r.id).filter(Boolean);
    const alvoNome = members[0]?.name || respRows[0]?.nome || null;

    if (memberIds.length === 0 && responsavelIds.length === 0) {
      return json({ success: false, error: 'Nenhum responsavel encontrado com esse identificador nesta conta.' }, 404);
    }

    // ── Preserva historico. Pedro entra em job de repasse; Marcos redistribui já. ──
    const redistribution: any[] = [];
    let pedroLeadsAfetados = 0;
    let marcos: any = null;

    if (memberIds.length > 0) {
      // Pedro: job de repasse programado por membro (nao mexe em created_at/rodizio).
      for (const m of members) {
        const r = await ensureRedistributionJob(admin, requesterId, m, requesterId);
        redistribution.push({ member_id: m.id, ...r });
        pedroLeadsAfetados += r.total || 0;
      }

      // Marcos: round-robin dos leads ATIVOS pro proximo vendedor ativo (RPC atomica).
      // Atualiza assigned_to + custom_fields.seller_member_id/seller_name; leads
      // fechados ficam no historico com o membro (soft-deletado, entao sem orfao).
      const { data: mres, error: merr } = await admin.rpc('redistribute_marcos_leads_on_remove', {
        p_master: requesterId, p_removed: memberIds, p_reason: reason,
      });
      if (merr) console.warn('[delete-responsavel] marcos redistrib falhou:', merr.message);
      marcos = mres || null;

      // Desvincula instancias de WhatsApp do membro (numeros de vendedor ativo intocados).
      await admin.from('wa_instances').update({ seller_member_id: null })
        .eq('user_id', requesterId).in('seller_member_id', memberIds);

      // Soft-delete operacional: tira do painel/fila/login preservando FKs/historico.
      const { error: updErr } = await admin.from('ai_team_members')
        .update({ is_active: false, active_in_system: false, show_in_live: false, visible_features: {} })
        .eq('user_id', requesterId)
        .in('id', memberIds);
      if (updErr) throw updErr;
    }

    // Remove as entregas (Atendimento/Trafego/Alertas).
    if (responsavelIds.length > 0) {
      await admin.from('conta_responsaveis')
        .delete().eq('user_id', requesterId).in('id', responsavelIds);
    }

    // Solta manager_id + BLOQUEIA LOGIN so quando nao sobra vinculo ativo valido.
    const bans: any[] = [];
    for (const authUserId of authUserIds) {
      const { data: remaining } = await admin.from('ai_team_members')
        .select('id')
        .eq('auth_user_id', authUserId)
        .neq('active_in_system', false)
        .limit(1);
      const semVinculoAtivo = !remaining || remaining.length === 0;
      if (semVinculoAtivo) {
        await admin.from('profiles').update({ manager_id: null })
          .eq('id', authUserId).eq('manager_id', requesterId);
      }
      // A RPC re-checa TODAS as travas (nao-master, role seller, sem agentes,
      // sem vinculo ativo em NENHUMA conta) antes de banir. Master nunca cai aqui.
      const { data: banRes, error: banErr } = await admin.rpc('revoke_seller_login', {
        p_auth: authUserId, p_master: requesterId, p_reason: reason,
      });
      if (banErr) console.warn('[delete-responsavel] ban falhou:', banErr.message);
      bans.push({ auth_user_id: authUserId, ...(banRes || { banned: false, motivo: banErr?.message || 'erro' }) });
    }

    // Log de auditoria enriquecido (best-effort — nao derruba a exclusao se falhar).
    try {
      await admin.from('responsavel_exclusao_log').insert({
        user_id: requesterId, excluido_por: requesterId,
        alvo_whatsapp: targetNat || null, alvo_nome: alvoNome,
        membros_removidos: memberIds.length, responsaveis_removidos: responsavelIds.length,
        detalhe: {
          reason,
          entrada: { member_id: rawMemberId, whatsapp: targetNat || null, email: rawEmail || null },
          member_ids: memberIds, responsavel_ids: responsavelIds, detached_auth_users: authUserIds,
          pedro_leads_afetados: pedroLeadsAfetados,
          pedro_redistribution: redistribution,
          marcos_redistribuidos: marcos?.redistribuidos ?? 0,
          marcos_sem_vendedor: marcos?.sem_vendedor ?? 0,
          marcos_elegiveis: marcos?.elegiveis ?? 0,
          marcos_resultado: marcos,
          banimentos: bans,
        },
      });
    } catch (e: any) { console.warn('[delete-responsavel] log falhou:', e?.message || e); }

    return json({
      success: true,
      removed_members: memberIds.length,
      removed_responsaveis: responsavelIds.length,
      detached_auth_users: authUserIds.length,
      pedro_leads_afetados: pedroLeadsAfetados,
      pedro_redistribution: redistribution,
      marcos,
      banimentos: bans,
    });
  } catch (error: any) {
    console.error('[delete-responsavel] error:', error);
    return json({ success: false, error: error?.message || 'Erro ao excluir responsavel.' }, 500);
  }
});
