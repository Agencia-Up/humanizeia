// ════════════════════════════════════════════════════════════════════════════
// resolveEffectiveTenant — tenant efetivo do José (dono = ele mesmo; parceiro = master)
// ----------------------------------------------------------------------------
// O subsistema do José escopa tudo por user_id. O dono é o próprio user; o
// parceiro/vendedor é um `seller` com OUTRO user_id, vinculado à master via
// ai_team_members. Sem resolver, o parceiro vê/opera vazio (sem conta de anúncio,
// que mora na master p/ o tracking/CAPI). Este helper devolve o user_id EFETIVO:
//   - dono (role != 'seller')  -> o próprio callerId  (ZERO regressão)
//   - vendedor/parceiro        -> a MASTER (ai_team_members.user_id; fallback profiles.manager_id)
//
// Espelha o `masterUserId` do useSellerProfile no back. Recebe um client
// service-role (`admin`) porque precisa ler ai_team_members sem esbarrar no RLS.
// Falha FECHADO no comportamento antigo (retorna o próprio callerId) em qualquer erro.
export async function resolveEffectiveTenant(admin: any, callerId: string): Promise<string> {
  if (!callerId) return callerId;
  try {
    const { data: prof } = await admin
      .from("profiles")
      .select("role, manager_id")
      .eq("id", callerId)
      .maybeSingle();

    if (prof?.role !== "seller") return callerId; // dono/gerente: própria conta

    const { data: mem } = await admin
      .from("ai_team_members")
      .select("user_id")
      .eq("auth_user_id", callerId)
      .neq("active_in_system", false)
      .order("is_active", { ascending: false })
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    return (mem?.user_id as string) || (prof?.manager_id as string) || callerId;
  } catch (_e) {
    return callerId; // falha fechado: comportamento antigo (própria conta)
  }
}
