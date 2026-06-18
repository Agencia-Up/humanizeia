-- ============================================================================
-- AUDITORIA de consumo de tokens de IA (OpenAI etc.) por cliente/agente.
-- ----------------------------------------------------------------------------
-- OBJETIVO (decidido com Wander):
--   Camada de AUDITORIA/forense (NAO de cobranca). So-registro, sem corte
--   automatico. Visivel SO para o superadmin (god-view cross-cliente/agente)
--   + flags de anomalia. O cliente NAO ve nada disto.
--
-- Diferenca para consumo_ia (billing): aquela e rollup por lead/ciclo p/ cobrar;
--   esta e POR TURNO/CHAMADA com agente, tipo de disparo e trace_id p/ investigar
--   anomalia (loop de tool-calling, cliente fora da curva, abuso).
--
-- DECISOES QUE MOLDAM O SCHEMA:
--   (1) NAO TOCA em consumo_ia / pedro_billed_leads (billing intacto).
--   (2) Reaproveita preco_modelo p/ derivar custo_usd NO BANCO (trigger), com a
--       MESMA formula da vw_custo_pedro_lead. BRL nunca e persistido: derivado
--       on-the-fly do config_cobranca.cambio_usd_brl nas queries/RPCs.
--   (3) Pedro = 1 linha por TURNO (agrega as sub-chamadas; n_subcalls conta).
--       Demais funcoes = 1 linha por chamada.
--
-- PRECISAO: token sempre INTEGER; dinheiro sempre NUMERIC.
-- Idempotente: CREATE ... IF NOT EXISTS. Blast radius: so cria objetos novos.
-- ============================================================================

-- (1) Log por chamada/turno ---------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ai_call_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  trace_id        text,                         -- correlaciona o turno (newTraceId no Pedro)
  user_id         uuid NOT NULL,                -- TENANT (conta master) = wa_instances.user_id
  agent_id        uuid,                         -- wa_ai_agents.id (null p/ chamadas sem agente)
  agent_name      text,                         -- desnormalizado p/ forense barata (evita join)
  disparo_tipo    text NOT NULL DEFAULT 'outro',
  provedor        text NOT NULL DEFAULT 'openai',
  modelo          text NOT NULL,
  input_tokens    integer NOT NULL DEFAULT 0,
  output_tokens   integer NOT NULL DEFAULT 0,
  total_tokens    integer NOT NULL DEFAULT 0,
  n_subcalls      integer NOT NULL DEFAULT 1,   -- Pedro: nº de fetches gpt-4o no turno
  custo_usd       numeric(14,8) NOT NULL DEFAULT 0,  -- preenchido pelo trigger via preco_modelo
  evento_origem   text,                         -- wa_message_id / lead_id / jid mascarado
  latencia_ms     integer,
  status          text NOT NULL DEFAULT 'ok',
  meta            jsonb,
  CONSTRAINT ai_call_log_disparo_chk CHECK (disparo_tipo IN (
    'inbound_pedro','followup_auto','reativacao','broadcast_marcos',
    'jose_apollo','social_media','claude_chat','transcricao_audio',
    'embedding','manual_test','outro')),
  CONSTRAINT ai_call_log_status_chk CHECK (status IN ('ok','error','partial','fallback'))
);

CREATE INDEX IF NOT EXISTS idx_ai_call_log_user_time  ON public.ai_call_log (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_call_log_agent_time ON public.ai_call_log (agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_call_log_disparo    ON public.ai_call_log (disparo_tipo, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_call_log_trace      ON public.ai_call_log (trace_id);
CREATE INDEX IF NOT EXISTS idx_ai_call_log_modelo     ON public.ai_call_log (provedor, modelo);
CREATE INDEX IF NOT EXISTS idx_ai_call_log_created    ON public.ai_call_log (created_at DESC);

-- Dado de auditoria nao vaza pro cliente. RLS ON e SEM policy publica: ninguem
-- autenticado le direto; service_role (edge/cron) grava/le; a UI le via RPC
-- SECURITY DEFINER gated por superadmin (Fase 3). Mesmo padrao do consumo_ia.
ALTER TABLE public.ai_call_log ENABLE ROW LEVEL SECURITY;

-- (2) Flags de anomalia (so-registro, sem corte) ------------------------------
CREATE TABLE IF NOT EXISTS public.ai_anomaly_flags (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  window_label    text,                         -- 'hourly' | 'daily'
  rule            text NOT NULL,                -- 'spike_vs_7d_avg' | 'subcall_loop' | 'absolute_daily_cap'
  severity        text NOT NULL DEFAULT 'info',
  user_id         uuid,
  agent_id        uuid,
  trace_id        text,
  metric_value    numeric,
  threshold_value numeric,
  details         jsonb,
  CONSTRAINT ai_anomaly_severity_chk CHECK (severity IN ('info','warn','critical'))
);

CREATE INDEX IF NOT EXISTS idx_ai_anomaly_created ON public.ai_anomaly_flags (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_anomaly_user    ON public.ai_anomaly_flags (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_anomaly_rule    ON public.ai_anomaly_flags (rule, created_at DESC);

-- Leitura so superadmin (reusa _is_caller_superadmin). Cron/edge grava via
-- service_role (bypassa RLS). Mesmo padrao do pedro_v2_health_reports.
ALTER TABLE public.ai_anomaly_flags ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ai_anomaly_superadmin_read" ON public.ai_anomaly_flags;
CREATE POLICY "ai_anomaly_superadmin_read" ON public.ai_anomaly_flags
  FOR SELECT TO authenticated USING (public._is_caller_superadmin());

-- (3) Custo USD derivado de preco_modelo (mesma formula da vw_custo_pedro_lead)
CREATE OR REPLACE FUNCTION public.ai_cost_usd(
  p_provedor text, p_modelo text, p_input integer, p_output integer
) RETURNS numeric
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
      (COALESCE(p_input,0)::numeric  / 1000000.0) * pm.usd_por_1m_input
    + (COALESCE(p_output,0)::numeric / 1000000.0) * pm.usd_por_1m_output
  , 0)
  FROM public.preco_modelo pm
  WHERE pm.provedor = p_provedor AND pm.modelo = p_modelo
  LIMIT 1;
$$;

-- Trigger BEFORE INSERT: preenche total_tokens e custo_usd. Modelo desconhecido
-- em preco_modelo -> custo 0 + meta.preco_missing=true (NUNCA derruba o INSERT).
-- Se a linha trouxe so total (sem split input/output), aproxima o custo pelo
-- split do billing (config_cobranca.pedro_split_input) SEM sobrescrever as
-- colunas medidas (input/output ficam como vieram).
CREATE OR REPLACE FUNCTION public.ai_call_log_fill_cost()
RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_in    integer := COALESCE(NEW.input_tokens, 0);
  v_out   integer := COALESCE(NEW.output_tokens, 0);
  v_tot   integer := COALESCE(NEW.total_tokens, 0);
  v_split numeric;
  v_cost  numeric;
BEGIN
  -- total defensivo
  IF v_tot = 0 AND (v_in + v_out) > 0 THEN
    v_tot := v_in + v_out;
    NEW.total_tokens := v_tot;
  END IF;

  -- so veio total -> aproxima input/output (apenas p/ custo)
  IF (v_in + v_out) = 0 AND v_tot > 0 THEN
    SELECT pedro_split_input INTO v_split FROM public.config_cobranca WHERE id = 1;
    v_split := COALESCE(v_split, 0.8);
    v_in  := round(v_tot * v_split);
    v_out := v_tot - v_in;
  END IF;

  IF NEW.custo_usd IS NULL OR NEW.custo_usd = 0 THEN
    v_cost := public.ai_cost_usd(NEW.provedor, NEW.modelo, v_in, v_out);
    IF v_cost IS NULL THEN
      NEW.custo_usd := 0;
      NEW.meta := COALESCE(NEW.meta, '{}'::jsonb) || jsonb_build_object('preco_missing', true);
    ELSE
      NEW.custo_usd := v_cost;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ai_call_log_fill_cost ON public.ai_call_log;
CREATE TRIGGER trg_ai_call_log_fill_cost
  BEFORE INSERT ON public.ai_call_log
  FOR EACH ROW EXECUTE FUNCTION public.ai_call_log_fill_cost();

COMMENT ON TABLE public.ai_call_log IS
  'AUDITORIA forense de consumo de IA por turno/chamada (cliente+agente+disparo_tipo+trace). So-registro; so superadmin le via RPC. NAO e billing (ver consumo_ia).';
COMMENT ON TABLE public.ai_anomaly_flags IS
  'Flags de consumo anomalo (so-registro, sem corte). Geradas pelo cron/edge ai-audit-anomaly. Leitura so superadmin.';
