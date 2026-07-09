-- ============================================================================
-- NEPQ · Fechamento diário (sempre sobre o DIA ANTERIOR)
-- (1) RPC com os dados NEPQ de um dia; (2) runner que ANALISA os atendimentos de
-- ontem (fan-out p/ feedback-analista); (3) runner que ENVIA o resumo no WhatsApp
-- (feedback-nepq-diario). Crons: análise 07:30 BRT, envio 08:20 BRT. Só tenants
-- com a flag `analise` ligada (custo zero pros demais).
-- ============================================================================

-- (1) Dados NEPQ de um dia (atendimentos daquele dia já analisados) ------------
create or replace function public.feedback_nepq_diario_dados(p_tenant uuid, p_ref date)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(x order by x_score nulls last), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'vendedor_id', c.vendedor_id,
      'vendedor_nome', tm.name,
      'lead_name', l.lead_name,
      'nepq_score', nullif(c.resultado->>'nepq_score','')::int,
      'nepq_semaforo', c.resultado->>'nepq_semaforo',
      'frase_coaching', c.resultado->>'frase_coaching'
    ) as x,
    nullif(c.resultado->>'nepq_score','')::int as x_score
    from public.feedback_conversas c
    join public.ai_crm_leads l on l.id = c.lead_id
    left join public.ai_team_members tm on tm.id = c.vendedor_id
    where c.tenant_id = p_tenant
      and c.status = 'concluido'
      and c.lead_source = 'pedro'
      and c.resultado ? 'nepq_score'
      and exists (
        select 1 from public.wa_inbox w
        where w.user_id = p_tenant
          and right(regexp_replace(coalesce(w.phone,''),'[^0-9]','','g'),8) = right(regexp_replace(coalesce(l.remote_jid,''),'[^0-9]','','g'),8)
          and right(regexp_replace(coalesce(l.remote_jid,''),'[^0-9]','','g'),8) <> ''
          and (w.created_at at time zone 'America/Sao_Paulo')::date = p_ref
      )
  ) s;
$$;
revoke all on function public.feedback_nepq_diario_dados(uuid, date) from public;
revoke all on function public.feedback_nepq_diario_dados(uuid, date) from anon;

-- (2) Runner de ANÁLISE dos atendimentos de ontem (fan-out p/ feedback-analista)
create or replace function public.cron_feedback_nepq_ontem_runner()
returns void
language plpgsql
security definer
as $fn$
declare
  v_key text;
  v_tenant uuid;
  v_lead record;
  v_ontem date := (now() at time zone 'America/Sao_Paulo')::date - 1;
  v_n int := 0;
begin
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'service_role_key' limit 1;
  if v_key is null or v_key = '' then
    raise notice 'cron_feedback_nepq_ontem_runner: service_role_key ausente'; return;
  end if;

  for v_tenant in
    select distinct fc.tenant_id from public.feedback_config fc
    where coalesce(fc.feature_flags->>'analise','false') = 'true' and fc.tenant_id is not null
  loop
    for v_lead in
      select l.id
      from public.ai_crm_leads l
      where l.user_id = v_tenant
        and exists (
          select 1 from public.wa_inbox w
          where w.user_id = v_tenant
            and right(regexp_replace(coalesce(w.phone,''),'[^0-9]','','g'),8) = right(regexp_replace(coalesce(l.remote_jid,''),'[^0-9]','','g'),8)
            and right(regexp_replace(coalesce(l.remote_jid,''),'[^0-9]','','g'),8) <> ''
            and (w.created_at at time zone 'America/Sao_Paulo')::date = v_ontem
        )
    loop
      perform net.http_post(
        url := 'https://seyljsqmhlopkcauhlor.supabase.co/functions/v1/feedback-analista',
        headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||v_key),
        body := jsonb_build_object('lead_id', v_lead.id, 'lead_source', 'pedro'),
        timeout_milliseconds := 120000
      );
      v_n := v_n + 1;
    end loop;
  end loop;
  raise notice 'cron_feedback_nepq_ontem_runner: % leads (ontem=%) disparados', v_n, v_ontem;
end;
$fn$;

-- (3) Runner de ENVIO do resumo diário (fan-out p/ feedback-nepq-diario) -------
create or replace function public.cron_feedback_nepq_diario_runner()
returns void
language plpgsql
security definer
as $fn$
declare
  v_tenant uuid;
  v_n int := 0;
begin
  for v_tenant in
    select distinct fc.tenant_id from public.feedback_config fc
    where coalesce(fc.feature_flags->>'analise','false') = 'true' and fc.tenant_id is not null
  loop
    perform net.http_post(
      url := 'https://seyljsqmhlopkcauhlor.supabase.co/functions/v1/feedback-nepq-diario',
      headers := jsonb_build_object('Content-Type','application/json'),
      body := jsonb_build_object('k', 'icom-7f3a9c2e', 'tenant_id', v_tenant),
      timeout_milliseconds := 120000
    );
    v_n := v_n + 1;
  end loop;
  raise notice 'cron_feedback_nepq_diario_runner: % contas disparadas', v_n;
end;
$fn$;

-- Crons: análise 07:30 BRT (10:30 UTC), envio 08:20 BRT (11:20 UTC) -----------
do $$
begin
  if exists (select 1 from cron.job where jobname='feedback-nepq-analise-ontem') then perform cron.unschedule('feedback-nepq-analise-ontem'); end if;
  if exists (select 1 from cron.job where jobname='feedback-nepq-diario-envio') then perform cron.unschedule('feedback-nepq-diario-envio'); end if;
  perform cron.schedule('feedback-nepq-analise-ontem', '30 10 * * *', 'select public.cron_feedback_nepq_ontem_runner();');
  perform cron.schedule('feedback-nepq-diario-envio',  '20 11 * * *', 'select public.cron_feedback_nepq_diario_runner();');
end $$;

-- Self-check ------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from cron.job where jobname='feedback-nepq-analise-ontem')
     or not exists (select 1 from cron.job where jobname='feedback-nepq-diario-envio') then
    raise exception 'NEPQ fechamento diário: crons não agendados';
  end if;
end $$;
