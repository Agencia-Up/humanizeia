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

  const token = authHeader.replace("Bearer ", "");
  const { data, error } = await supabase.auth.getClaims(token);
  if (error || !data?.claims) return null;
  return data.claims.sub as string;
}

async function handleAuthorize(redirect_uri: string, state?: string) {
  const appId = Deno.env.get("META_APP_ID")!;
  const scopes = [
    "ads_management",
    "ads_read",
    "read_insights",
    "business_management",
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

  const appId = Deno.env.get("META_APP_ID")!;
  const appSecret = Deno.env.get("META_APP_SECRET")!;

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

  // Get ad accounts
  const accountsRes = await fetch(
    `${META_GRAPH_URL}/me/adaccounts?fields=id,name,currency,timezone_name,account_status&access_token=${longLivedToken}`
  );
  const accountsData = await accountsRes.json();
  if (accountsData.error) {
    return new Response(JSON.stringify({ error: accountsData.error.message }), {
      status: 400,
      headers: corsHeaders,
    });
  }

  return new Response(
    JSON.stringify({
      token: longLivedToken,
      accounts: accountsData.data || [],
      expires_in: longData.expires_in,
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

  // If account_id provided, fetch that specific account
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

    // Save directly
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

  // No account_id: return list for selection
  const accountsRes = await fetch(
    `${META_GRAPH_URL}/me/adaccounts?fields=id,name,currency,timezone_name,account_status&access_token=${access_token}`
  );
  const accountsData = await accountsRes.json();
  if (accountsData.error) {
    return new Response(
      JSON.stringify({ error: accountsData.error.message }),
      { status: 400, headers: corsHeaders }
    );
  }

  return new Response(
    JSON.stringify({
      token: access_token,
      accounts: accountsData.data || [],
      needs_selection: true,
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
    // Try insert if upsert fails
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
