-- Migration: paulo_carousels
-- Tabela para armazenar carrosséis gerados pelo Paulo
-- Para usar: cole este SQL no SQL Editor do seu painel Supabase e execute

create table if not exists public.paulo_carousels (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  title text not null,
  niche text,
  angle text,
  caption text,
  hashtags text[] default '{}',
  slides jsonb not null default '[]',
  source text default 'paulo',             -- 'paulo' | 'daniel_import'
  daniel_research_id text,                 -- referência ao histórico do Daniel
  status text default 'draft',             -- 'draft' | 'ready_for_davi' | 'in_production'
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.paulo_carousels enable row level security;

create policy "users can manage own paulo carousels"
  on public.paulo_carousels
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists idx_paulo_carousels_user_created
  on public.paulo_carousels(user_id, created_at desc);

create index if not exists idx_paulo_carousels_status
  on public.paulo_carousels(user_id, status);

-- Trigger para atualizar updated_at automaticamente
create or replace function public.update_paulo_carousels_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_paulo_carousels_updated_at
  before update on public.paulo_carousels
  for each row execute function public.update_paulo_carousels_updated_at();
