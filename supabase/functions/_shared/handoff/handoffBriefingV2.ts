// =============================================================================
// HANDOFF BRIEFING V2 — IT-2.4 (qualificação do Pedro SDR)
// =============================================================================
//
// Briefing enriquecido pro vendedor humano quando o Pedro chama a tool
// `transferir_para_vendedor`. Adiciona ao briefing legacy:
//   - Score numérico + tier (IT-2.2)
//   - Próxima ação sugerida (IT-2.1 BANT)
//   - Categoria do motivo (enum estruturado)
//   - Urgência (enum estruturado)
//
// COMPAT: o briefing V1 (`buildBriefingForSeller`) continua existindo no
// webhook. V2 é APENAS chamado quando flag `PEDRO_FF_HANDOFF_TOOL_V2`
// está ligada. V1 e V2 produzem strings markdown válidas pra envio via
// WhatsApp (sem JSON cru).
//
// SCHEMA DA TOOL (já reflete V2 — campos novos são OPCIONAIS):
//   {
//     motivo: string (REQUIRED),                       // legacy
//     resumo_breve: string?,                            // legacy
//     motivo_categoria: HandoffMotivoCategoria?,        // V2
//     urgencia: HandoffUrgencia?,                       // V2
//     proxima_acao_sugerida: string?                    // V2
//   }
//
// USO (fonte canônica testável):
//   ```ts
//   import { buildEnrichedBriefing } from './handoffBriefingV2';
//   const briefing = buildEnrichedBriefing({
//     state, leadName, leadPhone, agentName,
//     transferArgs, scoreInfo, bantSuggestion
//   });
//   ```
//
// IMPORTANTE: fonte canônica + testes vitest. O webhook
// `uazapi-webhook/index.ts` tem cópia INLINE — qualquer mudança aqui
// precisa ser refletida lá.
// =============================================================================

export type HandoffMotivoCategoria =
  | "lead_qualificado"      // BNA completo, pronto pra fechar
  | "pediu_humano"          // cliente solicitou explicitamente
  | "objecao_complexa"      // objeção que requer negociação humana
  | "negociacao_preco"      // pediu desconto/condição especial
  | "fora_escopo"           // assunto não-veicular ou suporte
  | "erro_agente";          // agente percebeu que travou

export type HandoffUrgencia = "baixa" | "media" | "alta" | "imediata";

export type HandoffTransferArgs = {
  motivo: string;
  resumo_breve?: string;
  motivo_categoria?: HandoffMotivoCategoria;
  urgencia?: HandoffUrgencia;
  proxima_acao_sugerida?: string;
};

export type HandoffScoreInfo = {
  score: number;
  tier: string;
};

export type BuildEnrichedBriefingInput = {
  state: any;
  leadName: string;
  leadPhone: string;
  agentName: string;
  transferArgs: HandoffTransferArgs;
  scoreInfo?: HandoffScoreInfo;
  bantNextSuggestedAsk?: string;
};

const URGENCIA_EMOJI: Record<HandoffUrgencia, string> = {
  imediata: "🔴",
  alta: "🟠",
  media: "🟡",
  baixa: "🟢",
};

const CATEGORIA_LABEL: Record<HandoffMotivoCategoria, string> = {
  lead_qualificado: "Lead qualificado (BNA completo)",
  pediu_humano: "Cliente pediu humano",
  objecao_complexa: "Objeção complexa",
  negociacao_preco: "Negociação de preço",
  fora_escopo: "Fora do escopo do agente",
  erro_agente: "Agente travado / erro",
};

/**
 * Constrói briefing V2 enriquecido com motivo categórico, urgência e score.
 * Sempre retorna string markdown pronta pra WhatsApp.
 */
export function buildEnrichedBriefing(input: BuildEnrichedBriefingInput): string {
  const { state, leadName, leadPhone, agentName, transferArgs, scoreInfo, bantNextSuggestedAsk } = input;
  const s = state || {};
  const lines: string[] = [];

  // ─── Header com urgência ──
  const urgencia = transferArgs.urgencia ?? "media";
  const emoji = URGENCIA_EMOJI[urgencia] || "🟡";
  const displayName =
    s.lead?.nome_completo || s.lead?.nome || leadName || "Lead";
  lines.push(`${emoji} *LEAD QUALIFICADO — ${displayName}* (urgência: ${urgencia})`);
  lines.push(`📱 Telefone: ${s.lead?.telefone || leadPhone}`);
  if (s.lead?.cidade) lines.push(`🏙️ Cidade: ${s.lead.cidade}`);

  // ─── Score + tier (IT-2.2) ──
  if (scoreInfo) {
    lines.push(`📊 Score: ${scoreInfo.score}/100 (${scoreInfo.tier})`);
  }
  lines.push("");

  // ─── Motivo estruturado ──
  if (transferArgs.motivo_categoria) {
    const catLabel =
      CATEGORIA_LABEL[transferArgs.motivo_categoria] || transferArgs.motivo_categoria;
    lines.push(`🎯 *Motivo:* ${catLabel}`);
  }
  if (transferArgs.motivo) {
    lines.push(`💬 *Detalhe:* ${transferArgs.motivo}`);
  }
  if (transferArgs.resumo_breve && transferArgs.resumo_breve !== transferArgs.motivo) {
    lines.push(`📝 *Resumo:* ${transferArgs.resumo_breve}`);
  }
  lines.push("");

  // ─── Interesse + veículo apresentado ──
  if (s.interesse?.modelo_desejado) {
    const conf = [s.interesse.configuracao, s.interesse.combustivel, s.interesse.cambio].filter(Boolean).join(", ");
    lines.push(`🚗 *Interesse:* ${s.interesse.modelo_desejado}${conf ? ` (${conf})` : ""}`);
  }
  if (s.veiculo_apresentado?.ja_apresentado) {
    const vp = s.veiculo_apresentado;
    lines.push(`📋 *Veículo apresentado:* ${vp.modelo || ""} ${vp.ano || ""}${vp.preco ? ` — R$ ${vp.preco}` : ""}`);
  }

  // ─── Negociação ──
  if (s.negociacao?.forma_pagamento) lines.push(`💰 *Forma de pagamento:* ${s.negociacao.forma_pagamento}`);
  if (s.negociacao?.valor_entrada) lines.push(`💵 *Entrada:* ${s.negociacao.valor_entrada}`);
  if (s.negociacao?.tem_troca && s.negociacao?.carro_troca) {
    const ct = s.negociacao.carro_troca;
    const trocaParts = [ct.modelo, ct.ano, ct.configuracao, ct.cambio].filter(Boolean).join(" ");
    lines.push(`🔄 *Troca:* ${trocaParts || "sim"}${ct.status ? ` (${ct.status})` : ""}`);
  }

  // ─── Atendimento ──
  if (s.atendimento?.pode_visitar_loja === false) {
    lines.push(`📍 *Visita:* NÃO pode visitar — atendimento REMOTO`);
  }
  if (s.atendimento?.objecoes && s.atendimento.objecoes.length > 0) {
    lines.push(`⚠️ *Objeções:* ${s.atendimento.objecoes.join(", ")}`);
  }
  if (s.lead?.acompanhante_decisao) {
    lines.push(`👥 *Decisão envolve:* ${s.lead.acompanhante_decisao}`);
  }

  // ─── Próxima ação sugerida (NOVO V2) ──
  if (transferArgs.proxima_acao_sugerida || bantNextSuggestedAsk) {
    lines.push("");
    lines.push(`👉 *Próxima ação sugerida:* ${transferArgs.proxima_acao_sugerida || bantNextSuggestedAsk}`);
  }

  // ─── Atalho ──
  lines.push("");
  lines.push(`📲 *Atender:* https://wa.me/${(s.lead?.telefone || leadPhone || "").replace(/\D/g, "")}`);
  lines.push("");
  lines.push(`_Briefing V2 gerado pelo Pedro SDR (${agentName})_`);

  return lines.join("\n");
}
