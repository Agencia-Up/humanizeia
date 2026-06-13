// ============================================================================
// assign-pool-lead  (Repasse — Fase 2)
// ----------------------------------------------------------------------------
// O gestor atribui um lead do BOLSAO (sem dono, disponivel_repasse=true) a um
// vendedor escolhido no Painel ao Vivo. A funcao:
//   - valida o lead (esta no bolsao, e do dono) e o vendedor (ativo, do dono)
//   - notifica o vendedor por WhatsApp com a conversa/contexto (buildBriefing)
//   - ATRIBUI firme: assigned_to_id = vendedor, tira do bolsao, status_crm='novo'
//     (lead frio volta a ser acionavel), transfer 'confirmed' (repasse_marcos)
//
// AUTORIZACAO (espelha redistribute-seller-leads): usuario (JWT do gestor) ou
// servico (service_role_key). Sempre escopa ao dono autorizado. NUNCA loga segredo.
// ============================================================================

import { buildConversationBriefing } from '../_shared/transfer/buildBriefing.ts';

// ─── Inline PostgREST client ─────────────────────────────────────────────────
function createSupabaseClient(url: string, key: string) {
  const restBase = `${url}/rest/v1`;
  const baseHeaders: Record<string, string> = {
    'apikey': key, 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json',
  };
  function buildQuery(table: string) {
    let _select: string | null = null;
    let _filters: { col: string; op: string; val: string }[] = [];
    let _limit: number | null = null;
    let _orders: { column: string; ascending: boolean; nullsFirst: boolean }[] = [];
    let _maybeSingle = false;
    let _body: any = null;
    let _method: 'GET' | 'POST' | 'PATCH' = 'GET';
    let _returnSelect: string | null = null;
    const builder: any = {
      select(cols?: string) {
        if (_method === 'PATCH') { _returnSelect = cols || '*'; return builder; }
        _select = cols || '*'; return builder;
      },
      eq(col: string, val: any) { _filters.push({ col, op: 'eq', val: String(val) }); return builder; },
      is(col: string, val: any) { _filters.push({ col, op: 'is', val: String(val) }); return builder; },
      in(col: string, vals: any[]) { _filters.push({ col, op: 'in', val: `(${vals.map(v => `"${v}"`).join(',')})` }); return builder; },
      limit(n: number) { _limit = n; return builder; },
      order(column: string, opts?: { ascending?: boolean; nullsFirst?: boolean }) {
        _orders.push({ column, ascending: opts?.ascending ?? true, nullsFirst: opts?.nullsFirst ?? false }); return builder;
      },
      maybeSingle() { _maybeSingle = true; return builder._execute(); },
      update(data: any) { _method = 'PATCH'; _body = data; return builder; },
      insert(data: any) { _method = 'POST'; _body = data; return builder._execute(); },
      then(resolve: (v: any) => void, reject?: (e: any) => void) { return builder._execute().then(resolve, reject); },
      async _execute(): Promise<{ data: any; error: any }> {
        const params = new URLSearchParams();
        const selectVal = _method === 'PATCH' ? (_returnSelect || undefined) : (_select || '*');
        if (selectVal) params.set('select', selectVal);
        for (const f of _filters) params.append(f.col, `${f.op}.${f.val}`);
        for (const o of _orders) params.append('order', o.column + (o.ascending ? '.asc' : '.desc') + (o.nullsFirst ? '.nullsfirst' : '.nullslast'));
        if (_limit !== null) params.set('limit', String(_limit));
        const qs = params.toString();
        const headers: Record<string, string> = { ...baseHeaders };
        if (_method === 'PATCH' && _returnSelect) headers['Prefer'] = 'return=representation';
        if (_method === 'POST') headers['Prefer'] = 'return=minimal';
        if (_maybeSingle) headers['Accept'] = 'application/vnd.pgrst.object+json';
        try {
          const res = await fetch(`${restBase}/${table}${qs ? '?' + qs : ''}`, {
            method: _method, headers, body: _body ? JSON.stringify(_body) : undefined,
          });
          if (_maybeSingle && res.status === 406) return { data: null, error: null };
          if (!res.ok) return { data: null, error: { message: await res.text(), status: res.status } };
          if (_method === 'POST' && !_returnSelect) return { data: null, error: null };
          const ct = res.headers.get('content-type') || '';
          if (!ct.includes('json')) return { data: null, error: null };
          return { data: await res.json(), error: null };
        } catch (err: any) { return { data: null, error: { message: err.message } }; }
      },
    };
    return builder;
  }
  return { from(table: string) { return buildQuery(table); } };
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (obj: any, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

// ── Autorizacao (espelha redistribute-seller-leads) ──────────────────────────
async function getAuthUser(url: string, apikey: string, userJwt: string): Promise<any | null> {
  try {
    const res = await fetch(`${url}/auth/v1/user`, { headers: { apikey, 'Authorization': `Bearer ${userJwt}` } });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}
async function resolveEffectiveUserId(supabase: any, userId: string): Promise<string> {
  const { data: profile } = await supabase.from('profiles').select('role,manager_id').eq('id', userId).maybeSingle();
  if (profile?.role === 'seller' && profile?.manager_id) return profile.manager_id;
  const { data: member } = await supabase.from('ai_team_members').select('user_id')
    .eq('auth_user_id', userId).limit(1).maybeSingle();
  return member?.user_id || userId;
}
async function canAccessLeadOwner(supabase: any, userId: string, effectiveUserId: string, ownerId: string): Promise<boolean> {
  if (!ownerId) return false;
  if (ownerId === userId || ownerId === effectiveUserId) return true;
  const { data: profile } = await supabase.from('profiles').select('role,manager_id').eq('id', userId).maybeSingle();
  if (profile?.role === 'seller' && profile?.manager_id === ownerId) return true;
  const { data: member } = await supabase.from('ai_team_members').select('id')
    .eq('auth_user_id', userId).eq('user_id', ownerId).limit(1).maybeSingle();
  return !!member?.id;
}

// ── WhatsApp (3 tentativas, igual redistribute/rescue) ───────────────────────
async function sendWAMessage(instance: any, phone: string, text: string): Promise<boolean> {
  if (!instance?.api_url || !phone) return false;
  let dest = String(phone).replace(/\D/g, '');
  if (dest.length === 10 || dest.length === 11) dest = `55${dest}`;
  const baseUrl = String(instance.api_url).replace(/\/+$/, '');
  const instKey = instance.api_key_encrypted || instance.api_key || '';
  if (!instKey) return false;
  const remoteJid = `${dest}@s.whatsapp.net`;
  const attempts = [
    { url: `${baseUrl}/send/text`, body: { number: dest, text } },
    { url: `${baseUrl}/send/text`, body: { remoteJid, text } },
    { url: `${baseUrl}/message/sendText/${instance.instance_name}`, body: { number: dest, text } },
  ];
  for (const a of attempts) {
    try {
      const res = await fetch(a.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'token': instKey, 'apikey': instKey },
        body: JSON.stringify(a.body),
      });
      if (res.ok) return true;
    } catch { /* tenta o proximo */ }
  }
  return false;
}
async function resolveInstance(supabase: any, lead: any): Promise<any | null> {
  let instance: any = null;
  if (lead.agent_id) {
    const { data: agent } = await supabase.from('wa_ai_agents').select('instance_ids,instance_id').eq('id', lead.agent_id).maybeSingle();
    const ids: string[] = [...(agent?.instance_ids || [])];
    if (agent?.instance_id) ids.push(agent.instance_id);
    if (ids.length) {
      const { data: insts } = await supabase.from('wa_instances').select('*').in('id', ids).limit(1);
      instance = insts?.[0] || null;
    }
  }
  if (!instance) {
    const { data: fb } = await supabase.from('wa_instances').select('*')
      .eq('user_id', lead.user_id).eq('is_active', true).eq('status', 'connected').limit(1);
    instance = fb?.[0] || null;
  }
  return instance;
}

// ─── Handler ─────────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const authHeader = req.headers.get('authorization') ?? '';
  const token = authHeader.replace('Bearer ', '').trim();
  if (!token) return json({ error: 'Nao autorizado' }, 401);

  let body: any = {};
  try { body = await req.json(); } catch { /* sem body */ }
  const leadId: string | null = body?.lead_id ? String(body.lead_id) : null;
  const toMemberId: string | null = body?.to_member_id ? String(body.to_member_id) : null;
  const requestedUserId: string | null = body?.user_id ?? null;
  if (!leadId || !toMemberId) return json({ error: 'Informe lead_id e to_member_id.' }, 400);

  const supabase = createSupabaseClient(supabaseUrl, serviceKey);

  // ── AUTORIZACAO ──
  const isServiceCall = !!serviceKey && token === serviceKey;
  let scopeUserId: string | null = null;
  let callerUserId: string | null = null;
  if (isServiceCall) {
    scopeUserId = requestedUserId;
  } else {
    const authUser = await getAuthUser(supabaseUrl, serviceKey, token);
    if (!authUser?.id) return json({ error: 'Token invalido' }, 401);
    callerUserId = authUser.id;
    const effectiveUserId = await resolveEffectiveUserId(supabase, callerUserId);
    const targetOwner = requestedUserId || effectiveUserId;
    if (!(await canAccessLeadOwner(supabase, callerUserId, effectiveUserId, targetOwner))) {
      return json({ error: 'Sem permissao para atribuir leads deste dono' }, 403);
    }
    scopeUserId = targetOwner;
  }

  try {
    // 1. Lead precisa estar NO BOLSAO (disponivel_repasse) e ser do dono
    let leadQ = supabase.from('ai_crm_leads')
      .select('id,user_id,agent_id,lead_name,summary,remote_jid,status_crm,disponivel_repasse,vehicle_interest')
      .eq('id', leadId);
    if (scopeUserId) leadQ = leadQ.eq('user_id', scopeUserId);
    const { data: lead } = await leadQ.maybeSingle();
    if (!lead) return json({ error: 'Lead nao encontrado.' }, 404);
    if (lead.disponivel_repasse !== true) return json({ error: 'Esse lead nao esta no bolsao (ja foi atribuido).' }, 409);
    const ownerId: string = lead.user_id;

    // 2. Vendedor de destino precisa ser ATIVO e do mesmo dono
    const { data: seller } = await supabase.from('ai_team_members')
      .select('id,user_id,name,whatsapp_number,is_active')
      .eq('id', toMemberId).maybeSingle();
    if (!seller || seller.user_id !== ownerId) return json({ error: 'Vendedor invalido para este dono.' }, 400);
    if (seller.is_active === false) return json({ error: 'Vendedor esta inativo.' }, 400);

    // 3. Notifica o vendedor por WhatsApp (conversa/contexto). Se nao houver
    //    instancia/numero, segue mesmo assim (atribuicao nao depende do envio).
    const instance = await resolveInstance(supabase, lead);
    const phone = String(lead.remote_jid || '').replace(/\D/g, '');
    const briefing = await buildConversationBriefing(supabase, lead);
    const carro = lead.vehicle_interest
      || (String(lead.summary || '').match(/ve[íi]culo de interesse:?\*?\s*([^\n*]{2,80})/i)?.[1]?.trim())
      || 'nao informado';
    const sellerMsg =
      `🔄 *LEAD ATRIBUIDO A VOCE — JA ESTA NO SEU CRM*\n\n` +
      `Esse lead estava sem dono e o gestor passou pra voce.\n\n` +
      `👤 *Nome:* ${lead.lead_name || 'Nao informado'}\n` +
      (phone ? `📱 *Telefone:* wa.me/${phone}\n` : '') +
      `🚗 *Carro de interesse:* ${carro}\n` +
      `\n📝 *Conversa / contexto:*\n${briefing}\n` +
      (phone ? `\n👉 *Atender agora:* https://wa.me/${phone}` : '') +
      `\n\n⚡ *Atenda o quanto antes!*`;
    let notified = false;
    if (instance) notified = await sendWAMessage(instance, seller.whatsapp_number, sellerMsg);

    // 4. ATRIBUI firme + tira do bolsao. status_crm='novo' (lead frio volta a ser
    //    acionavel). Transfer 'confirmed' (repasse_marcos) pro historico/contador.
    await supabase.from('ai_lead_transfers').insert({
      user_id: ownerId, lead_id: lead.id,
      from_member_id: null, to_member_id: seller.id,
      transfer_reason: 'repasse_marcos',
      notes: 'Atribuido do bolsao (lead sem dono) pelo gestor no painel.',
      transfer_status: 'confirmed', is_confirmed: true,
      triggered_by_user_id: callerUserId,
    });
    await supabase.from('ai_crm_leads').update({
      assigned_to_id: seller.id,
      disponivel_repasse: false,
      repasse_motivo: null,
      status: 'em_atendimento',
      status_crm: 'novo',
      last_interaction_at: new Date().toISOString(),
    }).eq('id', lead.id);
    await supabase.from('ai_team_members').update({ last_lead_received_at: new Date().toISOString() }).eq('id', seller.id);

    return json({ ok: true, lead_id: lead.id, lead_name: lead.lead_name, vendedor: seller.name, notificado: notified });
  } catch (err: any) {
    console.error('[AssignPool] Erro critico:', err);
    return json({ error: err.message }, 500);
  }
});
