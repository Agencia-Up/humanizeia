-- ============================================================================
-- Repasse Fase 2 — Bolsão (leads parados, sem dono, pra atribuir no painel)
-- ----------------------------------------------------------------------------
-- Quando um vendedor sai, os leads PARADOS dele (inativo / pouco_qualificado)
-- não são empurrados pra outro vendedor (isso é só pros ATIVOS). Em vez disso
-- caem num "bolsão": ficam sem dono (assigned_to_id = null) e marcados como
-- disponíveis pra repasse. No Painel ao Vivo o gestor vê esses leads e atribui
-- cada um pro vendedor que quiser.
--
-- Aditivo e idempotente. NÃO mexe em RLS: o master já enxerga/edita os próprios
-- leads (user_id = auth.uid()), que é tudo que o fluxo "gestor atribui no painel"
-- precisa.
-- ============================================================================

alter table public.ai_crm_leads
  add column if not exists disponivel_repasse boolean not null default false;

alter table public.ai_crm_leads
  add column if not exists repasse_motivo text;

-- Índice parcial: a consulta do bolsão é sempre "leads do dono com a flag ligada".
create index if not exists idx_ai_crm_leads_pool
  on public.ai_crm_leads (user_id)
  where disponivel_repasse = true;

comment on column public.ai_crm_leads.disponivel_repasse is
  'Lead no bolsão de repasse (sem dono, disponível pra o gestor atribuir). Fase 2.';
comment on column public.ai_crm_leads.repasse_motivo is
  'Origem do repasse atual: repasse_parado | repasse_marcos | repasse_tf | etc.';
