import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const TIKTOK_AUTH_URL = "https://business-api.tiktok.com/open_api/v1.3";

async function getAuthenticatedUser(req: Request) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } }
  );

  const token = authHeader.replace("Bearer ", "");
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user.id;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const userId = await getAuthenticatedUser(req);
    if (!userId) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { action, code, redirect_uri, access_token } = await req.json();

    if (action === "get_auth_url") {
      const appId = Deno.env.get("TIKTOK_APP_ID");
      if (!appId) {
        return new Response(JSON.stringify({ error: "TikTok App ID not configured" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const authUrl = `https://business-api.tiktok.com/portal/auth?app_id=${appId}&redirect_uri=${encodeURIComponent(redirect_uri)}&state=tiktok_oauth`;

      return new Response(JSON.stringify({ auth_url: authUrl }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "exchange_token") {
      const appId = Deno.env.get("TIKTOK_APP_ID");
      const appSecret = Deno.env.get("TIKTOK_APP_SECRET");

      if (!appId || !appSecret) {
        return new Response(JSON.stringify({ error: "TikTok credentials not configured" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const tokenRes = await fetch(`${TIKTOK_AUTH_URL}/oauth2/access_token/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          app_id: appId,
          secret: appSecret,
          auth_code: code,
        }),
      });

      const tokenData = await tokenRes.json();

      if (tokenData.code !== 0) {
        return new Response(JSON.stringify({ error: tokenData.message || "Token exchange failed" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const accessToken = tokenData.data?.access_token;
      const advertiserIds = tokenData.data?.advertiser_ids || [];

      // Save to ad_accounts
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
      );

      for (const advId of advertiserIds) {
        await supabase.from("ad_accounts").upsert({
          user_id: userId,
          platform: "tiktok",
          account_id: advId,
          account_name: `TikTok Ads ${advId}`,
          access_token_encrypted: accessToken,
          is_active: true,
        }, { onConflict: "user_id,account_id" });
      }

      return new Response(JSON.stringify({
        success: true,
        advertiser_ids: advertiserIds,
        accounts_count: advertiserIds.length,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "get_accounts") {
      if (!access_token) {
        return new Response(JSON.stringify({ error: "Access token required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const res = await fetch(`${TIKTOK_AUTH_URL}/oauth2/advertiser/get/`, {
        method: "GET",
        headers: {
          "Access-Token": access_token,
          "Content-Type": "application/json",
        },
      });

      const data = await res.json();

      return new Response(JSON.stringify({
        accounts: data.data?.list || [],
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Invalid action" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("TikTok OAuth error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
