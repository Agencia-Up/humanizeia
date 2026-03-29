import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const IG_APP_ID     = Deno.env.get('INSTAGRAM_APP_ID') ?? '';
const IG_APP_SECRET = Deno.env.get('INSTAGRAM_APP_SECRET') ?? '';
const SUPABASE_URL  = Deno.env.get('SUPABASE_URL') ?? '';
const REDIRECT_URI  = `${SUPABASE_URL}/functions/v1/instagram-publish-oauth`;

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabase = createClient(
    SUPABASE_URL,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  try {
    const url = new URL(req.url);

    // ── CALLBACK do Instagram (GET com ?code=...) ─────────────────────────────
    if (req.method === 'GET' && url.searchParams.get('code')) {
      const code      = url.searchParams.get('code')!;
      const stateRaw  = url.searchParams.get('state') ?? '';
      const errorCode = url.searchParams.get('error');

      if (errorCode) {
        const desc = url.searchParams.get('error_description') ?? errorCode;
        return htmlClose('IG_PUBLISH_AUTH_ERROR', null, desc);
      }

      let userId = '';
      try { userId = JSON.parse(atob(stateRaw)).userId; } catch (_) {}

      // 1. Troca code por short-lived token
      const tokenForm = new URLSearchParams({
        client_id:     IG_APP_ID,
        client_secret: IG_APP_SECRET,
        grant_type:    'authorization_code',
        redirect_uri:  REDIRECT_URI,
        code,
      });

      const shortRes  = await fetch('https://api.instagram.com/oauth/access_token', {
        method: 'POST',
        body: tokenForm,
      });
      const shortData = await shortRes.json();

      if (shortData.error_type || !shortData.access_token) {
        return htmlClose('IG_PUBLISH_AUTH_ERROR', null, shortData.error_message ?? 'Erro ao trocar código');
      }

      const shortToken = shortData.access_token;
      const igUserId   = shortData.user_id;

      // 2. Troca por long-lived token (60 dias)
      const longRes  = await fetch(
        `https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=${IG_APP_SECRET}&access_token=${shortToken}`
      );
      const longData = await longRes.json();
      const token    = longData.access_token || shortToken;
      const expiresIn = longData.expires_in ?? 5184000;

      // 3. Busca dados do perfil
      const profileRes = await fetch(
        `https://graph.instagram.com/me?fields=id,username,account_type,profile_picture_url&access_token=${token}`
      );
      const profile  = await profileRes.json();
      const username = profile.username ?? 'instagram';

      // 4. Salva no Supabase
      if (userId) {
        await supabase.from('connected_accounts' as any).upsert({
          user_id:   userId,
          platform:  'instagram_publisher',
          account_id: String(igUserId),
          account_name: username,
          access_token_encrypted: token,
          extra_data: {
            ig_user_id: String(igUserId),
            username,
            account_type: profile.account_type,
            profile_picture_url: profile.profile_picture_url,
            expires_in: expiresIn,
            connected_at: new Date().toISOString(),
          },
          connected_at: new Date().toISOString(),
        }, { onConflict: 'user_id,platform' });
      }

      return htmlClose('IG_PUBLISH_AUTH_SUCCESS', username, null);
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
      if (!IG_APP_ID) throw new Error('INSTAGRAM_APP_ID não configurado. Contate o suporte.');

      const state  = btoa(JSON.stringify({ userId: user.id, ts: Date.now() }));
      const scopes = [
        'instagram_basic',
        'instagram_content_publish',
        'instagram_manage_insights',
        'instagram_manage_comments',
      ].join(',');

      const authUrl = `https://api.instagram.com/oauth/authorize?client_id=${IG_APP_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=${scopes}&response_type=code&state=${state}`;

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
        `https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${oldToken}`
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

// Fecha o popup enviando postMessage para o frontend
function htmlClose(type: string, username: string | null, error: string | null) {
  const payload = username
    ? `{type:'${type}',username:'${username}'}`
    : `{type:'${type}',error:'${(error ?? '').replace(/'/g, "\\'")}'}`;

  return new Response(
    `<!DOCTYPE html><html><body><script>
      try { window.opener?.postMessage(${payload}, '*'); } catch(e) {}
      setTimeout(() => window.close(), 500);
    </script><p>Conectando...</p></body></html>`,
    { headers: { 'Content-Type': 'text/html' } }
  );
}
