// deno-lint-ignore-file no-explicit-any
// ============================================================================
// feedback-brain-test — "Testar prompt" do Cérebro de Feedback (DRY-RUN).
//
// Segurança:
//  * verify_jwt=true — chamado pela UI com o JWT do usuário logado.
//  * tenant = usuário AUTENTICADO (auth.getUser). O body NUNCA escolhe tenant.
//  * vendedor (profiles.role='seller') não pode testar/editar o cérebro -> 403.
//  * NÃO grava em feedback_conversas, NÃO altera análise real, NÃO envia WhatsApp.
//
// O teste monta o prompt EXATAMENTE como o analista real:
//   [camada especialista (payload do teste OU config salva OU padrão Logos)]
//   + [contrato técnico obrigatório FIXO]
//   + [conversa de exemplo mockada]
// e valida se a IA devolveu JSON com TODAS as chaves obrigatórias do contrato.
// ============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  montarCamadaEspecialista, instrucaoContrato, CONTRATO_CHAVES_OBRIGATORIAS,
  type BrainConfig,
} from '../_shared/feedback/analista.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });

const MODEL = Deno.env.get('FEEDBACK_LLM_MODEL') || 'claude-haiku-4-5';
const PRECOS: Record<string, { in: number; out: number }> = {
  'claude-opus-4-8': { in: 5, out: 25 },
  'claude-sonnet-4-6': { in: 3, out: 15 },
  'claude-haiku-4-5': { in: 1, out: 5 },
};

// Conversa de EXEMPLO fixa (nenhum dado real de lead). Boa o suficiente para a
// IA exercitar o contrato inteiro: interesse real + atendimento fraco.
const CONVERSA_EXEMPLO = [
  'VENDEDOR AVALIADO: Carlos Souza. O coaching e a nota sao SOBRE ELE. Fale COM o vendedor (pelo primeiro nome: Carlos). NUNCA chame o vendedor pelo nome do cliente.',
  'CLIENTE / LEAD: Mariana | telefone: 5511999990000 | campanha/anuncio: SUV Compacto 0km',
  'SINAIS ESTRUTURADOS DO LEAD: {"origem":"anuncio","temperature":"quente"}',
  '',
  'ATENDIMENTO DO VENDEDOR HUMANO (Carlos) COM O CLIENTE (avalie APENAS isto):',
  '[09:02] CLIENTE: Oi! Vi o anuncio do SUV. Ainda tem? Tenho um Onix 2019 pra dar na troca e uns 20 mil de entrada.',
  '[10:47] VENDEDOR: tem sim',
  '[10:48] CLIENTE: Otimo! Da pra simular o financiamento? Posso passar ai sabado de manha.',
  '[14:31] VENDEDOR: manda seu cpf',
  '[14:32] CLIENTE: Prefiro entender os valores antes. Qual o preco a vista?',
  '(sem mais mensagens do vendedor)',
].join('\n');

function parseContratoLocal(text: string): any {
  if (!text) return null;
  const tryParse = (s: string) => { try { return JSON.parse(s); } catch { return null; } };
  let r = tryParse(text.trim());
  if (r) return r;
  const noFence = text.replace(/```json/gi, '').replace(/```/g, '').trim();
  r = tryParse(noFence);
  if (r) return r;
  const i = noFence.indexOf('{');
  const j = noFence.lastIndexOf('}');
  if (i >= 0 && j > i) r = tryParse(noFence.slice(i, j + 1));
  return r;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405);
  try {
    // 1) Tenant = usuário autenticado (NUNCA do body).
    const auth = req.headers.get('Authorization') || '';
    const jwt = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: userData, error: uErr } = await admin.auth.getUser(jwt);
    const uid = userData?.user?.id;
    if (uErr || !uid) return json({ ok: false, error: 'nao autenticado' }, 401);

    // Vendedor não configura o cérebro.
    const { data: prof } = await admin.from('profiles').select('role').eq('id', uid).maybeSingle();
    if ((prof?.role || '') === 'seller') return json({ ok: false, error: 'somente o master da conta pode testar o cerebro' }, 403);
    const tenant = uid;

    const body = await req.json().catch(() => ({}));

    // 2) Camada especialista: payload do teste (se veio) OU config salva OU padrão.
    const { data: cfg } = await admin.from('feedback_config')
      .select('framework, prompt_especialista')
      .or(`tenant_id.eq.${tenant},tenant_id.is.null`)
      .order('tenant_id', { ascending: false, nullsFirst: false }).limit(1).maybeSingle();
    const promptPadrao = cfg?.prompt_especialista || '';
    const framework = cfg?.framework || {};

    let brain: BrainConfig | null = null;
    if (body?.brain && typeof body.brain === 'object') {
      brain = {
        enabled: true,
        name: body.brain.name, specialist_prompt: body.brain.specialist_prompt,
        evaluation_criteria: body.brain.evaluation_criteria, tone: body.brain.tone,
        never_do: body.brain.never_do, version: 0,
      };
    } else {
      const { data: saved } = await admin.from('feedback_brain_config')
        .select('enabled, name, specialist_prompt, evaluation_criteria, tone, never_do, version')
        .eq('tenant_id', tenant).maybeSingle();
      brain = (saved as BrainConfig) || null;
    }
    const camada = montarCamadaEspecialista(promptPadrao, brain);

    // Rubrica NEPQ ativa — o teste usa o MESMO contrato do analista real.
    const { data: rubrica } = await admin.from('feedback_rubricas')
      .select('id, definicao').eq('framework', 'nepq').eq('ativa', true)
      .or(`tenant_id.eq.${tenant},tenant_id.is.null`)
      .order('tenant_id', { ascending: false, nullsFirst: false }).limit(1).maybeSingle();

    const system = `${camada.camada}\n\n${instrucaoContrato(framework, rubrica)}`;

    // 3) Chamada real ao modelo (dry-run: nada é gravado).
    const key = Deno.env.get('ANTHROPIC_API_KEY') || Deno.env.get('CLAUDE_API_KEY');
    if (!key) return json({ ok: false, error: 'ANTHROPIC_API_KEY nao configurada' }, 200);
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL, max_tokens: 4000, temperature: 0.2, system,
        messages: [{ role: 'user', content: CONVERSA_EXEMPLO }],
      }),
    });
    if (!res.ok) {
      return json({ ok: false, error: `modelo indisponivel (${res.status})`, detalhe: String(await res.text().catch(() => '')).slice(0, 200) }, 200);
    }
    const data = await res.json();
    const text = (data?.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
    const inTok = data?.usage?.input_tokens || 0;
    const outTok = data?.usage?.output_tokens || 0;
    const p = PRECOS[MODEL] || PRECOS['claude-haiku-4-5'];
    const custo = (inTok * p.in + outTok * p.out) / 1_000_000;

    // 4) Valida o contrato: JSON parseável + TODAS as chaves obrigatórias.
    const parsed = parseContratoLocal(text);
    const faltantes = parsed
      ? CONTRATO_CHAVES_OBRIGATORIAS.filter((k) => !(k in parsed))
      : [...CONTRATO_CHAVES_OBRIGATORIAS];
    const jsonValido = !!parsed && faltantes.length === 0;

    return json({
      ok: true,
      dry_run: true,
      camada_usada: camada.usado, // 'padrao' | 'personalizado'
      json_valido: jsonValido,
      campos_faltantes: faltantes,
      tokens: inTok + outTok,
      custo_usd: Number(custo.toFixed(6)),
      exemplo: parsed ? {
        resumo_executivo: String(parsed.resumo_executivo || '').slice(0, 300),
        frase_coaching: String(parsed.frase_coaching || '').slice(0, 300),
        risco_perda: parsed.risco_perda ?? null,
        acao_gestor: String(parsed.acao_gestor || '').slice(0, 300),
        potencial_compra: parsed.potencial_compra ?? null,
      } : null,
      aviso: jsonValido
        ? null
        : (parsed
          ? `A IA respondeu JSON mas faltaram campos obrigatorios: ${faltantes.join(', ')}. Ajuste o prompt (nao remova instrucoes de formato).`
          : 'A IA nao devolveu JSON valido com este prompt. Analises reais falhariam (status=falhou) — ajuste o prompt.'),
    });
  } catch (e: any) {
    return json({ ok: false, error: String(e?.message || e).slice(0, 300) }, 200);
  }
});
