-- =============================================================================
-- Item 4 (parte 1): junction table wa_contact_list_members (N:N híbrido)
-- =============================================================================
-- HÍBRIDO: wa_contacts.list_id continua sendo "lista primária" — broadcast,
-- campanhas e formulários continuam funcionando exatamente como hoje.
-- ESTA TABELA NOVA: rastreia múltiplas listas onde o contato pode estar via
-- automações ("Adicionar à lista" sem remover da lista atual).
--
-- Backfill: cada par existente (contato, list_id) vira 1 linha na junction.

CREATE TABLE IF NOT EXISTS public.wa_contact_list_members (
  contact_id  uuid NOT NULL REFERENCES public.wa_contacts(id)      ON DELETE CASCADE,
  list_id     uuid NOT NULL REFERENCES public.wa_contact_lists(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES auth.users(id)              ON DELETE CASCADE,
  added_at    timestamptz NOT NULL DEFAULT now(),
  added_by    text NULL,           -- "automation_flow:<flow_id>" / "manual" / "import" / "backfill"
  PRIMARY KEY (contact_id, list_id)
);

COMMENT ON TABLE public.wa_contact_list_members IS
  'Junção N:N entre contatos e listas. Híbrido: wa_contacts.list_id (lista primária) preservado pra retrocompat. Esta tabela aceita contato em múltiplas listas via automações.';

-- Indices pra queries comuns
CREATE INDEX IF NOT EXISTS idx_wclm_list_id    ON public.wa_contact_list_members (list_id);
CREATE INDEX IF NOT EXISTS idx_wclm_user_id    ON public.wa_contact_list_members (user_id);
CREATE INDEX IF NOT EXISTS idx_wclm_contact_id ON public.wa_contact_list_members (contact_id);

-- RLS: contato pertence ao user_id (mesma regra de wa_contacts/wa_contact_lists)
ALTER TABLE public.wa_contact_list_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "owner_manage_wclm" ON public.wa_contact_list_members;
CREATE POLICY "owner_manage_wclm" ON public.wa_contact_list_members
  FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Backfill: insere par (contato, list_id) existente de wa_contacts
-- ON CONFLICT DO NOTHING torna idempotente
INSERT INTO public.wa_contact_list_members (contact_id, list_id, user_id, added_by)
SELECT c.id, c.list_id, c.user_id, 'backfill'
FROM public.wa_contacts c
WHERE c.list_id IS NOT NULL
  AND c.user_id IS NOT NULL
ON CONFLICT (contact_id, list_id) DO NOTHING;

DO $$
DECLARE v_count int;
BEGIN
  SELECT COUNT(*) INTO v_count FROM public.wa_contact_list_members;
  RAISE NOTICE '[Item4 wclm] junction populada: % linhas', v_count;
END $$;
