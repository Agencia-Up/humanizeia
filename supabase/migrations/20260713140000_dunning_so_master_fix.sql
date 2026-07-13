-- ============================================================================
-- FIX CRÍTICO: e-mail de cobrança SÓ pro MASTER, nunca pros vendedores.
-- Havia 24 assinaturas com user_id = vendedor (linha própria em user_subscriptions).
-- O cron de dunning percorria user_subscriptions direto -> mandaria e-mail de
-- cobrança pros vendedores ligados ao master. ERRADO/perigoso. Filtro novo: só a
-- assinatura cujo user_id É o billing owner (= master); vendedor nunca é notificado.
-- ============================================================================
create or replace function public.cron_subscription_dunning_emails()
returns void language plpgsql security definer set search_path to 'public' as $fn$
declare
  v_key text; v_url text := 'https://seyljsqmhlopkcauhlor.supabase.co/functions/v1/send-email';
  v record; v_email text; v_name text; v_grace timestamptz; v_dias int; v_n int := 0;
begin
  select decrypted_secret into v_key from vault.decrypted_secrets where name='service_role_key' limit 1;
  if v_key is null or v_key = '' then return; end if;

  for v in
    select us.user_id, us.renewal_date, lower(coalesce(us.status,'')) as status, us.expiring_notified_at,
           coalesce(us.plan_id,'pro') as plan_id, pr.full_name
    from public.user_subscriptions us
    join public.profiles pr on pr.id = us.user_id
    where lower(coalesce(us.status,'')) in ('active','overdue','suspended')
      and us.renewal_date is not null
      -- SÓ MASTER: a assinatura tem que ser do próprio billing owner (nunca vendedor).
      and us.user_id = public.resolve_billing_owner_user_id(us.user_id)
      and coalesce((select cr.administrativa from public.clientes_receita cr where cr.user_id = us.user_id), false) = false
      and coalesce((select cr.interna       from public.clientes_receita cr where cr.user_id = us.user_id), false) = false
  loop
    v_email := (select email from auth.users where id = v.user_id);
    if v_email is null or v_email = '' then continue; end if;
    v_name := coalesce(nullif(trim(v.full_name),''), split_part(v_email,'@',1));
    v_grace := public.add_business_days(v.renewal_date, 3);
    v_dias := (v.renewal_date at time zone 'America/Sao_Paulo')::date - (now() at time zone 'America/Sao_Paulo')::date;

    if v_dias in (1,2)
       and (v.expiring_notified_at is null or v.expiring_notified_at < v.renewal_date - interval '20 days') then
      perform net.http_post(url := v_url,
        headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||v_key),
        body := jsonb_build_object('type','subscription_expiring','email',v_email,'name',v_name,
                 'dias', v_dias, 'venc', to_char((v.renewal_date at time zone 'America/Sao_Paulo')::date,'DD/MM/YYYY'), 'plano', v.plan_id),
        timeout_milliseconds := 30000);
      update public.user_subscriptions set expiring_notified_at = now() where user_id = v.user_id;
      v_n := v_n + 1;
    elsif now() > v.renewal_date and now() < v_grace then
      perform net.http_post(url := v_url,
        headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||v_key),
        body := jsonb_build_object('type','subscription_overdue','email',v_email,'name',v_name,
                 'venc', to_char((v.renewal_date at time zone 'America/Sao_Paulo')::date,'DD/MM/YYYY'),
                 'bloqueio', to_char((v_grace at time zone 'America/Sao_Paulo')::date,'DD/MM/YYYY'), 'plano', v.plan_id),
        timeout_milliseconds := 30000);
      v_n := v_n + 1;
    end if;
  end loop;
  raise notice '[dunning] % e-mails (SO master) disparados', v_n;
end; $fn$;
