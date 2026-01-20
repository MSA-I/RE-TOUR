-- Create private storage buckets
INSERT INTO storage.buckets (id, name, public) VALUES ('panoramas', 'panoramas', false);
INSERT INTO storage.buckets (id, name, public) VALUES ('design_refs', 'design_refs', false);
INSERT INTO storage.buckets (id, name, public) VALUES ('outputs', 'outputs', false);

-- Storage policies for panoramas bucket
CREATE POLICY "Users can view their own panoramas"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'panoramas' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can upload their own panoramas"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'panoramas' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can update their own panoramas"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'panoramas' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can delete their own panoramas"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'panoramas' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Storage policies for design_refs bucket
CREATE POLICY "Users can view their own design_refs"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'design_refs' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can upload their own design_refs"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'design_refs' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can update their own design_refs"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'design_refs' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can delete their own design_refs"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'design_refs' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Storage policies for outputs bucket
CREATE POLICY "Users can view their own outputs"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'outputs' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can upload their own outputs"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'outputs' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can update their own outputs"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'outputs' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can delete their own outputs"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'outputs' AND auth.uid()::text = (storage.foldername(name))[1]);