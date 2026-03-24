import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const LINKEDIN_AUTH_URL = 'https://www.linkedin.com/oauth/v2/authorization';
const LINKEDIN_TOKEN_URL = 'https://www.linkedin.com/oauth/v2/accessToken';
const SCOPES = ['r_ads', 'r_ads_reporting', 'rw_ads', 'r_basicprofile', 'r_emailaddress'].join(' ');

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const action = url.searchParams.get('action') || (await req.json().catch(() => ({}))).action;

  const clientId = Deno.env.get('LINKEDIN_CLIENT_ID') ?? '';
  const clientSecret = Deno.env.get('LINKEDIN_CLIENT_SECRET') ?? '';
  const redirectUri = `${Deno.env.get('SUPABASE_URL')}/functions/v1/linkedin-ads-oauth?action=callback`;

  // ── AUTHORIZE ─────────────────────────────────────────────────────────────
  if (action === 'authorize') {
    const body = await req.json().catch(() => ({}));
    const userId = body.user_id;
    const state = btoa(JSON.stringify({ userId, ts: Date.now() }));

    const authUrl = new URL(LINKEDIN_AUTH_URL);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('scope', SCOPES);

    return new Response(JSON.stringify({ auth_url: authUrl.toString() }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // ── CALLBACK ──────────────────────────────────────────────────────────────
  if (action === 'callback') {
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const error = url.searchParams.get('error');

    if (error) {
      return new Response(`<html><body><script>window.opener?.postMessage({type:'LINKEDIN_AUTH_ERROR',error:'${error}'},'*');window.close();</script></body></html>`, {
        headers: { 'Content-Type': 'text/html' },
      });
    }

    if (!code || !state) {
      return new Response('Parâmetros inválidos', { status: 400 });
    }

    let userId: string;
    try {
      const decoded = JSON.parse(atob(state));
      userId = decoded.userId;
    } catch {
      return new Response('State inválido', { status: 400 });
    }

    // Exchange code for tokens
    const tokenRes = await fetch(LINKEDIN_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });

    const tokens = await tokenRes.json();
    if (!tokens.access_token) {
      return new Response(`<html><body><script>window.opener?.postMessage({type:'LINKEDIN_AUTH_ERROR',error:'Token inválido'},'*');window.close();</script></body></html>`, {
        headers: { 'Content-Type': 'text/html' },
      });
    }

    // Get profile info
    const profileRes = await fetch('https://api.linkedin.com/v2/me', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const profile = await profileRes.json();

    // Get ad accounts
    const accountsRes = await fetch('https://api.linkedin.com/v2/adAccountsV2?q=search&search.status.values[0]=ACTIVE&count=10', {
      headers: { Authorization: `Bearer ${tokens.access_token}`, 'LinkedIn-Version': '202304' },
    });
    const accountsData = await accountsRes.json();
    const firstAccount = accountsData.elements?.[0];

    if (!firstAccount) {
      return new Response(`<html><body><script>window.opener?.postMessage({type:'LINKEDIN_AUTH_ERROR',error:'Nenhuma conta de anúncios encontrada'},'*');window.close();</script></body></html>`, {
        headers: { 'Content-Type': 'text/html' },
      });
    }

    const accountId = String(firstAccount.id);
    const expiresAt = new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString();

    // Save to DB
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    await supabase.from('connected_accounts').upsert({
      user_id: userId,
      platform: 'linkedin',
      account_id: accountId,
      account_name: firstAccount.name || `Conta LinkedIn ${accountId}`,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token || null,
      expires_at: expiresAt,
      extra_data: { profile_id: profile.id, profile_name: `${profile.localizedFirstName} ${profile.localizedLastName}` },
    }, { onConflict: 'user_id,platform' });

    return new Response(`
      <html><body>
        <script>
          window.opener?.postMessage({type:'LINKEDIN_AUTH_SUCCESS',accountId:'${accountId}',accountName:'${firstAccount.name}'},'*');
          window.close();
        </script>
        <p>Conta LinkedIn conectada com sucesso! Pode fechar esta janela.</p>
      </body></html>
    `, { headers: { 'Content-Type': 'text/html' } });
  }

  return new Response(JSON.stringify({ error: 'Ação desconhecida' }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status: 400,
  });
});
