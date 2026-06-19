-- ============================================================================
-- Preco do modelo principal do Jose (Claude Sonnet 4) na tabela de custo, pra o
-- trigger ai_call_log_fill_cost calcular custo_usd das chamadas do apollo-agent.
-- Anthropic Sonnet 4: input $3/1M, output $15/1M, cache read ~$0.30/1M.
-- Idempotente. So acrescenta uma linha de preco (nao toca em nada existente).
-- ============================================================================
INSERT INTO public.preco_modelo (provedor, modelo, usd_por_1m_input, usd_por_1m_output, usd_por_1m_cache) VALUES
  ('anthropic', 'claude-sonnet-4-20250514', 3.0000, 15.0000, 0.3000)
ON CONFLICT (provedor, modelo) DO NOTHING;
