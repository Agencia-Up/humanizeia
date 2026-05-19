-- Preferencia individual de ordem das colunas do CRM.
-- Nao mexe na posicao global das etapas, para cada vendedor poder organizar sua propria tela.

create table if not exists public.crm_column_preferences (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  crm_mode text not null check (crm_mode in ('pedro', 'marcos')),
  column_order text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (auth_user_id, crm_mode)
);

alter table public.crm_column_preferences enable row level security;

drop policy if exists "Users can view own crm column preferences" on public.crm_column_preferences;
create policy "Users can view own crm column preferences"
on public.crm_column_preferences
for select
using (auth.uid() = auth_user_id);

drop policy if exists "Users can insert own crm column preferences" on public.crm_column_preferences;
create policy "Users can insert own crm column preferences"
on public.crm_column_preferences
for insert
with check (auth.uid() = auth_user_id);

drop policy if exists "Users can update own crm column preferences" on public.crm_column_preferences;
create policy "Users can update own crm column preferences"
on public.crm_column_preferences
for update
using (auth.uid() = auth_user_id)
with check (auth.uid() = auth_user_id);

drop policy if exists "Users can delete own crm column preferences" on public.crm_column_preferences;
create policy "Users can delete own crm column preferences"
on public.crm_column_preferences
for delete
using (auth.uid() = auth_user_id);
