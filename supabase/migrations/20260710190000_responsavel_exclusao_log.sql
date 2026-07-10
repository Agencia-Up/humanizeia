-- Log de auditoria da exclusao de responsavel (edge delete-responsavel).
-- Registra QUEM excluiu, o alvo e o que foi removido — sem tocar em historico de
-- leads/conversas. So o master da conta le o proprio log (RLS por user_id);
-- a escrita e feita pela edge com service_role (bypassa RLS).
CREATE TABLE IF NOT EXISTS public.responsavel_exclusao_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,                 -- conta (master) dona do responsavel excluido
  excluido_por uuid NOT NULL,            -- auth.uid() de quem disparou a exclusao
  alvo_whatsapp text,                    -- numero nacional canonico do alvo (55+DDD+numero)
  alvo_nome text,
  membros_removidos int NOT NULL DEFAULT 0,
  responsaveis_removidos int NOT NULL DEFAULT 0,
  detalhe jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_responsavel_exclusao_log_user
  ON public.responsavel_exclusao_log (user_id, created_at DESC);

ALTER TABLE public.responsavel_exclusao_log ENABLE ROW LEVEL SECURITY;

-- Master le o proprio log. Escrita/edicao so via service_role (sem policy = negado
-- para authenticated; service_role ignora RLS).
DROP POLICY IF EXISTS resp_exclusao_log_owner_select ON public.responsavel_exclusao_log;
CREATE POLICY resp_exclusao_log_owner_select ON public.responsavel_exclusao_log
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());
