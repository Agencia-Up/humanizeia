-- =============================================================================
-- FASE 3 (correção) — o alimentador da wa_inbox exige instância de IA RESOLVÍVEL.
--
-- Medição em prod (28/07), antes de qualquer backfill: linhas de wa_inbox com
-- instance_id NULL NÃO são da linha de IA.
--   Icom, últimos 45 dias: 960 identidades sem instância — 56 também aparecem
--   na linha de IA (já indexadas por lá), 188 aparecem em linha de VENDEDOR e
--   729 não aparecem em lugar nenhum; a linha de IA inteira tem 167 identidades.
--   Mônaco: 392 sem instância x 6 da IA x 565 de vendedor. WA Veículos: 33 x 0.
--
-- A versão original resolvia a instância com
--   SELECT seller_member_id INTO v_seller ... WHERE id = NEW.instance_id
-- e, com instance_id NULL, o SELECT não retornava linha => v_seller ficava NULL
-- => a linha era indexada como órfã. Isso colocaria conversa de VENDEDOR dentro
-- de Conversas IA (regressão de privacidade) e contraria a própria regra da F3:
-- a projeção é SÓ de linhas de IA (wa_instances.seller_member_id IS NULL).
-- =============================================================================
CREATE OR REPLACE FUNCTION public.ai_conv_index_from_wa_inbox()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_seller uuid; v_found boolean;
BEGIN
  BEGIN
    IF coalesce(NEW.is_archived,false) THEN RETURN NULL; END IF;      -- estacionadas fora
    IF NEW.instance_id IS NULL THEN RETURN NULL; END IF;              -- sem instância: não é atribuível à IA
    SELECT true, seller_member_id INTO v_found, v_seller
      FROM public.wa_instances WHERE id = NEW.instance_id;
    IF NOT coalesce(v_found,false) THEN RETURN NULL; END IF;          -- instância inexistente
    IF v_seller IS NOT NULL THEN RETURN NULL; END IF;                 -- linha de vendedor fora
    PERFORM public.ai_conv_index_upsert(
      NEW.user_id, NEW.instance_id, NEW.phone, NULL, NEW.contact_name,
      NEW.content, NEW.message_type, NEW.direction, NEW.created_at, 1, 'webhook', true);
  EXCEPTION WHEN OTHERS THEN
    -- ponto 9: a escrita operacional NUNCA cai por causa da projeção.
    BEGIN
      INSERT INTO public.ai_conv_index_deadletter (origem, ref, user_id, erro)
      VALUES ('wa_inbox', NEW.id::text, NEW.user_id, left(SQLERRM, 300));
    EXCEPTION WHEN OTHERS THEN RAISE WARNING 'ai_conv_index deadletter falhou: %', SQLERRM;
    END;
  END;
  RETURN NULL;
END $$;
