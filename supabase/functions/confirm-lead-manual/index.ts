// confirm-lead-manual — o GERENTE confirma um lead pelo card do CRM, valendo como
// se o VENDEDOR tivesse confirmado o "Ok" no WhatsApp. Reproduz EXATAMENTE o efeito
// da confirmacao do V2 (_shared/pedro-v2/transferRouter.ts), sem tocar no V1 nem no
// V2: confirma a transferencia pendente, fixa o vendedor no lead, poe em atendimento
// e expira transfers irmaos. Isolado e idempotente.
//
// Auth: valida o JWT do chamador (getAuthUser com serviceKey — mesma correcao do
// rescue) e exige canAccessLeadOwner sobre o dono do lead. So gerente/dono age.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { resolveTransferFailures } from '../_shared/pedro-v2/logTransferFailure.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

async function getAuthUser(url: string, apiKey: string, userJwt: string): Promise<any | null> {
  if (!url || !apiKey || !userJwt) return null;
  try {
    const res = await fetch(`${url}/auth/v1/user`, {
      headers: { apikey: apiKey, 'Authorization': `Bearer ${userJwt}` },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

/** Resolve o dono real dos dados (vendedor -> dono; senao o proprio). */
async function resolveEffectiveUserId(supabase: any, userId: string): Promise<string> {
  const { data: profile } = await supabase
    .from('profiles').select('role,manager_id').eq('id', userId).maybeSingle();
  if (profile?.role === 'seller' && profile?.manager_id) return profile.manager_id;
  const { data: member } = await supabase
    .from('ai_team_members').select('user_id')
    .eq('auth_user_id', userId)
    .order('is_active', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1).maybeSingle();
  return member?.user_id || userId;
}

/** Pode o usuario agir sobre os leads deste dono? */
async function canAccessLeadOwner(supabase: any, userId: string, effectiveUserId: string, ownerId: string): Promise<boolean> {
  if (!ownerId) return false;
  if (ownerId === userId || ownerId === effectiveUserId) return true;
  const { data: profile } = await supabase
    .from('profiles').select('role,manager_id').eq('id', userId).maybeSingle();
  if (profile?.role === 'seller' && profile?.manager_id === ownerId) return true;
  const { data: member } = await supabase
    .from('ai_team_members').select('id')
    .eq('auth_user_id', userId).eq('user_id', ownerId)
    .limit(1).maybeSingle();
  return !!member?.id;
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceKey) return json({ error: 'Config ausente' }, 500);
  const supabase = createClient(supabaseUrl, serviceKey);

  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  let body: any = {};
  try { body = await req.json(); } catch { /* vazio */ }
  const leadId: string | null = body?.lead_id || null;
  if (!leadId) return json({ error: 'lead_id obrigatorio' }, 400);

  // Lead + dono
  const { data: lead } = await supabase
    .from('ai_crm_leads')
    .select('id, user_id, assigned_to_id, status')
    .eq('id', leadId)
    .maybeSingle();
  if (!lead) return json({ error: 'Lead nao encontrado' }, 404);

  // ── Autorizacao ──────────────────────────────────────────────────────────
  const isServiceCall = !!serviceKey && token === serviceKey;
  if (!isServiceCall) {
    const authUser = await getAuthUser(supabaseUrl, serviceKey, token);
    if (!authUser?.id) return json({ error: 'Token invalido' }, 401);
    const effectiveUserId = await resolveEffectiveUserId(supabase, authUser.id);
    const allowed = await canAccessLeadOwner(supabase, authUser.id, effectiveUserId, lead.user_id);
    if (!allowed) return json({ error: 'Sem permissao para confirmar este lead' }, 403);
  }

  const now = new Date().toISOString();

  // Transferencia pendente deste lead (a mais recente).
  const { data: pending } = await supabase
    .from('ai_lead_transfers')
    .select('id, to_member_id, created_at')
    .eq('lead_id', leadId)
    .eq('transfer_status', 'pending')
    .eq('is_confirmed', false)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const memberId: string | null = pending?.to_member_id || lead.assigned_to_id || null;
  if (!memberId) {
    return json({
      ok: false, confirmed: false, reason: 'no_seller',
      message: 'Lead sem vendedor atribuido. Atribua um vendedor antes de confirmar.',
    }, 200);
  }

  // 1) Marca a transferencia pendente como confirmada (se existir).
  if (pending?.id) {
    await supabase.from('ai_lead_transfers')
      .update({ transfer_status: 'confirmed', is_confirmed: true, confirmed_at: now })
      .eq('id', pending.id);
  }

  // 2) Fixa o vendedor no lead + poe em atendimento (mesmo efeito do "Ok" do vendedor).
  //    NAO mexe em status_crm (a coluna do Kanban) — so no status do motor.
  const { error: leadErr } = await supabase.from('ai_crm_leads')
    .update({ assigned_to_id: memberId, status: 'em_atendimento', last_interaction_at: now })
    .eq('id', leadId);
  if (leadErr) return json({ error: leadErr.message }, 500);

  // 3) Expira transfers irmaos ainda pendentes do MESMO lead (evita repasse pelo timeout).
  if (pending?.id) {
    await supabase.from('ai_lead_transfers')
      .update({ transfer_status: 'expired' })
      .eq('lead_id', leadId)
      .eq('transfer_status', 'pending')
      .neq('id', pending.id);
  }

  // 4) Resolve falhas de transferencia abertas deste lead (best-effort).
  try { await resolveTransferFailures({ user_id: lead.user_id, lead_id: leadId, resolved_by: 'manager-manual' }); } catch (_e) { /* nao derruba */ }

  // 5) Marca recebimento no vendedor (best-effort).
  try { await supabase.from('ai_team_members').update({ last_lead_received_at: now }).eq('id', memberId); } catch (_e) { /* nao derruba */ }

  return json({ ok: true, confirmed: true, member_id: memberId }, 200);
});
