-- =============================================================================
-- FIX: upload de documento no card do lead falhava (bucket lead-docs) — 23/07/2026
--
-- BUG (desde o lançamento da feature): nas 3 policies de storage do bucket
-- lead-docs, o ramo do MARCOS comparava o id do lead com
--   (storage.foldername(l.name))[2]        -- l.name = NOME DA PESSOA ("João")
-- em vez de
--   (storage.foldername(objects.name))[2]  -- caminho real: marcos/<lead_id>/<arq>
-- => a condição NUNCA era verdadeira e QUALQUER upload/leitura/exclusão de
-- documento em lead do Marcos dava erro ("Erro ao enviar <arquivo>"). Como
-- documento de lead é quase sempre PDF, o sintoma reportado foi "subir PDF dá
-- erro". O ramo do Pedro estava correto (por isso os 2 únicos objetos do bucket
-- são de leads Pedro). A tabela lead_attachments estava certa — só storage.
--
-- FIX: recria as 3 policies com o ramo marcos apontando pro objects.name.
-- O EXISTS roda sob a RLS de leads do PRÓPRIO chamador (master = tenant dele;
-- vendedor = atribuídos; gerente-membro = tenant) — escopo preservado.
-- =============================================================================

DROP POLICY IF EXISTS lead_docs_insert ON storage.objects;
CREATE POLICY lead_docs_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'lead-docs'
    AND (
      ((storage.foldername(name))[1] = 'pedro' AND EXISTS (
        SELECT 1 FROM public.ai_crm_leads l
        WHERE l.id::text = (storage.foldername(objects.name))[2]))
      OR
      ((storage.foldername(name))[1] = 'marcos' AND EXISTS (
        SELECT 1 FROM public.crm_leads l
        WHERE l.id::text = (storage.foldername(objects.name))[2]))
    )
  );

DROP POLICY IF EXISTS lead_docs_select ON storage.objects;
CREATE POLICY lead_docs_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'lead-docs'
    AND (
      ((storage.foldername(name))[1] = 'pedro' AND EXISTS (
        SELECT 1 FROM public.ai_crm_leads l
        WHERE l.id::text = (storage.foldername(objects.name))[2]))
      OR
      ((storage.foldername(name))[1] = 'marcos' AND EXISTS (
        SELECT 1 FROM public.crm_leads l
        WHERE l.id::text = (storage.foldername(objects.name))[2]))
    )
  );

DROP POLICY IF EXISTS lead_docs_delete ON storage.objects;
CREATE POLICY lead_docs_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'lead-docs'
    AND (
      ((storage.foldername(name))[1] = 'pedro' AND EXISTS (
        SELECT 1 FROM public.ai_crm_leads l
        WHERE l.id::text = (storage.foldername(objects.name))[2]))
      OR
      ((storage.foldername(name))[1] = 'marcos' AND EXISTS (
        SELECT 1 FROM public.crm_leads l
        WHERE l.id::text = (storage.foldername(objects.name))[2]))
    )
  );
