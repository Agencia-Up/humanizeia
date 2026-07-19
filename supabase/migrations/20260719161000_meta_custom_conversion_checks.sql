-- ============================================================================
-- Fluxo ASSISTIDO de Custom Conversions (checklist manual — SEM Graph API).
--
-- Os eventos de qualidade (LeadQualificado, LeadPoucoQualificado, LeadRuim,
-- Purchase) sao EVENTOS CUSTOMIZADOS enviados ao Pixel via CAPI. O envio NAO
-- cria automaticamente uma Custom Conversion no Business Manager — o gestor
-- precisa criar manualmente na Meta. Esta tabela registra APENAS o checklist
-- "ja configurei esse evento na Meta" por conta, para a tela de saude/CAPI.
--
-- NAO altera o envio CAPI, NAO chama a Graph API, NAO cria conversao.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.meta_custom_conversion_checks (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_name        text NOT NULL,
  marked_configured boolean NOT NULL DEFAULT false,
  checked_at        timestamptz,
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mccc_event_chk CHECK (event_name IN (
    'LeadQualificado', 'LeadPoucoQualificado', 'LeadRuim', 'Purchase'
  )),
  CONSTRAINT mccc_user_event_uniq UNIQUE (user_id, event_name)
);

COMMENT ON TABLE public.meta_custom_conversion_checks IS
  'Checklist manual por conta: "criei a Custom Conversion na Meta para o evento X". Somente marcacao do usuario — NAO reflete estado real na Meta e NAO dispara nenhuma acao na Graph API.';
COMMENT ON COLUMN public.meta_custom_conversion_checks.marked_configured IS
  'Marcado pelo gestor quando ele criou a Custom Conversion no Business Manager. Informativo; nao valida na Meta.';

-- updated_at automatico
CREATE OR REPLACE FUNCTION public.meta_ccc_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_meta_ccc_touch ON public.meta_custom_conversion_checks;
CREATE TRIGGER trg_meta_ccc_touch
  BEFORE UPDATE ON public.meta_custom_conversion_checks
  FOR EACH ROW EXECUTE FUNCTION public.meta_ccc_touch();

-- RLS: cada conta (master/billing owner) enxerga e edita SO as proprias linhas.
-- Mesmo padrao tenant do feedback_brain_config (user_id = auth.uid()).
ALTER TABLE public.meta_custom_conversion_checks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mccc_select_own ON public.meta_custom_conversion_checks;
CREATE POLICY mccc_select_own ON public.meta_custom_conversion_checks
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS mccc_insert_own ON public.meta_custom_conversion_checks;
CREATE POLICY mccc_insert_own ON public.meta_custom_conversion_checks
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS mccc_update_own ON public.meta_custom_conversion_checks;
CREATE POLICY mccc_update_own ON public.meta_custom_conversion_checks
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS mccc_delete_own ON public.meta_custom_conversion_checks;
CREATE POLICY mccc_delete_own ON public.meta_custom_conversion_checks
  FOR DELETE TO authenticated USING (user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.meta_custom_conversion_checks TO authenticated;
REVOKE ALL ON public.meta_custom_conversion_checks FROM anon;
