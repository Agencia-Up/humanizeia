-- Fix: permitir exclusão de vendedor (ai_team_members) em PROD.
--
-- Bug reportado: ao excluir um vendedor o app retorna erro 23503
--   "update or delete on table ai_team_members violates foreign key
--    constraint ai_lead_transfers_to_member_id_fkey on table ai_lead_transfers"
--
-- Causa raiz (drift de schema PROD x STAGING):
--   PROD:    ai_lead_transfers_to_member_id_fkey = ON DELETE RESTRICT  (bloqueia)
--   STAGING: ai_lead_transfers_to_member_id_fkey = ON DELETE CASCADE   (funciona, validado)
--
-- ai_lead_transfers.to_member_id é NOT NULL, portanto ON DELETE SET NULL
-- nao e viavel. CASCADE e a unica opcao que permite a exclusao e tambem
-- reproduz o estado ja validado em staging.
--
-- Efeito: ao excluir um vendedor, as linhas de ai_lead_transfers em que ele
-- foi o destinatario (to_member_id) sao removidas junto (historico de transferencia).

ALTER TABLE public.ai_lead_transfers
  DROP CONSTRAINT IF EXISTS ai_lead_transfers_to_member_id_fkey;

ALTER TABLE public.ai_lead_transfers
  ADD CONSTRAINT ai_lead_transfers_to_member_id_fkey
  FOREIGN KEY (to_member_id) REFERENCES public.ai_team_members(id) ON DELETE CASCADE;
