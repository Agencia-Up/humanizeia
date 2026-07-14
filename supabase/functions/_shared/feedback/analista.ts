// deno-lint-ignore-file no-explicit-any
// ============================================================================
// DUAS FONTES DE FEEDBACK — NÃO CONFUNDIR (documentação da auditoria 10/07):
//
//  1) `pedro_manager_feedback` (ANTIGA) — é o feedback do REPASSE: quando o Pedro
//     transfere o lead pro vendedor, gera um "briefing/feedback" pro gerente
//     (content, reason, observations, sent_to_manager_at). É parte do fluxo de
//     TRANSFERÊNCIA e NÃO deve ser alterado por aqui. No frontend, quem lê essa
//     fonte é o painel `FeedbackAnalytics.tsx` (concordância vendedor×IA, motivos).
//
//  2) `feedback_conversas` + NEPQ (NOVA — este módulo) — é a análise de QUALIDADE
//     do ATENDIMENTO por conversa: score (0-100), qualidade_lead, veredito, e as
//     dimensões NEPQ (`feedback_dimensoes`/`feedback_rubricas`/rollup). Alimenta as
//     3 abas de `FeedbacksArea.tsx` (Por vendedor, NEPQ, Histórico diário) e os
//     alertas de "cliente bom em risco". Ligado por `feedback_config.feature_flags`
//     (analise/alertas/relatorio) por tenant, com teto de custo (feedback_cost_gate).
//
//  Regra de ouro: este arquivo (fonte NOVA) nunca toca em repasse/CRM/follow-up.
// ============================================================================
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { buildLeadThread, LeadThread, Cobertura } from './ingestor.ts';

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
  nepq_score?: number | null;
  nepq_semaforo?: string | null;
  confianca_analise?: 'alta' | 'media' | 'baixa';
}

function montarPromptUsuario(t: LeadThread): string {
  const ctx = t.contexto_ia.map((m) => `[${m.timestamp}] ${m.from.toUpperCase()}: ${m.texto}`).join('\n');
  const vend = t.thread.map((m) => `[${m.timestamp}] ${m.from.toUpperCase()}: ${m.texto}`).join('\n');
  const primeiroNome = (t.vendedor_nome || '').trim().split(/\s+/)[0] || '';
  return [
    `VENDEDOR AVALIADO: ${t.vendedor_nome || '(desconhecido)'}. O coaching e a nota sao SOBRE ELE. Fale COM o vendedor${primeiroNome ? ` (pelo primeiro nome: ${primeiroNome})` : ''}. NUNCA chame o vendedor pelo nome do cliente.`,
    `CLIENTE / LEAD: ${t.lead_nome || '(sem nome)'} | telefone: ${t.telefone || '?'} | campanha/anuncio: ${t.ad_name || t.campanha_id || '(sem)'}`,
    `SINAIS ESTRUTURADOS DO LEAD: ${JSON.stringify(t.sinais_estruturados)}`,
    ctx ? `\nCONTEXTO — a IA (Pedro) ja qualificou este lead ANTES. Use so como pano de fundo, NAO avalie a IA:\n${ctx}` : '',
    `\nATENDIMENTO DO VENDEDOR HUMANO${primeiroNome ? ` (${primeiroNome})` : ''} COM O CLIENTE (avalie APENAS isto):\n${vend || '(o vendedor NAO respondeu / nao ha conversa do vendedor)'}`,
  ].join('\n');
}

function instrucaoContrato(framework: any, rubrica?: any): string {
  const comps = Object.keys(framework?.competencias || {});
  const compFields = comps.length
    ? comps.map((c) => `"${c}":{"nota":0,"evidencia":""}`).join(',')
    : '"velocidade":{"nota":0,"evidencia":""}';

  // Bloco NEPQ (aditivo): só entra quando há rubrica ativa. Pede uma nota 0-4 +
  // evidência por dimensão. NÃO substitui as competências (mantém compatível).
  const defs: any[] = rubrica?.definicao?.dimensoes || [];
  let nepqField = '';
  let nepqRegras = '';
  if (defs.length) {
    nepqField = `\n "dimensoes_nepq":[${defs.map((d) => `{"cod":"${d.cod}","nota":0,"evidencia":"","observacao":""}`).join(',')}],`;
    const lista = defs.map((d) => `- ${d.cod} (${d.nome}): ${d.criterio}`).join('\n');
    nepqRegras = `\nDIMENSOES NEPQ (avalie o VENDEDOR em cada uma, nota INTEIRA de 0 a 4 — 0=nao fez, 2=parcial, 4=exemplar — com um trecho-evidencia curto da conversa; observacao opcional de 1 linha). Use EXATAMENTE estes codigos:\n${lista}\nA nota NEPQ e hipotese: se houve lead qualificado perdido, uma nota alta nao vira "bom atendimento". Baseie-se so na conversa e cite evidencia.`;
  }

  return `Avalie o ATENDIMENTO e extraia SINAIS do cliente. Responda SOMENTE um JSON valido, nada fora dele:
{
 "versao":"1.0",
 "sinais":{"carro_na_troca":false,"entrada_pct":null,"tem_entrada":false,"nome_limpo":true,"restricao":false,"clique_sem_querer":false,"produto_errado":false,"fora_idade":false,"sem_intencao":false},
 "produto":"",
 "potencial_compra":"sem_dados",
 "competencias":{${compFields}},${nepqField}
 "tempo_primeira_resposta_min":null,
 "perfil_idade":{"faixa":"desconhecida","fora_do_perfil":false},
 "houve_venda":false,
 "vendedor_descartou_lead_bom":false,
 "motivos_desqualificacao":[],
 "pontos_fortes":[],
 "oportunidades_perdidas":[{"texto":"","trecho":"","horario":""}],
 "frase_coaching":"",
 "resumo_executivo":"",
 "evidencia_principal":"",
 "risco_perda":"baixo",
 "acao_gestor":"",
 "acao_vendedor":"",
 "proxima_pergunta_ideal":""
}
Regras: classifique pela CONVERSA, nunca pela palavra do vendedor. Cada competencia: nota 0-100 + um trecho-evidencia com horario. entrada_pct = % da entrada sobre o valor do carro (null se nao der pra saber). "vendedor_descartou_lead_bom"=true se o vendedor tratou/rotulou como ruim um cliente que tinha carro na troca e/ou entrada.
"potencial_compra" ('alto'|'medio'|'baixo'|'nao_lead'|'sem_dados'): siga a REGUA DE POTENCIAL — 'alto' exige sinal FORTE e explicito (troca oferecida, entrada dita, pediu financiamento/simulacao, marcou/pediu visita ou endereco); 'medio' = interesse claro em carro especifico + pergunta objetiva de preco/parcela/condicao; responder mensagem ou cumprimentar NAO e interesse; sem evidencia suficiente = 'sem_dados'.
"produto": o produto/modelo que o cliente demonstrou interesse na conversa (ex.: "Onix 2020", "Hilux", "HB20"). Use o nome CURTO e canonico do modelo (sem versao/motor completos). Se o cliente NAO falou de produto nenhum (clique sem querer, assunto fora do que foi anunciado, sem intencao), deixe "" (string vazia).
"tempo_primeira_resposta_min": calcule APENAS a partir dos timestamps entre colchetes; se nao der pra calcular com certeza, deixe null — NUNCA estime.${nepqRegras}
"resumo_executivo": 1 frase para o gestor entender o caso sem abrir a conversa.
"evidencia_principal": copie um trecho curto da conversa com horario que prove a conclusao.
"risco_perda": "alto" quando lead forte/bom foi mal atendido ou abandonado; "medio" quando ha chance real mas falta fechamento; "baixo" nos demais.
"acao_gestor": comando pratico para o gestor fazer hoje, sem texto generico.
"acao_vendedor": orientacao curta e aplicavel para o vendedor corrigir ou repetir.
"proxima_pergunta_ideal": a pergunta que o vendedor deveria ter feito no momento critico.
IMPORTANTE: sua resposta deve ser APENAS o objeto JSON, comecando com { e terminando com }. Sem markdown, sem crases, sem nenhum texto antes ou depois. Use exatamente as chaves mostradas acima.`;
}

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

// ── NEPQ (Fase 1) — pontuação por dimensão (0-4), aditiva ao score de competência.
// Funções puras (testáveis sem Deno/Supabase).
const clampNota04 = (v: any): number => {
  const n = Math.round(Number(v));
  return isNaN(n) ? 0 : Math.max(0, Math.min(4, n));
};

// score_geral 0-100 = soma ponderada de (nota/4 * peso). Pesos da rubrica somam 100.
export function calcScoreNepq(dimsSaida: any[], rubrica: any): number {
  const defs: any[] = rubrica?.definicao?.dimensoes || [];
  if (!defs.length) return 0;
  const notaPorCod = new Map<string, number>();
  for (const d of Array.isArray(dimsSaida) ? dimsSaida : []) {
    if (d && d.cod) notaPorCod.set(String(d.cod), clampNota04(d.nota));
  }
  let soma = 0, totalPeso = 0;
  for (const def of defs) {
    const peso = Number(def?.peso) || 0;
    if (peso <= 0) continue;
    const nota = notaPorCod.get(String(def.cod)) ?? 0;
    soma += (nota / 4) * peso;
    totalPeso += peso;
  }
  return totalPeso > 0 ? Math.round(soma * (100 / totalPeso)) : 0;
}

export function semaforoNepq(score: number, rubrica: any): 'verde' | 'amarelo' | 'vermelho' {
  const f = rubrica?.definicao?.faixas_semaforo || {};
  const dentro = (par: any) => Array.isArray(par) && score >= Number(par[0]) && score <= Number(par[1]);
  if (dentro(f.verde)) return 'verde';
  if (dentro(f.vermelho)) return 'vermelho';
  return 'amarelo';
}

// Monta as linhas de feedback_dimensoes (uma por dimensão da rubrica presente na saída).
export function montarLinhasDimensoes(
  dimsSaida: any[], rubrica: any, tenantId: string, analiseId: string, vendedorId: string | null,
): Array<{ tenant_id: string; analise_id: string; vendedor_id: string | null; dimensao_cod: string; nota: number }> {
  const defsCods = new Set<string>((rubrica?.definicao?.dimensoes || []).map((d: any) => String(d.cod)));
  const linhas: any[] = [];
  for (const d of Array.isArray(dimsSaida) ? dimsSaida : []) {
    const cod = String(d?.cod || '');
    if (!defsCods.has(cod)) continue; // ignora cód. inventado pela LLM
    linhas.push({ tenant_id: tenantId, analise_id: analiseId, vendedor_id: vendedorId, dimensao_cod: cod, nota: clampNota04(d?.nota) });
  }
  return linhas;
}

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

// ── Fase 3 — Confiança da análise (função PURA, testável) ────────────────────
// A confiança é DETERMINÍSTICA e calculada em código a partir da cobertura real
// da conversa (não pela IA). Régua aprovada pelo dono. Mensagens úteis = do
// vendedor + do cliente (a IA é só contexto).
export function calcularConfianca(cob: Cobertura): {
  confianca_analise: 'alta' | 'media' | 'baixa';
  motivo_confianca: string;
  conversa_vendedor_suficiente: boolean;
} {
  const v = cob.mensagens_vendedor_lidas;
  const c = cob.mensagens_cliente_lidas;
  const at = cob.audios_total;
  const atr = cob.audios_transcritos;
  const asem = cob.audios_sem_transcricao;
  const uteis = v + c;
  const conversa_vendedor_suficiente = v >= 2;

  // BAIXA
  if (v === 0) return { confianca_analise: 'baixa', motivo_confianca: 'sem conversa do vendedor', conversa_vendedor_suficiente };
  if (c === 0) return { confianca_analise: 'baixa', motivo_confianca: 'sem mensagens do cliente', conversa_vendedor_suficiente };
  if (uteis < 3) return { confianca_analise: 'baixa', motivo_confianca: 'conversa muito curta (pouca evidencia)', conversa_vendedor_suficiente };
  if (at >= 3 && atr === 0) return { confianca_analise: 'baixa', motivo_confianca: `${at} audios sem transcricao`, conversa_vendedor_suficiente };

  // ALTA
  const audioOk = at === 0 || (atr / at) >= 0.7;
  if (c >= 2 && v >= 2 && audioOk) {
    return { confianca_analise: 'alta', motivo_confianca: 'conversa completa do cliente e do vendedor', conversa_vendedor_suficiente };
  }

  // MEDIA (o resto)
  let motivo = 'conversa parcial';
  if (v >= 1 && v <= 2) motivo = 'poucas mensagens do vendedor';
  else if (asem > 0 && asem >= atr) motivo = 'audios sem transcricao relevantes';
  return { confianca_analise: 'media', motivo_confianca: motivo, conversa_vendedor_suficiente };
}

function parseContrato(text: string): any {
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

export async function analisarLead(
  admin: SupabaseClient, llm: LlmCall,
  leadSource: 'pedro' | 'marcos', leadId: string, versaoThread = 'v1',
): Promise<AnaliseResultado> {
  const thread = await buildLeadThread(admin, leadSource, leadId);
  if (!thread) return { status: 'falhou', motivo: 'lead nao encontrado' };
  const tenant = thread.tenant_id;

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

  // Rubrica NEPQ ativa (linha do tenant sobrescreve a global). null = sem NEPQ
  // (comportamento antigo intacto).
  const { data: rubrica } = await admin
    .from('feedback_rubricas')
    .select('id, definicao')
    .eq('framework', 'nepq').eq('ativa', true)
    .or(`tenant_id.eq.${tenant},tenant_id.is.null`)
    .order('tenant_id', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  const { data: gate } = await admin.rpc('feedback_cost_gate', { p_tenant: tenant });
  if (!gate?.allowed) return { status: 'pulado', motivo: gate?.reason || 'cap' };

  const system = `${promptEsp}\n\n${instrucaoContrato(framework, rubrica)}`;
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

  const parsed = parseContrato(out.text);

  // Item 5: JSON invalido NAO vira analise valida. Grava status 'falhou' + _raw
  // pra debug, contabiliza o custo (a chamada ao LLM aconteceu) e deixa
  // retentavel (feedback_leads_pendentes reprocessa quem nao esta 'concluido').
  // Nao alimenta relatorio/score/qualidade com dado nao confiavel.
  if (!parsed) {
    await admin.rpc('feedback_cost_record', { p_tenant: tenant, p_tokens: out.tokens, p_custo: out.custo });
    await admin.from('feedback_conversas').upsert({
      tenant_id: tenant, lead_source: leadSource, lead_id: leadId, versao_thread: versaoThread,
      vendedor_id: thread.vendedor_id, campanha_id: thread.campanha_id,
      status: 'falhou', erro: 'json invalido',
      resultado: { _parse_ok: false, _raw: out.text.slice(0, 1800) },
      custo_usd: out.custo, tokens: out.tokens,
    }, { onConflict: 'lead_source,lead_id,versao_thread' });
    return { status: 'falhou', motivo: 'json invalido', custo_usd: out.custo, tokens: out.tokens };
  }

  const contrato = parsed;
  const sinais = contrato.sinais || {};
  const score = calcScore(contrato.competencias, framework);

  const { data: qualidade } = await admin.rpc('feedback_classificar_qualidade', {
    p_tenant: tenant, p_nicho: nicho, p_signals: sinais,
  });
  // A régua de sinais DUROS (feedback_regras_qualidade: carro_na_troca+entrada, etc.)
  // só bate em casos raros -> a maioria vinha NULL. Fallback pela leitura holística da
  // IA (potencial_compra), que reflete melhor a realidade da conversa:
  //   alto -> qualificado(1) · medio -> pouco(2) · baixo -> ruim(3) · nao_lead -> nem-é-lead(4)
  //   sem_dados/'' -> fica null (a IA não teve evidência pra classificar).
  const POT_QUALIDADE: Record<string, string> = { alto: '1_alto', medio: '2_medio', baixo: '3_baixo', nao_lead: '4_nao_lead' };
  const q = (qualidade as string) || POT_QUALIDADE[String(contrato.potencial_compra || '').toLowerCase()] || null;

  const veredito = decidirVeredito(q, score, !!contrato.houve_venda, !!contrato.vendedor_descartou_lead_bom);
  const rotulagem = veredito === 'rotulagem_incorreta';

  await admin.rpc('feedback_cost_record', { p_tenant: tenant, p_tokens: out.tokens, p_custo: out.custo });

  // NEPQ (aditivo): pontuação por dimensão + score/semáforo. Só quando há rubrica.
  const dimsSaida: any[] = Array.isArray(contrato.dimensoes_nepq) ? contrato.dimensoes_nepq : [];
  const temNepq = !!rubrica && dimsSaida.length > 0;
  const nepqScore = temNepq ? calcScoreNepq(dimsSaida, rubrica) : null;
  const nepqSemaforo = temNepq ? semaforoNepq(nepqScore as number, rubrica) : null;

  // Fase 3 — confiança da análise (determinística, a partir da cobertura real).
  // Não altera o prompt (custo de IA inalterado); só descreve o que foi lido.
  const cobertura = thread.cobertura;
  const conf = calcularConfianca(cobertura);

  const resultado = {
    ...contrato,
    versao: contrato.versao || '1.0',
    qualidade_lead: q,
    score_atendimento: score,
    veredito,
    custo_usd: out.custo,
    tokens: out.tokens,
    ...(temNepq ? { nepq_score: nepqScore, nepq_semaforo: nepqSemaforo, nepq_rubrica_slug: 'nepq-auto-whatsapp-v1' } : {}),
    // Fase 3 (aditivo): cobertura + confiança pra o painel/relatório nunca afirmarem
    // com 100% de certeza quando faltou conversa/áudio.
    cobertura,
    confianca_analise: conf.confianca_analise,
    motivo_confianca: conf.motivo_confianca,
    conversa_vendedor_suficiente: conf.conversa_vendedor_suficiente,
    _parse_ok: !!parsed,
    _raw: parsed ? null : out.text.slice(0, 1800),
  };

  // Produto/carro em foco na conversa (pra cruzar qualidade x produto no painel
  // "Por produto"). Guarda o que a IA extraiu; vazio -> null (a RPC feedback_produtos_qualidade
  // cai no ai_crm_leads.vehicle_interest no read).
  const produtoInteresse = (typeof contrato.produto === 'string' && contrato.produto.trim())
    ? contrato.produto.trim().slice(0, 120) : null;

  const { data: fcRow } = await admin.from('feedback_conversas').upsert({
    tenant_id: tenant, lead_source: leadSource, lead_id: leadId, versao_thread: versaoThread,
    vendedor_id: thread.vendedor_id, campanha_id: thread.campanha_id,
    produto_interesse: produtoInteresse,
    qualidade_lead: q, score_atendimento: score, veredito, rotulagem_incorreta: rotulagem,
    resultado, custo_usd: out.custo, tokens: out.tokens,
    rubrica_id: rubrica?.id || null,
    confianca_analise: conf.confianca_analise,
    status: 'concluido', analisado_em: new Date().toISOString(),
  }, { onConflict: 'lead_source,lead_id,versao_thread' }).select('id').single();

  // Explode as notas NEPQ em feedback_dimensoes (normalizada p/ radar/rollup).
  // Reescreve (delete+insert) pra ser idempotente em reanálise. Best-effort.
  if (temNepq && fcRow?.id) {
    try {
      const linhas = montarLinhasDimensoes(dimsSaida, rubrica, tenant, fcRow.id, thread.vendedor_id || null);
      await admin.from('feedback_dimensoes').delete().eq('analise_id', fcRow.id);
      if (linhas.length) await admin.from('feedback_dimensoes').insert(linhas);
    } catch (_e) { /* não bloqueia a análise principal */ }
  }

  // Alimenta o José (Bloco D): grava a qualidade apurada no cadastro do lead.
  // A Cabine/lead_quality_by_ad lê qualidade_lead por campanha/anúncio. Só
  // preenche quando ainda está vazio (não briga com o carimbo do Pedro).
  if (leadSource === 'pedro') {
    try {
      // Ordem de evidencia: regras oficiais (q) > potencial_compra do LLM (regua
      // rigida) > temperatura do Pedro. SEM evidencia => NAO carimba (null) — o
      // Jose mostra "sem classificacao" honesto em vez de um "medio" inventado.
      const pc = String(contrato.potencial_compra || '').toLowerCase();
      const temp = String((thread.sinais_estruturados as any)?.temperature || '').toLowerCase();
      const ql = q === '1_alto' ? 'bom'
        : q === '2_medio' ? 'medio'
        : (q === '3_baixo' || q === '4_nao_lead') ? 'ruim'
        : pc === 'alto' ? 'bom'
        : pc === 'medio' ? 'medio'
        : (pc === 'baixo' || pc === 'nao_lead') ? 'ruim'
        : (temp === 'quente' ? 'bom' : temp === 'frio' ? 'ruim' : null);
      if (ql) {
        await admin.from('ai_crm_leads')
          .update({
            qualidade_lead: ql,
            motivo_classificacao: `cerebro-feedback: ${q || (pc && pc !== 'sem_dados' ? `potencial ${pc}` : `temperatura ${temp || 'desconhecida'}`)}`,
            classificado_em: new Date().toISOString(),
            classificado_por: 'timoteo',
          })
          .eq('id', leadId)
          .is('qualidade_lead', null);
      }
    } catch (_e) { /* não bloqueia a análise */ }
  }

  return {
    status: 'concluido', qualidade_lead: q, score_atendimento: score,
    veredito, rotulagem_incorreta: rotulagem, custo_usd: out.custo, tokens: out.tokens,
    nepq_score: nepqScore, nepq_semaforo: nepqSemaforo,
    confianca_analise: conf.confianca_analise,
  };
}
