-- ============================================================================
-- Gestão Comercial — VENDAS e METAS (lançamento manual)
-- ----------------------------------------------------------------------------
-- Módulo comercial integrado ao Painel Geral. Vendas são lançadas à mão (não
-- derivadas de atendimento por enquanto). Reaproveita o cadastro de vendedores
-- já existente (ai_team_members) e o papel já existente (profiles.role:
-- owner/manager = gestor; seller = vendedor). NÃO cria tabela "vendedores".
--
-- RLS (padrão do projeto, via funções SECURITY DEFINER já existentes):
--   • get_seller_master_user_id()   -> user_id do MASTER do vendedor logado
--   • get_seller_member_ids_text()   -> ids (text) de ai_team_members do vendedor
--   Regra:
--     - GESTOR (dono): auth.uid() = user_id  -> vê/edita TUDO da equipe dele.
--     - VENDEDOR: vê/insere SÓ as próprias vendas (seller_id ∈ seus member ids).
--                 Metas: o vendedor só LÊ (a da loja + a individual dele); quem
--                 lança meta é o gestor.
--
-- TODO (conversão por origem): para calcular conversão = vendas[origem] /
--   leads[origem], criar futuramente uma tabela comercial_leads (origem, data,
--   seller_id). Fora do escopo desta entrega.
-- ============================================================================

-- ── VENDAS ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.comercial_vendas (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,        -- gestor/dono
  seller_id   uuid NOT NULL REFERENCES public.ai_team_members(id) ON DELETE CASCADE, -- quem vendeu
  data_venda  date NOT NULL DEFAULT current_date,
  valor       numeric(12,2) NOT NULL CHECK (valor >= 0),                         -- faturamento / ticket
  origem      text NOT NULL CHECK (origem IN ('trafego','portais','porta','particular')),
  portal      text,        -- preenchido quando origem='portais' (Webmotors/OLX/iCarros...)
  veiculo     text,
  observacao  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_comercial_vendas_user_data ON public.comercial_vendas(user_id, data_venda);
CREATE INDEX IF NOT EXISTS idx_comercial_vendas_seller    ON public.comercial_vendas(seller_id);

-- ── METAS (em QUANTIDADE de vendas) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.comercial_metas (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,     -- gestor/dono
  seller_id      uuid REFERENCES public.ai_team_members(id) ON DELETE CASCADE,  -- null quando tipo='loja'
  tipo           text NOT NULL CHECK (tipo IN ('individual','loja')),
  mes_referencia date NOT NULL,        -- usar SEMPRE o 1º dia do mês
  valor_meta     int  NOT NULL CHECK (valor_meta >= 0),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  -- coerência: individual exige vendedor; loja não tem vendedor
  CONSTRAINT comercial_metas_tipo_seller_ck CHECK (
    (tipo = 'individual' AND seller_id IS NOT NULL) OR
    (tipo = 'loja'       AND seller_id IS NULL)
  )
);
-- 1 meta individual por (vendedor, mês) e 1 meta de loja por (gestor, mês).
CREATE UNIQUE INDEX IF NOT EXISTS uq_comercial_metas_individual
  ON public.comercial_metas(seller_id, mes_referencia) WHERE tipo = 'individual';
CREATE UNIQUE INDEX IF NOT EXISTS uq_comercial_metas_loja
  ON public.comercial_metas(user_id, mes_referencia)   WHERE tipo = 'loja';

-- ── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.comercial_vendas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comercial_metas  ENABLE ROW LEVEL SECURITY;

-- VENDAS · gestor (dono) faz tudo
DROP POLICY IF EXISTS comercial_vendas_owner_all ON public.comercial_vendas;
CREATE POLICY comercial_vendas_owner_all ON public.comercial_vendas
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- VENDAS · vendedor vê só as próprias
DROP POLICY IF EXISTS comercial_vendas_seller_select ON public.comercial_vendas;
CREATE POLICY comercial_vendas_seller_select ON public.comercial_vendas
  FOR SELECT USING (
    user_id = public.get_seller_master_user_id()
    AND seller_id::text = ANY (public.get_seller_member_ids_text())
  );

-- VENDAS · vendedor insere só pra si mesmo (no master dele)
DROP POLICY IF EXISTS comercial_vendas_seller_insert ON public.comercial_vendas;
CREATE POLICY comercial_vendas_seller_insert ON public.comercial_vendas
  FOR INSERT WITH CHECK (
    user_id = public.get_seller_master_user_id()
    AND seller_id::text = ANY (public.get_seller_member_ids_text())
  );

-- METAS · gestor (dono) faz tudo (lançar/editar metas é do gestor)
DROP POLICY IF EXISTS comercial_metas_owner_all ON public.comercial_metas;
CREATE POLICY comercial_metas_owner_all ON public.comercial_metas
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- METAS · vendedor só LÊ (a meta da loja + a própria meta individual)
DROP POLICY IF EXISTS comercial_metas_seller_select ON public.comercial_metas;
CREATE POLICY comercial_metas_seller_select ON public.comercial_metas
  FOR SELECT USING (
    user_id = public.get_seller_master_user_id()
    AND (tipo = 'loja' OR seller_id::text = ANY (public.get_seller_member_ids_text()))
  );

-- ── Como testar cada papel (no SQL editor do Supabase) ──────────────────────
-- GESTOR (logado como dono):    SELECT * FROM comercial_vendas;  -> vê todas.
-- VENDEDOR (logado como seller): SELECT * FROM comercial_vendas;  -> só as dele.
--   INSERT com seller_id de OUTRO vendedor -> deve FALHAR (WITH CHECK).
--   INSERT/UPDATE em comercial_metas como vendedor -> deve FALHAR (só SELECT).
