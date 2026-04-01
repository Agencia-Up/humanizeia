/**
 * instagram-publish-oauth
 * Fluxo OAuth2 via Facebook Login para obter acesso à Instagram Graph API.
 * Usa META_APP_ID + META_APP_SECRET (já configurados no Supabase).
 * Após autorização, busca o Instagram Business Account vinculado às Páginas do Facebook.
 */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const META_APP_ID     = Deno.env.get('META_APP_ID')     ?? '';
const META_APP_SECRET = Deno.env.get('META_APP_SECRET') ?? '';
const SUPABASE_URL    = Deno.env.get('SUPABASE_URL')    ?? '';

// URI registrada em: Facebook Login → Configurações → URIs de redirecionamento OAuth válidos
const REDIRECT_URI = 'https://seyljsqmhlopkcauhlor.supabase.co/functions/v1/instagram-publish-oauth';
const GRAPH        = 'https://graph.facebook.com/v21.0';

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabase = createClient(
    SUPABASE_URL,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  try {
    const url = new URL(req.url);

    // ──────────────────────────────────────────────────────────────────────────
    // CALLBACK — Facebook redireciona aqui com ?code=... após autorização
    // ──────────────────────────────────────────────────────────────────────────
    if (req.method === 'GET' && url.searchParams.has('code')) {
      const code      = url.searchParams.get('code')!;
      const stateRaw  = url.searchParams.get('state') ?? '';
      const errorCode = url.searchParams.get('error');

      if (errorCode) {
        const desc = url.searchParams.get('error_description') ?? errorCode;
        console.error('[IG-OAuth] Usuário recusou autorização:', desc);
        return htmlPage('error', null, `Autorização recusada: ${desc}`);
      }

      // Recupera userId do state
      let userId = '';
      try { userId = JSON.parse(atob(stateRaw)).userId; } catch (_) {}

      console.log('[IG-OAuth] Código recebido. userId:', userId || '(não encontrado)');

      // ── 1. Troca code por short-lived User Access Token ──────────────────
      const tokenRes  = await fetch(
        `${GRAPH}/oauth/access_token?` +
        `client_id=${META_APP_ID}` +
        `&client_secret=${META_APP_SECRET}` +
        `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
        `&code=${encodeURIComponent(code)}`
      );
      const tokenData = await tokenRes.json();

      if (!tokenData.access_token) {
        const err = tokenData.error?.message ?? JSON.stringify(tokenData);
        console.error('[IG-OAuth] Erro na troca de código:', err);
        return htmlPage('error', null, `Erro ao obter token: ${err}`);
      }

      const shortToken = tokenData.access_token;
      console.log('[IG-OAuth] Short-lived token obtido.');

      // ── 2. Troca por Long-Lived Token (60 dias) ───────────────────────────
      const longRes  = await fetch(
        `${GRAPH}/oauth/access_token?` +
        `grant_type=fb_exchange_token` +
        `&client_id=${META_APP_ID}` +
        `&client_secret=${META_APP_SECRET}` +
        `&fb_exchange_token=${encodeURIComponent(shortToken)}`
      );
      const longData  = await longRes.json();
      const userToken = longData.access_token ?? shortToken;
      const expiresIn = longData.expires_in   ?? 5184000; // 60 dias em segundos
      console.log('[IG-OAuth] Long-lived token obtido. expires_in:', expiresIn);

      // ── 3. Busca Páginas e Instagram Business Account vinculado ───────────
      const pagesRes  = await fetch(
        `${GRAPH}/me/accounts?` +
        `fields=id,name,access_token,instagram_business_account{id,username,name,profile_picture_url,followers_count,account_type}` +
        `&access_token=${userToken}`
      );
      const pagesData = await pagesRes.json();

      let igAccountId  = '';
      let igUsername   = '';
      let igPicture    = '';
      let pageToken    = '';  // Page Access Token (não expira)
      let pageName     = '';

      for (const page of (pagesData.data ?? [])) {
        if (page.instagram_business_account?.id) {
          igAccountId = page.instagram_business_account.id;
          igUsername  = page.instagram_business_account.username ?? page.instagram_business_account.name ?? 'instagram';
          igPicture   = page.instagram_business_account.profile_picture_url ?? '';
          pageToken   = page.access_token ?? userToken;
          pageName    = page.name ?? '';
          break;
        }
      }

      if (!igAccountId) {
        console.warn('[IG-OAuth] Nenhum Instagram Business Account encontrado nas páginas.');
        // Salva mesmo sem IG Business Account para não bloquear o fluxo
        // (usuário pode não ter conta Business ainda)
      }

      console.log('[IG-OAuth] Instagram Business ID:', igAccountId || 'não encontrado');

      // ── 4. Salva no Supabase (connected_accounts) ─────────────────────────
      if (userId) {
        const { error: upsertErr } = await supabase
          .from('connected_accounts' as any)
          .upsert({
            user_id:                userId,
            platform:               'instagram_publisher',
            account_id:             igAccountId || userId, // fallback para userId
            account_name:           igUsername  || 'Instagram',
            access_token_encrypted: userToken,
            extra_data: {
              ig_user_id:          igAccountId,
              username:            igUsername,
              profile_picture_url: igPicture,
              page_token:          pageToken,   // usado para publicação
              page_name:           pageName,
              expires_in:          expiresIn,
              has_business_account: !!igAccountId,
              connected_at:        new Date().toISOString(),
            },
            connected_at: new Date().toISOString(),
          }, { onConflict: 'user_id,platform' });

        if (upsertErr) {
          console.error('[IG-OAuth] Erro ao salvar no Supabase:', upsertErr.message);
        } else {
          console.log('[IG-OAuth] Conexão salva com sucesso.');
        }
      }

      return htmlPage('success', igUsername || 'Instagram', null);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // AÇÕES VIA POST — chamadas do frontend
    // ──────────────────────────────────────────────────────────────────────────
    const authHeader = req.headers.get('Authorization') ?? '';
    const userJwt    = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authErr } = await supabase.auth.getUser(userJwt);
    if (authErr || !user) throw new Error('Sessão inválida. Faça login novamente.');

    const body   = await req.json();
    const action = body.action as string;

    // ── authorize — retorna a URL de autorização Facebook OAuth ──────────────
    if (action === 'authorize') {
      if (!META_APP_ID) throw new Error('META_APP_ID não configurado no Supabase.');

      const state  = btoa(JSON.stringify({ userId: user.id, ts: Date.now() }));
      const scopes = [
        'instagram_basic',
        'instagram_content_publish',
        'pages_read_engagement',
        'pages_show_list',
        'business_management',
      ].join(',');

      const authUrl =
        `https://www.facebook.com/v21.0/dialog/oauth` +
        `?client_id=${META_APP_ID}` +
        `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
        `&scope=${scopes}` +
        `&response_type=code` +
        `&state=${state}`;

      return new Response(JSON.stringify({ auth_url: authUrl }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── disconnect — remove a conexão ─────────────────────────────────────────
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

    // ── refresh_token — renova o token (Long-Lived dura 60 dias) ─────────────
    if (action === 'refresh_token') {
      const { data: acct } = await supabase
        .from('connected_accounts' as any)
        .select('access_token_encrypted')
        .eq('user_id', user.id)
        .eq('platform', 'instagram_publisher')
        .single();

      if (!acct) throw new Error('Conta Instagram não conectada.');
      const oldToken = (acct as any).access_token_encrypted;

      const refreshRes  = await fetch(
        `${GRAPH}/oauth/access_token?` +
        `grant_type=fb_exchange_token` +
        `&client_id=${META_APP_ID}` +
        `&client_secret=${META_APP_SECRET}` +
        `&fb_exchange_token=${encodeURIComponent(oldToken)}`
      );
      const refreshData = await refreshRes.json();
      if (!refreshData.access_token) throw new Error('Erro ao renovar token: ' + JSON.stringify(refreshData));

      await supabase
        .from('connected_accounts' as any)
        .update({
          access_token_encrypted: refreshData.access_token,
          connected_at: new Date().toISOString(),
        })
        .eq('user_id', user.id)
        .eq('platform', 'instagram_publisher');

      return new Response(JSON.stringify({ success: true, expires_in: refreshData.expires_in }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── get_account — retorna dados da conta conectada ───────────────────────
    if (action === 'get_account') {
      const { data: acct } = await supabase
        .from('connected_accounts' as any)
        .select('*')
        .eq('user_id', user.id)
        .eq('platform', 'instagram_publisher')
        .single();

      return new Response(JSON.stringify({ account: acct }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    throw new Error('Ação desconhecida: ' + action);

  } catch (err: any) {
    console.error('[IG-OAuth] Erro:', err.message);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

/**
 * Renderiza uma página HTML no popup.
 * Em sucesso: envia postMessage e fecha o popup.
 * Em erro: exibe mensagem legível e botão para fechar.
 */
function htmlPage(type: 'success' | 'error', username: string | null, error: string | null) {
  if (type === 'error') {
    const safeMsg = (error ?? 'Erro desconhecido').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return new Response(
      `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="utf-8"><title>Erro — Instagram</title></head>
<body style="background:#0f0f0f;color:#ff6b6b;font-family:monospace;padding:32px;max-width:600px;margin:auto;">
  <h2>❌ Falha ao conectar Instagram</h2>
  <pre style="background:#1a1a1a;padding:16px;border-radius:8px;word-break:break-all;">${safeMsg}</pre>
  <button onclick="window.close()" style="margin-top:16px;padding:8px 24px;background:#333;color:#fff;border:none;border-radius:6px;cursor:pointer;">
    Fechar
  </button>
</body>
</html>`,
      { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  }

  // Sucesso: envia postMessage e fecha o popup
  const safeUsername = (username ?? 'instagram').replace(/'/g, "\\'");
  return new Response(
    `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="utf-8"><title>Conectado!</title></head>
<body style="background:#0f0f0f;color:#4ade80;font-family:sans-serif;padding:32px;text-align:center;">
  <h2>✅ Instagram conectado!</h2>
  <p>@${safeUsername}</p>
  <p style="color:#888;font-size:14px;">Esta janela fechará automaticamente…</p>
  <script>
    (function() {
      try {
        if (window.opener && !window.opener.closed) {
          window.opener.postMessage(
            { type: 'IG_PUBLISH_AUTH_SUCCESS', username: '${safeUsername}' },
            '*'
          );
        }
      } catch(e) { console.warn('postMessage error:', e); }
      setTimeout(function() { window.close(); }, 1500);
    })();
  </script>
</body>
</html>`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
}
