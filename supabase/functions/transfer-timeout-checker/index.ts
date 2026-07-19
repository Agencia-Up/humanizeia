import { logTransferFailure, resolveTransferFailures } from '../_shared/pedro-v2/logTransferFailure.ts';
import { resolveAutomationRules, isWithinTransferWindow, rearmTransferAtNextWindow } from "../_shared/automation/rules.ts";
import { pickNextTimeoutSeller } from "../_shared/transfer/timeoutRouting.ts";
import { sellerPhoneKey } from "../_shared/transfer/phoneKey.ts";
import { buildPedroV3ConversationBriefing } from "../_shared/transfer/buildBriefing.ts";

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
    let _returnSelect: string | null = null;

    const builder = {
      select(cols?: string) {
        if (_method === 'PATCH') {
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
      neq(col: string, val: any) {
        _filters.push({ col, op: 'neq', val: String(val) });
        return builder;
      },
      lt(col: string, val: any) {
        _filters.push({ col, op: 'lt', val: String(val) });
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
      gte(col: string, val: any) {
        _filters.push({ col, op: 'gte', val: String(val) });
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
      single() {
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

        const selectVal = _method === 'PATCH' ? (_returnSelect || undefined) : (_select || '*');
        if (selectVal) params.set('select', selectVal);

        for (const f of _filters) {
          params.append(f.col, `${f.op}.${f.val}`);
        }

        for (const o of _orders) {
          let orderStr = o.column;
          if (!o.ascending) orderStr += '.desc';
          else orderStr += '.asc';
          if (o.nullsFirst) orderStr += '.nullsfirst';
          else orderStr += '.nullslast';
          params.append('order', orderStr);
        }

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
};

// ── Horário operacional (Brasília) ───────────────────────────────────────────
// Dias normais (seg–sáb): 10:11 – 19:29
// Domingos e feriados:     11:11 – 17:29
// Leads criados fora da janela NÃO são repassados, mesmo que o vendedor
// não confirme. Ao entrar no horário, leads da noite NÃO são repassados
// retroativamente — só novos leads a partir do início da janela entram no rodízio.

// ── Função auxiliar: round-robin ──────────────────────────────────────────────
// ─── Main handler ────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const authHeader = req.headers.get('authorization') ?? '';
  const token = authHeader.replace('Bearer ', '');

  if (!token) {
    return new Response(JSON.stringify({ error: 'Não autorizado' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const supabase = createSupabaseClient(supabaseUrl, serviceKey);

  try {
    // ── Janela de repasse (horário de Brasília, UTC-3) ──────────────────────
    const now = new Date().toISOString();

    // Busca todos os transfers pendentes que já expiraram
    const { data: expired, error: fetchErr } = await supabase
      .from('ai_lead_transfers')
      .select('id,user_id,lead_id,to_member_id,created_at,confirmation_timeout_at')
      .eq('transfer_status', 'pending')
      .eq('is_confirmed', false)
      .lt('confirmation_timeout_at', now);

    if (fetchErr) throw fetchErr;
    if (!expired || expired.length === 0) {
      return new Response(
        JSON.stringify({ ok: true, processed: 0, message: 'Nenhum transfer expirado' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[Timeout] ${expired.length} transfer(s) expirado(s)`);
    let processed = 0;

    for (const transfer of expired) {
      try {
        // Fetch lead data separately (PostgREST doesn't support nested joins via query string easily)
        const { data: lead } = await supabase
          .from('ai_crm_leads')
          .select('id,remote_jid,lead_name,summary,agent_id,status,assigned_to_id')
          .eq('id', transfer.lead_id)
          .maybeSingle();

        // Fetch member data
        const { data: expiredSeller } = await supabase
          .from('ai_team_members')
          .select('id,name,whatsapp_number,agent_id')
          .eq('id', transfer.to_member_id)
          .maybeSingle();

        if (!lead || !expiredSeller) {
          await supabase.from('ai_lead_transfers')
            .update({ transfer_status: 'expired' })
            .eq('id', transfer.id);
          continue;
        }

        // ── GUARD: lead JA reivindicado por um vendedor que confirmou (deu OK)? ──
        // Se o lead esta 'em_atendimento' OU ja existe um transfer 'confirmed' pra
        // ele, NAO repassa para o proximo — apenas marca ESTE transfer (duplicata /
        // sobra de outro fluxo) como expirado. Antes faltava esse check: um transfer
        // irmao expirado roubava um lead ja aceito ("vendedor deu OK e mesmo assim
        // passou pro proximo"). Vale para v1 e v2 (uma vez aceito, o lead e do vendedor).
        const { data: transfersForLead } = await supabase
          .from('ai_lead_transfers')
          .select('id,transfer_status,is_confirmed')
          .eq('lead_id', transfer.lead_id)
          .limit(50);
        const hasConfirmedTransfer = Array.isArray(transfersForLead) &&
          transfersForLead.some((row: any) => row?.is_confirmed === true || row?.transfer_status === 'confirmed');
        const alreadyClaimed = lead.status === 'em_atendimento' ||
          Boolean(lead.assigned_to_id) ||
          hasConfirmedTransfer;
        if (alreadyClaimed) {
          console.log(`[Timeout] Lead ${transfer.lead_id} JA reivindicado (status=${lead.status}/confirmed) — NAO repassa. Transfer ${transfer.id} -> expired.`);
          await supabase.from('ai_lead_transfers')
            .update({ transfer_status: 'expired' })
            .eq('id', transfer.id);
          continue;
        }

        // Fetch agent info for instance_ids
        let instanceIds: string[] = [];
        let agentRulesRaw: any = null;
        if (lead.agent_id) {
          const { data: agent } = await supabase
            .from('wa_ai_agents')
            .select('id,name,instance_ids,automation_rules')
            .eq('id', lead.agent_id)
            .maybeSingle();
          if (agent?.instance_ids) {
            instanceIds = agent.instance_ids;
          }
          agentRulesRaw = agent?.automation_rules ?? null;
        }
        const aRules = resolveAutomationRules(agentRulesRaw);
        // Transferencia desligada pelo gerente -> nao escala (marca expirado e segue).
        if (!aRules.transfer.enabled) {
          await supabase.from('ai_lead_transfers').update({ transfer_status: 'expired' }).eq('id', transfer.id);
          continue;
        }

        // ── Regra de horário: só repassa se o transfer foi CRIADO dentro da
        //    janela operacional. Leads que chegaram durante a noite ficam com
        //    o vendedor — não são repassados retroativamente. ──────
        // Fora do expediente, inclusive domingo, a pendência continua pendente.
        // Nunca auto-confirme: confirmação é uma ação real do vendedor. Rearme
        // para a próxima abertura e dê o timeout inteiro a partir dela.
        const nowDate = new Date();
        if (!isWithinTransferWindow(aRules.transfer.window, nowDate)) {
          const rearmedAt = rearmTransferAtNextWindow(
            aRules.transfer.window,
            nowDate,
            aRules.transfer.seller_response_min,
          );
          await supabase.from('ai_lead_transfers').update({
            confirmation_timeout_at: rearmedAt.toISOString(),
          }).eq('id', transfer.id).eq('transfer_status', 'pending').eq('is_confirmed', false);
          console.log(`[Timeout] Fora da janela do agente; transfer ${transfer.id} permanece pendente até ${rearmedAt.toISOString()}.`);
          continue;
        }

        // 1. Claim atomico: evita que dois crons processem o mesmo transfer
        // e mandem aviso duplicado para o vendedor anterior.
        const { data: claimed, error: claimErr } = await supabase.from('ai_lead_transfers')
          .update({ transfer_status: 'expired' })
          .eq('id', transfer.id)
          .eq('transfer_status', 'pending')
          .eq('is_confirmed', false)
          .select('id');

        if (claimErr) {
          console.error(`[Timeout] Falha ao claimar transfer ${transfer.id}:`, claimErr);
          continue;
        }
        if (!Array.isArray(claimed) || claimed.length === 0) {
          console.log(`[Timeout] Transfer ${transfer.id} ja foi processado por outro worker. Pulando.`);
          continue;
        }

        // 2. Busca instância da API para poder enviar WhatsApp
        let waInstance: any = null;
        if (instanceIds.length > 0) {
          const { data: inst } = await supabase
            .from('wa_instances')
            .select('api_url,api_key_encrypted,instance_name')
            .in('id', instanceIds)
            .limit(1)
            .maybeSingle();
          waInstance = inst;
        }

        // 3. Preflight obrigatório: sem próximo vendedor, não envie ao
        // vendedor anterior uma mensagem que afirme que o lead já foi repassado.
        let preflightRoster = (await supabase
          .from('ai_team_members')
          .select('id,name,whatsapp_number,is_active,agent_id')
          .eq('user_id', transfer.user_id)
          .eq('is_active', true)
          .eq('agent_id', lead.agent_id)).data || [];
        if (preflightRoster.length === 0) {
          preflightRoster = (await supabase
            .from('ai_team_members')
            .select('id,name,whatsapp_number,is_active,agent_id')
            .eq('user_id', transfer.user_id)
            .eq('is_active', true)).data || [];
        }
        if (!pickNextTimeoutSeller(preflightRoster, [], expiredSeller.id, sellerPhoneKey(expiredSeller))) {
          await supabase.from('ai_lead_transfers').update({
            transfer_status: 'pending',
            confirmation_timeout_at: rearmTransferAtNextWindow(aRules.transfer.window, new Date(), aRules.transfer.seller_response_min).toISOString(),
          }).eq('id', transfer.id).eq('transfer_status', 'expired');
          continue;
        }

        // 4. Round-robin — escolhe próximo vendedor (filtra por agent_id do lead)
        let { data: allSellers } = await supabase
          .from('ai_team_members')
          .select('*')
          .eq('user_id', transfer.user_id)
          .eq('is_active', true)
          .eq('agent_id', lead.agent_id);

        // Algumas contas cadastram vendedores no tenant (agent_id NULL). O
        // timeout precisa usar o mesmo fallback tenant-wide da saga v3, ou
        // expira o transfer e deixa o lead sem próximo destinatário.
        if (!allSellers || allSellers.length === 0) {
          const tenantRoster = await supabase
            .from('ai_team_members')
            .select('*')
            .eq('user_id', transfer.user_id)
            .eq('is_active', true);
          allSellers = tenantRoster.data;
        }

        const { data: recentTransfers } = await supabase
          .from('ai_lead_transfers')
          .select('to_member_id,created_at')
          .eq('user_id', transfer.user_id)
          .eq('lead_id', lead.id)
          .order('created_at', { ascending: false })
          .limit(100);

        const nextSeller = pickNextTimeoutSeller(
          allSellers || [],
          recentTransfers || [],
          expiredSeller.id,
          sellerPhoneKey(expiredSeller),
        );

        if (!nextSeller) {
          console.warn(`[Timeout] Nenhum outro vendedor ativo para repassar o lead ${lead.id}`);
          // Diagnostico: lead expirou e nao ha outro vendedor para escalar.
          await logTransferFailure({
            user_id: transfer.user_id,
            reason_code: 'sem_vendedor_disponivel',
            mode: 'pedro',
            lead_id: lead.id,
            agent_id: lead.agent_id,
            member_id: expiredSeller.id,
            lead_name: lead.lead_name,
            remote_jid: lead.remote_jid,
            attempted_transfer: true,
            source: 'transfer-timeout-checker',
            reason_detail: `Lead expirou com ${expiredSeller.name || 'o vendedor anterior'} e nao ha outro vendedor ativo na fila para escalar.`,
          });
          // Mantém o lead com uma pendência rearmada para a próxima execução.
          // Não há destinatário, portanto nunca devemos deixar a mensagem
          // “passado para o próximo” ser a única evidência operacional.
          await supabase.from('ai_lead_transfers').update({
            transfer_status: 'pending',
            confirmation_timeout_at: rearmTransferAtNextWindow(aRules.transfer.window, new Date(), aRules.transfer.seller_response_min).toISOString(),
          }).eq('id', transfer.id).eq('transfer_status', 'expired');
          continue;
        }

        // 5. Cria novo transfer para o próximo vendedor
        const newTimeout = new Date(Date.now() + aRules.transfer.seller_response_min * 60 * 1000).toISOString();
        const { error: nextTransferErr } = await supabase.from('ai_lead_transfers').insert({
          user_id: transfer.user_id,
          lead_id: lead.id,
          from_member_id: expiredSeller.id,
          to_member_id: nextSeller.id,
          transfer_reason: 'timeout_escalation',
          notes: `Repassado após timeout de ${expiredSeller.name}`,
          transfer_status: 'pending',
          is_confirmed: false,
          confirmation_timeout_at: newTimeout,
        });

        if (nextTransferErr) {
          console.error(`[Timeout] Falha ao criar transfer para ${nextSeller.name}:`, nextTransferErr);
          await supabase.from('ai_lead_transfers').update({
            transfer_status: 'pending',
            confirmation_timeout_at: rearmTransferAtNextWindow(aRules.transfer.window, new Date(), aRules.transfer.seller_response_min).toISOString(),
          }).eq('id', transfer.id).eq('transfer_status', 'expired');
          continue;
        }

        // Atualiza lead com novo responsável
        await supabase.from('ai_crm_leads')
          .update({ assigned_to_id: null, status: 'transferido' })
          .eq('id', lead.id)
          .in('status', ['qualificado', 'transferido']);

        // Diagnostico: lead ganhou um novo vendedor -> resolve falhas abertas.
        await resolveTransferFailures({
          user_id: transfer.user_id,
          lead_id: lead.id,
          resolved_by: 'timeout-escalation',
        });

        // 6. Envia mensagem para o próximo vendedor
        let nextSellerNotified = false;
        if (waInstance && nextSeller.whatsapp_number) {
          let nextNum = nextSeller.whatsapp_number.replace(/\D/g, '');
          if (nextNum.length === 10 || nextNum.length === 11) nextNum = `55${nextNum}`;

          const baseUrl = (waInstance.api_url || '').replace(/\/$/, '');
          const instKey = waInstance.api_key_encrypted || '';

          const v3Briefing = await buildPedroV3ConversationBriefing(supabase, lead, {
            reason: "Escalonamento por timeout",
            sellerName: nextSeller.name,
          });
          const nextMsg = `🚨 *NOVO LEAD PARA ATENDIMENTO (Pedro v3)*\n\n*Cliente:* ${lead.lead_name || 'Contato WhatsApp'}\n*Contato:* ${lead.remote_jid || ''}\n\n${v3Briefing}\n\n⏰ *Responda "Ok" em até ${aRules.transfer.seller_response_min} minutos para assumir este atendimento. Se não responder, ele seguirá para o próximo vendedor.*`;

          try {
            const sendRes = await fetch(`${baseUrl}/send/text`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'token': instKey },
              body: JSON.stringify({ number: nextNum, text: nextMsg }),
            });
            if (!sendRes.ok) {
              const body = await sendRes.text().catch(() => '');
              throw new Error(`UAZAPI ${sendRes.status}: ${body}`);
            }
            nextSellerNotified = true;
            console.log(`[Timeout] Lead repassado para ${nextSeller.name}`);
          } catch (sendErr) {
            console.error(`[Timeout] Erro ao enviar para ${nextSeller.name}:`, sendErr);
            await supabase.from('ai_lead_transfers')
              .update({ transfer_status: 'expired' })
              .eq('lead_id', lead.id)
              .eq('to_member_id', nextSeller.id)
              .eq('transfer_status', 'pending');
            // O próximo vendedor não recebeu o aviso; não deixe o lead órfão
            // por causa de uma falha de transporte. Rearma a pendência anterior
            // e permite nova tentativa no próximo ciclo.
            await supabase.from('ai_lead_transfers').update({
              transfer_status: 'pending',
              confirmation_timeout_at: rearmTransferAtNextWindow(aRules.transfer.window, new Date(), aRules.transfer.seller_response_min).toISOString(),
            }).eq('id', transfer.id).eq('transfer_status', 'expired');
            await logTransferFailure({
              user_id: transfer.user_id,
              reason_code: 'notificacao_falhou',
              mode: 'pedro',
              lead_id: lead.id,
              agent_id: lead.agent_id,
              member_id: nextSeller.id,
              lead_name: lead.lead_name,
              remote_jid: lead.remote_jid,
              attempted_transfer: true,
              source: 'transfer-timeout-checker',
              reason_detail: `Envio para o proximo vendedor (${nextSeller.name || nextSeller.id}) falhou apos criar o repasse; transfer pendente foi expirado para evitar confirmacao fantasma.`,
            });
            continue;
          }
        }

        // Só avisa o vendedor anterior depois que o novo repasse foi
        // persistido e efetivamente notificado. Assim, uma falha de insert,
        // telefone ou transporte nunca produz “LEAD REPASSADO” sem destino.
        if (nextSellerNotified && waInstance && expiredSeller.whatsapp_number) {
          let expiredNum = expiredSeller.whatsapp_number.replace(/\D/g, '');
          if (expiredNum.length === 10 || expiredNum.length === 11) expiredNum = `55${expiredNum}`;

          const baseUrl = (waInstance.api_url || '').replace(/\/$/, '');
          const instKey = waInstance.api_key_encrypted || '';
          const missedMsg = `⚠️ *LEAD REPASSADO*\n\nO lead *${lead.lead_name || 'Contato WhatsApp'}* não teve sua confirmação dentro de ${aRules.transfer.seller_response_min} minutos e foi passado para o próximo da fila.\n\n🚫 *Por favor, não entre em contato com este lead.*`;

          try {
            await fetch(`${baseUrl}/send/text`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'token': instKey },
              body: JSON.stringify({ number: expiredNum, text: missedMsg }),
            });
            console.log(`[Timeout] Aviso enviado para ${expiredSeller.name}`);
          } catch (sendErr) {
            console.error(`[Timeout] Erro ao enviar aviso para ${expiredSeller.name}:`, sendErr);
          }
        }

        processed++;
      } catch (innerErr) {
        console.error(`[Timeout] Erro ao processar transfer ${transfer.id}:`, innerErr);
        // Diagnostico: erro tecnico ao escalar o lead.
        await logTransferFailure({
          user_id: transfer.user_id,
          reason_code: 'erro_tecnico',
          mode: 'pedro',
          lead_id: transfer.lead_id,
          attempted_transfer: true,
          source: 'transfer-timeout-checker',
          reason_detail: `Erro ao processar timeout do transfer ${transfer.id}: ${(innerErr as any)?.message || innerErr}`,
        });
      }
    }

    return new Response(
      JSON.stringify({ ok: true, processed, total_expired: expired.length }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    console.error('[Timeout] Erro crítico:', err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
