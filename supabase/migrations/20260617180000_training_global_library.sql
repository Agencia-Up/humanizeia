-- ============================================================================
-- Treinamento = biblioteca GLOBAL (uma só, da Logos) — todas as contas ASSISTEM
-- ----------------------------------------------------------------------------
-- Antes era por conta (cada master tinha o proprio, RLS auth.uid()=user_id).
-- Agora e uma biblioteca unica: o superadmin (Logos) sobe as aulas (is_global=true)
-- e TODA conta autenticada VE (so leitura). So o superadmin edita.
-- ============================================================================

ALTER TABLE public.training_sections ADD COLUMN IF NOT EXISTS is_global boolean NOT NULL DEFAULT false;
ALTER TABLE public.training_videos   ADD COLUMN IF NOT EXISTS is_global boolean NOT NULL DEFAULT false;

-- Troca as policies por-conta por: todos leem global + so superadmin escreve.
DROP POLICY IF EXISTS training_sections_user ON public.training_sections;
DROP POLICY IF EXISTS training_videos_user   ON public.training_videos;

DROP POLICY IF EXISTS training_sections_read_global ON public.training_sections;
CREATE POLICY training_sections_read_global ON public.training_sections
  FOR SELECT TO authenticated USING (is_global = true);
DROP POLICY IF EXISTS training_videos_read_global ON public.training_videos;
CREATE POLICY training_videos_read_global ON public.training_videos
  FOR SELECT TO authenticated USING (is_global = true);

DROP POLICY IF EXISTS training_sections_admin ON public.training_sections;
CREATE POLICY training_sections_admin ON public.training_sections
  FOR ALL TO authenticated
  USING ((SELECT is_superadmin FROM public.profiles WHERE id = auth.uid()) = true)
  WITH CHECK ((SELECT is_superadmin FROM public.profiles WHERE id = auth.uid()) = true);
DROP POLICY IF EXISTS training_videos_admin ON public.training_videos;
CREATE POLICY training_videos_admin ON public.training_videos
  FOR ALL TO authenticated
  USING ((SELECT is_superadmin FROM public.profiles WHERE id = auth.uid()) = true)
  WITH CHECK ((SELECT is_superadmin FROM public.profiles WHERE id = auth.uid()) = true);

-- Seed do curriculo (so se ainda nao houver secao global). Dono = superadmin Wander.
INSERT INTO public.training_sections (user_id, title, description, sort_order, is_global)
SELECT '249610ea-94c7-41e5-9c19-d9d0841a65e6'::uuid, t.title, t.descr, t.ord, true
FROM (VALUES
  (0, 'Primeiros Passos — Conheça a Logos IA', 'Visão geral da plataforma, primeiro acesso, conectar o WhatsApp e entender o painel.'),
  (1, 'Pedro — Atendimento no WhatsApp (SDR com IA)', 'Configurar o agente Pedro: comportamento, regras de qualificação, mensagens, equipe de vendedores e transferência de leads.'),
  (2, 'Marcos — CRM e Disparo em Massa', 'Kanban de leads, base de contatos, disparo em massa no WhatsApp, instâncias e automações.'),
  (3, 'José — Tráfego Pago (Meta e Google Ads)', 'Conectar contas de anúncio, gerenciar campanhas, ler as métricas e o custo por lead.'),
  (4, 'Painéis e Métricas', 'Painel Geral, Painel ao Vivo, metas de vendas e funil — como acompanhar os resultados.'),
  (5, 'Equipe, Vendedores e Permissões', 'Adicionar vendedores e gerente e configurar o que cada um pode ver.'),
  (6, 'Plano, Conversas e Configurações', 'Meu Plano, saldo da chave OpenAI e conversas, integrações e dados da empresa.')
) AS t(ord, title, descr)
WHERE NOT EXISTS (SELECT 1 FROM public.training_sections WHERE is_global = true);
