import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { instance_name, friendly_name, user_id, agent_id, api_url, api_key } = await req.json()

    const baseUrl = (api_url || Deno.env.get('EVOLUTION_API_URL') || 'https://logos-ia.uazapi.com').replace(/\/$/, '')
    const adminToken = api_key || Deno.env.get('EVOLUTION_API_KEY') || ''
    const supabaseUrl = (Deno.env.get('SUPABASE_URL') || '').replace(/\/$/, '')
    const webhookUrl = `${supabaseUrl}/functions/v1/uazapi-webhook`

    console.log(`[Uazapi V8] Criando instância: ${instance_name} em ${baseUrl}`)

    // ============================================================
    // PASSO 1: Criar instância via POST /instance/create (admintoken)
    // ============================================================
    const createRes = await fetch(`${baseUrl}/instance/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'admintoken': adminToken,
      },
      body: JSON.stringify({
        name: instance_name,
        systemName: 'uazapiGO',
        adminField01: '',
        adminField02: '',
      }),
    })

    const createText = await createRes.text()
    console.log(`[Uazapi V8] POST /instance/create (${createRes.status}): ${createText.substring(0, 300)}`)

    let createData: any = {}
    try { createData = JSON.parse(createText) } catch(_) {}

    if (!createRes.ok && createRes.status !== 208) {
      // Verificar se instância já existe (208 Already Reported)
      if (createRes.status !== 208) {
        throw new Error(`Falha ao criar instância: ${createRes.status} — ${createText.substring(0, 200)}`)
      }
    }

    // Extrair token da instância retornado pela Uazapi
    const instanceToken = createData?.token || createData?.instance?.token || createData?.data?.token || ''
    console.log(`[Uazapi V8] Token da instância: ${instanceToken ? instanceToken.substring(0, 8) + '...' : 'NÃO ENCONTRADO'}`)

    if (!instanceToken) {
      throw new Error(`Token da instância não retornado. Resposta: ${createText.substring(0, 300)}`)
    }

    // ============================================================
    // PASSO 2: Salvar instância no banco ANTES de configurar webhook
    // Não usa upsert com onConflict pois não há UNIQUE constraint em instance_name
    // ============================================================
    let waInstance: any = null

    // Tentar inserir novo registro
    const { data: inserted, error: insertError } = await supabase
      .from('wa_instances')
      .insert({
        instance_name,
        friendly_name: friendly_name || instance_name,
        user_id,
        api_url: baseUrl,
        api_key_encrypted: instanceToken,
        status: 'waiting_qr',
        is_active: false,
        updated_at: new Date().toISOString(),
      })
      .select()
      .single()

    if (insertError) {
      // Tentar buscar instância já existente com esse nome
      console.warn('[Uazapi V8] Insert falhou, tentando buscar existente:', insertError.message)
      const { data: existing } = await supabase
        .from('wa_instances')
        .select()
        .eq('instance_name', instance_name)
        .eq('user_id', user_id)
        .single()

      if (existing) {
        // Atualizar o token e status da instância existente
        const { data: updated } = await supabase
          .from('wa_instances')
          .update({
            api_key_encrypted: instanceToken,
            status: 'waiting_qr',
            is_active: false,
            updated_at: new Date().toISOString(),
          })
          .eq('id', existing.id)
          .select()
          .single()
        waInstance = updated || existing
        console.log('[Uazapi V8] Instância existente atualizada. ID:', waInstance?.id)
      } else {
        throw new Error(`Erro ao salvar no banco: ${insertError.message}`)
      }
    } else {
      waInstance = inserted
      console.log(`[Uazapi V8] Instância inserida no banco. ID: ${waInstance?.id}`)
    }

    // Vincular ao agente (se agent_id fornecido)
    if (agent_id && waInstance?.id) {
      const { data: agent } = await supabase
        .from('wa_ai_agents')
        .select('instance_ids')
        .eq('id', agent_id)
        .single()

      const currentIds: string[] = agent?.instance_ids || []
      if (!currentIds.includes(waInstance.id)) {
        await supabase
          .from('wa_ai_agents')
          .update({ instance_ids: [...currentIds, waInstance.id] })
          .eq('id', agent_id)
        console.log(`[Uazapi V8] Instância vinculada ao agente: ${agent_id}`)
      }
    }

    // ============================================================
    // PASSO 3: Configurar Webhook via POST /webhook (token da instância)
    // ============================================================
    const webhookRes = await fetch(`${baseUrl}/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'token': instanceToken,
      },
      body: JSON.stringify({
        enabled: true,
        url: webhookUrl,
        events: ['messages', 'connection'],
        excludeMessages: ['wasSentByApi'], // Evita loop do bot respondendo a si mesmo
      }),
    })

    const webhookText = await webhookRes.text()
    console.log(`[Uazapi V8] POST /webhook (${webhookRes.status}): ${webhookText.substring(0, 200)}`)

    if (!webhookRes.ok) {
      console.warn(`[Uazapi V8] Webhook não configurado (${webhookRes.status}) — o usuário precisará configurar manualmente`)
    } else {
      console.log('[Uazapi V8] ✅ Webhook configurado com sucesso!')
    }

    // ============================================================
    // PASSO 4: Conectar instância e obter QR Code via POST /instance/connect
    // ============================================================
    const connectRes = await fetch(`${baseUrl}/instance/connect`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'token': instanceToken,
      },
      body: JSON.stringify({}),
    })

    const connectText = await connectRes.text()
    console.log(`[Uazapi V8] POST /instance/connect (${connectRes.status}): ${connectText.substring(0, 300)}`)

    let connectData: any = {}
    try { connectData = JSON.parse(connectText) } catch(_) {}

    // O QR Code pode estar em diferentes campos dependendo da resposta
    const qrCode = connectData?.qrcode || connectData?.qr || connectData?.base64 || connectData?.qrCode || null

    if (qrCode) {
      console.log('[Uazapi V8] ✅ QR Code obtido com sucesso!')
    } else {
      // Instância já pode estar conectada
      const state = (connectData?.status || connectData?.state || '').toLowerCase()
      if (state === 'open' || state === 'connected') {
        console.log('[Uazapi V8] Instância já está conectada!')
        await supabase
          .from('wa_instances')
          .update({ status: 'connected', is_active: true, updated_at: new Date().toISOString() })
          .eq('instance_name', instance_name)
      } else {
        console.log(`[Uazapi V8] QR Code não encontrado. Estado: ${state}. Resposta: ${connectText.substring(0, 200)}`)
      }
    }

    return new Response(JSON.stringify({
      success: true,
      instance_id: waInstance?.id,
      instance_name,
      token: instanceToken,
      qr_code: qrCode,      // Frontend espera qr_code (não qrCode)
      qrCode,               // Manter compatibilidade
      webhook_configured: webhookRes.ok,
      connect_status: connectRes.status,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })

  } catch (error: any) {
    console.error('[Uazapi V8] Erro crítico:', error.message)
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })
  }
})
