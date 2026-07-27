import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const PLATFORM_OWNER_EMAILS = new Set([
  'douglasaloan@gmail.com',
  'wandercarvalho31@gmail.com',
]);

function readJwtSessionId(token: string): string | null {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const claims = JSON.parse(atob(padded));
    const value = claims?.session_id || claims?.jti;
    return typeof value === 'string' && value.length > 0 ? value.slice(0, 200) : null;
  } catch {
    return null;
  }
}

function safeAuditHeader(value: string | null, max = 1000): string {
  return (value || '').replace(/[\r\n]/g, ' ').slice(0, max);
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const body = await req.json();
    const { instance_id } = body;

    // A identidade vem exclusivamente do JWT validado. Nunca confiamos no user_id
    // enviado pelo cliente para autorizar ou atribuir a auditoria.
    const authHeader = req.headers.get('Authorization') || '';
    const callerToken = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!callerToken) {
      return new Response(JSON.stringify({ success: false, error: 'Não autorizado' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const { data: { user: requester }, error: requesterError } = await supabase.auth.getUser(callerToken);
    if (requesterError || !requester) {
      return new Response(JSON.stringify({ success: false, error: 'Não autorizado' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const requesterAuthId = requester.id;

    if (!instance_id) {
      return new Response(JSON.stringify({ success: false, error: 'instance_id é obrigatório' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 1. Fetch instance details (sem filtro de user_id — vamos validar autorização abaixo)
    const { data: inst, error: fetchErr } = await supabase
      .from('wa_instances')
      .select('id, instance_name, api_url, api_key_encrypted, user_id, seller_member_id')
      .eq('id', instance_id)
      .single();

    if (fetchErr || !inst) {
      return new Response(JSON.stringify({ success: false, error: 'Instância não encontrada' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 2. Autorização — identidade sempre vem do JWT validado. O service role
    // consulta a fonte oficial de papel para preservar a operacao administrativa
    // cross-tenant sem voltar a confiar em user_id vindo do navegador.
    let authorized = false;
    if (inst.user_id === requesterAuthId) {
      authorized = true;
      console.log(`[delete-instance] Autorizado como master: ${requesterAuthId}`);
    } else if (inst.seller_member_id) {
      // Verifica se o requester é o vendedor dono via ai_team_members.auth_user_id
      const { data: member } = await supabase
        .from('ai_team_members')
        .select('id')
        .eq('id', inst.seller_member_id)
        .eq('auth_user_id', requesterAuthId)
        .maybeSingle();
      if (member) {
        authorized = true;
        console.log(`[delete-instance] Autorizado como vendedor dono: ${requesterAuthId} → seller_member_id=${inst.seller_member_id}`);
      }
    }

    if (!authorized) {
      const { data: requesterProfile, error: requesterProfileError } = await supabase
        .from('profiles')
        .select('is_superadmin')
        .eq('id', requesterAuthId)
        .maybeSingle();
      if (requesterProfileError) {
        console.warn('[delete-instance] Falha ao consultar papel administrativo:', requesterProfileError.message);
      }
      const requesterEmail = String(requester.email || '').trim().toLowerCase();
      const isPlatformAdmin = requesterProfile?.is_superadmin === true
        || PLATFORM_OWNER_EMAILS.has(requesterEmail);
      if (isPlatformAdmin) {
        authorized = true;
        console.log(`[delete-instance] Autorizado como administrador da plataforma: ${requesterAuthId}`);
      }
    }

    if (!authorized) {
      console.warn(`[delete-instance] NEGADO: requester ${requesterAuthId} não é dono de ${instance_id} (user_id=${inst.user_id}, seller_member_id=${inst.seller_member_id})`);
      return new Response(JSON.stringify({ success: false, error: 'Você não tem permissão para remover esta instância' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { instance_name, api_url, api_key_encrypted } = inst;
    const instanceToken = api_key_encrypted;
    const baseUrl = api_url?.replace(/\/$/, "") || Deno.env.get('UAZAPI_URL')?.replace(/\/$/, "") || Deno.env.get('EVOLUTION_API_URL')?.replace(/\/$/, "");

    console.log(`[delete-instance V8.3] Deletando instância: ${instance_name} (${instance_id})`);

    // 3. Delete from Uazapi — DELETE /instance com token no header (conforme docs.uazapi.com)
    if (baseUrl && instanceToken) {
      try {
        const delRes = await fetch(`${baseUrl}/instance`, {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'token': instanceToken,
          },
        });

        const delText = await delRes.text();
        console.log(`[delete-instance] API Response (${delRes.status}): ${delText.substring(0, 300)}`);

        if (!delRes.ok) {
           console.warn(`[delete-instance] Falha na API Uazapi (${delRes.status}), continuando remoção do banco.`);
        }
      } catch (apiErr: any) {
        console.warn('[delete-instance] Erro ao chamar API Uazapi:', apiErr.message);
      }
    }

    // 4. Delete from Database - ALWAYS RUN THIS
    console.log(`[delete-instance] Removendo registro do banco: ${instance_id}`);
    const forwardedIp = req.headers.get('cf-connecting-ip')
      || req.headers.get('x-forwarded-for')
      || req.headers.get('x-real-ip');
    const auditedSupabase = createClient(supabaseUrl, supabaseServiceKey, {
      global: {
        headers: {
          'x-agent-audit-actor-id': requesterAuthId,
          'x-agent-audit-session-id': safeAuditHeader(readJwtSessionId(callerToken), 200),
          'x-agent-audit-forwarded-for': safeAuditHeader(forwardedIp, 200),
          'x-agent-audit-user-agent': safeAuditHeader(req.headers.get('user-agent')),
        },
      },
    });
    const { error: dbErr } = await auditedSupabase
      .from('wa_instances')
      .delete()
      .eq('id', instance_id);

    if (dbErr) {
        console.error('[delete-instance] DB Delete Error:', dbErr);
        throw dbErr;
    }

    return new Response(JSON.stringify({ success: true, message: 'Instância removida com sucesso' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('[delete-instance] Error:', error);
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
