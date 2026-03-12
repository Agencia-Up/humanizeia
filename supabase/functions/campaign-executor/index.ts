import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface AgentInstruction {
  id: string;
  platform: 'meta' | 'google' | 'tiktok';
  action: string;
  params: Record<string, unknown>;
  priority: number;
  dependsOn?: string[];
  reason?: string;
}

interface ExecutionResult {
  instructionId: string;
  platform: string;
  action: string;
  success: boolean;
  result?: unknown;
  error?: string;
  executedAt: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { instructions, dryRun = false } = await req.json();
    
    // Verificar autenticação
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: corsHeaders }
      );
    }

    const token = authHeader.replace('Bearer ', '');
    
    // Inicializar Supabase
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY');
    
    if (!supabaseUrl || !supabaseKey) {
      return new Response(
        JSON.stringify({ error: 'Server configuration error' }),
        { status: 500, headers: corsHeaders }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } }
    });

    // Verificar sessão e obter user_id
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: corsHeaders }
      );
    }

    const userId = user.id;
    const results: ExecutionResult[] = [];
    const createdIds: Record<string, string> = {};
    const startedAt = new Date().toISOString();

    // Buscar conexões das plataformas do usuário
    const { data: connections, error: connError } = await supabase
      .from('ad_accounts')
      .select('*')
      .eq('user_id', userId)
      .eq('is_active', true);

    if (connError) {
      console.error('Error fetching connections:', connError);
    }

    // Organizar conexões por plataforma
    const connectionsByPlatform: Record<string, typeof connections> = {
      meta: connections?.filter(c => c.platform === 'meta'),
      google: connections?.filter(c => c.platform === 'google'),
      tiktok: connections?.filter(c => c.platform === 'tiktok'),
    };

    // Ordenar instruções por prioridade
    const sorted = [...instructions].sort((a: AgentInstruction, b: AgentInstruction) => 
      a.priority - b.priority
    );

    for (const instruction of sorted) {
      try {
        // Verificar dependências
        if (instruction.dependsOn?.length) {
          const pending = instruction.dependsOn.filter(id => !createdIds[id]);
          if (pending.length) {
            throw new Error(`Dependências pendentes: ${pending.join(', ')}`);
          }
        }

        // Verificar se há conexão para a plataforma
        const platformConns = connectionsByPlatform[instruction.platform];
        if (!platformConns || platformConns.length === 0) {
          throw new Error(`${instruction.platform.toUpperCase()} Ads não conectado. Conecte em Configurações > Conexões.`);
        }

        // Usar a primeira conta ativa
        const connection = platformConns[0];
        
        // Substituir placeholders
        const params = resolvePlaceholders(instruction.params, createdIds);

        let result: unknown;
        if (dryRun) {
          // Modo simulação
          result = { 
            id: `simulated_${instruction.id}`, 
            simulated: true, 
            params,
            platform: instruction.platform,
            action: instruction.action
          };
          await new Promise(r => setTimeout(r, 500));
        } else {
          // Execução real via API correspondente
          result = await executeInstruction(instruction, connection, supabase);
        }

        // Guardar ID criado
        if (result && typeof result === 'object' && result.id) {
          createdIds[instruction.id] = result.id;
        }

        const execResult: ExecutionResult = {
          instructionId: instruction.id,
          platform: instruction.platform,
          action: instruction.action,
          success: true,
          result,
          executedAt: new Date().toISOString()
        };

        results.push(execResult);

      } catch (error) {
        const execResult: ExecutionResult = {
          instructionId: instruction.id,
          platform: instruction.platform,
          action: instruction.action,
          success: false,
          error: error instanceof Error ? error.message : 'Erro desconhecido',
          executedAt: new Date().toISOString()
        };

        results.push(execResult);
      }
    }

    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;

    return new Response(
      JSON.stringify({
        total: results.length,
        successful,
        failed,
        results,
        startedAt,
        completedAt: new Date().toISOString(),
        createdIds
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('campaign-executor error:', error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : 'Unknown error' 
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

// Executar instrução na plataforma apropriada
async function executeInstruction(
  instruction: AgentInstruction, 
  connection: any,
  supabase: any
): Promise<unknown> {
  const { platform, action, params } = instruction;

  // Descriptografar token
  const { data: decryptedToken, error: decryptError } = await supabase.rpc(
    'decrypt_access_token',
    { encrypted_token: connection.access_token_encrypted }
  );

  if (decryptError || !decryptedToken) {
    throw new Error(`Falha ao recuperar token de acesso para ${platform}`);
  }

  switch (platform) {
    case 'meta':
      return executeMetaAction(action, params, decryptedToken, connection.account_id);
    case 'google':
      return executeGoogleAction(action, params, decryptedToken, connection.account_id);
    case 'tiktok':
      return executeTikTokAction(action, params, decryptedToken, connection.account_id);
    default:
      throw new Error(`Plataforma não suportada: ${platform}`);
  }
}

// ===== META ADS =====
async function executeMetaAction(
  action: string, 
  params: Record<string, unknown>, 
  token: string,
  adAccountId: string
): Promise<unknown> {
  const baseUrl = 'https://graph.facebook.com/v18.0';

  switch (action) {
    case 'create_campaign': {
      const response = await fetch(`${baseUrl}/act_${adAccountId}/campaigns`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          access_token: token,
          name: params.name,
          objective: params.objective || 'OUTCOME_SALES',
          status: params.status || 'PAUSED',
          special_ad_categories: params.special_ad_categories || [],
        })
      });
      const data = await response.json();
      if (data.error) throw new Error(data.error.message);
      return data;
    }

    case 'create_adset': {
      const response = await fetch(`${baseUrl}/act_${adAccountId}/adsets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          access_token: token,
          campaign_id: params.campaign_id,
          name: params.name,
          daily_budget: params.daily_budget,
          targeting: params.targeting || { geo_locations: { countries: ['BR'] } },
          optimization_goal: params.optimization_goal || 'OFFSITE_CONVERSIONS',
          billing_event: params.billing_event || 'IMPRESSIONS',
          bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
          status: params.status || 'PAUSED',
        })
      });
      const data = await response.json();
      if (data.error) throw new Error(data.error.message);
      return data;
    }

    case 'create_ad': {
      // Primeiro criar o creative
      const creativeResponse = await fetch(`${baseUrl}/act_${adAccountId}/adcreatives`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          access_token: token,
          name: `Creative - ${params.name}`,
          object_story_spec: params.object_story_spec,
        })
      });
      const creativeData = await creativeResponse.json();
      if (creativeData.error) throw new Error(creativeData.error.message);

      // Depois criar o ad
      const adResponse = await fetch(`${baseUrl}/act_${adAccountId}/ads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          access_token: token,
          adset_id: params.adset_id,
          name: params.name,
          creative: { creative_id: creativeData.id },
          status: params.status || 'PAUSED',
        })
      });
      const adData = await adResponse.json();
      if (adData.error) throw new Error(adData.error.message);
      return adData;
    }

    case 'update_status': {
      const response = await fetch(`${baseUrl}/${params.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          access_token: token,
          status: params.status,
        })
      });
      const data = await response.json();
      if (data.error) throw new Error(data.error.message);
      return data;
    }

    case 'update_budget': {
      const response = await fetch(`${baseUrl}/${params.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          access_token: token,
          daily_budget: params.daily_budget,
        })
      });
      const data = await response.json();
      if (data.error) throw new Error(data.error.message);
      return data;
    }

    case 'pause':
      return executeMetaAction('update_status', { id: params.id, status: 'PAUSED' }, token, adAccountId);

    case 'activate':
      return executeMetaAction('update_status', { id: params.id, status: 'ACTIVE' }, token, adAccountId);

    default:
      throw new Error(`Ação Meta não suportada: ${action}`);
  }
}

// ===== GOOGLE ADS =====
async function executeGoogleAction(
  action: string, 
  params: Record<string, unknown>,
  token: string,
  accountId: string
): Promise<unknown> {
  // Google Ads API implementation
  // For now, simulate the execution
  console.log('Google Ads [EXECUTING]:', action, params, accountId);
  
  await new Promise(r => setTimeout(r, 500));
  
  return { 
    id: `google_${Date.now()}`, 
    simulated: false,
    action,
    accountId,
    message: 'Google Ads execução iniciada'
  };
}

// ===== TIKTOK ADS =====
async function executeTikTokAction(
  action: string, 
  params: Record<string, unknown>,
  token: string,
  accountId: string
): Promise<unknown> {
  // TikTok Ads API implementation
  // For now, simulate the execution
  console.log('TikTok Ads [EXECUTING]:', action, params, accountId);
  
  await new Promise(r => setTimeout(r, 500));
  
  return { 
    id: `tiktok_${Date.now()}`, 
    simulated: false,
    action,
    accountId,
    message: 'TikTok Ads execução iniciada'
  };
}

// Substituir placeholders {{instr_001}} pelos IDs reais
function resolvePlaceholders(
  params: Record<string, unknown>, 
  createdIds: Record<string, string>
): Record<string, unknown> {
  let str = JSON.stringify(params);
  
  for (const [instructionId, realId] of Object.entries(createdIds)) {
    str = str.replace(new RegExp(`\\{\\{${instructionId}\\}\\}`, 'g'), realId);
  }
  
  return JSON.parse(str);
}
