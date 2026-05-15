-- ===========================================================================
-- Fix: master não conseguia ver anotações criadas pelos vendedores dele
-- ===========================================================================
-- Bug: a policy 'owner_manage_notes' usa user_id = auth.uid(), mas o user_id
-- de uma anotação é o auth.uid() de QUEM CRIOU (vendedor), não do master.
-- Resultado: master abre lead → notas não aparecem mesmo com seller_notes_count
-- mostrando o número certo no badge do kanban.
--
-- Solução: nova policy SELECT que permite master ler notas feitas por qualquer
-- membro da equipe dele (ai_team_members.user_id = auth.uid()).
-- Não modifica policies existentes — apenas ADICIONA acesso pro master.
-- ===========================================================================

CREATE POLICY "master_view_seller_notes" ON public.pedro_crm_notes
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.ai_team_members atm
      WHERE atm.id = pedro_crm_notes.member_id
        AND atm.user_id = auth.uid()
    )
  );

COMMENT ON POLICY "master_view_seller_notes" ON public.pedro_crm_notes IS
  'Permite que o master leia anotações criadas por qualquer membro da equipe dele (vendedores). Aditiva — não modifica policies existentes.';
