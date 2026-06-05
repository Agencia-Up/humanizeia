import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const META_GRAPH_URL = "https://graph.facebook.com/v21.0";

async function getAuthenticatedUser(req: Request) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } }
  );

  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return null;
  return user.id;
}

// Chaves do app Meta: primeiro do banco (geridas pelo operador no painel),
// com fallback pro env. Try/catch garante que, se a tabela nao existir
// (ex.: ambiente sem a migration), cai no env e nao quebra.
async function getMetaAppCreds(): Promise<{ appId: string; appSecret: string }> {
  let appId = "", appSecret = "";
  try {
    const svc = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data } = await svc
      .from("platform_app_credentials")
      .select("app_id, app_secret")
      .eq("provider", "meta")
      .maybeSingle();
    appId = (data?.app_id || "").trim();
    appSecret = (data?.app_secret || "").trim();
  } catch (_e) { /* cai no env */ }
  return {
    appId: appId || Deno.env.get("META_APP_ID") || "",
    appSecret: appSecret || Deno.env.get("META_APP_SECRET") || "",
  };
}

async function fetchMetaResource(endpoint: string, token: string) {
  try {
    const res = await fetch(`${META_GRAPH_URL}/${endpoint}&access_token=${token}`);
    const data = await res.json();
    if (data.error) return [];
    return data.data || [];
  } catch {
    return [];
  }
}

async function fetchFullAccountData(token: string) {
  const [adAccounts, pixels, pages, businesses] = await Promise.all([
    fetchMetaResource("me/adaccounts?fields=id,name,currency,timezone_name,account_status,business_name,amount_spent", token),
    fetchMetaResource("me/adaccounts?fields=id,name,adspixels{id,name,last_fired_time,is_unavailable}", token),
    fetchMetaResource("me/accounts?fields=id,name,category,fan_count,picture{url}", token),
    fetchMetaResource("me/businesses?fields=id,name,profile_picture_uri,verification_status,created_time", token),
  ]);

  // Extract pixels from ad accounts
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
    ad_accounts: adAccounts.map((a: any) => ({
      id: a.id,
      name: a.name,
      currency: a.currency,
      timezone_name: a.timezone_name,
      account_status: a.account_status,
      business_name: a.business_name || null,
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

async function handleAuthorize(redirect_uri: string, state?: string) {
  const { appId } = await getMetaAppCreds();
  const scopes = [
    "ads_management",
    "ads_read",
    "read_insights",
    "business_management",
    "pages_show_list",
  ].join(",");

  const authUrl = `https://www.facebook.com/v21.0/dialog/oauth?client_id=${appId}&redirect_uri=${encodeURIComponent(
    redirect_uri
  )}&scope=${scopes}&state=${state || ""}&response_type=code`;

  return new Response(JSON.stringify({ url: authUrl }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function handleCallback(req: Request, code: string, redirect_uri: string) {
  const userId = await getAuthenticatedUser(req);
  if (!userId) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: corsHeaders,
    });
  }

  const { appId, appSecret } = await getMetaAppCreds();

  // Exchange code for short-lived token
  const tokenRes = await fetch(
    `${META_GRAPH_URL}/oauth/access_token?client_id=${appId}&redirect_uri=${encodeURIComponent(
      redirect_uri
    )}&client_secret=${appSecret}&code=${code}`
  );
  const tokenData = await tokenRes.json();
  if (tokenData.error) {
    return new Response(JSON.stringify({ error: tokenData.error.message }), {
      status: 400,
      headers: corsHeaders,
    });
  }

  // Exchange for long-lived token
  const longRes = await fetch(
    `${META_GRAPH_URL}/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${tokenData.access_token}`
  );
  const longData = await longRes.json();
  if (longData.error) {
    return new Response(JSON.stringify({ error: longData.error.message }), {
      status: 400,
      headers: corsHeaders,
    });
  }

  const longLivedToken = longData.access_token;

  // Fetch all account data
  const accountData = await fetchFullAccountData(longLivedToken);

  return new Response(
    JSON.stringify({
      token: longLivedToken,
      expires_in: longData.expires_in,
      ...accountData,
      // Keep backward compat
      accounts: accountData.ad_accounts,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

async function handleConnectWithToken(req: Request, access_token: string, account_id?: string) {
  const userId = await getAuthenticatedUser(req);
  if (!userId) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: corsHeaders,
    });
  }

  // Validate token
  const meRes = await fetch(`${META_GRAPH_URL}/me?access_token=${access_token}`);
  const meData = await meRes.json();
  if (meData.error) {
    return new Response(
      JSON.stringify({ error: `Token inválido: ${meData.error.message}` }),
      { status: 400, headers: corsHeaders }
    );
  }

  // If account_id provided, fetch and save directly
  if (account_id) {
    const cleanId = account_id.replace("act_", "");
    const actRes = await fetch(
      `${META_GRAPH_URL}/act_${cleanId}?fields=id,name,currency,timezone_name,account_status&access_token=${access_token}`
    );
    const actData = await actRes.json();
    if (actData.error) {
      return new Response(
        JSON.stringify({ error: `Conta não encontrada: ${actData.error.message}` }),
        { status: 400, headers: corsHeaders }
      );
    }

    const result = await saveAdAccount(userId, {
      account_id: cleanId,
      account_name: actData.name || `act_${cleanId}`,
      currency: actData.currency || "BRL",
      timezone: actData.timezone_name || "America/Sao_Paulo",
      access_token,
    });

    if (result.error) {
      return new Response(JSON.stringify({ error: result.error }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    return new Response(
      JSON.stringify({ account: result.data, saved: true }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // No account_id: return full data for selection
  const accountData = await fetchFullAccountData(access_token);

  return new Response(
    JSON.stringify({
      token: access_token,
      needs_selection: true,
      ...accountData,
      accounts: accountData.ad_accounts,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

async function saveAdAccount(
  userId: string,
  data: {
    account_id: string;
    account_name: string;
    currency: string;
    timezone: string;
    access_token: string;
  }
) {
  const adminClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const cleanId = data.account_id.replace("act_", "");

  const { data: result, error } = await adminClient
    .from("ad_accounts")
    .upsert(
      {
        user_id: userId,
        account_id: cleanId,
        account_name: data.account_name,
        platform: "meta",
        currency: data.currency || "BRL",
        timezone: data.timezone || "America/Sao_Paulo",
        access_token_encrypted: data.access_token,
        is_active: true,
        last_sync_at: new Date().toISOString(),
      },
      { onConflict: "user_id,platform,account_id" }
    )
    .select()
    .single();

  if (error) {
    const { data: insertData, error: insertError } = await adminClient
      .from("ad_accounts")
      .insert({
        user_id: userId,
        account_id: cleanId,
        account_name: data.account_name,
        platform: "meta",
        currency: data.currency || "BRL",
        timezone: data.timezone || "America/Sao_Paulo",
        access_token_encrypted: data.access_token,
        is_active: true,
        last_sync_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (insertError) return { error: insertError.message, data: null };
    return { error: null, data: insertData };
  }

  return { error: null, data: result };
}

async function handleSaveAccount(req: Request, body: any) {
  const userId = await getAuthenticatedUser(req);
  if (!userId) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: corsHeaders,
    });
  }

  const { account_id, account_name, currency, timezone, access_token } = body || {};

  const result = await saveAdAccount(userId, {
    account_id: (account_id || "").replace("act_", ""),
    account_name,
    currency: currency || "BRL",
    timezone: timezone || "America/Sao_Paulo",
    access_token,
  });

  if (result.error) {
    return new Response(JSON.stringify({ error: result.error }), {
      status: 400,
      headers: corsHeaders,
    });
  }

  return new Response(JSON.stringify({ account: result.data }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { action } = body;

    switch (action) {
      case "authorize":
        return handleAuthorize(body.redirect_uri, body.state);

      case "callback":
        return handleCallback(req, body.code, body.redirect_uri);

      case "connect_with_token":
        return handleConnectWithToken(req, body.access_token, body.account_id);

      case "save_account":
        return handleSaveAccount(req, body);

      default:
        return new Response(JSON.stringify({ error: "Invalid action" }), {
          status: 400,
          headers: corsHeaders,
        });
    }
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: corsHeaders,
    });
  }
});
