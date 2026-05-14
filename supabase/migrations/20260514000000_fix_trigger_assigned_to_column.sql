-- ===========================================================================
-- HOTFIX: trigger sync_pedro_lead_to_lists usava coluna inexistente
-- ===========================================================================
-- Bug: A migration 20260513150000 atualizou a funcao sync_pedro_lead_to_lists
-- para usar NEW.assigned_to_member_id, mas essa coluna NAO EXISTE em producao
-- (so existe assigned_to_id). Resultado: TODO INSERT em ai_crm_leads falhava
-- com "coluna assigned_to_member_id nao existe", causando rollback. Leads
-- novos nao apareciam no CRM dos vendedores porque nao chegavam a ser salvos.
--
-- Fix: atualiza a funcao para usar assigned_to_id (coluna correta).
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.sync_pedro_lead_to_lists()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  list_record RECORD;
  phone_clean TEXT;
BEGIN
  -- Extrai phone do remote_jid
  phone_clean := regexp_replace(split_part(NEW.remote_jid, '@', 1), '\D', '', 'g');
  IF phone_clean IS NULL OR length(phone_clean) < 10 THEN
    RETURN NEW;
  END IF;

  -- Itera por todas as listas auto-sync do mesmo user_id
  FOR list_record IN
    SELECT id, seller_member_id FROM public.wa_contact_lists
    WHERE user_id = NEW.user_id AND auto_sync_pedro_leads = true
  LOOP
    -- Se a lista eh de um vendedor especifico, soh insere leads atribuidos a ele
    -- COLUNA CORRIGIDA: assigned_to_id (antes era assigned_to_member_id que nao existe)
    IF list_record.seller_member_id IS NOT NULL THEN
      IF NEW.assigned_to_id IS NULL OR NEW.assigned_to_id != list_record.seller_member_id THEN
        CONTINUE;
      END IF;
    END IF;

    -- Evita duplicar (mesmo phone na mesma lista)
    INSERT INTO public.wa_contacts (user_id, list_id, phone, name, source)
    SELECT NEW.user_id, list_record.id, phone_clean, NEW.lead_name, 'pedro_auto_sync'
    WHERE NOT EXISTS (
      SELECT 1 FROM public.wa_contacts
      WHERE list_id = list_record.id AND phone = phone_clean
    );

    -- Atualiza contador da lista
    UPDATE public.wa_contact_lists
    SET contact_count = (SELECT COUNT(*) FROM public.wa_contacts WHERE list_id = list_record.id),
        updated_at = now()
    WHERE id = list_record.id;
  END LOOP;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.sync_pedro_lead_to_lists IS
  'Sincroniza leads do Pedro para listas com auto_sync_pedro_leads=true. Respeita seller_member_id da lista (se setado, filtra por NEW.assigned_to_id). HOTFIX 20260514: usa assigned_to_id (coluna correta) em vez de assigned_to_member_id (inexistente).';
