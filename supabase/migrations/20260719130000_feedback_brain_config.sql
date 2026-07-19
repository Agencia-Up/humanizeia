-- ============================================================================
-- Cerebro de Feedback configuravel (camada de INTELIGENCIA por tenant).
--
-- Arquitetura protegida:
--   [prompt padrao Logos OU camada personalizada deste tenant]
--   + [contrato tecnico obrigatorio FIXO (instrucaoContrato no analista)]
--   + [conversa/contexto do lead]
--   = IA responde JSON valido no formato esperado
--
-- O usuario personaliza APENAS a camada de inteligencia; o contrato tecnico
-- (chaves obrigatorias do JSON) e SEMPRE anexado pelo codigo e nao pode ser
-- removido por configuracao.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.feedback_brain_config (
  tenant_id            uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  enabled              boolean NOT NULL DEFAULT false,
  name                 text,
  specialist_prompt    text,
  evaluation_criteria  text,
  tone                 text NOT NULL DEFAULT 'direto',
  never_do             text,
  version              integer NOT NULL DEFAULT 1,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fbc_tone_chk     CHECK (tone IN ('direto','consultivo','educativo','exigente')),
  CONSTRAINT fbc_name_len     CHECK (name IS NULL OR length(name) <= 120),
  CONSTRAINT fbc_prompt_len   CHECK (specialist_prompt IS NULL OR length(specialist_prompt) <= 8000),
  CONSTRAINT fbc_criteria_len CHECK (evaluation_criteria IS NULL OR length(evaluation_criteria) <= 8000),
  CONSTRAINT fbc_neverdo_len  CHECK (never_do IS NULL OR length(never_do) <= 4000)
);

COMMENT ON TABLE public.feedback_brain_config IS
  'Camada personalizada de inteligencia do Cerebro de Feedback por tenant. O contrato tecnico do JSON e fixo no codigo (analista.ts) e NUNCA pode ser substituido por esta config.';

-- updated_at + version automaticos quando o conteudo do cerebro muda.
CREATE OR REPLACE FUNCTION public.feedback_brain_config_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  IF (COALESCE(NEW.specialist_prompt,'') IS DISTINCT FROM COALESCE(OLD.specialist_prompt,''))
     OR (COALESCE(NEW.evaluation_criteria,'') IS DISTINCT FROM COALESCE(OLD.evaluation_criteria,''))
     OR (COALESCE(NEW.never_do,'') IS DISTINCT FROM COALESCE(OLD.never_do,''))
     OR (NEW.tone IS DISTINCT FROM OLD.tone)
     OR (COALESCE(NEW.name,'') IS DISTINCT FROM COALESCE(OLD.name,'')) THEN
    NEW.version := COALESCE(OLD.version, 1) + 1;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_feedback_brain_config_touch ON public.feedback_brain_config;
CREATE TRIGGER trg_feedback_brain_config_touch
  BEFORE UPDATE ON public.feedback_brain_config
  FOR EACH ROW EXECUTE FUNCTION public.feedback_brain_config_touch();

-- RLS: SOMENTE o master da conta (tenant_id = auth.uid()) le/edita.
-- Vendedor tem auth.uid() proprio (diferente do tenant) -> bloqueado.
-- Service role (edge functions) ignora RLS por definicao.
ALTER TABLE public.feedback_brain_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fbc_master_select ON public.feedback_brain_config;
CREATE POLICY fbc_master_select ON public.feedback_brain_config
  FOR SELECT USING (tenant_id = auth.uid());

DROP POLICY IF EXISTS fbc_master_insert ON public.feedback_brain_config;
CREATE POLICY fbc_master_insert ON public.feedback_brain_config
  FOR INSERT WITH CHECK (tenant_id = auth.uid());

DROP POLICY IF EXISTS fbc_master_update ON public.feedback_brain_config;
CREATE POLICY fbc_master_update ON public.feedback_brain_config
  FOR UPDATE USING (tenant_id = auth.uid()) WITH CHECK (tenant_id = auth.uid());

DROP POLICY IF EXISTS fbc_master_delete ON public.feedback_brain_config;
CREATE POLICY fbc_master_delete ON public.feedback_brain_config
  FOR DELETE USING (tenant_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.feedback_brain_config TO authenticated;
REVOKE ALL ON public.feedback_brain_config FROM anon;
