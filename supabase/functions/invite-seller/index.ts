// ─── Inline PostgREST client (no external imports) ──────────────────────────
function createSupabaseClient(url: string, key: string) {
  const restBase = `${url}/rest/v1`;
  const baseHeaders: Record<string, string> = {
    'apikey': key,
    'Authorization': `Bearer ${key}`,
    'Content-Type': 'application/json',
  };

  type FilterEntry = { col: string; op: string; val: string };

  function buildQuery(table: string) {
    let _select: string | null = null;
    let _filters: FilterEntry[] = [];
    let _limit: number | null = null;
    let _maybeSingle = false;
    let _body: any = null;
    let _method: 'GET' | 'POST' | 'PATCH' = 'GET';
    let _returnSelect: string | null = null;

    const builder = {
      select(cols?: string) {
        if (_method === 'PATCH') {
          _returnSelect = cols || '*';
          return builder;
        }
        _select = cols || '*';
        return builder;
      },
      eq(col: string, val: any) {
        _filters.push({ col, op: 'eq', val: String(val) });
        return builder;
      },
      limit(n: number) {
        _limit = n;
        return builder;
      },
      maybeSingle() {
        _maybeSingle = true;
        return builder._execute();
      },
      single() {
        _maybeSingle = true;
        return builder._execute();
      },
      update(data: any) {
        _method = 'PATCH';
        _body = data;
        return builder;
      },
      insert(data: any) {
        _method = 'POST';
        _body = data;
        return builder._execute();
      },
      then(resolve: (v: any) => void, reject?: (e: any) => void) {
        return builder._execute().then(resolve, reject);
      },
      async _execute(): Promise<{ data: any; error: any }> {
        const params = new URLSearchParams();

        const selectVal = _method === 'PATCH' ? (_returnSelect || undefined) : (_select || '*');
        if (selectVal) params.set('select', selectVal);

        for (const f of _filters) {
          params.append(f.col, `${f.op}.${f.val}`);
        }

        if (_limit !== null) {
          params.set('limit', String(_limit));
        }

        const queryStr = params.toString();
        const urlStr = `${restBase}/${table}${queryStr ? '?' + queryStr : ''}`;

        const headers: Record<string, string> = { ...baseHeaders };

        if (_method === 'PATCH' && _returnSelect) {
          headers['Prefer'] = 'return=representation';
        }
        if (_method === 'POST') {
          headers['Prefer'] = 'return=minimal';
        }
        if (_maybeSingle) {
          headers['Accept'] = 'application/vnd.pgrst.object+json';
        }

        try {
          const res = await fetch(urlStr, {
            method: _method,
            headers,
            body: _body ? JSON.stringify(_body) : undefined,
          });

          if (_maybeSingle && res.status === 406) {
            return { data: null, error: null };
          }

          if (!res.ok) {
            const errBody = await res.text();
            return { data: null, error: { message: errBody, status: res.status } };
          }

          if (_method === 'POST' && !_returnSelect) {
            return { data: null, error: null };
          }

          const contentType = res.headers.get('content-type') || '';
          if (!contentType.includes('json')) {
            return { data: null, error: null };
          }

          const data = await res.json();
          return { data, error: null };
        } catch (err: any) {
          return { data: null, error: { message: err.message } };
        }
      },
    };

    return builder;
  }

  return {
    from(table: string) {
      return buildQuery(table);
    },
  };
}

// ─── GoTrue Auth API helpers (no external imports) ──────────────────────────
// These call the Supabase GoTrue endpoints directly via fetch.

async function authGetUser(supabaseUrl: string, apiKey: string, accessToken: string): Promise<{ user: any | null; error: any }> {
  try {
    const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: {
        'apikey': apiKey,
        'Authorization': `Bearer ${accessToken}`,
      },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: 'Auth error' }));
      return { user: null, error: err };
    }
    const user = await res.json();
    return { user, error: null };
  } catch (err: any) {
    return { user: null, error: { message: err.message } };
  }
}

async function authAdminCreateUser(
  supabaseUrl: string,
  serviceKey: string,
  email: string,
  metadata: Record<string, any>,
): Promise<{ data: any; error: any }> {
  try {
    // Cria usuario via Admin API SEM enviar email padrao do Supabase.
    // O email sera enviado via Resend com o link gerado por generate_link.
    const res = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
      method: 'POST',
      headers: {
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email,
        email_confirm: false,
        user_metadata: metadata,
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { data: null, error: { message: body.message || body.msg || 'Create user failed', status: res.status } };
    }
    return { data: { user: body }, error: null };
  } catch (err: any) {
    return { data: null, error: { message: err.message } };
  }
}

async function authAdminDeleteUser(
  supabaseUrl: string,
  serviceKey: string,
  userId: string,
): Promise<{ ok: boolean; error: any }> {
  try {
    const res = await fetch(`${supabaseUrl}/auth/v1/admin/users/${userId}`, {
      method: 'DELETE',
      headers: {
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
      },
    });
    if (!res.ok && res.status !== 404) {
      const body = await res.json().catch(() => ({}));
      return { ok: false, error: { message: body.message || body.msg || `DELETE user failed (${res.status})` } };
    }
    return { ok: true, error: null };
  } catch (err: any) {
    return { ok: false, error: { message: err.message } };
  }
}

async function authAdminListUsers(
  supabaseUrl: string,
  serviceKey: string,
  perPage: number = 1000
): Promise<{ users: any[]; error: any }> {
  try {
    const res = await fetch(`${supabaseUrl}/auth/v1/admin/users?per_page=${perPage}`, {
      headers: {
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
      },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: 'List users failed' }));
      return { users: [], error: err };
    }
    const body = await res.json();
    // GoTrue returns { users: [...] }
    return { users: body.users || [], error: null };
  } catch (err: any) {
    return { users: [], error: { message: err.message } };
  }
}

async function authAdminGenerateLink(
  supabaseUrl: string,
  serviceKey: string,
  type: string,
  email: string,
  redirectTo: string
): Promise<{ data: any; error: any; rawResponse?: any; status?: number }> {
  try {
    const res = await fetch(`${supabaseUrl}/auth/v1/admin/generate_link`, {
      method: 'POST',
      headers: {
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type,
        email,
        redirect_to: redirectTo,
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        data: null,
        error: { message: body.message || body.error_description || body.error || 'Generate link failed', code: body.error_code || body.code, status: res.status },
        rawResponse: body,
        status: res.status,
      };
    }
    // GoTrue returns action_link at top level (NOT inside properties)
    const actionLink = body.action_link || body.properties?.action_link || null;
    console.log(`[invite-seller] generate_link type=${type} status=${res.status} response keys: ${Object.keys(body).join(',')}, action_link: ${actionLink ? actionLink.substring(0, 80) + '...' : 'NONE'}`);
    return { data: { action_link: actionLink, ...body }, error: null, rawResponse: body, status: res.status };
  } catch (err: any) {
    return { data: null, error: { message: err.message }, rawResponse: null };
  }
}

// ─── CORS headers ───────────────────────────────────────────────────────────
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ─── Main handler ────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const supabase = createSupabaseClient(supabaseUrl, serviceKey);

    // Verify the caller's identity via GoTrue
    const userToken = authHeader.split(' ')[1];
    const { user: userData, error: userError } = await authGetUser(supabaseUrl, serviceKey, userToken);
    if (userError || !userData) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const masterUserId = userData.id;

    const { memberId, email } = await req.json();
    if (!memberId || !email) {
      return new Response(JSON.stringify({ error: 'memberId and email required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Verify member belongs to this master
    const { data: member, error: memberErr } = await supabase
      .from('ai_team_members')
      .select('id,name,email,auth_user_id,whatsapp_number')
      .eq('id', memberId)
      .eq('user_id', masterUserId)
      .single();

    if (memberErr || !member) {
      return new Response(JSON.stringify({ error: 'Member not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Dominio canonico do app (Site URL allowlisted). O link do e-mail SEMPRE
    // aponta pra ca, onde mora o ConfirmEmail — independente da origem do master.
    const APP_BASE_URL = 'https://logosiabrasil.com';
    const origin = req.headers.get('origin') || APP_BASE_URL;
    const redirectTo = `${APP_BASE_URL}/auth/confirm`;

    // Step 1: Create user via Admin API (does NOT send default Supabase email)
    const userMetadata = { full_name: member.name, role: 'seller', master_user_id: masterUserId };
    const { data: createData, error: createErr } = await authAdminCreateUser(
      supabaseUrl,
      serviceKey,
      email,
      userMetadata,
    );

    let authUserId: string | null = null;

    if (createErr) {
      // User might already exist — find them
      const alreadyExists = createErr.message?.toLowerCase().includes('already') || createErr.status === 422;
      if (alreadyExists) {
        const { users } = await authAdminListUsers(supabaseUrl, serviceKey, 1000);
        const existingUser = users.find((u: any) => u.email?.toLowerCase() === email.toLowerCase());
        if (existingUser) {
          // FIX 28/05/2026: Detecta state TRAVADO (user existe mas nunca confirmou
          // o invite) e auto-recupera DELETANDO o user via Admin API + RECRIANDO
          // fresh. GoTrue nao regenera token de invite pra users ja "invited"
          // mas nao confirmados — fica preso retornando action_link sem token.
          // Solucao: clean slate antes de tentar generate_link.
          const isStuck = !existingUser.email_confirmed_at && !existingUser.last_sign_in_at;
          if (isStuck) {
            console.log(`[invite-seller] User ${email} (${existingUser.id}) em estado TRAVADO (invited mas nao confirmado, never_logged). Deletando e recriando fresh.`);
            const { ok: delOk, error: delErr } = await authAdminDeleteUser(supabaseUrl, serviceKey, existingUser.id);
            if (!delOk) {
              console.error('[invite-seller] Falha ao deletar user travado:', delErr?.message);
              throw new Error(`Falha ao recuperar user travado: ${delErr?.message || 'unknown'}`);
            }
            // Recria fresh
            const retry = await authAdminCreateUser(supabaseUrl, serviceKey, email, userMetadata);
            if (retry.error) {
              console.error('[invite-seller] Falha ao recriar user apos delete:', retry.error.message);
              throw new Error(`Falha ao recriar user fresh: ${retry.error.message}`);
            }
            authUserId = retry.data?.user?.id || null;
            if (!authUserId) throw new Error('Recriacao nao retornou novo authUserId');
            await supabase.from('ai_team_members')
              .update({ email, auth_user_id: authUserId })
              .eq('id', memberId);
            console.log(`[invite-seller] User ${email} recriado fresh: ${authUserId}`);
          } else {
            // User existe e ja confirmou/logou — reusa pra tentativa de recovery/magiclink
            authUserId = existingUser.id;
            await supabase.from('ai_team_members')
              .update({ email, auth_user_id: existingUser.id })
              .eq('id', memberId);
            console.log(`[invite-seller] User ${email} existe e ja confirmou — reusando ${authUserId}`);
          }
        } else {
          console.error('[invite-seller] User reportedly exists but not found in list');
          throw new Error('User creation conflict — please try again');
        }
      } else {
        console.error('[invite-seller] authAdminCreateUser failed:', createErr.message);
        throw new Error(createErr.message || 'Failed to create user');
      }
    } else {
      // New user created successfully
      authUserId = createData?.user?.id || null;
      if (authUserId) {
        await supabase.from('ai_team_members')
          .update({ email, auth_user_id: authUserId })
          .eq('id', memberId);
      }
      console.log(`[invite-seller] User ${email} created: ${authUserId}`);
    }

    // Step 2: Gera link de confirmação com tipo CORRETO baseado no estado do user.
    // BUG ANTIGO (corrigido): tentava só 'invite'. Pra users já confirmados, generate_link
    // falhava silenciosamente, confirmUrl ficava igual ao redirectTo (sem token), email saia
    // com URL quebrada e vendedor caia em "Falha na confirmação — Link inválido ou expirado".
    if (!authUserId) {
      throw new Error('Falha ao identificar usuário criado/existente');
    }

    // FIX 25/06 (split de vendedor): propaga o auth_user_id pra TODAS as linhas
    // dessa pessoa (a matriz tem 1 linha por agente, mesmo whatsapp). Sem isso o
    // login ficava so na linha clicada, e os leads atribuidos as linhas do agente
    // (que ficavam sem auth) sumiam do painel do vendedor — o useSellerProfile le
    // os member rows por auth_user_id. Agora todas as linhas da pessoa apontam pro login.
    if (member.whatsapp_number) {
      try {
        await supabase.from('ai_team_members')
          .update({ auth_user_id: authUserId })
          .eq('user_id', masterUserId)
          .eq('whatsapp_number', member.whatsapp_number);
        console.log(`[invite-seller] auth_user_id propagado p/ todas as linhas do whatsapp ${member.whatsapp_number}`);
      } catch (propErr: any) {
        console.warn('[invite-seller] Falha ao propagar auth_user_id (nao bloqueante):', propErr?.message);
      }
    }

    // Detecta se user já confirmou email
    const { users: allUsers } = await authAdminListUsers(supabaseUrl, serviceKey, 1000);
    const existingUserState = allUsers.find((u: any) => u.email?.toLowerCase() === email.toLowerCase());
    const alreadyConfirmed = existingUserState?.email_confirmed_at != null;

    // Tenta tipos em ordem de preferência:
    //   • user NOVO (não confirmado) → invite → recovery → magiclink
    //   • user JÁ CONFIRMADO         → recovery → magiclink → invite
    // 'recovery' funciona pra criar senha pela 1ª vez também (SetSellerPassword.tsx só chama updateUser).
    const linkTypesToTry: string[] = alreadyConfirmed
      ? ['recovery', 'magiclink', 'invite']
      : ['invite', 'recovery', 'magiclink'];

    let actionLink: string | null = null;
    let usedType: string | null = null;
    let lastErr: any = null;
    // DEBUG 28/05/2026: capturar resposta crua do GoTrue de cada tentativa
    // pra diagnosticar por que action_link nao tem token. Sera retornado no
    // JSON de erro pra o frontend exibir.
    const debugAttempts: Array<{ type: string; status?: number; rawKeys?: string[]; rawSample?: any; hasToken: boolean; linkPreview: string | null; errorMsg?: string }> = [];

    for (const linkType of linkTypesToTry) {
      const { data: linkData, error: linkErr, rawResponse, status } = await authAdminGenerateLink(
        supabaseUrl,
        serviceKey,
        linkType,
        email,
        redirectTo,
      );
      const candidateLink = linkData?.action_link || null;
      // FIX 28/05/2026 v3: GoTrue retorna o action_link com query param ?token=XXX
      // (singular, sem underscore). Codigo antigo procurava 'token_hash=' que NUNCA
      // bate — sempre retornava hasToken=false e a funcao falhava antes de chamar
      // Resend, mesmo com link 100% valido. Esse era o verdadeiro bug raiz.
      let hasValidToken = false;
      if (candidateLink) {
        try {
          const u = new URL(candidateLink);
          hasValidToken =
            u.searchParams.has('token') ||
            u.searchParams.has('token_hash') ||
            u.searchParams.has('code') ||
            u.hash.includes('access_token=');
        } catch {
          hasValidToken = false;
        }
      }
      // Captura debug info pra cada tentativa.
      // Sanitiza token (qualquer query/hash param eh removido) mas preserva
      // URL completa pra eu ver pra onde o GoTrue esta redirecionando.
      let sanitizedLink = '';
      if (candidateLink) {
        try {
          const u = new URL(candidateLink);
          // Coleta NOMES dos params (sem valores) pra preservar privacy
          const queryParamNames = Array.from(u.searchParams.keys()).join(',');
          const hashParamNames = u.hash ? u.hash.substring(1).split('&').map(p => p.split('=')[0]).join(',') : '';
          sanitizedLink = `${u.origin}${u.pathname}?[${queryParamNames}]#[${hashParamNames}]`;
        } catch {
          sanitizedLink = candidateLink.substring(0, 150);
        }
      }
      debugAttempts.push({
        type: linkType,
        status,
        rawKeys: rawResponse ? Object.keys(rawResponse) : undefined,
        rawSample: rawResponse ? {
          action_link_present: !!rawResponse.action_link,
          action_link_has_token: hasValidToken,
          sanitizedActionLink: sanitizedLink,  // <-- URL COMPLETA mostrada (sem valores de token)
          properties_action_link_present: !!rawResponse.properties?.action_link,
          email_otp_present: !!rawResponse.email_otp,
          hashed_token_present: !!rawResponse.hashed_token,
          verification_type_present: !!rawResponse.verification_type,
          redirect_to_field: rawResponse.redirect_to || null,
          error_field: rawResponse.error || rawResponse.error_description || null,
          msg_field: rawResponse.msg || rawResponse.message || null,
        } : null,
        hasToken: hasValidToken,
        linkPreview: sanitizedLink || null,
        errorMsg: linkErr?.message,
      });
      // FIX DEFINITIVO 25/06: NAO usar o action_link (endpoint /auth/v1/verify do
      // servidor) — ele e consumido na hora, inclusive por scanner de antivirus/
      // Gmail que pre-abre o link, virando "Email link is invalid or has expired".
      // Em vez disso montamos um link com token_hash verificado NO NAVEGADOR
      // (ConfirmEmail -> supabase.auth.verifyOtp). Um GET de scanner so pega o HTML
      // estatico e NAO roda o JS, entao NAO consome o token. So o clique real consome.
      const hashedToken = (linkData?.hashed_token || rawResponse?.hashed_token || '') as string;
      if (hashedToken) {
        const sentAt = new Date().toISOString();
        actionLink = `${APP_BASE_URL}/auth/confirm?token_hash=${encodeURIComponent(hashedToken)}&type=${linkType}&sent_at=${encodeURIComponent(sentAt)}`;
        usedType = linkType;
        console.log(`[invite-seller] Link token_hash '${linkType}' gerado para ${email} (alreadyConfirmed=${alreadyConfirmed})`);
        break;
      }
      // Fallback raro: GoTrue nao devolveu hashed_token mas o action_link tem token.
      if (hasValidToken) {
        actionLink = candidateLink;
        usedType = linkType;
        console.log(`[invite-seller] Fallback action_link '${linkType}' para ${email} (sem hashed_token)`);
        break;
      }
      lastErr = linkErr;
      console.warn(`[invite-seller] Tipo '${linkType}' não gerou link válido. err=${linkErr?.message || 'sem erro mas sem action_link'}, link=${candidateLink ? candidateLink.substring(0, 80) : 'null'}`);
    }

    if (!actionLink) {
      const errMsg = `Não foi possível gerar link para ${email}. Tentei: ${linkTypesToTry.join(', ')}. redirect_to enviado: ${redirectTo}. Último erro: ${lastErr?.message || 'GoTrue retornou OK mas link sem token (allowlist?)'}`;
      console.error(`[invite-seller] FATAL: ${errMsg}`);
      console.error(`[invite-seller] DEBUG attempts:`, JSON.stringify(debugAttempts, null, 2));

      // Grava o debug numa tabela do banco pra eu ler via SQL CLI sem precisar
      // de DevTools no browser do usuario. Tabela tempo, sera dropada apos fix.
      try {
        await supabase.from('_debug_invite_attempts').insert({
          member_id: memberId,
          email,
          redirect_to: redirectTo,
          attempt: {
            authUserId,
            alreadyConfirmed,
            typesAttempted: linkTypesToTry,
            siteUrl: supabaseUrl,
            attempts: debugAttempts,
          },
        });
      } catch (insErr: any) {
        console.error('[invite-seller] Falha ao gravar _debug_invite_attempts:', insErr?.message);
      }

      return new Response(JSON.stringify({
        error: errMsg,
        debug: {
          authUserId,
          alreadyConfirmed,
          typesAttempted: linkTypesToTry,
          redirectTo,
          siteUrl: supabaseUrl,
          attempts: debugAttempts,
        },
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const confirmUrl = actionLink;

    // Step 3: Send invite email via Resend (link JÁ validado acima — sem risco de URL quebrada)
    const emailAction = (usedType === 'invite' ? 'invited' : 'linked');
    const emailSent = await sendInviteEmailViaResend(
      email,
      member.name,
      origin,
      emailAction,
      confirmUrl,
    );

    console.log(`[invite-seller] Convite para ${email} — auth: OK | type: ${usedType} | email: ${emailSent ? 'OK' : 'FALHOU'}`);

    if (!emailSent) {
      return new Response(JSON.stringify({
        success: false,
        error: `Link gerado com sucesso mas falha ao enviar email via Resend. Você pode copiar e enviar manualmente este link: ${confirmUrl}`,
        confirmUrl,
        action: emailAction,
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({
      success: true,
      action: emailAction,
      linkType: usedType,
      message: `Convite enviado para ${email}`,
      emailSent,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('invite-seller error:', err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

// ── Envio direto via Resend API ──────────────────────────────────────────────
async function sendInviteEmailViaResend(
  toEmail: string,
  sellerName: string,
  siteUrl: string,
  action: 'invited' | 'linked',
  confirmLink?: string,
): Promise<boolean> {
  const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
  if (!RESEND_API_KEY) {
    console.error('invite-seller: RESEND_API_KEY não configurada — email não enviado');
    return false;
  }

  const loginUrl = confirmLink || `${siteUrl}/login`;

  const subject = action === 'linked'
    ? 'Sua conta foi vinculada — LogosIA'
    : 'Você foi convidado para a LogosIA!';

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,sans-serif;">
  <div style="max-width:520px;margin:40px auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">
    <div style="background:linear-gradient(135deg,#1a2350 0%,#2d3a7c 55%,#b8953a 100%);padding:32px 24px;text-align:center;">
      <h1 style="color:#ffffff;font-size:22px;margin:0;">LogosIA</h1>
      <p style="color:rgba(255,255,255,0.8);font-size:13px;margin:8px 0 0;">${action === 'linked' ? 'Conta vinculada com sucesso' : 'Convite para a equipe'}</p>
    </div>
    <div style="padding:32px 24px;">
      <h2 style="color:#1a2350;font-size:18px;margin:0 0 16px;">Olá, ${sellerName}!</h2>
      ${action === 'linked'
        ? `<p style="color:#555;font-size:14px;line-height:1.6;">Sua conta foi vinculada à plataforma LogosIA. Você já pode acessar usando seu email <strong>${toEmail}</strong>.</p>`
        : `<p style="color:#555;font-size:14px;line-height:1.6;">Você foi convidado para fazer parte da equipe na plataforma <strong>LogosIA</strong>. Clique no botão abaixo para criar sua conta e começar a acompanhar seus leads:</p>`
      }
      <div style="text-align:center;margin:28px 0;">
        <a href="${loginUrl}" style="
          display:inline-block;
          background:linear-gradient(135deg,#1a2350 0%,#2d3a7c 55%,#b8953a 100%);
          color:#ffffff;
          text-decoration:none;
          font-weight:bold;
          font-size:14px;
          letter-spacing:1px;
          text-transform:uppercase;
          padding:14px 36px;
          border-radius:6px;
        ">${action === 'linked' ? 'Acessar plataforma' : 'Aceitar convite'}</a>
      </div>
      <p style="color:#999;font-size:12px;line-height:1.5;">
        Se o botão não funcionar, copie e cole este link no navegador:<br>
        <a href="${loginUrl}" style="color:#2d3a7c;word-break:break-all;">${loginUrl}</a>
      </p>
      ${action === 'invited'
        ? `<p style="color:#b07b16;font-size:12px;line-height:1.5;margin-top:14px;">Este convite e de uso unico e pode expirar. Se aparecer "link invalido ou expirado", peça para o administrador reenviar o convite e use sempre o e-mail mais recente.</p>`
        : ''
      }
    </div>
    <div style="background:#f9f9f9;padding:16px 24px;text-align:center;border-top:1px solid #eee;">
      <p style="color:#aaa;font-size:11px;margin:0;">Equipe LogosIA — suporte@logosiabrasil.com</p>
    </div>
  </div>
</body>
</html>`;

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Logosai <suporte@logosiabrasil.com>',
        to: [toEmail],
        subject,
        html,
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      console.error('invite-seller: Resend API error:', JSON.stringify(data));
      return false;
    }

    console.log('invite-seller: Email enviado via Resend, id:', data.id);
    return true;
  } catch (err) {
    console.error('invite-seller: Resend fetch error:', err);
    return false;
  }
}
