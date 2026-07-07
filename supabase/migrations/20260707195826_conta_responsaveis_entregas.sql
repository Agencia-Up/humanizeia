-- Responsaveis & entregas: fonte UNICA de "quem recebe o que" no nivel da CONTA.
-- Uma pessoa por numero (por tenant). As entregas de conta (relatorio de
-- atendimento do Cerebro, relatorio do trafego do Jose, alertas) ficam AQUI,
-- nao mais soltas em wa_ai_agents.gerente_phone / feedback_config.numero_gerente.
-- Leads continuam na matriz ai_team_members (por agente); esta tabela guarda
-- SO as entregas de conta. Tela "Responsaveis" mescla as pessoas (team) com estas
-- entregas por numero (ultimos 8 digitos). Aplicada em prod via MCP em 07/07/2026.
CREATE TABLE IF NOT EXISTS public.conta_responsaveis (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  nome text,
  whatsapp text NOT NULL,
  recebe_atendimento boolean NOT NULL DEFAULT false,
  recebe_trafego boolean NOT NULL DEFAULT false,
  recebe_alertas boolean NOT NULL DEFAULT false,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, whatsapp)
);

CREATE INDEX IF NOT EXISTS idx_conta_responsaveis_user ON public.conta_responsaveis (user_id);

ALTER TABLE public.conta_responsaveis ENABLE ROW LEVEL SECURITY;

-- V1: tela administrativa da conta master. So o dono (auth.uid() = user_id) le/gerencia.
DROP POLICY IF EXISTS conta_resp_select ON public.conta_responsaveis;
CREATE POLICY conta_resp_select ON public.conta_responsaveis
  FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS conta_resp_insert ON public.conta_responsaveis;
CREATE POLICY conta_resp_insert ON public.conta_responsaveis
  FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS conta_resp_update ON public.conta_responsaveis;
CREATE POLICY conta_resp_update ON public.conta_responsaveis
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS conta_resp_delete ON public.conta_responsaveis;
CREATE POLICY conta_resp_delete ON public.conta_responsaveis
  FOR DELETE USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.tg_conta_responsaveis_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_conta_resp_touch ON public.conta_responsaveis;
CREATE TRIGGER trg_conta_resp_touch
  BEFORE UPDATE ON public.conta_responsaveis
  FOR EACH ROW EXECUTE FUNCTION public.tg_conta_responsaveis_touch();
