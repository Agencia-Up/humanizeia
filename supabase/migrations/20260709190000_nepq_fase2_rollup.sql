-- ============================================================================
-- NEPQ · Fase 2 — Rollup por vendedor/período (materializa o "Power BI")
-- Agrega feedback_conversas + feedback_dimensoes por (tenant, vendedor, mês).
-- Recompute idempotente (rebuild completo) + cron diário + RPC de leitura pro
-- front (SECURITY DEFINER resolvendo o tenant do chamador). Backend puro.
-- ============================================================================

create table if not exists public.feedback_vendedor_rollup (
  id                      uuid primary key default gen_random_uuid(),
  tenant_id               uuid not null,
  vendedor_id             uuid not null,
  periodo                 date not null,                 -- 1º dia do mês (BRT)
  conversas               int  not null default 0,
  score_medio             numeric,                       -- média do nepq_score
  notas_por_dimensao      jsonb not null default '{}'::jsonb,  -- {A: media, B1: media, ...}
  taxa_conflito_rotulagem numeric,                       -- fração de rotulagem_incorreta
  distribuicao_veredicto  jsonb not null default '{}'::jsonb,  -- {veredito: n}
  distribuicao_qualidade  jsonb not null default '{}'::jsonb,  -- {qualidade: n}
  tendencia               jsonb,                         -- reservado p/ sparkline
  updated_at              timestamptz not null default now(),
  unique (tenant_id, vendedor_id, periodo)
);

comment on table public.feedback_vendedor_rollup is
  'Agregado NEPQ por vendedor/mês (rebuild idempotente por feedback_rollup_recompute + cron). Alimenta o dashboard.';

alter table public.feedback_vendedor_rollup enable row level security;
drop policy if exists feedback_vendedor_rollup_read on public.feedback_vendedor_rollup;
create policy feedback_vendedor_rollup_read on public.feedback_vendedor_rollup
  for select using (tenant_id = public.resolve_billing_owner_user_id(auth.uid()));

-- Recompute idempotente (rebuild completo — barato no volume atual, seguro). ---
create or replace function public.feedback_rollup_recompute()
returns int
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_n int;
begin
  with base as (
    select
      c.id, c.tenant_id, c.vendedor_id,
      date_trunc('month', (coalesce(c.analisado_em, c.created_at) at time zone 'America/Sao_Paulo'))::date as periodo,
      nullif(c.resultado->>'nepq_score','')::numeric as nepq,
      c.veredito::text     as veredito,
      c.qualidade_lead::text as qualidade,
      coalesce(c.rotulagem_incorreta, false) as rotulagem
    from public.feedback_conversas c
    where c.status = 'concluido' and c.vendedor_id is not null
  ),
  main as (
    select tenant_id, vendedor_id, periodo,
      count(*)                              as conversas,
      round(avg(nepq), 1)                   as score_medio,
      round(avg((rotulagem)::int)::numeric, 3) as taxa_conflito
    from base group by 1,2,3
  ),
  notas_dim as (
    select b.tenant_id, b.vendedor_id, b.periodo,
      jsonb_object_agg(d.dimensao_cod, d.media order by d.dimensao_cod) as dims
    from base b
    join (
      select b2.id, fd.dimensao_cod, round(avg(fd.nota)::numeric, 2) as media
      from base b2 join public.feedback_dimensoes fd on fd.analise_id = b2.id
      group by b2.id, fd.dimensao_cod
    ) d on d.id = b.id
    group by 1,2,3
  ),
  dv as (
    select tenant_id, vendedor_id, periodo, jsonb_object_agg(veredito, n) as dist
    from (select tenant_id, vendedor_id, periodo, coalesce(veredito,'sem') as veredito, count(*) n
          from base group by 1,2,3,4) x group by 1,2,3
  ),
  dq as (
    select tenant_id, vendedor_id, periodo, jsonb_object_agg(qualidade, n) as dist
    from (select tenant_id, vendedor_id, periodo, coalesce(qualidade,'sem') as qualidade, count(*) n
          from base group by 1,2,3,4) x group by 1,2,3
  ),
  upserted as (
    insert into public.feedback_vendedor_rollup
      (tenant_id, vendedor_id, periodo, conversas, score_medio, notas_por_dimensao,
       taxa_conflito_rotulagem, distribuicao_veredicto, distribuicao_qualidade, updated_at)
    select m.tenant_id, m.vendedor_id, m.periodo, m.conversas, m.score_medio,
           coalesce(nd.dims, '{}'::jsonb), m.taxa_conflito,
           coalesce(dv.dist, '{}'::jsonb), coalesce(dq.dist, '{}'::jsonb), now()
    from main m
    left join notas_dim nd on (nd.tenant_id, nd.vendedor_id, nd.periodo) = (m.tenant_id, m.vendedor_id, m.periodo)
    left join dv on (dv.tenant_id, dv.vendedor_id, dv.periodo) = (m.tenant_id, m.vendedor_id, m.periodo)
    left join dq on (dq.tenant_id, dq.vendedor_id, dq.periodo) = (m.tenant_id, m.vendedor_id, m.periodo)
    on conflict (tenant_id, vendedor_id, periodo) do update set
      conversas = excluded.conversas,
      score_medio = excluded.score_medio,
      notas_por_dimensao = excluded.notas_por_dimensao,
      taxa_conflito_rotulagem = excluded.taxa_conflito_rotulagem,
      distribuicao_veredicto = excluded.distribuicao_veredicto,
      distribuicao_qualidade = excluded.distribuicao_qualidade,
      updated_at = now()
    returning 1
  )
  select count(*) into v_n from upserted;

  -- Remove linhas de (vendedor,período) que não têm mais análise (idempotência real).
  delete from public.feedback_vendedor_rollup r
  where not exists (
    select 1 from public.feedback_conversas c
    where c.status='concluido' and c.vendedor_id = r.vendedor_id and c.tenant_id = r.tenant_id
      and date_trunc('month', (coalesce(c.analisado_em, c.created_at) at time zone 'America/Sao_Paulo'))::date = r.periodo
  );

  return v_n;
end;
$fn$;

comment on function public.feedback_rollup_recompute() is
  'Rebuild idempotente do feedback_vendedor_rollup a partir de feedback_conversas + feedback_dimensoes.';

-- RPC de leitura pro front (resolve o tenant do chamador) ---------------------
create or replace function public.feedback_rollup_por_vendedor()
returns setof public.feedback_vendedor_rollup
language sql
stable
security definer
set search_path = public
as $$
  select *
  from public.feedback_vendedor_rollup
  where tenant_id = public.resolve_billing_owner_user_id(auth.uid())
  order by vendedor_id, periodo desc;
$$;
revoke all on function public.feedback_rollup_por_vendedor() from public;
revoke all on function public.feedback_rollup_por_vendedor() from anon;
grant execute on function public.feedback_rollup_por_vendedor() to authenticated;

-- Cron diário (08:15 BRT = 11:15 UTC) + 1 recompute agora ---------------------
do $$
begin
  if exists (select 1 from cron.job where jobname = 'feedback-nepq-rollup') then
    perform cron.unschedule('feedback-nepq-rollup');
  end if;
  perform cron.schedule('feedback-nepq-rollup', '15 11 * * *', 'select public.feedback_rollup_recompute();');
end $$;

select public.feedback_rollup_recompute();

-- Self-check ------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_tables where schemaname='public' and tablename='feedback_vendedor_rollup' and rowsecurity) then
    raise exception 'NEPQ Fase 2: feedback_vendedor_rollup sem RLS';
  end if;
  if not exists (select 1 from cron.job where jobname='feedback-nepq-rollup') then
    raise exception 'NEPQ Fase 2: cron feedback-nepq-rollup não agendado';
  end if;
end $$;
