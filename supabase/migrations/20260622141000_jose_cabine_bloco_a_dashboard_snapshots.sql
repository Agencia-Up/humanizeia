-- José — Cabine de Comando / Bloco A (cards Power BI): cache de snapshot do painel.
-- O cron calcula os cards e grava aqui; o painel lê instantâneo e bate com a última
-- verdade computada. Tudo gated em runtime pelo flag 'cabine_cards'.

create table if not exists public.jose_dashboard_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  ad_account_id uuid,
  periodo text not null default 'last_7d',
  payload jsonb not null default '{}'::jsonb,
  computed_at timestamptz not null default now(),
  unique (user_id, ad_account_id, periodo)
);

create index if not exists idx_jose_dash_snap_user on public.jose_dashboard_snapshots(user_id);

alter table public.jose_dashboard_snapshots enable row level security;

-- Dono vê o seu; superadmin vê tudo. Escrita é só pelo service role (edge), que
-- ignora RLS — por isso não há policy de insert/update p/ usuário comum.
do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='jose_dashboard_snapshots' and policyname='jose_dash_snap_select'
  ) then
    create policy jose_dash_snap_select on public.jose_dashboard_snapshots
      for select using (user_id = auth.uid() or public._is_caller_superadmin());
  end if;
end $$;
