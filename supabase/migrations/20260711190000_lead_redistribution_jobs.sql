-- Repasse PROGRAMADO dos leads de um vendedor que saiu: distribui pro time aos poucos,
-- no ritmo do gestor (X por vendedor a cada Y min). Um robô (cron a cada 5 min) processa
-- uma RODADA por vez chamando a edge redistribute-job (action=run_round). Nunca dispara
-- tudo de uma vez (protege o número). Aplicada em prod via MCP (11/07); versão fiel em Git.
CREATE TABLE IF NOT EXISTS public.lead_redistribution_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  from_member_id uuid NOT NULL,
  from_member_name text,
  por_vendedor int NOT NULL DEFAULT 5,
  intervalo_min int NOT NULL DEFAULT 30,
  seller_ids uuid[],
  status text NOT NULL DEFAULT 'ativo',   -- ativo | pausado | concluido | cancelado
  total_alvo int NOT NULL DEFAULT 0,
  total_repassados int NOT NULL DEFAULT 0,
  ultimo_lote int NOT NULL DEFAULT 0,
  next_run_at timestamptz NOT NULL DEFAULT now(),
  last_run_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lrj_status_next ON public.lead_redistribution_jobs (status, next_run_at);
CREATE INDEX IF NOT EXISTS idx_lrj_tenant_from ON public.lead_redistribution_jobs (tenant_id, from_member_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_lrj_um_vivo_por_vendedor
  ON public.lead_redistribution_jobs (tenant_id, from_member_id)
  WHERE status IN ('ativo','pausado');

ALTER TABLE public.lead_redistribution_jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lrj_owner_all ON public.lead_redistribution_jobs;
CREATE POLICY lrj_owner_all ON public.lead_redistribution_jobs
  FOR ALL USING (tenant_id = public.resolve_billing_owner_user_id(auth.uid()))
  WITH CHECK (tenant_id = public.resolve_billing_owner_user_id(auth.uid()));

CREATE OR REPLACE FUNCTION public.tg_lrj_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;
DROP TRIGGER IF EXISTS trg_lrj_updated_at ON public.lead_redistribution_jobs;
CREATE TRIGGER trg_lrj_updated_at BEFORE UPDATE ON public.lead_redistribution_jobs
  FOR EACH ROW EXECUTE FUNCTION public.tg_lrj_updated_at();

CREATE OR REPLACE FUNCTION public.cron_redistribute_jobs_runner()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r record; v_key text;
BEGIN
  SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'service_role_key';
  IF v_key IS NULL THEN RETURN; END IF;
  FOR r IN
    SELECT id FROM public.lead_redistribution_jobs
    WHERE status = 'ativo' AND next_run_at <= now() ORDER BY next_run_at ASC LIMIT 20
  LOOP
    PERFORM net.http_post(
      url := 'https://seyljsqmhlopkcauhlor.supabase.co/functions/v1/redistribute-job',
      body := jsonb_build_object('action','run_round','job_id', r.id),
      params := '{}'::jsonb,
      headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || v_key),
      timeout_milliseconds := 120000);
  END LOOP;
END; $$;
-- cron: SELECT cron.schedule('redistribute-jobs-runner', '*/5 * * * *', 'SELECT public.cron_redistribute_jobs_runner();');
