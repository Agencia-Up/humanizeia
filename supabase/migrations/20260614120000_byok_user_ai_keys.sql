-- 20260614120000_byok_user_ai_keys.sql
-- BYOK ("traga sua chave de IA") — Fase 0: fundacao segura.
--
-- Guarda a chave de IA de cada cliente CIFRADA no Supabase Vault. A tabela
-- public.user_ai_keys so guarda o ID do segredo no cofre (opaco) + os 4 ultimos
-- digitos pra exibir. Nem num vazamento da tabela a chave aparece.
--
-- Acesso so via funcoes SECURITY DEFINER:
--   - save_my_ai_key / remove_my_ai_key / my_ai_key_status -> o proprio cliente (authenticated)
--   - get_client_ai_key -> SO os agentes (service_role); decifra a chave
--
-- Aditivo: NAO toca em nada existente. Nao liga em nenhum agente ainda (Fase 1).

create extension if not exists supabase_vault;

create table if not exists public.user_ai_keys (
  user_id    uuid not null references auth.users(id) on delete cascade,
  provider   text not null check (provider in ('openai','anthropic','deepseek')),
  secret_id  uuid not null,
  last4      text,
  updated_at timestamptz not null default now(),
  primary key (user_id, provider)
);

alter table public.user_ai_keys enable row level security;

drop policy if exists user_ai_keys_select_own on public.user_ai_keys;
create policy user_ai_keys_select_own on public.user_ai_keys
  for select using (auth.uid() = user_id);
-- Sem policies de insert/update/delete: toda escrita passa pelas RPCs definer.

-- ── Salvar/atualizar a chave do PROPRIO usuario ────────────────────────────
create or replace function public.save_my_ai_key(p_provider text, p_key text)
returns void
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_uid uuid := auth.uid();
  v_secret_id uuid;
  v_name text;
  v_last4 text;
begin
  if v_uid is null then raise exception 'nao autenticado'; end if;
  if p_provider not in ('openai','anthropic','deepseek') then raise exception 'provider invalido'; end if;
  if p_key is null or length(btrim(p_key)) < 12 then raise exception 'chave invalida'; end if;

  v_last4 := right(btrim(p_key), 4);
  v_name  := 'aikey_' || p_provider || '_' || v_uid::text;

  select secret_id into v_secret_id
    from public.user_ai_keys
   where user_id = v_uid and provider = p_provider;

  if v_secret_id is null then
    v_secret_id := vault.create_secret(btrim(p_key), v_name, 'BYOK chave de IA do cliente');
    insert into public.user_ai_keys(user_id, provider, secret_id, last4, updated_at)
      values (v_uid, p_provider, v_secret_id, v_last4, now());
  else
    perform vault.update_secret(v_secret_id, btrim(p_key));
    update public.user_ai_keys set last4 = v_last4, updated_at = now()
      where user_id = v_uid and provider = p_provider;
  end if;
end;
$$;

-- ── Remover a chave do PROPRIO usuario ─────────────────────────────────────
create or replace function public.remove_my_ai_key(p_provider text)
returns void
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_uid uuid := auth.uid();
  v_secret_id uuid;
begin
  if v_uid is null then raise exception 'nao autenticado'; end if;
  select secret_id into v_secret_id
    from public.user_ai_keys
   where user_id = v_uid and provider = p_provider;
  if v_secret_id is not null then
    delete from vault.secrets where id = v_secret_id;
    delete from public.user_ai_keys where user_id = v_uid and provider = p_provider;
  end if;
end;
$$;

-- ── Status: quais chaves o usuario tem (sem revelar a chave) ────────────────
create or replace function public.my_ai_key_status()
returns table(provider text, is_set boolean, last4 text, updated_at timestamptz)
language sql
security definer
set search_path = public
as $$
  select p.provider,
         (k.secret_id is not null) as is_set,
         k.last4,
         k.updated_at
    from (values ('openai'),('anthropic'),('deepseek')) as p(provider)
    left join public.user_ai_keys k
      on k.user_id = auth.uid() and k.provider = p.provider
$$;

-- ── Leitura da chave DECIFRADA — SO os agentes (service_role) ───────────────
create or replace function public.get_client_ai_key(p_user_id uuid, p_provider text)
returns text
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_secret_id uuid;
  v_key text;
begin
  select secret_id into v_secret_id
    from public.user_ai_keys
   where user_id = p_user_id and provider = p_provider;
  if v_secret_id is null then return null; end if;
  select decrypted_secret into v_key
    from vault.decrypted_secrets where id = v_secret_id limit 1;
  return v_key;
end;
$$;

-- ── Grants: cliente gerencia a propria; agente (service_role) le ───────────
revoke all on function public.save_my_ai_key(text,text)    from public, anon;
revoke all on function public.remove_my_ai_key(text)        from public, anon;
revoke all on function public.my_ai_key_status()            from public, anon;
revoke all on function public.get_client_ai_key(uuid,text)  from public, anon, authenticated;

grant execute on function public.save_my_ai_key(text,text)    to authenticated;
grant execute on function public.remove_my_ai_key(text)        to authenticated;
grant execute on function public.my_ai_key_status()            to authenticated;
grant execute on function public.get_client_ai_key(uuid,text)  to service_role;

comment on table public.user_ai_keys is
  'BYOK: aponta pro segredo (Vault) da chave de IA de cada cliente. Nunca guarda a chave em si.';
