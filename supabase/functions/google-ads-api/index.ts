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

    // ── Fetch campaigns with insights ──
    if (action === "get_campaigns") {
      const adminClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      const { data: account } = await adminClient.from("ad_accounts").select("*")
        .eq("user_id", userId).eq("platform", "google").eq("is_active", true).limit(1).maybeSingle();
      if (!account) return new Response(JSON.stringify({ error: "Conta Google Ads não encontrada" }), { status: 404, headers: corsHeaders });

      const creds = JSON.parse(account.access_token_encrypted);
      const accessToken = await getAccessToken(creds.client_id, creds.client_secret, creds.refresh_token);
      const customerId = account.account_id;
      const { date_range = "LAST_30_DAYS" } = body;

      // GAQL query for campaigns with metrics
      const gaqlQuery = `
        SELECT
          campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type,
          campaign.bidding_strategy_type, campaign_budget.amount_micros,
          metrics.impressions, metrics.clicks, metrics.cost_micros,
          metrics.conversions, metrics.conversions_value, metrics.ctr,
          metrics.average_cpc, metrics.average_cpm, metrics.cost_per_conversion
        FROM campaign
        WHERE campaign.status != 'REMOVED'
          AND segments.date DURING ${date_range}
        ORDER BY metrics.cost_micros DESC
        LIMIT 50
      `;

      const searchRes = await fetch(`${GOOGLE_ADS_API}/customers/${customerId}/googleAds:searchStream`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "developer-token": creds.developer_token,
          "login-customer-id": customerId,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query: gaqlQuery }),
      });
      const searchData = await searchRes.json();

      if (searchData.error) {
        return new Response(JSON.stringify({ error: searchData.error.message || "Erro Google Ads API" }), { status: 400, headers: corsHeaders });
      }

      // Parse results
      const campaigns = (searchData[0]?.results || []).map((r: any) => {
        const c = r.campaign || {};
        const m = r.metrics || {};
        const b = r.campaignBudget || {};
        const spend = (m.costMicros || 0) / 1_000_000;
        const cpc = (m.averageCpc || 0) / 1_000_000;
        const cpm = (m.averageCpm || 0) / 1_000_000;
        const ctr = m.ctr || 0;
        const conversions = m.conversions || 0;
        const revenue = m.conversionsValue || 0;
        const roas = spend > 0 ? revenue / spend : 0;
        const cpa = conversions > 0 ? spend / conversions : 0;
        const dailyBudget = (b.amountMicros || 0) / 1_000_000;

        // Health score
        let score = 50;
        if (m.impressions > 0) {
          let pts = 0, cnt = 0;
          if (ctr >= 0.05) pts += 100; else if (ctr >= 0.02) pts += 70; else if (ctr > 0) pts += 30; cnt++;
          if (cpc > 0 && cpc <= 3) pts += 100; else if (cpc <= 6) pts += 60; else if (cpc > 0) pts += 20; cnt++;
          if (roas >= 4) pts += 100; else if (roas >= 2) pts += 70; else if (roas > 0) pts += 40; if (roas > 0) cnt++;
          score = cnt > 0 ? Math.round(pts / cnt) : 50;
        }

        return {
          id: c.id, name: c.name, status: c.status,
          channel_type: c.advertisingChannelType,
          bidding_strategy: c.biddingStrategyType,
          daily_budget: dailyBudget,
          spend, impressions: m.impressions || 0, clicks: m.clicks || 0,
          ctr: Number((ctr * 100).toFixed(2)), cpc: Number(cpc.toFixed(2)),
          cpm: Number(cpm.toFixed(2)), conversions, revenue: Number(revenue.toFixed(2)),
          roas: Number(roas.toFixed(2)), cpa: Number(cpa.toFixed(2)),
          health_score: score,
        };
      });

      const overallHealth = campaigns.length > 0
        ? Math.round(campaigns.reduce((s: number, c: any) => s + c.health_score, 0) / campaigns.length)
        : 50;

      return new Response(JSON.stringify({
        platform: "google",
        account: { id: customerId, name: account.account_name, currency: account.currency || "BRL" },
        campaigns,
        health_score: overallHealth,
        date_range,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── Fetch ad groups for a campaign ──
    if (action === "get_ad_groups") {
      const adminClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      const { data: account } = await adminClient.from("ad_accounts").select("*")
        .eq("user_id", userId).eq("platform", "google").eq("is_active", true).limit(1).maybeSingle();
      if (!account) return new Response(JSON.stringify({ error: "Conta não encontrada" }), { status: 404, headers: corsHeaders });

      const creds = JSON.parse(account.access_token_encrypted);
      const accessToken = await getAccessToken(creds.client_id, creds.client_secret, creds.refresh_token);
      const { campaign_id, date_range = "LAST_30_DAYS" } = body;

      const gaql = `
        SELECT
          ad_group.id, ad_group.name, ad_group.status, ad_group.type,
          metrics.impressions, metrics.clicks, metrics.cost_micros,
          metrics.conversions, metrics.ctr, metrics.average_cpc
        FROM ad_group
        WHERE campaign.id = ${campaign_id}
          AND segments.date DURING ${date_range}
        ORDER BY metrics.cost_micros DESC
        LIMIT 30
      `;

      const res = await fetch(`${GOOGLE_ADS_API}/customers/${account.account_id}/googleAds:searchStream`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "developer-token": creds.developer_token,
          "login-customer-id": account.account_id,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query: gaql }),
      });
      const data = await res.json();

      const adGroups = (data[0]?.results || []).map((r: any) => ({
        id: r.adGroup?.id, name: r.adGroup?.name, status: r.adGroup?.status,
        type: r.adGroup?.type,
        impressions: r.metrics?.impressions || 0, clicks: r.metrics?.clicks || 0,
        spend: (r.metrics?.costMicros || 0) / 1_000_000,
        conversions: r.metrics?.conversions || 0,
        ctr: Number(((r.metrics?.ctr || 0) * 100).toFixed(2)),
        cpc: Number(((r.metrics?.averageCpc || 0) / 1_000_000).toFixed(2)),
      }));

      return new Response(JSON.stringify({ ad_groups: adGroups }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── Pause/Activate campaign ──
    if (action === "update_campaign_status") {
      const adminClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      const { data: account } = await adminClient.from("ad_accounts").select("*")
        .eq("user_id", userId).eq("platform", "google").eq("is_active", true).limit(1).maybeSingle();
      if (!account) return new Response(JSON.stringify({ error: "Conta não encontrada" }), { status: 404, headers: corsHeaders });

      const creds = JSON.parse(account.access_token_encrypted);
      const accessToken = await getAccessToken(creds.client_id, creds.client_secret, creds.refresh_token);
      const { campaign_id, new_status } = body; // ENABLED or PAUSED

      const mutateRes = await fetch(`${GOOGLE_ADS_API}/customers/${account.account_id}/campaigns:mutate`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "developer-token": creds.developer_token,
          "login-customer-id": account.account_id,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          operations: [{
            update: { resourceName: `customers/${account.account_id}/campaigns/${campaign_id}`, status: new_status },
            updateMask: "status",
          }],
        }),
      });
      const mutateData = await mutateRes.json();

      return new Response(JSON.stringify({ success: !mutateData.error, data: mutateData }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── Update campaign budget ──
    if (action === "update_budget") {
      const adminClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      const { data: account } = await adminClient.from("ad_accounts").select("*")
        .eq("user_id", userId).eq("platform", "google").eq("is_active", true).limit(1).maybeSingle();
      if (!account) return new Response(JSON.stringify({ error: "Conta não encontrada" }), { status: 404, headers: corsHeaders });

      const creds = JSON.parse(account.access_token_encrypted);
      const accessToken = await getAccessToken(creds.client_id, creds.client_secret, creds.refresh_token);
      const { budget_id, new_amount } = body; // new_amount in currency units

      const mutateRes = await fetch(`${GOOGLE_ADS_API}/customers/${account.account_id}/campaignBudgets:mutate`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "developer-token": creds.developer_token,
          "login-customer-id": account.account_id,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          operations: [{
            update: { resourceName: `customers/${account.account_id}/campaignBudgets/${budget_id}`, amountMicros: Math.round(new_amount * 1_000_000).toString() },
            updateMask: "amount_micros",
          }],
        }),
      });
      const mutateData = await mutateRes.json();

      return new Response(JSON.stringify({ success: !mutateData.error, data: mutateData }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
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
