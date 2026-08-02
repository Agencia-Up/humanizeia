/**
 * ownership.ts — José / Fase 1
 *
 * Duas falhas graves que este módulo fecha no apollo-agent:
 *
 * 1) FALLBACK GLOBAL DA PLATAFORMA. O código antigo, quando o tenant não tinha
 *    conta Meta conectada, caía para META_ACCESS_TOKEN / META_AD_ACCOUNT_ID —
 *    a conta de anúncios do DONO DA PLATAFORMA. Qualquer usuário autenticado
 *    sem conexão própria gastava dinheiro na conta da Logos. Aqui isso não
 *    existe: sem conexão válida do tenant, a operação falha com erro explícito.
 *
 * 2) RECURSO DE OUTRA CONTA. `campaign_id`/`adset_id`/`ad_id` chegavam crus do
 *    body e iam direto para o Graph API. Se o token do tenant tem escopo sobre
 *    várias contas (System User / Business Manager — comum), dava para mexer em
 *    campanha de conta alheia. Aqui todo recurso é conferido contra a conta.
 */

const META_GRAPH_URL = Deno.env.get("META_GRAPH_URL") || "https://graph.facebook.com/v21.0";

export interface OwnedAccount {
  db_id: string;
  account_id: string;      // act_XXXXXXXX
  access_token: string;
  currency?: string | null;
}

export type OwnershipError = { ok: false; status: number; error: string; detalhe?: string };
export type OwnedAccountResult = { ok: true; account: OwnedAccount } | OwnershipError;

/**
 * Resolve a conta de anúncios do TENANT. Sem fallback para a plataforma.
 * `targetAccountId` vem do cliente (localStorage) e por isso é tratado como
 * pedido, não como verdade: só é aceito se pertencer ao tenant.
 */
export async function resolveOwnedAdAccount(
  admin: any,
  tenantId: string,
  targetAccountId?: string | null,
): Promise<OwnedAccountResult> {
  if (!tenantId) return { ok: false, status: 400, error: "tenant_ausente" };

  try {
    let q = admin
      .from("ad_accounts")
      .select("id, account_id, access_token_encrypted, currency, is_active")
      .eq("user_id", tenantId);

    if (targetAccountId) q = q.eq("account_id", targetAccountId);

    const { data: rows, error } = await q
      .order("is_active", { ascending: false })
      .limit(1);

    if (error) {
      return { ok: false, status: 500, error: "falha_lendo_conta_meta", detalhe: String(error.message || error) };
    }

    const acc = (rows || [])[0];
    if (!acc) {
      // Erro OPERACIONAL explícito. Nunca cair para a conta da plataforma.
      return {
        ok: false,
        status: 409,
        error: targetAccountId ? "conta_meta_nao_pertence_ao_tenant" : "tenant_sem_conta_meta_conectada",
        detalhe: targetAccountId
          ? `A conta ${targetAccountId} não está vinculada a este cliente.`
          : "Conecte uma conta de anúncios do Meta em Integrações para operar campanhas.",
      };
    }
    if (!acc.access_token_encrypted) {
      return { ok: false, status: 409, error: "conta_meta_sem_token", detalhe: "Reconecte a conta do Meta." };
    }

    return {
      ok: true,
      account: {
        db_id: acc.id,
        account_id: acc.account_id,
        access_token: acc.access_token_encrypted,
        currency: acc.currency ?? null,
      },
    };
  } catch (e) {
    return { ok: false, status: 500, error: "erro_resolvendo_conta", detalhe: String((e as any)?.message || e) };
  }
}

/**
 * Confirma na Meta que o recurso pertence à conta. Fail-closed: se não der para
 * confirmar (rede, permissão, resposta estranha), NÃO autoriza.
 *
 * O token vai no header, nunca na query string (evita vazar em log de proxy).
 */
export async function assertResourceBelongsToAccount(
  accessToken: string,
  accountId: string,
  resourceId: string,
  kind: "campaign" | "adset" | "ad",
): Promise<{ ok: true } | OwnershipError> {
  if (!resourceId) return { ok: false, status: 400, error: `${kind}_id_ausente` };
  // IDs da Meta são numéricos; recusa cedo qualquer coisa fora disso.
  if (!/^\d{5,}$/.test(String(resourceId))) {
    return { ok: false, status: 400, error: `${kind}_id_invalido` };
  }

  try {
    const url = `${META_GRAPH_URL}/${resourceId}?fields=account_id`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) {
      return {
        ok: false,
        status: 403,
        error: `${kind}_inacessivel`,
        detalhe: `Meta respondeu ${res.status} ao verificar a propriedade do recurso.`,
      };
    }
    const body = await res.json().catch(() => ({} as any));
    const donoRaw = String(body?.account_id ?? "");
    if (!donoRaw) {
      return { ok: false, status: 403, error: `${kind}_sem_account_id`, detalhe: "Meta não retornou account_id." };
    }
    // Normaliza: a Meta ora devolve "act_123", ora "123".
    const norm = (s: string) => s.replace(/^act_/, "");
    if (norm(donoRaw) !== norm(String(accountId))) {
      return {
        ok: false,
        status: 403,
        error: `${kind}_de_outra_conta`,
        detalhe: "O recurso informado não pertence à conta de anúncios deste cliente.",
      };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, status: 502, error: `falha_verificando_${kind}`, detalhe: String((e as any)?.message || e) };
  }
}
