-- ============================================================================
-- Metrificacao de CUSTO REAL de IA (provider-agnostic) — FASE 1 + FASE 2 (schema)
-- ----------------------------------------------------------------------------
-- OBJETIVO (decidido com Wander):
--   Painel INTERNO de margem para o gestor. O cliente CONTINUA pagando por
--   atendimento (contador 150/300/500). Esta camada NAO desconta saldo de
--   ninguem — so MEDE o custo real de IA em USD/BRL e permite comparar com a
--   receita do plano (margem).
--
-- DECISOES QUE MOLDAM ESTE SCHEMA:
--   (1) NAO TOCAR NO PEDRO. Logo, nao ha captura por-chamada do Pedro aqui. O
--       custo do Pedro sera derivado do que ele JA grava hoje
--       (pedro_billed_leads.raw_tokens = total de tokens do cerebro gpt-4o por
--       lead/ciclo). Como esse numero e um TOTAL (sem split input/output), o
--       custo do Pedro e aproximado aplicando uma divisao input/output assumida
--       e configuravel (config_cobranca.pedro_split_input).
--   (2) So painel interno de margem (sem debito de saldo do cliente).
--   (3) Cambio USD->BRL automatico: o schema ja guarda valor + FONTE + DATA;
--       o cron que atualiza a cotacao vem numa fase seguinte. Por ora, semente.
--
-- PRECISAO (regra do pedido): token sempre INTEGER; dinheiro sempre NUMERIC
-- (nunca float binario). USD com mais casas, BRL com 6 casas.
--
-- Idempotente: CREATE TABLE IF NOT EXISTS + INSERT ... ON CONFLICT DO NOTHING.
-- NAO toca em nenhuma tabela/funcao do Pedro. Blast radius: so cria objetos novos.
-- ============================================================================

-- (FASE 1) Registro de consumo por chamada -----------------------------------
-- Tabela pronta para dados POR-CHAMADA (quando/se algum agente NAO-Pedro for
-- instrumentado, ou quando o Pedro for liberado). Hoje sera populada por
-- rollup a partir de pedro_billed_leads (fonte='pedro_rollup').
CREATE TABLE IF NOT EXISTS public.consumo_ia (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id      uuid NOT NULL,           -- user_id da conta dona (revenda)
  conversa_id     uuid,                    -- opcional (uuid da conversa, quando houver)
  mensagem_id     text,                    -- chave de idempotencia da origem
  provedor        text NOT NULL,           -- 'openai' | 'anthropic' | 'google' | ...
  modelo          text NOT NULL,           -- modelo exato usado
  input_tokens    integer NOT NULL DEFAULT 0,
  output_tokens   integer NOT NULL DEFAULT 0,
  cache_tokens    integer NOT NULL DEFAULT 0,
  custo_usd       numeric(14,8) NOT NULL DEFAULT 0,
  custo_brl       numeric(14,6) NOT NULL DEFAULT 0,
  fonte           text NOT NULL DEFAULT 'manual',  -- origem do registro
  criado_em       timestamptz NOT NULL DEFAULT now()
);

-- Idempotencia: nao gravar a mesma origem/mensagem duas vezes.
CREATE UNIQUE INDEX IF NOT EXISTS uq_consumo_ia_fonte_msg
  ON public.consumo_ia (fonte, mensagem_id)
  WHERE mensagem_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_consumo_ia_cliente
  ON public.consumo_ia (cliente_id, criado_em DESC);

CREATE INDEX IF NOT EXISTS idx_consumo_ia_modelo
  ON public.consumo_ia (provedor, modelo);

-- Painel INTERNO: dado sensivel de custo NAO deve vazar pro cliente. RLS ON e
-- SEM policy publica -> ninguem autenticado le direto; acesso so via
-- service_role (edge/cron) ou RPC SECURITY DEFINER restrita ao gestor (FASE 4).
ALTER TABLE public.consumo_ia ENABLE ROW LEVEL SECURITY;

-- (FASE 2) Tabela de preco por modelo (editavel no painel) --------------------
CREATE TABLE IF NOT EXISTS public.preco_modelo (
  provedor            text NOT NULL,
  modelo              text NOT NULL,
  usd_por_1m_input    numeric(12,4) NOT NULL,   -- USD por 1 milhao de tokens input
  usd_por_1m_output   numeric(12,4) NOT NULL,   -- USD por 1 milhao de tokens output
  usd_por_1m_cache    numeric(12,4) NOT NULL DEFAULT 0,
  atualizado_em       timestamptz DEFAULT now(),
  PRIMARY KEY (provedor, modelo)
);

ALTER TABLE public.preco_modelo ENABLE ROW LEVEL SECURITY;

-- (FASE 2) Config de cobranca: cambio + markup (linha unica id=1) -------------
CREATE TABLE IF NOT EXISTS public.config_cobranca (
  id                    int PRIMARY KEY DEFAULT 1,
  cambio_usd_brl        numeric(10,4) NOT NULL,        -- ex: 5.4000
  cambio_fonte          text,                          -- auditoria: fonte da cotacao
  cambio_atualizado_em  timestamptz DEFAULT now(),     -- auditoria: quando atualizou
  markup                numeric(6,3) NOT NULL DEFAULT 1.000,  -- preco sugerido = custo*markup (referencia; NAO debita ninguem)
  pedro_split_input     numeric(4,3) NOT NULL DEFAULT 0.800,  -- fracao do total de tokens do Pedro tratada como INPUT (aprox., porque nao tocamos no Pedro)
  CONSTRAINT config_cobranca_singleton CHECK (id = 1)
);

ALTER TABLE public.config_cobranca ENABLE ROW LEVEL SECURITY;

-- Seeds de preco (EDITAVEIS; confira nas paginas oficiais de cada provedor) ---
-- Valores em USD por 1 milhao de tokens. Marcados com atualizado_em = now().
INSERT INTO public.preco_modelo (provedor, modelo, usd_por_1m_input, usd_por_1m_output, usd_por_1m_cache) VALUES
  ('openai',    'gpt-4o',                      2.5000, 10.0000, 1.2500),
  ('openai',    'gpt-4o-mini',                 0.1500,  0.6000, 0.0750),
  ('openai',    'text-embedding-3-small',      0.0200,  0.0000, 0.0000),
  ('anthropic', 'claude-3-5-sonnet-20241022',  3.0000, 15.0000, 0.3000),
  ('anthropic', 'claude-3-haiku-20240307',     0.2500,  1.2500, 0.0300),
  ('anthropic', 'claude-3-5-haiku-20241022',   0.8000,  4.0000, 0.0800)
ON CONFLICT (provedor, modelo) DO NOTHING;

-- Seed de config: cambio SEMENTE (sera sobrescrito pelo cron de cambio na fase
-- seguinte), markup 1.0 (sem margem aplicada por enquanto), split 80% input.
INSERT INTO public.config_cobranca (id, cambio_usd_brl, cambio_fonte, markup, pedro_split_input)
VALUES (1, 5.4000, 'seed_manual', 1.000, 0.800)
ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE public.consumo_ia IS
  'Custo real de IA por consumo (USD/BRL). Painel INTERNO de margem; nao debita saldo do cliente. fonte=pedro_rollup vem de pedro_billed_leads.raw_tokens (Pedro intocado).';
COMMENT ON TABLE public.preco_modelo IS
  'Tabela de preco por provedor/modelo (USD por 1M tokens). Editavel; precos oficiais mudam com o tempo.';
COMMENT ON TABLE public.config_cobranca IS
  'Config unica (id=1): cambio USD->BRL (com fonte+data p/ auditoria), markup de referencia e split input assumido p/ aproximar o custo do Pedro.';
