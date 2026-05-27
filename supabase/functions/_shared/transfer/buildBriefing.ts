// ============================================================================
// buildBriefing.ts — Geração unificada do briefing IA enviado ao vendedor
// ----------------------------------------------------------------------------
// Helper compartilhado entre edge functions. Resolve BUG-15: hoje existem
// 5 templates diferentes de "novo lead pro vendedor" espalhados por:
//   - uazapi-webhook (tool transferir_para_vendedor → buildEnrichedBriefing)
//   - uazapi-webhook (status qualificável → template inline)
//   - manual-transfer (buildConversationBriefing)
//   - bulk-transfer-leads (template inline "REDISTRIBUIÇÃO")
//   - transfer-timeout-checker (template inline "LEAD QUALIFICADO")
// Vendedor recebe formato visualmente diferente dependendo do caminho.
//
// Esta lib oferece 3 funções com formato CONSISTENTE:
//   - buildEnrichedBriefing()    — versão completa (state estruturado Pedro)
//   - buildConversationBriefing() — fallback usando wa_chat_history
//   - buildSimpleBriefing()       — versão mínima quando state/history não existem
//
// Todas terminam com a mesma estrutura visual (emoji + nome + dados +
// próxima ação + link wa.me). A diferença é a RIQUEZA dos dados disponíveis.
//
// IMPORTANTE: criada na FASE 0 do PLANO_CORRECAO_BUGS. Os caminhos atuais
// continuam usando suas funções inline até a FASE 1 trocar os imports.
// ============================================================================

// ─── Tipos compartilhados ──────────────────────────────────────────────────

export type HandoffUrgencia = 'baixa' | 'media' | 'alta' | string;
export type HandoffCategoria =
  | 'demonstrou_interesse_real'
  | 'pediu_falar_com_humano'
  | 'pronto_para_negociar'
  | 'objecao_complexa'
  | 'negociacao_preco'
  | 'fora_escopo'
  | 'erro_agente'
  | string;

export interface HandoffTransferArgs {
  urgencia?: HandoffUrgencia;
  motivo?: string;
  motivo_categoria?: HandoffCategoria;
  resumo_breve?: string;
  proxima_acao_sugerida?: string;
}

export interface ConversationLeadLike {
  remote_jid?: string | null;
  lead_name?: string | null;
  summary?: string | null;
  agent_id?: string | null;
}

const HANDOFF_URGENCIA_EMOJI: Record<string, string> = {
  baixa: '🟢',
  media: '🟡',
  alta: '🔴',
};

const HANDOFF_CATEGORIA_LABEL: Record<string, string> = {
  demonstrou_interesse_real: 'Demonstrou interesse real',
  pediu_falar_com_humano: 'Pediu falar com humano',
  pronto_para_negociar: 'Pronto pra negociar',
  objecao_complexa: 'Objeção complexa',
  negociacao_preco: 'Negociação de preço',
  fora_escopo: 'Fora do escopo do agente',
  erro_agente: 'Agente travado / erro',
};

// ─── Versão V2 (enriquecida, usa state estruturado do Pedro) ───────────────

export function buildEnrichedBriefing(input: {
  state: any;
  leadName: string;
  leadPhone: string;
  agentName: string;
  transferArgs: HandoffTransferArgs;
  scoreInfo?: { score: number; tier: string };
  bantNextSuggestedAsk?: string;
}): string {
  const { state, leadName, leadPhone, agentName, transferArgs, scoreInfo, bantNextSuggestedAsk } = input;
  const s = state || {};
  const lines: string[] = [];
  const urgencia = transferArgs.urgencia ?? 'media';
  const emoji = HANDOFF_URGENCIA_EMOJI[urgencia] || '🟡';
  const displayName = s.lead?.nome_completo || s.lead?.nome || leadName || 'Lead';
  lines.push(`${emoji} *LEAD QUALIFICADO — ${displayName}* (urgência: ${urgencia})`);
  lines.push(`📱 Telefone: ${s.lead?.telefone || leadPhone}`);
  if (s.lead?.cidade) lines.push(`🏙️ Cidade: ${s.lead.cidade}`);
  if (scoreInfo) lines.push(`📊 Score: ${scoreInfo.score}/100 (${scoreInfo.tier})`);
  lines.push('');
  if (transferArgs.motivo_categoria) {
    const catLabel = HANDOFF_CATEGORIA_LABEL[transferArgs.motivo_categoria] || transferArgs.motivo_categoria;
    lines.push(`🎯 *Motivo:* ${catLabel}`);
  }
  if (transferArgs.motivo) lines.push(`💬 *Detalhe:* ${transferArgs.motivo}`);
  if (transferArgs.resumo_breve && transferArgs.resumo_breve !== transferArgs.motivo) {
    lines.push(`📝 *Resumo:* ${transferArgs.resumo_breve}`);
  }
  lines.push('');
  if (s.interesse?.modelo_desejado) {
    const conf = [s.interesse.configuracao, s.interesse.combustivel, s.interesse.cambio].filter(Boolean).join(', ');
    lines.push(`🚗 *Interesse:* ${s.interesse.modelo_desejado}${conf ? ` (${conf})` : ''}`);
  }
  if (s.veiculo_apresentado?.ja_apresentado) {
    const vp = s.veiculo_apresentado;
    lines.push(`📋 *Veículo apresentado:* ${vp.modelo || ''} ${vp.ano || ''}${vp.preco ? ` — R$ ${vp.preco}` : ''}`);
  }
  if (s.negociacao?.forma_pagamento) lines.push(`💰 *Forma de pagamento:* ${s.negociacao.forma_pagamento}`);
  if (s.negociacao?.valor_entrada) lines.push(`💵 *Entrada:* ${s.negociacao.valor_entrada}`);
  if (s.negociacao?.tem_troca && s.negociacao?.carro_troca) {
    const ct = s.negociacao.carro_troca;
    const trocaParts = [ct.modelo, ct.ano, ct.configuracao, ct.cambio].filter(Boolean).join(' ');
    lines.push(`🔄 *Troca:* ${trocaParts || 'sim'}${ct.status ? ` (${ct.status})` : ''}`);
  }
  if (s.atendimento?.pode_visitar_loja === false) {
    lines.push(`📍 *Visita:* NÃO pode visitar — atendimento REMOTO`);
  }
  if (s.atendimento?.objecoes && s.atendimento.objecoes.length > 0) {
    lines.push(`⚠️ *Objeções:* ${s.atendimento.objecoes.join(', ')}`);
  }
  if (s.lead?.acompanhante_decisao) lines.push(`👥 *Decisão envolve:* ${s.lead.acompanhante_decisao}`);
  if (transferArgs.proxima_acao_sugerida || bantNextSuggestedAsk) {
    lines.push('');
    lines.push(`👉 *Próxima ação sugerida:* ${transferArgs.proxima_acao_sugerida || bantNextSuggestedAsk}`);
  }
  lines.push('');
  lines.push(`📲 *Atender:* https://wa.me/${(s.lead?.telefone || leadPhone || '').replace(/\D/g, '')}`);
  lines.push('');
  lines.push(`_Briefing V2 gerado pelo Pedro SDR (${agentName})_`);
  return lines.join('\n');
}

// ─── Versão CONVERSATION (resumo do lead + últimas mensagens do WhatsApp) ──

/**
 * Briefing baseado em CONVERSAS REAIS. Usado quando não há state estruturado
 * (transferência manual via UI), mas há histórico do WhatsApp disponível.
 *
 * Fonte:
 *   - lead.summary (resumo gerado pela IA, salvo em ai_crm_leads.summary)
 *   - wa_chat_history (últimas 12 mensagens, ordenadas cronologicamente)
 *
 * Tamanho máximo: 1800 caracteres (truncamento natural).
 */
export async function buildConversationBriefing(
  supabase: any,
  lead: ConversationLeadLike,
): Promise<string> {
  const parts: string[] = [];

  if (lead.summary) {
    parts.push(`Resumo salvo no CRM:\n${String(lead.summary).substring(0, 800)}`);
  }

  if (lead.agent_id && lead.remote_jid) {
    const { data: history, error } = await supabase
      .from('wa_chat_history')
      .select('role, content, created_at')
      .eq('agent_id', lead.agent_id)
      .eq('remote_jid', lead.remote_jid)
      .order('created_at', { ascending: false })
      .limit(12);

    if (!error && history?.length) {
      const transcript = history
        .reverse()
        .map((msg: any) => {
          const author = msg.role === 'user' ? 'Cliente' : 'IA';
          return `${author}: ${String(msg.content || '').substring(0, 300)}`;
        })
        .join('\n');
      parts.push(`Últimas mensagens:\n${transcript}`);
    }
  }

  if (parts.length === 0) {
    return 'Sem resumo salvo ainda. Abrir o WhatsApp do lead para consultar o contexto completo antes de chamar.';
  }

  return parts.join('\n\n').substring(0, 1800);
}

// ─── Versão MARCOS (lead manual sem histórico WhatsApp) ────────────────────

export interface MarcosLeadLike {
  name?: string | null;
  phone?: string | null;
  summary?: string | null;
  origem?: string | null;
  vehicle_interest?: string | null;
  city?: string | null;
  payment_method?: string | null;
  custom_fields?: Record<string, any> | null;
}

/**
 * Briefing para leads do Marcos (CRM manual, sem agente IA, sem wa_chat_history).
 * Usa os campos estruturados de crm_leads + custom_fields.
 *
 * Usado pela FASE 2 (BUG-16) quando manual-transfer é estendido pra aceitar
 * crm_lead_id e atribuir cards do Marcos com briefing igual ao Pedro.
 */
export function buildMarcosBriefing(lead: MarcosLeadLike): string {
  const lines: string[] = [];
  const displayName = lead.name || 'Lead';
  const phone = (lead.phone || '').replace(/\D/g, '');

  lines.push(`🆕 *NOVO LEAD MARCOS — ${displayName}*`);
  if (phone) lines.push(`📱 Telefone: ${phone}`);
  if (lead.city) lines.push(`🏙️ Cidade: ${lead.city}`);
  if (lead.origem) lines.push(`📍 Origem: ${lead.origem}`);
  lines.push('');

  if (lead.vehicle_interest) {
    lines.push(`🚗 *Interesse:* ${lead.vehicle_interest}`);
  }
  if (lead.payment_method) {
    lines.push(`💰 *Forma de pagamento:* ${lead.payment_method}`);
  }

  // Campos custom_fields relevantes (sem expor o objeto inteiro)
  const cf = lead.custom_fields || {};
  if (cf.observacoes) lines.push(`📝 *Observações:* ${String(cf.observacoes).substring(0, 300)}`);
  if (cf.visit_scheduled) lines.push(`📅 *Visita agendada:* ${cf.visit_scheduled}`);

  if (lead.summary) {
    lines.push('');
    lines.push(`📋 *Resumo:* ${String(lead.summary).substring(0, 500)}`);
  }

  lines.push('');
  if (phone) lines.push(`📲 *Atender:* https://wa.me/${phone}`);
  lines.push('');
  lines.push(`_Lead cadastrado no Marcos CRM_`);
  return lines.join('\n');
}

// ─── Helper: formato comum do RELATÓRIO PRO GERENTE ────────────────────────

export interface ManagerReportInput {
  leadName: string;
  leadPhone: string;
  status?: string | null;
  summary?: string | null;
  sellerName: string;
  sellerPhone?: string | null;
  origin?: string | null; // 'manual', 'automatica', 'bulk', 'timeout-escalonado', etc.
  source?: 'pedro' | 'marcos';
}

/**
 * Relatório enviado ao gerente após transferência (manual ou automática).
 * Formato uniforme pra todos os caminhos. Resolve a diferença de formato
 * entre manual-transfer, uazapi-webhook (2 caminhos) e bulk-transfer.
 */
export function buildManagerReport(input: ManagerReportInput): string {
  const phone = (input.leadPhone || '').replace(/\D/g, '');
  const lines: string[] = [];
  const originLabel = input.origin === 'manual' ? '🖱️ Transferência MANUAL'
    : input.origin === 'bulk' ? '📦 Redistribuição em MASSA'
    : input.origin === 'timeout-escalonado' ? '⏰ Escalonamento por TIMEOUT'
    : '🤖 Transferência AUTOMÁTICA';

  lines.push(`📋 *RELATÓRIO DE LEAD* — ${originLabel}`);
  lines.push('');
  lines.push(`👤 *Lead:* ${input.leadName || 'Sem nome'}`);
  if (phone) lines.push(`📱 *Telefone:* wa.me/${phone}`);
  if (input.status) lines.push(`🏷️ *Status:* ${input.status}`);
  if (input.summary) {
    lines.push(`📝 *Resumo:* ${String(input.summary).substring(0, 300)}`);
  }
  lines.push('');
  lines.push(`🧑‍💼 *Vendedor atribuído:* ${input.sellerName || 'N/D'}`);
  if (input.sellerPhone) lines.push(`📞 *WhatsApp do vendedor:* ${input.sellerPhone}`);
  if (input.source === 'marcos') {
    lines.push('');
    lines.push(`_Origem: CRM Marcos (manual)_`);
  }
  return lines.join('\n');
}
