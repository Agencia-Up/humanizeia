import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

async function getAuthenticatedUser(req: Request) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } }
  );

  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user) return null;
  return data.user.id;
}

function handleAuthorize(redirect_uri: string, state?: string) {
  const clientId = Deno.env.get("GOOGLE_CLIENT_ID");
  const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");

  if (!clientId || !clientSecret) {
    return new Response(
      JSON.stringify({
        error: "not_configured",
        message: "A integração com o Google Ads ainda não foi configurada pelo administrador da plataforma. Entre em contato com o suporte.",
      }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Keep the OAuth request minimal for Google Ads connection to reduce consent-screen rejection risk.
  // Additional Google products should request their own scopes in their own flows.
  const scopes = [
    "openid",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
    "https://www.googleapis.com/auth/adwords",
  ].join(" ");

  const authUrl =
    `https://accounts.google.com/o/oauth2/v2/auth?` +
    `client_id=${encodeURIComponent(clientId)}` +
    `&redirect_uri=${encodeURIComponent(redirect_uri)}` +
    `&response_type=code` +
    `&scope=${encodeURIComponent(scopes)}` +
    `&access_type=offline` +
    `&include_granted_scopes=true` +
    `&prompt=consent` +
    `&state=${state || ""}`;

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

  const clientId = Deno.env.get("GOOGLE_CLIENT_ID")!;
  const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET")!;
  const developerToken = Deno.env.get("GOOGLE_ADS_DEVELOPER_TOKEN") || "";

  // Exchange code for tokens
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri,
      grant_type: "authorization_code",
    }),
  });
  const tokenData = await tokenRes.json();
  if (tokenData.error) {
    return new Response(
      JSON.stringify({ error: tokenData.error_description || tokenData.error }),
      { status: 400, headers: corsHeaders }
    );
  }

  const accessToken = tokenData.access_token;
  const refreshToken = tokenData.refresh_token;

  // Get user info
  const userRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const userData = await userRes.json();

  // List accessible Google Ads customer accounts
  let customers: any[] = [];
  if (developerToken) {
    try {
      const adsRes = await fetch(
        "https://googleads.googleapis.com/v18/customers:listAccessibleCustomers",
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "developer-token": developerToken,
          },
        }
      );
      const adsData = await adsRes.json();
      if (adsData.resourceNames) {
        // Fetch details for each customer
        for (const resourceName of adsData.resourceNames.slice(0, 10)) {
          const customerId = resourceName.replace("customers/", "");
          try {
            const detailRes = await fetch(
              `https://googleads.googleapis.com/v18/customers/${customerId}`,
              {
                headers: {
                  Authorization: `Bearer ${accessToken}`,
                  "developer-token": developerToken,
                  "login-customer-id": customerId,
                },
              }
            );
            const detail = await detailRes.json();
            if (detail.descriptiveName) {
              customers.push({
                id: customerId,
                name: detail.descriptiveName || `Conta ${customerId}`,
                currency: detail.currencyCode || "BRL",
                timezone: detail.timeZone || "America/Sao_Paulo",
              });
            }
          } catch {
            customers.push({
              id: customerId,
              name: `Conta ${customerId}`,
              currency: "BRL",
              timezone: "America/Sao_Paulo",
            });
          }
        }
      }
    } catch {
      // If no developer token or API fails, still allow connection
    }
  }

  // If no customers found, create a placeholder
  if (customers.length === 0) {
    customers.push({
      id: "pending",
      name: userData.name || userData.email || "Google Ads",
      currency: "BRL",
      timezone: "America/Sao_Paulo",
    });
  }

  return new Response(
    JSON.stringify({
      token: refreshToken || accessToken,
      access_token: accessToken,
      accounts: customers,
      user: { email: userData.email, name: userData.name },
      needs_selection: customers.length > 1,
      saved: customers.length === 1 ? false : false,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
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

  const adminClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const { data, error } = await adminClient
    .from("ad_accounts")
    .upsert(
      {
        user_id: userId,
        account_id: account_id,
        account_name: account_name || `Google Ads ${account_id}`,
        platform: "google",
        currency: currency || "BRL",
        timezone: timezone || "America/Sao_Paulo",
        access_token_encrypted: access_token,
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
        account_id: account_id,
        account_name: account_name || `Google Ads ${account_id}`,
        platform: "google",
        currency: currency || "BRL",
        timezone: timezone || "America/Sao_Paulo",
        access_token_encrypted: access_token,
        is_active: true,
        last_sync_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (insertError) {
      return new Response(JSON.stringify({ error: insertError.message }), {
        status: 400,
        headers: corsHeaders,
      });
    }
    return new Response(JSON.stringify({ account: insertData }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ account: data }), {
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
