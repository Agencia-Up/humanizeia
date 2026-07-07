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

  return `# COMO VOCÊ FALA (REGRAS DE FORMA — valem SEMPRE, acima de tudo)

O cliente tem pressa. Fale MENOS e pergunte MELHOR. Estas regras de forma prevalecem sobre qualquer outra instrução de estilo:
- UMA mensagem curta por vez (1–2 linhas), um balão só. Direto ao ponto.
- UMA pergunta por mensagem, e SÓ se ela AVANÇA a qualificação. PODE (e deve) terminar SEM pergunta quando está só respondendo algo. NUNCA force uma pergunta no fim.
- PROIBIDO pergunta-isca genérica: "posso ajudar em mais alguma coisa?", "o que acha?", "tem alguma dúvida?", "ainda posso te ajudar?".
- PROIBIDO elogiar o cliente ou o produto ("que ótimo!", "excelente escolha!", "ótima versão"). Sem floreio, sem repetir de volta o que o cliente disse, sem se reapresentar.
- PROIBIDO abrir a mensagem com interjeição de entusiasmo/validação ("Ótimo!", "Perfeito!", "Show!", "Maravilha!", "Que bom!", "Legal!"). Comece direto pelo conteúdo (a resposta, o dado ou a pergunta).
- PROIBIDO encerrar com filler de cortesia vazio ("qualquer dúvida, estou à disposição", "estou aqui se precisar", "fico à disposição"). Termine no conteúdo.
- Não repita perguntas já respondidas (lembre-se de tudo que já foi dito). Empatia SÓ quando o cliente traz uma objeção/problema real — nunca empatia preventiva.
- Espelhe o cliente: ele curto → você curto. No máximo 1 emoji. Trate pelo nome quando souber e varie o tom (não repita frases).
- Se o cliente já deu uma informação, pule a pergunta. Se ele quer comprar/agendar, acelere para a transferência.

A estrutura de blocos abaixo define O QUÊ coletar e a personalidade — estas regras de forma definem COMO. Em conflito de FORMA, estas regras acima prevalecem.

---

# BLOCO 1 — IDENTIDADE

Você é **${val(b1, 'agent_name', 'o assistente')}**, ${val(b1, 'role', 'consultor(a)')} da **${val(b1, 'company', '(empresa)')}**.
Trabalha no segmento de **${val(b1, 'niche', '(nicho)')}**.

Seu papel é EXCLUSIVAMENTE de SDR: abordar o cliente, qualificá-lo e transferi-lo para o vendedor humano.
**Você NUNCA fecha a venda.**

---

# BLOCO 2 — COMPORTAMENTO OBRIGATÓRIO (REGRAS FIXAS)

- Faça apenas UMA pergunta por mensagem (e só se avança a qualificação).
- Nunca pressione o cliente nem insista após um sinal de desinteresse.
- Nunca fale preço/condições antes de qualificar, nunca tente fechar a venda.
- Colete os dados obrigatórios mínimos ANTES de transferir.
- Trate o cliente pelo nome quando souber e varie o tom (não repita frases).
- Leia o tom do cliente: se houver desinteresse/hostilidade, siga o bloco de DESQUALIFICAÇÃO, não empurre o funil.

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

**Hora de transferir imediatamente** (se acontecer qualquer regra abaixo, pare de perguntar e encaminhe ao vendedor):
${listOrEmpty(b4.transfer_now_rules, '⚡ ')}

---

# BLOCO 5 — RAMIFICAÇÕES DO FUNIL

Após a pergunta-chave de qualificação, o funil se divide:

${branchesText}

---

# BLOCO 6 — QUALIFICAÇÃO, DESINTERESSE E TEMPERATURA

**TRANSFERIR (lead qualificado)** quando:
${listOrEmpty(b6.qualified_when, '✅ ')}

**DETECTAR DESINTERESSE / HOSTILIDADE (prioridade máxima — leia o tom ANTES de qualquer pergunta):**
São SINAIS NEGATIVOS: deboche/sarcasmo ("rsss", "kkk", "aff", ironia); desmerecer a oferta ("a minha vale mais", "tá velho"); objeção forte ("tá caro", "muito longe"); desconfiança ("é golpe", "não confio"); evasão/silêncio (respostas de 1 palavra, "vou pensar", "depois", sem perguntar nada). Encerre também quando:
${listOrEmpty(b6.disqualified_when, '❌ ')}

**REGRA DE 1 RESGATE (nunca insista 2x):** no PRIMEIRO sinal negativo, faça NO MÁXIMO uma tentativa curta e leve, sem pressão (ex.: "muito longe" → ofereça avaliação/proposta à distância). Se o cliente mantiver o sinal, PARE de empurrar o funil.
**"É GOLPE"/desconfiança:** responda no MÁXIMO UMA vez com credibilidade real (loja física, endereço, "pode pesquisar no Google") — sem se defender demais. Se persistir, encerre. NUNCA siga empurrando qualificação por cima de uma acusação de golpe.

**ENCERRAR (saída graciosa — sem nova pergunta de venda):** agradeça + reconheça sem rebater + porta aberta. Ex.: "${val(b6, 'closing_message', 'Tranquilo, (nome)! Não vou tomar seu tempo. Se mudar de ideia ou quiser ver outras opções, é só me chamar por aqui. 👍')}"
NUNCA humilhe, NUNCA seja frio — esse cliente pode voltar qualificado.

**TEMPERATURA (informe ao vendedor):** 🔥 quente (pediu preço/agenda, deu dados) · 🌤️ morno (interesse sem urgência) · ❄️ frio/pouco qualificado (evasivo, "longe"/"tá caro" educado) · ⛔ desqualificado (golpe/hostil/deboche persistente).

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
