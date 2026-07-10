// deno-lint-ignore-file no-explicit-any
// ============================================================================
// delete-responsavel — Exclui um responsavel (vendedor/gerente/trafego) da conta
// com seguranca. Regras (auditoria 10/07):
//  - So o MASTER da propria conta exclui: opera SOMENTE em linhas com
//    user_id = quem chamou (dono das rows). Vendedor e barrado.
//  - Casa o alvo pelo numero NACIONAL COMPLETO (55+DDD+numero), NUNCA pelos
//    ultimos 8 digitos — dois numeros com final igual sao pessoas diferentes.
//  - Exclui EXATAMENTE o responsavel selecionado (por id das rows achadas).
//  - Nao apaga historico de leads/conversas: so desvincula (assigned_to = null).
//  - Tira do painel (deleta o membro) e do login (trigger bane o auth ao sair da
//    equipe), limpa entregas (conta_responsaveis) e a instancia (seller_member_id).
//  - Nao deixa o master excluir a propria conta.
//  - Registra log de auditoria (responsavel_exclusao_log).
// verify_jwt=true: o chamador precisa de sessao valida; ainda validamos o dono.
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

    const body = await req.json().catch(() => ({}));
    const targetNat = normalizePhoneBR(body?.whatsapp);
    // targetNat valido = 55 + nacional (>=12: 55 + DDD(2) + numero(>=8)).
    if (!targetNat || targetNat.length < 12) {
      return json({ success: false, error: 'WhatsApp invalido (informe DDD + numero).' }, 400);
    }

    // Alvos: SO da conta do requester, casando o numero nacional COMPLETO.
    const { data: allMembers, error: mErr } = await admin
      .from('ai_team_members')
      .select('id, auth_user_id, whatsapp_number, name, is_manager')
      .eq('user_id', requesterId);
    if (mErr) throw mErr;
    const members = (allMembers || []).filter((m: any) => normalizePhoneBR(m.whatsapp_number) === targetNat);
    const memberIds = members.map((m: any) => m.id).filter(Boolean);
    const authUserIds = Array.from(new Set(members.map((m: any) => m.auth_user_id).filter(Boolean)));

    // Trava: master nao exclui a propria conta/login.
    if (authUserIds.includes(requesterId)) {
      return json({ success: false, error: 'Voce nao pode excluir a propria conta master por aqui.' }, 400);
    }

    const { data: allResp } = await admin
      .from('conta_responsaveis').select('id, whatsapp, nome').eq('user_id', requesterId);
    const respRows = (allResp || []).filter((r: any) => normalizePhoneBR(r.whatsapp) === targetNat);
    const responsavelIds = respRows.map((r: any) => r.id).filter(Boolean);
    const alvoNome = members[0]?.name || respRows[0]?.nome || null;

    if (memberIds.length === 0 && responsavelIds.length === 0) {
      return json({ success: false, error: 'Nenhum responsavel encontrado com esse numero nesta conta.' }, 404);
    }

    // 1) Desvincula leads (NAO apaga lead/conversa) — mesmo padrao do "excluir vendedor".
    if (memberIds.length > 0) {
      await admin.from('crm_leads').update({ assigned_to: null })
        .eq('user_id', requesterId).in('assigned_to', memberIds);
      await admin.from('ai_crm_leads').update({ assigned_to_id: null })
        .eq('user_id', requesterId).in('assigned_to_id', memberIds);
      await admin.from('wa_instances').update({ seller_member_id: null })
        .eq('user_id', requesterId).in('seller_member_id', memberIds);

      // custom_fields->>seller_member_id (fallback do painel): limpa a chave por row.
      for (const mid of memberIds) {
        const { data: rows } = await admin.from('crm_leads')
          .select('id, custom_fields').eq('user_id', requesterId)
          .eq('custom_fields->>seller_member_id', mid);
        for (const row of rows || []) {
          const cf = { ...(((row as any).custom_fields) || {}) };
          delete cf.seller_member_id;
          await admin.from('crm_leads').update({ custom_fields: cf })
            .eq('id', (row as any).id).eq('user_id', requesterId);
        }
      }

      // 2) Remove o membro (tira do painel + da fila; trigger bane o login).
      const { error: delErr } = await admin.from('ai_team_members')
        .delete().eq('user_id', requesterId).in('id', memberIds);
      if (delErr) throw delErr;
    }

    // 3) Remove as entregas (Atendimento/Trafego/Alertas).
    if (responsavelIds.length > 0) {
      await admin.from('conta_responsaveis')
        .delete().eq('user_id', requesterId).in('id', responsavelIds);
    }

    // 4) Se o login nao tem mais nenhum vinculo na conta, solta o manager_id.
    for (const authUserId of authUserIds) {
      const { data: remaining } = await admin.from('ai_team_members')
        .select('id').eq('auth_user_id', authUserId).limit(1);
      if (!remaining || remaining.length === 0) {
        await admin.from('profiles').update({ manager_id: null })
          .eq('id', authUserId).eq('manager_id', requesterId);
      }
    }

    // 5) Log de auditoria (best-effort — nao derruba a exclusao se falhar).
    try {
      await admin.from('responsavel_exclusao_log').insert({
        user_id: requesterId, excluido_por: requesterId,
        alvo_whatsapp: targetNat, alvo_nome: alvoNome,
        membros_removidos: memberIds.length, responsaveis_removidos: responsavelIds.length,
        detalhe: { member_ids: memberIds, responsavel_ids: responsavelIds, detached_auth_users: authUserIds },
      });
    } catch (e: any) { console.warn('[delete-responsavel] log falhou:', e?.message || e); }

    return json({
      success: true,
      removed_members: memberIds.length,
      removed_responsaveis: responsavelIds.length,
      detached_auth_users: authUserIds.length,
    });
  } catch (error: any) {
    console.error('[delete-responsavel] error:', error);
    return json({ success: false, error: error?.message || 'Erro ao excluir responsavel.' }, 500);
  }
});
