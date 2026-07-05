// deno-lint-ignore-file no-explicit-any
// ============================================================================
// Cérebro de Feedback — FASE 2: o especialista (análise da conversa)
// ----------------------------------------------------------------------------
// Fluxo (por lead): cost gate (Fase 0) -> thread (Fase 1) -> Claude (especialista)
// -> contrato de saída -> motor de regras (qualidade 1–4 pela CONFIG, não pelo LLM)
// -> veredito de atribuição -> persiste em feedback_conversas (idempotente) + custo.
// O LLM é INJETADO (LlmCall) para dar pra testar sem API real.
// ============================================================================

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { buildLeadThread, LeadThread } from './ingestor.ts';

export type LlmCall = (
  system: string, userText: string, userId: string,
) => Promise<{ text: string; tokens: number; custo: number } | null>;

const QUALIDADE_BOA = new Set(['1_alto', '2_medio']);

export interface AnaliseResultado {
  status: 'concluido' | 'pulado' | 'falhou';
  motivo?: string;
  qualidade_lead?: string | null;
  score_atendimento?: number;
  veredito?: string | null;
  rotulagem_incorreta?: boolean;
  custo_usd?: number;
  tokens?: number;
}

function montarPromptUsuario(t: LeadThread): string {
  const linhas = t.thread.map((m) => `[${m.timestamp}] ${m.from.toUpperCase()} (${m.canal}): ${m.texto}`).join('\n');
  return [
    `LEAD: ${t.lead_nome || '(sem nome)'} | origem: ${t.lead_source} | campanha/anuncio: ${t.ad_name || t.campanha_id || '(sem)'}`,
    `SINAIS ESTRUTURADOS JA CAPTURADOS: ${JSON.stringify(t.sinais_estruturados)}`,
    `\nCONVERSA (cronologica):\n${linhas || '(sem mensagens)'}`,
  ].join('\n');
}

function instrucaoContrato(framework: any): string {
  const comps = Object.keys(framework?.competencias || {});
  const compFields = comps.length
    ? comps.map((c) => `"${c}":{"nota":0,"evidencia":""}`).join(',')
    : '"velocidade":{"nota":0,"evidencia":""}';
  return `Avalie o ATENDIMENTO e extraia SINAIS do cliente. Responda SOMENTE um JSON valido, nada fora dele:
{
 "versao":"1.0",
 "sinais":{"carro_na_troca":false,"entrada_pct":null,"tem_entrada":false,"nome_limpo":true,"restricao":false,"clique_sem_querer":false,"produto_errado":false,"fora_idade":false,"sem_intencao":false},
 "competencias":{${compFields}},
 "tempo_primeira_resposta_min":null,
 "perfil_idade":{"faixa":"desconhecida","fora_do_perfil":false},
 "houve_venda":false,
 "vendedor_descartou_lead_bom":false,
 "motivos_desqualificacao":[],
 "pontos_fortes":[],
 "oportunidades_perdidas":[{"texto":"","trecho":"","horario":""}],
 "frase_coaching":""
}
Regras: classifique pela CONVERSA, nunca pela palavra do vendedor. Cada competencia: nota 0-100 + um trecho-evidencia com horario. entrada_pct = % da entrada sobre o valor do carro (null se nao der pra saber). "vendedor_descartou_lead_bom"=true se o vendedor tratou/rotulou como ruim um cliente que tinha carro na troca e/ou entrada.`;
}

// score do atendimento = média das competências ponderada pelos pesos da config
function calcScore(competencias: any, framework: any): number {
  const pesos = framework?.competencias || {};
  let soma = 0, total = 0;
  for (const k of Object.keys(pesos)) {
    const p = Number(pesos[k]) || 0;
    const nota = Number(competencias?.[k]?.nota);
    if (p > 0 && !isNaN(nota)) { soma += nota * p; total += p; }
  }
  return total > 0 ? Math.round(soma / total) : 0;
}

// veredito de atribuição (tabela do prompt, seção 3)
export function decidirVeredito(
  qualidade: string | null, score: number, houveVenda: boolean, descartou: boolean,
): string | null {
  if (houveVenda) return 'venda_realizada';
  if (!qualidade) return null;
  if (QUALIDADE_BOA.has(qualidade) && descartou) return 'rotulagem_incorreta';
  if (qualidade === '3_baixo' || qualidade === '4_nao_lead') return 'lead_ruim';
  if (QUALIDADE_BOA.has(qualidade)) return score < 50 ? 'falha_atendimento' : 'perda_legitima';
  return null;
}

function parseContrato(text: string): any {
  try {
    const clean = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
    return JSON.parse(clean);
  } catch {
    return null;
  }
}

export async function analisarLead(
  admin: SupabaseClient, llm: LlmCall,
  leadSource: 'pedro' | 'marcos', leadId: string, versaoThread = 'v1',
): Promise<AnaliseResultado> {
  const thread = await buildLeadThread(admin, leadSource, leadId);
  if (!thread) return { status: 'falhou', motivo: 'lead nao encontrado' };
  const tenant = thread.tenant_id;

  // config do nicho (tenant sobrepõe o default global)
  const { data: cfg } = await admin
    .from('feedback_config')
    .select('nicho, framework, prompt_especialista')
    .or(`tenant_id.eq.${tenant},tenant_id.is.null`)
    .order('tenant_id', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  const nicho = cfg?.nicho || 'automotivo';
  const framework = cfg?.framework || {};
  const promptEsp = cfg?.prompt_especialista || '';

  // cost gate ANTES de qualquer chamada de IA
  const { data: gate } = await admin.rpc('feedback_cost_gate', { p_tenant: tenant });
  if (!gate?.allowed) return { status: 'pulado', motivo: gate?.reason || 'cap' };

  // chamada ao especialista (Claude)
  const system = `${promptEsp}\n\n${instrucaoContrato(framework)}`;
  const userText = montarPromptUsuario(thread);
  let out: { text: string; tokens: number; custo: number } | null = null;
  try { out = await llm(system, userText, tenant); } catch { out = null; }

  if (!out || !out.text) {
    await admin.from('feedback_conversas').upsert({
      tenant_id: tenant, lead_source: leadSource, lead_id: leadId, versao_thread: versaoThread,
      vendedor_id: thread.vendedor_id, campanha_id: thread.campanha_id,
      status: 'falhou', erro: 'llm sem resposta',
    }, { onConflict: 'lead_source,lead_id,versao_thread' });
    return { status: 'falhou', motivo: 'llm sem resposta' };
  }

  const contrato = parseContrato(out.text) || {};
  const sinais = contrato.sinais || {};
  const score = calcScore(contrato.competencias, framework);

  // qualidade 1–4 vem 100% da CONFIG (motor de regras), não do LLM
  const { data: qualidade } = await admin.rpc('feedback_classificar_qualidade', {
    p_tenant: tenant, p_nicho: nicho, p_signals: sinais,
  });
  const q = (qualidade as string) || null;

  const veredito = decidirVeredito(q, score, !!contrato.houve_venda, !!contrato.vendedor_descartou_lead_bom);
  const rotulagem = veredito === 'rotulagem_incorreta';

  // registra o custo real no medidor do cap
  await admin.rpc('feedback_cost_record', { p_tenant: tenant, p_tokens: out.tokens, p_custo: out.custo });

  const resultado = {
    ...contrato,
    versao: contrato.versao || '1.0',
    qualidade_lead: q,
    score_atendimento: score,
    veredito,
    custo_usd: out.custo,
    tokens: out.tokens,
  };

  await admin.from('feedback_conversas').upsert({
    tenant_id: tenant, lead_source: leadSource, lead_id: leadId, versao_thread: versaoThread,
    vendedor_id: thread.vendedor_id, campanha_id: thread.campanha_id,
    qualidade_lead: q, score_atendimento: score, veredito, rotulagem_incorreta: rotulagem,
    resultado, custo_usd: out.custo, tokens: out.tokens,
    status: 'concluido', analisado_em: new Date().toISOString(),
  }, { onConflict: 'lead_source,lead_id,versao_thread' });

  return {
    status: 'concluido', qualidade_lead: q, score_atendimento: score,
    veredito, rotulagem_incorreta: rotulagem, custo_usd: out.custo, tokens: out.tokens,
  };
}
