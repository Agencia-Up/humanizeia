import { supabase } from '@/integrations/supabase/client';

/**
 * Invoca uma edge function e, se tomar 401 (o token da SESSÃO do usuário ficou velho —
 * aba parada faz o auto-refresh do Supabase pausar, e no clique vai um token expirado/anon
 * → a função responde "Token invalido"/"Unauthorized"), REVALIDA a sessão e tenta 1x mais.
 *
 * Aditivo e seguro: só age quando a chamada JÁ ia falhar com 401. Quando o token está ok,
 * o comportamento é idêntico a chamar supabase.functions.invoke direto.
 */
export async function invokeWithReauth<T = any>(
  name: string,
  options?: { body?: any; headers?: Record<string, string> },
): Promise<{ data: T | null; error: any }> {
  let res = await supabase.functions.invoke(name, options as any);
  if (res.error && (res.error as any)?.context?.status === 401) {
    await supabase.auth.refreshSession().catch(() => { /* sem refresh token: cai no erro original */ });
    res = await supabase.functions.invoke(name, options as any);
  }
  return res as { data: T | null; error: any };
}
