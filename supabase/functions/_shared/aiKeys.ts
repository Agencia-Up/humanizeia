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
  source: 'client' | 'platform';
}

function platformKey(provider: AiProvider): string {
  if (provider === 'openai') return Deno.env.get('OPENAI_API_KEY') || '';
  if (provider === 'anthropic') {
    return Deno.env.get('ANTHROPIC_API_KEY') || Deno.env.get('CLAUDE_API_KEY') || '';
  }
  return Deno.env.get('DEEPSEEK_API_KEY') || '';
}

export async function resolveAiKey(
  supabase: any,
  userId: string | null | undefined,
  provider: AiProvider,
): Promise<ResolvedAiKey> {
  // 1. Tenta a chave do cliente (Vault via RPC). Best-effort: qualquer erro cai pra plataforma.
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
      // ignora — usa a chave da plataforma
    }
  }
  // 2. Fallback: chave da plataforma (nossa).
  return { key: platformKey(provider), source: 'platform' };
}
