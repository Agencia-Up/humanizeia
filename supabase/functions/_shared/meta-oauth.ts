import { createClient } from "npm:@supabase/supabase-js@2";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const META_GRAPH_VERSION = Deno.env.get("META_GRAPH_VERSION") || "v25.0";
const META_GRAPH_URL = `https://graph.facebook.com/${META_GRAPH_VERSION}`;
const META_DIALOG_URL = `https://www.facebook.com/${META_GRAPH_VERSION}/dialog/oauth`;

type MetaState = {
  user_id: string;
  return_to: string;
  redirect_uri: string;
  nonce: string;
  exp: number;
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function redirectResponse(url: string, status = 302) {
  return new Response(null, {
    status,
    headers: { Location: url, ...corsHeaders },
  });
}

function adminClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

async function getAuthenticatedUser(req: Request) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );

  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return null;
  return user.id;
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function stringToBase64Url(value: string) {
  return bytesToBase64Url(new TextEncoder().encode(value));
}

function base64UrlToString(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(normalized.length + ((4 - normalized.length % 4) % 4), "=");
  const binary = atob(padded);
  return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
}

async function getSigningSecret() {
  const explicit = Deno.env.get("META_OAUTH_STATE_SECRET");
  if (explicit) return explicit;
  const { appSecret } = await getMetaAppCreds();
  return appSecret || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "logosia-meta-oauth";
}

async function signState(payload: MetaState) {
  const body = stringToBase64Url(JSON.stringify(payload));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(await getSigningSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return `${body}.${bytesToBase64Url(new Uint8Array(signature))}`;
}

async function verifyState(state: string): Promise<MetaState | null> {
  const [body, signature] = state.split(".");
  if (!body || !signature) return null;

  const expected = await signState(JSON.parse(base64UrlToString(body)));
  const expectedSignature = expected.split(".")[1];
  if (signature !== expectedSignature) return null;

  const payload = JSON.parse(base64UrlToString(body)) as MetaState;
  if (!payload.user_id || !payload.return_to || !payload.redirect_uri || Date.now() > payload.exp) {
    return null;
  }
  return payload;
}

async function getMetaAppCreds(): Promise<{ appId: string; appSecret: string }> {
  let appId = "";
  let appSecret = "";
  try {
    const { data } = await adminClient()
      .from("platform_app_credentials")
      .select("app_id, app_secret")
      .eq("provider", "meta")
      .maybeSingle();
    appId = (data?.app_id || "").trim();
    appSecret = (data?.app_secret || "").trim();
  } catch (_e) {
    // Fallback to env below.
  }
  return {
    appId: appId || Deno.env.get("META_APP_ID") || "",
    appSecret: appSecret || Deno.env.get("META_APP_SECRET") || "",
  };
}

function forceHttps(origin: string): string {
  // Atrás do proxy do EasyPanel/Vercel o scheme interno vira http; a Meta EXIGE
  // https no redirect_uri. Força https para domínios públicos, mantendo http só
  // para localhost (dev).
  const clean = origin.replace(/\/+$/g, "");
  if (clean.startsWith("http://") && !/^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(clean)) {
    return "https://" + clean.slice("http://".length);
  }
  return clean;
}

function getExternalOrigin(req: Request, url: URL) {
  const logosiaOrigin = req.headers.get("x-logosia-origin") || url.searchParams.get("public_origin");
  if (logosiaOrigin) return forceHttps(logosiaOrigin);

  const forwardedHost = req.headers.get("x-forwarded-host");
  const forwardedProto = req.headers.get("x-forwarded-proto") || "https";
  if (forwardedHost) return forceHttps(`${forwardedProto}://${forwardedHost}`);
  return forceHttps(Deno.env.get("PUBLIC_SITE_URL") || Deno.env.get("SITE_URL") || url.origin);
}

function safeReturnTo(req: Request, url: URL, rawReturnTo: string | null) {
  const origin = getExternalOrigin(req, url);
  // Fallback vai pra tela que REALMENTE consome a sessao OAuth (/integrations/meta),
  // nao /settings (que nao monta o MetaAdsSettingsTab -> sessao nunca consumida).
  const fallback = `${origin}/integrations/meta`;
  if (!rawReturnTo) return fallback;
  try {
    const parsed = new URL(rawReturnTo, origin);
    if (parsed.origin !== origin) return fallback;
    return parsed.toString();
  } catch {
    return fallback;
  }
}

function withQuery(baseUrl: string, params: Record<string, string>) {
  const url = new URL(baseUrl);
  for (const [key, value] of Object.entries(params)) {
    if (value) url.searchParams.set(key, value);
  }
  return url.toString();
}

async function fetchMetaResource(endpoint: string, token: string) {
  try {
    const cleanEndpoint = endpoint.replace(/^\//, "");
    const res = await fetch(`${META_GRAPH_URL}/${cleanEndpoint}${cleanEndpoint.includes("?") ? "&" : "?"}access_token=${encodeURIComponent(token)}`);
    const data = await res.json();
    if (data.error) {
      console.error("[meta-oauth] Meta resource error", endpoint, data.error);
      return [];
    }
    return data.data || [];
  } catch (error) {
    console.error("[meta-oauth] Meta resource fetch failed", endpoint, error);
    return [];
  }
}

async function fetchFullAccountData(token: string) {
  const [adAccounts, pixels, pages, businesses] = await Promise.all([
    fetchMetaResource("me/adaccounts?fields=id,account_id,name,currency,timezone_name,account_status,amount_spent,business{id,name}", token),
    fetchMetaResource("me/adaccounts?fields=id,name,adspixels{id,name,last_fired_time,is_unavailable}", token),
    fetchMetaResource("me/accounts?fields=id,name,category,fan_count,picture{url}", token),
    fetchMetaResource("me/businesses?fields=id,name,profile_picture_uri,verification_status,created_time", token),
  ]);

  const allPixels: any[] = [];
  const pixelSeen = new Set<string>();
  for (const acc of pixels) {
    if (acc.adspixels?.data) {
      for (const px of acc.adspixels.data) {
        if (!pixelSeen.has(px.id)) {
          pixelSeen.add(px.id);
          allPixels.push({
            id: px.id,
            name: px.name,
            last_fired_time: px.last_fired_time || null,
            is_unavailable: px.is_unavailable || false,
            ad_account_id: acc.id,
            ad_account_name: acc.name,
          });
        }
      }
    }
  }

  return {
    graph_version: META_GRAPH_VERSION,
    ad_accounts: adAccounts.map((a: any) => ({
      id: a.id,
      account_id: a.account_id || String(a.id || "").replace(/^act_/, ""),
      name: a.name,
      currency: a.currency,
      timezone_name: a.timezone_name,
      account_status: a.account_status,
      business_id: a.business?.id || null,
      business_name: a.business?.name || a.business_name || null,
      amount_spent: a.amount_spent || "0",
    })),
    pixels: allPixels,
    pages: (pages || []).map((p: any) => ({
      id: p.id,
      name: p.name,
      category: p.category || null,
      fan_count: p.fan_count || 0,
      picture_url: p.picture?.data?.url || null,
    })),
    businesses: (businesses || []).map((b: any) => ({
      id: b.id,
      name: b.name,
      picture_url: b.profile_picture_uri || null,
      verification_status: b.verification_status || null,
    })),
  };
}

function buildAuthUrl(appId: string, redirectUri: string, state?: string) {
  // Login do Facebook comum: permissões via scope (decisão de 08/06/2026 — sem
  // Login for Business / config_id). Pedimos só o necessário pra ler anúncios,
  // puxar leads e acessar os ativos do negócio do cliente.
  const scopes = [
    "ads_read",
    "leads_retrieval",
    "pages_show_list",
    "pages_read_engagement",
    "pages_manage_metadata",
    "business_management",
  ].join(",");

  const authUrl = new URL(META_DIALOG_URL);
  authUrl.searchParams.set("client_id", appId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("scope", scopes);
  authUrl.searchParams.set("response_type", "code");
  if (state) authUrl.searchParams.set("state", state);
  return authUrl.toString();
}

async function exchangeCodeForLongLivedToken(code: string, redirectUri: string) {
  const { appId, appSecret } = await getMetaAppCreds();
  if (!appId || !appSecret) {
    throw new Error("META_APP_ID/META_APP_SECRET nao configurados");
  }

  const tokenUrl = new URL(`${META_GRAPH_URL}/oauth/access_token`);
  tokenUrl.searchParams.set("client_id", appId);
  tokenUrl.searchParams.set("redirect_uri", redirectUri);
  tokenUrl.searchParams.set("client_secret", appSecret);
  tokenUrl.searchParams.set("code", code);

  const tokenRes = await fetch(tokenUrl);
  const tokenData = await tokenRes.json();
  if (tokenData.error) throw new Error(tokenData.error.message);

  const longUrl = new URL(`${META_GRAPH_URL}/oauth/access_token`);
  longUrl.searchParams.set("grant_type", "fb_exchange_token");
  longUrl.searchParams.set("client_id", appId);
  longUrl.searchParams.set("client_secret", appSecret);
  longUrl.searchParams.set("fb_exchange_token", tokenData.access_token);

  const longRes = await fetch(longUrl);
  const longData = await longRes.json();
  if (longData.error) throw new Error(longData.error.message);

  return {
    accessToken: longData.access_token,
    expiresIn: Number(longData.expires_in || 0),
  };
}

async function handleAuthorize(redirectUri: string, state?: string) {
  const { appId } = await getMetaAppCreds();
  if (!appId) return jsonResponse({ error: "META_APP_ID nao configurado" }, 500);
  return jsonResponse({ url: buildAuthUrl(appId, redirectUri, state), graph_version: META_GRAPH_VERSION });
}

async function handleGetLogin(req: Request, url: URL) {
  const authedUserId = await getAuthenticatedUser(req);
  const userId = authedUserId || url.searchParams.get("user_id") || "";
  const returnTo = safeReturnTo(req, url, url.searchParams.get("return_to"));
  const redirectUri = url.searchParams.get("redirect_uri") || `${getExternalOrigin(req, url)}/api/meta/callback`;

  if (!userId) {
    return redirectResponse(withQuery(returnTo, { meta_error: "missing_user" }));
  }

  const { appId } = await getMetaAppCreds();
  if (!appId) {
    return redirectResponse(withQuery(returnTo, { meta_error: "missing_meta_app" }));
  }

  const state = await signState({
    user_id: userId,
    return_to: returnTo,
    redirect_uri: redirectUri,
    nonce: crypto.randomUUID(),
    exp: Date.now() + 10 * 60 * 1000,
  });

  return redirectResponse(buildAuthUrl(appId, redirectUri, state));
}

async function handleGetCallback(req: Request, url: URL) {
  const fallback = `${getExternalOrigin(req, url)}/integrations/meta`;
  const error = url.searchParams.get("error_description") || url.searchParams.get("error");
  if (error) return redirectResponse(withQuery(fallback, { meta_error: error }));

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return redirectResponse(withQuery(fallback, { meta_error: "missing_code_or_state" }));

  let payload: MetaState | null = null;
  try {
    payload = await verifyState(state);
  } catch (stateError) {
    console.error("[meta-oauth] Invalid state", stateError);
  }
  if (!payload) return redirectResponse(withQuery(fallback, { meta_error: "invalid_state" }));

  try {
    const { accessToken, expiresIn } = await exchangeCodeForLongLivedToken(code, payload.redirect_uri);
    const accountData = await fetchFullAccountData(accessToken);
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();

    const { data, error: insertError } = await adminClient()
      .from("meta_oauth_sessions")
      .insert({
        user_id: payload.user_id,
        access_token_encrypted: accessToken,
        expires_at: expiresAt,
        payload: {
          expires_in: expiresIn,
          ...accountData,
          accounts: accountData.ad_accounts,
        },
      })
      .select("id")
      .single();

    if (insertError) throw insertError;

    // O callback NAO pode terminar deixando o token so na sessao. Registra a
    // credencial e renova as contas ja integradas deste tenant -- e so deste.
    const admin = adminClient();
    const connectionId = await upsertConnection(admin, payload.user_id, accessToken, expiresIn);
    const renovacao = await refreshIntegratedAccounts(
      admin, payload.user_id, connectionId, accessToken, accountData.ad_accounts,
    );
    if (renovacao.erro) {
      // Falha aqui e operacional e precisa ser vista: a sessao existe, mas as
      // contas do cliente continuam com a credencial velha.
      console.error("[meta-oauth] falha renovando contas integradas:", renovacao.erro);
      return redirectResponse(withQuery(payload.return_to, {
        meta_error: "falha_renovando_contas_integradas",
        meta_oauth_session: data.id,
      }));
    }

    return redirectResponse(withQuery(payload.return_to, {
      meta_oauth_session: data.id,
      meta_accounts: String(accountData.ad_accounts.length),
      meta_renovadas: String(renovacao.renovadas),
    }));
  } catch (callbackError) {
    console.error("[meta-oauth] Callback failed", callbackError);
    return redirectResponse(withQuery(payload.return_to, {
      meta_error: callbackError instanceof Error ? callbackError.message : "callback_failed",
    }));
  }
}

async function handlePostCallback(req: Request, code: string, redirectUri: string) {
  const userId = await getAuthenticatedUser(req);
  if (!userId) return jsonResponse({ error: "Unauthorized" }, 401);

  const { accessToken, expiresIn } = await exchangeCodeForLongLivedToken(code, redirectUri);
  const accountData = await fetchFullAccountData(accessToken);

  return jsonResponse({
    token: accessToken,
    expires_in: expiresIn,
    ...accountData,
    accounts: accountData.ad_accounts,
  });
}

async function handleConnectWithToken(req: Request, accessToken: string, accountId?: string) {
  const userId = await getAuthenticatedUser(req);
  if (!userId) return jsonResponse({ error: "Unauthorized" }, 401);

  const meRes = await fetch(`${META_GRAPH_URL}/me?access_token=${encodeURIComponent(accessToken)}`);
  const meData = await meRes.json();
  if (meData.error) {
    return jsonResponse({ error: `Token invalido: ${meData.error.message}` }, 400);
  }

  if (accountId) {
    const cleanId = accountId.replace("act_", "");
    const actRes = await fetch(
      `${META_GRAPH_URL}/act_${cleanId}?fields=id,name,currency,timezone_name,account_status&access_token=${encodeURIComponent(accessToken)}`,
    );
    const actData = await actRes.json();
    if (actData.error) {
      return jsonResponse({ error: `Conta nao encontrada: ${actData.error.message}` }, 400);
    }

    const result = await saveAdAccount(userId, {
      account_id: cleanId,
      account_name: actData.name || `act_${cleanId}`,
      currency: actData.currency || "BRL",
      timezone: actData.timezone_name || "America/Sao_Paulo",
      access_token: accessToken,
    });

    if (result.error) return jsonResponse({ error: result.error }, 400);
    return jsonResponse({ account: result.data, saved: true });
  }

  const accountData = await fetchFullAccountData(accessToken);
  return jsonResponse({
    token: accessToken,
    needs_selection: true,
    ...accountData,
    accounts: accountData.ad_accounts,
  });
}

/**
 * Só o service_role pode usar os caminhos que aceitam token cru. Comparação em
 * tempo constante para não virar oráculo por timing.
 */
function isServiceRole(req: Request): boolean {
  const chave = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!chave || !bearer || bearer.length !== chave.length) return false;
  let diff = 0;
  for (let i = 0; i < chave.length; i++) diff |= chave.charCodeAt(i) ^ bearer.charCodeAt(i);
  return diff === 0;
}

/** Cliente com o JWT do chamador: as RPCs resolvem tenant por auth.uid(). */
function userClient(req: Request) {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } },
  );
}

/** sha256 hex — identifica a credencial sem nunca expor o valor. */
async function tokenFingerprint(token: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Registra/atualiza a CREDENCIAL do tenant e devolve o id da conexao.
 *
 * A saude do token pertence a conexao, nao a cada linha de ad_accounts: a Icom
 * tem 10 contas e apenas 2 credenciais. Aqui a conexao ja nasce validada --
 * chegamos neste ponto porque fetchFullAccountData respondeu, ou seja, a Meta
 * aceitou o token agora.
 */
async function upsertConnection(
  admin: any, userId: string, accessToken: string, expiresIn: number,
): Promise<string | null> {
  const fp = await tokenFingerprint(accessToken);
  const expiresAt = expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000).toISOString() : null;

  const { data, error } = await admin
    .from("meta_connections")
    .upsert({
      user_id: userId,
      access_token_encrypted: accessToken,
      token_fingerprint: fp,
      token_expires_at: expiresAt,
      health_status: "connected",
      last_validation_at: new Date().toISOString(),
      last_error_code: null, last_error_subcode: null, last_error_message: null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id,token_fingerprint" })
    .select("id")
    .single();

  if (error) {
    console.error("[meta-oauth] falha registrando conexao:", error.code ?? error.message);
    return null;
  }
  return data?.id ?? null;
}

/**
 * RENOVA a credencial das contas JA INTEGRADAS deste tenant.
 *
 * Este e o defeito que fazia "reconectar o Facebook" nao consertar nada: o
 * callback gravava o token novo SOMENTE em meta_oauth_sessions e nunca tocava
 * ad_accounts. O token so chegava na conta se a pessoa passasse de novo pelo
 * picker. Resultado: dava para reconectar com sucesso e o token morto (190/460)
 * continuar valendo para o Jose, com o selo verde.
 *
 * Renova APENAS o que ja estava integrado (is_active) e que aparece nesta
 * autorizacao. NAO integra conta nova -- isso continua sendo decisao explicita
 * do dono em save_selected.
 */
async function refreshIntegratedAccounts(
  admin: any, userId: string, connectionId: string | null,
  accessToken: string, discovered: any[],
): Promise<{ renovadas: number; erro: string | null }> {
  const ids = (discovered || [])
    .map((a: any) => String(a.account_id ?? a.id ?? "").replace(/^act_/, ""))
    .filter(Boolean);
  if (ids.length === 0) return { renovadas: 0, erro: null };

  const agora = new Date().toISOString();
  const { data, error } = await admin
    .from("ad_accounts")
    .update({
      access_token_encrypted: accessToken,
      connection_id: connectionId,
      account_health_status: "connected",
      last_account_check_at: agora,
      last_account_check_error: null,
      last_sync_at: agora,
      updated_at: agora,
    })
    .eq("user_id", userId)          // isolamento por tenant
    .eq("platform", "meta")
    .eq("is_active", true)          // so renova o que ja estava integrado
    .in("account_id", ids)
    .select("id");

  if (error) return { renovadas: 0, erro: error.message ?? String(error.code) };
  return { renovadas: (data || []).length, erro: null };
}

async function saveAdAccount(
  userId: string,
  data: {
    account_id: string;
    account_name: string;
    currency: string;
    timezone: string;
    access_token: string;
  },
) {
  const cleanId = data.account_id.replace("act_", "");

  const { data: profile } = await adminClient()
    .from("profiles")
    .select("organization_id")
    .eq("id", userId)
    .maybeSingle();

  const row = {
    user_id: userId,
    organization_id: profile?.organization_id || null,
    account_id: cleanId,
    account_name: data.account_name,
    platform: "meta",
    currency: data.currency || "BRL",
    timezone: data.timezone || "America/Sao_Paulo",
    access_token_encrypted: data.access_token,
    is_active: true,
    last_sync_at: new Date().toISOString(),
  };

  const { data: result, error } = await adminClient()
    .from("ad_accounts")
    .upsert(row, { onConflict: "user_id,platform,account_id" })
    .select()
    .single();

  if (!error) return { error: null, data: result };

  const { data: insertData, error: insertError } = await adminClient()
    .from("ad_accounts")
    .insert(row)
    .select()
    .single();

  if (insertError) return { error: insertError.message, data: null };
  return { error: null, data: insertData };
}

async function handleSaveAccount(req: Request, body: any) {
  const userId = await getAuthenticatedUser(req);
  if (!userId) return jsonResponse({ error: "Unauthorized" }, 401);

  const { account_id, account_name, currency, timezone, access_token } = body || {};
  if (!account_id || !account_name || !access_token) {
    return jsonResponse({ error: "account_id, account_name e access_token sao obrigatorios" }, 400);
  }

  const result = await saveAdAccount(userId, {
    account_id: String(account_id).replace("act_", ""),
    account_name,
    currency: currency || "BRL",
    timezone: timezone || "America/Sao_Paulo",
    access_token,
  });

  if (result.error) return jsonResponse({ error: result.error }, 400);
  return jsonResponse({ account: result.data });
}

// NOVO (Fix 2): salva MÚLTIPLAS contas + persiste os pixels e páginas SELECIONADOS
// de uma vez. O usuário escolhe (checkboxes) o que integrar; nada mais é automático.
async function handleSaveSelected(req: Request, body: any) {
  const userId = await getAuthenticatedUser(req);
  if (!userId) return jsonResponse({ ok: false, error: "Unauthorized" }, 401);

  // Token vindo do navegador e recusado sempre: o cliente nunca e fonte de
  // credencial. O token desta integracao sai da propria sessao, no servidor.
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const legado = String(body?.access_token ?? "");

  // Credencial de verdade vinda do navegador continua RECUSADA. O painel antigo
  // manda de volta o uuid da sessao neste mesmo campo (ver handleConsumeSession):
  // isso e uma referencia, nao um segredo, e e aceito.
  if (legado && !UUID_RE.test(legado)) {
    return jsonResponse({ ok: false, error: "access_token_nao_aceito_do_frontend" }, 400);
  }

  const sessionId = body?.session_id ?? (UUID_RE.test(legado) ? legado : null);
  if (!sessionId) return jsonResponse({ ok: false, error: "session_id obrigatorio" }, 400);

  const norm = (x: unknown) => String(x ?? "").replace(/^act_/, "");
  // O painel implantado manda os OBJETOS (accounts/pixels/pages); o novo manda
  // so os IDs. Aceitamos os dois e extraimos sempre o identificador.
  const ids = (novo: unknown, velho: unknown, extrai: (o: any) => unknown): string[] => {
    if (Array.isArray(novo)) return novo.map((x) => String(x ?? "")).filter(Boolean);
    if (Array.isArray(velho)) return velho.map((o) => String(extrai(o) ?? "")).filter(Boolean);
    return [];
  };
  const accountIds: string[] = ids(body?.account_ids, body?.accounts,
    (o) => o?.account_id ?? o?.id).map(norm).filter(Boolean);
  const pixelIds: string[] = ids(body?.pixel_ids, body?.pixels, (o) => o?.id ?? o?.pixel_id);
  const pageIds: string[] = ids(body?.page_ids, body?.pages, (o) => o?.id ?? o?.page_id);
  const selectForJose = body?.select_for_jose ? norm(body.select_for_jose) : null;

  // TUDO OU NADA: trava a sessao, valida contra a descoberta dela, grava
  // credencial + contas + selecao do Jose e consome — numa transacao so.
  const { data, error } = await userClient(req).rpc("consume_meta_oauth_session", {
    p_session_id: sessionId,
    p_account_ids: accountIds,
    p_pixel_ids: pixelIds,
    p_page_ids: pageIds,
    p_select_for_jose: selectForJose,
  });

  if (error) {
    console.error("[meta-oauth] consume_meta_oauth_session falhou:", error.code ?? error.message);
    return jsonResponse({ ok: false, error: "falha_consumindo_sessao", detalhe: error.code ?? null }, 500);
  }

  const res = data as any;
  if (!res?.ok) {
    // Replay e conflito explicito; o resto e 4xx com motivo legivel.
    const status = res?.erro === "sessao_ja_consumida" ? 409
      : res?.erro === "sessao_de_outro_usuario" ? 403
      : res?.erro === "sessao_expirada" || res?.erro === "sessao_inexistente" ? 404
      : 422;
    return jsonResponse({ ok: false, error: res?.erro ?? "falha_desconhecida", itens: res?.itens ?? null }, status);
  }

  // Metadados apenas. Nunca o token.
  const admin = adminClient();
  let account: any = null;
  if (accountIds[0]) {
    const { data: acc } = await admin.from("ad_accounts")
      .select("id, account_id, account_name, platform, is_active, currency, timezone, last_sync_at")
      .eq("user_id", userId).eq("platform", "meta").eq("account_id", accountIds[0]).maybeSingle();
    account = acc || null;
  }

  return jsonResponse({
    ok: true,
    saved: { accounts: res.contas, pixels: res.pixels, pages: res.paginas },
    errors: [],
    jose_ad_account_id: res.jose_ad_account_id ?? null,
    account,
  });
}

async function handleConsumeSession(req: Request, sessionId: string) {
  const userId = await getAuthenticatedUser(req);
  if (!userId) return jsonResponse({ error: "Unauthorized" }, 401);
  if (!sessionId) return jsonResponse({ error: "session_id is required" }, 400);

  const { data, error } = await adminClient()
    .from("meta_oauth_sessions")
    .select("id, payload, consumed_at, expires_at")   // NUNCA seleciona o token
    .eq("id", sessionId)
    .eq("user_id", userId)                            // isolamento por tenant
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (error) return jsonResponse({ error: error.message }, 400);
  if (!data) return jsonResponse({ error: "Sessao OAuth expirada ou nao encontrada" }, 404);

  // Sessao ja consumida nao lista de novo: o token dela ja virou integracao.
  if (data.consumed_at) {
    return jsonResponse({ error: "sessao_ja_consumida", consumed_at: data.consumed_at }, 409);
  }

  // O access_token NAO volta para o navegador. Antes voltava aqui e o front o
  // reenviava no save_selected -- o token cru fazia uma viagem de ida e volta
  // pelo cliente. Agora o front so carrega o session_id.
  const { token: _descartado, ...semToken } = (data.payload || {}) as Record<string, unknown>;
  // COMPATIBILIDADE: o painel implantado le `data.token` e o devolve depois em
  // save_selected. Devolvemos aqui o ID DA SESSAO nesse campo -- e um uuid, nao
  // uma credencial. O access_token continua sem sair do servidor, e o front
  // novo usa `session_id`. Os dois contratos convivem ate o Rebuild.
  return jsonResponse({ session_id: data.id, token: data.id, ...semToken });
}

async function handlePost(req: Request) {
  const body = await req.json();
  const { action } = body;

  switch (action) {
    case "authorize":
      return handleAuthorize(body.redirect_uri, body.state);
    case "callback":
      return handlePostCallback(req, body.code, body.redirect_uri);
    // Estes dois recebiam access_token cru do navegador. Ficam restritos ao
    // service_role: nenhum usuario autenticado (nem o dono da conta) pode
    // injetar credencial por aqui. Se um consumidor interno precisar, ele
    // chama com a service key — e nunca a partir do browser.
    case "connect_with_token":
      if (!isServiceRole(req)) {
        return jsonResponse({ ok: false, error: "acao_restrita_ao_service_role" }, 403);
      }
      return handleConnectWithToken(req, body.access_token, body.account_id);
    case "save_account": {
      // O painel implantado usa este caminho para conta unica, mandando de volta
      // o uuid da sessao no campo access_token. Nesse caso delegamos para o
      // fluxo atomico. Credencial de verdade aqui continua so no service_role.
      const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (UUID.test(String(body?.access_token ?? ""))) {
        return handleSaveSelected(req, {
          session_id: body.access_token,
          account_ids: [String(body?.account_id ?? "").replace(/^act_/, "")],
        });
      }
      if (!isServiceRole(req)) {
        return jsonResponse({ ok: false, error: "acao_restrita_ao_service_role" }, 403);
      }
      return handleSaveAccount(req, body);
    }
    case "save_selected":
      return handleSaveSelected(req, body);
    case "consume_session":
      return handleConsumeSession(req, body.session_id);
    default:
      return jsonResponse({ error: "Invalid action" }, 400);
  }
}

export async function serveMetaOAuth(req: Request) {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const pathname = url.pathname.replace(/\/+$/g, "");

    if (req.method === "GET" && pathname.endsWith("/meta/login")) {
      return handleGetLogin(req, url);
    }
    if (req.method === "GET" && pathname.endsWith("/meta/callback")) {
      return handleGetCallback(req, url);
    }
    if (req.method === "POST") {
      return handlePost(req);
    }

    return jsonResponse({
      error: "Not found",
      available_routes: ["GET /api/meta/login", "GET /api/meta/callback", "POST action"],
      graph_version: META_GRAPH_VERSION,
    }, 404);
  } catch (err) {
    console.error("[meta-oauth] Request failed", err);
    return jsonResponse({ error: err instanceof Error ? err.message : "Internal error" }, 500);
  }
}
