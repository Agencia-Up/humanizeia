-- ============================================================================
-- Cobrança/inadimplência: conta administrativa (Icom) + e-mails de aviso
--  (1) clientes_receita ganha dia_vencimento + administrativa (conta ADM que
--      paga p/ tracking mas NÃO é bloqueada pelo paywall).
--  (2) Icom = administrativa, R$497, dia 10 (nunca bloqueada; só tracking).
--  (3) get_effective_subscription_status isenta contas administrativas.
--  (4) cron_subscription_dunning_emails: aviso 2 dias antes (1x) + durante a
--      carência (3 dias úteis) dispara e-mail ao master a cada rodada (4x/dia).
--  Carência mantida em 3 dias úteis (decisão do dono). NÃO quebra nada existente.
-- ============================================================================

-- (1) Colunas -----------------------------------------------------------------
alter table public.clientes_receita add column if not exists dia_vencimento smallint;
alter table public.clientes_receita add column if not exists administrativa boolean not null default false;
alter table public.user_subscriptions add column if not exists expiring_notified_at timestamptz;

-- (2) Icom = conta administrativa (R$497, dia 10) -----------------------------
insert into public.clientes_receita (user_id, receita_brl_mensal, ativo, interna, administrativa, dia_vencimento)
values ('f49fd48a-4386-4009-95f3-26a5100b84f7', 497, true, false, true, 10)
on conflict (user_id) do update
  set receita_brl_mensal = 497, ativo = true, interna = false,
      administrativa = true, dia_vencimento = 10, atualizado_em = now();

-- (3) admin_margem_set_cliente com dia_vencimento + administrativa ------------
drop function if exists public.admin_margem_set_cliente(uuid, numeric, boolean, boolean);
create or replace function public.admin_margem_set_cliente(
  p_user_id uuid, p_receita numeric, p_ativo boolean,
  p_interna boolean default null, p_dia_vencimento smallint default null, p_administrativa boolean default null
) returns jsonb language plpgsql security definer set search_path to 'public' as $fn$
begin
  if not public._is_caller_superadmin() then raise exception 'forbidden'; end if;
  insert into public.clientes_receita (user_id, receita_brl_mensal, ativo, interna, dia_vencimento, administrativa)
  values (p_user_id, coalesce(p_receita,0), coalesce(p_ativo,true), coalesce(p_interna,false), p_dia_vencimento, coalesce(p_administrativa,false))
  on conflict (user_id) do update set
    receita_brl_mensal = excluded.receita_brl_mensal,
    ativo = excluded.ativo,
    interna = coalesce(p_interna, public.clientes_receita.interna),
    dia_vencimento = coalesce(p_dia_vencimento, public.clientes_receita.dia_vencimento),
    administrativa = coalesce(p_administrativa, public.clientes_receita.administrativa),
    atualizado_em = now();
  return jsonb_build_object('ok', true);
end; $fn$;

-- (4) Paywall isenta contas administrativas -----------------------------------
create or replace function public.get_effective_subscription_status(p_user_id uuid default auth.uid())
returns jsonb language plpgsql stable security definer set search_path to 'public' as $fn$
declare
  v_role text; v_owner_id uuid; v_sub public.user_subscriptions%rowtype;
  v_status text; v_grace_until timestamptz; v_blocked boolean := false; v_reason text := null;
  v_adm boolean;
begin
  if p_user_id is null then
    return jsonb_build_object('ok', false, 'is_blocked', true, 'block_reason', 'not_authenticated');
  end if;
  if auth.role() <> 'service_role' and auth.uid() is not null and p_user_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'is_blocked', false, 'block_reason', 'forbidden');
  end if;

  select role into v_role from public.profiles where id = p_user_id;
  v_owner_id := public.resolve_billing_owner_user_id(p_user_id);

  if v_owner_id is null then
    return jsonb_build_object('ok', true, 'role', coalesce(v_role,'owner'), 'owner_user_id', null,
      'status', 'missing_owner', 'is_blocked', true, 'block_reason', 'missing_billing_owner');
  end if;

  -- Conta administrativa (ex.: Icom) NUNCA é bloqueada — paga por fora, só tracking.
  select administrativa into v_adm from public.clientes_receita where user_id = v_owner_id;
  if coalesce(v_adm, false) then
    return jsonb_build_object('ok', true, 'role', coalesce(v_role,'owner'), 'owner_user_id', v_owner_id,
      'status', 'administrativa', 'is_blocked', false, 'block_reason', 'conta_administrativa');
  end if;

  select * into v_sub from public.user_subscriptions where user_id = v_owner_id order by created_at desc nulls last limit 1;
  if not found then
    return jsonb_build_object('ok', true, 'role', coalesce(v_role,'owner'), 'owner_user_id', v_owner_id,
      'status', 'missing', 'is_blocked', true, 'block_reason', 'missing_subscription',
      'checkout_path', '/checkout?plano=pro&ciclo=mensal');
  end if;

  v_status := lower(coalesce(v_sub.status, 'missing'));
  v_grace_until := public.add_business_days(v_sub.renewal_date, 3);

  if v_status = 'cancelled' then
    v_blocked := true; v_reason := 'subscription_cancelled';
  elsif v_status = 'pending' then
    v_blocked := true; v_reason := 'payment_pending';
  elsif v_status in ('active','overdue','suspended') then
    if v_sub.renewal_date is not null and v_grace_until is not null and now() > v_grace_until then
      v_blocked := true; v_reason := 'payment_overdue_grace_expired';
    else
      v_blocked := false;
    end if;
  else
    v_blocked := true; v_reason := 'subscription_not_active';
  end if;

  return jsonb_build_object('ok', true, 'role', coalesce(v_role,'owner'), 'owner_user_id', v_owner_id,
    'status', v_status, 'plan_id', v_sub.plan_id, 'renewal_date', v_sub.renewal_date, 'grace_until', v_grace_until,
    'is_blocked', v_blocked, 'block_reason', v_reason,
    'checkout_path', '/checkout?plano=' || coalesce(nullif(v_sub.plan_id,''),'pro') || '&ciclo=mensal');
end; $fn$;

-- (5) Cron de e-mails de cobrança --------------------------------------------
-- 2 dias antes: 1 aviso (expiring_notified_at dedup). Na carência (venceu, mas
-- < renewal+3 dias úteis): dispara a cada rodada (o cron roda 4x/dia). Pula
-- administrativa/interna e assinaturas canceladas/já bloqueadas.
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
      and coalesce((select cr.administrativa from public.clientes_receita cr where cr.user_id = us.user_id), false) = false
      and coalesce((select cr.interna       from public.clientes_receita cr where cr.user_id = us.user_id), false) = false
  loop
    v_email := (select email from auth.users where id = v.user_id);
    if v_email is null or v_email = '' then continue; end if;
    v_name := coalesce(nullif(trim(v.full_name),''), split_part(v_email,'@',1));
    v_grace := public.add_business_days(v.renewal_date, 3);
    v_dias := (v.renewal_date at time zone 'America/Sao_Paulo')::date - (now() at time zone 'America/Sao_Paulo')::date;

    -- AVISO 2 dias antes (1x por ciclo)
    if v_dias in (1,2)
       and (v.expiring_notified_at is null or v.expiring_notified_at < v.renewal_date - interval '20 days') then
      perform net.http_post(url := v_url,
        headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||v_key),
        body := jsonb_build_object('type','subscription_expiring','email',v_email,'name',v_name,
                 'dias', v_dias, 'venc', to_char((v.renewal_date at time zone 'America/Sao_Paulo')::date,'DD/MM/YYYY'), 'plano', v.plan_id),
        timeout_milliseconds := 30000);
      update public.user_subscriptions set expiring_notified_at = now() where user_id = v.user_id;
      v_n := v_n + 1;

    -- CARÊNCIA: venceu mas ainda dentro dos 3 dias úteis -> dispara TODA rodada
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
  raise notice '[dunning] % e-mails de cobranca disparados', v_n;
end; $fn$;

do $$
begin
  if exists (select 1 from cron.job where jobname='subscription-dunning-emails') then perform cron.unschedule('subscription-dunning-emails'); end if;
  -- 4x/dia: 09/13/17/21 BRT (12/16/20/00 UTC)
  perform cron.schedule('subscription-dunning-emails', '0 0,12,16,20 * * *', 'select public.cron_subscription_dunning_emails();');
end $$;

-- Self-check ------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from public.clientes_receita where user_id='f49fd48a-4386-4009-95f3-26a5100b84f7' and administrativa and dia_vencimento=10 and receita_brl_mensal=497) then
    raise exception 'Icom nao ficou administrativa 497 dia 10';
  end if;
  if not exists (select 1 from cron.job where jobname='subscription-dunning-emails') then
    raise exception 'cron de dunning nao agendado';
  end if;
end $$;
