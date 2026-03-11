import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const GOOGLE_ADS_API = "https://googleads.googleapis.com/v18";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

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

async function getAccessToken(clientId: string, clientSecret: string, refreshToken: string) {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error(`Google OAuth error: ${data.error_description || data.error}`);
  return data.access_token;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const userId = await getAuthenticatedUser(req);
    if (!userId) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: corsHeaders,
      });
    }

    const body = await req.json();
    const { action } = body;

    if (action === "connect") {
      const { developer_token, client_id, client_secret, refresh_token, customer_id } = body;

      // Validate by getting an access token and calling the API
      let accessToken: string;
      try {
        accessToken = await getAccessToken(client_id, client_secret, refresh_token);
      } catch (err: any) {
        return new Response(
          JSON.stringify({ error: `Credenciais OAuth inválidas: ${err.message}` }),
          { status: 400, headers: corsHeaders }
        );
      }

      // Clean customer ID (remove dashes)
      const cleanCustomerId = customer_id.replace(/-/g, "");

      // Test API call to get account info
      const testRes = await fetch(
        `${GOOGLE_ADS_API}/customers/${cleanCustomerId}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "developer-token": developer_token,
            "login-customer-id": cleanCustomerId,
          },
        }
      );

      const testData = await testRes.json();
      if (testData.error) {
        return new Response(
          JSON.stringify({
            error: `Erro ao acessar conta Google Ads: ${testData.error.message || JSON.stringify(testData.error)}`,
          }),
          { status: 400, headers: corsHeaders }
        );
      }

      const accountName = testData.descriptiveName || testData.resourceName || `Google Ads ${cleanCustomerId}`;

      // Save credentials using service role
      const adminClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
      );

      // Store all credentials as encrypted JSON in access_token_encrypted
      const credentials = JSON.stringify({
        developer_token,
        client_id,
        client_secret,
        refresh_token,
      });

      const { data, error } = await adminClient
        .from("ad_accounts")
        .upsert(
          {
            user_id: userId,
            account_id: cleanCustomerId,
            account_name: accountName,
            platform: "google",
            currency: testData.currencyCode || "BRL",
            timezone: testData.timeZone || "America/Sao_Paulo",
            access_token_encrypted: credentials,
            is_active: true,
            last_sync_at: new Date().toISOString(),
          },
          { onConflict: "user_id,platform,account_id" }
        )
        .select()
        .single();

      if (error) {
        // Fallback to insert
        const { data: insertData, error: insertError } = await adminClient
          .from("ad_accounts")
          .insert({
            user_id: userId,
            account_id: cleanCustomerId,
            account_name: accountName,
            platform: "google",
            currency: testData.currencyCode || "BRL",
            timezone: testData.timeZone || "America/Sao_Paulo",
            access_token_encrypted: credentials,
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

        return new Response(JSON.stringify({ account: insertData, success: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ account: data, success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "query") {
      // Fetch credentials from ad_accounts
      const adminClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
      );

      const { data: account, error: accError } = await adminClient
        .from("ad_accounts")
        .select("*")
        .eq("user_id", userId)
        .eq("platform", "google")
        .eq("is_active", true)
        .limit(1)
        .maybeSingle();

      if (accError || !account) {
        return new Response(
          JSON.stringify({ error: "Conta Google Ads não encontrada" }),
          { status: 404, headers: corsHeaders }
        );
      }

      const creds = JSON.parse(account.access_token_encrypted);
      const accessToken = await getAccessToken(creds.client_id, creds.client_secret, creds.refresh_token);

      const { endpoint, method = "GET", query_body } = body;
      const url = `${GOOGLE_ADS_API}/${endpoint}`;

      const fetchOptions: RequestInit = {
        method,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "developer-token": creds.developer_token,
          "login-customer-id": account.account_id,
          "Content-Type": "application/json",
        },
      };

      if (query_body && method !== "GET") {
        fetchOptions.body = JSON.stringify(query_body);
      }

      const res = await fetch(url, fetchOptions);
      const data = await res.json();

      return new Response(JSON.stringify(data), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Invalid action" }), {
      status: 400,
      headers: corsHeaders,
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: corsHeaders,
    });
  }
});
