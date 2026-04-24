-- Adiciona lista de contatos ao formulário de captura
-- Quando um lead preenche o formulário, o contato é salvo automaticamente na lista

ALTER TABLE public.capture_forms
  ADD COLUMN IF NOT EXISTS contact_list_id uuid REFERENCES public.wa_contact_lists(id) ON DELETE SET NULL;

-- Função para incrementar contador de contatos da lista (chamada pelo form-submit)
CREATE OR REPLACE FUNCTION public.increment_contact_list_count(list_id_param uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
  UPDATE public.wa_contact_lists
  SET contact_count = contact_count + 1,
      updated_at    = now()
  WHERE id = list_id_param;
$$;
