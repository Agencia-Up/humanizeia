-- ═══════════════════════════════════════════════════════════════════════
-- Inbox do Pedro: mídia recebida + acesso de leitura do vendedor
--   1. Bucket público `wa-media` p/ re-hospedar a mídia que o LEAD envia
--      (imagem/áudio/vídeo/doc). Hoje a URL do WhatsApp vem criptografada
--      (.enc, irrenderizável) e o áudio nem URL tem. O webhook passa a
--      baixar os bytes e subir aqui, gravando a URL pública em wa_inbox.
--   2. Policy SELECT p/ o vendedor LER wa_chat_history do master (consulta
--      somente-leitura no inbox). wa_inbox e ai_crm_leads já tinham; faltava
--      wa_chat_history -> sem isto a conversa do Pedro V2 abria vazia pro
--      vendedor. Espelha a policy `seller_view_master_inbox` de wa_inbox.
-- ═══════════════════════════════════════════════════════════════════════

-- 1. Bucket público para mídia recebida no inbox -----------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('wa-media', 'wa-media', true)
ON CONFLICT (id) DO NOTHING;

-- Leitura pública (os <img>/<audio> do inbox abrem via getPublicUrl).
DROP POLICY IF EXISTS "Public read wa-media" ON storage.objects;
CREATE POLICY "Public read wa-media"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'wa-media');

-- Escrita é feita pelo webhook com a service-role (bypassa RLS); a policy
-- abaixo só cobre eventual upload autenticado pela UI.
DROP POLICY IF EXISTS "Authenticated upload wa-media" ON storage.objects;
CREATE POLICY "Authenticated upload wa-media"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'wa-media');

-- 2. Vendedor lê o histórico de chat do master (somente-leitura) -------------
-- Reutiliza o helper já existente get_seller_master_user_id() (SECURITY
-- DEFINER) — mesmo padrão das policies de wa_inbox.
DROP POLICY IF EXISTS "seller_view_master_chat_history" ON public.wa_chat_history;
CREATE POLICY "seller_view_master_chat_history"
  ON public.wa_chat_history FOR SELECT
  TO authenticated
  USING (user_id = public.get_seller_master_user_id());
