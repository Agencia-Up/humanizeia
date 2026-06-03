// Status PADRONIZADO do lead na transferencia para o vendedor/gerente.
//
// PROBLEMA que resolve: hoje o "status real" do lead (qualificado / ausente /
// retornou / etc.) so aparecia IMPLICITO no titulo da mensagem ("NOVO LEAD
// QUALIFICADO" vs "NOVO LEAD PARA ATENDIMENTO (Sem resposta)") e divergia entre
// o caminho do orquestrador (ao vivo) e o do cron (inatividade). O vendedor
// nunca recebia um campo claro do status. Aqui centralizamos uma taxonomia
// unica, usada nos DOIS caminhos, como uma linha "🏷️ Status: <emoji> <label>".
//
// (Termina a padronizacao iniciada pelo Wander em _shared/transfer/buildBriefing.ts,
//  estendendo-a ao Pedro v2 e ao cron.)

export type LeadTransferStatusKey =
  | "qualificado"
  | "pediu_atendente"
  | "retornou"
  | "followup"
  | "desqualificado"
  | "sem_resposta"
  | "repassado";

const STATUS_MAP: Record<LeadTransferStatusKey, { emoji: string; label: string }> = {
  qualificado:     { emoji: "🟢", label: "QUALIFICADO" },
  pediu_atendente: { emoji: "🔴", label: "PEDIU ATENDENTE" },
  retornou:        { emoji: "🟡", label: "RETORNOU" },
  followup:        { emoji: "⚪", label: "EM FOLLOW-UP (ainda nao avancou)" },
  desqualificado:  { emoji: "🔴", label: "DESQUALIFICADO" },
  sem_resposta:    { emoji: "🔵", label: "SEM RESPOSTA (ausente)" },
  repassado:       { emoji: "🟠", label: "REPASSADO (vendedor anterior nao assumiu)" },
};

export function leadTransferStatus(key: LeadTransferStatusKey): { emoji: string; label: string } {
  return STATUS_MAP[key] || STATUS_MAP.qualificado;
}

// Linha pronta para colar na notificacao (WhatsApp). Ex.: "🏷️ *Status:* 🟢 QUALIFICADO"
export function leadTransferStatusLine(key: LeadTransferStatusKey): string {
  const s = leadTransferStatus(key);
  return `🏷️ *Status:* ${s.emoji} ${s.label}`;
}

// Versao curta (emoji + label) para o relatorio do gerente.
export function leadTransferStatusText(key: LeadTransferStatusKey): string {
  const s = leadTransferStatus(key);
  return `${s.emoji} ${s.label}`;
}
