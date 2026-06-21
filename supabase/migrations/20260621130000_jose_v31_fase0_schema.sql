-- ============================================================================
-- JOSÉ v3.1 — FASE 0 (Fundação): schema de governança, custo e fila de mídia
-- ----------------------------------------------------------------------------
-- Fonte: jose_v3.1_documento_mestre, seção 4 (enums + tabelas) + 4.1..4.5.
-- Decisões confirmadas no código (checklist [CONFIRMAR]):
--   • Coluna de tenant = user_id (NÃO tenant_id). Padrão do repo inteiro.
--   • Superadmin = public._is_caller_superadmin() (mesmo helper do site_leads).
--   • Tabelas existentes só ALTERADAS: apollo_action_log, creatives.
--   • ad_accounts(id uuid) é a FK das contas; campaigns(id uuid) existe.
--   • nicho (jose_nicho) entra na FASE 1 (reasoning-core), não aqui.
-- Tudo idempotente (re-rodável): IF NOT EXISTS / DO-block nos enums /
-- DROP POLICY IF EXISTS. RLS habilitado em TODAS as tabelas novas.
-- Rollback documentado no fim (comentado).
-- ============================================================================

-- 0) ENUMS -------------------------------------------------------------------
DO $$ BEGIN CREATE TYPE public.jose_approval_status AS ENUM ('pendente','aprovado','rejeitado','expirado','auto_aprovado'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.jose_action_risk     AS ENUM ('baixo','medio','alto','critico'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.jose_media_job_status AS ENUM ('recebido','processando','concluido','falhou','dead_letter'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.jose_media_type      AS ENUM ('imagem','video','audio'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.jose_voice_direction AS ENUM ('entrada','saida'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.jose_permission_level AS ENUM ('desligado','analisar','recomendar','executar'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.jose_capability      AS ENUM ('llm','stt','tts','vision'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.jose_platform        AS ENUM ('meta','google'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================================
-- 4.1 CAMADA DE ABSTRAÇÃO E CONTROLE
-- ============================================================================

-- jose_providers_config — qual modelo/provider por capability (troca sem deploy)
CREATE TABLE IF NOT EXISTS public.jose_providers_config (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid REFERENCES auth.users(id) ON DELETE CASCADE,  -- NULL = global/default
  capability        public.jose_capability NOT NULL,
  provider          text NOT NULL,
  model             text NOT NULL,
  params            jsonb NOT NULL DEFAULT '{}'::jsonb,
  fallback_provider text,
  fallback_model    text,
  ativo             boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
-- 1 config por (tenant, capability); e 1 global por capability.
CREATE UNIQUE INDEX IF NOT EXISTS uq_jose_providers_tenant_cap ON public.jose_providers_config(user_id, capability) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_jose_providers_global_cap ON public.jose_providers_config(capability) WHERE user_id IS NULL;

-- jose_feature_flags — liga/desliga capability por tenant (com rollout)
CREATE TABLE IF NOT EXISTS public.jose_feature_flags (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid REFERENCES auth.users(id) ON DELETE CASCADE,  -- NULL = global
  feature     text NOT NULL,  -- voz | criativo_whatsapp | criacao_campanha | google_ads | otimizacao_proativa | reasoning_core
  habilitado  boolean NOT NULL DEFAULT false,
  rollout_pct int NOT NULL DEFAULT 100 CHECK (rollout_pct BETWEEN 0 AND 100),
  config      jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_jose_flags_tenant_feat ON public.jose_feature_flags(user_id, feature) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_jose_flags_global_feat ON public.jose_feature_flags(feature) WHERE user_id IS NULL;

-- jose_permissions — nível de autonomia por conta e tipo de ação
CREATE TABLE IF NOT EXISTS public.jose_permissions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ad_account_id uuid REFERENCES public.ad_accounts(id) ON DELETE CASCADE,
  tipo_acao     text NOT NULL,
  nivel         public.jose_permission_level NOT NULL DEFAULT 'recomendar',
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_jose_permissions ON public.jose_permissions(user_id, ad_account_id, tipo_acao);

-- jose_usage_ledger — espinha dorsal de custo/observabilidade
CREATE TABLE IF NOT EXISTS public.jose_usage_ledger (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ad_account_id uuid REFERENCES public.ad_accounts(id) ON DELETE SET NULL,
  capability    public.jose_capability NOT NULL,
  unidade       text NOT NULL,  -- tokens_in | tokens_out | min | imagem
  quantidade    numeric NOT NULL DEFAULT 0,
  custo_usd     numeric NOT NULL DEFAULT 0,
  ref_tipo      text,
  ref_id        uuid,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_jose_ledger_user_date ON public.jose_usage_ledger(user_id, created_at);

-- jose_cost_alerts — alertas proativos de gasto
CREATE TABLE IF NOT EXISTS public.jose_cost_alerts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid REFERENCES auth.users(id) ON DELETE CASCADE,  -- NULL = global
  periodo       text NOT NULL CHECK (periodo IN ('dia','mes')),
  threshold_usd numeric NOT NULL,
  canal         text,
  disparado_em  timestamptz,
  reset_em      timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ============================================================================
-- 4.2 SEGURANÇA FINANCEIRA E APROVAÇÃO
-- ============================================================================

-- jose_spend_caps — teto + kill-switch por conta
CREATE TABLE IF NOT EXISTS public.jose_spend_caps (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ad_account_id              uuid REFERENCES public.ad_accounts(id) ON DELETE CASCADE,
  kill_switch                boolean NOT NULL DEFAULT false,
  limite_gasto_alterado_dia  numeric,
  limite_acoes_dia           int,
  limite_minutos_voz_mes     int,
  exige_aprovacao_acima_de   numeric,
  teto_custo_ia_mes_usd      numeric,
  updated_at                 timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_jose_spend_caps ON public.jose_spend_caps(user_id, ad_account_id);

-- jose_action_approvals — fila de aprovação (WhatsApp + painel)
CREATE TABLE IF NOT EXISTS public.jose_action_approvals (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ad_account_id  uuid REFERENCES public.ad_accounts(id) ON DELETE SET NULL,
  action_log_id  uuid REFERENCES public.apollo_action_log(id) ON DELETE SET NULL,
  risco          public.jose_action_risk NOT NULL DEFAULT 'medio',
  tipo_acao      text NOT NULL,
  payload        jsonb NOT NULL DEFAULT '{}'::jsonb,
  resumo_humano  text,
  status         public.jose_approval_status NOT NULL DEFAULT 'pendente',
  enviado_em     timestamptz,
  respondido_em  timestamptz,
  expira_em      timestamptz,
  resposta_raw   text,
  canal_resposta text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_jose_approvals_user_status ON public.jose_action_approvals(user_id, status);

-- apollo_action_log: ganha contexto de decisão + vínculo com aprovação + risco + plataforma
ALTER TABLE public.apollo_action_log
  ADD COLUMN IF NOT EXISTS decisao_contexto jsonb,
  ADD COLUMN IF NOT EXISTS approval_id      uuid REFERENCES public.jose_action_approvals(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS risco            public.jose_action_risk,
  ADD COLUMN IF NOT EXISTS platform         public.jose_platform;

-- ============================================================================
-- 4.3 FILA DE MÍDIA ROBUSTA
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.jose_media_jobs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ad_account_id    uuid REFERENCES public.ad_accounts(id) ON DELETE SET NULL,
  tipo             public.jose_media_type NOT NULL,
  status           public.jose_media_job_status NOT NULL DEFAULT 'recebido',
  idempotency_key  text NOT NULL UNIQUE,  -- = wa_message_id
  wa_message_id    text,
  wa_media_id      text,
  wa_from          text,
  storage_path     text,
  resultado        jsonb,
  prioridade       int NOT NULL DEFAULT 5,
  tentativas       int NOT NULL DEFAULT 0,
  max_tentativas   int NOT NULL DEFAULT 3,
  proximo_retry_em timestamptz,
  erro             text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  processed_at     timestamptz
);
CREATE INDEX IF NOT EXISTS ix_jose_media_jobs_due ON public.jose_media_jobs(status, proximo_retry_em);

-- jose_webhook_events — dedupe/idempotência de webhooks (infra, sem tenant)
CREATE TABLE IF NOT EXISTS public.jose_webhook_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider    text NOT NULL,
  event_id    text NOT NULL UNIQUE,
  payload     jsonb,
  processado  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ============================================================================
-- 4.4 CRIATIVO E CAMPANHA
-- ============================================================================

-- creatives: enriquecimento por visão (tags + nicho JÁ existem na tabela)
ALTER TABLE public.creatives
  ADD COLUMN IF NOT EXISTS analise_visao jsonb,
  ADD COLUMN IF NOT EXISTS origem        text,
  ADD COLUMN IF NOT EXISTS enriquecido_em timestamptz;

-- jose_creative_feedback — loop de performance -> aprendizado
CREATE TABLE IF NOT EXISTS public.jose_creative_feedback (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  creative_id uuid REFERENCES public.creatives(id) ON DELETE CASCADE,
  metricas    jsonb NOT NULL DEFAULT '{}'::jsonb,
  janela      text,
  score       numeric,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- jose_campaign_templates — templates reutilizáveis
CREATE TABLE IF NOT EXISTS public.jose_campaign_templates (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id   uuid REFERENCES auth.users(id) ON DELETE CASCADE,  -- NULL = global
  nome      text NOT NULL,
  objetivo  text,
  estrutura jsonb NOT NULL DEFAULT '{}'::jsonb,
  ativo     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- jose_generated_campaigns — rascunhos gerados
CREATE TABLE IF NOT EXISTS public.jose_generated_campaigns (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ad_account_id     uuid REFERENCES public.ad_accounts(id) ON DELETE SET NULL,
  template_id       uuid REFERENCES public.jose_campaign_templates(id) ON DELETE SET NULL,
  platform          public.jose_platform NOT NULL DEFAULT 'meta',
  objetivo          text,
  payload           jsonb NOT NULL DEFAULT '{}'::jsonb,
  simulacao         jsonb,
  status            text NOT NULL DEFAULT 'rascunho',
  approval_id       uuid REFERENCES public.jose_action_approvals(id) ON DELETE SET NULL,
  meta_campaign_id  text,
  google_campaign_id text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- ============================================================================
-- 4.5 AUDITORIA E LGPD
-- ============================================================================

-- jose_data_retention — política LGPD por tipo de dado
CREATE TABLE IF NOT EXISTS public.jose_data_retention (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid REFERENCES auth.users(id) ON DELETE CASCADE,  -- NULL = global
  tipo        text NOT NULL CHECK (tipo IN ('audio','imagem','transcricao','log')),
  reter_dias  int NOT NULL,
  anonimizar  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ============================================================================
-- STORAGE — bucket jose-media (privado, RLS por tenant na 1ª pasta = user_id)
-- ============================================================================
INSERT INTO storage.buckets (id, name, public) VALUES ('jose-media','jose-media', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "jose_media_rw_own" ON storage.objects;
CREATE POLICY "jose_media_rw_own" ON storage.objects FOR ALL
  USING (bucket_id = 'jose-media' AND auth.uid()::text = (storage.foldername(name))[1])
  WITH CHECK (bucket_id = 'jose-media' AND auth.uid()::text = (storage.foldername(name))[1]);

-- ============================================================================
-- RLS — habilita + policies. Edge functions usam service_role (bypassa RLS).
-- Tenant (user_id NOT NULL): dono faz tudo; superadmin lê tudo (painel de custo).
-- Global (user_id NULL): todos leem; só dono/superadmin escreve.
-- ============================================================================

-- Tabelas só-tenant (user_id NOT NULL)
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'jose_permissions','jose_usage_ledger','jose_spend_caps','jose_action_approvals',
    'jose_media_jobs','jose_creative_feedback','jose_generated_campaigns'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_owner', t);
    EXECUTE format($p$CREATE POLICY %I ON public.%I FOR ALL
        USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id)$p$, t||'_owner', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_superadmin_read', t);
    EXECUTE format($p$CREATE POLICY %I ON public.%I FOR SELECT
        USING (public._is_caller_superadmin())$p$, t||'_superadmin_read', t);
  END LOOP;
END $$;

-- Tabelas com linha global (user_id NULL permitido)
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'jose_providers_config','jose_feature_flags','jose_cost_alerts',
    'jose_campaign_templates','jose_data_retention'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_select', t);
    EXECUTE format($p$CREATE POLICY %I ON public.%I FOR SELECT
        USING (user_id IS NULL OR auth.uid() = user_id OR public._is_caller_superadmin())$p$, t||'_select', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_write', t);
    EXECUTE format($p$CREATE POLICY %I ON public.%I FOR ALL
        USING ((user_id IS NOT NULL AND auth.uid() = user_id) OR public._is_caller_superadmin())
        WITH CHECK ((user_id IS NOT NULL AND auth.uid() = user_id) OR public._is_caller_superadmin())$p$, t||'_write', t);
  END LOOP;
END $$;

-- jose_webhook_events: infra. Só superadmin lê; escrita via service_role.
ALTER TABLE public.jose_webhook_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS jose_webhook_events_superadmin_read ON public.jose_webhook_events;
CREATE POLICY jose_webhook_events_superadmin_read ON public.jose_webhook_events
  FOR SELECT USING (public._is_caller_superadmin());

-- ============================================================================
-- SEED — defaults globais (user_id NULL). Trocáveis pelo painel sem deploy.
-- Idempotente (INSERT ... WHERE NOT EXISTS). Modelos = os que o José já usa.
-- ============================================================================

-- Providers por capability (global). llm/vision = Anthropic (fallback OpenAI);
-- stt/tts = OpenAI. O dono troca por conta no painel depois.
INSERT INTO public.jose_providers_config (user_id, capability, provider, model, params, fallback_provider, fallback_model)
SELECT v.user_id, v.capability::public.jose_capability, v.provider, v.model, v.params::jsonb, v.fbp, v.fbm
FROM (VALUES
  (NULL::uuid, 'llm',    'anthropic', 'claude-3-5-sonnet-20241022', '{}', 'openai', 'gpt-4o'),
  (NULL::uuid, 'vision', 'anthropic', 'claude-3-5-sonnet-20241022', '{}', 'openai', 'gpt-4o'),
  (NULL::uuid, 'stt',    'openai',    'gpt-4o-transcribe',          '{}', 'openai', 'whisper-1'),
  (NULL::uuid, 'tts',    'openai',    'gpt-4o-mini-tts',            '{"voice":"alloy"}', NULL, NULL)
) AS v(user_id, capability, provider, model, params, fbp, fbm)
WHERE NOT EXISTS (
  SELECT 1 FROM public.jose_providers_config c
  WHERE c.user_id IS NULL AND c.capability = v.capability::public.jose_capability
);

-- Feature flags globais — TUDO DESLIGADO por padrão (nada liga sem flag).
INSERT INTO public.jose_feature_flags (user_id, feature, habilitado, rollout_pct)
SELECT NULL::uuid, f.feature, false, 100
FROM (VALUES ('voz'),('criativo_whatsapp'),('criacao_campanha'),('google_ads'),('otimizacao_proativa'),('reasoning_core')) AS f(feature)
WHERE NOT EXISTS (
  SELECT 1 FROM public.jose_feature_flags ff WHERE ff.user_id IS NULL AND ff.feature = f.feature
);

-- Retenção LGPD global (dias). anonimizar=false por padrão.
INSERT INTO public.jose_data_retention (user_id, tipo, reter_dias, anonimizar)
SELECT NULL::uuid, r.tipo, r.dias, false
FROM (VALUES ('audio',30),('imagem',90),('transcricao',180),('log',365)) AS r(tipo, dias)
WHERE NOT EXISTS (
  SELECT 1 FROM public.jose_data_retention d WHERE d.user_id IS NULL AND d.tipo = r.tipo
);

-- ============================================================================
-- ROLLBACK (DOWN) — manual, se precisar reverter em staging:
--   DROP TABLE IF EXISTS public.jose_generated_campaigns, public.jose_campaign_templates,
--     public.jose_creative_feedback, public.jose_data_retention, public.jose_webhook_events,
--     public.jose_media_jobs, public.jose_action_approvals, public.jose_spend_caps,
--     public.jose_cost_alerts, public.jose_usage_ledger, public.jose_permissions,
--     public.jose_feature_flags, public.jose_providers_config CASCADE;
--   ALTER TABLE public.apollo_action_log DROP COLUMN IF EXISTS decisao_contexto,
--     DROP COLUMN IF EXISTS approval_id, DROP COLUMN IF EXISTS risco, DROP COLUMN IF EXISTS platform;
--   ALTER TABLE public.creatives DROP COLUMN IF EXISTS analise_visao,
--     DROP COLUMN IF EXISTS origem, DROP COLUMN IF EXISTS enriquecido_em;
--   DELETE FROM storage.buckets WHERE id = 'jose-media';
--   DROP TYPE IF EXISTS public.jose_approval_status, public.jose_action_risk,
--     public.jose_media_job_status, public.jose_media_type, public.jose_voice_direction,
--     public.jose_permission_level, public.jose_capability, public.jose_platform;
-- ============================================================================
