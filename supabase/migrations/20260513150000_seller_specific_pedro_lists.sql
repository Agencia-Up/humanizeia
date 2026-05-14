-- Permite que listas de auto-sync sejam especificas de UM vendedor
-- (so puxa leads atribuidos a esse vendedor)

ALTER TABLE public.wa_contact_lists
  ADD COLUMN IF NOT EXISTS seller_member_id UUID
    REFERENCES public.ai_team_members(id) ON DELETE CASCADE;

COMMENT ON COLUMN public.wa_contact_lists.seller_member_id IS
  'Quando preenchido, esta lista soh recebe leads onde ai_crm_leads.assigned_to_member_id = este valor. NULL = master (todos os leads).';

-- Atualiza a funcao trigger para respeitar o seller_member_id
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
    IF list_record.seller_member_id IS NOT NULL THEN
      IF NEW.assigned_to_member_id IS NULL OR NEW.assigned_to_member_id != list_record.seller_member_id THEN
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

-- Trigger ja existe; soh estamos reaproveitando.
