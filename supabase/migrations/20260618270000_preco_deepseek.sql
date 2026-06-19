-- ============================================================================
-- Preco DeepSeek (failover do cerebro Pedro v2 quando a OpenAI cai). O codigo
-- chama 'deepseek-chat' (alias do V4 Flash): $0.14/1M entrada, $0.28/1M saida,
-- ~$0.0028/1M cache. Adiciono tambem 'deepseek-v4-flash' (nome novo a partir de
-- 24/07/2026). Idempotente.
-- ============================================================================
INSERT INTO public.preco_modelo (provedor, modelo, usd_por_1m_input, usd_por_1m_output, usd_por_1m_cache) VALUES
  ('deepseek', 'deepseek-chat',      0.1400, 0.2800, 0.0028),
  ('deepseek', 'deepseek-v4-flash',  0.1400, 0.2800, 0.0028)
ON CONFLICT (provedor, modelo) DO NOTHING;
