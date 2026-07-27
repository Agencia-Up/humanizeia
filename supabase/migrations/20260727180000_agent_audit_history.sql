-- =============================================================================
-- Auditoria administrativa de agentes e conexoes WhatsApp.
--
-- Objetivos:
--   * registrar mudancas na origem (banco), inclusive quando vierem de RPC/Edge;
--   * preservar o agente excluido por snapshot, sem FK que apague o historico;
--   * atribuir usuario, sessao, IP e dispositivo quando o navegador disponibilizar;
--   * NUNCA persistir prompt em claro, token, api_key_encrypted ou URL secreta.
--
-- Limite deliberado: navegadores nao expoem hostname/usuario do Windows. O portal
-- registra um identificador estavel do navegador, SO/navegador, sessao, IP e ator
-- autenticado. Hostname exato exigiria app desktop/extensao corporativa.
-- =============================================================================

create table if not exists public.agent_audit_device_sessions (
  id                 uuid primary key default gen_random_uuid(),
  auth_user_id       uuid not null references auth.users(id) on delete cascade,
  auth_session_id    text not null,
  device_id          text not null,
  device_label       text,
  browser_name       text,
  operating_system   text,
  user_agent         text,
  platform           text,
  language           text,
  timezone           text,
  screen_info        jsonb not null default '{}'::jsonb,
  ip_address         text,
  first_seen_at      timestamptz not null default now(),
  last_seen_at       timestamptz not null default now(),
  unique (auth_user_id, auth_session_id, device_id)
);

create index if not exists agent_audit_device_sessions_lookup_idx
  on public.agent_audit_device_sessions (auth_user_id, auth_session_id, last_seen_at desc);

alter table public.agent_audit_device_sessions enable row level security;

drop policy if exists agent_audit_device_sessions_superadmin_read
  on public.agent_audit_device_sessions;
create policy agent_audit_device_sessions_superadmin_read
  on public.agent_audit_device_sessions
  for select to authenticated
  using (public._is_caller_superadmin());

revoke all on public.agent_audit_device_sessions from public, anon, authenticated;
grant select on public.agent_audit_device_sessions to authenticated;


create table if not exists public.agent_audit_events (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null,
  agent_id             uuid not null,
  agent_name_snapshot  text,
  event_type           text not null,
  category             text not null,
  actor_user_id        uuid,
  actor_name           text,
  actor_email          text,
  actor_kind           text not null default 'system',
  source               text not null default 'database_trigger',
  auth_session_id      text,
  device_id            text,
  device_label         text,
  browser_name         text,
  operating_system     text,
  ip_address           text,
  user_agent           text,
  request_id           text,
  changed_fields       text[] not null default '{}',
  before_state         jsonb not null default '{}'::jsonb,
  after_state          jsonb not null default '{}'::jsonb,
  metadata             jsonb not null default '{}'::jsonb,
  created_at           timestamptz not null default now()
);

-- Mantem a migration segura caso uma primeira versao tenha sido aplicada
-- parcialmente fora do fluxo transacional normal.
alter table public.agent_audit_events
  add column if not exists actor_name text;

create index if not exists agent_audit_events_agent_time_idx
  on public.agent_audit_events (agent_id, created_at desc);
create index if not exists agent_audit_events_tenant_time_idx
  on public.agent_audit_events (tenant_id, created_at desc);
create index if not exists agent_audit_events_type_time_idx
  on public.agent_audit_events (event_type, created_at desc);

alter table public.agent_audit_events enable row level security;

drop policy if exists agent_audit_events_superadmin_read on public.agent_audit_events;
create policy agent_audit_events_superadmin_read
  on public.agent_audit_events
  for select to authenticated
  using (public._is_caller_superadmin());

revoke all on public.agent_audit_events from public, anon, authenticated;
grant select on public.agent_audit_events to authenticated;

comment on table public.agent_audit_events is
  'Historico append-only de configuracao/status do agente e de suas conexoes WhatsApp. Snapshots sao sanitizados.';
comment on column public.agent_audit_events.agent_id is
  'Sem FK deliberadamente: o historico sobrevive a exclusao do agente.';


-- Le headers sem deixar um request malformado derrubar a mutacao auditada.
create or replace function public._agent_audit_request_headers()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_headers jsonb;
begin
  begin
    v_headers := coalesce(
      nullif(current_setting('request.headers', true), '')::jsonb,
      '{}'::jsonb
    );
  exception when others then
    v_headers := '{}'::jsonb;
  end;
  return v_headers;
end;
$$;

revoke all on function public._agent_audit_request_headers() from public, anon, authenticated;


-- Registra/atualiza o navegador autenticado. Todos os dados de identidade do
-- usuario vem do JWT; o cliente so declara dados tecnicos do dispositivo.
create or replace function public.register_agent_audit_device_session(
  p_device_id text,
  p_device_label text default null,
  p_browser_name text default null,
  p_operating_system text default null,
  p_user_agent text default null,
  p_platform text default null,
  p_language text default null,
  p_timezone text default null,
  p_screen_info jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_uid uuid := auth.uid();
  v_jwt jsonb := coalesce(auth.jwt(), '{}'::jsonb);
  v_session_id text;
  v_headers jsonb := public._agent_audit_request_headers();
  v_ip text;
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'authentication required';
  end if;
  if nullif(trim(coalesce(p_device_id, '')), '') is null then
    raise exception 'device_id required';
  end if;
  if jsonb_typeof(coalesce(p_screen_info, '{}'::jsonb)) <> 'object'
     or pg_column_size(coalesce(p_screen_info, '{}'::jsonb)) > 4096 then
    raise exception 'invalid screen_info';
  end if;

  v_session_id := coalesce(
    nullif(v_jwt ->> 'session_id', ''),
    nullif(v_jwt ->> 'jti', ''),
    'session-unavailable'
  );
  v_ip := nullif(trim(split_part(coalesce(
    v_headers ->> 'cf-connecting-ip',
    v_headers ->> 'x-forwarded-for',
    v_headers ->> 'x-real-ip',
    ''
  ), ',', 1)), '');

  insert into public.agent_audit_device_sessions (
    auth_user_id, auth_session_id, device_id, device_label, browser_name,
    operating_system, user_agent, platform, language, timezone, screen_info,
    ip_address, first_seen_at, last_seen_at
  ) values (
    v_uid,
    left(v_session_id, 200),
    left(trim(p_device_id), 200),
    left(nullif(trim(coalesce(p_device_label, '')), ''), 200),
    left(nullif(trim(coalesce(p_browser_name, '')), ''), 100),
    left(nullif(trim(coalesce(p_operating_system, '')), ''), 100),
    left(nullif(coalesce(p_user_agent, ''), ''), 1000),
    left(nullif(coalesce(p_platform, ''), ''), 200),
    left(nullif(coalesce(p_language, ''), ''), 50),
    left(nullif(coalesce(p_timezone, ''), ''), 100),
    coalesce(p_screen_info, '{}'::jsonb),
    v_ip,
    now(),
    now()
  )
  on conflict (auth_user_id, auth_session_id, device_id) do update set
    device_label = excluded.device_label,
    browser_name = excluded.browser_name,
    operating_system = excluded.operating_system,
    user_agent = excluded.user_agent,
    platform = excluded.platform,
    language = excluded.language,
    timezone = excluded.timezone,
    screen_info = excluded.screen_info,
    ip_address = coalesce(excluded.ip_address, agent_audit_device_sessions.ip_address),
    last_seen_at = now()
  returning id into v_id;

  -- Evita que um cliente adulterado crie sessoes ilimitadas para o mesmo login.
  delete from public.agent_audit_device_sessions d
  where d.auth_user_id = v_uid
    and d.id in (
      select stale.id
      from public.agent_audit_device_sessions stale
      where stale.auth_user_id = v_uid
      order by stale.last_seen_at desc
      offset 25
    );

  return v_id;
end;
$$;

revoke all on function public.register_agent_audit_device_session(
  text, text, text, text, text, text, text, text, jsonb
) from public, anon;
grant execute on function public.register_agent_audit_device_session(
  text, text, text, text, text, text, text, text, jsonb
) to authenticated;


-- Contexto do ator calculado no servidor. Se a alteracao vier de service_role ou
-- job sem JWT humano, fica explicitamente marcada como Servico/Sistema.
create or replace function public._agent_audit_actor_context()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  v_uid uuid := auth.uid();
  v_jwt jsonb := coalesce(auth.jwt(), '{}'::jsonb);
  v_headers jsonb := public._agent_audit_request_headers();
  v_role text;
  v_forwarded_actor_id uuid;
  v_session_id text;
  v_name text;
  v_email text;
  v_db_email text;
  v_ip text;
  v_user_agent text;
  v_request_id text;
  v_device public.agent_audit_device_sessions%rowtype;
begin
  v_role := coalesce(v_jwt ->> 'role', current_setting('request.jwt.claim.role', true), '');

  -- Edge Functions autenticadas executam a mutacao final com service_role. Elas
  -- podem preservar o solicitante humano nestes headers. O valor so e confiado
  -- quando o JWT do banco e realmente service_role; clientes comuns nao podem se
  -- passar por outro usuario adicionando o mesmo header.
  if v_uid is null and v_role = 'service_role' then
    begin
      v_forwarded_actor_id := nullif(v_headers ->> 'x-agent-audit-actor-id', '')::uuid;
    exception when others then
      v_forwarded_actor_id := null;
    end;
    if v_forwarded_actor_id is not null
       and exists (select 1 from auth.users u where u.id = v_forwarded_actor_id) then
      v_uid := v_forwarded_actor_id;
    end if;
  end if;

  v_session_id := coalesce(
    case when v_role = 'service_role' then nullif(v_headers ->> 'x-agent-audit-session-id', '') end,
    nullif(v_jwt ->> 'session_id', ''),
    nullif(v_jwt ->> 'jti', ''),
    null
  );
  v_email := nullif(v_jwt ->> 'email', '');
  if v_uid is not null then
    select u.email, p.full_name
      into v_db_email, v_name
    from auth.users u
    left join public.profiles p on p.id = u.id
    where u.id = v_uid;
    v_email := coalesce(v_email, v_db_email);
  end if;

  v_ip := nullif(trim(split_part(coalesce(
    case when v_role = 'service_role' then v_headers ->> 'x-agent-audit-forwarded-for' end,
    v_headers ->> 'cf-connecting-ip',
    v_headers ->> 'x-forwarded-for',
    v_headers ->> 'x-real-ip',
    ''
  ), ',', 1)), '');
  v_user_agent := coalesce(
    case when v_role = 'service_role' then nullif(v_headers ->> 'x-agent-audit-user-agent', '') end,
    nullif(v_headers ->> 'user-agent', '')
  );
  v_request_id := coalesce(
    nullif(v_headers ->> 'x-request-id', ''),
    nullif(v_headers ->> 'cf-ray', '')
  );

  if v_uid is not null and v_session_id is not null then
    select d.* into v_device
    from public.agent_audit_device_sessions d
    where d.auth_user_id = v_uid
      and (v_session_id is null or d.auth_session_id = v_session_id)
    order by
      case when v_session_id is not null and d.auth_session_id = v_session_id then 0 else 1 end,
      d.last_seen_at desc
    limit 1;
  end if;

  return jsonb_build_object(
    'actor_user_id', v_uid,
    'actor_name', v_name,
    'actor_email', v_email,
    'actor_kind', case
      when v_uid is not null and v_role = 'service_role' then 'user_via_service'
      when v_uid is not null then 'user'
      when v_role = 'service_role' then 'service'
      else 'system'
    end,
    'auth_session_id', v_session_id,
    'device_id', v_device.device_id,
    'device_label', v_device.device_label,
    'browser_name', v_device.browser_name,
    'operating_system', v_device.operating_system,
    'ip_address', coalesce(v_ip, v_device.ip_address),
    'user_agent', coalesce(v_user_agent, v_device.user_agent),
    'request_id', v_request_id
  );
end;
$$;

revoke all on function public._agent_audit_actor_context() from public, anon, authenticated;


-- Assinatura segura para textos grandes/sensiveis. Permite provar que mudou sem
-- copiar prompt, briefing ou webhook para a tabela de auditoria.
create or replace function public._agent_audit_text_signature(p_value text)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select jsonb_build_object(
    'configured', nullif(trim(coalesce(p_value, '')), '') is not null,
    'length', char_length(coalesce(p_value, '')),
    'fingerprint', case when p_value is null then null else md5(p_value) end
  );
$$;

revoke all on function public._agent_audit_text_signature(text) from public, anon, authenticated;


create or replace function public._agent_audit_safe_agent_state(p_row jsonb)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'id', p_row -> 'id',
    'name', p_row -> 'name',
    'is_active', p_row -> 'is_active',
    'agent_type', p_row -> 'agent_type',
    'model', p_row -> 'model',
    'temperature', p_row -> 'temperature',
    'max_tokens', p_row -> 'max_tokens',
    'reply_delay_ms', p_row -> 'reply_delay_ms',
    'company_name', p_row -> 'company_name',
    'services', p_row -> 'services',
    'address', p_row -> 'address',
    'human_whatsapp', p_row -> 'human_whatsapp',
    'instance_id', p_row -> 'instance_id',
    'instance_ids', p_row -> 'instance_ids',
    'business_hours_only', p_row -> 'business_hours_only',
    'business_hours_start', p_row -> 'business_hours_start',
    'business_hours_end', p_row -> 'business_hours_end',
    'blocked_categories', p_row -> 'blocked_categories',
    'sdr_goal', p_row -> 'sdr_goal',
    'qualification_questions', p_row -> 'qualification_questions',
    'gerente_feedback_completo', p_row -> 'gerente_feedback_completo',
    'mensagens_sem_emoji', p_row -> 'mensagens_sem_emoji',
    'automation_rules', p_row -> 'automation_rules',
    'system_prompt', public._agent_audit_text_signature(p_row ->> 'system_prompt'),
    'briefing_template_vendedor', public._agent_audit_text_signature(p_row ->> 'briefing_template_vendedor'),
    'briefing_template_gerente', public._agent_audit_text_signature(p_row ->> 'briefing_template_gerente'),
    'n8n_webhook_url', jsonb_build_object(
      'configured', nullif(trim(coalesce(p_row ->> 'n8n_webhook_url', '')), '') is not null
    )
  ));
$$;

revoke all on function public._agent_audit_safe_agent_state(jsonb) from public, anon, authenticated;


create or replace function public._agent_audit_safe_instance_state(p_row jsonb)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'whatsapp_instance_id', p_row -> 'id',
    'whatsapp_instance_name', p_row -> 'instance_name',
    'whatsapp_friendly_name', p_row -> 'friendly_name',
    'whatsapp_phone_number', p_row -> 'phone_number',
    'whatsapp_provider', p_row -> 'provider',
    'whatsapp_status', p_row -> 'status',
    'whatsapp_is_active', p_row -> 'is_active',
    'whatsapp_purpose', p_row -> 'purpose',
    'whatsapp_failover_status', p_row -> 'failover_status'
  ));
$$;

revoke all on function public._agent_audit_safe_instance_state(jsonb) from public, anon, authenticated;


create or replace function public._agent_audit_changed_fields(p_before jsonb, p_after jsonb)
returns text[]
language sql
immutable
set search_path = public
as $$
  select coalesce(array_agg(k.key order by k.key), '{}'::text[])
  from (
    select jsonb_object_keys(coalesce(p_before, '{}'::jsonb)) as key
    union
    select jsonb_object_keys(coalesce(p_after, '{}'::jsonb)) as key
  ) k
  where coalesce(p_before, '{}'::jsonb) -> k.key
        is distinct from
        coalesce(p_after, '{}'::jsonb) -> k.key;
$$;

revoke all on function public._agent_audit_changed_fields(jsonb, jsonb) from public, anon, authenticated;


create or replace function public._write_agent_audit_event(
  p_tenant_id uuid,
  p_agent_id uuid,
  p_agent_name text,
  p_event_type text,
  p_category text,
  p_changed_fields text[],
  p_before_state jsonb,
  p_after_state jsonb,
  p_metadata jsonb default '{}'::jsonb,
  p_source text default 'database_trigger'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor jsonb := public._agent_audit_actor_context();
  v_event_id uuid;
  v_actor_id uuid;
begin
  if p_tenant_id is null or p_agent_id is null then
    return null;
  end if;

  begin
    v_actor_id := nullif(v_actor ->> 'actor_user_id', '')::uuid;
  exception when others then
    v_actor_id := null;
  end;

  insert into public.agent_audit_events (
    tenant_id, agent_id, agent_name_snapshot, event_type, category,
    actor_user_id, actor_name, actor_email, actor_kind, source, auth_session_id,
    device_id, device_label, browser_name, operating_system, ip_address,
    user_agent, request_id, changed_fields, before_state, after_state,
    metadata, created_at
  ) values (
    p_tenant_id,
    p_agent_id,
    p_agent_name,
    p_event_type,
    p_category,
    v_actor_id,
    nullif(v_actor ->> 'actor_name', ''),
    nullif(v_actor ->> 'actor_email', ''),
    coalesce(nullif(v_actor ->> 'actor_kind', ''), 'system'),
    coalesce(nullif(p_source, ''), 'database_trigger'),
    nullif(v_actor ->> 'auth_session_id', ''),
    nullif(v_actor ->> 'device_id', ''),
    nullif(v_actor ->> 'device_label', ''),
    nullif(v_actor ->> 'browser_name', ''),
    nullif(v_actor ->> 'operating_system', ''),
    nullif(v_actor ->> 'ip_address', ''),
    nullif(v_actor ->> 'user_agent', ''),
    nullif(v_actor ->> 'request_id', ''),
    coalesce(p_changed_fields, '{}'::text[]),
    coalesce(p_before_state, '{}'::jsonb),
    coalesce(p_after_state, '{}'::jsonb),
    coalesce(p_metadata, '{}'::jsonb),
    now()
  ) returning id into v_event_id;

  return v_event_id;
end;
$$;

revoke all on function public._write_agent_audit_event(
  uuid, uuid, text, text, text, text[], jsonb, jsonb, jsonb, text
) from public, anon, authenticated;


-- Trigger principal: ignora contadores/updated_at porque o snapshot contem apenas
-- configuracao relevante. Uma unica linha registra todos os campos alterados.
create or replace function public.audit_wa_ai_agents_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before jsonb := '{}'::jsonb;
  v_after jsonb := '{}'::jsonb;
  v_changed text[] := '{}'::text[];
  v_tenant uuid;
  v_agent_id uuid;
  v_agent_name text;
  v_event_type text;
  v_category text;
begin
  if tg_op <> 'INSERT' then
    v_before := public._agent_audit_safe_agent_state(to_jsonb(old));
  end if;
  if tg_op <> 'DELETE' then
    v_after := public._agent_audit_safe_agent_state(to_jsonb(new));
  end if;

  v_changed := public._agent_audit_changed_fields(v_before, v_after);
  if tg_op = 'UPDATE' and cardinality(v_changed) = 0 then
    return new;
  end if;

  if tg_op = 'DELETE' then
    v_tenant := old.user_id;
    v_agent_id := old.id;
    v_agent_name := old.name;
  else
    v_tenant := new.user_id;
    v_agent_id := new.id;
    v_agent_name := new.name;
  end if;

  if tg_op = 'INSERT' then
    v_event_type := 'agent_created';
    v_category := 'lifecycle';
  elsif tg_op = 'DELETE' then
    v_event_type := 'agent_deleted';
    v_category := 'lifecycle';
  elsif 'is_active' = any(v_changed) then
    v_event_type := case when new.is_active then 'agent_activated' else 'agent_deactivated' end;
    v_category := 'status';
  elsif 'instance_id' = any(v_changed) or 'instance_ids' = any(v_changed) then
    v_event_type := 'instance_binding_changed';
    v_category := 'whatsapp';
  elsif 'system_prompt' = any(v_changed) then
    v_event_type := 'prompt_updated';
    v_category := 'configuration';
  else
    v_event_type := 'agent_updated';
    v_category := 'configuration';
  end if;

  perform public._write_agent_audit_event(
    v_tenant,
    v_agent_id,
    v_agent_name,
    v_event_type,
    v_category,
    v_changed,
    v_before,
    v_after,
    jsonb_build_object('table', tg_table_name, 'operation', tg_op),
    'database_trigger'
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_audit_wa_ai_agents_changes on public.wa_ai_agents;
create trigger trg_audit_wa_ai_agents_changes
after insert or update or delete on public.wa_ai_agents
for each row execute function public.audit_wa_ai_agents_changes();


-- Mudancas operacionais da instancia sao ligadas a todos os agentes vinculados.
-- last_message_at/health/counters nao entram no snapshot e nao geram ruido.
create or replace function public.audit_wa_instances_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before jsonb := '{}'::jsonb;
  v_after jsonb := '{}'::jsonb;
  v_changed text[] := '{}'::text[];
  v_instance_id uuid;
  v_event_type text;
  v_agent record;
begin
  if tg_op <> 'INSERT' then
    v_before := public._agent_audit_safe_instance_state(to_jsonb(old));
  end if;
  if tg_op <> 'DELETE' then
    v_after := public._agent_audit_safe_instance_state(to_jsonb(new));
  end if;

  v_changed := public._agent_audit_changed_fields(v_before, v_after);
  if tg_op = 'UPDATE' and cardinality(v_changed) = 0 then
    return new;
  end if;

  if tg_op = 'DELETE' then
    v_instance_id := old.id;
  else
    v_instance_id := new.id;
  end if;
  if tg_op = 'INSERT' then
    v_event_type := 'whatsapp_instance_created';
  elsif tg_op = 'DELETE' then
    v_event_type := 'whatsapp_disconnected';
  elsif ('whatsapp_status' = any(v_changed) or 'whatsapp_is_active' = any(v_changed))
        and coalesce(new.status, '') = 'connected'
        and coalesce(new.is_active, false) then
    v_event_type := 'whatsapp_connected';
  elsif ('whatsapp_status' = any(v_changed) or 'whatsapp_is_active' = any(v_changed))
        and (coalesce(new.status, '') <> 'connected' or not coalesce(new.is_active, false)) then
    v_event_type := 'whatsapp_disconnected';
  else
    v_event_type := 'whatsapp_instance_updated';
  end if;

  for v_agent in
    select a.id, a.user_id, a.name
    from public.wa_ai_agents a
    where a.instance_id = v_instance_id
       or coalesce(a.instance_ids, '{}'::uuid[]) @> array[v_instance_id]::uuid[]
  loop
    perform public._write_agent_audit_event(
      v_agent.user_id,
      v_agent.id,
      v_agent.name,
      v_event_type,
      'whatsapp',
      v_changed,
      v_before,
      v_after,
      jsonb_build_object(
        'table', tg_table_name,
        'operation', tg_op,
        'instance_id', v_instance_id
      ),
      'database_trigger'
    );
  end loop;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

-- DELETE precisa ser auditado antes da acao da FK (ON DELETE SET NULL), senao
-- uma instancia legada ligada apenas por instance_id pode perder o agente antes
-- de o trigger descobrir a quem pertence. Se o DELETE falhar, o evento tambem
-- volta junto, pois ambos participam da mesma transacao.
drop trigger if exists trg_audit_wa_instances_changes on public.wa_instances;
drop trigger if exists trg_audit_wa_instances_changes_after on public.wa_instances;
drop trigger if exists trg_audit_wa_instances_delete_before on public.wa_instances;
create trigger trg_audit_wa_instances_changes_after
after insert or update on public.wa_instances
for each row execute function public.audit_wa_instances_changes();
create trigger trg_audit_wa_instances_delete_before
before delete on public.wa_instances
for each row execute function public.audit_wa_instances_changes();


-- Leitura paginada para o modal administrativo. Nao expomos a tabela diretamente
-- a clientes comuns mesmo que conhecam o UUID do agente.
create or replace function public.admin_agent_audit_log(
  p_agent_id uuid,
  p_limit integer default 100
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 100), 250));
  v_events jsonb;
  v_total bigint;
  v_agent jsonb;
begin
  if not public._is_caller_superadmin() then
    raise exception 'forbidden: only platform admins';
  end if;

  select jsonb_build_object(
    'id', a.id,
    'name', a.name,
    'is_active', a.is_active,
    'client_name', coalesce(p.company_name, p.full_name),
    'tenant_id', a.user_id
  ) into v_agent
  from public.wa_ai_agents a
  left join public.profiles p on p.id = a.user_id
  where a.id = p_agent_id;

  if v_agent is null then
    select jsonb_build_object(
      'id', e.agent_id,
      'name', e.agent_name_snapshot,
      'is_active', null,
      'client_name', coalesce(p.company_name, p.full_name),
      'tenant_id', e.tenant_id,
      'deleted', true
    ) into v_agent
    from public.agent_audit_events e
    left join public.profiles p on p.id = e.tenant_id
    where e.agent_id = p_agent_id
    order by e.created_at desc
    limit 1;
  end if;

  select count(*) into v_total
  from public.agent_audit_events e
  where e.agent_id = p_agent_id;

  select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc), '[]'::jsonb)
  into v_events
  from (
    select
      e.id,
      e.event_type,
      e.category,
      e.actor_user_id,
      e.actor_name,
      e.actor_email,
      e.actor_kind,
      e.source,
      e.auth_session_id,
      e.device_id,
      e.device_label,
      e.browser_name,
      e.operating_system,
      e.ip_address,
      e.changed_fields,
      e.before_state,
      e.after_state,
      e.metadata,
      e.created_at
    from public.agent_audit_events e
    where e.agent_id = p_agent_id
    order by e.created_at desc
    limit v_limit
  ) t;

  return jsonb_build_object(
    'agent', coalesce(v_agent, jsonb_build_object('id', p_agent_id)),
    'events', v_events,
    'total', v_total,
    'has_more', v_total > v_limit
  );
end;
$$;

revoke all on function public.admin_agent_audit_log(uuid, integer) from public, anon;
grant execute on function public.admin_agent_audit_log(uuid, integer) to authenticated;


-- Mantem agentes excluidos descobriveis na mesma tela administrativa. O modal
-- continua sendo aberto pelo agente; esta RPC apenas devolve as linhas arquivadas
-- que ja nao existem em wa_ai_agents.
create or replace function public.admin_agent_audit_deleted_agents(
  p_limit integer default 100
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 100), 250));
  v_agents jsonb;
begin
  if not public._is_caller_superadmin() then
    raise exception 'forbidden: only platform admins';
  end if;

  select coalesce(jsonb_agg(to_jsonb(t) order by t.deleted_at desc), '[]'::jsonb)
    into v_agents
  from (
    select latest.*
    from (
      select distinct on (e.agent_id)
        e.agent_id,
        e.agent_name_snapshot as agent_name,
        e.tenant_id,
        coalesce(p.company_name, p.full_name) as client_name,
        e.created_at as deleted_at
      from public.agent_audit_events e
      left join public.profiles p on p.id = e.tenant_id
      where e.event_type = 'agent_deleted'
        and not exists (
          select 1 from public.wa_ai_agents a where a.id = e.agent_id
        )
      order by e.agent_id, e.created_at desc
    ) latest
    order by latest.deleted_at desc
    limit v_limit
  ) t;

  return jsonb_build_object('agents', v_agents);
end;
$$;

revoke all on function public.admin_agent_audit_deleted_agents(integer) from public, anon;
grant execute on function public.admin_agent_audit_deleted_agents(integer) to authenticated;


-- Aproveita o historico de pausa que ja existia. A autoria/device antiga pode
-- estar incompleta; mantemos o dado real sem inventar metadados.
insert into public.agent_audit_events (
  tenant_id, agent_id, agent_name_snapshot, event_type, category,
  actor_user_id, actor_name, actor_email, actor_kind, source,
  changed_fields, before_state, after_state,
  metadata, created_at
)
select
  p.tenant_id,
  p.agent_id,
  a.name,
  case when coalesce(p.new_paused, false) then 'agent_deactivated' else 'agent_activated' end,
  'status',
  p.changed_by,
  actor_profile.full_name,
  actor_user.email,
  case when p.changed_by is null then 'system' else 'user' end,
  coalesce(p.source, 'legacy_pause_audit'),
  array['is_active']::text[],
  jsonb_build_object('is_active', not coalesce(p.previous_paused, false)),
  jsonb_build_object('is_active', not coalesce(p.new_paused, false)),
  coalesce(p.metadata, '{}'::jsonb) || jsonb_build_object('legacy_pause_audit_id', p.id, 'reason', p.reason),
  p.created_at
from public.ai_pause_audit p
left join public.wa_ai_agents a on a.id = p.agent_id
left join public.profiles actor_profile on actor_profile.id = p.changed_by
left join auth.users actor_user on actor_user.id = p.changed_by
where p.scope = 'agent'
  and p.agent_id is not null
  and p.tenant_id is not null
  and not exists (
    select 1 from public.agent_audit_events e
    where e.metadata ->> 'legacy_pause_audit_id' = p.id::text
  );


-- Marco inicial: informa o estado no momento em que a auditoria passou a existir.
-- Nao afirma quem criou/editou antes desta migration.
insert into public.agent_audit_events (
  tenant_id, agent_id, agent_name_snapshot, event_type, category,
  actor_kind, source, changed_fields, before_state, after_state, metadata, created_at
)
select
  a.user_id,
  a.id,
  a.name,
  'audit_baseline',
  'lifecycle',
  'system',
  'migration',
  '{}'::text[],
  '{}'::jsonb,
  public._agent_audit_safe_agent_state(to_jsonb(a)),
  jsonb_build_object('note', 'Estado inicial quando a auditoria foi ativada'),
  now()
from public.wa_ai_agents a
where not exists (
  select 1 from public.agent_audit_events e
  where e.agent_id = a.id and e.event_type = 'audit_baseline'
);
