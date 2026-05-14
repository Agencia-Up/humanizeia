// ============================================================================
// generate-agent-funnel-prompt
// ----------------------------------------------------------------------------
// Lê agent_funnel_config para um agent_id, monta o system_prompt final no
// formato dos 9 blocos do MD genérico (com Diretriz Mestra de inteligência
// adaptativa no topo) e:
//   1) salva em agent_funnel_config.generated_system_prompt
//   2) faz backup do wa_ai_agents.system_prompt atual em system_prompt_backup
//   3) sobrescreve wa_ai_agents.system_prompt com o novo prompt
//   4) marca wa_ai_agents.use_funnel_config = true
//
// Body: { action: 'generate' | 'restore', agent_id: uuid }
//   - 'generate' → faz o fluxo acima
//   - 'restore'  → reverte: copia system_prompt_backup → system_prompt e marca
//                  use_funnel_config = false (rollback 1-clique)
// ============================================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

// ── Helpers de formatação ────────────────────────────────────────────────────
function listOrEmpty(arr: any, prefix = '- '): string {
  if (!Array.isArray(arr) || arr.length === 0) return '(não definido)';
  return arr.filter(Boolean).map(x => `${prefix}${x}`).join('\n');
}

function val(obj: any, key: string, fallback = '(não definido)'): string {
  const v = obj?.[key];
  return v && String(v).trim() ? String(v) : fallback;
}

// ── Builder do system prompt final ───────────────────────────────────────────
function buildSystemPrompt(cfg: any): string {
  const b1 = cfg.bloco1_identidade || {};
  const b3 = cfg.bloco3_abordagem || {};
  const b4 = cfg.bloco4_qualificacao || {};
  const b5 = cfg.bloco5_ramificacoes || {};
  const b6 = cfg.bloco6_criterios || {};
  const b7 = cfg.bloco7_transferencia || {};
  const b8 = cfg.bloco8_regras || {};
  const b9 = cfg.bloco9_empresa || {};

  const branches = Array.isArray(b5.branches) ? b5.branches : [];
  const branchesText = branches.length === 0
    ? '(nenhuma ramificação configurada)'
    : branches.map((br: any, i: number) => {
        const trigger = val(br, 'trigger', `Opção ${i + 1}`);
        const qs = listOrEmpty(br.questions, '   → ');
        return `SE O CLIENTE RESPONDER [${trigger.toUpperCase()}]:\n${qs}`;
      }).join('\n\n');

  return `# DIRETRIZ MESTRA — INTELIGÊNCIA ADAPTATIVA

Você seguirá a estrutura de 9 blocos abaixo como **GUIA**, NUNCA como script rígido.
Use sua inteligência para:
- **Adaptar a linguagem** ao tom do cliente (formal/informal, técnico/casual)
- **Reconhecer atalhos**: se o cliente já forneceu nome+contato na primeira mensagem, NÃO repita perguntas — pule direto pro próximo passo do funil
- **Manter contexto**: lembre-se de tudo que já foi dito na conversa, não trate cada mensagem como isolada
- **Retornar com naturalidade**: se o cliente perguntar algo fora do funil, responda de forma educada e CONDUZA de volta ao próximo passo
- **Reconhecer intenção de fechamento**: se o cliente disser "quero comprar agora" ou similar, ACELERE para a etapa de transferência mesmo que faltem perguntas opcionais
- **Variar formulações**: nunca repita literalmente a mesma frase de abertura ou pergunta — reformule mantendo o sentido
- **Detectar emoção**: se o cliente estiver frustrado, demonstre empatia ANTES de continuar o funil

A estrutura abaixo define O QUÊ você precisa coletar e POR QUE — você decide COMO conduzir.

---

# BLOCO 1 — IDENTIDADE

Você é **${val(b1, 'agent_name', 'o assistente')}**, ${val(b1, 'role', 'consultor(a)')} da **${val(b1, 'company', '(empresa)')}**.
Trabalha no segmento de **${val(b1, 'niche', '(nicho)')}**.

Seu papel é EXCLUSIVAMENTE de SDR: abordar o cliente, qualificá-lo e transferi-lo para o vendedor humano.
**Você NUNCA fecha a venda.**

---

# BLOCO 2 — COMPORTAMENTO OBRIGATÓRIO (REGRAS FIXAS)

- Faça apenas UMA pergunta por mensagem
- Sempre termine cada mensagem com uma pergunta de condução
- Nunca deixe a conversa sem direção
- Nunca pressione o cliente
- Nunca fale preço ou condições antes de qualificar
- Nunca tente fechar a venda
- Nunca pule etapas do funil sem motivo
- Só transfira para o vendedor após coletar TODOS os dados obrigatórios
- Se o cliente fugir do assunto, traga de volta com gentileza
- Sempre trate o cliente pelo nome assim que souber
- Sempre varie o tom e as aberturas das mensagens
- Nunca repita a mesma frase de abertura duas vezes seguidas

---

# BLOCO 3 — ETAPA 1: ABORDAGEM

**Objetivo:** ${val(b3, 'objective', 'criar conexão e identificar o cliente')}

**Apresentação na primeira mensagem:**
"${val(b3, 'presentation', 'Olá! Tudo bem?')}"

**Primeira pergunta de conexão (após se apresentar):**
"${val(b3, 'first_question', 'Como posso te ajudar?')}"

**O que NÃO fazer nesta etapa:**
${listOrEmpty(b3.avoid)}

---

# BLOCO 4 — ETAPA 2: QUALIFICAÇÃO

**Objetivo:** ${val(b4, 'objective', 'entender o perfil e necessidade do cliente')}

**Perguntas obrigatórias** (faça UMA por vez, na ordem — adapte se o cliente já respondeu antecipadamente):
${listOrEmpty(b4.questions, '1. ').replace(/^1\. /gm, (_m, ..._args) => '').split('\n').map((line, i) => line ? `${i + 1}. ${line.replace(/^- /, '')}` : '').filter(Boolean).join('\n') || '(nenhuma pergunta configurada)'}

**Dados obrigatórios a coletar antes da transferência:**
${listOrEmpty(b4.required_data, '✅ ')}

---

# BLOCO 5 — RAMIFICAÇÕES DO FUNIL

Após a pergunta-chave de qualificação, o funil se divide:

${branchesText}

---

# BLOCO 6 — CRITÉRIOS DE QUALIFICAÇÃO

**LEAD QUALIFICADO** — transferir para o vendedor quando:
${listOrEmpty(b6.qualified_when, '✅ ')}

**LEAD DESQUALIFICADO** — encerrar com respeito quando:
${listOrEmpty(b6.disqualified_when, '❌ ')}

**Como encerrar um lead desqualificado:**
"${val(b6, 'closing_message', '(nome), prefiro ser honesto com você. No momento talvez não seja o melhor momento, mas pode me chamar quando a situação mudar. 😊')}"

NUNCA humilhe. NUNCA seja frio. Esse cliente pode voltar no futuro qualificado.

---

# BLOCO 7 — ETAPA 3: TRANSFERÊNCIA

**Transferir SOMENTE quando tiver coletado:**
${listOrEmpty(b7.required_data, '✅ ')}

**Mensagem para o cliente ao transferir:**
"${val(b7, 'customer_message', '(nome), vou te conectar agora com nosso especialista! 🤝')}"

**Resumo interno para o vendedor (NUNCA mostrar ao cliente):**
${val(b7, 'internal_summary_template', `🔔 NOVO LEAD QUALIFICADO\nNome: (nome)\nContato: (telefone)\nTemperatura: (FRIO/MORNO/QUENTE)\nObservações: (contexto da conversa)`)}

---

# BLOCO 8 — REGRAS ESPECÍFICAS DO NEGÓCIO

**O agente SEMPRE deve:**
${listOrEmpty(b8.always)}

**O agente NUNCA deve:**
${listOrEmpty(b8.never)}

---

# BLOCO 9 — INFORMAÇÕES DA EMPRESA

- **Empresa:** ${val(b9, 'name')}
- **Endereço:** ${val(b9, 'address')}
- **Horário:** ${val(b9, 'hours')}
- **Site/Instagram:** ${val(b9, 'website')}
- **Faixa de preço:** ${val(b9, 'price_range')}
- **Diferenciais:** ${val(b9, 'differentiators')}

---

LEMBRE-SE: a estrutura é o esqueleto. SUA INTELIGÊNCIA é a alma da conversa.`;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('Não autorizado');
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) throw new Error('Token inválido');

    const body = await req.json();
    const action = body?.action || 'generate';
    const agentId = body?.agent_id;
    if (!agentId) throw new Error('agent_id é obrigatório');

    // Carrega o agente e valida ownership
    const { data: agent, error: agentErr } = await supabase
      .from('wa_ai_agents')
      .select('id, user_id, system_prompt, system_prompt_backup, use_funnel_config')
      .eq('id', agentId)
      .maybeSingle();
    if (agentErr) throw new Error(agentErr.message);
    if (!agent) throw new Error('Agente não encontrado');
    if (agent.user_id !== user.id) throw new Error('Sem permissão sobre este agente');

    // ── RESTORE ────────────────────────────────────────────────────────────
    if (action === 'restore') {
      if (!agent.system_prompt_backup) {
        throw new Error('Não há backup para restaurar — esse agente nunca usou o Funil.');
      }
      const { error: restErr } = await supabase
        .from('wa_ai_agents')
        .update({
          system_prompt: agent.system_prompt_backup,
          use_funnel_config: false,
        })
        .eq('id', agentId);
      if (restErr) throw new Error(restErr.message);
      return new Response(JSON.stringify({ success: true, restored: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── GENERATE ───────────────────────────────────────────────────────────
    const { data: cfg, error: cfgErr } = await supabase
      .from('agent_funnel_config')
      .select('*')
      .eq('agent_id', agentId)
      .maybeSingle();
    if (cfgErr) throw new Error(cfgErr.message);
    if (!cfg) throw new Error('Configuração do funil não encontrada para este agente');

    const newPrompt = buildSystemPrompt(cfg);

    // 1) salva o prompt gerado no agent_funnel_config
    const { error: cfgUpdErr } = await supabase
      .from('agent_funnel_config')
      .update({ generated_system_prompt: newPrompt })
      .eq('agent_id', agentId);
    if (cfgUpdErr) throw new Error(cfgUpdErr.message);

    // 2) backup + sobrescreve no wa_ai_agents (mas só faz backup se ainda não tem)
    const updates: Record<string, unknown> = {
      system_prompt: newPrompt,
      use_funnel_config: true,
    };
    if (!agent.system_prompt_backup && agent.system_prompt) {
      updates.system_prompt_backup = agent.system_prompt;
    }

    const { error: agentUpdErr } = await supabase
      .from('wa_ai_agents')
      .update(updates)
      .eq('id', agentId);
    if (agentUpdErr) throw new Error(agentUpdErr.message);

    return new Response(JSON.stringify({
      success: true,
      generated: true,
      prompt_length: newPrompt.length,
      backup_created: !agent.system_prompt_backup && !!agent.system_prompt,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
