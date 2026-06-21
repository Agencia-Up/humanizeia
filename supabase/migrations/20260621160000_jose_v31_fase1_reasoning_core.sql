-- ============================================================================
-- JOSÉ v3.1 — FASE 1 (Núcleo de Julgamento): hierarquia de verdade
-- ----------------------------------------------------------------------------
-- Venda fechada > Lead qualificado pelo Pedro > Métrica de vitrine.
-- Fonte: documento mestre, Parte II, seção 3. Tenant = user_id. Nicho na conta
-- de anúncio (ad_accounts.nicho). Inteligência = DADO (jose_knowledge_base),
-- não prompt. Idempotente. RLS em todas.
-- ============================================================================

-- 0) ENUMS -------------------------------------------------------------------
DO $$ BEGIN CREATE TYPE public.jose_nicho AS ENUM ('automoveis','imoveis','generico'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.jose_conhecimento_tipo AS ENUM ('heuristica','armadilha','benchmark','principio'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.jose_conhecimento_origem AS ENUM ('curado','aprendido'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.jose_veredito AS ENUM ('bom','atencao','ruim','dados_insuficientes'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 1) Nicho na conta de anúncio (cliente) -------------------------------------
ALTER TABLE public.ad_accounts
  ADD COLUMN IF NOT EXISTS nicho public.jose_nicho NOT NULL DEFAULT 'generico';

-- 2) Base de inteligência por nicho ------------------------------------------
CREATE TABLE IF NOT EXISTS public.jose_knowledge_base (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid REFERENCES auth.users(id) ON DELETE CASCADE,  -- NULL = conhecimento GLOBAL do nicho
  nicho           public.jose_nicho NOT NULL,
  tipo            public.jose_conhecimento_tipo NOT NULL,
  titulo          text NOT NULL,
  conteudo        text NOT NULL,
  condicao        jsonb,                 -- gatilho estruturado opcional
  origem          public.jose_conhecimento_origem NOT NULL DEFAULT 'curado',
  confianca       numeric NOT NULL DEFAULT 0.5,
  evidencia_casos int NOT NULL DEFAULT 0,
  ativo           boolean NOT NULL DEFAULT true,
  versao          int NOT NULL DEFAULT 1,
  criado_por      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_jose_kb_nicho ON public.jose_knowledge_base(nicho, ativo);
CREATE INDEX IF NOT EXISTS ix_jose_kb_user ON public.jose_knowledge_base(user_id);

-- 3) Veredito da campanha (histórico/auditável) ------------------------------
CREATE TABLE IF NOT EXISTS public.jose_campaign_verdict (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ad_account_id      uuid REFERENCES public.ad_accounts(id) ON DELETE SET NULL,
  campaign_id        text NOT NULL,
  nicho              public.jose_nicho NOT NULL DEFAULT 'generico',
  nivel1             jsonb,   -- vitrine: cpm, ctr, cpc, cpl_vitrine, volume
  nivel2             jsonb,   -- sinal: taxa_iniciacao_conversa, pct_qualificado, avanco_funil
  nivel3             jsonb,   -- negócio: leads_qualificados, vendas, custo_por_venda, custo_por_lead_qualificado
  veredito           public.jose_veredito NOT NULL DEFAULT 'dados_insuficientes',
  confianca          numeric,
  justificativa      text,
  conhecimento_usado uuid[],
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_jose_verdict_user_camp ON public.jose_campaign_verdict(user_id, campaign_id, created_at);

-- 4) Loop de aprendizado por nicho -------------------------------------------
CREATE TABLE IF NOT EXISTS public.jose_decision_outcomes (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  nicho            public.jose_nicho NOT NULL DEFAULT 'generico',
  contexto         jsonb,
  acao             jsonb,
  resultado_negocio jsonb,
  score_resultado  numeric,   -- w_venda*sinal_venda + w_qualif*sinal_qualif (w_venda > w_qualif)
  janela_dias      int,
  medido_em        timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_jose_outcomes_nicho ON public.jose_decision_outcomes(nicho, created_at);

-- ============================================================================
-- RLS
-- ============================================================================

-- jose_knowledge_base: global (user_id NULL) lido por todos; escrita global só
-- superadmin; linha própria pelo dono.
ALTER TABLE public.jose_knowledge_base ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS jose_kb_select ON public.jose_knowledge_base;
CREATE POLICY jose_kb_select ON public.jose_knowledge_base FOR SELECT
  USING (user_id IS NULL OR auth.uid() = user_id OR public._is_caller_superadmin());
DROP POLICY IF EXISTS jose_kb_write ON public.jose_knowledge_base;
CREATE POLICY jose_kb_write ON public.jose_knowledge_base FOR ALL
  USING ((user_id IS NOT NULL AND auth.uid() = user_id) OR public._is_caller_superadmin())
  WITH CHECK ((user_id IS NOT NULL AND auth.uid() = user_id) OR public._is_caller_superadmin());

-- veredito + outcomes: tenant (dono faz tudo; superadmin lê).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['jose_campaign_verdict','jose_decision_outcomes'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_owner', t);
    EXECUTE format($p$CREATE POLICY %I ON public.%I FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id)$p$, t||'_owner', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_superadmin_read', t);
    EXECUTE format($p$CREATE POLICY %I ON public.%I FOR SELECT USING (public._is_caller_superadmin())$p$, t||'_superadmin_read', t);
  END LOOP;
END $$;

-- ============================================================================
-- SEED — conhecimento curado inicial (global do nicho, user_id NULL).
-- Ponto de partida; o dono lapida pelo painel. confianca moderada (0.5).
-- Idempotente por (nicho, titulo) global.
-- ============================================================================
INSERT INTO public.jose_knowledge_base (user_id, nicho, tipo, titulo, conteudo, origem, confianca, criado_por)
SELECT NULL::uuid, s.nicho::public.jose_nicho, s.tipo::public.jose_conhecimento_tipo, s.titulo, s.conteudo, 'curado', 0.5, 'seed'
FROM (VALUES
  -- Automóveis / seminovos
  ('automoveis','armadilha','Lead de R$1 em público amplo é curioso',
   'Lead a R$1 em público amplo quase sempre é curioso, não comprador. A verdade está na taxa de agendamento de test drive/visita e no avanço com o Pedro, não no CPL de vitrine.'),
  ('automoveis','principio','Criativo com preço/parcela filtra curioso',
   'Criativo com preço, parcela ou "entrada a partir de" visível filtra curioso e melhora a qualidade do lead, mesmo reduzindo volume e subindo o CPL de vitrine.'),
  ('automoveis','heuristica','CPM alto em remarketing de estoque é normal',
   'CPM alto em remarketing de quem viu o estoque é normal e desejável quando converte. Não pausar por CPM alto isolado.'),
  ('automoveis','principio','Sinal de verdade: resposta à 1ª mensagem do Pedro',
   'O sinal de verdade é a % de leads que respondem à 1ª mensagem do Pedro informando modelo/intenção. Volume sem resposta não é resultado.'),
  -- Imóveis
  ('imoveis','principio','Ciclo longo: medir avanço, não venda em dias',
   'Ciclo de decisão é longo. Não medir venda em dias; medir avanço: visita agendada, renda compatível, documentação.'),
  ('imoveis','armadilha','Volume barato em lançamento traz curioso sem renda',
   'Volume barato em "lançamento" costuma trazer curiosos sem renda compatível. A qualificação de renda é a verdade, não o CPL.'),
  ('imoveis','principio','Criativo com condição e localização filtra',
   'Criativo com condição (entrada, financiamento, faixa/programa) e localização hiper-específica filtra. Criativo só "bonito" atrai curioso.'),
  ('imoveis','principio','Sinal de verdade: agendamento de visita + renda',
   'O sinal de verdade é a taxa de agendamento de visita somada à renda informada compatível.')
) AS s(nicho, tipo, titulo, conteudo)
WHERE NOT EXISTS (
  SELECT 1 FROM public.jose_knowledge_base k
  WHERE k.user_id IS NULL AND k.nicho = s.nicho::public.jose_nicho AND k.titulo = s.titulo
);
