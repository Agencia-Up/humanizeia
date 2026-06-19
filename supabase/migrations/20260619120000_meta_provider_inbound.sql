-- ============================================================================
-- Cloud API oficial do Meta como 2a via (ao lado da UAZAPI) — suporte ao INBOUND.
-- O webhook do Meta (meta-webhook) e UNICO a nivel de App: cada mensagem traz
-- value.metadata.phone_number_id, e precisamos achar a instancia por ele. Indice
-- pro caminho quente do lookup. NAO mexe na UAZAPI nem no default de provider.
-- Idempotente.
-- ============================================================================

-- Lookup do inbound: instancia Meta pelo phone_number_id guardado em meta_config.
CREATE INDEX IF NOT EXISTS idx_wa_instances_meta_phone_number_id
  ON public.wa_instances ((meta_config->>'phone_number_id'))
  WHERE provider = 'meta';

-- Trava: no maximo uma instancia Meta ATIVA por numero (evita dois cadastros do
-- mesmo phone_number_id respondendo em paralelo). Parcial: so vale p/ Meta ativo.
CREATE UNIQUE INDEX IF NOT EXISTS uq_wa_instances_meta_phone_active
  ON public.wa_instances ((meta_config->>'phone_number_id'))
  WHERE provider = 'meta' AND is_active = true;
