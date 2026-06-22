-- José — Cabine de Comando / Bloco B (chat conversável). Histórico unificado dos dois
-- transportes (painel e, depois, WhatsApp) + números autorizados a falar COM o José.

create table if not exists public.jose_chat_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null,
  canal text not null default 'painel',     -- 'painel' | 'whatsapp'
  role text not null,                        -- 'user' | 'assistant'
  content text,
  tool_calls jsonb,                          -- nomes das ferramentas usadas no turno
  created_at timestamptz not null default now()
);
create index if not exists idx_jose_chat_session on public.jose_chat_messages(user_id, session_id, created_at);
alter table public.jose_chat_messages enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='jose_chat_messages' and policyname='jose_chat_msg_select') then
    create policy jose_chat_msg_select on public.jose_chat_messages
      for select using (user_id = auth.uid() or public._is_caller_superadmin());
  end if;
end $$;

-- Números/identificadores autorizados a COMANDAR o José (usado no leg WhatsApp, depois).
create table if not exists public.jose_assistant_channels (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  canal text not null default 'whatsapp',
  identifier text not null,
  autorizado boolean not null default true,
  created_at timestamptz not null default now(),
  unique (user_id, canal, identifier)
);
alter table public.jose_assistant_channels enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='jose_assistant_channels' and policyname='jose_assist_ch_all') then
    create policy jose_assist_ch_all on public.jose_assistant_channels
      for all using (user_id = auth.uid() or public._is_caller_superadmin())
      with check (user_id = auth.uid() or public._is_caller_superadmin());
  end if;
end $$;
