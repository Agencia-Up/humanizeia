-- Adiciona flag de auto-sync de leads do Pedro nas listas de contatos
ALTER TABLE public.wa_contact_lists
  ADD COLUMN IF NOT EXISTS auto_sync_pedro_leads BOOLEAN NOT NULL DEFAULT false;

-- Função: ao criar lead no ai_crm_leads, sincroniza para todas as listas
-- com auto_sync_pedro_leads = true do mesmo user_id.
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
  -- Extrai phone do remote_jid (ex: '5511999999999@s.whatsapp.net' -> '5511999999999')
  phone_clean := regexp_replace(split_part(NEW.remote_jid, '@', 1), '\D', '', 'g');
  IF phone_clean IS NULL OR length(phone_clean) < 10 THEN
    RETURN NEW;
  END IF;

  -- Insere em todas as listas auto-sync do master
  FOR list_record IN
    SELECT id FROM public.wa_contact_lists
    WHERE user_id = NEW.user_id AND auto_sync_pedro_leads = true
  LOOP
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

DROP TRIGGER IF EXISTS trg_sync_pedro_leads ON public.ai_crm_leads;
CREATE TRIGGER trg_sync_pedro_leads
  AFTER INSERT ON public.ai_crm_leads
  FOR EACH ROW EXECUTE FUNCTION public.sync_pedro_lead_to_lists();

COMMENT ON COLUMN public.wa_contact_lists.auto_sync_pedro_leads IS
  'Quando true, novos leads criados em ai_crm_leads sao automaticamente adicionados como wa_contacts nesta lista.';
