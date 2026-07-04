-- ============================================================================
-- Anexos de documentos no card do lead (Pedro + Marcos)
-- ----------------------------------------------------------------------------
-- Vendedor arquiva documento/imagem do cliente (RG, comprovante, simulacao de
-- financiamento) direto no card do lead, pra organizacao.
--
-- Seguranca:
--   - Bucket PRIVADO `lead-docs` (documento sensivel nunca fica publico; acesso
--     so por URL assinada temporaria).
--   - A visibilidade dos anexos HERDA a visibilidade do lead: as policies usam
--     EXISTS contra ai_crm_leads/crm_leads, que ja tem RLS por vendedor. Ou seja,
--     o vendedor so ve/mexe nos anexos dos leads que ele ja pode ver; dono/gerente
--     veem de todos. Sem re-derivar a regra de atribuicao.
--   - Caminho no storage: {origem}/{lead_id}/{uuid}.{ext} — as storage policies
--     conferem a visibilidade do lead pela pasta (origem + lead_id).
-- ============================================================================

-- ── Bucket privado ──────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('lead-docs', 'lead-docs', false, 10485760)   -- 10 MB por arquivo
ON CONFLICT (id) DO NOTHING;

-- ── Tabela de indice/organizacao ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.lead_attachments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id           uuid NOT NULL,
  lead_source       text NOT NULL CHECK (lead_source IN ('pedro','marcos')),
  user_id           uuid,                 -- conta master (dona do lead); preenchido por trigger
  storage_path      text NOT NULL,
  file_name         text NOT NULL,
  mime_type         text,
  size_bytes        bigint,
  doc_type          text,                 -- etiqueta opcional (RG, comprovante, simulacao...)
  uploaded_by       uuid,                 -- auth.uid() de quem enviou
  uploaded_by_name  text,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lead_attachments_lead
  ON public.lead_attachments(lead_source, lead_id, created_at DESC);

COMMENT ON TABLE public.lead_attachments IS
  'Documentos/imagens anexados ao card de um lead (Pedro=ai_crm_leads, Marcos=crm_leads). Arquivos no bucket privado lead-docs.';

-- ── Trigger: preenche user_id (conta dona) a partir do lead ─────────────────
CREATE OR REPLACE FUNCTION public.tg_lead_attachment_fill_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.lead_source = 'pedro' THEN
    SELECT user_id INTO NEW.user_id FROM public.ai_crm_leads WHERE id = NEW.lead_id;
  ELSIF NEW.lead_source = 'marcos' THEN
    SELECT user_id INTO NEW.user_id FROM public.crm_leads WHERE id = NEW.lead_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lead_attachment_fill_owner ON public.lead_attachments;
CREATE TRIGGER trg_lead_attachment_fill_owner
  BEFORE INSERT ON public.lead_attachments
  FOR EACH ROW EXECUTE FUNCTION public.tg_lead_attachment_fill_owner();

-- ── RLS: herda a visibilidade do lead ──────────────────────────────────────
ALTER TABLE public.lead_attachments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lead_attachments_select ON public.lead_attachments;
CREATE POLICY lead_attachments_select ON public.lead_attachments
  FOR SELECT TO authenticated
  USING (
    (lead_source = 'pedro'  AND EXISTS (SELECT 1 FROM public.ai_crm_leads l WHERE l.id = lead_attachments.lead_id))
    OR (lead_source = 'marcos' AND EXISTS (SELECT 1 FROM public.crm_leads    l WHERE l.id = lead_attachments.lead_id))
  );

DROP POLICY IF EXISTS lead_attachments_insert ON public.lead_attachments;
CREATE POLICY lead_attachments_insert ON public.lead_attachments
  FOR INSERT TO authenticated
  WITH CHECK (
    uploaded_by = auth.uid()
    AND (
      (lead_source = 'pedro'  AND EXISTS (SELECT 1 FROM public.ai_crm_leads l WHERE l.id = lead_attachments.lead_id))
      OR (lead_source = 'marcos' AND EXISTS (SELECT 1 FROM public.crm_leads    l WHERE l.id = lead_attachments.lead_id))
    )
  );

-- DELETE: quem enviou OU o dono da conta (user_id do lead = auth.uid()).
DROP POLICY IF EXISTS lead_attachments_delete ON public.lead_attachments;
CREATE POLICY lead_attachments_delete ON public.lead_attachments
  FOR DELETE TO authenticated
  USING (
    uploaded_by = auth.uid()
    OR (lead_source = 'pedro'  AND EXISTS (SELECT 1 FROM public.ai_crm_leads l WHERE l.id = lead_attachments.lead_id AND l.user_id = auth.uid()))
    OR (lead_source = 'marcos' AND EXISTS (SELECT 1 FROM public.crm_leads    l WHERE l.id = lead_attachments.lead_id AND l.user_id = auth.uid()))
  );

GRANT SELECT, INSERT, DELETE ON public.lead_attachments TO authenticated;

-- ── Storage policies (bucket lead-docs): herdam a visibilidade do lead ──────
-- caminho = {origem}/{lead_id}/{uuid}.{ext}  => foldername[1]=origem, [2]=lead_id
DROP POLICY IF EXISTS lead_docs_select ON storage.objects;
CREATE POLICY lead_docs_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'lead-docs' AND (
      ((storage.foldername(name))[1] = 'pedro'  AND EXISTS (SELECT 1 FROM public.ai_crm_leads l WHERE l.id::text = (storage.foldername(name))[2]))
      OR ((storage.foldername(name))[1] = 'marcos' AND EXISTS (SELECT 1 FROM public.crm_leads    l WHERE l.id::text = (storage.foldername(name))[2]))
    )
  );

DROP POLICY IF EXISTS lead_docs_insert ON storage.objects;
CREATE POLICY lead_docs_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'lead-docs' AND (
      ((storage.foldername(name))[1] = 'pedro'  AND EXISTS (SELECT 1 FROM public.ai_crm_leads l WHERE l.id::text = (storage.foldername(name))[2]))
      OR ((storage.foldername(name))[1] = 'marcos' AND EXISTS (SELECT 1 FROM public.crm_leads    l WHERE l.id::text = (storage.foldername(name))[2]))
    )
  );

DROP POLICY IF EXISTS lead_docs_delete ON storage.objects;
CREATE POLICY lead_docs_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'lead-docs' AND (
      ((storage.foldername(name))[1] = 'pedro'  AND EXISTS (SELECT 1 FROM public.ai_crm_leads l WHERE l.id::text = (storage.foldername(name))[2]))
      OR ((storage.foldername(name))[1] = 'marcos' AND EXISTS (SELECT 1 FROM public.crm_leads    l WHERE l.id::text = (storage.foldername(name))[2]))
    )
  );
