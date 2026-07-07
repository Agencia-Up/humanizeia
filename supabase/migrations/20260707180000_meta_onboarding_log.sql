-- Diagnostico do onboarding da Cloud API oficial (Embedded Signup).
-- Grava CADA tentativa/falha da edge `meta-embedded-signup` — inclusive o ERRO
-- CRU que a Meta devolve — numa tabela consultavel por SQL. Antes o unico
-- registro ficava no log da edge (nem sempre acessivel), e como ha 0 conexoes
-- `provider='meta'` em prod, nao da pra saber em que passo o fluxo quebra.
-- Best-effort: a edge insere aqui SEM alterar/quebrar o caminho de conexao.

create table if not exists public.meta_onboarding_log (
  id                bigint generated always as identity primary key,
  created_at        timestamptz not null default now(),
  user_id           uuid,
  seller_member_id  uuid,
  phone_number_id   text,
  waba_id           text,
  step              text not null,   -- token_exchange | subscribe | read_phone | insert | success | exception
  success           boolean not null default false,
  meta_status       integer,         -- HTTP status da resposta da Meta, quando houver
  error_text        text,            -- mensagem legivel do erro
  raw               jsonb            -- payload cru (error da Meta / insertErr / resumo do sucesso)
);

comment on table public.meta_onboarding_log is
  'Diagnostico do Embedded Signup (meta-embedded-signup). Interno/superadmin, best-effort, nao afeta o fluxo de conexao.';

create index if not exists idx_meta_onboarding_log_created_at
  on public.meta_onboarding_log (created_at desc);

-- Tabela interna de diagnostico: RLS LIGADA e SEM policy p/ usuarios finais.
-- So `service_role` (a edge, que insere) e `postgres`/admin (consultas de
-- diagnostico) enxergam — nenhum usuario da aplicacao le/escreve aqui.
alter table public.meta_onboarding_log enable row level security;

-- Self-check: a tabela precisa existir com RLS ligada ao fim da migration.
do $$
begin
  if not exists (
    select 1 from pg_tables
    where schemaname = 'public' and tablename = 'meta_onboarding_log' and rowsecurity = true
  ) then
    raise exception 'meta_onboarding_log ausente ou sem RLS apos a migration';
  end if;
end $$;
