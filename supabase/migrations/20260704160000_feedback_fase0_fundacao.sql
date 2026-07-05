-- ============================================================================
-- CÉREBRO DE FEEDBACK — FASE 0 (fundação: schema + RLS + governança de custo)
-- ----------------------------------------------------------------------------
-- Agente que analisa a conversa (Pedro=wa_chat_history + Marcos=wa_inbox) e
-- produz: (a) qualidade do lead 1–4 -> José; (b) qualidade do atendimento ->
-- gerente; (c) veredito de atribuição. TUDO config-driven (comportamento é
-- dado, não código): regras 1–4, competências/pesos, canais de alerta, blocos
-- do relatório e feature flags vivem em tabelas/jsonb — mudar = UPDATE, não deploy.
--
-- Multi-tenant por user_id (conta master). RLS em todas. Migrations aditivas;
-- enums só estendidos. NÃO toca no qualidade_lead do José (Bloco D) — escala
-- própria e separada aqui.
-- ============================================================================

-- ── Enums (só estendidos no futuro, nunca reduzidos) ────────────────────────
DO $$ BEGIN
  CREATE TYPE feedback_qualidade_lead   AS ENUM ('1_alto','2_medio','3_baixo','4_nao_lead');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE feedback_veredito         AS ENUM ('falha_atendimento','lead_ruim','perda_legitima','rotulagem_incorreta','venda_realizada');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE feedback_status_analise   AS ENUM ('pendente','processando','concluido','falhou');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE feedback_status_relatorio AS ENUM ('pendente','gerado','enviado','falhou');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE feedback_tipo_alerta      AS ENUM ('nao_lead','rotulagem_incorreta');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE feedback_canal_alerta     AS ENUM ('whatsapp','email','painel_flag');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── feedback_config — 1 por tenant/nicho (tenant_id NULL = default global) ──
CREATE TABLE IF NOT EXISTS public.feedback_config (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid,                          -- user_id da conta master; NULL = default global do nicho
  nicho               text NOT NULL DEFAULT 'automotivo',
  framework           jsonb NOT NULL DEFAULT '{}',   -- competências + pesos
  prompt_especialista text,
  numero_gerente      text,                          -- destino do WhatsApp do relatório
  cadencia_relatorio  text NOT NULL DEFAULT 'diario',-- diario | semanal
  feature_flags       jsonb NOT NULL DEFAULT '{}',   -- analise/relatorio/alertas/feed_jose ...
  canais_alerta       jsonb NOT NULL DEFAULT '["whatsapp"]',
  blocos_relatorio    jsonb NOT NULL DEFAULT '["resumo","vendedores","qualidade","idade","anuncios"]',
  cap_analises_dia    int NOT NULL DEFAULT 300,
  cap_custo_mes_usd   numeric NOT NULL DEFAULT 30,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_feedback_config_tenant_nicho
  ON public.feedback_config (COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), nicho);

-- ── feedback_regras_qualidade — motor de regras 1–4 (dados, não if hard-coded) ─
CREATE TABLE IF NOT EXISTS public.feedback_regras_qualidade (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid,                                  -- NULL = regra default do nicho
  nicho       text NOT NULL DEFAULT 'automotivo',
  nivel       feedback_qualidade_lead NOT NULL,
  prioridade  int NOT NULL,                          -- menor = avaliada primeiro
  criterios   jsonb NOT NULL DEFAULT '{}',           -- declarativo: {"carro_na_troca":true,"entrada_pct_min":50}
  ativo       boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_feedback_regras_lookup
  ON public.feedback_regras_qualidade (nicho, ativo, prioridade);

-- ── feedback_conversas — resultado da análise por lead/conversa ─────────────
CREATE TABLE IF NOT EXISTS public.feedback_conversas (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL,
  lead_source         text NOT NULL CHECK (lead_source IN ('pedro','marcos')),
  lead_id             uuid NOT NULL,
  vendedor_id         uuid,                          -- ai_team_members.id
  campanha_id         text,                          -- ad_id / campaign_id (degradável)
  versao_thread       text NOT NULL DEFAULT 'v1',    -- p/ idempotência (reprocessar = upsert)
  qualidade_lead      feedback_qualidade_lead,
  score_atendimento   numeric,
  veredito            feedback_veredito,
  rotulagem_incorreta boolean NOT NULL DEFAULT false,
  resultado           jsonb NOT NULL DEFAULT '{}',   -- contrato completo (com "versao")
  custo_usd           numeric NOT NULL DEFAULT 0,
  tokens              int NOT NULL DEFAULT 0,
  status              feedback_status_analise NOT NULL DEFAULT 'pendente',
  tentativas          int NOT NULL DEFAULT 0,
  erro                text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  analisado_em        timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_feedback_conversas_thread
  ON public.feedback_conversas (lead_source, lead_id, versao_thread);
CREATE INDEX IF NOT EXISTS idx_feedback_conversas_vendedor
  ON public.feedback_conversas (tenant_id, vendedor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_conversas_campanha
  ON public.feedback_conversas (tenant_id, campanha_id, created_at DESC);

-- ── feedback_relatorios — relatório diário gerado ───────────────────────────
CREATE TABLE IF NOT EXISTS public.feedback_relatorios (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  data_ref      date NOT NULL,
  loja          text NOT NULL DEFAULT 'principal',
  storage_path  text,
  resumo        jsonb NOT NULL DEFAULT '{}',
  status        feedback_status_relatorio NOT NULL DEFAULT 'pendente',
  enviado_em    timestamptz,
  wa_message_id text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_feedback_relatorios
  ON public.feedback_relatorios (tenant_id, loja, data_ref);

-- ── feedback_alertas — alertas em tempo real ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.feedback_alertas (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL,
  feedback_conversa_id uuid REFERENCES public.feedback_conversas(id) ON DELETE CASCADE,
  tipo                 feedback_tipo_alerta NOT NULL,
  canal                feedback_canal_alerta NOT NULL,
  ref_externa          text,
  enviado_em           timestamptz,
  lido                 boolean NOT NULL DEFAULT false,
  created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_feedback_alertas_tenant
  ON public.feedback_alertas (tenant_id, created_at DESC);

-- ── feedback_uso_custo — medição p/ cap (grão DIÁRIO p/ cap_analises_dia) ────
CREATE TABLE IF NOT EXISTS public.feedback_uso_custo (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL,
  dia_ref    date NOT NULL DEFAULT (now() AT TIME ZONE 'America/Sao_Paulo')::date,
  analises   int NOT NULL DEFAULT 0,
  tokens     int NOT NULL DEFAULT 0,
  custo_usd  numeric NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_feedback_uso_custo ON public.feedback_uso_custo (tenant_id, dia_ref);

-- ── View p/ o José: agregado ANONIMIZADO por campanha/dia ───────────────────
CREATE OR REPLACE VIEW public.feedback_qualidade_por_campanha AS
SELECT
  tenant_id,
  campanha_id,
  created_at::date AS data_ref,
  count(*)                                        AS leads_analisados,
  count(*) FILTER (WHERE qualidade_lead='1_alto')   AS q_alto,
  count(*) FILTER (WHERE qualidade_lead='2_medio')  AS q_medio,
  count(*) FILTER (WHERE qualidade_lead='3_baixo')  AS q_baixo,
  count(*) FILTER (WHERE qualidade_lead='4_nao_lead') AS q_nao_lead,
  count(*) FILTER (WHERE (resultado#>>'{perfil_idade,fora_do_perfil}')='true') AS fora_do_perfil
FROM public.feedback_conversas
WHERE status='concluido'
GROUP BY tenant_id, campanha_id, created_at::date;

COMMENT ON VIEW public.feedback_qualidade_por_campanha IS
  'Agregado anonimizado (sem dado bruto do cliente) da qualidade real de lead por campanha/dia — feed do José.';

-- ── RLS: isolamento por tenant ──────────────────────────────────────────────
ALTER TABLE public.feedback_config             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feedback_regras_qualidade   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feedback_conversas          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feedback_relatorios         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feedback_alertas            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feedback_uso_custo          ENABLE ROW LEVEL SECURITY;

-- Config/regras: leitura pelo tenant + defaults globais (tenant_id NULL); dono gerencia a própria config.
DROP POLICY IF EXISTS feedback_config_read ON public.feedback_config;
CREATE POLICY feedback_config_read ON public.feedback_config FOR SELECT TO authenticated
  USING (tenant_id IS NULL OR tenant_id = public.resolve_billing_owner_user_id(auth.uid()));
DROP POLICY IF EXISTS feedback_config_manage ON public.feedback_config;
CREATE POLICY feedback_config_manage ON public.feedback_config FOR ALL TO authenticated
  USING (tenant_id = auth.uid()) WITH CHECK (tenant_id = auth.uid());

DROP POLICY IF EXISTS feedback_regras_read ON public.feedback_regras_qualidade;
CREATE POLICY feedback_regras_read ON public.feedback_regras_qualidade FOR SELECT TO authenticated
  USING (tenant_id IS NULL OR tenant_id = public.resolve_billing_owner_user_id(auth.uid()));
DROP POLICY IF EXISTS feedback_regras_manage ON public.feedback_regras_qualidade;
CREATE POLICY feedback_regras_manage ON public.feedback_regras_qualidade FOR ALL TO authenticated
  USING (tenant_id = auth.uid()) WITH CHECK (tenant_id = auth.uid());

-- Tabelas de dados: leitura tenant-scoped; escrita só service_role (edge functions bypassam RLS).
DROP POLICY IF EXISTS feedback_conversas_read ON public.feedback_conversas;
CREATE POLICY feedback_conversas_read ON public.feedback_conversas FOR SELECT TO authenticated
  USING (tenant_id = public.resolve_billing_owner_user_id(auth.uid()));
DROP POLICY IF EXISTS feedback_relatorios_read ON public.feedback_relatorios;
CREATE POLICY feedback_relatorios_read ON public.feedback_relatorios FOR SELECT TO authenticated
  USING (tenant_id = public.resolve_billing_owner_user_id(auth.uid()));
DROP POLICY IF EXISTS feedback_alertas_read ON public.feedback_alertas;
CREATE POLICY feedback_alertas_read ON public.feedback_alertas FOR SELECT TO authenticated
  USING (tenant_id = public.resolve_billing_owner_user_id(auth.uid()));
DROP POLICY IF EXISTS feedback_uso_custo_read ON public.feedback_uso_custo;
CREATE POLICY feedback_uso_custo_read ON public.feedback_uso_custo FOR SELECT TO authenticated
  USING (tenant_id = public.resolve_billing_owner_user_id(auth.uid()));

GRANT SELECT ON public.feedback_config, public.feedback_regras_qualidade, public.feedback_conversas,
  public.feedback_relatorios, public.feedback_alertas, public.feedback_uso_custo,
  public.feedback_qualidade_por_campanha TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.feedback_config, public.feedback_regras_qualidade TO authenticated;

-- ── Storage: bucket privado dos PDFs ────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public) VALUES ('feedback-relatorios','feedback-relatorios', false)
ON CONFLICT (id) DO NOTHING;
DROP POLICY IF EXISTS feedback_relatorios_read_obj ON storage.objects;
CREATE POLICY feedback_relatorios_read_obj ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id='feedback-relatorios'
    AND (storage.foldername(name))[1] = public.resolve_billing_owner_user_id(auth.uid())::text);

-- ── Seed: default global do nicho automotivo ────────────────────────────────
INSERT INTO public.feedback_config (tenant_id, nicho, framework, prompt_especialista, feature_flags, canais_alerta, blocos_relatorio)
VALUES (
  NULL, 'automotivo',
  '{"competencias":{"velocidade":15,"conexao":8,"qualificacao":15,"valor":10,"objecoes":10,"tecnicas":8,"cta":12,"follow_up":8,"fechamento":8,"profissionalismo":6}}',
  'Você é um especialista em conversão de vendas no WhatsApp para concessionárias/lojas de carros. Avalie a conversa entre o cliente e o atendimento (IA + vendedor). Extraia sinais objetivos do cliente (carro na troca, entrada disponível e % da entrada, nome limpo/restrição, idade, produto de interesse, intenção real) e avalie o ATENDIMENTO nas competências configuradas, cada uma com nota 0-100 e um trecho-evidência com horário. Classifique pela CONVERSA, nunca pela palavra do vendedor. Responda somente no contrato JSON pedido.',
  '{"analise":false,"relatorio":false,"alertas":false,"feed_jose":false}',
  '["whatsapp","painel_flag"]',
  '["resumo","vendedores","qualidade","idade","anuncios"]'
)
ON CONFLICT (COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), nicho) DO NOTHING;

-- ── Seed: as 4 regras CONFIRMADAS do cliente (nicho automotivo, default global) ─
INSERT INTO public.feedback_regras_qualidade (tenant_id, nicho, nivel, prioridade, criterios) VALUES
  (NULL, 'automotivo', '1_alto',    1,  '{"carro_na_troca": true, "entrada_pct_min": 50}'),
  (NULL, 'automotivo', '2_medio',   2,  '{"tem_entrada": true, "nome_limpo": true}'),
  (NULL, 'automotivo', '3_baixo',   3,  '{"restricao": true, "tem_entrada": false}'),
  (NULL, 'automotivo', '4_nao_lead',99, '{"qualquer_de": ["clique_sem_querer","produto_errado","fora_idade","sem_intencao"]}')
ON CONFLICT DO NOTHING;

-- ── Motor de regras: sinais (jsonb) -> nível 1–4, 100% pela config ──────────
CREATE OR REPLACE FUNCTION public.feedback_classificar_qualidade(
  p_tenant uuid, p_nicho text, p_signals jsonb
) RETURNS feedback_qualidade_lead
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE
  r            record;
  k            text;
  v            jsonb;
  ok           boolean;
  base         text;
  arr          text[];
  hit          boolean;
  v_use_tenant boolean;
BEGIN
  -- usa as regras do tenant se existir alguma; senão, as globais (tenant_id NULL)
  SELECT EXISTS (
    SELECT 1 FROM public.feedback_regras_qualidade
    WHERE nicho = p_nicho AND ativo AND tenant_id = p_tenant
  ) INTO v_use_tenant;

  FOR r IN
    SELECT nivel, criterios
    FROM public.feedback_regras_qualidade
    WHERE nicho = p_nicho AND ativo
      AND ((v_use_tenant AND tenant_id = p_tenant) OR (NOT v_use_tenant AND tenant_id IS NULL))
    ORDER BY prioridade ASC
  LOOP
    ok := true;
    FOR k, v IN SELECT key, value FROM jsonb_each(r.criterios) LOOP
      IF k = 'qualquer_de' THEN
        SELECT array_agg(x) INTO arr FROM jsonb_array_elements_text(v) x;
        hit := false;
        IF arr IS NOT NULL THEN
          FOR base IN SELECT unnest(arr) LOOP
            IF (p_signals->>base) = 'true' THEN hit := true; EXIT; END IF;
          END LOOP;
        END IF;
        IF NOT hit THEN ok := false; EXIT; END IF;
      ELSIF k LIKE '%\_min' THEN
        base := left(k, length(k)-4);
        IF p_signals->>base IS NULL OR (p_signals->>base)::numeric < (v#>>'{}')::numeric THEN ok := false; EXIT; END IF;
      ELSIF k LIKE '%\_max' THEN
        base := left(k, length(k)-4);
        IF p_signals->>base IS NULL OR (p_signals->>base)::numeric > (v#>>'{}')::numeric THEN ok := false; EXIT; END IF;
      ELSE
        IF (p_signals->>k) IS DISTINCT FROM (v#>>'{}') THEN ok := false; EXIT; END IF;
      END IF;
    END LOOP;
    IF ok THEN RETURN r.nivel; END IF;
  END LOOP;
  RETURN NULL;  -- nenhum critério bateu: indeterminado (o analista decide o fallback)
END;
$$;

-- ── Governança de custo: reserva slot (checa cap) ANTES da análise ──────────
CREATE OR REPLACE FUNCTION public.feedback_cost_gate(p_tenant uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_cap_analises  int;
  v_cap_custo     numeric;
  v_dia           date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_analises_hoje int;
  v_custo_mes     numeric;
BEGIN
  -- caps: config do tenant se existir, senão o default global
  SELECT cap_analises_dia, cap_custo_mes_usd INTO v_cap_analises, v_cap_custo
  FROM public.feedback_config
  WHERE (tenant_id = p_tenant OR tenant_id IS NULL)
  ORDER BY (tenant_id IS NOT NULL) DESC, created_at ASC LIMIT 1;
  v_cap_analises := COALESCE(v_cap_analises, 300);
  v_cap_custo    := COALESCE(v_cap_custo, 30);

  SELECT COALESCE(analises,0) INTO v_analises_hoje
  FROM public.feedback_uso_custo WHERE tenant_id=p_tenant AND dia_ref=v_dia;
  v_analises_hoje := COALESCE(v_analises_hoje, 0);
  SELECT COALESCE(sum(custo_usd),0) INTO v_custo_mes
  FROM public.feedback_uso_custo
  WHERE tenant_id=p_tenant AND date_trunc('month', dia_ref) = date_trunc('month', v_dia);

  IF v_analises_hoje >= v_cap_analises THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'cap_analises_dia', 'analises_hoje', v_analises_hoje);
  END IF;
  IF v_custo_mes >= v_cap_custo THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'cap_custo_mes_usd', 'custo_mes', v_custo_mes);
  END IF;

  -- reserva o slot (anti-corrida): +1 análise já
  INSERT INTO public.feedback_uso_custo (tenant_id, dia_ref, analises)
  VALUES (p_tenant, v_dia, 1)
  ON CONFLICT (tenant_id, dia_ref) DO UPDATE SET analises = feedback_uso_custo.analises + 1, updated_at = now();

  RETURN jsonb_build_object('allowed', true);
END;
$$;

-- ── Governança de custo: registra tokens/custo reais APÓS a análise ─────────
CREATE OR REPLACE FUNCTION public.feedback_cost_record(p_tenant uuid, p_tokens int, p_custo numeric)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_dia date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  INSERT INTO public.feedback_uso_custo (tenant_id, dia_ref, tokens, custo_usd)
  VALUES (p_tenant, v_dia, COALESCE(p_tokens,0), COALESCE(p_custo,0))
  ON CONFLICT (tenant_id, dia_ref) DO UPDATE
    SET tokens = feedback_uso_custo.tokens + COALESCE(p_tokens,0),
        custo_usd = feedback_uso_custo.custo_usd + COALESCE(p_custo,0),
        updated_at = now();
END;
$$;

REVOKE ALL ON FUNCTION public.feedback_classificar_qualidade(uuid,text,jsonb) FROM public;
REVOKE ALL ON FUNCTION public.feedback_cost_gate(uuid) FROM public;
REVOKE ALL ON FUNCTION public.feedback_cost_record(uuid,int,numeric) FROM public;
GRANT EXECUTE ON FUNCTION public.feedback_classificar_qualidade(uuid,text,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.feedback_cost_gate(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.feedback_cost_record(uuid,int,numeric) TO service_role;
