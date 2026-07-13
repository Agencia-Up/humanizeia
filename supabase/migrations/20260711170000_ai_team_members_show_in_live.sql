-- Visibilidade no PAINEL AO VIVO (DashboardTV) e Painel Geral como campo DEDICADO,
-- separando do active_in_system (que é "ativo no sistema inteiro" — CRM, comercial,
-- inbox, kanban...). RAIZ do problema: active_in_system fazia papel duplo e era forçado
-- true pro Gerente, obrigando ele a aparecer no painel. Agora quem controla o painel é
-- show_in_live, controlável por pessoa na tela de Responsáveis (toggle "Aparece nos painéis").
-- Aplicada em prod via MCP (11/07); este arquivo é a versão fiel em Git.
ALTER TABLE public.ai_team_members
  ADD COLUMN IF NOT EXISTS show_in_live boolean NOT NULL DEFAULT true;
COMMENT ON COLUMN public.ai_team_members.show_in_live IS
  'Aparece no Painel ao Vivo (DashboardTV) e Painel Geral. Independe de active_in_system. Gerente/placeholder = false por padrão.';

-- Backfill: vendedores mantêm o comportamento atual (true = aparecem). Gerentes e
-- placeholders saem do painel por padrão (não são vendedor de produção), mas continuam
-- active_in_system=true (seguem no sistema) e podem ser religados na tela de Responsáveis.
UPDATE public.ai_team_members SET show_in_live = false WHERE is_manager = true;

CREATE INDEX IF NOT EXISTS idx_ai_team_members_show_in_live
  ON public.ai_team_members(user_id, show_in_live);
