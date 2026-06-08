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
  if (!rawReturnTo) return `${origin}/settings`;
  try {
    const parsed = new URL(rawReturnTo, origin);
    if (parsed.origin !== origin) return `${origin}/settings`;
    return parsed.toString();
  } catch {
    return `${origin}/settings`;
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
  const fallback = `${getExternalOrigin(req, url)}/settings`;
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

    return redirectResponse(withQuery(payload.return_to, {
      meta_oauth_session: data.id,
      meta_accounts: String(accountData.ad_accounts.length),
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

async function handleConsumeSession(req: Request, sessionId: string) {
  const userId = await getAuthenticatedUser(req);
  if (!userId) return jsonResponse({ error: "Unauthorized" }, 401);
  if (!sessionId) return jsonResponse({ error: "session_id is required" }, 400);

  const { data, error } = await adminClient()
    .from("meta_oauth_sessions")
    .select("*")
    .eq("id", sessionId)
    .eq("user_id", userId)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (error) return jsonResponse({ error: error.message }, 400);
  if (!data) return jsonResponse({ error: "Sessao OAuth expirada ou nao encontrada" }, 404);

  return jsonResponse({
    token: data.access_token_encrypted,
    ...(data.payload || {}),
  });
}

async function handlePost(req: Request) {
  const body = await req.json();
  const { action } = body;

  switch (action) {
    case "authorize":
      return handleAuthorize(body.redirect_uri, body.state);
    case "callback":
      return handlePostCallback(req, body.code, body.redirect_uri);
    case "connect_with_token":
      return handleConnectWithToken(req, body.access_token, body.account_id);
    case "save_account":
      return handleSaveAccount(req, body);
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
