const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type InviteStatus = 'sem_email' | 'sem_convite' | 'convite_pendente' | 'confirmado' | 'ativo';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function getCaller(supabaseUrl: string, serviceKey: string, authHeader: string) {
  const token = authHeader.replace(/^Bearer\s+/i, '');
  const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${token}`,
    },
  });
  if (!res.ok) return null;
  return res.json();
}

async function listAuthUsers(supabaseUrl: string, serviceKey: string) {
  const users: any[] = [];
  let page = 1;
  const perPage = 1000;

  for (;;) {
    const res = await fetch(`${supabaseUrl}/auth/v1/admin/users?page=${page}&per_page=${perPage}`, {
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
      },
    });
    if (!res.ok) throw new Error('Falha ao consultar usuarios do Auth');
    const body = await res.json();
    const batch = body.users || [];
    users.push(...batch);
    if (batch.length < perPage) break;
    page += 1;
  }

  return users;
}

function resolveStatus(member: any, authUser: any | null): InviteStatus {
  if (!member.email) return 'sem_email';
  if (!authUser) return 'sem_convite';
  if (authUser.email_confirmed_at && authUser.last_sign_in_at) return 'ativo';
  if (authUser.email_confirmed_at) return 'confirmado';
  return 'convite_pendente';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization') || '';
    if (!authHeader.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401);

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceKey) return json({ error: 'Missing Supabase env vars' }, 500);

    const caller = await getCaller(supabaseUrl, serviceKey, authHeader);
    if (!caller?.id) return json({ error: 'Unauthorized' }, 401);

    const body = await req.json().catch(() => ({}));
    const safeIds = Array.isArray(body.memberIds)
      ? body.memberIds.filter((id: unknown) => typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id))
      : [];

    const params = new URLSearchParams();
    params.set('select', 'id,name,email,auth_user_id,whatsapp_number');
    params.set('user_id', `eq.${caller.id}`);
    if (safeIds.length) params.set('id', `in.(${safeIds.join(',')})`);

    const membersRes = await fetch(`${supabaseUrl}/rest/v1/ai_team_members?${params.toString()}`, {
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
      },
    });
    if (!membersRes.ok) {
      const detail = await membersRes.text().catch(() => '');
      return json({ error: 'Falha ao carregar responsaveis', detail }, 500);
    }

    const members = await membersRes.json();
    const authUsers = await listAuthUsers(supabaseUrl, serviceKey);
    const byId = new Map(authUsers.map((u: any) => [u.id, u]));
    const byEmail = new Map(authUsers.filter((u: any) => u.email).map((u: any) => [String(u.email).toLowerCase(), u]));

    const statuses = members.map((member: any) => {
      const email = member.email ? String(member.email).toLowerCase() : null;
      const authUser = (member.auth_user_id && byId.get(member.auth_user_id)) || (email && byEmail.get(email)) || null;
      return {
        member_id: member.id,
        email: member.email || authUser?.email || null,
        auth_user_id: authUser?.id || member.auth_user_id || null,
        status: resolveStatus(member, authUser),
        email_confirmed_at: authUser?.email_confirmed_at || null,
        last_sign_in_at: authUser?.last_sign_in_at || null,
      };
    });

    return json({ statuses });
  } catch (error: any) {
    return json({ error: error?.message || 'Erro ao consultar status do convite' }, 500);
  }
});
