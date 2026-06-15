/**
 * aiKeys.ts — BYOK ("traga sua chave de IA")
 *
 * resolveAiKey(supabase, userId, provider) devolve a chave de IA do CLIENTE
 * (cifrada no Vault, lida via RPC get_client_ai_key com service_role) e, se ele
 * nao tiver configurado, cai pra chave da PLATAFORMA (env). Assim os agentes
 * passam a gastar na conta do cliente quando ele tem chave propria, sem quebrar
 * quem nao tem.
 *
 * USO (Fase 1, dentro de um agente):
 *   const { key, source } = await resolveAiKey(supabase, userId, 'openai');
 *   // ... usa `key` no Authorization. `source` = 'client' | 'platform' (log/billing)
 *
 * Requer um client supabase com SERVICE ROLE (a RPC get_client_ai_key so e
 * liberada pra service_role). NUNCA chamar isto do frontend.
 */

export type AiProvider = 'openai' | 'anthropic' | 'deepseek';
export interface ResolvedAiKey {
  key: string;
  // 'client'  = chave propria do cliente (Vault)
  // 'platform'= nossa chave (so contas GRANDFATHERED, criadas ate o corte)
  // 'none'    = conta nova SEM chave propria -> NAO pode usar a nossa
  source: 'client' | 'platform' | 'none';
}

// Corte do BYOK: contas criadas ATE este instante usam a nossa chave (grandfathered).
// Contas NOVAS (criadas depois) PRECISAM da propria chave — em hipotese nenhuma usam a nossa.
// Decisao do dono (2026-06-15): nao quebrar nenhuma conta atual; so contas novas pagam a propria IA.
export const BYOK_GRANDFATHER_CUTOFF = Date.parse('2026-06-16T03:00:00Z'); // ~00:00 BRT de 16/06

function platformKey(provider: AiProvider): string {
  if (provider === 'openai') return Deno.env.get('OPENAI_API_KEY') || '';
  if (provider === 'anthropic') {
    return Deno.env.get('ANTHROPIC_API_KEY') || Deno.env.get('CLAUDE_API_KEY') || '';
  }
  return Deno.env.get('DEEPSEEK_API_KEY') || '';
}

// Conta GRANDFATHERED? (criada ate o corte -> pode usar a nossa chave). Best-effort: em erro,
// assume grandfathered (fail-open) pra NUNCA derrubar uma conta ATUAL por falha de leitura.
// Cache em memoria por user_id (created_at nao muda) pra nao consultar a cada turno.
const grandfatherCache = new Map<string, boolean>();
export async function isAccountGrandfathered(supabase: any, userId: string | null | undefined): Promise<boolean> {
  if (!userId) return false;
  if (grandfatherCache.has(userId)) return grandfatherCache.get(userId)!;
  let grandfathered = true; // fail-open
  try {
    const { data } = await supabase.from('profiles').select('created_at').eq('id', userId).maybeSingle();
    const createdMs = data?.created_at ? Date.parse(data.created_at) : NaN;
    if (Number.isFinite(createdMs)) grandfathered = createdMs <= BYOK_GRANDFATHER_CUTOFF;
  } catch (_e) { /* fail-open: mantem true */ }
  grandfatherCache.set(userId, grandfathered);
  return grandfathered;
}

export async function resolveAiKey(
  supabase: any,
  userId: string | null | undefined,
  provider: AiProvider,
  opts?: { allowPlatformFallback?: boolean },
): Promise<ResolvedAiKey> {
  // 1. Tenta a chave do cliente (Vault via RPC). Best-effort: qualquer erro cai pro fallback.
  if (userId) {
    try {
      const { data, error } = await supabase.rpc('get_client_ai_key', {
        p_user_id: userId,
        p_provider: provider,
      });
      if (!error && typeof data === 'string' && data.trim().length > 0) {
        return { key: data.trim(), source: 'client' };
      }
    } catch (_e) {
      // ignora — tenta o fallback abaixo
    }
  }
  // 2. Sem chave do cliente: a NOSSA chave so vale pra contas grandfathered.
  const allow = opts?.allowPlatformFallback ?? await isAccountGrandfathered(supabase, userId);
  if (allow) return { key: platformKey(provider), source: 'platform' };
  // 3. Conta nova sem chave propria: NAO usa a nossa.
  return { key: '', source: 'none' };
}

// Contexto BYOK passado aos cerebros (reply/planner) e helpers (visao/audio). Resolve a chave
// do provedor escolhido na hora. `openai_key` ja vem resolvida do gate (evita RPC repetida).
export interface AiKeyCtx {
  supabase: any;
  user_id: string | null;
  allow_platform: boolean;
  openai_key?: string;
}
export async function keyFromCtx(ctx: AiKeyCtx | null | undefined, provider: AiProvider): Promise<string> {
  if (ctx) {
    if (provider === 'openai' && typeof ctx.openai_key === 'string') return ctx.openai_key;
    const r = await resolveAiKey(ctx.supabase, ctx.user_id, provider, { allowPlatformFallback: ctx.allow_platform });
    return r.key;
  }
  // Sem ctx (chamada legada/sem BYOK): chave da plataforma (compat).
  return platformKey(provider);
}
