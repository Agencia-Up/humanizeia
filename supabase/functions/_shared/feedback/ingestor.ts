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

// Limite de tentativas e janela de re-tentativa pra transcricao com falha
// temporaria (UAZAPI/OpenAI instavel, midia ainda propagando). Evita inutilizar
// o audio pra sempre por uma falha unica, sem repetir infinitamente.
const TRANSCRICAO_MAX_TENT = 3;
const TRANSCRICAO_RETRY_APOS_MS = 60 * 60 * 1000; // 1h

async function transcreverAudios(
  admin: SupabaseClient,
  msgs: { id: string; media_url: string }[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!msgs.length) return out;
  const ids = msgs.map((m) => m.id);

  const { data: cached } = await admin
    .from('feedback_transcricoes')
    .select('message_id, texto, ok, tentativas, updated_at')
    .in('message_id', ids);
  const tentMap = new Map<string, number>();
  const jaOk = new Set<string>();       // ja transcrito com sucesso
  const naoRetentar = new Set<string>(); // falhou mas ainda nao pode re-tentar
  for (const c of (cached || [])) {
    tentMap.set(c.message_id, Number((c as any).tentativas) || 0);
    if (c.ok && c.texto) { out.set(c.message_id, c.texto); jaOk.add(c.message_id); continue; }
    // ok=false: so re-tenta se ainda tem tentativa E passou a janela de espera.
    const tent = Number((c as any).tentativas) || 0;
    const upd = (c as any).updated_at;
    const idadeMs = upd ? (Date.now() - new Date(upd).getTime()) : Infinity;
    if (tent >= TRANSCRICAO_MAX_TENT || idadeMs < TRANSCRICAO_RETRY_APOS_MS) naoRetentar.add(c.message_id);
  }

  const key = Deno.env.get('OPENAI_API_KEY') || Deno.env.get('OPENAI_KEY');
  if (!key) return out;

  // Pendentes = nunca tentados + falhas antigas ainda dentro do limite de tentativas.
  const pend = msgs.filter((m) => !jaOk.has(m.id) && !naoRetentar.has(m.id));
  const CONC = 4;
  for (let i = 0; i < pend.length; i += CONC) {
    const slice = pend.slice(i, i + CONC);
    await Promise.all(slice.map(async (m) => {
      const tentAtual = (tentMap.get(m.id) || 0) + 1;
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
          { message_id: m.id, texto: texto || null, ok: !!texto, tentativas: tentAtual,
            erro: texto ? null : 'transcricao vazia', updated_at: new Date().toISOString() },
          { onConflict: 'message_id' },
        );
      } catch (e) {
        // Falha temporaria (UAZAPI/OpenAI/midia expirada): conta a tentativa e
        // registra o erro; NAO bloqueia a analise (o audio vira "[sem transcricao]").
        await admin.from('feedback_transcricoes').upsert(
          { message_id: m.id, texto: null, ok: false, tentativas: tentAtual,
            erro: String((e as any)?.message || e).slice(0, 300), updated_at: new Date().toISOString() },
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

  // Resolve o NOME real do vendedor. assigned_to (Marcos) pode ser UUID ou texto
  // legado; assigned_to_id (Pedro) e UUID. Se parecer UUID, busca em
  // ai_team_members; senao mantem o texto (fallback legado). Nunca mostra UUID.
  if (vendedor) {
    const looksUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(vendedor);
    if (looksUuid) {
      const { data: vend } = await admin
        .from('ai_team_members').select('name').eq('id', vendedor).maybeSingle();
      vendedorNome = vend?.name ?? null;
    } else {
      vendedorNome = vendedor; // texto legado (ja e nome)
    }
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

  // Busca as mensagens do atendimento humano (wa_inbox) casando o numero NACIONAL
  // COMPLETO (DDD+numero), nao so os ultimos 8 digitos — evita misturar leads de
  // DDDs diferentes com final igual. Fallback last-8 e controlado e logado.
  const phoneNat = telefone
    ? (telefone.startsWith('55') && telefone.length > 11 ? telefone.slice(2) : telefone)
    : '';
  if (phoneNat.length >= 10) {
    // Quais instancias sao da IA (seller_member_id null) nesta conta — pra separar
    // mensagem da IA de mensagem do vendedor humano.
    const { data: insts } = await admin
      .from('wa_instances').select('id, seller_member_id').eq('user_id', tenant);
    const iaInstances = new Set((insts || []).filter((i: any) => !i.seller_member_id).map((i: any) => i.id));

    const cols = 'id, instance_id, direction, content, message_type, media_url, created_at';
    let inbox: any[] | null = null;
    {
      const { data } = await admin.from('wa_inbox').select(cols)
        .eq('user_id', tenant).ilike('phone', `%${phoneNat}`)
        .order('created_at', { ascending: true });
      inbox = data as any[] | null;
    }
    // Fallback controlado: match preciso vazio -> tenta ultimos 8 (numeros legados). Logado.
    if ((!inbox || inbox.length === 0) && phone8) {
      const { data: fb } = await admin.from('wa_inbox').select(cols)
        .eq('user_id', tenant).ilike('phone', `%${phone8}`)
        .order('created_at', { ascending: true });
      if (fb && fb.length) {
        console.warn(`[feedback-ingestor] lead ${leadId}: match preciso (${phoneNat}) vazio; fallback last-8 (${fb.length} msgs)`);
        inbox = fb as any[];
      }
    }

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
      // Separa IA / vendedor / cliente: mensagem enviada por instancia DA IA
      // (seller_member_id null) NAO e avaliada como vendedor humano — vira contexto.
      if (m.direction === 'outgoing') {
        if (iaInstances.has(m.instance_id)) {
          contexto.push({ from: 'ia', texto, timestamp: m.created_at, canal: 'marcos' });
        } else {
          thread.push({ from: 'vendedor', texto, timestamp: m.created_at, canal: 'marcos' });
        }
      } else {
        thread.push({ from: 'cliente', texto, timestamp: m.created_at, canal: 'marcos' });
      }
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
