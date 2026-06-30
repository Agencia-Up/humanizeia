-- ============================================================================
-- Pedro v3 — F2.7.6 — Debounce/burst do lead (roteamento + conversas assentadas)
-- O dono aplica MANUALMENTE no SQL Editor do Supabase. Idempotente. Service-role only.
--
-- POR QUE: o serviço v3 deixa de processar cada mensagem na hora. Ingere rapido
-- (responde "accepted" -> bridge mantem routed: pedro_v3) e um POLLER no serviço v3
-- processa a conversa SO quando ela fica QUIETA por PEDRO_V3_DEBOUNCE_MS (ou a
-- pendente mais antiga ja passou de PEDRO_V3_DEBOUNCE_MAX_MS, anti-starvation),
-- agregando todas as mensagens pendentes da conversa em UM turno.
--
-- O conversation_id e hash do telefone (irreversivel) -> precisamos persistir o
-- numero (to_addr) + agente p/ o poller despachar a resposta de forma assincrona,
-- fora do request do webhook. Sem Redis: tudo Postgres + inbox/lease/claim ja existentes.
-- ============================================================================

begin;

-- 1) Roteamento por conversa. Service-role only (RLS ligada, sem policies).
create table if not exists public.v3_conversation_routing (
  tenant_id uuid not null references auth.users(id) on delete cascade,
  conversation_id text not null,
  agent_id text not null,
  lead_id text,
  to_addr text not null,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, conversation_id)
);
alter table public.v3_conversation_routing enable row level security;
alter table public.v3_conversation_routing force row level security;
-- sem policies => anon/authenticated nao acessam; service_role tem BYPASSRLS (igual demais v3_*).

-- 2) Upsert idempotente do roteamento — chamado na INGESTAO de cada mensagem.
-- F2.7.6.1: retorna BOOLEAN (nao void). Via PostgREST/gateway, uma funcao void pode virar
-- 204 sem content-type JSON e o gateway rejeitaria (RESPONSE_INVALID) -> ingestao falharia.
-- drop+create porque mudar o tipo de retorno exige recriar (create or replace nao muda o tipo).
drop function if exists public.v3_upsert_conversation_routing(uuid, text, text, text, text, timestamptz);
create function public.v3_upsert_conversation_routing(
  p_tenant_id uuid,
  p_conversation_id text,
  p_agent_id text,
  p_lead_id text,
  p_to_addr text,
  p_now timestamptz default now()
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.v3_conversation_routing (tenant_id, conversation_id, agent_id, lead_id, to_addr, updated_at)
  values (p_tenant_id, p_conversation_id, p_agent_id, p_lead_id, p_to_addr, p_now)
  on conflict (tenant_id, conversation_id) do update
    set agent_id = excluded.agent_id,
        lead_id = excluded.lead_id,
        to_addr = excluded.to_addr,
        updated_at = excluded.updated_at;
  return true;
end;
$$;

-- 3) Conversas "assentadas" prontas p/ virar UM turno (quietas >= debounce OU a
--    pendente mais antiga >= max). So conversas com roteamento conhecido.
create or replace function public.v3_find_settled_conversations(
  p_tenant_id uuid,
  p_now timestamptz,
  p_debounce_ms integer,
  p_max_ms integer,
  p_limit integer
) returns table(conversation_id text, agent_id text, lead_id text, to_addr text, pending_count integer)
language sql
stable
security definer
set search_path = public
as $$
  select s.conversation_id, r.agent_id, r.lead_id, r.to_addr, s.pending_count
  from (
    select conversation_id,
           count(*)::integer as pending_count,
           max(received_at) as newest,
           min(received_at) as oldest
    from public.v3_inbox
    where tenant_id = p_tenant_id and status = 'pending'
    group by conversation_id
    having max(received_at) <= p_now - make_interval(secs => greatest(p_debounce_ms, 0)::numeric / 1000.0)
        or min(received_at) <= p_now - make_interval(secs => greatest(p_max_ms, 0)::numeric / 1000.0)
  ) s
  join public.v3_conversation_routing r
    on r.tenant_id = p_tenant_id and r.conversation_id = s.conversation_id
  order by s.oldest asc
  limit greatest(1, coalesce(p_limit, 20));
$$;

-- grants: so service_role executa.
revoke all on function public.v3_upsert_conversation_routing(uuid, text, text, text, text, timestamptz) from public;
revoke all on function public.v3_upsert_conversation_routing(uuid, text, text, text, text, timestamptz) from anon;
revoke all on function public.v3_upsert_conversation_routing(uuid, text, text, text, text, timestamptz) from authenticated;
grant execute on function public.v3_upsert_conversation_routing(uuid, text, text, text, text, timestamptz) to service_role;

revoke all on function public.v3_find_settled_conversations(uuid, timestamptz, integer, integer, integer) from public;
revoke all on function public.v3_find_settled_conversations(uuid, timestamptz, integer, integer, integer) from anon;
revoke all on function public.v3_find_settled_conversations(uuid, timestamptz, integer, integer, integer) from authenticated;
grant execute on function public.v3_find_settled_conversations(uuid, timestamptz, integer, integer, integer) to service_role;

commit;

-- ============================================================================
-- VERIFICADOR (read-only). Rode DEPOIS de aplicar. Espera all_ok=true.
-- Insere nada: usa um tenant ja existente so se houver. Os casos comportamentais
-- (settle por debounce, settle por max, nao-settle) sao provados OFFLINE pelo
-- teste pglite tests/run-sql-schema.ts.
-- ============================================================================
-- select jsonb_build_object(
--   'routing_table_existe', to_regclass('public.v3_conversation_routing') is not null,
--   'upsert_fn_existe', to_regprocedure('public.v3_upsert_conversation_routing(uuid,text,text,text,text,timestamptz)') is not null,
--   'find_fn_existe', to_regprocedure('public.v3_find_settled_conversations(uuid,timestamptz,integer,integer,integer)') is not null
-- ) as checks;
