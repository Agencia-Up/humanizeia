-- =============================================================================
-- Fase 6.2 — Campos Dinâmicos (Cidade + Origem do Lead)
-- =============================================================================
-- Cria tabelas reference cities + lead_sources + audit log.
-- Adiciona city_id/source_id em ai_crm_leads e crm_leads (nullable, sem dropar legacy).
-- Drop CHECK constraint ai_crm_leads_origem_check (substituído por reference).
-- Seed 11 cidades + 6 origens por user_id de master ativo.
-- Backfill source_id em crm_leads.
--
-- 100% idempotente. Pode rodar 2x sem quebrar.
-- =============================================================================

-- ════════════════════════════════════════════════════════════════
-- 1. Extensões (idempotentes)
-- ════════════════════════════════════════════════════════════════
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- ════════════════════════════════════════════════════════════════
-- 2. Função helper de normalização (lower + unaccent + trim + collapse spaces)
-- ════════════════════════════════════════════════════════════════
-- IMMUTABLE pra poder ser usada em índices funcionais.
-- pg_trgm gin_trgm_ops já requer index direto na coluna, então criamos uma
-- coluna `normalized_name` materializada em vez de índice funcional.
CREATE OR REPLACE FUNCTION public.normalize_dynamic_name(input text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT lower(
    regexp_replace(
      trim(coalesce(unaccent(input), '')),
      '\s+', ' ', 'g'
    )
  );
$$;

-- ════════════════════════════════════════════════════════════════
-- 3. Tabela CITIES
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.cities (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name              text NOT NULL,
  normalized_name   text NOT NULL,
  state_uf          char(2),
  status            text NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'pending_review', 'archived', 'rejected')),
  is_system_default boolean NOT NULL DEFAULT false,
  created_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at       timestamptz,
  usage_count       int NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cities_user_normalized_unique UNIQUE (user_id, normalized_name),
  CONSTRAINT cities_name_length CHECK (char_length(name) BETWEEN 2 AND 100)
);

CREATE INDEX IF NOT EXISTS idx_cities_user_status
  ON public.cities (user_id, status);
CREATE INDEX IF NOT EXISTS idx_cities_normalized_trgm
  ON public.cities USING gin (normalized_name gin_trgm_ops);

-- ════════════════════════════════════════════════════════════════
-- 4. Tabela LEAD_SOURCES
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.lead_sources (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name              text NOT NULL,
  normalized_name   text NOT NULL,
  category          text NOT NULL DEFAULT 'manual'
                    CHECK (category IN ('manual', 'automatic', 'marketplace', 'paid', 'event', 'integration', 'other')),
  icon              text,
  status            text NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'pending_review', 'archived', 'rejected')),
  is_system_default boolean NOT NULL DEFAULT false,
  created_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at       timestamptz,
  usage_count       int NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lead_sources_user_normalized_unique UNIQUE (user_id, normalized_name),
  CONSTRAINT lead_sources_name_length CHECK (char_length(name) BETWEEN 2 AND 100)
);

CREATE INDEX IF NOT EXISTS idx_lead_sources_user_status
  ON public.lead_sources (user_id, status);
CREATE INDEX IF NOT EXISTS idx_lead_sources_normalized_trgm
  ON public.lead_sources USING gin (normalized_name gin_trgm_ops);

-- ════════════════════════════════════════════════════════════════
-- 5. Tabela DYNAMIC_FIELDS_AUDIT_LOG (apend-only)
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.dynamic_fields_audit_log (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  entity_type  text NOT NULL CHECK (entity_type IN ('city', 'lead_source')),
  entity_id    uuid NOT NULL,
  action       text NOT NULL CHECK (action IN ('created', 'approved', 'rejected', 'edited', 'merged', 'archived')),
  performed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  payload      jsonb DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dynamic_audit_user_entity
  ON public.dynamic_fields_audit_log (user_id, entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_dynamic_audit_created
  ON public.dynamic_fields_audit_log (created_at DESC);

-- ════════════════════════════════════════════════════════════════
-- 6. ALTER ai_crm_leads — add FKs + drop old CHECK constraint
-- ════════════════════════════════════════════════════════════════
ALTER TABLE public.ai_crm_leads
  ADD COLUMN IF NOT EXISTS city_id   uuid REFERENCES public.cities(id)        ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_id uuid REFERENCES public.lead_sources(id)  ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_ai_crm_leads_city_id   ON public.ai_crm_leads(city_id);
CREATE INDEX IF NOT EXISTS idx_ai_crm_leads_source_id ON public.ai_crm_leads(source_id);

-- Drop CHECK constraint do origem fixo (substituído por reference)
ALTER TABLE public.ai_crm_leads
  DROP CONSTRAINT IF EXISTS ai_crm_leads_origem_check;

-- ════════════════════════════════════════════════════════════════
-- 7. ALTER crm_leads — add source_id FK
-- ════════════════════════════════════════════════════════════════
ALTER TABLE public.crm_leads
  ADD COLUMN IF NOT EXISTS source_id uuid REFERENCES public.lead_sources(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_crm_leads_source_id ON public.crm_leads(source_id);

-- ════════════════════════════════════════════════════════════════
-- 8. RLS — cities
-- ════════════════════════════════════════════════════════════════
ALTER TABLE public.cities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cities_select_own_or_subordinate ON public.cities;
CREATE POLICY cities_select_own_or_subordinate ON public.cities
  FOR SELECT
  USING (
    user_id = auth.uid()
    OR user_id IN (
      SELECT p.manager_id FROM public.profiles p
      WHERE p.id = auth.uid() AND p.manager_id IS NOT NULL
    )
  );

DROP POLICY IF EXISTS cities_insert_own_or_subordinate ON public.cities;
CREATE POLICY cities_insert_own_or_subordinate ON public.cities
  FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    OR user_id IN (
      SELECT p.manager_id FROM public.profiles p
      WHERE p.id = auth.uid() AND p.manager_id IS NOT NULL
    )
  );

DROP POLICY IF EXISTS cities_update_own ON public.cities;
CREATE POLICY cities_update_own ON public.cities
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS cities_delete_own ON public.cities;
CREATE POLICY cities_delete_own ON public.cities
  FOR DELETE
  USING (user_id = auth.uid());

-- ════════════════════════════════════════════════════════════════
-- 9. RLS — lead_sources (mesmo padrão)
-- ════════════════════════════════════════════════════════════════
ALTER TABLE public.lead_sources ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lead_sources_select_own_or_subordinate ON public.lead_sources;
CREATE POLICY lead_sources_select_own_or_subordinate ON public.lead_sources
  FOR SELECT
  USING (
    user_id = auth.uid()
    OR user_id IN (
      SELECT p.manager_id FROM public.profiles p
      WHERE p.id = auth.uid() AND p.manager_id IS NOT NULL
    )
  );

DROP POLICY IF EXISTS lead_sources_insert_own_or_subordinate ON public.lead_sources;
CREATE POLICY lead_sources_insert_own_or_subordinate ON public.lead_sources
  FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    OR user_id IN (
      SELECT p.manager_id FROM public.profiles p
      WHERE p.id = auth.uid() AND p.manager_id IS NOT NULL
    )
  );

DROP POLICY IF EXISTS lead_sources_update_own ON public.lead_sources;
CREATE POLICY lead_sources_update_own ON public.lead_sources
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS lead_sources_delete_own ON public.lead_sources;
CREATE POLICY lead_sources_delete_own ON public.lead_sources
  FOR DELETE
  USING (user_id = auth.uid());

-- ════════════════════════════════════════════════════════════════
-- 10. RLS — audit log (read only pro owner, append automático)
-- ════════════════════════════════════════════════════════════════
ALTER TABLE public.dynamic_fields_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS audit_select_own ON public.dynamic_fields_audit_log;
CREATE POLICY audit_select_own ON public.dynamic_fields_audit_log
  FOR SELECT
  USING (
    user_id = auth.uid()
    OR user_id IN (
      SELECT p.manager_id FROM public.profiles p
      WHERE p.id = auth.uid() AND p.manager_id IS NOT NULL
    )
  );

DROP POLICY IF EXISTS audit_insert_service ON public.dynamic_fields_audit_log;
-- Sem policy pública de INSERT: o audit log é append-only e deve ser escrito
-- apenas por triggers SECURITY DEFINER ou service_role em Edge Functions.

-- ════════════════════════════════════════════════════════════════
-- 11. SEED — 11 cidades base por master ativo (Vale do Paraíba/SP)
-- ════════════════════════════════════════════════════════════════
WITH masters AS (
  SELECT DISTINCT user_id FROM public.wa_ai_agents WHERE is_active = true
),
cities_base AS (
  SELECT * FROM (VALUES
    ('Pindamonhangaba'),
    ('Taubaté'),
    ('Tremembé'),
    ('Caçapava'),
    ('São Luís do Paraitinga'),
    ('Redenção da Serra'),
    ('Jacareí'),
    ('São José dos Campos'),
    ('Guaratinguetá'),
    ('Campos do Jordão'),
    ('Lorena')
  ) AS t(name)
)
INSERT INTO public.cities (user_id, name, normalized_name, state_uf, status, is_system_default, approved_at)
SELECT
  m.user_id,
  cb.name,
  public.normalize_dynamic_name(cb.name),
  'SP'::char(2),
  'active',
  true,
  now()
FROM masters m
CROSS JOIN cities_base cb
ON CONFLICT (user_id, normalized_name) DO NOTHING;

-- ════════════════════════════════════════════════════════════════
-- 12. SEED — 6 origens base por master ativo
-- ════════════════════════════════════════════════════════════════
WITH masters AS (
  SELECT DISTINCT user_id FROM public.wa_ai_agents WHERE is_active = true
),
sources_base AS (
  SELECT * FROM (VALUES
    ('Porta (loja)',     'manual',      '🚪'),
    ('Marketplace FB',   'marketplace', '🛒'),
    ('OLX',              'marketplace', '🛒'),
    ('Mercado Livre',    'marketplace', '🛒'),
    ('Instagram',        'manual',      '📷'),
    ('Outros',           'other',       '📌')
  ) AS t(name, category, icon)
)
INSERT INTO public.lead_sources (user_id, name, normalized_name, category, icon, status, is_system_default, approved_at)
SELECT
  m.user_id,
  sb.name,
  public.normalize_dynamic_name(sb.name),
  sb.category,
  sb.icon,
  'active',
  true,
  now()
FROM masters m
CROSS JOIN sources_base sb
ON CONFLICT (user_id, normalized_name) DO NOTHING;

-- ════════════════════════════════════════════════════════════════
-- 13. BACKFILL — ai_crm_leads.source_id a partir de origem legacy
--   Mapeia origem ('porta', 'marketplace_facebook', ...) → lead_sources.id
--   correspondente por user_id + normalized_name.
-- ════════════════════════════════════════════════════════════════
WITH legacy_to_new AS (
  SELECT * FROM (VALUES
    ('porta',                       public.normalize_dynamic_name('Porta (loja)')),
    ('marketplace_facebook',        public.normalize_dynamic_name('Marketplace FB')),
    ('marketplace_olx',             public.normalize_dynamic_name('OLX')),
    ('marketplace_mercadolivre',    public.normalize_dynamic_name('Mercado Livre')),
    ('instagram_vendedor',          public.normalize_dynamic_name('Instagram')),
    ('outros',                      public.normalize_dynamic_name('Outros'))
  ) AS t(legacy_value, normalized_new)
)
UPDATE public.ai_crm_leads l
SET source_id = ls.id
FROM legacy_to_new ltn, public.lead_sources ls
WHERE l.origem = ltn.legacy_value
  AND ls.user_id = l.user_id
  AND ls.normalized_name = ltn.normalized_new
  AND l.source_id IS NULL;

-- ════════════════════════════════════════════════════════════════
-- 14. BACKFILL — crm_leads.source_id
--   Para cada user_id × source distinct existente, cria row em lead_sources
--   se não existir e mapeia. Sources já automáticos ("Pedro SDR — Carvalho",
--   "Importacao manual - Marcos", "form:...") entram com category='automatic'.
-- ════════════════════════════════════════════════════════════════
-- 14a. Criar lead_sources únicas pra cada user_id × source não-vazio
INSERT INTO public.lead_sources (user_id, name, normalized_name, category, status, is_system_default, approved_at)
SELECT DISTINCT
  cl.user_id,
  cl.source AS name,
  public.normalize_dynamic_name(cl.source) AS normalized_name,
  CASE
    WHEN cl.source ILIKE 'Pedro SDR%'        THEN 'automatic'
    WHEN cl.source ILIKE 'Importacao%'       THEN 'automatic'
    WHEN cl.source ILIKE 'form:%'            THEN 'integration'
    WHEN cl.source ILIKE 'marketplace%'      THEN 'marketplace'
    ELSE 'manual'
  END AS category,
  'active' AS status,
  false AS is_system_default,
  now() AS approved_at
FROM public.crm_leads cl
WHERE cl.source IS NOT NULL
  AND cl.user_id IS NOT NULL
  AND length(trim(cl.source)) BETWEEN 2 AND 100
ON CONFLICT (user_id, normalized_name) DO NOTHING;

-- 14b. Atualizar crm_leads.source_id apontando pra row criada
UPDATE public.crm_leads cl
SET source_id = ls.id
FROM public.lead_sources ls
WHERE ls.user_id = cl.user_id
  AND ls.normalized_name = public.normalize_dynamic_name(cl.source)
  AND cl.source IS NOT NULL
  AND cl.source_id IS NULL;

-- ════════════════════════════════════════════════════════════════
-- 15. VALIDAÇÕES (raise notice se algo estranho)
-- ════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_cities_count       int;
  v_sources_count      int;
  v_unmapped_ai        int;
  v_unmapped_crm       int;
  v_masters_count      int;
BEGIN
  SELECT COUNT(*) INTO v_masters_count FROM public.wa_ai_agents WHERE is_active = true;
  SELECT COUNT(*) INTO v_cities_count FROM public.cities WHERE is_system_default = true;
  SELECT COUNT(*) INTO v_sources_count FROM public.lead_sources;
  SELECT COUNT(*) INTO v_unmapped_ai FROM public.ai_crm_leads
    WHERE origem IS NOT NULL AND source_id IS NULL;
  SELECT COUNT(*) INTO v_unmapped_crm FROM public.crm_leads
    WHERE source IS NOT NULL AND length(trim(source)) BETWEEN 2 AND 100
    AND source_id IS NULL;

  RAISE NOTICE '[Fase 6.2] cities (system default): %', v_cities_count;
  RAISE NOTICE '[Fase 6.2] lead_sources total: %', v_sources_count;
  RAISE NOTICE '[Fase 6.2] ai_crm_leads com origem ainda SEM source_id: %', v_unmapped_ai;
  RAISE NOTICE '[Fase 6.2] crm_leads com source ainda SEM source_id: %', v_unmapped_crm;
  RAISE NOTICE '[Fase 6.2] masters ativos: %', v_masters_count;
END $$;

-- =============================================================================
-- ROLLBACK (manual, se necessário — NÃO inclua no UP)
-- =============================================================================
-- DROP TABLE IF EXISTS public.dynamic_fields_audit_log CASCADE;
-- ALTER TABLE public.crm_leads DROP COLUMN IF EXISTS source_id;
-- ALTER TABLE public.ai_crm_leads DROP COLUMN IF EXISTS city_id;
-- ALTER TABLE public.ai_crm_leads DROP COLUMN IF EXISTS source_id;
-- DROP TABLE IF EXISTS public.lead_sources CASCADE;
-- DROP TABLE IF EXISTS public.cities CASCADE;
-- DROP FUNCTION IF EXISTS public.normalize_dynamic_name(text);
-- ALTER TABLE public.ai_crm_leads ADD CONSTRAINT ai_crm_leads_origem_check
--   CHECK (origem IS NULL OR origem IN ('porta','marketplace_facebook','marketplace_olx','marketplace_mercadolivre','instagram_vendedor','outros'));
