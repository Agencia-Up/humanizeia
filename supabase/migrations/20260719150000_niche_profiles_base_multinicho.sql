-- ============================================================================
-- BASE MINIMA PARA MULTI-NICHO (preparatoria — NAO muda comportamento atual).
--
-- A Logos hoje opera 100% automotivo. Esta tabela registra os PERFIS de nicho
-- (mapeamentos de qualidade, eventos CAPI e rotulos/sinais) para que, no
-- futuro, Feedback/Jose/CAPI possam ler a configuracao do nicho da conta em
-- vez de valores fixos. NENHUM fluxo em producao le esta tabela ainda: o
-- automotivo continua sendo o padrao hardcoded ate a fase de adocao.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.niche_profiles (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug           text NOT NULL UNIQUE,
  name           text NOT NULL,
  description    text,
  is_active      boolean NOT NULL DEFAULT true,
  quality_mapping jsonb NOT NULL DEFAULT '{}'::jsonb,
  event_mapping   jsonb NOT NULL DEFAULT '{}'::jsonb,
  signal_schema   jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.niche_profiles IS
  'Base preparatoria para multi-nicho. Perfis de nicho com mapeamentos de qualidade (feedback->universal->CRM), eventos CAPI e schema de sinais. O comportamento atual em producao continua AUTOMOTIVO e hardcoded — nenhum fluxo depende desta tabela ainda.';
COMMENT ON COLUMN public.niche_profiles.quality_mapping IS
  'Mapeamentos de qualidade: feedback_to_universal (1_alto->high...), universal_to_crm (high->bom...), crm_values. Fonte futura para Feedback/Pedro/Jose.';
COMMENT ON COLUMN public.niche_profiles.event_mapping IS
  'Mapeamento CRM->evento CAPI (bom->LeadQualificado, medio->LeadPoucoQualificado, ruim->LeadRuim) + purchase_event. NOTA: LeadQualificado/LeadPoucoQualificado/LeadRuim sao EVENTOS CUSTOMIZADOS enviados ao Pixel via CAPI — isso NAO cria automaticamente uma Custom Conversion no Business Manager; a criacao via Graph API fica para fase futura.';
COMMENT ON COLUMN public.niche_profiles.signal_schema IS
  'Rotulos e sinais do nicho (product_label, seller_label, deal_label, signals[]). Hoje espelha o contrato automotivo do analista.';

-- updated_at automatico
CREATE OR REPLACE FUNCTION public.niche_profiles_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_niche_profiles_touch ON public.niche_profiles;
CREATE TRIGGER trg_niche_profiles_touch
  BEFORE UPDATE ON public.niche_profiles
  FOR EACH ROW EXECUTE FUNCTION public.niche_profiles_touch();

-- Seed/upsert do perfil padrao AUTOMOTIVO (espelha o comportamento atual).
INSERT INTO public.niche_profiles (slug, name, description, is_active, quality_mapping, event_mapping, signal_schema)
VALUES (
  'automotive',
  'Automotivo',
  'Perfil padrao da Logos (lojas/concessionarias de veiculos). Espelha o comportamento hardcoded atual de Feedback, Pedro, Jose e CAPI.',
  true,
  '{
    "feedback_to_universal": {
      "1_alto": "high",
      "2_medio": "medium",
      "3_baixo": "low",
      "4_nao_lead": "not_lead"
    },
    "universal_to_crm": {
      "high": "bom",
      "medium": "medio",
      "low": "ruim",
      "not_lead": "ruim",
      "unknown": null
    },
    "crm_values": ["bom", "medio", "ruim"]
  }'::jsonb,
  '{
    "crm_to_meta_event": {
      "bom": "LeadQualificado",
      "medio": "LeadPoucoQualificado",
      "ruim": "LeadRuim"
    },
    "purchase_event": "Purchase"
  }'::jsonb,
  '{
    "product_label": "veiculo",
    "seller_label": "vendedor",
    "deal_label": "venda",
    "signals": [
      "carro_na_troca",
      "tem_entrada",
      "entrada_pct",
      "financiamento",
      "visita",
      "produto_interesse",
      "fora_do_perfil",
      "clique_sem_querer"
    ]
  }'::jsonb
)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  is_active = EXCLUDED.is_active,
  quality_mapping = EXCLUDED.quality_mapping,
  event_mapping = EXCLUDED.event_mapping,
  signal_schema = EXCLUDED.signal_schema;

-- RLS: leitura de perfis ATIVOS para authenticated; escrita apenas service_role
-- (service_role ignora RLS; nao ha policy de escrita para roles comuns).
ALTER TABLE public.niche_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS niche_profiles_read_active ON public.niche_profiles;
CREATE POLICY niche_profiles_read_active ON public.niche_profiles
  FOR SELECT TO authenticated USING (is_active = true);

GRANT SELECT ON public.niche_profiles TO authenticated;
REVOKE ALL ON public.niche_profiles FROM anon;
