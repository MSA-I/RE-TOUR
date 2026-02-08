-- CHANGE 3: Create change_suggestions table with interior design presets
CREATE TABLE public.change_suggestions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  prompt TEXT NOT NULL,
  is_generated BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS on change_suggestions
ALTER TABLE public.change_suggestions ENABLE ROW LEVEL SECURITY;

-- Allow all authenticated users to read suggestions (public presets)
CREATE POLICY "Authenticated users can view suggestions"
ON public.change_suggestions
FOR SELECT
USING (auth.role() = 'authenticated');

-- Add index for category filtering
CREATE INDEX idx_change_suggestions_category ON public.change_suggestions(category);

-- Seed interior design presets
INSERT INTO public.change_suggestions (category, title, prompt) VALUES
  -- Materials
  ('materials', 'Marble Floor', 'Replace the floor with polished white Carrara marble tiles'),
  ('materials', 'Herringbone Wood', 'Replace the floor with warm oak herringbone wood pattern'),
  ('materials', 'Terrazzo Floor', 'Replace the floor with colorful terrazzo tiles'),
  ('materials', 'Concrete Floor', 'Replace the floor with polished industrial concrete'),
  ('materials', 'Hexagonal Tiles', 'Replace the floor with hexagonal cement tiles in neutral tones'),
  
  -- Walls
  ('walls', 'Wood Paneling', 'Add vertical wooden slat paneling to the main wall'),
  ('walls', 'Brick Accent', 'Add exposed red brick texture to the accent wall'),
  ('walls', 'Stone Cladding', 'Cover the main wall with natural stone cladding'),
  ('walls', 'Textured Plaster', 'Apply Venetian plaster texture to the walls'),
  ('walls', 'Bold Color', 'Paint the accent wall in deep forest green'),
  
  -- Furniture
  ('furniture', 'Minimalist Style', 'Change all furniture to clean minimalist Scandinavian style'),
  ('furniture', 'Mid-Century Modern', 'Replace furniture with mid-century modern pieces'),
  ('furniture', 'Industrial Loft', 'Change furniture to industrial style with metal and leather'),
  ('furniture', 'Bohemian', 'Replace furniture with eclectic bohemian style pieces'),
  ('furniture', 'Japanese Zen', 'Change furniture to low Japanese-inspired minimal pieces'),
  
  -- Lighting
  ('lighting', 'Pendant Cluster', 'Replace ceiling lights with a cluster of pendant lights'),
  ('lighting', 'Track Lighting', 'Install modern track lighting on the ceiling'),
  ('lighting', 'Recessed Spots', 'Replace all lights with recessed spotlights'),
  ('lighting', 'Statement Chandelier', 'Add a modern sculptural chandelier as focal point'),
  ('lighting', 'Linear LED', 'Install linear LED strip lighting along walls'),
  
  -- Decor
  ('decor', 'Indoor Plants', 'Add lush indoor plants and greenery throughout'),
  ('decor', 'Gallery Wall', 'Add a gallery wall with framed artwork'),
  ('decor', 'Sculptural Elements', 'Add modern sculptural decorative objects'),
  ('decor', 'Natural Textures', 'Add natural fiber baskets, woven rugs, and organic elements'),
  ('decor', 'Minimalist Decor', 'Remove excess decor, keep only essential minimalist pieces'),
  
  -- Atmosphere
  ('atmosphere', 'Warm Tones', 'Shift the entire color palette to warm earthy tones'),
  ('atmosphere', 'Cool Nordic', 'Change the palette to cool Scandinavian whites and grays'),
  ('atmosphere', 'Moody Dark', 'Transform to dark moody atmosphere with deep colors'),
  ('atmosphere', 'Bright Airy', 'Make the space feel bright, airy and light-filled'),
  ('atmosphere', 'Cozy Hygge', 'Add warm textiles and soft lighting for cozy hygge feel');

-- CHANGE 4: Add output_resolution field to render_jobs (if not exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'render_jobs' AND column_name = 'output_resolution'
  ) THEN
    ALTER TABLE public.render_jobs ADD COLUMN output_resolution TEXT DEFAULT '2K';
  END IF;
END $$;

-- Enable realtime for change_suggestions
ALTER PUBLICATION supabase_realtime ADD TABLE public.change_suggestions;