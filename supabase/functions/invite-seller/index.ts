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

async function authAdminInviteUserByEmail(
  supabaseUrl: string,
  serviceKey: string,
  email: string,
  data: Record<string, any>,
  redirectTo: string
): Promise<{ data: any; error: any }> {
  try {
    // CORRETO: endpoint é /auth/v1/invite (NÃO /auth/v1/admin/invite)
    const res = await fetch(`${supabaseUrl}/auth/v1/invite`, {
      method: 'POST',
      headers: {
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email,
        data,
        redirect_to: redirectTo,
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { data: null, error: { message: body.message || body.msg || 'Invite failed', status: res.status } };
    }
    return { data: { user: body }, error: null };
  } catch (err: any) {
    return { data: null, error: { message: err.message } };
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
): Promise<{ data: any; error: any }> {
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
      return { data: null, error: { message: body.message || 'Generate link failed' } };
    }
    // GoTrue returns the link in properties.action_link
    return { data: { properties: body.properties || {}, ...body }, error: null };
  } catch (err: any) {
    return { data: null, error: { message: err.message } };
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
      .select('id,name,email,auth_user_id')
      .eq('id', memberId)
      .eq('user_id', masterUserId)
      .single();

    if (memberErr || !member) {
      return new Response(JSON.stringify({ error: 'Member not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const origin = req.headers.get('origin') || 'https://logosiabrasil.com';
    const redirectTo = `${origin}/auth/confirm`;

    // Try to invite user via GoTrue Admin API
    const { data: inviteData, error: inviteErr } = await authAdminInviteUserByEmail(
      supabaseUrl,
      serviceKey,
      email,
      { full_name: member.name, role: 'seller', master_user_id: masterUserId },
      redirectTo
    );

    let authUserId: string | null = null;

    if (inviteErr) {
      // User might already exist — try to find and link them
      if (inviteErr.message?.toLowerCase().includes('already') || inviteErr.status === 422) {
        const { users } = await authAdminListUsers(supabaseUrl, serviceKey, 1000);
        const existingUser = users.find((u: any) => u.email?.toLowerCase() === email.toLowerCase());
        if (existingUser) {
          await supabase.from('ai_team_members')
            .update({ email, auth_user_id: existingUser.id })
            .eq('id', memberId);
          authUserId = existingUser.id;

          // Send email via Resend to notify user their account was linked
          await sendInviteEmailViaResend(email, member.name, origin, 'linked');

          return new Response(JSON.stringify({
            success: true,
            action: 'linked',
            message: 'Usuário já existia e foi vinculado.',
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      }
      console.error('invite-seller: inviteUserByEmail failed:', inviteErr.message);
      throw new Error(inviteErr.message || 'Invite failed');
    }

    // Link auth_user_id
    if (inviteData?.user?.id) {
      authUserId = inviteData.user.id;
      await supabase.from('ai_team_members')
        .update({ email, auth_user_id: inviteData.user.id })
        .eq('id', memberId);
    }

    // Gerar um magic link para o vendedor acessar direto
    let magicLink = '';
    if (authUserId) {
      const { data: linkData } = await authAdminGenerateLink(
        supabaseUrl,
        serviceKey,
        'magiclink',
        email,
        redirectTo
      );
      if (linkData?.properties?.action_link) {
        magicLink = linkData.properties.action_link;
      }
    }

    const confirmUrl = magicLink || redirectTo;

    const emailSent = await sendInviteEmailViaResend(
      email,
      member.name,
      origin,
      'invited',
      confirmUrl,
    );

    console.log(`invite-seller: convite para ${email} — auth: OK | resend email: ${emailSent ? 'OK' : 'FALHOU'}`);

    return new Response(JSON.stringify({
      success: true,
      action: 'invited',
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
