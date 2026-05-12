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
    let _upsertConflict: string | null = null;
    let _ignoreDuplicates = false;

    const builder: any = {
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
      gt(col: string, val: any) {
        _filters.push({ col, op: 'gt', val: String(val) });
        return builder;
      },
      lte(col: string, val: any) {
        _filters.push({ col, op: 'lte', val: String(val) });
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
      contains(col: string, val: any) {
        // PostgREST @> operator → cs. filter
        const encodedVal = Array.isArray(val)
          ? `{${val.map((v: any) => String(v).replace(/"/g, '\\"')).join(',')}}`
          : JSON.stringify(val);
        _filters.push({ col, op: 'cs', val: encodedVal });
        return builder;
      },
      ilike(col: string, val: string) {
        _filters.push({ col, op: 'ilike', val });
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
      upsert(data: any, opts?: { onConflict?: string; ignoreDuplicates?: boolean }) {
        _method = 'POST';
        _body = data;
        if (opts?.onConflict) _upsertConflict = opts.onConflict;
        if (opts?.ignoreDuplicates) _ignoreDuplicates = true;
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

        // upsert on_conflict
        if (_upsertConflict) {
          params.set('on_conflict', _upsertConflict);
        }

        const queryStr = params.toString();
        const urlStr = `${restBase}/${table}${queryStr ? '?' + queryStr : ''}`;

        const headers: Record<string, string> = { ...baseHeaders };

        if (_method === 'PATCH' && _returnSelect) {
          headers['Prefer'] = 'return=representation';
        }
        if (_method === 'POST' && _upsertConflict) {
          // upsert
          const parts = ['return=minimal', 'resolution=merge-duplicates'];
          if (_ignoreDuplicates) parts[1] = 'resolution=ignore-duplicates';
          headers['Prefer'] = parts.join(',');
        } else if (_method === 'POST') {
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
          if (_method === 'PATCH' && !_returnSelect) {
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
    async rpc(fnName: string, params: any): Promise<{ data: any; error: any }> {
      const urlStr = `${restBase}/rpc/${fnName}`;
      try {
        const res = await fetch(urlStr, {
          method: 'POST',
          headers: { ...baseHeaders },
          body: JSON.stringify(params),
        });
        if (!res.ok) {
          const errBody = await res.text();
          return { data: null, error: { message: errBody, status: res.status } };
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
}

// ─── CORS headers ───────────────────────────────────────────────────────────
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ─── BNDV Stock Search ──────────────────────────────────────────────────────
async function consultarEstoqueBndv(supabase: any, userId: string, filters: any) {
  try {
    // 1. Lookup BNDV token from platform_integrations
    const { data: integration } = await supabase
      .from('platform_integrations')
      .select('api_key_encrypted')
      .eq('user_id', userId)
      .eq('platform', 'bndv')
      .maybeSingle();

    if (!integration?.api_key_encrypted) {
      console.log('[BNDV] Nenhuma integração BNDV encontrada para user_id:', userId);
      return { success: false, total: 0, items: [], error: 'Integração BNDV não configurada.' };
    }

    let apiToken = '';
    try {
      const parsed = JSON.parse(integration.api_key_encrypted);
      apiToken = parsed.api_token || '';
    } catch {
      apiToken = integration.api_key_encrypted;
    }

    if (!apiToken) {
      return { success: false, total: 0, items: [], error: 'Token BNDV inválido.' };
    }

    // 2. GraphQL query to BNDV
    const graphqlQuery = `query BndvVehicles {
  vehiclesBy {
    modelName
    markName
    year
    km
    saleValue
    color
    fuelName
    transmissionName
    versionName
    pictureJs
  }
}`;

    console.log('[BNDV] Consultando estoque...');
    const gqlRes = await fetch('https://api-estoque.azurewebsites.net/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiToken}`,
      },
      body: JSON.stringify({ query: graphqlQuery }),
    });

    if (!gqlRes.ok) {
      const errText = await gqlRes.text();
      console.error('[BNDV] Erro GraphQL:', gqlRes.status, errText);
      return { success: false, total: 0, items: [], error: `Erro BNDV: ${gqlRes.status}` };
    }

    const gqlData = await gqlRes.json();
    let vehicles = gqlData?.data?.vehiclesBy || [];
    console.log(`[BNDV] Total veículos retornados: ${vehicles.length}`);

    // 3. Filter/rank results
    const normalize = (s: string) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

    // Apply filters
    if (filters.marca) {
      const q = normalize(filters.marca);
      vehicles = vehicles.filter((v: any) => normalize(v.markName).includes(q));
    }
    if (filters.modelo) {
      const q = normalize(filters.modelo);
      vehicles = vehicles.filter((v: any) => normalize(v.modelName).includes(q));
    }
    if (filters.versao) {
      const q = normalize(filters.versao);
      vehicles = vehicles.filter((v: any) => normalize(v.versionName).includes(q));
    }
    if (filters.combustivel) {
      const q = normalize(filters.combustivel);
      vehicles = vehicles.filter((v: any) => normalize(v.fuelName).includes(q));
    }
    if (filters.cambio) {
      const q = normalize(filters.cambio);
      vehicles = vehicles.filter((v: any) => normalize(v.transmissionName).includes(q));
    }
    if (filters.cor) {
      const q = normalize(filters.cor);
      vehicles = vehicles.filter((v: any) => normalize(v.color).includes(q));
    }
    if (filters.ano_min) {
      vehicles = vehicles.filter((v: any) => (v.year || 0) >= filters.ano_min);
    }
    if (filters.ano_max) {
      vehicles = vehicles.filter((v: any) => (v.year || 9999) <= filters.ano_max);
    }
    if (filters.preco_max) {
      vehicles = vehicles.filter((v: any) => (v.saleValue || 0) <= filters.preco_max);
    }
    if (filters.km_max) {
      vehicles = vehicles.filter((v: any) => (v.km || 0) <= filters.km_max);
    }

    // Free text query ranking
    if (filters.query) {
      const queryTokens = normalize(filters.query).split(/\s+/);
      vehicles = vehicles.map((v: any) => {
        const text = normalize(`${v.markName} ${v.modelName} ${v.versionName} ${v.color} ${v.fuelName} ${v.transmissionName} ${v.year}`);
        let score = 0;
        for (const token of queryTokens) {
          if (text.includes(token)) score++;
        }
        return { ...v, _score: score };
      }).filter((v: any) => v._score > 0)
        .sort((a: any, b: any) => b._score - a._score);
    }

    // 4. Build result items with images
    const items = vehicles.slice(0, 20).map((v: any) => {
      let principalImage = '';
      const images: string[] = [];

      if (v.pictureJs) {
        try {
          const pics = typeof v.pictureJs === 'string' ? JSON.parse(v.pictureJs) : v.pictureJs;
          if (Array.isArray(pics)) {
            for (const pic of pics) {
              if (pic.Link) {
                images.push(pic.Link);
                if (pic.Principal === true || pic.Principal === 'true') {
                  principalImage = pic.Link;
                }
              }
            }
            if (!principalImage && images.length > 0) {
              principalImage = images[0];
            }
          }
        } catch {
          // pictureJs parse failed
        }
      }

      const preco = v.saleValue || 0;
      const label = `${v.markName || ''} ${v.modelName || ''} ${v.versionName || ''} ${v.year || ''} - R$ ${preco.toLocaleString('pt-BR')}`.trim();

      return {
        marca: v.markName || '',
        modelo: v.modelName || '',
        versao: v.versionName || '',
        ano: v.year || 0,
        km: v.km || 0,
        preco,
        cor: v.color || '',
        combustivel: v.fuelName || '',
        cambio: v.transmissionName || '',
        label,
        principal_image: principalImage,
        images,
      };
    });

    console.log(`[BNDV] Resultados filtrados: ${items.length}`);
    return { success: true, total: items.length, items };
  } catch (err: any) {
    console.error('[BNDV] Erro na consulta:', err);
    return { success: false, total: 0, items: [], error: err.message };
  }
}

// ─── WhatsApp Image Sending ─────────────────────────────────────────────────
async function sendVehicleImage(baseUrl: string, instKey: string, instanceName: string, phoneNumber: string, remoteJid: string, imageUrl: string, caption: string) {
  // UazAPI V6: endpoint unificado /send/media (os antigos /send/image etc retornam 405)
  const attempts = [
    {
      label: 'send/media (url)',
      url: `${baseUrl}/send/media`,
      body: { number: phoneNumber, url: imageUrl, type: 'image', caption },
    },
    {
      label: 'send/media (media)',
      url: `${baseUrl}/send/media`,
      body: { number: phoneNumber, media: imageUrl, mediatype: 'image', caption },
    },
  ];

  for (const attempt of attempts) {
    try {
      console.log(`[BNDV-IMG] Tentando ${attempt.label}...`);
      const res = await fetch(attempt.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'token': instKey, 'apikey': instKey },
        body: JSON.stringify(attempt.body),
      });
      if (res.ok) {
        console.log(`[BNDV-IMG] Sucesso via ${attempt.label}`);
        return true;
      }
      console.log(`[BNDV-IMG] ${attempt.label} retornou ${res.status}`);
    } catch (err) {
      console.log(`[BNDV-IMG] ${attempt.label} falhou:`, err);
    }
  }
  console.warn('[BNDV-IMG] Todas as tentativas de envio de imagem falharam');
  return false;
}

// ─── Main handler ───────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabase = createSupabaseClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const payload = await req.json()
    console.log("[Webhook] Payload COMPLETO:", JSON.stringify(payload))

    const isUazapi = !!(payload.BaseUrl || payload.EventType || payload.instanceId)
    const isEvolution = !!(payload.event || payload.data)

    // --- FORMATO UAZAPI ---
    if (isUazapi) {
      const eventType = String(payload.EventType || payload.eventType || '').toLowerCase()

      if (eventType === 'connection' || eventType === 'status' || eventType.includes('connect')) {
        const instanceName = payload.instance || payload.instanceName || payload.InstanceId || payload.instanceId || ''
        if (instanceName) {
          const state = String(payload.state || payload.status || '').toLowerCase()
          if (state === 'open' || state === 'connected') {
            await supabase.from('wa_instances')
              .update({ is_active: true, status: 'connected', updated_at: new Date().toISOString() })
              .eq('instance_name', instanceName)
          }
        }
        return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders })
      }

      if (eventType !== 'messages' && eventType !== 'message' && !eventType.includes('message')) {
        return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders })
      }

      const instanceName = payload.instance || payload.instanceName || payload.InstanceId || payload.instanceId || ''
      const chat = payload.chat || {}

      let msgObj = null
      if (Array.isArray(payload.messages) && payload.messages.length > 0) {
        msgObj = payload.messages[0]
      } else if (payload.message) {
        msgObj = payload.message
      }

      if (!msgObj) return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders })
      if (msgObj.fromMe === true) return new Response('Ignored fromMe', { headers: corsHeaders })

      const remoteJid = msgObj.chatId || msgObj.chatid || msgObj.from || chat.id || chat.chatId || '';
      if (!remoteJid) { console.log('[Webhook] No remoteJid'); return new Response('No remoteJid', { headers: corsHeaders }); }
      if (remoteJid.includes('@g.us') || remoteJid.includes('@broadcast')) return new Response('Ignored group/broadcast', { headers: corsHeaders });

      // UazAPI V6: texto está em content (string para texto, objeto para mídia), text, ou caption
      const rawContent = msgObj.content;
      const textContent = (typeof rawContent === 'string') ? rawContent : '';
      const userText = (msgObj.body || msgObj.text || textContent || msgObj.caption || '').trim();
      const pushName = msgObj.senderName || chat.name || msgObj.notifyName || msgObj.pushName || 'Lead';

      console.log(`[Webhook] Mensagem recebida [UAZAPI]. Instance: ${instanceName}, From: ${remoteJid}, Text: ${userText}`);
      return await processMessage(supabase, instanceName, remoteJid, userText, pushName, msgObj);
    }

    // --- FORMATO EVOLUTION API ---
    const eventRaw = payload.event || ''
    const event = String(eventRaw).toLowerCase()

    if (event.includes('connection.update') || event.includes('connection_update')) {
      const data = payload.data || payload
      const instance = payload.instance || data.instance || ''
      const state = String(data.state || data.status || '').toLowerCase()
      if ((state === 'open' || state === 'connected') && instance) {
        await supabase.from('wa_instances')
          .update({ is_active: true, status: 'connected', updated_at: new Date().toISOString() })
          .eq('instance_name', instance)
      }
      return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders })
    }

    if (event !== 'messages.upsert' && event !== 'messages_upsert') {
      return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders })
    }

    let data = payload.data || payload
    if (Array.isArray(data)) data = data[0]

    const instance = payload.instance || data.instance || ''
    const { key, message, pushName, messageType } = data

    if (!instance || !key || !message) return new Response('Incomplete payload', { headers: corsHeaders })
    if (key.fromMe) return new Response('Ignored fromMe', { headers: corsHeaders })
    if (key.remoteJid?.includes('@broadcast') || key.remoteJid?.includes('@g.us')) return new Response('Ignored group/broadcast', { headers: corsHeaders })

    let userText = message.conversation || message.extendedTextMessage?.text || message.text || data.text || ''

    return await processMessage(supabase, instance, key.remoteJid, userText.trim(), pushName || 'Lead', data)

  } catch (error: any) {
    console.error("[Webhook] Erro Critico:", error)
    return new Response(JSON.stringify({ error: error.message }), { headers: corsHeaders, status: 500 })
  }
})

async function processMessage(supabase: any, instanceName: string, remoteJid: string, userText: string, pushName: string, rawMsgObj: any) {
  const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }

  const { data: waInstance } = await supabase.from('wa_instances').select('*').eq('instance_name', instanceName).maybeSingle()
  if (!waInstance) {
    console.log(`[Webhook] Instance not found: ${instanceName}`);
    return new Response('Instance not found', { headers: corsHeaders })
  }

  const { data: agent } = await supabase.from('wa_ai_agents')
    .select('*').eq('user_id', waInstance.user_id).eq('is_active', true).contains('instance_ids', [waInstance.id]).maybeSingle()

  if (!agent) {
    console.log(`[Webhook] No matching active agent for instanceId: ${waInstance.id}`);
    return new Response('No matching active agent', { headers: corsHeaders })
  }

  console.log(`[Webhook] Agente encontrado: ${agent.name} (ID: ${agent.id})`);

  // ── DETECÇÃO DE RESPOSTA DE VENDEDOR ────────────────────────────────
  // Se a mensagem vier do número de um vendedor, confirma o transfer pendente,
  // envia mensagem de confirmação e retorna sem deixar o Pedro responder.
  const senderDigits = remoteJid.replace(/\D/g, '').slice(-10); // últimos 10 dígitos

  // 1. Busca vendedor por agent_id
  let { data: senderSeller } = await supabase
    .from('ai_team_members')
    .select('id, name')
    .eq('agent_id', agent.id)
    .eq('is_active', true)
    .ilike('whatsapp_number', `%${senderDigits}`)
    .maybeSingle();

  // 2. Fallback: busca vendedor por user_id (vendedores podem não ter agent_id)
  if (!senderSeller) {
    const { data: fallbackSeller } = await supabase
      .from('ai_team_members')
      .select('id, name')
      .eq('user_id', agent.user_id)
      .eq('is_active', true)
      .ilike('whatsapp_number', `%${senderDigits}`)
      .maybeSingle();
    senderSeller = fallbackSeller;
  }

  if (senderSeller) {
    console.log(`[Transfer] Mensagem do vendedor ${senderSeller.name} — verificando transfer pendente`);
    const now = new Date().toISOString();
    const { data: pendingTransfer } = await supabase
      .from('ai_lead_transfers')
      .select('id, lead_id')
      .eq('to_member_id', senderSeller.id)
      .eq('transfer_status', 'pending')
      .eq('is_confirmed', false)
      .gt('confirmation_timeout_at', now)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (pendingTransfer) {
      // Confirma o transfer
      await supabase.from('ai_lead_transfers').update({
        transfer_status: 'confirmed',
        is_confirmed: true,
        confirmed_at: now,
      }).eq('id', pendingTransfer.id);

      await supabase.from('ai_team_members').update({
        last_lead_received_at: now,
      }).eq('id', senderSeller.id);

      // Atualiza status do lead para 'em_atendimento'
      if (pendingTransfer.lead_id) {
        await supabase.from('ai_crm_leads').update({
          status: 'em_atendimento',
          last_interaction_at: now,
        }).eq('id', pendingTransfer.lead_id);
      }

      // Envia mensagem de confirmação para o vendedor via WhatsApp
      try {
        const sellerBaseUrl = (waInstance.api_url || '').replace(/\/$/, '');
        const sellerInstKey = waInstance.api_key_encrypted || '';
        let sellerDest = remoteJid.replace(/\D/g, '');
        if (sellerDest.length === 10 || sellerDest.length === 11) sellerDest = `55${sellerDest}`;

        const confirmMsg = `✅ *Atendimento Confirmado!*\n\nO lead foi atribuído a você no CRM. Pode seguir com a venda! 🚀`;

        await fetch(`${sellerBaseUrl}/send/text`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'token': sellerInstKey },
          body: JSON.stringify({ number: sellerDest, text: confirmMsg }),
        });
        console.log(`[Transfer] ✅ Confirmação enviada para vendedor ${senderSeller.name}`);
      } catch (confirmErr) {
        console.warn(`[Transfer] Erro ao enviar confirmação para vendedor:`, confirmErr);
      }

      console.log(`[Transfer] ✅ Vendedor ${senderSeller.name} confirmou o lead`);
    }
    // Vendedor não recebe resposta do Pedro (IA)
    return new Response(JSON.stringify({ ok: true, seller_ack: true }), { headers: corsHeaders });
  }
  // ────────────────────────────────────────────────────────────────────

  // Registrar Lead no CRM
  const nowStr = new Date().toISOString();
  await supabase.from('ai_crm_leads').upsert({
    user_id: agent.user_id,
    agent_id: agent.id,
    instance_id: waInstance.id,
    remote_jid: remoteJid,
    lead_name: pushName,
    message_count: 1,
    last_interaction_at: nowStr
  }, { onConflict: 'agent_id, remote_jid', ignoreDuplicates: true });

  // ── CRITICAL: Atualiza timestamps para as regras de 5min/10min (cron-lead-followup) ──
  // last_user_reply_at = quando o CLIENTE enviou a última mensagem
  // followup_5min_sent = reset para false para o cron enviar novo follow-up se necessário
  await supabase.from('ai_crm_leads').update({
    instance_id: waInstance.id,
    last_user_reply_at: nowStr,
    followup_5min_sent: false,
  }).eq('agent_id', agent.id).eq('remote_jid', remoteJid);

  // ── DETECÇÃO DE LEAD QUE RETORNOU (já transferido/qualificado) ─────────────
  // Se o lead já estava com vendedor, notifica o vendedor e reseta o status
  // para que as regras de 5min/10min voltem a funcionar nesta nova conversa.
  {
    const { data: existingLead } = await supabase
      .from('ai_crm_leads')
      .select('id, status, assigned_to_id, lead_name')
      .eq('agent_id', agent.id)
      .eq('remote_jid', remoteJid)
      .maybeSingle();

    if (existingLead &&
        ['transferido', 'qualificado', 'em_atendimento'].includes(existingLead.status) &&
        existingLead.assigned_to_id) {
      console.log(`[Webhook] 🔄 Lead RETORNOU! Status era '${existingLead.status}', assigned_to=${existingLead.assigned_to_id}. Resetando...`);

      // 1. Buscar vendedor que estava atendendo
      const { data: assignedSeller } = await supabase
        .from('ai_team_members')
        .select('id, name, whatsapp_number')
        .eq('id', existingLead.assigned_to_id)
        .maybeSingle();

      // 2. Resetar lead — status volta para 'novo', sem vendedor, regras reativam
      await supabase.from('ai_crm_leads').update({
        status: 'novo',
        status_crm: 'novo',
        assigned_to_id: null,
        followup_5min_sent: false,
      }).eq('id', existingLead.id);

      // 3. Notificar vendedor via WhatsApp que o cliente voltou
      if (assignedSeller?.whatsapp_number) {
        try {
          const retBaseUrl = (waInstance.api_url || '').replace(/\/$/, '');
          const retInstKey = waInstance.api_key_encrypted || '';
          let sellerNum = assignedSeller.whatsapp_number.replace(/\D/g, '');
          if (sellerNum.length === 10 || sellerNum.length === 11) sellerNum = `55${sellerNum}`;
          const clientPhone = remoteJid.replace(/@.*$/, '').replace(/\D/g, '');

          const returnNotification =
            `🔄 *LEAD RETORNOU!*\n\n` +
            `O cliente *${pushName || existingLead.lead_name || 'Desconhecido'}* voltou a conversar.\n` +
            `📱 *Contato:* +${clientPhone}\n\n` +
            `A IA está respondendo enquanto isso. Se quiser assumir, entre em contato:\n` +
            `👉 https://wa.me/${clientPhone}\n\n` +
            `⏰ Se ninguém assumir em 10 min, o lead será redistribuído automaticamente.`;

          await fetch(`${retBaseUrl}/send/text`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'token': retInstKey },
            body: JSON.stringify({ number: sellerNum, text: returnNotification }),
          });
          console.log(`[Webhook] 🔄 Notificação de retorno enviada para ${assignedSeller.name}`);
        } catch (notifyErr) {
          console.error('[Webhook] Erro ao notificar vendedor sobre retorno:', notifyErr);
        }
      }
    }
  }

  const handoffMsg = "Excelente! Já informei o meu time de especialistas comerciais e eles vão dar continuidade no seu atendimento. Eles vão te chamar aqui mesmo neste número agora mesmo! Muito obrigado.";

  // Tools
  const tools: any[] = [
    {
      type: "function",
      function: {
        name: "atualizar_etapa_crm",
        description: "Atualiza o Kanban/CRM conforme a evolução da conversa. Chame esta função secretamente para categorizar o lead. Valores válidos de status: 'interessado' (quando tem interesse inicial), 'qualificado' (quando pediu para comprar ou quer falar com humano) e 'encerrado' (quando não quer comprar). OBS IMPORTANTE: Ao chamar esta função para status 'interessado' ou 'encerrado', VOCÊ DEVE TAMBÉM gerar uma mensagem normal para o cliente. Só encerre a conversa se for status 'qualificado'.",
        parameters: {
          type: "object",
          properties: {
            status: { type: "string", enum: ["interessado", "qualificado", "encerrado"], description: "A etapa atual do cliente." },
            resumo: { type: "string", description: "O que o cliente deseja e as informações que você coletou dele até o momento. Seja breve." }
          },
          required: ["status", "resumo"]
        }
      }
    },
    {
      type: "function",
      function: {
        name: "consultar_estoque_bndv",
        description: "Consulta o estoque real de veículos integrado ao BNDV. Use quando o cliente perguntar sobre carros disponíveis, preço, ano, versão, câmbio, combustível, cor ou faixa de valor. Nunca invente estoque sem usar esta ferramenta.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "Busca livre do cliente." },
            marca: { type: "string", description: "Marca do veículo." },
            modelo: { type: "string", description: "Modelo do veículo." },
            versao: { type: "string", description: "Versão do veículo." },
            combustivel: { type: "string", description: "Combustível desejado." },
            cambio: { type: "string", description: "Tipo de câmbio." },
            cor: { type: "string", description: "Cor desejada." },
            ano_min: { type: "number", description: "Ano mínimo." },
            ano_max: { type: "number", description: "Ano máximo." },
            preco_max: { type: "number", description: "Preço máximo." },
            km_max: { type: "number", description: "Quilometragem máxima." },
          }
        }
      }
    }
  ];

  // Helper function to decode base64
  const b64toBlob = (b64Data: string, contentType = '', sliceSize = 512) => {
    const byteCharacters = atob(b64Data);
    const byteArrays = [];
    for (let offset = 0; offset < byteCharacters.length; offset += sliceSize) {
      const slice = byteCharacters.slice(offset, offset + sliceSize);
      const byteNumbers = new Array(slice.length);
      for (let i = 0; i < slice.length; i++) {
        byteNumbers[i] = slice.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      byteArrays.push(byteArray);
    }
    return new Blob(byteArrays, {type: contentType});
  }

  // UazAPI V6 envia messageType em PascalCase (ex: "AudioMessage", "ImageMessage", "Conversation")
  // Normalizar para lowercase para comparação consistente
  const rawMsgType = rawMsgObj?.messageType || rawMsgObj?.type || '';
  const msgType = rawMsgType.toLowerCase();
  // UazAPI também tem campo mediaType com valores como "ptt", "image", "video", "audio"
  const mediaType = (rawMsgObj?.mediaType || '').toLowerCase();
  const messageId = rawMsgObj?.messageid || rawMsgObj?.id?.id || rawMsgObj?.key?.id || '';

  console.log(`[Webhook] msgType: "${rawMsgType}" → "${msgType}", mediaType: "${mediaType}", messageId: "${messageId}"`);

  const baseUrl = (waInstance.api_url || Deno.env.get('EVOLUTION_API_URL') || '').replace(/\/$/, '')
  const instKey = waInstance.api_key_encrypted || Deno.env.get('EVOLUTION_API_KEY') || ''
  const phoneNumber = remoteJid.replace(/@.*$/, '').replace(/\D/g, '')
  // Normaliza para o formato sem DDI "55" — crm_leads armazena sem prefixo (ex: "12996200820")
  const crmPhone = (phoneNumber.startsWith('55') && (phoneNumber.length === 13 || phoneNumber.length === 12))
    ? phoneNumber.slice(2)
    : phoneNumber
  const openaiApiKey = Deno.env.get('OPENAI_API_KEY')
  if (!openaiApiKey) return new Response('Missing AI Key', { status: 500 })

  let finalUserText = userText;
  let userMessageContentForOpenAi: any = finalUserText;

  // Detectar mídia: UazAPI envia "AudioMessage"/"ImageMessage" em messageType, ou "ptt"/"image" em mediaType
  const isAudio = msgType.includes('audio') || msgType === 'ptt' || mediaType === 'ptt' || mediaType === 'audio';
  const isImage = msgType.includes('image') || mediaType === 'image';

  // Process Media se houver
  // UazAPI V6: content é um objeto com URL, mimetype, mediaKey, etc. para mídia
  const contentObj = (typeof rawMsgObj?.content === 'object' && rawMsgObj?.content) || {};
  let mediaMimetype = contentObj.mimetype || rawMsgObj?.mimetype || '';

  if (isAudio || isImage) {
    console.log(`[Webhook] 📎 Mídia detectada: isAudio=${isAudio}, isImage=${isImage}, mime=${mediaMimetype}`);
    let base64 = rawMsgObj?.base64 || rawMsgObj?.message?.base64 || '';

    // Se não veio base64, baixar via UazAPI V6: POST /message/download
    // Testado e confirmado: endpoint aceita {id: messageId, return_base64: true}
    // Resposta: {base64Data: "...", mimetype: "...", fileURL: "...", transcription: "..."}
    if (!base64 && messageId) {
      console.log(`[Webhook] Baixando mídia ID: ${messageId}, type: ${msgType}`);

      try {
        const dRes = await fetch(`${baseUrl}/message/download`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'token': instKey },
          body: JSON.stringify({ id: messageId, return_base64: true })
        });

        if (dRes.ok) {
          const dData = await dRes.json();
          // UazAPI V6 retorna base64Data (não base64)
          base64 = dData.base64Data || dData.base64 || dData.file || '';
          // Atualizar mimetype se veio na resposta
          if (dData.mimetype) {
            mediaMimetype = dData.mimetype;
          }
          console.log(`[Webhook] ✅ Mídia baixada! length: ${base64.length}, mime: ${dData.mimetype || 'N/A'}, cached: ${dData.cached || false}`);

          // UazAPI V6 pode incluir transcrição automática para áudio
          if (isAudio && dData.transcription && !finalUserText) {
            console.log(`[Webhook] UazAPI já transcreveu o áudio: "${dData.transcription}"`);
          }
        } else {
          const errText = await dRes.text();
          console.error(`[Webhook] ❌ Download falhou: ${dRes.status} - ${errText}`);
        }
      } catch (err) {
        console.error('[Webhook] ❌ Erro no download de mídia:', err);
      }

      if (!base64) {
        console.error(`[Webhook] FALHA: Não foi possível baixar mídia ${msgType} ID: ${messageId}`);
      }
    }

    if (base64) {
      if (isAudio) {
        try {
          const audioMime = mediaMimetype || 'audio/ogg';
          const blob = b64toBlob(base64, audioMime);
          const formData = new FormData();
          formData.append('file', blob, 'audio.ogg');
          formData.append('model', 'whisper-1');

          console.log(`[Webhook] 🎤 Enviando áudio para Whisper (${base64.length} chars base64, mime: ${audioMime})...`);
          const wRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${openaiApiKey}` },
            body: formData
          });
          const wData = await wRes.json();
          if (wData.text) {
             finalUserText = wData.text;
             userMessageContentForOpenAi = finalUserText;
             console.log('[Webhook] ✅ Transcrição (Whisper):', finalUserText);
          } else {
             console.error('[Webhook] ❌ Whisper não retornou texto:', JSON.stringify(wData));
          }
        } catch(err) {
          console.error('[Webhook] Erro no Whisper:', err);
        }
      } else if (isImage) {
        // UazAPI V6: mimetype pode estar em content.mimetype ou rawMsgObj.mimetype
        const mimeType = mediaMimetype || rawMsgObj?.mimetype || 'image/jpeg';
        finalUserText = finalUserText || '[Imagem recebida]';
        userMessageContentForOpenAi = [
          { type: "text", text: finalUserText },
          { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64}` } }
        ];
        console.log(`[Webhook] 🖼️ Imagem preparada para visão (mime: ${mimeType}, base64 length: ${base64.length})`);
      }
    }
  }

  if (!finalUserText && typeof userMessageContentForOpenAi === 'string') {
    if (isAudio || isImage) {
      console.error(`[Webhook] ⚠️ Mídia ${msgType} recebida mas não foi possível processar (download/transcrição falhou). Mensagem ignorada.`);
    } else {
      console.log('[Webhook] Empty text message — ignorando');
    }
    return new Response('Empty text', { headers: corsHeaders });
  }

  console.log(`[Webhook] Salvando histórico e chamando OpenAI para: ${finalUserText}`);

  // Salvar histórico
  await supabase.from('wa_chat_history').insert({
    user_id: agent.user_id,
    agent_id: agent.id,
    instance_id: instanceName,
    remote_jid: remoteJid,
    role: 'user',
    content: typeof userMessageContentForOpenAi === 'string' ? finalUserText : '[Mídia/Imagem]',
    lead_name: pushName
  })

  // Salvar mensagem RECEBIDA no wa_inbox (para aparecer no Inbox do Marcos)
  const incomingMediaType = isAudio ? 'audio' : (isImage ? 'image' : 'text');
  // Para mídia, extrair URL se disponível no payload UazAPI (content.URL ou directUrl)
  const incomingMediaUrl = contentObj.URL || rawMsgObj?.mediaUrl || rawMsgObj?.directUrl || rawMsgObj?.media_url || rawMsgObj?.url || null;
  await supabase.from('wa_inbox').insert({
    user_id: waInstance.user_id,
    instance_id: waInstance.id,
    phone: phoneNumber,
    contact_name: pushName || null,
    direction: 'incoming',
    message_type: incomingMediaType,
    content: typeof userMessageContentForOpenAi === 'string' ? finalUserText : (incomingMediaType === 'image' ? '[Imagem recebida]' : '[Áudio recebido]'),
    media_url: incomingMediaUrl,
    is_read: false,
    remote_message_id: messageId || null,
  }).then(({ error }: any) => {
    if (error) console.error('[uazapi-webhook] wa_inbox incoming insert error:', error.message);
  });

  // Buscar histórico
  const { data: pausedLead } = await supabase
    .from('ai_crm_leads')
    .select('ai_paused')
    .eq('agent_id', agent.id)
    .eq('remote_jid', remoteJid)
    .maybeSingle();

  if (pausedLead?.ai_paused) {
    console.log(`[Webhook] IA pausada para ${remoteJid}. Mensagem registrada, resposta automatica ignorada.`);
    return new Response(JSON.stringify({ ok: true, ai_paused: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  const { data: history } = await supabase.from('wa_chat_history')
    .select('role, content').eq('instance_id', instanceName).eq('remote_jid', remoteJid).order('created_at', { ascending: false }).limit(10)

  const chatHistory = (history || []).reverse().map((m: any) => ({ role: m.role, content: m.content }))

  // RAG - Busca Base de Conhecimento
  let knowledgeContext = ''
  try {
    const { data: agentKbs } = await supabase.from('agent_knowledge_bases').select('kb_id').eq('agent_id', agent.id)
    const kbIds = (agentKbs || []).map((k: any) => k.kb_id)

    if (kbIds.length > 0) {
      const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')
      if (OPENAI_API_KEY) {
        const embedRes = await fetch('https://api.openai.com/v1/embeddings', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: 'text-embedding-3-small', input: userText.slice(0, 8000) })
        })
        if (embedRes.ok) {
          const embedData = await embedRes.json()
          const { data: chunks } = await supabase.rpc('search_knowledge', {
            query_embedding: embedData.data[0].embedding, kb_ids: kbIds, match_threshold: 0.60, match_count: 5
          })
          if (chunks && chunks.length > 0) knowledgeContext = chunks.map((c: any) => c.content).join('\n\n---\n\n')
        }
      }
    }
  } catch (err: any) {}

  let systemPrompt = agent.system_prompt || 'Você é um assistente prestativo.'
  if (agent.company_name) systemPrompt += `\n\nEmpresa: ${agent.company_name}`
  if (knowledgeContext) systemPrompt += `\n\n## BASE DE CONHECIMENTO:\n${knowledgeContext}`

  // ── BNDV: Check if user has BNDV integration and append system prompt instruction ──
  let hasBndvIntegration = false;
  try {
    const { data: bndvInteg } = await supabase
      .from('platform_integrations')
      .select('id')
      .eq('user_id', agent.user_id)
      .eq('platform', 'bndv')
      .maybeSingle();
    if (bndvInteg) {
      hasBndvIntegration = true;
      systemPrompt += `\n\nFERRAMENTA DE ESTOQUE BNDV:\nVocê tem acesso à ferramenta "consultar_estoque_bndv". USE quando o cliente perguntar sobre carros, preço, estoque, opções disponíveis. Nunca invente estoque sem consultar. Após consultar, as fotos dos veículos serão enviadas automaticamente.`;
    }
  } catch (bndvCheckErr) {
    console.error('[Webhook] Erro ao verificar integração BNDV:', bndvCheckErr);
  }

  let aiModel = agent.model || 'gpt-4o';
  // Fallbacks para evitar crashes na OpenAI caso o frontend envie modelos do Google/Anthropic
  if (aiModel.startsWith('openai/')) {
    aiModel = aiModel.replace('openai/', '');
  } else if (aiModel.includes('google/') || aiModel.includes('anthropic/')) {
    // Fallback para gpt-4o (NÃO gpt-4o-mini) para manter capacidade de visão/imagem
    console.log(`[Webhook] Aviso: Modelo externo (${aiModel}) detectado no endpoint OpenAI nativo. Fazendo fallback para gpt-4o (com visão).`);
    aiModel = 'gpt-4o';
  }

  // Se temos uma imagem para analisar, garantir que o modelo suporta visão
  const hasImageContent = Array.isArray(userMessageContentForOpenAi) && userMessageContentForOpenAi.some((c: any) => c.type === 'image_url');
  if (hasImageContent && (aiModel === 'gpt-4o-mini' || aiModel === 'gpt-3.5-turbo')) {
    console.log(`[Webhook] Imagem detectada — upgrade de ${aiModel} para gpt-4o para suporte a visão`);
    aiModel = 'gpt-4o';
  }

  if (hasImageContent) {
    console.log(`[Webhook] 🖼️ Enviando imagem para análise com modelo: ${aiModel}`);
  }

  const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openaiApiKey}` },
    body: JSON.stringify({
      model: aiModel,
      messages: [{ role: 'system', content: systemPrompt }, ...chatHistory, { role: 'user', content: userMessageContentForOpenAi }],
      temperature: agent.temperature || 0.7,
      tools: tools,
      tool_choice: "auto"
    })
  })

  if (!openaiRes.ok) {
    const errText = await openaiRes.text();
    console.error(`[Webhook] OpenAI Erro: ${openaiRes.status} - ${errText}`);
    return new Response('OpenAI erro', { status: 500 });
  }
  const openaiData = await openaiRes.json()
  const aiMessage = openaiData.choices?.[0]?.message

  console.log(`[Webhook] Resposta da IA recebida. ToolCalls: ${aiMessage?.tool_calls?.length || 0}`);

  let aiResponse = aiMessage?.content || ''

  // ── Variable to hold BNDV results for image sending after text response ──
  let bndvResultForImages: any = null;

  // Verificar se o modelo decidiu chamar ferramentas
  if (aiMessage?.tool_calls && aiMessage.tool_calls.length > 0) {

    // ── BNDV Tool Call ──────────────────────────────────────────────────
    const bndvToolCall = aiMessage.tool_calls.find((t: any) => t.function.name === 'consultar_estoque_bndv');
    if (bndvToolCall) {
      try {
        const bndvArgs = JSON.parse(bndvToolCall.function.arguments);
        console.log(`[BNDV] Tool call com args:`, JSON.stringify(bndvArgs));

        const bndvResult = await consultarEstoqueBndv(supabase, agent.user_id, bndvArgs);
        console.log(`[BNDV] Resultado: success=${bndvResult.success}, total=${bndvResult.total}`);

        // Store for image sending later
        if (bndvResult.success && bndvResult.items.length > 0) {
          bndvResultForImages = bndvResult;
        }

        // Build tool messages for OpenAI follow-up
        const toolMessages: any[] = [
          { role: 'system', content: systemPrompt },
          ...chatHistory,
          { role: 'user', content: userMessageContentForOpenAi },
          aiMessage,
          {
            role: 'tool',
            tool_call_id: bndvToolCall.id,
            name: 'consultar_estoque_bndv',
            content: JSON.stringify(bndvResult),
          },
        ];

        // If there was also a CRM tool call, add its result too
        const crmToolCallInBndv = aiMessage.tool_calls.find((t: any) => t.function.name === 'atualizar_etapa_crm');
        if (crmToolCallInBndv) {
          toolMessages.push({
            role: 'tool',
            tool_call_id: crmToolCallInBndv.id,
            name: 'atualizar_etapa_crm',
            content: '{"success": true}',
          });
        }

        // Get follow-up text response from OpenAI
        const bndvFollowupRes = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openaiApiKey}` },
          body: JSON.stringify({
            model: aiModel,
            messages: toolMessages,
            temperature: agent.temperature || 0.7,
          }),
        });

        if (bndvFollowupRes.ok) {
          const bndvFollowupData = await bndvFollowupRes.json();
          const bndvTextResponse = bndvFollowupData.choices?.[0]?.message?.content || '';
          if (bndvTextResponse) {
            aiResponse = bndvTextResponse;
            console.log(`[BNDV] Resposta de texto gerada (${aiResponse.length} chars)`);
          }
        }
      } catch (bndvErr) {
        console.error('[BNDV] Erro ao processar tool call:', bndvErr);
      }
    }

    // ── CRM Tool Call (atualizar_etapa_crm) ─────────────────────────────
    const toolCall = aiMessage.tool_calls.find((t: any) => t.function.name === 'atualizar_etapa_crm');
    if (toolCall) {
      try {
        const args = JSON.parse(toolCall.function.arguments);

        // 1. Atualizar banco de dados CRM (arrastar cartão para a coluna correta)
        // Mantém status_crm sincronizado com status, exceto se já estiver
        // explicitamente definido pelo vendedor (negociacao, fechado, etc.)
        const statusCrmMap: Record<string, string> = {
          interessado: 'interessado',
          qualificado: 'qualificado',
          encerrado:   'perdido',
        };
        await supabase.from('ai_crm_leads').update({
          status: args.status,
          status_crm: statusCrmMap[args.status] || args.status,
          summary: args.resumo,
          last_interaction_at: new Date().toISOString()
        }).eq('agent_id', agent.id).eq('remote_jid', remoteJid);

        console.log(`[CRM] Lead ${phoneNumber} movido para: ${args.status}`);

        // 2. Alertar vendedor APENAS SE status for 'qualificado'
        if (args.status === 'qualificado') {
          try {
            console.log(`[Transfer] Qualificado. agent.id=${agent.id} agent.user_id=${agent.user_id}`);

            // ── Busca lead e detecta se é retorno ─────────────────────────
            const { data: leadRow } = await supabase
              .from('ai_crm_leads').select('id')
              .eq('agent_id', agent.id).eq('remote_jid', remoteJid).maybeSingle();

            let skipTransfer = false;
            let isReturnLead = false;
            let returnSeller: any = null;

            if (leadRow?.id) {
              // Tem transfer PENDENTE? → duplicata, ignorar
              const { data: pendingTransfer } = await supabase
                .from('ai_lead_transfers').select('id')
                .eq('lead_id', leadRow.id)
                .eq('transfer_status', 'pending')
                .maybeSingle();

              if (pendingTransfer) {
                console.log(`[Transfer] Lead já tem transfer pendente — ignorando duplicata`);
                skipTransfer = true;
              } else {
                // Tem transfer CONFIRMADO? → lead retornou, vai para o mesmo vendedor
                const { data: lastConfirmed } = await supabase
                  .from('ai_lead_transfers').select('to_member_id')
                  .eq('lead_id', leadRow.id)
                  .eq('transfer_status', 'confirmed')
                  .order('created_at', { ascending: false })
                  .limit(1).maybeSingle();

                if (lastConfirmed?.to_member_id) {
                  const { data: prevSeller } = await supabase
                    .from('ai_team_members').select('*')
                    .eq('id', lastConfirmed.to_member_id)
                    .maybeSingle();

                  if (prevSeller?.is_active) {
                    isReturnLead = true;
                    returnSeller = prevSeller;
                    console.log(`[Transfer] Lead retornou — reencaminhando para ${prevSeller.name}`);
                  }
                }
              }
            }

            if (!skipTransfer) {
              const timeoutAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

              if (isReturnLead && returnSeller) {
                // ── LEAD RETORNOU: vai direto ao vendedor que já o atendeu ─
                await supabase.from('ai_lead_transfers').insert({
                  user_id: agent.user_id,
                  lead_id: leadRow?.id || null,
                  to_member_id: returnSeller.id,
                  transfer_reason: 'round_robin',
                  notes: `Retorno do lead — reencaminhado para ${returnSeller.name}`,
                  transfer_status: 'pending',
                  is_confirmed: false,
                  confirmation_timeout_at: timeoutAt,
                });

                await supabase.from('ai_crm_leads').update({
                  status: 'transferido',
                  assigned_to_id: returnSeller.id,
                }).eq('agent_id', agent.id).eq('remote_jid', remoteJid);

                let sellerNum = returnSeller.whatsapp_number.replace(/\D/g, '');
                if (sellerNum.length === 10 || sellerNum.length === 11) sellerNum = `55${sellerNum}`;

                const returnMsg =
                  `🔄 *RETORNO DE LEAD — JÁ É SEU CONTATO*\n\n` +
                  `*Nome:* ${pushName}\n` +
                  `*Telefone:* ${phoneNumber}\n\n` +
                  `📝 *O que ele quer agora:*\n${args.resumo}\n\n` +
                  `👉 *Atender:* https://wa.me/${phoneNumber}\n\n` +
                  `⏰ *Responda em até 15 minutos para confirmar o recebimento.*`;

                const sendRes = await fetch(`${baseUrl}/send/text`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', 'token': instKey },
                  body: JSON.stringify({ number: sellerNum, text: returnMsg }),
                });
                console.log(`[Transfer] 🔄 Retorno → ${returnSeller.name} (HTTP ${sendRes.status})`);

                // Notifica gerente sobre o retorno
                if (agent.gerente_phone) {
                  try {
                    const transferredAt = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
                    let gerenteNum = String(agent.gerente_phone).replace(/\D/g, '');
                    if (gerenteNum.length === 10 || gerenteNum.length === 11) gerenteNum = `55${gerenteNum}`;

                    const gerenteMsg =
                      `🔄 *RETORNO DE LEAD — ${agent.name}*\n\n` +
                      `🕐 *Horário:* ${transferredAt}\n\n` +
                      `👤 *Lead:* ${pushName}\n` +
                      `📱 *Telefone:* wa.me/${phoneNumber}\n` +
                      `${args.resumo ? `\n📝 *O que ele quer agora:* ${args.resumo.substring(0, 300)}\n` : ''}` +
                      `\n━━━━━━━━━━━━━━━━━━━━\n\n` +
                      `🎯 *Reencaminhado para:* ${returnSeller.name}\n` +
                      `\n━━━━━━━━━━━━━━━━━━━━\n` +
                      `_Gerado automaticamente pelo Pedro SDR_`;

                    await fetch(`${baseUrl}/send/text`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json', 'token': instKey },
                      body: JSON.stringify({ number: gerenteNum, text: gerenteMsg }),
                    });
                  } catch (gerenteErr) {
                    console.error('[Transfer] Falha ao notificar gerente (retorno):', gerenteErr);
                  }
                }

                // Atualiza CRM do Marcos com novo resumo
                try {
                  const { data: crmExisting } = await supabase
                    .from('crm_leads').select('id')
                    .eq('user_id', agent.user_id).eq('phone', crmPhone).maybeSingle();
                  const crmNotes = `Vendedor: ${returnSeller.name}\nAgente IA: ${agent.name}${args.resumo ? `\n\nRetorno — ${args.resumo}` : ''}`;
                  if (crmExisting?.id) {
                    await supabase.from('crm_leads').update({ notes: crmNotes }).eq('id', crmExisting.id);
                  }
                } catch (crmErr) {
                  console.error('[Transfer] Erro ao atualizar CRM Marcos (retorno):', crmErr);
                }

              } else {
                // ── LEAD NOVO: round-robin normal ─────────────────────────
                let { data: sellers, error: sellersErr } = await supabase
                  .from('ai_team_members').select('*')
                  .eq('agent_id', agent.id).eq('is_active', true)
                  .order('last_lead_received_at', { ascending: true, nullsFirst: true });

                console.log(`[Transfer] Vendedores por agent_id: ${sellers?.length ?? 0}${sellersErr ? ' | erro: ' + sellersErr.message : ''}`);

                if (!sellers || sellers.length === 0) {
                  console.warn(`[Transfer] Fallback por user_id=${agent.user_id}...`);
                  const { data: fallbackSellers } = await supabase
                    .from('ai_team_members').select('*')
                    .eq('user_id', agent.user_id).eq('is_active', true)
                    .order('last_lead_received_at', { ascending: true, nullsFirst: true });
                  sellers = fallbackSellers;
                  console.log(`[Transfer] Vendedores por user_id: ${sellers?.length ?? 0}`);
                }

                const { data: recentTransfers } = await supabase
                  .from('ai_lead_transfers').select('to_member_id, created_at')
                  .eq('user_id', agent.user_id)
                  .order('created_at', { ascending: false }).limit(100);

                const lastMap = new Map<string, number>();
                for (const t of (recentTransfers || [])) {
                  if (t.to_member_id && !lastMap.has(t.to_member_id))
                    lastMap.set(t.to_member_id, new Date(t.created_at).getTime());
                }
                const activeSellers = sellers || [];
                const neverReceived = activeSellers.filter((s: any) => !lastMap.has(s.id));
                const nextSeller = neverReceived.length > 0
                  ? neverReceived[0]
                  : [...activeSellers].sort((a: any, b: any) => (lastMap.get(a.id) || 0) - (lastMap.get(b.id) || 0))[0] || null;

                console.log(`[Transfer] nextSeller=${nextSeller ? nextSeller.name : 'NULO'} | total ativos=${activeSellers.length}`);

                if (nextSeller) {
                  await supabase.from('ai_lead_transfers').insert({
                    user_id: agent.user_id,
                    lead_id: leadRow?.id || null,
                    to_member_id: nextSeller.id,
                    transfer_reason: 'round_robin',
                    notes: `Qualificado por ${agent.name}`,
                    transfer_status: 'pending',
                    is_confirmed: false,
                    confirmation_timeout_at: timeoutAt,
                  });

                  await supabase.from('ai_crm_leads').update({
                    status: 'transferido',
                    assigned_to_id: nextSeller.id,
                  }).eq('agent_id', agent.id).eq('remote_jid', remoteJid);

                  let sellerNum = nextSeller.whatsapp_number.replace(/\D/g, '');
                  if (sellerNum.length === 10 || sellerNum.length === 11) sellerNum = `55${sellerNum}`;

                  const sellerMsg =
                    `🚨 *LEAD QUALIFICADO — VOCÊ É O PRÓXIMO DA FILA*\n\n` +
                    `*Agente IA:* ${agent.name}\n` +
                    `*Nome:* ${pushName}\n` +
                    `*Contato:* ${phoneNumber}\n\n` +
                    `📝 *Resumo:*\n${args.resumo}\n\n` +
                    `👉 *Atender:* https://wa.me/${phoneNumber}\n\n` +
                    `⏰ *Responda esta mensagem em até 15 minutos para confirmar o recebimento. Se não responder, o lead passa para o próximo da fila.*`;

                  const sendRes = await fetch(`${baseUrl}/send/text`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'token': instKey },
                    body: JSON.stringify({ number: sellerNum, text: sellerMsg }),
                  });
                  console.log(`[Transfer] ✅ ${nextSeller.name} → HTTP ${sendRes.status}`);

                  // Notifica Gerente
                  if (agent.gerente_phone) {
                    try {
                      const transferredAt = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
                      let gerenteNum = String(agent.gerente_phone).replace(/\D/g, '');
                      if (gerenteNum.length === 10 || gerenteNum.length === 11) gerenteNum = `55${gerenteNum}`;

                      const gerenteMsg =
                        `📊 *RELATÓRIO DE LEAD — ${agent.name}*\n\n` +
                        `🕐 *Horário:* ${transferredAt}\n\n` +
                        `👤 *Lead:* ${pushName}\n` +
                        `📱 *Telefone:* wa.me/${phoneNumber}\n` +
                        `📊 *Status:* qualificado\n` +
                        `${args.resumo ? `\n📝 *Resumo:* ${args.resumo.substring(0, 300)}\n` : ''}` +
                        `\n━━━━━━━━━━━━━━━━━━━━\n\n` +
                        `🎯 *Enviado para:* ${nextSeller.name}\n` +
                        `📲 *WhatsApp vendedor:* ${nextSeller.whatsapp_number}\n` +
                        `\n━━━━━━━━━━━━━━━━━━━━\n` +
                        `_Gerado automaticamente pelo Pedro SDR_`;

                      const gerenteRes = await fetch(`${baseUrl}/send/text`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'token': instKey },
                        body: JSON.stringify({ number: gerenteNum, text: gerenteMsg }),
                      });
                      console.log(`[Transfer] WA gerente → HTTP ${gerenteRes.status}`);
                    } catch (gerenteErr) {
                      console.error('[Transfer] Falha ao notificar gerente:', gerenteErr);
                    }
                  }

                  // Push CRM Marcos
                  try {
                    const { data: firstStage } = await supabase
                      .from('crm_pipeline_stages').select('id')
                      .eq('user_id', agent.user_id)
                      .order('position', { ascending: true }).limit(1).maybeSingle();

                    const { data: crmExisting } = await supabase
                      .from('crm_leads').select('id')
                      .eq('user_id', agent.user_id).eq('phone', crmPhone).maybeSingle();

                    const crmNotes = `Vendedor: ${nextSeller.name}\nAgente IA: ${agent.name}${args.resumo ? `\n\nResumo: ${args.resumo}` : ''}`;
                    const crmTags  = ['Pedro SDR', nextSeller.name];

                    if (crmExisting?.id) {
                      await supabase.from('crm_leads')
                        .update({ notes: crmNotes, tags: crmTags }).eq('id', crmExisting.id);
                    } else {
                      const { data: maxPosRow } = await supabase
                        .from('crm_leads').select('position')
                        .eq('user_id', agent.user_id).eq('stage_id', firstStage?.id || null)
                        .order('position', { ascending: false }).limit(1).maybeSingle();
                      await supabase.from('crm_leads').insert({
                        user_id: agent.user_id, stage_id: firstStage?.id || null,
                        name: pushName, phone: crmPhone,
                        source: `Pedro SDR — ${agent.name}`,
                        notes: crmNotes, tags: crmTags,
                        value: 0, currency: 'BRL', priority: 'medium',
                        position: (maxPosRow?.position ?? -1) + 1,
                      });
                    }
                    console.log(`[Transfer] Lead ${pushName} (${crmPhone}) → CRM Marcos (${nextSeller.name})`);
                  } catch (crmErr) {
                    console.error('[Transfer] Erro ao enviar lead ao CRM do Marcos:', crmErr);
                  }
                } else {
                  console.warn(`[Transfer] ⚠️ Nenhum vendedor ativo. agent_id=${agent.id} user_id=${agent.user_id}`);
                }
              }
            } // ── fecha if (!skipTransfer) ──────────────────────────────────
          } catch (transferErr) {
            console.error('[Transfer] Erro no round-robin:', transferErr);
          }
          // Se qualificou, substituir a resposta para a de Handoff
          aiResponse = handoffMsg;
        } else if (!aiResponse && !bndvToolCall) {
          // Se não é qualificado, e o GPT não retornou texto (só o tool_call), devemos devolver o resultado da tool e pedir o texto!
          // Only do this if we didn't already handle via BNDV tool call
          console.log(`[Webhook] IA apenas executou a tool sem texto. Solicitando resposta final...`);
          const secondRes = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openaiApiKey}` },
            body: JSON.stringify({
              model: aiModel,
              messages: [
                { role: 'system', content: systemPrompt },
                ...chatHistory,
                { role: 'user', content: userMessageContentForOpenAi },
                aiMessage,
                { role: 'tool', tool_call_id: toolCall.id, name: toolCall.function.name, content: `{"success": true}` }
              ],
              temperature: agent.temperature || 0.7
            })
          });
          if (secondRes.ok) {
            const secondData = await secondRes.json();
            aiResponse = secondData.choices?.[0]?.message?.content || '';
            console.log(`[Webhook] Resposta final capturada: ${aiResponse}`);
          }
        }
      } catch (err) {
        console.error("[Webhook] Erro no Handoff/CRM", err)
      }
    }
  }

  if (!aiResponse) return new Response('No AI Response', { headers: corsHeaders })

  // Salvar no histórico
  await supabase.from('wa_chat_history').insert({
    user_id: agent.user_id, agent_id: agent.id, instance_id: instanceName,
    remote_jid: remoteJid, role: 'assistant', content: aiResponse
  })

  // ── CRITICAL: Atualiza last_agent_reply_at para regra de 5min/10min ──
  // O cron-lead-followup usa este campo para saber quando o agente IA respondeu pela última vez
  const agentReplyTs = new Date().toISOString();
  await supabase.from('ai_crm_leads').update({
    last_agent_reply_at: agentReplyTs,
    last_interaction_at: agentReplyTs,
  }).eq('agent_id', agent.id).eq('remote_jid', remoteJid);

  // Salvar resposta do AGENTE IA no wa_inbox (para aparecer no Inbox do Marcos)
  await supabase.from('wa_inbox').insert({
    user_id: waInstance.user_id,
    instance_id: waInstance.id,
    phone: phoneNumber,
    contact_name: pushName || null,
    direction: 'outgoing',
    message_type: 'text',
    content: aiResponse,
    is_read: true,
    ai_category: 'agent',
  }).then(({ error }: any) => {
    if (error) console.error('[uazapi-webhook] wa_inbox outgoing insert error:', error.message);
  });

  // Enviar para o cliente final
  try {
    await fetch(`${baseUrl}/send/text`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'token': instKey },
      body: JSON.stringify({ number: phoneNumber, text: aiResponse })
    })
  } catch (e) {
    console.error('[Webhook] Erro ao enviar mensagem:', e)
  }

  // ── BNDV: Send vehicle images after text response ─────────────────────
  if (bndvResultForImages && bndvResultForImages.items.length > 0) {
    console.log(`[BNDV-IMG] Enviando fotos de ${Math.min(3, bndvResultForImages.items.length)} veículos...`);
    const vehiclesToSend = bndvResultForImages.items.slice(0, 3);
    for (const vehicle of vehiclesToSend) {
      if (vehicle.principal_image) {
        try {
          const caption = `${vehicle.marca} ${vehicle.modelo} ${vehicle.versao} ${vehicle.ano}\n💰 R$ ${vehicle.preco.toLocaleString('pt-BR')}\n🔄 ${vehicle.km.toLocaleString('pt-BR')} km | ⛽ ${vehicle.combustivel} | 🎨 ${vehicle.cor}`;
          const imageSent = await sendVehicleImage(baseUrl, instKey, instanceName, phoneNumber, remoteJid, vehicle.principal_image, caption);
          if (imageSent) {
            await supabase.from('wa_inbox').insert({
              user_id: waInstance.user_id,
              instance_id: waInstance.id,
              phone: phoneNumber,
              contact_name: pushName || null,
              direction: 'outgoing',
              message_type: 'image',
              content: caption,
              media_url: vehicle.principal_image,
              is_read: true,
              ai_category: 'agent',
            }).then(({ error }: any) => {
              if (error) console.error('[uazapi-webhook] wa_inbox image insert error:', error.message);
            });
          }
        } catch (imgErr) {
          console.error(`[BNDV-IMG] Erro ao enviar imagem de ${vehicle.label}:`, imgErr);
        }
      }
    }
  }

  return new Response(JSON.stringify({ success: true }), { headers: corsHeaders, status: 200 })
}
