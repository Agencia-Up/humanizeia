
-- Allow authenticated users to upload files to the creatives bucket
CREATE POLICY "Authenticated users can upload to creatives"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'creatives');

-- Allow authenticated users to read files from the creatives bucket
CREATE POLICY "Authenticated users can read creatives"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'creatives');

-- Allow authenticated users to update their own files
CREATE POLICY "Authenticated users can update creatives"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'creatives');

-- Allow authenticated users to delete their own files
CREATE POLICY "Authenticated users can delete creatives"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'creatives');
