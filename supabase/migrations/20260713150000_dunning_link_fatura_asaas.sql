-- ============================================================================
-- Cobrança: link do e-mail = fatura da MENSALIDADE (R$497) do Asaas, não /checkout.
--  (1) RPC subscription_dunning_targets(): lista SÓ masters a notificar (owner-only,
--      pula ADM/interna) com tipo (expiring/overdue) + asaas_subscription_id.
--  (2) cron_subscription_dunning_emails(): passa a só DISPARAR a edge
--      subscription-dunning (que busca a invoiceUrl no Asaas e manda o link certo).
-- ============================================================================

create or replace function public.subscription_dunning_targets()
returns jsonb language plpgsql security definer set search_path to 'public' as $fn$
declare
  v_arr jsonb := '[]'::jsonb; v record; v_email text; v_name text;
  v_grace timestamptz; v_dias int; v_tipo text; v_sub text; v_cust text;
begin
  for v in
    select us.user_id, us.renewal_date, us.expiring_notified_at, coalesce(us.plan_id,'pro') as plan_id, pr.full_name
    from public.user_subscriptions us
    join public.profiles pr on pr.id = us.user_id
    where lower(coalesce(us.status,'')) in ('active','overdue','suspended')
      and us.renewal_date is not null
      and us.user_id = public.resolve_billing_owner_user_id(us.user_id)  -- SÓ MASTER
      and coalesce((select cr.administrativa from public.clientes_receita cr where cr.user_id = us.user_id), false) = false
      and coalesce((select cr.interna       from public.clientes_receita cr where cr.user_id = us.user_id), false) = false
  loop
    v_grace := public.add_business_days(v.renewal_date, 3);
    v_dias := (v.renewal_date at time zone 'America/Sao_Paulo')::date - (now() at time zone 'America/Sao_Paulo')::date;
    v_tipo := null;
    if v_dias in (1,2) and (v.expiring_notified_at is null or v.expiring_notified_at < v.renewal_date - interval '20 days') then
      v_tipo := 'expiring';
    elsif now() > v.renewal_date and now() < v_grace then
      v_tipo := 'overdue';
    end if;
    if v_tipo is null then continue; end if;

    v_email := (select email from auth.users where id = v.user_id);
    if v_email is null or v_email = '' then continue; end if;
    v_name := coalesce(nullif(trim(v.full_name),''), split_part(v_email,'@',1));

    select asaas_subscription_id, asaas_customer_id into v_sub, v_cust
    from public.checkout_pending
    where user_id = v.user_id and asaas_subscription_id is not null
    order by created_at desc limit 1;

    v_arr := v_arr || jsonb_build_object(
      'user_id', v.user_id, 'email', v_email, 'name', v_name, 'tipo', v_tipo, 'dias', v_dias, 'plano', v.plan_id,
      'venc', to_char((v.renewal_date at time zone 'America/Sao_Paulo')::date, 'DD/MM/YYYY'),
      'bloqueio', to_char((v_grace at time zone 'America/Sao_Paulo')::date, 'DD/MM/YYYY'),
      'asaas_subscription_id', v_sub, 'asaas_customer_id', v_cust
    );
  end loop;
  return v_arr;
end; $fn$;

-- Cron agora só dispara a edge (que resolve a invoiceUrl no Asaas).
create or replace function public.cron_subscription_dunning_emails()
returns void language plpgsql security definer set search_path to 'public' as $fn$
declare v_key text;
begin
  select decrypted_secret into v_key from vault.decrypted_secrets where name='service_role_key' limit 1;
  if v_key is null or v_key = '' then return; end if;
  perform net.http_post(
    url := 'https://seyljsqmhlopkcauhlor.supabase.co/functions/v1/subscription-dunning',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||v_key),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
end; $fn$;
