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
  tenantContext?: string | null,
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

  return { ok: true, access: await buildAccess(admin, authUserId, tenantContext) };
}

/**
 * Monta o contrato de poder a partir da identidade JÁ verificada.
 *
 * PROVA DE PROPRIEDADE (corrigido após auditoria): a única prova de que alguém
 * é dono do tenant é `authUserId === tenantId`. A versão anterior tratava
 * "role != 'seller'" como propriedade e concedia canMutate — o que dava poder de
 * mutação a gerente, responsável ou qualquer perfil não-seller. `role` descreve
 * o TIPO de conta, nunca a titularidade de um tenant.
 *
 * Quem NÃO é o tenant (gerente, responsável, parceiro, vendedor) precisa, em
 * conjunto: vínculo ATIVO e não removido com aquele tenant + permissão
 * EXPLÍCITA em jose_permissions (avaliada por ação em canMutateAction).
 *
 * `tenantContext` é o tenant EXPLÍCITO e VERIFICÁVEL da requisição — na prática
 * derivado do RECURSO pedido (dono da conta de anúncios). Quando o usuário tem
 * vínculo ativo com MAIS DE UM tenant, ele é obrigatório: pegar `ativos[0]`
 * seria o sistema decidir sozinho em nome de qual empresa a pessoa está agindo.
 * Sem contexto confiável e com ambiguidade -> RECUSA.
 */
export async function buildAccess(
  admin: any,
  authUserId: string,
  tenantContext?: string | null,
): Promise<JoseAccess> {
  const base: JoseAccess = {
    authUserId,
    tenantId: authUserId,
    isOwner: false,
    isSeller: false,
    isManager: false,
    canView: false,
    canRecommend: false,
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
    const isSuperadmin = prof?.is_superadmin === true; // campo oficial, não inferência

    // ── VÍNCULO PRIMEIRO, papel nunca ──────────────────────────────────────
    // A pergunta que decide tudo é "este usuário É um membro de alguma conta?",
    // não "qual o role dele?". Quem tem vínculo ATIVO é MEMBRO daquele tenant —
    // seja vendedor, gerente ou responsável — e por isso precisa de permissão
    // explícita para mutar. Só quem não é membro de ninguém opera a própria
    // conta como dono.
    // ATENÇÃO: a busca NÃO filtra removido/inativo no banco. Se filtrasse, um
    // membro DESLIGADO voltaria zero linhas e cairia no ramo "dono" logo abaixo,
    // recebendo poder total — foi exatamente o bug que o teste A8/A9 pegou.
    // Precisamos distinguir "nunca foi membro" de "é membro, porém morto".
    const { data: vinculos } = await admin
      .from("ai_team_members")
      .select("user_id, is_manager, visible_features, removed_at, active_in_system")
      .eq("auth_user_id", authUserId)
      .order("is_manager", { ascending: false })
      .limit(20);

    const todos = (vinculos || []) as any[];
    const ativos = todos.filter((v) => v.removed_at == null && v.active_in_system !== false);

    // ── VÍNCULO EXISTE MAS ESTÁ MORTO: nega tudo ──────────────────────────
    if (todos.length > 0 && ativos.length === 0) {
      if (isSuperadmin) {
        // Mesmo superadmin precisa dizer QUAL tenant quando há mais de um.
        const alvo = tenantContext ?? (todos.length === 1 ? (todos[0].user_id as string) : null);
        if (!alvo) return { ...base, isSeller, motivo: "associacao_ambigua_informe_tenant" };
        return {
          ...base, tenantId: alvo, isSeller, isManager: true,
          canView: true, canRecommend: true, canMutate: true, motivo: "superadmin_comprovado",
        };
      }
      return {
        ...base,
        tenantId: tenantContext ?? (todos.length === 1 ? (todos[0].user_id as string) : authUserId),
        isSeller,
        motivo: "vinculo_removido_ou_inativo",
      };
    }

    // ── DONO: nunca foi membro de ninguém, o escopo é a própria conta ──────
    if (ativos.length === 0) {
      // Confirma que o tenant efetivo é ele mesmo; se apontar para outra conta
      // (ex.: profiles.manager_id preenchido), NÃO é dono.
      const tenantResolvido = await resolveEffectiveTenant(admin, authUserId);
      if (tenantResolvido !== authUserId) {
        return {
          ...base, tenantId: tenantResolvido, isSeller,
          canView: isSuperadmin, canRecommend: isSuperadmin, canMutate: isSuperadmin,
          motivo: isSuperadmin ? "superadmin_comprovado" : "vinculo_inativo_ou_removido",
        };
      }
      return {
        ...base, tenantId: authUserId, isOwner: true, isSeller, isManager: true,
        canView: true, canRecommend: true, canMutate: true,
        motivo: "owner_do_tenant",
      };
    }

    // ── RESOLUÇÃO DO TENANT: explícita, nunca "o primeiro da lista" ────────
    const tenantsAtivos = [...new Set(ativos.map((v) => String(v.user_id)))];
    let membro: any;
    let tenantId: string;

    if (tenantContext) {
      // Contexto informado: só vale se houver vínculo ATIVO exatamente nele.
      const casa = ativos.filter((v) => String(v.user_id) === String(tenantContext));
      if (casa.length === 0) {
        return {
          ...base, tenantId: String(tenantContext), isSeller,
          motivo: "sem_vinculo_ativo_no_tenant_solicitado",
        };
      }
      // Entre linhas-irmãs do MESMO tenant, a de gerente tem precedência —
      // isso não é escolha de tenant, é escolha de papel dentro dele.
      membro = casa.find((v) => v.is_manager === true) ?? casa[0];
      tenantId = String(tenantContext);
    } else if (tenantsAtivos.length === 1) {
      const casa = ativos.filter((v) => String(v.user_id) === tenantsAtivos[0]);
      membro = casa.find((v) => v.is_manager === true) ?? casa[0];
      tenantId = tenantsAtivos[0];
    } else {
      // Vários tenants ativos e nenhum contexto confiável: RECUSA.
      return {
        ...base, isSeller,
        motivo: `associacao_ambigua_informe_tenant:${tenantsAtivos.length}_tenants_ativos`,
      };
    }

    // Superadmin comprovado mantém poder mesmo sendo membro de alguma conta.
    if (isSuperadmin) {
      return {
        ...base, tenantId, isOwner: false, isSeller, isManager: true,
        canView: true, canRecommend: true, canMutate: true,
        motivo: "superadmin_comprovado",
      };
    }

    const vf = (membro.visible_features || {}) as Record<string, unknown>;
    // Ausência da chave = liberado (padrão histórico); só bloqueia se explícito.
    const temJose = vf.agent_jose !== false;

    return {
      ...base,
      tenantId,
      isOwner: false,
      isSeller,
      isManager: membro.is_manager === true,
      canView: temJose,
      canRecommend: temJose,
      // MUTAÇÃO nunca vem do vínculo: exige prova positiva por ação em
      // canMutateAction(), inclusive para gerente.
      canMutate: false,
      motivo: temJose
        ? (membro.is_manager === true ? "gerente_precisa_permissao_explicita" : "membro_precisa_permissao_explicita")
        : "sem_agent_jose",
    };
  } catch (e) {
    // Fail-closed em TUDO: sem conseguir avaliar, não há leitura nem mutação.
    return { ...base, motivo: `erro_avaliando_permissao:${String((e as any)?.message || e)}` };
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
