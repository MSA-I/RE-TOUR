-- Add output_resolution and aspect_ratio columns to floorplan_pipelines
ALTER TABLE public.floorplan_pipelines
ADD COLUMN output_resolution text DEFAULT '2K',
ADD COLUMN aspect_ratio text DEFAULT '16:9';

-- Add pipeline suggestions table
CREATE TABLE public.pipeline_suggestions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  step_number integer NOT NULL,
  category text NOT NULL,
  title text NOT NULL,
  prompt text NOT NULL,
  is_generated boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now()
);

-- Enable RLS on pipeline_suggestions
ALTER TABLE public.pipeline_suggestions ENABLE ROW LEVEL SECURITY;

-- All authenticated users can view pipeline suggestions
CREATE POLICY "Authenticated users can view pipeline suggestions"
ON public.pipeline_suggestions FOR SELECT
USING (auth.role() = 'authenticated');

-- Seed initial pipeline suggestions for Step 1 (Top-Down)
INSERT INTO public.pipeline_suggestions (step_number, category, title, prompt) VALUES
(1, 'line_cleanup', 'Clean Line Work', 'Ensure all wall lines are crisp and clearly defined with consistent thickness throughout'),
(1, 'line_cleanup', 'Enhance Wall Definition', 'Add subtle shadows to wall edges for better depth and legibility'),
(1, 'labeling', 'Remove Labels', 'Generate the 3D render without any text labels or room annotations'),
(1, 'texture', 'Add Floor Texture', 'Apply realistic wood plank flooring texture with natural grain patterns'),
(1, 'contrast', 'High Contrast Render', 'Increase contrast between walls and floors for architectural clarity'),
(1, 'shadows', 'Soft Ambient Shadows', 'Add soft ambient occlusion shadows at wall-floor intersections');

-- Seed initial pipeline suggestions for Step 2 (Eye-Level)
INSERT INTO public.pipeline_suggestions (step_number, category, title, prompt) VALUES
(2, 'style', 'Modern Scandinavian', 'Apply Scandinavian design style with light wood tones, white walls, and minimal furniture'),
(2, 'style', 'Luxury Contemporary', 'Apply contemporary luxury style with marble accents, metallic finishes, and designer furniture'),
(2, 'materials', 'Warm Wood Tones', 'Use warm honey-colored wood for floors and furniture with complementary neutral fabrics'),
(2, 'materials', 'Cool Modern Palette', 'Apply cool grey tones with concrete, glass, and brushed steel materials'),
(2, 'lighting', 'Golden Hour Light', 'Set lighting to golden hour with warm sunlight streaming through windows'),
(2, 'lighting', 'Bright Daylight', 'Use bright, even daylight illumination with soft shadows'),
(2, 'furniture', 'Minimalist Furniture', 'Keep furniture minimal and essential with clean lines'),
(2, 'furniture', 'Cozy Living Setup', 'Add plush sofas, textured rugs, and comfortable seating arrangements'),
(2, 'realism', 'Ultra Photorealistic', 'Maximum photorealism with accurate material reflections and subtle imperfections');

-- Seed initial pipeline suggestions for Step 4 (Panorama)
INSERT INTO public.pipeline_suggestions (step_number, category, title, prompt) VALUES
(4, 'camera', 'Center Room Position', 'Place camera in the center of the living room facing the main seating area'),
(4, 'camera', 'Kitchen View', 'Position camera at kitchen island looking toward dining and living areas'),
(4, 'panorama', 'True 360 VR Ready', 'Ensure perfect 2:1 equirectangular format with straight verticals for VR viewing'),
(4, 'panorama', 'Seamless Wrap', 'Verify seamless horizontal wrap with no visible seams at panorama edges');