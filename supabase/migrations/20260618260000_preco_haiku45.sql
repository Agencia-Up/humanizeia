-- ============================================================================
-- Preco dos modelos Anthropic Haiku 4.5 (auxiliares do Pedro: extracao de
-- dados do lead + resumo de historico). Anthropic Haiku 4.5: $1/1M entrada,
-- $5/1M saida, ~$0.10/1M cache. Idempotente.
-- ============================================================================
INSERT INTO public.preco_modelo (provedor, modelo, usd_por_1m_input, usd_por_1m_output, usd_por_1m_cache) VALUES
  ('anthropic', 'claude-haiku-4-5',           1.0000, 5.0000, 0.1000),
  ('anthropic', 'claude-haiku-4-5-20251001',  1.0000, 5.0000, 0.1000),
  ('anthropic', 'claude-haiku-4-5-20260101',  1.0000, 5.0000, 0.1000)
ON CONFLICT (provedor, modelo) DO NOTHING;
