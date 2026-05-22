// =============================================================================
// FEATURE FLAGS — Agente Pedro SDR (LOGOS|IA)
// =============================================================================
//
// Sistema central de feature flags pra evolução incremental do agente
// (Plano de Implementação — Fases 1 a 4, IT-1.1 → IT-4.3).
//
// PRINCÍPIO:
//   - Cada melhoria comportamental (humanização, qualificação, memória, etc.)
//     entra ATRÁS de uma flag. Deploy → testar com flag ON num lead/ambiente
//     controlado → liberar em prod só quando aprovado.
//
// COMO LIGAR/DESLIGAR EM PROD:
//   - Via env var do projeto Supabase (Dashboard → Settings → Edge Functions
//     → Secrets) usando o prefixo `PEDRO_FF_`.
//   - Exemplo: `PEDRO_FF_MESSAGE_SPLITTING=true` liga IT-1.1.
//   - Valores aceitos como "ligado": `true`, `1`, `yes`, `on`, `enabled`
//     (case-insensitive). Qualquer outro valor (incluindo ausência da var) =
//     desligado.
//
// PADRÃO DE USO NUMA EDGE FUNCTION:
//   ```ts
//   import { isFeatureEnabled } from '../_shared/config/features.ts';
//
//   if (isFeatureEnabled('MESSAGE_SPLITTING')) {
//     // novo comportamento
//   } else {
//     // comportamento legado (preservar sempre)
//   }
//   ```
//
// REGRA DE OURO:
//   - Default SEMPRE `false` (fail-safe). Flag desativada = comportamento
//     atual do agente, idêntico ao que está em produção hoje.
//   - Removeer flag só DEPOIS de >= 2 semanas estável com 100% rollout.
// =============================================================================

export type FeatureFlag =
  // ─── Fase 1 — Humanização ────────────────────────────────────────────────
  /** IT-1.1 — Split de respostas longas em múltiplas mensagens curtas. */
  | 'MESSAGE_SPLITTING'
  /** IT-1.2 — Delay realista + indicador "digitando…" antes de enviar. */
  | 'TYPING_SIMULATION'
  /** IT-1.3 — Persona consolidada + few-shots inline no system prompt. */
  | 'PERSONA_FEW_SHOTS'

  // ─── Fase 2 — Qualificação ───────────────────────────────────────────────
  /** IT-2.1 — Schema BANT (Budget/Authority/Need/Timeline) no state. */
  | 'BANT_QUALIFICATION'
  /** IT-2.2 — Lead scoring numérico (0–100) com critérios explícitos. */
  | 'LEAD_SCORING'
  /** IT-2.3 — Fallback BNDV: oferecer similares quando 0 resultados. */
  | 'BNDV_SIMILAR_VEHICLES'
  /** IT-2.4 — Tool `transferir_para_vendedor` reformulada com motivo+score. */
  | 'HANDOFF_TOOL_V2'

  // ─── Fase 3 — Memória ────────────────────────────────────────────────────
  /** IT-3.1 — Perfil persistente cross-conversa (cliente já conhecido). */
  | 'PERSISTENT_PROFILES'
  /** IT-3.2 — Sumarização hierárquica de histórico longo (>10 turnos). */
  | 'HIERARCHICAL_SUMMARIZATION'
  /** IT-3.3 — Playbooks de tratamento de objeções recorrentes. */
  | 'OBJECTION_PLAYBOOKS'

  // ─── Fase 4 — Confiabilidade ─────────────────────────────────────────────
  /** IT-4.1 — Retry + fallback de modelo na chamada LLM principal. */
  | 'LLM_RETRY_FALLBACK'
  /** IT-4.2 — Guardrails de saída (filtro de promessa indevida etc.). */
  | 'GUARDRAILS'
  /** IT-4.3 — Logs estruturados em JSON com trace_id por turno. */
  | 'STRUCTURED_LOGGING';

const ENV_PREFIX = 'PEDRO_FF_';
const TRUE_VALUES = new Set(['true', '1', 'yes', 'on', 'enabled']);

/**
 * Verifica se uma feature flag está ligada via env var.
 * Sempre retorna `false` em caso de erro (fail-safe).
 */
export function isFeatureEnabled(flag: FeatureFlag): boolean {
  try {
    // @ts-ignore — Deno global presente em edge functions
    const raw = typeof Deno !== 'undefined' ? Deno.env.get(`${ENV_PREFIX}${flag}`) : undefined;
    if (!raw) return false;
    return TRUE_VALUES.has(String(raw).trim().toLowerCase());
  } catch {
    return false;
  }
}

/**
 * Lista o estado atual de TODAS as flags. Útil pra log de boot e debug.
 */
export function listFeatureFlags(): Record<FeatureFlag, boolean> {
  const flags: FeatureFlag[] = [
    'MESSAGE_SPLITTING',
    'TYPING_SIMULATION',
    'PERSONA_FEW_SHOTS',
    'BANT_QUALIFICATION',
    'LEAD_SCORING',
    'BNDV_SIMILAR_VEHICLES',
    'HANDOFF_TOOL_V2',
    'PERSISTENT_PROFILES',
    'HIERARCHICAL_SUMMARIZATION',
    'OBJECTION_PLAYBOOKS',
    'LLM_RETRY_FALLBACK',
    'GUARDRAILS',
    'STRUCTURED_LOGGING',
  ];
  return Object.fromEntries(
    flags.map((f) => [f, isFeatureEnabled(f)])
  ) as Record<FeatureFlag, boolean>;
}

/**
 * Retorna apenas as flags atualmente LIGADAS — útil pra log compacto.
 */
export function getEnabledFlags(): FeatureFlag[] {
  const all = listFeatureFlags();
  return (Object.keys(all) as FeatureFlag[]).filter((k) => all[k]);
}
