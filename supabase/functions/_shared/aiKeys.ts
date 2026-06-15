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

// Falha de provedor de IA capturada no turno (credito esgotado / chave invalida / etc).
export type ProviderErrorKind = 'quota' | 'auth' | 'rate' | 'other';
export interface ProviderError {
  provider: string;
  stage: string; // 'reply' | 'planner' | 'vision' | ...
  status: number;
  code: string;
  kind: ProviderErrorKind;
}

// Contexto BYOK passado aos cerebros (reply/planner) e helpers (visao/audio). Resolve a chave
// do provedor escolhido na hora. `openai_key` ja vem resolvida do gate (evita RPC repetida).
// `provider_errors` e um acumulador MUTAVEL do turno: reply/planner empurram falhas (429/401/...)
// e o orchestrator decide se alerta o dono. `source` diz de quem e a chave (client vs platform).
export interface AiKeyCtx {
  supabase: any;
  user_id: string | null;
  allow_platform: boolean;
  openai_key?: string;
  source?: ResolvedAiKey['source'];
  provider_errors?: ProviderError[];
}

// Classifica o erro HTTP de um provedor de IA. O que importa pro alerta: 'quota' (sem credito,
// ACAO = recarregar) e 'auth' (chave invalida, ACAO = corrigir a chave). 'rate'/'other' = transitorio.
export function classifyProviderHttpError(status: number, bodyText: string): { code: string; kind: ProviderErrorKind } {
  let code = '';
  try {
    const j = JSON.parse(bodyText);
    code = String(j?.error?.code || j?.error?.type || j?.type || '');
  } catch (_e) { /* corpo nao-JSON */ }
  const c = code.toLowerCase();
  const body = String(bodyText || '').toLowerCase();
  if (status === 401 || status === 403 || c.includes('invalid_api_key') || c.includes('authentication') || body.includes('invalid api key')) {
    return { code: code || `http_${status}`, kind: 'auth' };
  }
  if (c.includes('insufficient_quota') || c.includes('billing') || body.includes('insufficient_quota') || body.includes('exceeded your current quota') || body.includes('credit balance is too low')) {
    return { code: code || 'insufficient_quota', kind: 'quota' };
  }
  if (status === 429) return { code: code || 'rate_limit', kind: 'rate' };
  return { code: code || `http_${status}`, kind: 'other' };
}

// Best-effort: le o corpo do erro e registra no ctx. NUNCA lanca (caminho de falha ja degradado).
export async function recordProviderError(ctx: AiKeyCtx | null | undefined, provider: string, stage: string, res: Response): Promise<void> {
  if (!ctx) return;
  let bodyText = '';
  try { bodyText = await res.text(); } catch (_e) { /* ignora */ }
  const { code, kind } = classifyProviderHttpError(res.status, bodyText);
  (ctx.provider_errors ||= []).push({ provider, stage, status: res.status, code, kind });
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
