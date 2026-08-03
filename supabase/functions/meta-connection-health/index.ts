import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const META_GRAPH_URL = Deno.env.get("META_GRAPH_URL") || "https://graph.facebook.com/v21.0";
const TIMEOUT_MS = 15_000;

/**
 * meta-connection-health
 *
 * O selo "Conectado" nao pode significar "existe linha em ad_accounts".
 * Era exatamente isso que acontecia: a Icom tinha 10 contas com is_active=true,
 * selo verde, e TODOS os tokens invalidados (OAuthException 190/460). A tela
 * dizia conectado enquanto o Jose nao conseguia ler uma metrica sequer.
 *
 * Esta funcao pergunta a Meta, sobre a CONTA EXATA que o Jose usa, e grava a
 * resposta. O token nunca entra na resposta nem no log.
 *
 * Estados devolvidos:
 *   connected            Graph respondeu 200 para a conta selecionada
 *   expired              OAuthException 190 (subcode 460 = senha trocada)
 *   reconnect_required   token recusado por outro motivo / permissao revogada
 *   no_account_selected  o tenant nao escolheu conta para o Jose
 *   configuration_error  falta conta, credencial ou configuracao do Jose
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader) return json({ ok: false, estado: "configuration_error", erro: "sem_autenticacao" }, 401);

  // Cliente COM o JWT do chamador: as RPCs resolvem tenant/papel por auth.uid().
  const asUser = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const body = await req.json().catch(() => ({} as any));
  const tenantContexto = body?.tenant ?? null;

  // ── 1) Qual conta o Jose usa (fonte: servidor, nunca localStorage) ───────
  const { data: sel, error: selErr } = await asUser.rpc("get_jose_selected_account", {
    p_tenant: tenantContexto,
  });
  if (selErr) {
    return json({ ok: false, estado: "configuration_error", erro: `falha_lendo_selecao:${selErr.code ?? selErr.message}` }, 500);
  }
  if (!sel?.ok) {
    return json({ ok: false, estado: "configuration_error", erro: sel?.erro ?? "selecao_indisponivel" }, 403);
  }
  if (!sel.ad_account_id) {
    return json({ ok: true, estado: "no_account_selected", pode_alterar: sel.pode_alterar === true }, 200);
  }

  // ── 2) Credencial da conta EXATA (service role; token nunca sai daqui) ───
  const { data: conta, error: contaErr } = await admin
    .from("ad_accounts")
    .select("id, account_id, user_id, connection_id, access_token_encrypted")
    .eq("id", sel.ad_account_id)
    .eq("user_id", sel.tenant)          // isolamento por tenant
    .eq("platform", "meta")
    .eq("is_active", true)
    .single();

  if (contaErr || !conta) {
    return json({ ok: false, estado: "configuration_error", erro: "conta_selecionada_indisponivel",
                  ad_account_id: sel.ad_account_id }, 409);
  }
  if (!conta.access_token_encrypted) {
    await persistir(admin, conta, "configuration_error", null, null, "sem_credencial");
    return json({ ok: false, estado: "configuration_error", erro: "conta_sem_credencial",
                  meta_account_id: conta.account_id }, 409);
  }

  // ── 3) Pergunta a Meta ───────────────────────────────────────────────────
  const url = `${META_GRAPH_URL}/act_${String(conta.account_id).replace(/^act_/, "")}`
    + `?fields=id,name,account_status,currency,timezone_name`;

  let status = 0;
  let corpo: any = {};
  try {
    // Token no HEADER, jamais na query string (evita vazar em log de proxy).
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${conta.access_token_encrypted}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    status = res.status;
    corpo = await res.json().catch(() => ({}));
  } catch (e) {
    const abortado = (e as any)?.name === "TimeoutError" || (e as any)?.name === "AbortError";
    await persistir(admin, conta, "reconnect_required", null, null,
      abortado ? `timeout_${TIMEOUT_MS}ms` : "falha_de_rede");
    return json({ ok: false, estado: "reconnect_required",
                  erro: abortado ? "timeout_consultando_meta" : "falha_de_rede" }, 502);
  }

  const err = corpo?.error;
  const code = err?.code ?? null;
  const subcode = err?.error_subcode ?? null;

  // ── 4) Classifica ────────────────────────────────────────────────────────
  if (status === 200 && corpo?.id) {
    await persistir(admin, conta, "connected", null, null, null, corpo?.account_status ?? null);
    return json({
      ok: true, estado: "connected",
      ad_account_id: conta.id, meta_account_id: conta.account_id,
      nome: corpo.name ?? null, account_status: corpo.account_status ?? null,
      moeda: corpo.currency ?? null, fuso: corpo.timezone_name ?? null,
      validado_em: new Date().toISOString(),
    }, 200);
  }

  // 190 = token invalido. subcode 460 = senha trocada / sessao invalidada.
  const estado = Number(code) === 190 ? "expired" : "reconnect_required";
  await persistir(admin, conta, estado, code, subcode, sanitizar(err?.message));

  return json({
    ok: false, estado,
    ad_account_id: conta.id, meta_account_id: conta.account_id,
    http_status: status, error_code: code, error_subcode: subcode,
    // Mensagem SANITIZADA. Nunca ecoa token nem cabecalho.
    mensagem: sanitizar(err?.message) ?? "credencial_recusada_pela_meta",
    acao: "reconectar_meta_ads",
  }, 200);
});

/** Remove qualquer coisa parecida com credencial antes de gravar/responder. */
function sanitizar(msg: unknown): string | null {
  if (!msg) return null;
  return String(msg)
    .replace(/EAA[A-Za-z0-9]{20,}/g, "<TOKEN>")
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer <TOKEN>")
    .slice(0, 300);
}

/**
 * Grava a saude nos DOIS lugares certos: a credencial (compartilhada por varias
 * contas) e a conta de anuncios (status/permissao proprios dela).
 */
async function persistir(
  admin: any, conta: any, estado: string,
  code: number | null, subcode: number | null, mensagem: string | null,
  accountStatus: number | null = null,
) {
  const agora = new Date().toISOString();
  try {
    if (conta.connection_id) {
      await admin.from("meta_connections").update({
        health_status: estado,
        last_validation_at: agora,
        last_error_code: code,
        last_error_subcode: subcode,
        last_error_message: mensagem,
        updated_at: agora,
      }).eq("id", conta.connection_id);
    }
    await admin.from("ad_accounts").update({
      account_health_status: estado,
      account_status_meta: accountStatus,
      last_account_check_at: agora,
      last_account_check_error: mensagem,
    }).eq("id", conta.id);
  } catch (e) {
    // Falha ao persistir nao pode derrubar o diagnostico que o usuario pediu.
    console.error("[meta-connection-health] falha persistindo saude:", (e as any)?.message ?? e);
  }
}

function json(payload: unknown, status: number) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
