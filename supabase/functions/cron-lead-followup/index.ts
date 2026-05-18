// ─── Inline PostgREST client (no external imports) ──────────────────────────
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
    let _returnSelect: string | null = null; // for update().select()

    const builder = {
      select(cols?: string) {
        if (_method === 'PATCH') {
          // .update(data).select('id') → return representation with select
          _returnSelect = cols || '*';
          return builder;
        }
        _select = cols || '*';
        return builder;
      },
      eq(col: string, val: any) {
        _filters.push({ col, op: 'eq', val: String(val) });
        return builder;
      },
      lte(col: string, val: any) {
        _filters.push({ col, op: 'lte', val: String(val) });
        return builder;
      },
      gt(col: string, val: any) {
        _filters.push({ col, op: 'gt', val: String(val) });
        return builder;
      },
      is(col: string, val: any) {
        _filters.push({ col, op: 'is', val: String(val) });
        return builder;
      },
      not(col: string, op: string, val: any) {
        _filters.push({ col, op: `not.${op}`, val: String(val) });
        return builder;
      },
      in(col: string, vals: any[]) {
        const list = vals.map((v: any) => `"${v}"`).join(',');
        _filters.push({ col, op: 'in', val: `(${list})` });
        return builder;
      },
      order(column: string, opts?: { ascending?: boolean; nullsFirst?: boolean }) {
        _orders.push({
          column,
          ascending: opts?.ascending ?? true,
          nullsFirst: opts?.nullsFirst ?? false,
        });
        return builder;
      },
      limit(n: number) {
        _limit = n;
        return builder;
      },
      maybeSingle() {
        _maybeSingle = true;
        return builder._execute();
      },
      update(data: any) {
        _method = 'PATCH';
        _body = data;
        return builder;
      },
      insert(data: any) {
        _method = 'POST';
        _body = data;
        return builder._execute();
      },
      then(resolve: (v: any) => void, reject?: (e: any) => void) {
        return builder._execute().then(resolve, reject);
      },
      async _execute(): Promise<{ data: any; error: any }> {
        const params = new URLSearchParams();

        // select param
        const selectVal = _method === 'PATCH' ? (_returnSelect || undefined) : (_select || '*');
        if (selectVal) params.set('select', selectVal);

        // filters
        for (const f of _filters) {
          params.append(f.col, `${f.op}.${f.val}`);
        }

        // order
        for (const o of _orders) {
          let orderStr = o.column;
          if (!o.ascending) orderStr += '.desc';
          else orderStr += '.asc';
          if (o.nullsFirst) orderStr += '.nullsfirst';
          else orderStr += '.nullslast';
          params.append('order', orderStr);
        }

        // limit
        if (_limit !== null) {
          params.set('limit', String(_limit));
        }

        const queryStr = params.toString();
        const urlStr = `${restBase}/${table}${queryStr ? '?' + queryStr : ''}`;

        const headers: Record<string, string> = { ...baseHeaders };

        if (_method === 'PATCH' && _returnSelect) {
          headers['Prefer'] = 'return=representation';
        }
        if (_method === 'POST') {
          headers['Prefer'] = 'return=minimal';
        }
        if (_maybeSingle) {
          headers['Accept'] = 'application/vnd.pgrst.object+json';
        }

        try {
          const res = await fetch(urlStr, {
            method: _method,
            headers,
            body: _body ? JSON.stringify(_body) : undefined,
          });

          if (_maybeSingle && res.status === 406) {
            return { data: null, error: null };
          }

          if (!res.ok) {
            const errBody = await res.text();
            return { data: null, error: { message: errBody, status: res.status } };
          }

          if (_method === 'POST' && !_returnSelect) {
            return { data: null, error: null };
          }

          const contentType = res.headers.get('content-type') || '';
          if (!contentType.includes('json')) {
            return { data: null, error: null };
          }

          const data = await res.json();
          return { data, error: null };
        } catch (err: any) {
          return { data: null, error: { message: err.message } };
        }
      },
    };

    return builder;
  }

  return {
    from(table: string) {
      return buildQuery(table);
    },
  };
}

// ─── CORS headers ───────────────────────────────────────────────────────────
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const FIVE_MIN_MESSAGES = [
  "Oie, voce ainda esta por ai? Posso te ajudar com mais alguma duvida?",
  "Tudo certo por ai? Se precisar de mais alguma informacao, e so me falar!",
  "Ainda tem interesse? Estou aqui se precisar de ajuda com os detalhes!"
];

async function sendUazapiTextMessage(baseUrl: string, instKey: string, instanceName: string, phoneNumber: string, remoteJid: string, text: string) {
  const attempts = [
    { label: 'send-text-number', url: `${baseUrl}/send/text`, body: { number: phoneNumber, text } },
    { label: 'send-text-remotejid', url: `${baseUrl}/send/text`, body: { remoteJid, text } },
    { label: 'message-sendText', url: `${baseUrl}/message/sendText/${instanceName}`, body: { number: phoneNumber, text } }
  ];

  for (const attempt of attempts) {
    try {
      const res = await fetch(attempt.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'token': instKey, 'apikey': instKey },
        body: JSON.stringify(attempt.body),
      });
      if (res.ok) return true;
    } catch (err) {
      // continua tentando
    }
  }
  return false;
}

function sellerPhoneKey(seller: any): string {
  const digits = String(seller?.whatsapp_number || '').replace(/\D/g, '');
  const local = digits.startsWith('55') && digits.length >= 12 ? digits.slice(2) : digits;
  if (local.length === 11 && local[2] === '9') return `${local.slice(0, 2)}${local.slice(3)}`;
  return local.slice(-10);
}

function uniqueSellersByPhone(sellers: any[] = [], excludeId?: string, excludePhoneKey?: string): any[] {
  const seenPhones = new Set<string>();
  return sellers.filter((seller) => {
    const phoneKey = sellerPhoneKey(seller);
    if (!seller.is_active || seller.id === excludeId || (excludePhoneKey && phoneKey === excludePhoneKey)) return false;
    if (phoneKey && seenPhones.has(phoneKey)) return false;
    if (phoneKey) seenPhones.add(phoneKey);
    return true;
  });
}

// ── Horario operacional de repasse (Brasilia) ────────────────────────────────
// Seg-Sab: 10:11 - 19:29 | Dom/Feriado: 11:11 - 17:29
// Leads criados fora da janela NAO entram no rodizio de repasse.
// Ao entrar no horario, leads da noite NAO sao repassados retroativamente.

function brasiliaMinOfDay(dt: Date): number {
  const nowBrasilia = new Date(dt.getTime() - 3 * 60 * 60 * 1000);
  return nowBrasilia.getUTCHours() * 60 + nowBrasilia.getUTCMinutes();
}

function toBrasilia(dt: Date): Date {
  return new Date(dt.getTime() - 3 * 60 * 60 * 1000);
}

// ── Pascoa (algoritmo Computus) e feriados nacionais ─────────────────────────
function getEasterDate(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

function getBrazilianHolidays(year: number): Set<string> {
  const holidays = new Set<string>();
  const fmt = (d: Date) =>
    `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400000);

  holidays.add(`${year}-01-01`); // Confraternizacao Universal
  holidays.add(`${year}-04-21`); // Tiradentes
  holidays.add(`${year}-05-01`); // Dia do Trabalho
  holidays.add(`${year}-09-07`); // Independencia
  holidays.add(`${year}-10-12`); // Nossa Sra. Aparecida
  holidays.add(`${year}-11-02`); // Finados
  holidays.add(`${year}-11-15`); // Proclamacao da Republica
  holidays.add(`${year}-12-25`); // Natal

  const easter = getEasterDate(year);
  holidays.add(fmt(addDays(easter, -48))); // Segunda de Carnaval
  holidays.add(fmt(addDays(easter, -47))); // Terca de Carnaval
  holidays.add(fmt(addDays(easter, -2)));  // Sexta-feira Santa
  holidays.add(fmt(addDays(easter, 60)));  // Corpus Christi

  return holidays;
}

function isDomingoOuFeriado(dt: Date): boolean {
  const brasilia = toBrasilia(dt);
  if (brasilia.getUTCDay() === 0) return true;
  const year = brasilia.getUTCFullYear();
  const dateStr = `${year}-${String(brasilia.getUTCMonth() + 1).padStart(2, '0')}-${String(brasilia.getUTCDate()).padStart(2, '0')}`;
  return getBrazilianHolidays(year).has(dateStr);
}

// Seg-Sex: 10:11-19:29 | Sab: 10:11-18:29 | Dom/Feriado: 11:11-17:29
function getRepassWindow(dt: Date): { start: number; end: number; label: string } {
  const brasilia = toBrasilia(dt);
  const dow = brasilia.getUTCDay(); // 0=dom, 6=sab

  if (dow === 0 || isDomingoOuFeriado(dt)) {
    return { start: 11 * 60 + 11, end: 17 * 60 + 29, label: '11:11-17:29 (dom/feriado)' };
  }
  if (dow === 6) {
    return { start: 10 * 60 + 11, end: 18 * 60 + 29, label: '10:11-18:29 (sabado)' };
  }
  return { start: 10 * 60 + 11, end: 19 * 60 + 29, label: '10:11-19:29 (seg-sex)' };
}

/**
 * Verifica se o horario atual esta dentro da janela de rodizio vendedor -> vendedor.
 * Seg-Sab: 10:11-19:29 | Dom/Feriado: 11:11-17:29
 * A transferencia inicial do lead para o primeiro vendedor segue ativa 24h.
 */
function isDentroDoHorarioOperacional(now: Date): boolean {
  const minutosDoDia = brasiliaMinOfDay(now);
  const hora = Math.floor(minutosDoDia / 60);
  const minuto = minutosDoDia % 60;
  const { start, end, label } = getRepassWindow(now);
  const ativo = minutosDoDia >= start && minutosDoDia <= end;
  console.log(`[Cron] Hora Brasilia: ${hora}:${String(minuto).padStart(2, '0')} | Horario operacional: ${ativo ? 'SIM' : 'NAO'} (${label})`);
  return ativo;
}

/** Verifica se um transfer foi CRIADO dentro da janela de repasse do dia em questao */
function transferCriadoNoHorario(createdAt: string): boolean {
  const dt = new Date(createdAt);
  const min = brasiliaMinOfDay(dt);
  const { start, end } = getRepassWindow(dt);
  return min >= start && min <= end;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createSupabaseClient(supabaseUrl, supabaseKey)

    const now = new Date();
    const fiveMinsAgo = new Date(now.getTime() - 5 * 60000).toISOString();
    const tenMinsAgo = new Date(now.getTime() - 10 * 60000).toISOString();

    console.log(`[Cron] Iniciando varredura. Agora: ${now.toISOString()} | 5m ago: ${fiveMinsAgo} | 10m ago: ${tenMinsAgo}`);

    const operacional = isDentroDoHorarioOperacional(now);

    // ════════════════════════════════════════════════════════════════
    // SECAO 1: ROTATIVIDADE DE VENDEDORES (transferencia pendente > 10 min)
    // REGRA: O vendedor tem 10 minutos para responder "Ok" a partir do momento
    //        em que RECEBEU a notificacao (ai_lead_transfers.created_at).
    //        Usa ai_lead_transfers como fonte de verdade, NAO last_interaction_at.
    //        So executa dentro do horario operacional (10:10 - 21:30 Brasilia).
    // ════════════════════════════════════════════════════════════════
    if (operacional) {
      // Buscar transferencias pendentes onde o vendedor NAO confirmou em 10 minutos
      const { data: pendingTransfers } = await supabase
        .from('ai_lead_transfers')
        .select('*, lead:ai_crm_leads(*, wa_ai_agents!ai_crm_leads_agent_id_fkey(id, name, instance_id, instance_ids))')
        .eq('is_confirmed', false)
        .eq('transfer_status', 'pending')
        .lte('created_at', tenMinsAgo); // A notificacao foi criada ha mais de 10 minutos

      if (pendingTransfers && pendingTransfers.length > 0) {
        console.log(`[Cron] Encontradas ${pendingTransfers.length} transferencias pendentes ha mais de 10 min.`);
        const { data: allInstances } = await supabase.from('wa_instances').select('*');

        for (const transfer of pendingTransfers) {
          const lead = transfer.lead;
          if (!lead) {
            console.warn(`[Cron] Transferencia ${transfer.id} sem lead associado. Pulando.`);
            continue;
          }

          // ── Regra de horario: so repassa se o transfer foi CRIADO dentro de
          //    10:11-19:29 Brasilia. Leads da noite ficam com o vendedor. ─────
          if (!transferCriadoNoHorario(transfer.created_at)) {
            console.log(`[Cron] Transfer ${transfer.id} criado fora do horario de repasse (${transfer.created_at}). Auto-confirmando - lead fica com vendedor atual.`);
            await supabase.from('ai_lead_transfers')
              .update({ transfer_status: 'confirmed', is_confirmed: true })
              .eq('id', transfer.id);
            continue;
          }

          // Verificar se o lead ainda esta 'qualificado' (vendedor pode ter confirmado manualmente)
          const { data: freshLead } = await supabase
            .from('ai_crm_leads')
            .select('id, status, assigned_to_id')
            .eq('id', lead.id)
            .maybeSingle();

          // ── DEFESA EM PROFUNDIDADE 1: pula se status já mudou ──
          if (!freshLead || (freshLead.status !== 'qualificado' && freshLead.status !== 'transferido')) {
            console.log(`[Cron] Lead ${lead.id} nao esta mais qualificado/transferido (status: ${freshLead?.status}). Marcando transferencia como expirada e pulando.`);
            await supabase.from('ai_lead_transfers')
              .update({ transfer_status: 'expired' })
              .eq('id', transfer.id);
            continue;
          }

          // ── DEFESA EM PROFUNDIDADE 2: se status='em_atendimento' OU já tem transfer mais novo CONFIRMADO ─
          // Cobre o caso "vendedor confirmou mas webhook falhou em algum step":
          // se existe um transfer pra esse lead criado DEPOIS de transfer.created_at com is_confirmed=true,
          // significa que houve confirmação posterior e este transfer já é stale.
          const { data: newerConfirmed } = await supabase
            .from('ai_lead_transfers')
            .select('id, to_member_id, created_at, is_confirmed, transfer_status')
            .eq('lead_id', lead.id)
            .gt('created_at', transfer.created_at)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (newerConfirmed && (newerConfirmed.is_confirmed || newerConfirmed.transfer_status === 'confirmed')) {
            console.log(`[Cron] Lead ${lead.id} tem transfer mais novo confirmado (${newerConfirmed.id} → ${newerConfirmed.to_member_id}). Pulando este transfer e marcando como expirado.`);
            await supabase.from('ai_lead_transfers')
              .update({ transfer_status: 'expired' })
              .eq('id', transfer.id);
            continue;
          }

          // ── DEFESA EM PROFUNDIDADE 3: se vendedor atual já recebeu OUTRO lead depois de transfer.created_at ─
          // Sinal de atividade — vendedor está ativo no sistema, não está "inativo".
          if (transfer.to_member_id) {
            const { data: currentSeller } = await supabase
              .from('ai_team_members')
              .select('last_lead_received_at, name')
              .eq('id', transfer.to_member_id)
              .maybeSingle();
            if (currentSeller?.last_lead_received_at && new Date(currentSeller.last_lead_received_at) > new Date(transfer.created_at)) {
              console.log(`[Cron] Vendedor ${currentSeller.name} já recebeu lead mais novo (${currentSeller.last_lead_received_at}) — está ativo, não repassar. Marcando transfer como confirmed.`);
              await supabase.from('ai_lead_transfers')
                .update({ transfer_status: 'confirmed', is_confirmed: true, confirmed_at: now.toISOString() })
                .eq('id', transfer.id);
              continue;
            }
          }

          const agentId = lead.agent_id;
          const currentSellerId = transfer.to_member_id;

          // Marcar a transferencia atual como expirada ATOMICAMENTE antes de repassar
          const { data: expireResult } = await supabase
            .from('ai_lead_transfers')
            .update({ transfer_status: 'expired' })
            .eq('id', transfer.id)
            .eq('transfer_status', 'pending') // SO expira se ainda for pending
            .select('id');

          if (!expireResult || expireResult.length === 0) {
            console.log(`[Cron] Transferencia ${transfer.id} ja foi processada por outro worker. Pulando.`);
            continue;
          }

          // Buscar TODOS os vendedores (inclusive o atual, para poder notifica-lo)
          let { data: teamMembers } = await supabase
            .from('ai_team_members')
            .select('*')
            .eq('user_id', lead.user_id)
            .eq('is_active', true)
            .eq('agent_id', agentId)
            .order('last_lead_received_at', { ascending: true, nullsFirst: true })
            .limit(50);

          if (!teamMembers || teamMembers.length === 0) {
            const { data: fallbackTeamMembers } = await supabase
              .from('ai_team_members')
              .select('*')
              .eq('user_id', lead.user_id)
              .eq('is_active', true)
              .order('last_lead_received_at', { ascending: true, nullsFirst: true })
              .limit(50);
            teamMembers = fallbackTeamMembers;
          }

          // ── Notifica o vendedor que PERDEU o lead ──────────────────────
          const expiredSeller = (teamMembers || []).find((m: any) => m.id === currentSellerId);
          if (expiredSeller?.whatsapp_number) {
            const agentData = lead.wa_ai_agents;
            let targetInstanceId = agentData?.instance_id;
            if (!targetInstanceId && agentData?.instance_ids?.length > 0) targetInstanceId = agentData.instance_ids[0];
            const expiredInstance = allInstances?.find((i: any) => i.id === targetInstanceId);

            if (expiredInstance) {
              const expBaseUrl = expiredInstance.api_url?.replace(/\/$/, '');
              const expInstKey = expiredInstance.api_key_encrypted || expiredInstance.api_key;
              let expSellerNum = expiredSeller.whatsapp_number.replace(/\D/g, '');
              if (expSellerNum.length === 10 || expSellerNum.length === 11) expSellerNum = `55${expSellerNum}`;

              const missedMsg = `*LEAD REPASSADO*\n\nO lead *${lead.lead_name || 'Desconhecido'}* nao teve sua confirmacao dentro de 10 minutos e foi passado para o proximo da fila.\n\n*Por favor, NAO entre em contato com este cliente.*`;

              await sendUazapiTextMessage(expBaseUrl, expInstKey, expiredInstance.instance_name, expSellerNum, `${expSellerNum}@s.whatsapp.net`, missedMsg);
              console.log(`[Cron] Aviso enviado para ${expiredSeller.name} (perdeu o lead por inatividade).`);
            }
          }

          const availableSellers = uniqueSellersByPhone(
            teamMembers || [],
            currentSellerId,
            sellerPhoneKey({ whatsapp_number: expiredSeller?.whatsapp_number })
          );

          if (availableSellers.length === 0) {
            console.log(`[Cron] Nenhum outro vendedor disponivel para o agente ${agentId}. Lead ${lead.id} permanece com vendedor atual.`);
            // Repassar de volta para o mesmo (sem outros disponiveis)
            await supabase.from('ai_lead_transfers')
              .update({ transfer_status: 'pending' })
              .eq('id', transfer.id);
            continue;
          }

          const nextSeller = availableSellers[0];
          console.log(`[Cron] Repassando lead ${lead.id} de ${expiredSeller?.name || currentSellerId} para ${nextSeller.name} (nao respondeu em 10min).`);

          // Atualizar lead com novo vendedor
          await supabase.from('ai_crm_leads').update({
            assigned_to_id: null,
            status: 'transferido',
          }).eq('id', lead.id).in('status', ['qualificado', 'transferido']);

          // Atualizar timestamp do novo vendedor
          await supabase.from('ai_team_members').update({
            last_lead_received_at: now.toISOString(),
          }).eq('id', nextSeller.id);

          // Criar nova transferencia para o proximo vendedor
          await supabase.from('ai_lead_transfers').insert({
            user_id: lead.user_id,
            lead_id: lead.id,
            from_member_id: currentSellerId,
            to_member_id: nextSeller.id,
            transfer_reason: 'Rodizio por Inatividade do Vendedor (10min)',
            notes: `Repassado de ${currentSellerId} para ${nextSeller.name} por falta de resposta em 10 minutos`,
            transfer_status: 'pending',
            is_confirmed: false,
            confirmation_timeout_at: new Date(now.getTime() + 15 * 60000).toISOString(),
          });

          // Notificar proximo vendedor
          const agentData = lead.wa_ai_agents;
          let targetInstanceId = agentData?.instance_id;
          if (!targetInstanceId && agentData?.instance_ids?.length > 0) targetInstanceId = agentData.instance_ids[0];
          const instance = allInstances?.find((i: any) => i.id === targetInstanceId);

          if (instance && nextSeller.whatsapp_number) {
            const baseUrl = instance.api_url?.replace(/\/$/, '');
            const instKey = instance.api_key_encrypted || instance.api_key;
            const cleanSellerNum = nextSeller.whatsapp_number.replace(/\D/g, '');
            const phoneNumber = lead.remote_jid.split('@')[0];

            // Gerar resumo para o proximo vendedor
            let aiGeneratedSummary = lead.summary || 'Lead qualificado aguardando atendimento.';
            try {
              const { data: fullChat } = await supabase
                .from('wa_chat_history')
                .select('role, content, created_at')
                .eq('agent_id', agentId)
                .eq('remote_jid', lead.remote_jid)
                .order('created_at', { ascending: false })
                .limit(20);

              const openaiApiKey = Deno.env.get('OPENAI_API_KEY');
              if (openaiApiKey && fullChat && fullChat.length > 0) {
                const chatTranscript = fullChat.reverse().map((m: any) =>
                  `${m.role === 'user' ? `Cliente (${lead.lead_name || 'Desconhecido'})` : 'Agente IA'}: ${String(m.content || '').substring(0, 400)}`
                ).join('\n');

                const summaryRes = await fetch('https://api.openai.com/v1/chat/completions', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openaiApiKey}` },
                  body: JSON.stringify({
                    model: 'gpt-4o-mini',
                    temperature: 0.3,
                    messages: [
                      { role: 'system', content: `Gere um briefing curto e objetivo para um vendedor de carros que esta recebendo um lead repassado. Inclua: veiculo de interesse, perfil do cliente e dica de abordagem. Maximo 5 linhas.` },
                      { role: 'user', content: `Conversa:\n${chatTranscript}\n\nGere o briefing.` }
                    ]
                  })
                });
                if (summaryRes.ok) {
                  const sd = await summaryRes.json();
                  const gt = sd.choices?.[0]?.message?.content;
                  if (gt) aiGeneratedSummary = gt;
                }
              }
            } catch (e) { /* silencioso */ }

            const notificationMsg = `*LEAD REPASSADO (Vendedor anterior nao respondeu em 10min)*\n\n*Nome:* ${lead.lead_name || 'Desconhecido'}\n*Numero:* +${phoneNumber}\n*Agente IA:* ${agentData?.name || 'Assistente'}\n\n--------------------\n*ANALISE DO LEAD PELA IA:*\n${aiGeneratedSummary}\n\n--------------------\n\n*Atender agora:* https://wa.me/${phoneNumber}\n\n*Responda "Ok" para assumir este atendimento!*`;

            await sendUazapiTextMessage(baseUrl, instKey, instance.instance_name, cleanSellerNum, `${cleanSellerNum}@s.whatsapp.net`, notificationMsg);
            console.log(`[Cron] Notificacao enviada para ${nextSeller.name}.`);
          }
        }
      } else {
        console.log('[Cron] Nenhuma transferencia pendente com timeout.');
      }
    } else {
      console.log('[Cron] Fora do horario operacional. Secao 1 (rodizio) ignorada.');
    }

    // ════════════════════════════════════════════════════════════════
    // SECAO 2: FOLLOW-UP + TRANSFERENCIA POR INATIVIDADE DO CLIENTE
    // 5 min -> ping de follow-up (funciona 24h)
    // 10 min -> transferencia para vendedor (so dentro do horario operacional)
    // ════════════════════════════════════════════════════════════════
    const { data: leads, error } = await supabase
      .from('ai_crm_leads')
      .select('*, wa_ai_agents!ai_crm_leads_agent_id_fkey(id, name, instance_id, instance_ids)')
      .in('status', ['novo', 'interessado'])
      .is('assigned_to_id', null)
      .not('last_agent_reply_at', 'is', null)
      .not('last_user_reply_at', 'is', null)
      .lte('last_agent_reply_at', fiveMinsAgo);

    if (error) throw error;
    if (!leads || leads.length === 0) {
      console.log('[Cron] Nenhum lead inativo encontrado.');
      return new Response(JSON.stringify({ message: "Nenhum lead inativo." }), { headers: corsHeaders, status: 200 });
    }

    console.log(`[Cron] Encontrados ${leads.length} leads inativos. Processando...`);
    const { data: instances } = await supabase.from('wa_instances').select('*');

    let processed5Min = 0;
    let processed10Min = 0;

    for (const lead of leads) {
      // Ignorar se o usuario falou depois do agente
      if (new Date(lead.last_user_reply_at) >= new Date(lead.last_agent_reply_at)) continue;

      const agentData = lead.wa_ai_agents;
      let targetInstanceId = agentData?.instance_id;
      if (!targetInstanceId && agentData?.instance_ids?.length > 0) targetInstanceId = agentData.instance_ids[0];

      const instance = instances?.find((i: any) => i.id === targetInstanceId);
      if (!instance) continue;

      const baseUrl = instance.api_url?.replace(/\/$/, '');
      const instKey = instance.api_key_encrypted || instance.api_key;
      const instanceName = instance.instance_name;
      const remoteJid = lead.remote_jid;
      const phoneNumber = remoteJid.split('@')[0];
      const agentId = lead.agent_id;

      const is10MinPassed = new Date(lead.last_agent_reply_at) <= new Date(tenMinsAgo);

      if (is10MinPassed) {
        // --- REGRA DE 10 MINUTOS: TRANSFERENCIA PARA VENDEDOR (Funciona 24/7) ---
        // Sempre envia o lead inicial para o funil do vendedor, independente do horario.
        const { data: updatedRows, error: updateError } = await supabase
          .from('ai_crm_leads')
          .update({
            status: 'transferido',
            status_crm: 'inativo',
            last_interaction_at: now.toISOString()
          })
          .in('status', ['novo', 'interessado'])
          .eq('id', lead.id)
          .select('id');

        if (updateError || !updatedRows || updatedRows.length === 0) {
          console.log(`[Cron] Lead ${phoneNumber} ja foi processado. Pulando.`);
          continue;
        }

        console.log(`[Cron] Lead ${phoneNumber} inativo ha 10 min. Status CRM -> inativo. Buscando vendedor...`);

        let { data: teamMembers } = await supabase
          .from('ai_team_members')
          .select('*')
          .eq('user_id', lead.user_id)
          .eq('is_active', true)
          .eq('agent_id', agentId)
          .order('last_lead_received_at', { ascending: true, nullsFirst: true })
          .limit(50);

        if (!teamMembers || teamMembers.length === 0) {
          const { data: fallbackTeamMembers } = await supabase
            .from('ai_team_members')
            .select('*')
            .eq('user_id', lead.user_id)
            .eq('is_active', true)
            .order('last_lead_received_at', { ascending: true, nullsFirst: true })
            .limit(50);
          teamMembers = fallbackTeamMembers;
        }

        let selectedSellerId = null;
        let sellerName = 'Especialista';
        const availableSellers = uniqueSellersByPhone(teamMembers || []);

        if (availableSellers.length > 0) {
          let seller = availableSellers[0];
          const { data: previousLeadSeller } = await supabase
            .from('ai_crm_leads')
            .select('assigned_to_id')
            .eq('user_id', lead.user_id)
            .eq('remote_jid', lead.remote_jid)
            .not('assigned_to_id', 'is', null)
            .order('last_interaction_at', { ascending: false, nullsFirst: false })
            .limit(1)
            .maybeSingle();
          const previousSeller = availableSellers.find((member: any) => member.id === previousLeadSeller?.assigned_to_id);
          if (previousSeller) {
            seller = previousSeller;
            console.log(`[Cron] Lead recorrente ${phoneNumber}. Mantendo vendedor anterior: ${seller.name}`);
          }
          selectedSellerId = seller.id;
          sellerName = seller.name;

          // ─── GERA O BRIEFING RICO DA IA ANTES DE QUALQUER COISA ─────────
          // (antes ficava DEPOIS do insert, então o CRM nunca recebia o
          // texto rico — só o "via cron" curto. Agora geramos primeiro
          // e gravamos no notes E no summary.)
          const { data: fullChat } = await supabase
            .from('wa_chat_history')
            .select('role, content, created_at')
            .eq('agent_id', agentId)
            .eq('remote_jid', remoteJid)
            .order('created_at', { ascending: false })
            .limit(20);

          let aiGeneratedSummary = lead.summary || 'O cliente demonstrou interesse e parou de responder durante a conversa.';
          try {
            const openaiApiKey = Deno.env.get('OPENAI_API_KEY');
            if (openaiApiKey && fullChat && fullChat.length > 0) {
              const chatTranscript = fullChat.reverse().map((m: any) =>
                `${m.role === 'user' ? `Cliente (${lead.lead_name || 'Desconhecido'})` : 'Agente IA'}: ${String(m.content || '').substring(0, 400)}`
              ).join('\n');

              const summaryRes = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openaiApiKey}` },
                body: JSON.stringify({
                  model: 'gpt-4o-mini',
                  temperature: 0.3,
                  messages: [
                    { role: 'system', content: `Voce e um analista de vendas especialista em mercado automotivo. Gere um briefing objetivo para o vendedor humano que vai assumir o atendimento. O cliente parou de responder.\n\nSecoes obrigatorias:\n*VEICULO DE INTERESSE:*\n*ORIGEM DO LEAD:*\n*PERFIL DO CLIENTE:*\n*DICA PARA RETOMADA:*\n\nSeja direto. Nao invente informacoes.` },
                    { role: 'user', content: `Conversa:\n${chatTranscript}\n\nGere o briefing.` }
                  ]
                })
              });
              if (summaryRes.ok) {
                const sd = await summaryRes.json();
                const gt = sd.choices?.[0]?.message?.content;
                if (gt) aiGeneratedSummary = gt;
              }
            }
          } catch (e) { /* silencioso */ }

          await supabase.from('ai_crm_leads').update({
            status: 'transferido',
            status_crm: 'inativo',
            assigned_to_id: null,
            followup_5min_sent: true,
            last_interaction_at: now.toISOString(),
            summary: aiGeneratedSummary, // ← grava o resumo rico no lead
          }).eq('id', lead.id);

          await supabase.from('ai_lead_transfers').insert({
            user_id: lead.user_id,
            lead_id: lead.id,
            to_member_id: seller.id,
            transfer_reason: 'Inatividade do cliente (10 minutos)',
            notes: aiGeneratedSummary, // ← grava o resumo rico na transferência
            transfer_status: 'pending',
            is_confirmed: false,
            confirmation_timeout_at: new Date(now.getTime() + 15 * 60000).toISOString(),
          });

          await supabase.from('ai_team_members').update({
            last_lead_received_at: now.toISOString(),
          }).eq('id', seller.id);

          if (seller.whatsapp_number) {
            const cleanSellerNum = seller.whatsapp_number.replace(/\D/g, '');

            const notificationMsg = `*NOVO LEAD INATIVO (Sem resposta 10min)*\n\n*Cliente:* ${lead.lead_name || 'Desconhecido'}\n*Contato:* +${phoneNumber}\n*Agente IA:* ${agentData?.name || 'Agente'}\n\n--------------------\n*ANALISE DO LEAD PELA IA:*\n${aiGeneratedSummary}\n\n--------------------\n\n*Atender agora:* https://wa.me/${phoneNumber}\n\n*Responda "Ok" para assumir este atendimento!*`;

            await sendUazapiTextMessage(baseUrl, instKey, instanceName, cleanSellerNum, `${cleanSellerNum}@s.whatsapp.net`, notificationMsg);
          }
        }
        // Mensagem de despedida para o cliente
        const byeMsg = "Estarei te transferindo para um dos nossos especialistas em vendas!";
        await sendUazapiTextMessage(baseUrl, instKey, instanceName, phoneNumber, remoteJid, byeMsg);
        processed10Min++;

      } else if (!lead.followup_5min_sent) {
        // --- REGRA DE 5 MINUTOS (FOLLOW-UP) — Funciona 24h ---
        console.log(`[Cron] Lead ${phoneNumber} inativo ha 5 min. Enviando ping...`);
        const randomMsg = FIVE_MIN_MESSAGES[Math.floor(Math.random() * FIVE_MIN_MESSAGES.length)];

        const sent = await sendUazapiTextMessage(baseUrl, instKey, instanceName, phoneNumber, remoteJid, randomMsg);

        if (sent) {
          await supabase.from('ai_crm_leads').update({
            followup_5min_sent: true
          }).eq('id', lead.id);

          await supabase.from('wa_chat_history').insert({
            user_id: lead.user_id, agent_id: agentId, instance_id: instanceName,
            remote_jid: remoteJid, role: 'assistant', content: randomMsg
          });

          processed5Min++;
        }
      }
    }

    return new Response(JSON.stringify({
      success: true,
      horario_operacional: operacional,
      processed_5_min: processed5Min,
      processed_10_min: processed10Min
    }), { headers: corsHeaders, status: 200 })

  } catch (err: any) {
    console.error("[Cron] Falha:", err);
    return new Response(JSON.stringify({ error: err.message }), { headers: corsHeaders, status: 500 })
  }
})
