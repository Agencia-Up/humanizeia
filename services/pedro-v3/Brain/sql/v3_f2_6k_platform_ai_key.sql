-- Pedro v3 F2.6K - caminho backend seguro para a chave da PLATAFORMA (grandfather BYOK).
-- O dono aplica este patch MANUALMENTE no SQL Editor do Supabase. NUNCA via db push.
--
-- Por que: o v3 (EasyPanel) NAO pode ter OPENAI_API_KEY no container. Para contas grandfathered sem
-- chave propria, o v3 precisa da chave da PLATAFORMA por um caminho service-role (igual ja faz com a
-- chave do cliente via get_client_ai_key). Esta RPC le a chave da plataforma do Vault.
--
-- PASSO MANUAL OBRIGATORIO DO DONO (uma vez), com a chave REAL da plataforma (a MESMA hoje no env
-- OPENAI_API_KEY do webhook v2). NAO commitar a chave; rodar so no SQL Editor:
--     select vault.create_secret('<CHAVE_OPENAI_DA_PLATAFORMA>', 'platform_openai_api_key');
-- Conferir SEM imprimir o valor:
--     select name from vault.decrypted_secrets where name = 'platform_openai_api_key';

begin;

create or replace function public.get_platform_ai_key(p_provider text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret_name text;
  v_key text;
begin
  v_secret_name := case lower(btrim(coalesce(p_provider, '')))
    when 'openai' then 'platform_openai_api_key'
    when 'anthropic' then 'platform_anthropic_api_key'
    when 'deepseek' then 'platform_deepseek_api_key'
    else null
  end;
  if v_secret_name is null then
    raise exception 'unsupported_provider' using errcode = '22023';
  end if;

  -- Vault: retorna NULL se a chave da plataforma ainda nao foi cadastrada (o resolver TS trata como
  -- fail-closed, sem fallback inseguro). Nunca loga o valor.
  select decrypted_secret into v_key
    from vault.decrypted_secrets
   where name = v_secret_name
   limit 1;

  return v_key;
end;
$$;

-- So service-role chama (igual get_client_ai_key). Nunca exposto a anon/authenticated.
revoke all on function public.get_platform_ai_key(text) from public;
revoke all on function public.get_platform_ai_key(text) from anon;
revoke all on function public.get_platform_ai_key(text) from authenticated;
grant execute on function public.get_platform_ai_key(text) to service_role;

commit;

-- Verificacao read-only (apos rodar o patch + cadastrar o secret), retorna true/false sem imprimir a chave:
--   select
--     (select count(*) = 1 from pg_proc where proname = 'get_platform_ai_key') as function_ok,
--     (select count(*) = 1 from vault.decrypted_secrets where name = 'platform_openai_api_key') as secret_ok;
