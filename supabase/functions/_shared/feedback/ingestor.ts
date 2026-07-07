// deno-lint-ignore-file no-explicit-any
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
  vendedor_nome: string | null;
  campanha_id: string | null;
  ad_name: string | null;
  lead_nome: string | null;
  telefone: string | null;
  sinais_estruturados: Record<string, unknown>;
  thread: ThreadMessage[];
  contexto_ia: ThreadMessage[];
}

export function digits(s?: string | null): string {
  return (s || '').replace(/\D/g, '');
}
export function last8(s?: string | null): string {
  return digits(s).slice(-8);
}

async function transcreverAudios(
  admin: SupabaseClient,
  msgs: { id: string; media_url: string }[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!msgs.length) return out;
  const ids = msgs.map((m) => m.id);

  const { data: cached } = await admin
    .from('feedback_transcricoes')
    .select('message_id, texto, ok')
    .in('message_id', ids);
  const jaTem = new Set<string>();
  for (const c of (cached || [])) {
    jaTem.add(c.message_id);
    if (c.ok && c.texto) out.set(c.message_id, c.texto);
  }

  const key = Deno.env.get('OPENAI_API_KEY') || Deno.env.get('OPENAI_KEY');
  if (!key) return out;

  const pend = msgs.filter((m) => !jaTem.has(m.id));
  const CONC = 4;
  for (let i = 0; i < pend.length; i += CONC) {
    const slice = pend.slice(i, i + CONC);
    await Promise.all(slice.map(async (m) => {
      try {
        const audioRes = await fetch(m.media_url);
        if (!audioRes.ok) throw new Error('fetch media ' + audioRes.status);
        const buf = await audioRes.arrayBuffer();
        const ext = (m.media_url.split('?')[0].split('.').pop() || 'ogg').toLowerCase();
        const fname = /^(ogg|oga|mp3|mp4|m4a|wav|webm|mpeg|mpga)$/.test(ext) ? `audio.${ext}` : 'audio.ogg';
        const fd = new FormData();
        fd.append('model', 'whisper-1');
        fd.append('language', 'pt');
        fd.append('file', new Blob([buf]), fname);
        const tr = await fetch('https://api.openai.com/v1/audio/transcriptions', {
          method: 'POST', headers: { Authorization: 'Bearer ' + key }, body: fd,
        });
        if (!tr.ok) throw new Error('whisper ' + tr.status + ' ' + (await tr.text().catch(() => '')));
        const j = await tr.json();
        const texto = String(j?.text || '').trim();
        if (texto) out.set(m.id, texto);
        await admin.from('feedback_transcricoes').upsert(
          { message_id: m.id, texto: texto || null, ok: !!texto },
          { onConflict: 'message_id' },
        );
      } catch (_e) {
        await admin.from('feedback_transcricoes').upsert(
          { message_id: m.id, texto: null, ok: false },
          { onConflict: 'message_id' },
        );
      }
    }));
  }
  return out;
}

export async function buildLeadThread(
  admin: SupabaseClient,
  leadSource: 'pedro' | 'marcos',
  leadId: string,
): Promise<LeadThread | null> {
  const thread: ThreadMessage[] = [];
  const contexto: ThreadMessage[] = [];
  const sinais: Record<string, unknown> = {};
  let tenant = '';
  let vendedor: string | null = null;
  let vendedorNome: string | null = null;
  let campanha: string | null = null;
  let adName: string | null = null;
  let nome: string | null = null;
  let telefone: string | null = null;
  let jid = '';
  let phone8 = '';

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
    telefone = digits(jid.split('@')[0]) || null;
    phone8 = last8(jid.split('@')[0]);
    Object.assign(sinais, {
      trade_in_vehicle: lead.trade_in_vehicle, down_payment: lead.down_payment,
      cpf: lead.cpf, birth_date: lead.birth_date, temperature: lead.temperature,
      vehicle_interest: lead.vehicle_interest, payment_method: lead.payment_method,
      budget: lead.budget, resumo_qualificacao_ia: lead.summary,
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
    telefone = digits(lead.phone) || null;
    phone8 = last8(lead.phone);
    Object.assign(sinais, {
      vehicle_interest: lead.vehicle_interest, consignado_modelo: lead.consignado_modelo,
      custom_fields: lead.custom_fields,
    });
  }

  if (leadSource === 'pedro' && vendedor) {
    const { data: vend } = await admin
      .from('ai_team_members').select('name').eq('id', vendedor).maybeSingle();
    vendedorNome = vend?.name ?? null;
  } else if (vendedor) {
    vendedorNome = vendedor;
  }

  if (jid) {
    const { data: hist } = await admin
      .from('wa_chat_history')
      .select('role, content, created_at')
      .eq('user_id', tenant)
      .eq('remote_jid', jid)
      .order('created_at', { ascending: true });
    for (const m of (hist || [])) {
      if (!m.content) continue;
      contexto.push({
        from: m.role === 'assistant' ? 'ia' : 'cliente',
        texto: m.content, timestamp: m.created_at, canal: 'pedro',
      });
    }
  }

  if (phone8) {
    const { data: inbox } = await admin
      .from('wa_inbox')
      .select('id, direction, content, message_type, media_url, created_at')
      .eq('user_id', tenant)
      .ilike('phone', `%${phone8}`)
      .order('created_at', { ascending: true });

    const audioMsgs = (inbox || [])
      .filter((m: any) => m.message_type === 'audio' && m.media_url)
      .map((m: any) => ({ id: m.id as string, media_url: m.media_url as string }));
    const trans = await transcreverAudios(admin, audioMsgs);

    for (const m of (inbox || [])) {
      let texto: string = m.content || '';
      if (m.message_type === 'audio') {
        const t = trans.get(m.id);
        texto = t ? `🎤 (áudio) ${t}` : (m.media_url ? '[áudio sem transcricao]' : (m.content || ''));
      }
      if (!texto) continue;
      thread.push({
        from: m.direction === 'outgoing' ? 'vendedor' : 'cliente',
        texto, timestamp: m.created_at, canal: 'marcos',
      });
    }
  }

  const byTime = (a: ThreadMessage, b: ThreadMessage) =>
    new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
  thread.sort(byTime);
  contexto.sort(byTime);

  return {
    lead_id: leadId, lead_source: leadSource, tenant_id: tenant,
    vendedor_id: vendedor, vendedor_nome: vendedorNome, campanha_id: campanha, ad_name: adName,
    lead_nome: nome, telefone,
    sinais_estruturados: sinais,
    thread, contexto_ia: contexto,
  };
}
