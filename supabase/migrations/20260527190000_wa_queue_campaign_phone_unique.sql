-- =============================================================================
-- BUG-NOVO-07 — Dedup ATÔMICA em wa_queue por (campaign_id, phone)
-- =============================================================================
-- Hoje enqueue-campaign faz dedup só por contact_id. Se master EDITA listas e
-- adiciona contato com mesmo telefone mas contact_id diferente (típico em
-- re-import de CSV ou ajuste manual), o telefone duplica na queue e cliente
-- recebe campanha 2x.
--
-- A constraint atual (campaign_id, contact_id) NÃO PEGA porque contact_id é
-- diferente. Esta migration adiciona UNIQUE INDEX (campaign_id, phone) pra
-- garantir dedup no banco.
--
-- Idempotente — limpa duplicatas antes (mantém a mais antiga = primeira agendada).
-- =============================================================================

-- 1. Limpar duplicatas existentes (mantém a mais antiga por campaign+phone)
DO $$
DECLARE v_dups int;
BEGIN
  SELECT COUNT(*) INTO v_dups
  FROM (
    SELECT campaign_id, phone, COUNT(*) AS qty
    FROM public.wa_queue
    WHERE campaign_id IS NOT NULL AND phone IS NOT NULL
    GROUP BY campaign_id, phone
    HAVING COUNT(*) > 1
  ) t;
  IF v_dups > 0 THEN
    RAISE NOTICE '[BUG-NOVO-07] Encontradas % combinacoes duplicadas em wa_queue. Removendo (mantem mais antiga, mas SO se ambas estiverem pending — nao apaga ja enviadas).', v_dups;

    -- Remove duplicatas APENAS quando ambas estao pending (segurança: nao apaga
    -- mensagens ja enviadas mesmo que duplicadas, pra preservar audit).
    DELETE FROM public.wa_queue a
    USING public.wa_queue b
    WHERE a.id > b.id
      AND a.campaign_id = b.campaign_id
      AND a.phone = b.phone
      AND a.campaign_id IS NOT NULL
      AND a.status = 'pending'
      AND b.status = 'pending';
  ELSE
    RAISE NOTICE '[BUG-NOVO-07] Sem duplicatas em wa_queue por (campaign_id, phone). OK.';
  END IF;
END $$;

-- 2. Cria o UNIQUE INDEX parcial (só pra campanhas — itens avulsos sem
-- campaign_id continuam sem dedup, comportamento esperado)
CREATE UNIQUE INDEX IF NOT EXISTS wa_queue_campaign_phone_unique
  ON public.wa_queue (campaign_id, phone)
  WHERE campaign_id IS NOT NULL AND phone IS NOT NULL;

COMMENT ON INDEX public.wa_queue_campaign_phone_unique IS
  'Dedup ATOMICA pra evitar cliente receber mesma campanha 2x quando lista re-importada. BUG-NOVO-07 da auditoria 27/05/2026.';

-- 3. Confirmação
DO $$
DECLARE v_exists int;
BEGIN
  SELECT COUNT(*) INTO v_exists
  FROM pg_indexes
  WHERE schemaname='public' AND tablename='wa_queue' AND indexname='wa_queue_campaign_phone_unique';
  RAISE NOTICE '[BUG-NOVO-07] Indice criado: % de 1', v_exists;
END $$;
