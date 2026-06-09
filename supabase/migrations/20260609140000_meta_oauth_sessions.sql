-- meta_oauth_sessions: ponte temporaria do fluxo OAuth do Meta (Jose/Trafego).
-- O callback (edge function meta-oauth) grava aqui o access_token + as contas
-- detectadas e redireciona pro front com ?meta_oauth_session=<id>. O front
-- consome via acao consume_session e finaliza a conexao. Apenas o service_role
-- acessa (RLS on, sem policies). Espelha EXATAMENTE a tabela ja validada em
-- staging (ezoltigtqgbmftmiwjxh) -> producao (seyljsqmhlopkcauhlor).

create table if not exists public.meta_oauth_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  access_token_encrypted text not null,
  expires_at timestamptz not null default (now() + interval '30 minutes'),
  payload jsonb not null default '{}'::jsonb,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.meta_oauth_sessions enable row level security;

create index if not exists meta_oauth_sessions_user_created_idx
  on public.meta_oauth_sessions using btree (user_id, created_at desc);
