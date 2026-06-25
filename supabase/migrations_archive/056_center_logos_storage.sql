-- Center logos storage bucket: PUBLIC so images are accessible via getPublicUrl()
-- Create bucket (idempotent). If it fails, create manually in Supabase Dashboard: Storage > New bucket > "center-logos", Public = true
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('center-logos', 'center-logos', true, 2097152, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE SET public = true, file_size_limit = 2097152, allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp'];

-- RLS: Allow authenticated users to upload to their center's folder (path: centerId/logo.ext)
DROP POLICY IF EXISTS "Allow authenticated uploads" ON storage.objects;
CREATE POLICY "Allow authenticated uploads" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'center-logos');

-- RLS: Allow public read so logo images load in img src
DROP POLICY IF EXISTS "Allow public read center logos" ON storage.objects;
CREATE POLICY "Allow public read center logos" ON storage.objects
  FOR SELECT TO public
  USING (bucket_id = 'center-logos');
