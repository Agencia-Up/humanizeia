-- ============================================================================
-- Repasse Fase 3 — Anti-loop (vigia)
-- ----------------------------------------------------------------------------
-- Um lead pode ficar "rodando" entre vendedores: é transferido, ninguém confirma
-- em 10-15 min, o motor reencaminha pro próximo, ninguém confirma, e assim por
-- diante — pingando os vendedores pra sempre. Este vigia detecta esses leads
-- (>= 3 repasses sem NENHUMA confirmação) e os ESTACIONA no bolsão: o loop para
-- e o lead aparece no Painel ao Vivo (seção "Sem dono") pro gestor atribuir.
--
-- Tudo em SQL (sem edge function), rodando a cada 5 min via pg_cron.
--
-- ESTADO DE "ESTACIONADO" (some de TODOS os motores, conferido no código):
--   status = 'inativo'        -> resgate (rescue-orphan-transfers) só pega
--                                'transferido'; cron-lead-followup só pega
--                                'novo'/'interessado'. 'inativo' é ignorado.
--   assigned_to_id = null     -> sem dono
--   disponivel_repasse = true -> entra no bolsão (Fase 2)
--   repasse_motivo = 'loop_watchdog'  -> marca a origem (loop) pro painel
--   transfers 'pending' -> 'expired'  -> timeout-checker e cron-lead-followup só
--                                        olham 'pending'; sem pendente, ignoram.
-- ============================================================================

create or replace function public.cron_repasse_antiloop()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Acha leads em loop, fecha os pendentes e estaciona no bolsão — num único
  -- statement (CTEs que modificam dados). Limiar: 3 repasses sem confirmação.
  with loop_leads as (
    select l.id
    from public.ai_crm_leads l
    where l.assigned_to_id is null
      and coalesce(l.disponivel_repasse, false) = false
      and l.status in ('transferido', 'qualificado')
      and (
        select count(*) filter (where t.is_confirmed)
        from public.ai_lead_transfers t where t.lead_id = l.id
      ) = 0
      and (
        select count(*) filter (where t.transfer_status in ('pending', 'expired'))
        from public.ai_lead_transfers t where t.lead_id = l.id
      ) >= 3
  ),
  expire_pending as (
    update public.ai_lead_transfers t
    set transfer_status = 'expired'
    where t.lead_id in (select id from loop_leads)
      and t.transfer_status = 'pending'
      and t.is_confirmed = false
    returning t.lead_id
  )
  update public.ai_crm_leads l
  set status = 'inativo',
      assigned_to_id = null,
      disponivel_repasse = true,
      repasse_motivo = 'loop_watchdog',
      last_interaction_at = now()
  where l.id in (select id from loop_leads);
end;
$$;

-- Agenda a cada 5 minutos (mesmo padrão dos outros crons do projeto).
-- cron.schedule faz upsert pelo nome do job, então reaplicar é seguro.
select cron.schedule(
  'repasse-antiloop-5min',
  '*/5 * * * *',
  $$select public.cron_repasse_antiloop()$$
);
