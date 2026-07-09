-- Area de Feedbacks > "Por vendedor" (frontend do master).
-- Expoe os dados por conversa (score, qualidade do lead, frase de coaching,
-- tempo de 1a resposta, venda) SEM o frontend precisar passar o tenant do
-- cliente. SECURITY DEFINER resolve o tenant do PROPRIO chamador
-- (resolve_billing_owner_user_id(auth.uid())) e REUSA feedback_relatorio_dados
-- (mesma fonte do PDF completo). Assim o master so enxerga a propria conta.

create or replace function public.feedback_relatorio_por_vendedor()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tenant uuid;
begin
  if auth.uid() is null then
    return '[]'::jsonb;
  end if;
  v_tenant := public.resolve_billing_owner_user_id(auth.uid());
  if v_tenant is null then
    return '[]'::jsonb;
  end if;
  return coalesce(public.feedback_relatorio_dados(v_tenant), '[]'::jsonb);
end;
$$;

comment on function public.feedback_relatorio_por_vendedor() is
  'Feedbacks > Por vendedor (frontend master). Resolve o tenant do chamador e reusa feedback_relatorio_dados; retorna array por conversa concluida.';

-- So usuario autenticado (o master); nunca anon/public.
revoke all on function public.feedback_relatorio_por_vendedor() from public;
revoke all on function public.feedback_relatorio_por_vendedor() from anon;
grant execute on function public.feedback_relatorio_por_vendedor() to authenticated;

-- Self-check.
do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'feedback_relatorio_por_vendedor'
      and p.prosecdef
  ) then
    raise exception 'feedback_relatorio_por_vendedor ausente ou nao SECURITY DEFINER';
  end if;
end $$;
