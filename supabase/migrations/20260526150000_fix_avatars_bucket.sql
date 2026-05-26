-- ============================================================================
-- Fix bucket avatars (descoberto 2026-05-26)
-- ============================================================================
-- BUG: master tentando subir foto em /perfil dava "new row violates row-level
--      security policy". 2 problemas:
--   1. bucket 'avatars' nunca foi criado em STAGING (talvez nem em PROD)
--   2. policy avatars_user_upload espera path "{user_id}/arquivo", mas
--      o código ProfileSettingsTab usava path "avatars/{user_id}.ext"
--
-- Fix:
--   1. Cria bucket 'avatars' (público pra leitura — fotos são URLs públicas
--      que aparecem em Dashboard TV e cards de perfil)
--   2. Drop policy antiga + recria com 2 policies separadas:
--        avatars_public_read    → qualquer pessoa lê (bucket é público)
--        avatars_user_write     → user autenticado pode INSERT/UPDATE/DELETE
--                                 onde primeiro folder do path = auth.uid()
--
-- O código frontend (ProfileSettingsTab e DashboardTVSettingsTab) precisa usar
-- path no formato "{user.id}/...".
-- ============================================================================

-- 1. Criar bucket avatars (idempotente)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'avatars',
  'avatars',
  true,                                  -- bucket público (leitura via URL pública)
  2 * 1024 * 1024,                       -- 2MB limite por arquivo
  ARRAY['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE SET
  public = true,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- 2. Drop policies antigas (se existirem)
DROP POLICY IF EXISTS "avatars_user_upload" ON storage.objects;
DROP POLICY IF EXISTS "avatars_public_read" ON storage.objects;
DROP POLICY IF EXISTS "avatars_user_write"  ON storage.objects;

-- 3. SELECT público — qualquer pessoa pode ler URLs de avatars
CREATE POLICY "avatars_public_read"
  ON storage.objects
  FOR SELECT
  TO public
  USING (bucket_id = 'avatars');

-- 4. INSERT/UPDATE/DELETE — apenas usuário autenticado, e apenas em arquivos
--    onde o PRIMEIRO folder do path é o próprio auth.uid().
--    Path esperado: "{user.id}/qualquer-arquivo.ext"
--    Exemplo: "054705a3-e08d.../avatar.png" → folder[1] = "054705a3-e08d..."
--    Exemplo: "054705a3-e08d.../sellers/abc-123.png" → folder[1] = "054705a3-e08d..."
CREATE POLICY "avatars_user_write"
  ON storage.objects
  FOR ALL
  TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = (auth.uid())::text
  )
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = (auth.uid())::text
  );

DO $$
BEGIN
  RAISE NOTICE '[FixAvatars] bucket avatars + 2 policies criadas/atualizadas';
END $$;
