-- ============================================================================
-- F1 — Schema + auditoria da sincronizacao da caixa UAZAPI -> "Conversas IA".
--
-- ADITIVO e REVERSIVEL. Nao altera/reescreve dados existentes. As mensagens
-- sincronizadas ficam numa tabela DEDICADA (wa_synced_messages) que NENHUM
-- webhook/trigger/worker existente le ou escreve -> por construcao, uma mensagem
-- importada NUNCA e tratada como mensagem nova (nao entra na fila do V3).
--
-- Regras honradas: idempotencia pelo ID real do provedor (provider_message_id);
-- telefone nacional canonico (nunca last-8); autoria explicita por evidencia;
-- origem da mensagem explicita; RLS por tenant; isolamento tenant+instancia.
-- ============================================================================

-- 1) Checkpoint de sincronizacao por (tenant, instancia) — retomada incremental.
create table if not exists public.wa_sync_checkpoint (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null,
  instance_id      uuid not null,
  last_synced_ts   timestamptz,                 -- maior messageTimestamp ja importado
  last_chat_offset integer     default 0,       -- retomada da paginacao de chats
  window_start     timestamptz,                 -- inicio da janela configurada (ex.: 30d)
  status           text        default 'idle',  -- idle|running|error
  locked_at        timestamptz,                 -- lock por tenant+instancia (anti-concorrencia)
  updated_at       timestamptz not null default now(),
  unique (tenant_id, instance_id)
);

-- 2) Historico de execucoes (observabilidade completa).
create table if not exists public.wa_sync_run (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null,
  instance_id       uuid not null,
  started_at        timestamptz not null default now(),
  finished_at       timestamptz,
  status            text not null default 'running',  -- running|ok|error|partial
  chats_found       integer default 0,
  messages_found    integer default 0,
  messages_imported integer default 0,
  duplicates        integer default 0,
  failures          integer default 0,
  cursor            text,
  error             text,
  trigger_source    text                                -- manual|cron|reconcile
);
create index if not exists wa_sync_run_tenant_idx
  on public.wa_sync_run (tenant_id, instance_id, started_at desc);

-- 3) Mensagens sincronizadas — HISTORICO puro (tabela dedicada; ver cabecalho).
create table if not exists public.wa_synced_messages (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null,
  instance_id         uuid not null,
  chatid              text,                 -- wa_chatid (JID) do provedor
  provider_message_id text not null,        -- messageid REAL do WhatsApp -> idempotencia
  phone_canonical     text,                 -- nacional canonico (NUNCA last-8)
  phone_raw           text,
  contact_name        text,
  from_me             boolean,
  direction           text,                 -- incoming|outgoing
  -- autoria por EVIDENCIA (nunca pela instancia):
  actor_source        text not null default 'desconhecido', -- cliente|ia_v3|humano_manual|desconhecido
  -- origem do registro:
  ingestion_source    text not null default 'sincronizacao_uazapi', -- webhook|v3|painel|sincronizacao_uazapi
  message_type        text,
  content             text,
  media_url           text,
  wa_timestamp        timestamptz,          -- messageTimestamp preservado
  sender_raw          text,
  raw                 jsonb,
  created_at          timestamptz not null default now(),
  -- IDEMPOTENCIA pelo ID real do provedor, isolada por tenant+instancia:
  unique (tenant_id, instance_id, provider_message_id)
);
create index if not exists wa_synced_messages_conv_idx
  on public.wa_synced_messages (tenant_id, instance_id, phone_canonical, wa_timestamp);
create index if not exists wa_synced_messages_chat_idx
  on public.wa_synced_messages (tenant_id, chatid, wa_timestamp);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'wa_synced_actor_chk') then
    alter table public.wa_synced_messages add constraint wa_synced_actor_chk
      check (actor_source in ('cliente','ia_v3','humano_manual','desconhecido'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'wa_synced_ingest_chk') then
    alter table public.wa_synced_messages add constraint wa_synced_ingest_chk
      check (ingestion_source in ('webhook','v3','painel','sincronizacao_uazapi'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'wa_synced_direction_chk') then
    alter table public.wa_synced_messages add constraint wa_synced_direction_chk
      check (direction is null or direction in ('incoming','outgoing'));
  end if;
end $$;

-- ── RLS: leitura so master do tenant / superadmin / membro ativo. Escrita e do
--    service_role (o syncer usa service client e bypassa RLS). Sem policy de INSERT
--    -> usuarios autenticados nunca escrevem direto.
alter table public.wa_sync_checkpoint  enable row level security;
alter table public.wa_sync_run         enable row level security;
alter table public.wa_synced_messages  enable row level security;

do $$
declare
  t   text;
  pol text;
begin
  foreach t in array array['wa_sync_checkpoint','wa_sync_run','wa_synced_messages'] loop
    pol := t || '_sel';
    execute format('drop policy if exists %I on public.%I', pol, t);
    execute format($f$
      create policy %I on public.%I for select using (
        tenant_id = auth.uid()
        or coalesce(public.is_current_user_superadmin(), false)
        or exists (select 1 from public.ai_team_members m
                    where m.auth_user_id = auth.uid() and m.user_id = %I.tenant_id
                      and coalesce(m.active_in_system, true) <> false)
      )$f$, pol, t, t);
  end loop;
end $$;

comment on table public.wa_synced_messages is
  'Historico importado da caixa UAZAPI (read-only). Tabela DEDICADA: nenhum webhook/trigger/worker a le -> mensagem sincronizada nunca vira mensagem nova nem entra na fila do V3. Idempotencia por (tenant_id, instance_id, provider_message_id).';
