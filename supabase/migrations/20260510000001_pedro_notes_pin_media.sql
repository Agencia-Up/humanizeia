-- ═══════════════════════════════════════════════════════════════════════
-- Pedro CRM: Pin notes + Follow-up media support
-- ═══════════════════════════════════════════════════════════════════════

-- 1. Notas fixadas (pinned)
ALTER TABLE public.pedro_crm_notes
  ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS pedro_crm_notes_pinned_idx
  ON public.pedro_crm_notes(is_pinned) WHERE is_pinned = TRUE;

-- 2. Mídia em follow-ups (áudio, imagem, vídeo)
ALTER TABLE public.pedro_followup_schedules
  ADD COLUMN IF NOT EXISTS media_url  TEXT,
  ADD COLUMN IF NOT EXISTS media_type TEXT;  -- 'image' | 'video' | 'audio' | null

-- 3. Bucket para mídia de follow-up (reutiliza creatives se existir)
INSERT INTO storage.buckets (id, name, public)
VALUES ('followup-media', 'followup-media', true)
ON CONFLICT (id) DO NOTHING;

-- RLS para followup-media bucket
CREATE POLICY "Users can upload followup media"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'followup-media');

CREATE POLICY "Users can read followup media"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'followup-media');

CREATE POLICY "Users can delete own followup media"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'followup-media');
