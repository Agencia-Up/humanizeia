/**
 * authz.ts — José / Fase 1 (contrato de autorização)
 *
 * Separa três coisas que hoje estão fundidas no apollo-agent:
 *
 *   IDENTIDADE  quem chama  -> SEMPRE do JWT verificado (auth.getUser), nunca do body
 *   ESCOPO      de quem são os dados -> tenant efetivo (parceiro/vendedor lê a master)
 *   PODER       o que pode fazer -> ver / recomendar / MUTAR na Meta
 *
 * O bug estrutural corrigido aqui: `resolveEffectiveTenant` promove o vendedor
 * ao tenant da master para que ele ENXERGUE a conta de anúncios — e o código
 * antigo usava esse mesmo tenant para EXECUTAR ações. Ver != poder gastar.
 *
 * CONTRATO (definido pelo dono):
 *   - ver dashboard/análises .... owner/master e responsáveis autorizados
 *   - recomendar ações .......... quem tem acesso ao José
 *   - EXECUTAR na Meta .......... só owner/master OU responsável com permissão
 *                                 EXPLÍCITA (jose_permissions.nivel='executar')
 *   - vendedor comum ............ NUNCA executa
 *   - dúvida/ausência ........... nega a EXECUÇÃO (mas não a leitura)
 *
 * POR QUE A LEITURA NÃO FALHA FECHADA: `jose_permissions` está vazia em produção.
 * Exigir linha para ler quebraria todos os clientes legítimos hoje. Então só a
 * MUTAÇÃO exige prova positiva; consulta e recomendação seguem como antes.
 */

import { resolveEffectiveTenant } from "../resolveTenant.ts";

export interface JoseAccess {
  authUserId: string;      // identidade verificada (dono do JWT)
  tenantId: string;        // escopo de dados (master, se for parceiro/vendedor)
  isOwner: boolean;        // chamador É o tenant (dono/master)
  isSeller: boolean;
  isManager: boolean;
  canView: boolean;
  canRecommend: boolean;
  canMutate: boolean;      // pode disparar ação que gasta dinheiro na Meta
  motivo: string;          // por que canMutate ficou assim (vai para auditoria)
}

export type AuthnResult =
  | { ok: true; access: JoseAccess }
  | { ok: false; status: number; error: string };

/**
 * Verifica o JWT CRIPTOGRAFICAMENTE (getUser valida assinatura no servidor de
 * auth) e monta o contrato de acesso. Não lê nada do corpo da requisição.
 */
export async function authenticateJoseCaller(
  req: Request,
  admin: any,
  createClientFn: (url: string, key: string, opts?: any) => any,
): Promise<AuthnResult> {
  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    return { ok: false, status: 401, error: "authorization_ausente" };
  }
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return { ok: false, status: 401, error: "token_vazio" };

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const asUser = createClientFn(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: userData, error: userErr } = await asUser.auth.getUser();
  const authUserId = userData?.user?.id;
  if (userErr || !authUserId) {
    return { ok: false, status: 401, error: "token_invalido_ou_expirado" };
  }

  return { ok: true, access: await buildAccess(admin, authUserId) };
}

/** Monta o contrato de poder a partir da identidade JÁ verificada. */
export async function buildAccess(admin: any, authUserId: string): Promise<JoseAccess> {
  const base: JoseAccess = {
    authUserId,
    tenantId: authUserId,
    isOwner: true,
    isSeller: false,
    isManager: false,
    canView: true,
    canRecommend: true,
    canMutate: false,
    motivo: "nao_avaliado",
  };

  try {
    const { data: prof } = await admin
      .from("profiles")
      .select("role, is_superadmin")
      .eq("id", authUserId)
      .maybeSingle();

    const isSeller = prof?.role === "seller";
    const tenantId = await resolveEffectiveTenant(admin, authUserId);
    const isOwner = !isSeller && tenantId === authUserId;

    if (!isSeller) {
      // dono/master: pode tudo no PRÓPRIO tenant (guardrails ainda se aplicam
      // depois — kill-switch, caps, aprovação).
      return {
        ...base,
        tenantId,
        isOwner,
        isSeller: false,
        isManager: true,
        canMutate: true,
        motivo: prof?.is_superadmin ? "superadmin" : "owner_master",
      };
    }

    // ── vendedor/parceiro ──────────────────────────────────────────────────
    const { data: membro } = await admin
      .from("ai_team_members")
      .select("is_manager, visible_features, removed_at, active_in_system")
      .eq("auth_user_id", authUserId)
      .eq("user_id", tenantId)
      .is("removed_at", null)
      .neq("active_in_system", false)
      .order("is_manager", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!membro) {
      // Vendedor sem vínculo ativo com o tenant: nem lê.
      return {
        ...base,
        tenantId,
        isOwner: false,
        isSeller: true,
        canView: false,
        canRecommend: false,
        canMutate: false,
        motivo: "vendedor_sem_vinculo_ativo",
      };
    }

    const vf = (membro.visible_features || {}) as Record<string, unknown>;
    // Ausência da chave = liberado (padrão histórico); só bloqueia se explícito.
    const temJose = vf.agent_jose !== false;

    return {
      ...base,
      tenantId,
      isOwner: false,
      isSeller: true,
      isManager: membro.is_manager === true,
      canView: temJose,
      canRecommend: temJose,
      // MUTAÇÃO exige prova positiva, avaliada por ação em canMutateAction().
      canMutate: false,
      motivo: temJose ? "vendedor_precisa_permissao_explicita" : "vendedor_sem_agent_jose",
    };
  } catch (e) {
    // Fail-closed no poder, fail-open na leitura: erro de infraestrutura não
    // pode liberar gasto, mas também não pode derrubar o painel de todo mundo.
    return { ...base, canMutate: false, motivo: `erro_avaliando_permissao:${String((e as any)?.message || e)}` };
  }
}

/**
 * Pode EXECUTAR esta ação específica na Meta?
 * Owner/master: sim. Vendedor: só com jose_permissions.nivel='executar' para o
 * tipo de ação (linha da conta específica vence a linha geral). Qualquer erro
 * ou ausência => NÃO.
 */
export async function canMutateAction(
  admin: any,
  access: JoseAccess,
  tipoAcao: string,
  adAccountDbId?: string | null,
): Promise<{ permitido: boolean; motivo: string }> {
  if (!access.canView) return { permitido: false, motivo: "sem_acesso_ao_jose" };
  if (access.canMutate) return { permitido: true, motivo: access.motivo };

  try {
    const { data: rows } = await admin
      .from("jose_permissions")
      .select("ad_account_id, nivel")
      .eq("user_id", access.tenantId)
      .eq("tipo_acao", tipoAcao)
      .or(`ad_account_id.is.null${adAccountDbId ? `,ad_account_id.eq.${adAccountDbId}` : ""}`);

    const perm = ((rows || []) as any[])
      .sort((a, b) => Number(Boolean(b.ad_account_id)) - Number(Boolean(a.ad_account_id)))[0] || null;

    if (perm?.nivel === "executar") {
      return { permitido: true, motivo: "permissao_explicita_executar" };
    }
    return { permitido: false, motivo: perm?.nivel ? `permissao_nivel_${perm.nivel}` : "sem_permissao_explicita" };
  } catch (e) {
    return { permitido: false, motivo: `erro_permissao_fail_closed:${String((e as any)?.message || e)}` };
  }
}

export function deny(status: number, error: string, corsHeaders: Record<string, string>): Response {
  return new Response(JSON.stringify({ ok: false, error }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
