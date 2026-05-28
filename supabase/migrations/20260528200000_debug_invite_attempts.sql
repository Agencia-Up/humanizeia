-- Tabela TEMPORÁRIA pra debug do bug invite-seller (28/05/2026).
-- Edge function `invite-seller` insere uma row aqui pra cada chamada
-- generate_link do GoTrue, capturando status + raw response sanitizado.
-- Depois que o bug for resolvido, dropar essa tabela.
CREATE TABLE IF NOT EXISTS public._debug_invite_attempts (
  id bigserial PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  member_id uuid NULL,
  email text NULL,
  redirect_to text NULL,
  attempt jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_debug_invite_attempts_created
  ON public._debug_invite_attempts (created_at DESC);

-- Sem RLS — eh tabela de debug, acessada via service_role da edge function
-- + leitura via CLI direto. Nao expor pra usuario final.
ALTER TABLE public._debug_invite_attempts ENABLE ROW LEVEL SECURITY;

-- RAISE NOTICE pra confirmar criacao
DO $$
BEGIN
  RAISE NOTICE '[debug] Tabela _debug_invite_attempts criada/verificada';
END $$;
