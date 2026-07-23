// ============================================================================
// generate-agent-funnel-prompt
// ----------------------------------------------------------------------------
// Lê agent_funnel_config para um agent_id, monta o prompt derivado no
// formato dos 9 blocos do MD genérico (com Diretriz Mestra de inteligência
// adaptativa no topo) e:
//   1) salva o artefato derivado em agent_funnel_config.generated_system_prompt
//   2) faz backup do wa_ai_agents.system_prompt atual em system_prompt_backup
//   3) sincroniza wa_ai_agents.system_prompt, a fonte efetiva única do runtime
//   4) marca wa_ai_agents.use_funnel_config = true
//
// Body: { action: 'generate' | 'restore', agent_id: uuid }
//   - 'generate' → faz o fluxo acima
//   - 'restore'  → reverte: copia system_prompt_backup → system_prompt e marca
//                  use_funnel_config = false (rollback 1-clique)
// ============================================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  buildTenantPolicyPromptSection,
  validateTenantFunnelConfig,
  validateTenantPolicies,
} from '../../../src/lib/pedroFunnelPolicyContract.ts';
import { buildTenantSdrSystemPrompt } from '../../../src/lib/pedroFunnelPrompt.ts';
import {
  buildFunnelPromptEditorRequest,
  validateAiGeneratedFunnelPrompt,
} from '../../../src/lib/pedroFunnelPrompt.ts';
import { resolveAiKey } from '../_shared/aiKeys.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

const FUNNEL_PROMPT_MODEL = Deno.env.get('PEDRO_FUNNEL_PROMPT_MODEL') || 'gpt-4.1-mini';

type PromptGenerationResult = {
  prompt: string;
  mode: 'ai' | 'deterministic_fallback';
  warning?: string;
};

/**
 * A IA só edita o texto comercial. O prompt canônico continua sendo a
 * autoridade técnica e é usado como fallback quando a saída não for segura.
 */
async function improvePromptWithAi(
  userId: string,
  config: Record<string, unknown>,
  canonicalPrompt: string,
): Promise<PromptGenerationResult> {
  const fallback = (warning: string): PromptGenerationResult => ({
    prompt: canonicalPrompt,
    mode: 'deterministic_fallback',
    warning,
  });

  try {
    // Mantém a mesma política BYOK do runtime: contas novas precisam da
    // própria chave; não transforme o botão do portal em gasto silencioso da
    // chave da plataforma.
    const resolved = await resolveAiKey(supabase, userId, 'openai');
    if (!resolved.key) return fallback('IA de geração não configurada; usamos o prompt v3 canônico.');

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${resolved.key}`,
      },
      body: JSON.stringify({
        model: FUNNEL_PROMPT_MODEL,
        max_completion_tokens: 6500,
        messages: [
          {
            role: 'system',
            content: 'Você é um editor de prompts SDR. Responda somente em JSON válido. A palavra JSON é obrigatória porque o contrato exige JSON.',
          },
          {
            role: 'user',
            content: buildFunnelPromptEditorRequest(config, canonicalPrompt),
          },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'pedro_v3_funnel_prompt',
            strict: true,
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: { prompt: { type: 'string' } },
              required: ['prompt'],
            },
          },
        },
      }),
    });

    if (!response.ok) return fallback(`IA indisponível (${response.status}); usamos o prompt v3 canônico.`);
    const payload = await response.json();
    const content = payload?.choices?.[0]?.message?.content;
    let generated = '';
    try {
      generated = typeof content === 'string' ? JSON.parse(content)?.prompt : '';
    } catch {
      return fallback('A IA retornou JSON inválido; usamos o prompt v3 canônico.');
    }

    const validation = validateAiGeneratedFunnelPrompt(generated, canonicalPrompt, config);
    if (!validation.valid) {
      return fallback(`A IA não passou na validação do contrato v3: ${validation.reasons.slice(0, 3).join('; ')}`);
    }
    return { prompt: generated.trim(), mode: 'ai' };
  } catch (error) {
    return fallback(`Falha controlada na IA de geração: ${error instanceof Error ? error.message : 'erro desconhecido'}`);
  }
}

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
// Mantido apenas durante a migração para não perder o diff histórico. O runtime
// usa exclusivamente o compilador compartilhado abaixo; esta implementação
// antiga deve ser removida quando o rollout do novo contrato estiver concluído.
function legacyBuildSystemPrompt(cfg: any): string {
  const b1 = cfg.bloco1_identidade || {};
  const b3 = cfg.bloco3_abordagem || {};
  const b4 = cfg.bloco4_qualificacao || {};
  const b5 = cfg.bloco5_ramificacoes || {};
  const b6 = cfg.bloco6_criterios || {};
  const b7 = cfg.bloco7_transferencia || {};
  const b8 = cfg.bloco8_regras || {};
  const b9 = cfg.bloco9_empresa || {};
  const policySection = buildTenantPolicyPromptSection(cfg.tenant_policies);

  const branches = Array.isArray(b5.branches) ? b5.branches : [];
  const branchesText = branches.length === 0
    ? '(nenhuma ramificação configurada)'
    : branches.map((br: any, i: number) => {
        const trigger = val(br, 'trigger', `Opção ${i + 1}`);
        const qs = listOrEmpty(br.questions, '   → ');
        return `SE O CLIENTE RESPONDER [${trigger.toUpperCase()}]:\n${qs}`;
      }).join('\n\n');

  return `# CONFIGURAÇÃO COMERCIAL DA EMPRESA

Os blocos abaixo descrevem a identidade, o negócio, os objetivos e as preferências comerciais do cliente. Interprete-os junto com a conversa real; não transforme os campos em uma fila mecânica de perguntas.

# BLOCO 1 — IDENTIDADE

Você é **${val(b1, 'agent_name', 'o assistente')}**, ${val(b1, 'role', 'consultor(a)')} da **${val(b1, 'company', '(empresa)')}**.
Trabalha no segmento de **${val(b1, 'niche', '(nicho)')}**.

Seu papel é EXCLUSIVAMENTE de SDR: abordar o cliente, qualificá-lo e transferi-lo para o vendedor humano.
**Você NUNCA fecha a venda.**

---

# BLOCO 2 — CONTEXTO DA CONFIGURAÇÃO

Este bloco não substitui o contrato operacional do Pedro v3. Ele apenas registra preferências comerciais configuradas para esta empresa. A LLM deve adaptá-las ao bloco atual, respeitar uma mudança explícita do lead e não repetir informação ou pergunta já respondida.

---

# BLOCO 3 — ETAPA 1: ABORDAGEM

**Objetivo:** ${val(b3, 'objective', 'criar conexão e identificar o cliente')}

**Apresentação na primeira mensagem:**
"${val(b3, 'presentation', 'Olá! Tudo bem?')}"

**Contrato de reprodução da apresentação:**
- O texto acima é a abertura literal definida pela empresa. Na primeira resposta, reproduza-o sem resumir,
  parafrasear, trocar a identidade ou acrescentar uma pergunta diferente.
- Se o texto contiver o marcador **[PERIODO]**, substitua somente esse marcador por "Bom dia", "Boa tarde" ou
  "Boa noite", usando o horário atual do Brasil. Não altere nenhuma outra palavra.
- Se a apresentação já terminar com uma pergunta, não acrescente a primeira pergunta abaixo no mesmo turno.

**Primeira pergunta de conexão (após se apresentar):**
"${val(b3, 'first_question', '(não definida; responda ao bloco atual do lead)')}"

**O que NÃO fazer nesta etapa:**
${listOrEmpty(b3.avoid)}

---

# BLOCO 4 — ETAPA 2: QUALIFICAÇÃO

**Objetivo:** ${val(b4, 'objective', 'entender o perfil e necessidade do cliente')}

**Perguntas preferenciais** (use somente quando forem relevantes ao bloco atual; adapte a ordem quando o cliente já respondeu):
${listOrEmpty(b4.questions, '1. ').replace(/^1\. /gm, (_m, ..._args) => '').split('\n').map((line, i) => line ? `${i + 1}. ${line.replace(/^- /, '')}` : '').filter(Boolean).join('\n') || '(nenhuma pergunta configurada)'}

**Dados que a empresa prefere ter antes de uma transferência qualificada:**
${listOrEmpty(b4.required_data, '✅ ')}

**Sinais comerciais para considerar uma transferência** (a decisão continua sendo da LLM e deve respeitar o contrato operacional):
${listOrEmpty(b4.transfer_now_rules, '⚡ ')}

---

# BLOCO 5 — RAMIFICAÇÕES DO FUNIL

Após a pergunta-chave de qualificação, o funil se divide:

As ramificaÃ§Ãµes abaixo sÃ£o possibilidades interpretadas pela LLM conforme o sentido da resposta. NÃ£o sÃ£o uma fila de perguntas, nÃ£o obrigam uma ordem fixa e nÃ£o vencem uma mudanÃ§a explÃ­cita de assunto:

${branchesText}

---

# BLOCO 6 — QUALIFICAÇÃO, DESINTERESSE E TEMPERATURA

**TRANSFERIR (lead qualificado)** quando:
${listOrEmpty(b6.qualified_when, '✅ ')}

**PREFERÊNCIAS DE DESQUALIFICAÇÃO DA EMPRESA:**
Avalie o sentido da fala e o contexto antes de aplicar qualquer critério. Respostas curtas, uma objeção, "vou pensar", distância ou agradecimento isolado não são desinteresse automaticamente. Encerre também quando as políticas específicas abaixo forem realmente satisfeitas:
${listOrEmpty(b6.disqualified_when, '❌ ')}

Não trate uma objeção ou dúvida como desinteresse automaticamente. Se houver desinteresse inequívoco ou uma política de desqualificação aplicável, siga a orientação configurada e encerre sem continuar empurrando o funil.

**ENCERRAR (saída graciosa — sem nova pergunta de venda):** agradeça + reconheça sem rebater + porta aberta. Ex.: "${val(b6, 'closing_message', 'Tranquilo, (nome)! Não vou tomar seu tempo. Se mudar de ideia ou quiser ver outras opções, é só me chamar por aqui. 👍')}"
NUNCA humilhe, NUNCA seja frio — esse cliente pode voltar qualificado.

**TEMPERATURA (informe ao vendedor):** use os sinais reais da conversa e as categorias configuradas pela empresa. Não classifique como desqualificado somente por resposta curta, objeção, localização incerta ou agradecimento.

---

# BLOCO 7 — ETAPA 3: TRANSFERÊNCIA

**Dados preferenciais para uma transferência qualificada:**
${listOrEmpty(b7.required_data, '✅ ')}

Pedido explícito de humano e outras exceções previstas no contrato operacional não podem ser bloqueados por esta lista.

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

${policySection ? `${policySection}\n\n---` : ''}

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
      .select('id, user_id, agent_type, system_prompt, system_prompt_backup, use_funnel_config')
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

    const funnelIssues = validateTenantFunnelConfig(cfg);
    const policyIssues = validateTenantPolicies(cfg.tenant_policies);
    const configErrors = funnelIssues.filter((issue) => issue.severity === 'error');
    const policyErrors = policyIssues.filter((issue) => issue.severity === 'error');
    if (configErrors.length > 0) {
      throw new Error(`A configuraÃ§Ã£o do Funil possui erros: ${configErrors.map((issue) => issue.message).join(' ')}`);
    }
    if (policyErrors.length > 0) {
      throw new Error(`Políticas comerciais inválidas: ${policyErrors.map((issue) => issue.message).join(' ')}`);
    }

    // O tipo operacional limita capacidades; personalidade e funil continuam
    // sendo definidos pelo prompt configurado no portal.
    const promptConfig = { ...cfg, agent_type: agent.agent_type || 'generic' };
    const canonicalPrompt = buildTenantSdrSystemPrompt(promptConfig);
    const generated = await improvePromptWithAi(user.id, promptConfig, canonicalPrompt);
    const newPrompt = generated.prompt;

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
      generation_mode: generated.mode,
      generation_warning: generated.warning || null,
      funnel_warnings: funnelIssues.filter((issue) => issue.severity === 'warning'),
      policy_warnings: policyIssues.filter((issue) => issue.severity === 'warning'),
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
