-- ============================================================================
-- NEPQ · Fase 5 — Fechar o loop com o José (feed de qualidade por campanha)
-- Expõe o sinal de ROTULAGEM INCORRETA (vendedor tratou lead qualificado como
-- ruim) no feed que o José/gestor de tráfego lê — pra o aprendizado das
-- campanhas não ser corrompido por rótulo humano errado. Aditivo: acrescenta
-- colunas NO FIM da view (consumidores atuais inalterados). A métrica de saúde
-- (taxa de divergência) já vive no rollup/dashboard (Fase 2/4).
-- ============================================================================

create or replace view public.feedback_qualidade_por_campanha as
 select tenant_id,
    campanha_id,
    created_at::date as data_ref,
    count(*) as leads_analisados,
    count(*) filter (where qualidade_lead = '1_alto'::feedback_qualidade_lead)   as q_alto,
    count(*) filter (where qualidade_lead = '2_medio'::feedback_qualidade_lead)  as q_medio,
    count(*) filter (where qualidade_lead = '3_baixo'::feedback_qualidade_lead)  as q_baixo,
    count(*) filter (where qualidade_lead = '4_nao_lead'::feedback_qualidade_lead) as q_nao_lead,
    count(*) filter (where (resultado #>> '{perfil_idade,fora_do_perfil}'::text[]) = 'true'::text) as fora_do_perfil,
    -- NOVO (Fase 5): leads que o vendedor tratou/rotulou como ruim sendo bons.
    -- É o sinal que o gestor de tráfego precisa: campanha com lead bom sendo
    -- "queimado" no atendimento (não é problema de tráfego).
    count(*) filter (where veredito = 'rotulagem_incorreta'::feedback_veredito) as rotulagem_incorreta,
    -- leads bem atendidos (lead bom E score>=50) — regra de ouro, p/ o José
    -- separar "lead ruim" de "mal atendido".
    count(*) filter (
      where qualidade_lead in ('1_alto'::feedback_qualidade_lead, '2_medio'::feedback_qualidade_lead)
        and coalesce(score_atendimento, 0) >= 50
    ) as bem_atendidos
   from feedback_conversas
  where status = 'concluido'::feedback_status_analise
  group by tenant_id, campanha_id, (created_at::date);

comment on view public.feedback_qualidade_por_campanha is
  'Feed do José: qualidade por campanha/dia. Fase 5 acrescentou rotulagem_incorreta (lead bom queimado no atendimento) e bem_atendidos (regra de ouro), pra o aprendizado da campanha não ser corrompido por rótulo humano errado.';

-- Self-check: as colunas novas precisam existir na view.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='feedback_qualidade_por_campanha'
      and column_name='rotulagem_incorreta'
  ) then
    raise exception 'NEPQ Fase 5: coluna rotulagem_incorreta ausente no feed do José';
  end if;
end $$;
