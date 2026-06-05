// ============================================================================
// Regras de Segurança — tipos e defaults (FASE 2)
// ----------------------------------------------------------------------------
// Perfis de limites criados pela conta MASTER que travam as ações dos
// vendedores/colaboradores (disparo, follow-up, individuais, automação) para
// proteger os números de WhatsApp de banimento. Fonte única dos limites.
// ============================================================================

export type AssignmentTargetType = 'all' | 'seller' | 'collaborator';
export type SecurityActionType =
  | 'bulk_send'
  | 'manual_followup'
  | 'individual_message'
  | 'automation';

export interface SecurityRuleProfile {
  id: string;
  master_account_id: string;
  name: string;
  is_active: boolean;
  // Disparo em massa
  bulk_send_enabled: boolean;
  bulk_send_daily_limit: number;
  bulk_send_min_interval_sec: number;
  bulk_send_max_batch: number;
  // Follow-up manual
  manual_followup_enabled: boolean;
  manual_followup_daily_limit: number;
  manual_followup_min_interval_min: number;
  // Mensagens individuais
  individual_msg_daily_limit: number;
  individual_msg_min_interval_sec: number;
  // Horários permitidos
  allowed_send_start_time: string; // 'HH:MM:SS'
  allowed_send_end_time: string; // 'HH:MM:SS'
  block_weekends: boolean;
  // Automação
  automation_enabled: boolean;
  automation_daily_limit: number;
  // Anti-spam
  antispam_max_identical_per_hour: number;
  antispam_block_on_limit: boolean;
  created_at: string;
  updated_at: string;
}

/** Campos editáveis de um perfil (sem id/owner/timestamps). */
export type SecurityRuleProfileInput = Omit<
  SecurityRuleProfile,
  'id' | 'master_account_id' | 'created_at' | 'updated_at'
>;

export interface SecurityRuleAssignment {
  id: string;
  profile_id: string;
  master_account_id: string;
  target_type: AssignmentTargetType;
  target_member_id: string | null;
  created_at: string;
}

export interface SecurityRuleViolation {
  id: string;
  master_account_id: string;
  user_id: string;
  action_type: SecurityActionType;
  rule_violated: string;
  limit_value: number | null;
  current_value: number | null;
  attempted_at: string;
}

/** Resultado do enforcement (FASE 4) — check antes de enviar. */
export interface SecurityRuleCheckResult {
  allowed: boolean;
  reason?: string;
  limit?: number;
  current?: number;
}

// ── Faixas (min/max) dos campos numéricos — usadas nos sliders e na validação ─
export const RULE_RANGES: Record<string, { min: number; max: number; step?: number }> = {
  bulk_send_daily_limit: { min: 1, max: 200 },
  bulk_send_min_interval_sec: { min: 1, max: 60 },
  bulk_send_max_batch: { min: 10, max: 500, step: 5 },
  manual_followup_daily_limit: { min: 1, max: 100 },
  manual_followup_min_interval_min: { min: 30, max: 1440, step: 5 },
  individual_msg_daily_limit: { min: 50, max: 1000, step: 10 },
  individual_msg_min_interval_sec: { min: 1, max: 30 },
  automation_daily_limit: { min: 50, max: 500, step: 5 },
  antispam_max_identical_per_hour: { min: 1, max: 20 },
};

export const DEFAULT_SECURITY_RULE_PROFILE: SecurityRuleProfileInput = {
  name: 'Novo perfil de regras',
  is_active: true,
  bulk_send_enabled: true,
  bulk_send_daily_limit: 30,
  bulk_send_min_interval_sec: 10,
  bulk_send_max_batch: 100,
  manual_followup_enabled: true,
  manual_followup_daily_limit: 20,
  manual_followup_min_interval_min: 60,
  individual_msg_daily_limit: 200,
  individual_msg_min_interval_sec: 3,
  allowed_send_start_time: '08:00:00',
  allowed_send_end_time: '20:00:00',
  block_weekends: false,
  automation_enabled: true,
  automation_daily_limit: 150,
  antispam_max_identical_per_hour: 5,
  antispam_block_on_limit: true,
};

/** Resumo compacto pro card do perfil. Ex.: "30 disparos/dia · Follow-up: 20/dia · 08h–20h". */
export function summarizeProfile(p: SecurityRuleProfile): string {
  const parts: string[] = [];
  if (p.bulk_send_enabled) parts.push(`${p.bulk_send_daily_limit} disparos/dia`);
  if (p.manual_followup_enabled) parts.push(`Follow-up: ${p.manual_followup_daily_limit}/dia`);
  const hh = (t: string) => (t || '').slice(0, 5).replace(':', 'h');
  parts.push(`${hh(p.allowed_send_start_time)}–${hh(p.allowed_send_end_time)}`);
  if (p.block_weekends) parts.push('sem fins de semana');
  return parts.join(' · ');
}
