create table if not exists public.meta_oauth_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  access_token_encrypted text not null,
  expires_at timestamptz not null default (now() + interval '30 minutes'),
  payload jsonb not null default '{}'::jsonb,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists meta_oauth_sessions_user_created_idx
  on public.meta_oauth_sessions (user_id, created_at desc);

alter table public.meta_oauth_sessions enable row level security;

comment on table public.meta_oauth_sessions is
  'Short-lived Meta OAuth callback payloads. Access is mediated by Edge Functions.';
