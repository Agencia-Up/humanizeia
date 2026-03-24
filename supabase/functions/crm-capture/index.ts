import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const body = await req.json()
    const { user_id, name, email, phone, company, value, source, priority, custom_fields, utm_source, utm_campaign } = body

    if (!user_id || !name) {
      return new Response(
        JSON.stringify({ error: 'user_id and name are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 1. Get the first stage (Novo Lead) for this user to ensure we have a stage_id
    const { data: stages, error: stageError } = await supabaseClient
      .from('crm_pipeline_stages')
      .select('id')
      .eq('user_id', user_id)
      .order('position', { ascending: true })
      .limit(1)

    if (stageError || !stages || stages.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No pipeline stages found for this user' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const stage_id = stages[0].id

    // 2. Insert the Lead
    const { data: lead, error: insertError } = await supabaseClient
      .from('crm_leads')
      .insert({
        user_id,
        stage_id,
        name,
        email,
        phone,
        company,
        value: value || 0,
        source: source || 'external_form',
        priority: priority || 'medium',
        custom_fields: custom_fields || {},
        utm_source,
        utm_campaign,
        position: 0 // Will be at the top
      })
      .select()
      .single()

    if (insertError) {
      throw insertError
    }

    // 3. Trigger Webhook Automations (Same logic as useFluxCRM.ts)
    const { data: automations } = await supabaseClient
      .from('wa_automations')
      .select('*')
      .eq('user_id', user_id)
      .eq('is_active', true)
      .eq('trigger_event', 'new_lead')
      .eq('action_type', 'notify_webhook')
      
    if (automations && automations.length > 0) {
      for (const auto of automations) {
        const config = auto.action_config as Record<string, any>
        if (config?.webhook_url) {
          console.log(`Triggering webhook for lead ${lead.id} to ${config.webhook_url}`)
          fetch(config.webhook_url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lead, event: 'new_lead' })
          }).catch(err => console.error(`Webhook error for ${config.webhook_url}:`, err))
        }
      }
    }

    return new Response(
      JSON.stringify({ success: true, lead_id: lead.id }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Error processing lead capture:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
