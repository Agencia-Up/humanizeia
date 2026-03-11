
-- Create storage bucket for creative images
INSERT INTO storage.buckets (id, name, public) VALUES ('creatives', 'creatives', true);

-- Allow authenticated users to upload to their own folder
CREATE POLICY "Users can upload own creatives"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'creatives' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Allow public read access
CREATE POLICY "Creatives are publicly accessible"
ON storage.objects FOR SELECT
USING (bucket_id = 'creatives');

-- Allow users to delete their own creatives
CREATE POLICY "Users can delete own creatives"
ON storage.objects FOR DELETE
USING (bucket_id = 'creatives' AND auth.uid()::text = (storage.foldername(name))[1]);
