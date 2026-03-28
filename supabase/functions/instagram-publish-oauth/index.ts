import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GRAPH_URL = 'https://graph.facebook.com/v18.0';

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // For callback action, there is no user auth (called by Facebook redirect)
    const url = new URL(req.url);
    const urlAction = url.searchParams.get('action');

    if (urlAction === 'callback') {
      const code = url.searchParams.get('code');
      const stateParam = url.searchParams.get('state');
      const error = url.searchParams.get('error');

      if (error) {
        return new Response(
          `<html><body><script>window.opener?.postMessage({type:'IG_PUBLISH_AUTH_ERROR',error:'${error}'},'*');window.close();</script></body></html>`,
          { headers: { 'Content-Type': 'text/html' } }
        );
      }

      if (!code || !stateParam) {
        return new Response('Parâmetros inválidos', { status: 400 });
      }

      let userId: string;
      try {
        const decoded = JSON.parse(atob(stateParam));
        userId = decoded.userId;
      } catch {
        return new Response('State inválido', { status: 400 });
      }

      const appId = Deno.env.get('META_APP_ID') ?? '';
      const appSecret = Deno.env.get('META_APP_SECRET') ?? '';
      const redirectUri = `${Deno.env.get('SUPABASE_URL')}/functions/v1/instagram-publish-oauth?action=callback`;

      // Exchange code for token
      const tokenRes = await fetch(
        `${GRAPH_URL}/oauth/access_token?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&client_secret=${appSecret}&code=${code}`
      );
      const tokenData = await tokenRes.json();
      if (tokenData.error) {
        return new Response(
          `<html><body><script>window.opener?.postMessage({type:'IG_PUBLISH_AUTH_ERROR',error:'${tokenData.error.message}'},'*');window.close();</script></body></html>`,
          { headers: { 'Content-Type': 'text/html' } }
        );
      }

      // Get long-lived token
      const longRes = await fetch(
        `${GRAPH_URL}/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${tokenData.access_token}`
      );
      const longData = await longRes.json();
      const accessToken = longData.access_token || tokenData.access_token;

      // Get Facebook Pages with Instagram Business Account
      const pagesRes = await fetch(
        `${GRAPH_URL}/me/accounts?fields=id,name,access_token,instagram_business_account{id,username,profile_picture_url}&access_token=${accessToken}`
      );
      const pagesData = await pagesRes.json();
      const pages = pagesData.data || [];

      // Find first page with Instagram Business Account
      const pageWithIG = pages.find((p: any) => p.instagram_business_account?.id);

      if (!pageWithIG) {
        return new Response(
          `<html><body><script>window.opener?.postMessage({type:'IG_PUBLISH_AUTH_ERROR',error:'Nenhuma conta Instagram Business encontrada. Certifique-se de que sua página do Facebook está conectada a uma conta Instagram Business.'},'*');window.close();</script></body></html>`,
          { headers: { 'Content-Type': 'text/html' } }
        );
      }

      const igAccount = pageWithIG.instagram_business_account;
      const pageAccessToken = pageWithIG.access_token || accessToken;

      // Save to connected_accounts
      await supabase
        .from('connected_accounts' as any)
        .upsert({
          user_id: userId,
          platform: 'instagram_publisher',
          account_id: igAccount.id,
          account_name: igAccount.username || `Instagram ${igAccount.id}`,
          access_token: pageAccessToken,
          extra_data: {
            username: igAccount.username,
            profile_picture_url: igAccount.profile_picture_url,
            page_id: pageWithIG.id,
            page_name: pageWithIG.name,
          },
        } as any, { onConflict: 'user_id,platform' });

      return new Response(
        `<html><body>
          <script>
            window.opener?.postMessage({
              type:'IG_PUBLISH_AUTH_SUCCESS',
              accountId:'${igAccount.id}',
              username:'${igAccount.username || igAccount.id}'
            },'*');
            window.close();
          </script>
          <p>Instagram Business conectado! Pode fechar esta janela.</p>
        </body></html>`,
        { headers: { 'Content-Type': 'text/html' } }
      );
    }

    // For all other actions, require auth
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('Não autorizado');
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) throw new Error('Token inválido');

    const body = await req.json();
    const { action } = body;

    // ── AUTHORIZE ────────────────────────────────────────────────────────────
    if (action === 'authorize') {
      const appId = Deno.env.get('META_APP_ID') ?? '';
      if (!appId) throw new Error('META_APP_ID não configurado no Supabase Secrets');

      const redirectUri = `${Deno.env.get('SUPABASE_URL')}/functions/v1/instagram-publish-oauth?action=callback`;
      const state = btoa(JSON.stringify({ userId: user.id, ts: Date.now() }));

      const scopes = [
        'instagram_basic',
        'instagram_content_publish',
        'pages_manage_posts',
        'pages_read_engagement',
        'pages_show_list',
      ].join(',');

      const authUrl = `https://www.facebook.com/v18.0/dialog/oauth?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scopes}&state=${state}&response_type=code`;

      return new Response(JSON.stringify({ auth_url: authUrl }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── DISCONNECT ───────────────────────────────────────────────────────────
    if (action === 'disconnect') {
      await supabase
        .from('connected_accounts' as any)
        .delete()
        .eq('user_id', user.id)
        .eq('platform', 'instagram_publisher');

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    throw new Error('Ação desconhecida');

  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
