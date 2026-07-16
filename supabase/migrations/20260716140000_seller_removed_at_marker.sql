-- ============================================================================
-- REGRA: banimento só nasce de REMOÇÃO EXPLÍCITA, nunca de ausência de vínculo.
--
-- Incidente 16/07 (Lucas Montoani / Mônaco): usuário de MARKETING (visible_features
-- com __restrito + agent_jose + agent_pedro, fora do time de vendas) tem
-- is_active=false por natureza — ele nunca terá vínculo de VENDAS ativo. A
-- regularização de 14/07 leu "sem vínculo ativo" como "foi removido" e baniu o login
-- permanentemente. Prova de que não houve remoção real: a remoção oficial
-- (delete-responsavel) ESVAZIA visible_features, e o dele estava íntegro (31 campos).
--
-- Este marcador separa as duas coisas: só quem passou pela remoção oficial recebe
-- removed_at. NULL = nunca foi removido => JAMAIS pode ser banido por heurística.
-- Passo 1/3 (coluna). Passo 2 = edge delete-responsavel carimba; passo 3 = RPC exige.
-- Aplicada em prod (seyljsqmhlopkcauhlor) via MCP em 16/07; registro local.
-- ============================================================================
ALTER TABLE public.ai_team_members
  ADD COLUMN IF NOT EXISTS removed_at timestamptz;

COMMENT ON COLUMN public.ai_team_members.removed_at IS
  'Marcador de REMOÇÃO EXPLÍCITA (delete-responsavel). NULL = nunca removido: revoke_seller_login NÃO pode banir. Não confundir com is_active=false (fora do rodízio de vendas — normal p/ usuário de marketing/tráfego).';

CREATE INDEX IF NOT EXISTS ai_team_members_removed_at_idx
  ON public.ai_team_members (auth_user_id) WHERE removed_at IS NOT NULL;
