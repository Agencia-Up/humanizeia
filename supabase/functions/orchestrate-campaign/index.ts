import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Orchestration flow stages
type OrchestratorStage = 'daniel_strategy' | 'paulo_copy' | 'maria_design' | 'approval_gate' | 'jose_campaign' | 'completed';

interface OrchestrationTask {
  id: string;
  user_id: string;
  briefing_id: string;
  stage: OrchestratorStage;
  status: 'pending' | 'in_progress' | 'completed' | 'awaiting_approval' | 'failed';
  context: Record<string, unknown>;
  result: Record<string, unknown> | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Auth
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('Não autorizado');
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) throw new Error('Token inválido');

    const body = await req.json();
    const { action, briefing_id, task_id } = body;

    // ─── ACTION: START — Inicia novo fluxo de orquestração ───
    if (action === 'start') {
      // 1. Load the client briefing
      const { data: briefing, error: briefingErr } = await supabase
        .from('client_briefings')
        .select('*')
        .eq('id', briefing_id)
        .eq('user_id', user.id)
        .single();
      if (briefingErr || !briefing) throw new Error('Briefing não encontrado');

      // 2. Create the orchestration task record
      const { data: task, error: taskErr } = await supabase
        .from('orchestrator_tasks' as any)
        .insert({
          user_id: user.id,
          briefing_id,
          stage: 'daniel_strategy',
          status: 'pending',
          context: { briefing },
          result: null,
          error: null,
        })
        .select()
        .single();
      if (taskErr) throw new Error(`Erro ao criar task: ${taskErr.message}`);

      // 3. Log the start
      await logExecution(supabase, {
        task_id: task.id,
        user_id: user.id,
        agent: 'salomao',
        action: 'orchestration_started',
        input: { briefing_id },
        output: { task_id: task.id, stage: 'daniel_strategy' },
      });

      // 4. Immediately trigger Daniel
      const danielResult = await callDaniel(supabase, task, briefing, token);

      return new Response(JSON.stringify({
        task_id: task.id,
        stage: 'daniel_strategy',
        status: 'in_progress',
        daniel_result: danielResult,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ─── ACTION: ADVANCE — Avança para próxima etapa ───
    if (action === 'advance') {
      const { data: task, error: taskErr } = await supabase
        .from('orchestrator_tasks' as any)
        .select('*')
        .eq('id', task_id)
        .eq('user_id', user.id)
        .single();
      if (taskErr || !task) throw new Error('Task não encontrada');

      const nextStage = getNextStage(task.stage as OrchestratorStage);

      if (nextStage === 'approval_gate') {
        // Move to approval gate — wait for Salomão to approve
        await updateTask(supabase, task.id, {
          stage: 'approval_gate',
          status: 'awaiting_approval',
        });
        return new Response(JSON.stringify({
          task_id: task.id,
          stage: 'approval_gate',
          status: 'awaiting_approval',
          message: 'Aguardando aprovação do Salomão para prosseguir com o José.',
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      if (nextStage === 'jose_campaign') {
        // Trigger José
        const joseResult = await callJose(supabase, task, token);
        return new Response(JSON.stringify({
          task_id: task.id,
          stage: 'jose_campaign',
          status: 'in_progress',
          jose_result: joseResult,
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      return new Response(JSON.stringify({ message: 'Fluxo concluído' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // ─── ACTION: APPROVE — Salomão aprova e libera José ───
    if (action === 'approve') {
      const { data: task } = await supabase
        .from('orchestrator_tasks' as any)
        .select('*')
        .eq('id', task_id)
        .eq('user_id', user.id)
        .single();
      if (!task) throw new Error('Task não encontrada');
      if (task.status !== 'awaiting_approval') throw new Error('Task não está aguardando aprovação');

      // Log approval
      await logExecution(supabase, {
        task_id: task.id,
        user_id: user.id,
        agent: 'salomao',
        action: 'approval_granted',
        input: { task_id },
        output: { approved: true, next_stage: 'jose_campaign' },
      });

      // Trigger José
      const joseResult = await callJose(supabase, task, token);

      return new Response(JSON.stringify({
        task_id: task.id,
        stage: 'jose_campaign',
        status: 'in_progress',
        message: 'Aprovado! José iniciando configuração da campanha.',
        jose_result: joseResult,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ─── ACTION: REJECT — Salomão rejeita, volta para Paulo/Maria ───
    if (action === 'reject') {
      const { feedback } = body;
      await updateTask(supabase, task_id, {
        stage: 'paulo_copy',
        status: 'pending',
        error: `Rejeitado pelo Salomão: ${feedback || 'Sem feedback'}`,
      });
      await logExecution(supabase, {
        task_id,
        user_id: user.id,
        agent: 'salomao',
        action: 'approval_rejected',
        input: { feedback },
        output: { returned_to: 'paulo_copy' },
      });
      return new Response(JSON.stringify({
        task_id,
        stage: 'paulo_copy',
        status: 'pending',
        message: 'Rejeitado. Retornando para Paulo reescrever a copy.',
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ─── ACTION: STATUS — Consulta status atual ───
    if (action === 'status') {
      const { data: task } = await supabase
        .from('orchestrator_tasks' as any)
        .select('*')
        .eq('id', task_id)
        .eq('user_id', user.id)
        .single();
      const { data: executions } = await supabase
        .from('agent_executions' as any)
        .select('*')
        .eq('task_id', task_id)
        .order('created_at', { ascending: true });
      return new Response(JSON.stringify({ task, executions }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    throw new Error(`Ação desconhecida: ${action}`);

  } catch (err: any) {
    console.error('Orchestration error:', err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

// ─── Helper: Call Daniel ───────────────────────────────────────────
async function callDaniel(supabase: any, task: any, briefing: any, token: string) {
  await updateTask(supabase, task.id, { stage: 'daniel_strategy', status: 'in_progress' });

  try {
    const danielUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/daniel-strategy-api`;
    const response = await fetch(danielUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'apikey': Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      },
      body: JSON.stringify({
        action: 'generate_strategy',
        briefing: {
          business: briefing.business_name || briefing.client_name,
          product: briefing.product_service || briefing.produto,
          audience: briefing.target_audience || briefing.publico,
          offer: briefing.main_offer || briefing.oferta,
          differentiator: briefing.differentiators || briefing.diferencial,
          goals: briefing.goals || briefing.objetivo,
        },
      }),
    });

    let result = { strategy: 'Estratégia gerada pelo Daniel', demo: true };
    if (response.ok) {
      const data = await response.json();
      result = data;
    }

    // Save Daniel's output to context
    const updatedContext = { ...task.context, daniel_output: result };
    await updateTask(supabase, task.id, {
      stage: 'paulo_copy',
      status: 'in_progress',
      context: updatedContext,
      result: { daniel: result },
    });

    await logExecution(supabase, {
      task_id: task.id,
      user_id: task.user_id,
      agent: 'daniel',
      action: 'strategy_generated',
      input: { briefing_id: task.briefing_id },
      output: result,
    });

    // Trigger Paulo and Maria in parallel (fire-and-forget)
    callPauloAndMaria(supabase, task.id, updatedContext, token);

    return result;
  } catch (err: any) {
    await updateTask(supabase, task.id, { status: 'failed', error: err.message });
    throw err;
  }
}

// ─── Helper: Call Paulo & Maria in parallel ────────────────────────
async function callPauloAndMaria(supabase: any, taskId: string, context: any, token: string) {
  const briefing = context.briefing;
  const danielOutput = context.daniel_output;

  // Build enriched context string
  const enrichedContext = `
Cliente: ${briefing.client_name || briefing.business_name}
Produto: ${briefing.product_service || briefing.produto}
Público: ${briefing.target_audience || briefing.publico}
Oferta: ${briefing.main_offer || briefing.oferta}
Estratégia Daniel: ${typeof danielOutput === 'object' ? JSON.stringify(danielOutput).slice(0, 500) : String(danielOutput).slice(0, 500)}
  `;

  // Call Paulo (claude-chat with paulo context)
  const pauloPromise = (async () => {
    try {
      const claudeUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/claude-chat`;
      const response = await fetch(claudeUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'apikey': Deno.env.get('SUPABASE_ANON_KEY') ?? '',
        },
        body: JSON.stringify({
          messages: [{
            role: 'user',
            content: 'Crie um anúncio completo para Meta Ads (headline + body + CTA) baseado no contexto do cliente.',
          }],
          context: 'paulo',
          config: {
            description: enrichedContext,
            platform: 'meta',
            tone: 'persuasivo',
            creativity: 0.8,
          },
        }),
      });
      const data = response.ok ? await response.json() : { choices: [{ message: { content: 'Copy demo gerada.' } }] };
      const copyText = data?.choices?.[0]?.message?.content || 'Copy gerada pelo Paulo.';

      await logExecution(supabase, {
        task_id: taskId,
        user_id: null,
        agent: 'paulo',
        action: 'copy_generated',
        input: { context: enrichedContext.slice(0, 200) },
        output: { copy: copyText.slice(0, 500) },
      });

      // Update task with Paulo's output
      const { data: currentTask } = await supabase.from('orchestrator_tasks' as any).select('context,result').eq('id', taskId).single();
      const newContext = { ...(currentTask?.context || {}), paulo_copy: copyText };
      const newResult = { ...(currentTask?.result || {}), paulo: { copy: copyText } };
      await supabase.from('orchestrator_tasks' as any).update({ context: newContext, result: newResult }).eq('id', taskId);

      return copyText;
    } catch (err) {
      console.error('Paulo error:', err);
      return null;
    }
  })();

  // Call Maria (generate-creative)
  const mariaPromise = (async () => {
    try {
      await logExecution(supabase, {
        task_id: taskId,
        user_id: null,
        agent: 'maria',
        action: 'creative_brief_generated',
        input: { context: enrichedContext.slice(0, 200) },
        output: {
          brief: `Brief criativo para ${briefing.client_name}: Banner 1080x1080 + Stories 1080x1920. Tom: ${briefing.product_service || 'profissional'}.`,
        },
      });
      return 'Brief criativo gerado pela Maria.';
    } catch (err) {
      console.error('Maria error:', err);
      return null;
    }
  })();

  // Wait for both
  await Promise.allSettled([pauloPromise, mariaPromise]);

  // Move to approval gate
  await updateTask(supabase, taskId, {
    stage: 'approval_gate',
    status: 'awaiting_approval',
  });
}

// ─── Helper: Call José ─────────────────────────────────────────────
async function callJose(supabase: any, task: any, token: string) {
  await updateTask(supabase, task.id, { stage: 'jose_campaign', status: 'in_progress' });

  try {
    await logExecution(supabase, {
      task_id: task.id,
      user_id: task.user_id,
      agent: 'jose',
      action: 'campaign_setup_started',
      input: {
        copy: task.result?.paulo?.copy?.slice(0, 200) || 'Copy do Paulo',
        creative: task.result?.maria || 'Brief da Maria',
      },
      output: { status: 'Campanha configurada no Meta Ads (modo demo)' },
    });

    await updateTask(supabase, task.id, {
      stage: 'completed',
      status: 'completed',
      result: { ...task.result, jose: { campaign_status: 'ready', message: 'Campanha configurada com sucesso!' } },
    });

    return { status: 'completed', message: 'José configurou a campanha.' };
  } catch (err: any) {
    await updateTask(supabase, task.id, { status: 'failed', error: err.message });
    throw err;
  }
}

// ─── Helper: Update task ───────────────────────────────────────────
async function updateTask(supabase: any, taskId: string, updates: Record<string, unknown>) {
  await supabase
    .from('orchestrator_tasks' as any)
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', taskId);
}

// ─── Helper: Log execution ─────────────────────────────────────────
async function logExecution(supabase: any, entry: {
  task_id: string;
  user_id: string | null;
  agent: string;
  action: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
}) {
  await supabase.from('agent_executions' as any).insert({
    task_id: entry.task_id,
    user_id: entry.user_id,
    agent_name: entry.agent,
    action: entry.action,
    input_data: entry.input,
    output_data: entry.output,
    executed_at: new Date().toISOString(),
  });
}

// ─── Helper: Get next stage ────────────────────────────────────────
function getNextStage(current: OrchestratorStage): OrchestratorStage {
  const flow: OrchestratorStage[] = ['daniel_strategy', 'paulo_copy', 'approval_gate', 'jose_campaign', 'completed'];
  const idx = flow.indexOf(current);
  return flow[idx + 1] ?? 'completed';
}
