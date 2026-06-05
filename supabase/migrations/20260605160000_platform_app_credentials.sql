-- ============================================================================
-- platform_app_credentials
-- ----------------------------------------------------------------------------
-- Credenciais dos APPS de integracao (Meta, Google Ads, TikTok) geridas pelo
-- OPERADOR/ADMIN da plataforma direto no painel (uma linha por provider).
--
-- Sao chaves da PLATAFORMA INTEIRA (um app so, compartilhado por todos os
-- clientes), NAO sao por cliente. So o admin da plataforma escreve, via a
-- edge function platform-app-credentials (que roda com service_role e checa
-- se quem chamou e admin). RLS habilitado SEM policies => nenhum cliente
-- (anon/authenticated) le ou escreve direto; so o service_role (que ignora
-- RLS) acessa. Os valores nunca voltam pro frontend — so um status de
-- "configurado / nao configurado".
-- ============================================================================

create table if not exists public.platform_app_credentials (
  provider   text primary key,                       -- 'meta' | 'google_ads' | 'tiktok'
  app_id     text,                                    -- META_APP_ID / GOOGLE_CLIENT_ID / TIKTOK_APP_ID
  app_secret text,                                    -- META_APP_SECRET / GOOGLE_CLIENT_SECRET / TIKTOK_APP_SECRET
  extra      jsonb not null default '{}'::jsonb,      -- ex: { "developer_token": "..." } (Google Ads)
  updated_at timestamptz not null default now(),
  updated_by uuid
);

alter table public.platform_app_credentials enable row level security;

-- Proposital: NENHUMA policy de SELECT/INSERT/UPDATE/DELETE para anon ou
-- authenticated. Acesso exclusivamente pelo service_role (edge function),
-- que ignora RLS. Isso protege os segredos de qualquer cliente logado.

comment on table public.platform_app_credentials is
  'Credenciais dos apps de integracao (Meta/Google/TikTok) do operador da plataforma. Acesso so via service_role (edge function platform-app-credentials). Segredos nunca expostos ao frontend.';
