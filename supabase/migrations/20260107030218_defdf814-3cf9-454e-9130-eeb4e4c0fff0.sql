-- Add aspect_ratio and output_quality columns to image_edit_jobs
ALTER TABLE public.image_edit_jobs 
ADD COLUMN IF NOT EXISTS aspect_ratio TEXT DEFAULT '1:1',
ADD COLUMN IF NOT EXISTS output_quality TEXT DEFAULT '2k';