// ============================================================================
// redistribute-seller-leads  (Repasse — Fase 1)
// ----------------------------------------------------------------------------
// PROBLEMA QUE RESOLVE:
//   Quando um vendedor sai (folga, demissao, saida antecipada), os leads que ele
//   estava ATENDENDO ficam presos no CRM dele e ninguem continua. Esta funcao
//   pega os leads ATIVOS desse vendedor e os REPASSA para os outros vendedores
//   ativos (mesmo round-robin do resgate), levando a CONVERSA junto pra o novo
//   vendedor continuar de onde parou — nao recomecar.
//
//   So mexe nos leads ATIVOS (em atendimento). Lead parado/frio fica de fora
//   (vai pro "bolsao" na Fase 2). Lead fechado/perdido/transferido nao e tocado.
//
// COMO FUNCIONA (espelha rescue-orphan-transfers, que ja roda em prod):
//   - dry_run = TRUE por padrao -> so RELATA o que faria (nao envia WhatsApp,
//     nao altera nada). O painel mostra a previa; so executa com { dry_run:false }.
//   - LIVE: pra cada lead ativo do vendedor que saiu:
//       * escolhe o proximo vendedor ativo (round-robin, exclui quem saiu)
//       * notifica por WhatsApp com a conversa/contexto (buildConversationBriefing)
//       * ATRIBUI firme ao novo vendedor (transfer 'confirmed') e MANTEM o
//         status_crm (preserva o estagio do funil — o lead estava em atendimento).
//   - Atribuicao firme (sem depender de "Ok"): o lead aparece NA HORA no CRM do
//     novo vendedor, do jeito validado no resgate. O timeout-checker nao mexe em
//     transfer 'confirmed', entao nao tira o lead depois.
//   - NAO mexe em arrived_at (e re-atribuicao, nao trafego pago novo -> nao
//     bagunca o custo por lead do dia).
//
// SEGURANCA / AUTORIZACAO (igual rescue/manual-transfer):
//   - Servico/cron: Bearer == service_role_key -> admin (escopo opcional).
//   - Usuario: valida JWT, resolve dono efetivo, exige canAccessLeadOwner e
//     SEMPRE escopa ao dono autorizado. Valida que o vendedor de origem e do dono.
//   - LIVE so dentro do horario operacional; usuario pode { force:true }.
//   - dry_run roda a qualquer hora (read-only). NUNCA loga api_key/segredos.
// ============================================================================

import { logTransferFailure } from '../_shared/pedro-v2/logTransferFailure.ts';
import { buildConversationBriefing } from '../_shared/transfer/buildBriefing.ts';

// ─── Inline PostgREST client (sem imports externos) ─────────────────────────
function createSupabaseClient(url: string, key: string) {
  const restBase = `${url}/rest/v1`;
  const baseHeaders: Record<string, string> = {
    'apikey': key,
    'Authorization': `Bearer ${key}`,
    'Content-Type': 'application/json',
  };

  type FilterEntry = { col: string; op: string; val: string };
  type OrderEntry = { column: string; ascending: boolean; nullsFirst: boolean };

  function buildQuery(table: string) {
    let _select: string | null = null;
    let _filters: FilterEntry[] = [];
    let _orders: OrderEntry[] = [];
    let _limit: number | null = null;
    let _maybeSingle = false;
    let _body: any = null;
    let _method: 'GET' | 'POST' | 'PATCH' = 'GET';
    let _returnSelect: string | null = null;

    const builder = {
      select(cols?: string) {
        if (_method === 'PATCH') { _returnSelect = cols || '*'; return builder; }
        _select = cols || '*'; return builder;
      },
      eq(col: string, val: any) { _filters.push({ col, op: 'eq', val: String(val) }); return builder; },
      neq(col: string, val: any) { _filters.push({ col, op: 'neq', val: String(val) }); return builder; },
      lt(col: string, val: any) { _filters.push({ col, op: 'lt', val: String(val) }); return builder; },
      lte(col: string, val: any) { _filters.push({ col, op: 'lte', val: String(val) }); return builder; },
      gt(col: string, val: any) { _filters.push({ col, op: 'gt', val: String(val) }); return builder; },
      gte(col: string, val: any) { _filters.push({ col, op: 'gte', val: String(val) }); return builder; },
      is(col: string, val: any) { _filters.push({ col, op: 'is', val: String(val) }); return builder; },
      not(col: string, op: string, val: any) { _filters.push({ col, op: `not.${op}`, val: String(val) }); return builder; },
      in(col: string, vals: any[]) {
        const list = vals.map((v: any) => `"${v}"`).join(',');
        _filters.push({ col, op: 'in', val: `(${list})` }); return builder;
      },
      order(column: string, opts?: { ascending?: boolean; nullsFirst?: boolean }) {
        _orders.push({ column, ascending: opts?.ascending ?? true, nullsFirst: opts?.nullsFirst ?? false }); return builder;
      },
      limit(n: number) { _limit = n; return builder; },
      maybeSingle() { _maybeSingle = true; return builder._execute(); },
      single() { _maybeSingle = true; return builder._execute(); },
      update(data: any) { _method = 'PATCH'; _body = data; return builder; },
      insert(data: any) { _method = 'POST'; _body = data; return builder._execute(); },
      then(resolve: (v: any) => void, reject?: (e: any) => void) { return builder._execute().then(resolve, reject); },
      async _execute(): Promise<{ data: any; error: any }> {
        const params = new URLSearchParams();
        const selectVal = _method === 'PATCH' ? (_returnSelect || undefined) : (_select || '*');
        if (selectVal) params.set('select', selectVal);
        for (const f of _filters) params.append(f.col, `${f.op}.${f.val}`);
        for (const o of _orders) {
          let orderStr = o.column + (o.ascending ? '.asc' : '.desc') + (o.nullsFirst ? '.nullsfirst' : '.nullslast');
          params.append('order', orderStr);
        }
        if (_limit !== null) params.set('limit', String(_limit));
        const queryStr = params.toString();
        const urlStr = `${restBase}/${table}${queryStr ? '?' + queryStr : ''}`;
        const headers: Record<string, string> = { ...baseHeaders };
        if (_method === 'PATCH' && _returnSelect) headers['Prefer'] = 'return=representation';
        if (_method === 'POST') headers['Prefer'] = 'return=minimal';
        if (_maybeSingle) headers['Accept'] = 'application/vnd.pgrst.object+json';
        try {
          const res = await fetch(urlStr, { method: _method, headers, body: _body ? JSON.stringify(_body) : undefined });
          if (_maybeSingle && res.status === 406) return { data: null, error: null };
          if (!res.ok) { const errBody = await res.text(); return { data: null, error: { message: errBody, status: res.status } }; }
          if (_method === 'POST' && !_returnSelect) return { data: null, error: null };
          const contentType = res.headers.get('content-type') || '';
          if (!contentType.includes('json')) return { data: null, error: null };
          const data = await res.json();
          return { data, error: null };
        } catch (err: any) {
          return { data: null, error: { message: err.message } };
        }
      },
    };
    return builder;
  }
  return { from(table: string) { return buildQuery(table); } };
}

// ─── CORS ───────────────────────────────────────────────────────────────────
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (obj: any, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

// ── Autorizacao (espelha rescue/manual-transfer) ─────────────────────────────
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
    .eq('auth_user_id', userId).order('is_active', { ascending: false }).order('created_at', { ascending: false })
    .limit(1).maybeSingle();
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

// ── Horario operacional (Brasilia, UTC-3) — mesma regra dos outros motores ───
function brasiliaMinutesOfDay(dt: Date): number {
  const utcMin = dt.getUTCHours() * 60 + dt.getUTCMinutes();
  return ((utcMin - 180) + 1440) % 1440;
}
function toBrasilia(dt: Date): Date { return new Date(dt.getTime() - 3 * 60 * 60 * 1000); }
function getEasterDate(year: number): Date {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}
function getBrazilianHolidays(year: number): Set<string> {
  const holidays = new Set<string>();
  const fmt = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400000);
  holidays.add(`${year}-01-01`); holidays.add(`${year}-04-21`); holidays.add(`${year}-05-01`);
  holidays.add(`${year}-09-07`); holidays.add(`${year}-10-12`); holidays.add(`${year}-11-02`);
  holidays.add(`${year}-11-15`); holidays.add(`${year}-12-25`);
  const easter = getEasterDate(year);
  holidays.add(fmt(addDays(easter, -48))); holidays.add(fmt(addDays(easter, -47)));
  holidays.add(fmt(addDays(easter, -2)));  holidays.add(fmt(addDays(easter, 60)));
  return holidays;
}
function isDomingoOuFeriado(dt: Date): boolean {
  const brasilia = toBrasilia(dt);
  if (brasilia.getUTCDay() === 0) return true;
  const year = brasilia.getUTCFullYear();
  const dateStr = `${year}-${String(brasilia.getUTCMonth() + 1).padStart(2, '0')}-${String(brasilia.getUTCDate()).padStart(2, '0')}`;
  return getBrazilianHolidays(year).has(dateStr);
}
function getRepassWindow(dt: Date): { start: number; end: number; label: string } {
  const brasilia = toBrasilia(dt);
  const dow = brasilia.getUTCDay();
  if (dow === 0 || isDomingoOuFeriado(dt)) return { start: 11 * 60 + 11, end: 17 * 60 + 29, label: '11:11-17:29 (dom/feriado)' };
  if (dow === 6) return { start: 10 * 60 + 11, end: 18 * 60 + 29, label: '10:11-18:29 (sabado)' };
  return { start: 10 * 60 + 11, end: 19 * 60 + 29, label: '10:11-19:29 (seg-sex)' };
}
function isWithinRepassWindow(dt: Date): boolean {
  const min = brasiliaMinutesOfDay(dt);
  const { start, end } = getRepassWindow(dt);
  return min >= start && min <= end;
}

// ── Round-robin (igual ao rescue/timeout-checker) ────────────────────────────
function sellerPhoneKey(seller: any): string {
  const digits = String(seller?.whatsapp_number || '').replace(/\D/g, '');
  const local = digits.startsWith('55') && digits.length >= 12 ? digits.slice(2) : digits;
  if (local.length === 11 && local[2] === '9') return `${local.slice(0, 2)}${local.slice(3)}`;
  return local.slice(-10);
}
function pickNextSeller(sellers: any[], recentTransfers: any[], excludeId?: string, excludePhoneKey?: string): any | null {
  const seenPhones = new Set<string>();
  const active = sellers.filter((s: any) => {
    const phoneKey = sellerPhoneKey(s);
    if (!s.is_active || s.id === excludeId || (excludePhoneKey && phoneKey === excludePhoneKey)) return false;
    if (phoneKey && seenPhones.has(phoneKey)) return false;
    if (phoneKey) seenPhones.add(phoneKey);
    return true;
  });
  if (!active.length) return null;
  const lastMap = new Map<string, number>();
  for (const t of recentTransfers) {
    if (t.to_member_id && !lastMap.has(t.to_member_id)) lastMap.set(t.to_member_id, new Date(t.created_at).getTime());
  }
  const neverReceived = active.filter((s: any) => !lastMap.has(s.id));
  if (neverReceived.length) return neverReceived[0];
  return [...active].sort((a: any, b: any) => (lastMap.get(a.id) || 0) - (lastMap.get(b.id) || 0))[0] || null;
}

// ── WhatsApp (3 tentativas, igual rescue/manual-transfer) ────────────────────
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

/** Resolve a instancia: a do agente do lead -> fallback qualquer conectada do dono. */
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

// Leads "ativos" = em atendimento (preserva o estagio do funil ao repassar).
// Parado/frio (inativo, pouco_qualificado) fica de fora -> bolsao (Fase 2).
// fechado/perdido/transferido nunca sao tocados.
const ACTIVE_STATUS = ['novo', 'em_atendimento', 'negociacao', 'agendamento', 'qualificado'];

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
  const dryRun: boolean = body?.dry_run !== false; // default TRUE (seguro)
  const fromMemberId: string | null = body?.from_member_id ? String(body.from_member_id) : null;
  const requestedUserId: string | null = body?.user_id ?? null;
  const force: boolean = body?.force === true;
  const maxLeads: number = Math.min(Number(body?.limit) || 50, 200);
  // Selecao opcional: gerente escolhe quais repassar. Sem isso, repassa todos os ativos.
  const selectedLeadIds: string[] | null =
    Array.isArray(body?.lead_ids) && body.lead_ids.length ? body.lead_ids.map((x: any) => String(x)) : null;

  if (!fromMemberId) return json({ error: 'Informe o vendedor de origem (from_member_id).' }, 400);

  const supabase = createSupabaseClient(supabaseUrl, serviceKey);

  // ── AUTORIZACAO ─────────────────────────────────────────────────────────
  const isServiceCall = !!serviceKey && token === serviceKey;
  let scopeUserId: string | null = null;
  let callerUserId: string | null = null;

  if (isServiceCall) {
    scopeUserId = requestedUserId; // pode ser null = qualquer dono
  } else {
    const authUser = await getAuthUser(supabaseUrl, serviceKey, token);
    if (!authUser?.id) return json({ error: 'Token invalido' }, 401);
    callerUserId = authUser.id;
    const effectiveUserId = await resolveEffectiveUserId(supabase, callerUserId);
    const targetOwner = requestedUserId || effectiveUserId;
    const allowed = await canAccessLeadOwner(supabase, callerUserId, effectiveUserId, targetOwner);
    if (!allowed) return json({ error: 'Sem permissao para repassar leads deste dono' }, 403);
    scopeUserId = targetOwner;
  }

  const nowDate = new Date();
  const window = getRepassWindow(nowDate);
  const dentroDoHorario = isWithinRepassWindow(nowDate);
  const allowLiveNow = dentroDoHorario || (force && !isServiceCall);

  if (!dryRun && !allowLiveNow) {
    const bMin = brasiliaMinutesOfDay(nowDate);
    return json({
      ok: true, dry_run: false, fora_do_horario: true, repassados: 0, janela: window.label,
      message: `Fora do horario de repasse (${window.label}). Hora Brasilia: ${Math.floor(bMin / 60)}:${String(bMin % 60).padStart(2, '0')}. Use a previa agora, ou repasse dentro do horario.`,
    });
  }

  try {
    // Valida o vendedor de origem e resolve o dono
    const { data: fromMember } = await supabase
      .from('ai_team_members').select('id,user_id,name,agent_id').eq('id', fromMemberId).maybeSingle();
    if (!fromMember) return json({ error: 'Vendedor de origem nao encontrado.' }, 404);
    const ownerId: string = fromMember.user_id;
    if (!isServiceCall && scopeUserId && ownerId !== scopeUserId) {
      return json({ error: 'Sem permissao sobre este vendedor.' }, 403);
    }
    const effectiveOwner: string = scopeUserId || ownerId;

    // 1. Leads ATIVOS do vendedor que esta saindo
    let leadQ = supabase
      .from('ai_crm_leads')
      .select('id,user_id,agent_id,lead_name,summary,remote_jid,status,status_crm,assigned_to_id,created_at,last_interaction_at,vehicle_interest')
      .eq('user_id', effectiveOwner)
      .eq('assigned_to_id', fromMemberId)
      .in('status_crm', ACTIVE_STATUS)
      .order('last_interaction_at', { ascending: false })
      .limit(maxLeads);
    if (selectedLeadIds) leadQ = leadQ.in('id', selectedLeadIds);
    const { data: activeLeads, error: leadErr } = await leadQ;
    if (leadErr) throw leadErr;

    // Vendedores ativos do dono, exceto o que esta saindo
    const { data: allSellers } = await supabase
      .from('ai_team_members').select('*')
      .eq('user_id', effectiveOwner).eq('is_active', true)
      .order('last_lead_received_at', { ascending: true, nullsFirst: true }).limit(100);
    const sellers = (allSellers || []).filter((s: any) => s.id !== fromMemberId);

    const report: any[] = [];
    let moved = 0, skippedPending = 0, noSeller = 0, noInstance = 0, sendFailed = 0;

    for (const lead of (activeLeads || [])) {
      // 2. Idempotencia: pula se ja existe transfer 'pending' (motor de timeout cuida)
      const { data: pend } = await supabase
        .from('ai_lead_transfers').select('id')
        .eq('lead_id', lead.id).eq('transfer_status', 'pending').eq('is_confirmed', false).limit(1);
      if (pend && pend.length > 0) { skippedPending++; continue; }

      // 3. Round-robin: prefere vendedores do mesmo agente; fallback qualquer ativo
      const { data: recentTransfers } = await supabase
        .from('ai_lead_transfers').select('to_member_id,created_at')
        .eq('user_id', effectiveOwner).order('created_at', { ascending: false }).limit(100);

      let pool = sellers.filter((s: any) => s.agent_id === lead.agent_id);
      if (!pool.length) pool = sellers;
      const nextSeller = pickNextSeller(pool, recentTransfers || [], fromMemberId);

      if (!nextSeller) {
        noSeller++;
        report.push({ lead_id: lead.id, lead_name: lead.lead_name, acao: 'sem_vendedor', vendedor: null });
        if (!dryRun) {
          await logTransferFailure({
            user_id: effectiveOwner, reason_code: 'sem_vendedor_disponivel', mode: 'pedro',
            lead_id: lead.id, agent_id: lead.agent_id, lead_name: lead.lead_name, remote_jid: lead.remote_jid,
            attempted_transfer: true, source: 'redistribute-seller-leads',
            reason_detail: `Repasse de ${fromMember.name}: nenhum outro vendedor ativo na fila.`,
          });
        }
        continue;
      }

      // 4. DRY-RUN: so relata
      if (dryRun) {
        report.push({ lead_id: lead.id, lead_name: lead.lead_name, acao: 'repassaria', vendedor: nextSeller.name });
        moved++;
        continue;
      }

      // 5. LIVE — resolve instancia -> envia WhatsApp -> so entao atribui firme.
      const instance = await resolveInstance(supabase, lead);
      if (!instance) {
        noInstance++;
        report.push({ lead_id: lead.id, lead_name: lead.lead_name, acao: 'sem_instancia', vendedor: nextSeller.name });
        await logTransferFailure({
          user_id: effectiveOwner, reason_code: 'erro_tecnico', mode: 'pedro',
          lead_id: lead.id, agent_id: lead.agent_id, lead_name: lead.lead_name, remote_jid: lead.remote_jid,
          attempted_transfer: true, source: 'redistribute-seller-leads',
          reason_detail: 'Sem instancia WhatsApp conectada para notificar o vendedor no repasse.',
        });
        continue;
      }

      const phone = String(lead.remote_jid || '').replace(/\D/g, '');
      const briefing = await buildConversationBriefing(supabase, lead);
      const carro = lead.vehicle_interest
        || (String(lead.summary || '').match(/ve[íi]culo de interesse:?\*?\s*([^\n*]{2,80})/i)?.[1]?.trim())
        || 'nao informado';
      const sellerMsg =
        `🔄 *LEAD REPASSADO PRA VOCE — JA ESTA NO SEU CRM*\n\n` +
        `O vendedor *${fromMember.name}* saiu/esta indisponivel e este atendimento passou pra voce. ` +
        `*Continue de onde ele parou* — o cliente ja estava sendo atendido.\n\n` +
        `👤 *Nome:* ${lead.lead_name || 'Nao informado'}\n` +
        (phone ? `📱 *Telefone:* wa.me/${phone}\n` : '') +
        `🚗 *Carro de interesse:* ${carro}\n` +
        `\n📝 *Conversa / contexto:*\n${briefing}\n` +
        (phone ? `\n👉 *Continuar agora:* https://wa.me/${phone}` : '') +
        `\n\n⚡ *Atenda o quanto antes pra nao esfriar o lead!*`;

      const sent = await sendWAMessage(instance, nextSeller.whatsapp_number, sellerMsg);
      if (!sent) {
        sendFailed++;
        report.push({ lead_id: lead.id, lead_name: lead.lead_name, acao: 'falha_envio', vendedor: nextSeller.name });
        await logTransferFailure({
          user_id: effectiveOwner, reason_code: 'erro_tecnico', mode: 'pedro',
          lead_id: lead.id, agent_id: lead.agent_id, lead_name: lead.lead_name, remote_jid: lead.remote_jid,
          attempted_transfer: true, source: 'redistribute-seller-leads',
          reason_detail: `Falha ao enviar WhatsApp de repasse para o vendedor ${nextSeller.name}.`,
        });
        continue;
      }

      // Envio OK -> ATRIBUI firme ao novo vendedor. Transfer 'confirmed' (o
      // timeout-checker so mexe em 'pending', entao nao tira o lead depois).
      // MANTEM o status_crm: o lead estava em atendimento, preserva o estagio do
      // funil pra o novo vendedor continuar. NAO mexe em arrived_at (re-atribuicao,
      // nao trafego pago novo).
      await supabase.from('ai_lead_transfers').insert({
        user_id: effectiveOwner, lead_id: lead.id,
        from_member_id: fromMemberId, to_member_id: nextSeller.id,
        transfer_reason: 'repasse_pedro',
        notes: `Repasse: vendedor ${fromMember.name} saiu/indisponivel (atribuido direto ao novo vendedor).`,
        transfer_status: 'confirmed', is_confirmed: true,
        triggered_by_user_id: callerUserId,
      });
      await supabase.from('ai_crm_leads').update({
        assigned_to_id: nextSeller.id,
        status: 'em_atendimento',
        last_interaction_at: new Date().toISOString(),
      }).eq('id', lead.id);
      await supabase.from('ai_team_members').update({ last_lead_received_at: new Date().toISOString() }).eq('id', nextSeller.id);

      report.push({ lead_id: lead.id, lead_name: lead.lead_name, acao: 'repassado', vendedor: nextSeller.name });
      moved++;
    }

    return json({
      ok: true,
      dry_run: dryRun,
      dentro_do_horario: dentroDoHorario,
      forcado: !dentroDoHorario && force && !isServiceCall,
      janela: window.label,
      de_vendedor: fromMember.name,
      de_vendedor_id: fromMemberId,
      escopo_user_id: effectiveOwner,
      ativos_encontrados: (activeLeads || []).length,
      repassados: moved,
      pulados_com_pending: skippedPending,
      sem_vendedor: noSeller,
      sem_instancia: noInstance,
      falha_envio: sendFailed,
      detalhe: report,
    });
  } catch (err: any) {
    console.error('[Redistribute] Erro critico:', err);
    return json({ error: err.message }, 500);
  }
});
