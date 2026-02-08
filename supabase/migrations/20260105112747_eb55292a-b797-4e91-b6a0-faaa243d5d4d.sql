-- Create floor_plans storage bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('floor_plans', 'floor_plans', false);

-- Create RLS policies for floor_plans bucket
CREATE POLICY "Users can upload their own floor plans"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'floor_plans' 
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Users can view their own floor plans"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'floor_plans' 
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Users can delete their own floor plans"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'floor_plans' 
  AND auth.uid()::text = (storage.foldername(name))[1]
);