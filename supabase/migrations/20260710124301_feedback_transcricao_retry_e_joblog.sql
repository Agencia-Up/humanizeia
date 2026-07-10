-- Item 3: retry de transcricao de audio — colunas de controle (nunca inutiliza
-- o audio por falha temporaria; nao repete infinitamente). Aplicada em prod via MCP.
ALTER TABLE public.feedback_transcricoes
  ADD COLUMN IF NOT EXISTS tentativas int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS erro text;

-- Item 10: log rastreavel das rotinas/cron do feedback (qual funcao/tenant/lead
-- falhou). RLS ligada SEM policy publica => so service_role (edge/cron) e
-- superadmin (SQL) acessam — nao vaza entre tenants.
CREATE TABLE IF NOT EXISTS public.feedback_job_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  funcao text NOT NULL,
  tenant_id uuid,
  lead_id uuid,
  status text NOT NULL DEFAULT 'ok',
  detalhe jsonb,
  erro text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.feedback_job_log ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_feedback_job_log_funcao_criado ON public.feedback_job_log (funcao, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_job_log_tenant ON public.feedback_job_log (tenant_id, created_at DESC);
