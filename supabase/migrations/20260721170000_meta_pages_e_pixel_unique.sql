-- Fix 2 da conexão Meta: permitir integrar MÚLTIPLAS páginas (hoje página detectada
-- no OAuth não é salva em lugar nenhum). Também garante o índice único que o upsert
-- de pixels selecionados vai usar (meta_pixels por user+pixel_id).
create table if not exists public.meta_pages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  organization_id uuid,
  page_id text not null,
  page_name text,
  category text,
  fan_count integer default 0,
  picture_url text,
  access_token_encrypted text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, page_id)
);

alter table public.meta_pages enable row level security;

drop policy if exists meta_pages_owner_all on public.meta_pages;
create policy meta_pages_owner_all on public.meta_pages
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- superadmin lê tudo (mesmo padrão de outras tabelas)
drop policy if exists meta_pages_superadmin_read on public.meta_pages;
create policy meta_pages_superadmin_read on public.meta_pages
  for select using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_superadmin = true));

create index if not exists idx_meta_pages_user on public.meta_pages(user_id);

-- Índice único p/ o upsert de pixels selecionados (a edge grava por user+pixel_id).
create unique index if not exists ux_meta_pixels_user_pixel
  on public.meta_pixels(user_id, pixel_id);