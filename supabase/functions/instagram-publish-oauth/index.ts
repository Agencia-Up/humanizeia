import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const META_APP_ID     = Deno.env.get('META_APP_ID') ?? '';
const META_APP_SECRET = Deno.env.get('META_APP_SECRET') ?? '';
const SUPABASE_URL    = Deno.env.get('SUPABASE_URL') ?? '';
const REDIRECT_URI    = 'https://seyljsqmhlopkcauhlor.supabase.co/functions/v1/instagram-publish-oauth';
const GRAPH           = 'https://graph.facebook.com/v21.0';

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabase = createClient(
    SUPABASE_URL,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  try {
    const url = new URL(req.url);

    // ── CALLBACK do Facebook OAuth (GET ?code=...) ─────────────────────────────
    if (req.method === 'GET' && url.searchParams.has('code')) {
      const code      = url.searchParams.get('code')!;
      const stateRaw  = url.searchParams.get('state') ?? '';
      const errorCode = url.searchParams.get('error');

      let userId = '';
      let origin = 'https://logosiabrasil.com'; // Domínio Oficial Atualizado
      
      try { 
        const parsedState = JSON.parse(atob(stateRaw));
        userId = parsedState.userId; 
        if (parsedState.origin) origin = parsedState.origin;
      } catch (_) {}

      // Função helper para voltar ao app mostrando erro
      const redirectError = (msg: string) => 
        Response.redirect(`${origin}/integrations?ig_error=true&msg=${encodeURIComponent(msg)}`, 302);

      if (errorCode) {
        const desc = url.searchParams.get('error_description') ?? errorCode;
        return redirectError(desc);
      }

      // 1. Troca code por short-lived token
      const tokenRes  = await fetch(
        `${GRAPH}/oauth/access_token?client_id=${META_APP_ID}&client_secret=${META_APP_SECRET}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&code=${encodeURIComponent(code)}`
      );
      const tokenData = await tokenRes.json();

      if (tokenData.error || !tokenData.access_token) {
        const msg = tokenData.error?.message ?? 'Erro ao trocar código';
        return redirectError(msg);
      }

      const shortToken = tokenData.access_token;

      // 2. Troca por long-lived token (60 dias)
      const longRes  = await fetch(
        `${GRAPH}/oauth/access_token?grant_type=fb_exchange_token&client_id=${META_APP_ID}&client_secret=${META_APP_SECRET}&fb_exchange_token=${encodeURIComponent(shortToken)}`
      );
      const longData = await longRes.json();
      const token     = longData.access_token ?? shortToken;
      const expiresIn = longData.expires_in ?? 5184000;

      // 3. Busca conta Instagram vinculada às páginas do Facebook
      const pagesRes  = await fetch(
        `${GRAPH}/me/accounts?fields=id,name,instagram_business_account%7Bid,username,name,profile_picture_url%7D&access_token=${token}`
      );
      const pagesData = await pagesRes.json();

      let igUserId = '';
      let username  = '';
      let picUrl    = '';

      for (const page of (pagesData.data ?? [])) {
        const iga = page.instagram_business_account;
        if (iga?.id) {
          igUserId = iga.id;
          username  = iga.username ?? iga.name ?? 'instagram';
          picUrl    = iga.profile_picture_url ?? '';
          break;
        }
      }

      // Fallback: usa dados do próprio usuário Facebook
      if (!igUserId) {
        const meRes  = await fetch(`${GRAPH}/me?fields=id,name&access_token=${token}`);
        const meData = await meRes.json();
        igUserId = meData.id   ?? '';
        username  = meData.name ?? 'instagram';
      }

      // 4. Salva no Supabase
      if (userId) {
        await supabase.from('connected_accounts' as any).upsert({
          user_id:                userId,
          platform:               'instagram_publisher',
          account_id:             igUserId,
          account_name:           username,
          access_token_encrypted: token,
          extra_data: {
            ig_user_id:          igUserId,
            username,
            profile_picture_url: picUrl,
            expires_in:          expiresIn,
            connected_at:        new Date().toISOString(),
          },
          connected_at: new Date().toISOString(),
        }, { onConflict: 'user_id,platform' });
      }

      // RETORNO SUAVE PARA O FRONTEND REACT (! Bypass de Deno HTML Proxy bug !)
      return Response.redirect(`${origin}/integrations?ig_success=true&username=${encodeURIComponent(username || 'instagram')}`, 302);
    }

    // ── AÇÕES VIA POST (chamadas do frontend) ──────────────────────────────────
    const authHeader = req.headers.get('Authorization') ?? '';
    const userToken  = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authErr } = await supabase.auth.getUser(userToken);
    if (authErr || !user) throw new Error('Sessão inválida. Faça login novamente.');

    const body   = await req.json();
    const action = body.action as string;

    // ── authorize ─────────────────────────────────────────────────────────────
    if (action === 'authorize') {
      if (!META_APP_ID) throw new Error('META_APP_ID não configurado. Adicione no Supabase Secrets.');

      // Importante: Salvamos a origin do React App no STATE para re-roteamento
      const origin = body.origin || 'https://logosiabrasil.com';
      const state  = btoa(JSON.stringify({ userId: user.id, ts: Date.now(), origin }));
      
      const scopes = [
        'instagram_basic',
        'instagram_content_publish',
        'pages_show_list',
        'pages_read_engagement',
      ].join(',');

      const authUrl = `https://www.facebook.com/v21.0/dialog/oauth?client_id=${META_APP_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=${scopes}&response_type=code&state=${state}`;

      return new Response(JSON.stringify({ auth_url: authUrl }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── disconnect ────────────────────────────────────────────────────────────
    if (action === 'disconnect') {
      await supabase.from('connected_accounts' as any)
        .delete()
        .eq('user_id', user.id)
        .eq('platform', 'instagram_publisher');

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── refresh_token ─────────────────────────────────────────────────────────
    if (action === 'refresh_token') {
      const { data: acct } = await supabase.from('connected_accounts' as any)
        .select('access_token_encrypted')
        .eq('user_id', user.id)
        .eq('platform', 'instagram_publisher')
        .single();

      if (!acct) throw new Error('Conta Instagram não conectada');
      const oldToken = (acct as any).access_token_encrypted;

      const refreshRes  = await fetch(
        `${GRAPH}/oauth/access_token?grant_type=fb_exchange_token&client_id=${META_APP_ID}&client_secret=${META_APP_SECRET}&fb_exchange_token=${encodeURIComponent(oldToken)}`
      );
      const refreshData = await refreshRes.json();
      if (!refreshData.access_token) throw new Error('Erro ao renovar token');

      await supabase.from('connected_accounts' as any)
        .update({ access_token_encrypted: refreshData.access_token, connected_at: new Date().toISOString() })
        .eq('user_id', user.id)
        .eq('platform', 'instagram_publisher');

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    throw new Error('Ação desconhecida: ' + action);

  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
