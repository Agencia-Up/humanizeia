-- ============================================================================
-- Sistema de pausa CENTRAL do Pedro (V2/V3). Elimina a fragmentacao: hoje cada
-- worker checa (ou nao) ai_paused/is_active por conta propria, o gateway nao gateia
-- ai_paused antes do V3, e ha reativacao automatica apagando a pausa.
--
-- Esta migration e ADITIVA e IDEMPOTENTE (nao altera migrations antigas):
--  - metadados de pausa da conversa (quando/quem/porque);
--  - auditoria de pausa (conversa e agente);
--  - RPC autoritativa is_ai_automation_allowed (fonte unica da decisao);
--  - RPCs atomicas set_conversation_ai_paused / set_agent_ai_active (com auditoria,
--    devolvem a linha realmente atualizada).
-- Regra: "Pausar IA" bloqueia SO automacoes de IA (origin ai/system). Acoes
-- manuais/operacionais (manual, seller_ack) NUNCA sao bloqueadas.
-- ============================================================================

-- 1) Metadados de pausa da conversa (aditivo)
alter table public.ai_crm_leads
  add column if not exists ai_paused_at  timestamptz,
  add column if not exists ai_paused_by  uuid,
  add column if not exists pause_reason  text;

-- 2) Auditoria de pausa (conversa e agente)
create table if not exists public.ai_pause_audit (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid,
  scope           text,            -- 'conversation' | 'agent'
  lead_id         uuid,
  agent_id        uuid,
  previous_paused boolean,         -- conversa: paused; agente: (NOT is_active)
  new_paused      boolean,
  changed_by      uuid,
  source          text,            -- 'frontend' | 'edge' | 'system' | 'unknown_direct_update'
  reason          text,
  metadata        jsonb,
  created_at      timestamptz not null default now()
);
create index if not exists ai_pause_audit_lead_idx  on public.ai_pause_audit (lead_id, created_at desc);
create index if not exists ai_pause_audit_agent_idx on public.ai_pause_audit (agent_id, created_at desc);
create index if not exists ai_pause_audit_tenant_idx on public.ai_pause_audit (tenant_id, created_at desc);

alter table public.ai_pause_audit enable row level security;
drop policy if exists ai_pause_audit_select on public.ai_pause_audit;
create policy ai_pause_audit_select on public.ai_pause_audit
  for select using (
    tenant_id = auth.uid()
    or coalesce(public.is_current_user_superadmin(), false)
    or exists (select 1 from public.ai_team_members m
                where m.auth_user_id = auth.uid() and m.user_id = ai_pause_audit.tenant_id
                  and coalesce(m.active_in_system, true) <> false)
  );

-- 3) DECISAO CENTRAL (fonte unica). Read-only, chamada por gateway/workers
--    (service_role) e pelo front (authenticated). Retorna a decisao, nunca dados.
--    origin/action operacional => sempre permitido; automacao => exige agente ativo
--    E conversa nao pausada, com tenant conferido.
create or replace function public.is_ai_automation_allowed(
  p_tenant uuid,
  p_agent_id uuid,
  p_lead_id uuid,
  p_action_kind text,
  p_origin text default 'ai'
) returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_agent_active boolean;
  v_lead_paused  boolean;
  v_lead_tenant  uuid;
begin
  -- Operacional / humano: NUNCA bloqueado pela pausa da IA.
  if coalesce(p_origin, 'ai') in ('manual', 'seller')
     or p_action_kind in ('manual_message', 'manual_transfer', 'seller_ack', 'inbox_record') then
    return jsonb_build_object('allowed', true, 'reason', 'operational');
  end if;

  -- Pausa GLOBAL: agente desligado.
  if p_agent_id is not null then
    select is_active into v_agent_active from public.wa_ai_agents where id = p_agent_id;
    if coalesce(v_agent_active, false) = false then
      return jsonb_build_object('allowed', false, 'reason', 'agent_inactive');
    end if;
  end if;

  -- Pausa INDIVIDUAL: conversa pausada (+ tenant conferido).
  if p_lead_id is not null then
    select ai_paused, user_id into v_lead_paused, v_lead_tenant
      from public.ai_crm_leads where id = p_lead_id;
    if p_tenant is not null and v_lead_tenant is not null and v_lead_tenant <> p_tenant then
      return jsonb_build_object('allowed', false, 'reason', 'tenant_mismatch');
    end if;
    if coalesce(v_lead_paused, false) = true then
      return jsonb_build_object('allowed', false, 'reason', 'conversation_paused');
    end if;
  end if;

  return jsonb_build_object('allowed', true, 'reason', 'ok');
end;
$$;
grant execute on function public.is_ai_automation_allowed(uuid, uuid, uuid, text, text) to authenticated, service_role;

-- 4) Pausar/despausar CONVERSA (atomica + auditoria + devolve a linha)
create or replace function public.set_conversation_ai_paused(
  p_lead_id uuid,
  p_paused boolean,
  p_reason text default null,
  p_source text default 'frontend'
) returns table(id uuid, ai_paused boolean, ai_paused_at timestamptz, ai_paused_by uuid)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid    uuid := auth.uid();
  v_tenant uuid;
  v_prev   boolean;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;

  select l.user_id, l.ai_paused into v_tenant, v_prev
    from public.ai_crm_leads l where l.id = p_lead_id;
  if v_tenant is null then raise exception 'lead_not_found'; end if;

  -- Permissao: master do tenant, superadmin, ou membro ativo do tenant (gerente/vendedor).
  if not (
    v_tenant = v_uid
    or coalesce(public.is_current_user_superadmin(), false)
    or exists (select 1 from public.ai_team_members m
                where m.auth_user_id = v_uid and m.user_id = v_tenant
                  and coalesce(m.active_in_system, true) <> false)
  ) then
    raise exception 'not_authorized';
  end if;

  update public.ai_crm_leads
     set ai_paused = p_paused,
         ai_paused_at = case when p_paused then now() else null end,
         ai_paused_by = case when p_paused then v_uid else null end,
         pause_reason = case when p_paused then p_reason else null end
   where ai_crm_leads.id = p_lead_id;

  insert into public.ai_pause_audit(
    tenant_id, scope, lead_id, previous_paused, new_paused, changed_by, source, reason, metadata)
  values (v_tenant, 'conversation', p_lead_id, v_prev, p_paused, v_uid,
          coalesce(nullif(p_source, ''), 'frontend'), p_reason, jsonb_build_object('via', 'rpc'));

  return query
    select l.id, l.ai_paused, l.ai_paused_at, l.ai_paused_by
      from public.ai_crm_leads l where l.id = p_lead_id;
end;
$$;
grant execute on function public.set_conversation_ai_paused(uuid, boolean, text, text) to authenticated;

-- 5) Ligar/desligar AGENTE (global) — atomica + auditoria + devolve a linha.
create or replace function public.set_agent_ai_active(
  p_agent_id uuid,
  p_active boolean,
  p_source text default 'frontend',
  p_reason text default null
) returns table(id uuid, is_active boolean, updated_at timestamptz)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid    uuid := auth.uid();
  v_tenant uuid;
  v_prev   boolean;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;

  select wa.user_id, wa.is_active into v_tenant, v_prev
    from public.wa_ai_agents wa where wa.id = p_agent_id;
  if v_tenant is null then raise exception 'agent_not_found'; end if;

  if not (v_tenant = v_uid or coalesce(public.is_current_user_superadmin(), false)) then
    raise exception 'not_authorized';
  end if;

  update public.wa_ai_agents
     set is_active = p_active, updated_at = now()
   where wa_ai_agents.id = p_agent_id;

  insert into public.ai_pause_audit(
    tenant_id, scope, agent_id, previous_paused, new_paused, changed_by, source, reason, metadata)
  values (v_tenant, 'agent', p_agent_id, not coalesce(v_prev, true), not p_active, v_uid,
          coalesce(nullif(p_source, ''), 'frontend'), p_reason, jsonb_build_object('via', 'rpc'));

  return query
    select wa.id, wa.is_active, wa.updated_at
      from public.wa_ai_agents wa where wa.id = p_agent_id;
end;
$$;
grant execute on function public.set_agent_ai_active(uuid, boolean, text, text) to authenticated;
