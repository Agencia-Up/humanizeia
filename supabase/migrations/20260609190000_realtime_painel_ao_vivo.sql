-- ============================================================================
-- Painel ao Vivo (DashboardTV) — ligar REALTIME nas tabelas que ele assina.
-- ----------------------------------------------------------------------------
-- O painel já tem subscriptions (ai_crm_leads, crm_leads, ai_lead_transfers,
-- campaign_costs, ai_team_members), mas essas tabelas NÃO estavam na publicação
-- supabase_realtime — então o evento nunca disparava e o painel só atualizava
-- no polling de 30s. Adicionando à publicação, ele passa a atualizar NA HORA
-- que um lead novo chega.
--
-- RLS continua valendo: cada cliente só recebe via realtime os registros que já
-- pode ver. Não vaza dado entre contas.
-- ============================================================================

ALTER PUBLICATION supabase_realtime ADD TABLE public.ai_crm_leads;
ALTER PUBLICATION supabase_realtime ADD TABLE public.crm_leads;
ALTER PUBLICATION supabase_realtime ADD TABLE public.ai_lead_transfers;
ALTER PUBLICATION supabase_realtime ADD TABLE public.campaign_costs;
ALTER PUBLICATION supabase_realtime ADD TABLE public.ai_team_members;
