import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const META_GRAPH_URL = "https://graph.facebook.com/v21.0";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: corsHeaders,
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } =
      await supabase.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: corsHeaders,
      });
    }
    const userId = claimsData.claims.sub as string;

    const { endpoint, params, method, body } = await req.json();

    if (endpoint === undefined || endpoint === null) {
      return new Response(
        JSON.stringify({ error: "endpoint is required" }),
        { status: 400, headers: corsHeaders }
      );
    }

    // Get user's active Meta ad account with token
    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: adAccount, error: accountError } = await adminClient
      .from("ad_accounts")
      .select("*")
      .eq("user_id", userId)
      .eq("platform", "meta")
      .eq("is_active", true)
      .limit(1)
      .single();

    if (accountError || !adAccount) {
      return new Response(
        JSON.stringify({
          error: "No active Meta ad account found. Please connect your account in Settings.",
          code: "NO_ACCOUNT",
        }),
        { status: 404, headers: corsHeaders }
      );
    }

    const accessToken = adAccount.access_token_encrypted;
    if (!accessToken) {
      return new Response(
        JSON.stringify({
          error: "Access token not found. Please reconnect your Meta account.",
          code: "NO_TOKEN",
        }),
        { status: 401, headers: corsHeaders }
      );
    }

    // Replace {ad_account_id} placeholder with actual account ID
    const resolvedEndpoint = endpoint.replace(
      /\{ad_account_id\}/g,
      adAccount.account_id
    );

    // Build URL
    const url = new URL(`${META_GRAPH_URL}/${resolvedEndpoint}`);
    url.searchParams.set("access_token", accessToken);

    if (params) {
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(
          key,
          typeof value === "string" ? value : JSON.stringify(value)
        );
      }
    }

    // Make request to Meta Graph API
    const fetchMethod = (method || "GET").toUpperCase();
    const fetchOptions: RequestInit = {
      method: fetchMethod,
      headers: { "Content-Type": "application/json" },
    };

    if (body && fetchMethod !== "GET") {
      fetchOptions.body = JSON.stringify(body);
    }

    const metaRes = await fetch(url.toString(), fetchOptions);
    const metaData = await metaRes.json();

    if (metaData.error) {
      // Check for expired token (only code 190 means the token itself is invalid)
      if (metaData.error.code === 190) {
        // Mark account as inactive
        await adminClient
          .from("ad_accounts")
          .update({ is_active: false })
          .eq("id", adAccount.id);

        return new Response(
          JSON.stringify({
            error:
              "Meta access token expired. Please reconnect your account in Settings.",
            code: "TOKEN_EXPIRED",
          }),
          { status: 401, headers: corsHeaders }
        );
      }

      return new Response(
        JSON.stringify({
          error: metaData.error.message,
          code: metaData.error.code,
          type: metaData.error.type,
        }),
        { status: metaRes.status, headers: corsHeaders }
      );
    }

    // Update last_sync_at
    await adminClient
      .from("ad_accounts")
      .update({ last_sync_at: new Date().toISOString() })
      .eq("id", adAccount.id);

    return new Response(JSON.stringify(metaData), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: corsHeaders,
    });
  }
});
