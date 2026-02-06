-- =============================================
-- WHOLE APARTMENT PIPELINE SCHEMA
-- =============================================

-- 1. Pipeline Spaces (detected rooms/spaces)
CREATE TABLE public.floorplan_pipeline_spaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_id UUID NOT NULL REFERENCES public.floorplan_pipelines(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL,
  name TEXT NOT NULL,
  space_type TEXT NOT NULL,
  confidence NUMERIC(3,2) DEFAULT 0.95,
  bounds_note TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  render_a_status TEXT DEFAULT 'pending',
  render_b_status TEXT DEFAULT 'pending',
  panorama_a_status TEXT DEFAULT 'pending',
  panorama_b_status TEXT DEFAULT 'pending',
  final_360_status TEXT DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.floorplan_pipeline_spaces ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view their own pipeline spaces"
  ON public.floorplan_pipeline_spaces FOR SELECT
  USING (auth.uid() = owner_id);

CREATE POLICY "Users can insert their own pipeline spaces"
  ON public.floorplan_pipeline_spaces FOR INSERT
  WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Users can update their own pipeline spaces"
  ON public.floorplan_pipeline_spaces FOR UPDATE
  USING (auth.uid() = owner_id);

CREATE POLICY "Users can delete their own pipeline spaces"
  ON public.floorplan_pipeline_spaces FOR DELETE
  USING (auth.uid() = owner_id);

-- 2. Space Renders (A/B renders per space)
CREATE TABLE public.floorplan_space_renders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id UUID NOT NULL REFERENCES public.floorplan_pipeline_spaces(id) ON DELETE CASCADE,
  pipeline_id UUID NOT NULL REFERENCES public.floorplan_pipelines(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('A', 'B')),
  status TEXT NOT NULL DEFAULT 'pending',
  output_upload_id UUID REFERENCES public.uploads(id),
  prompt_text TEXT,
  ratio TEXT DEFAULT '16:9',
  quality TEXT DEFAULT '2K',
  model TEXT,
  attempt_index INTEGER DEFAULT 1,
  locked_approved BOOLEAN DEFAULT false,
  qa_status TEXT DEFAULT 'pending',
  qa_report JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.floorplan_space_renders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own space renders"
  ON public.floorplan_space_renders FOR SELECT
  USING (auth.uid() = owner_id);

CREATE POLICY "Users can insert their own space renders"
  ON public.floorplan_space_renders FOR INSERT
  WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Users can update their own space renders"
  ON public.floorplan_space_renders FOR UPDATE
  USING (auth.uid() = owner_id);

CREATE POLICY "Users can delete their own space renders"
  ON public.floorplan_space_renders FOR DELETE
  USING (auth.uid() = owner_id);

-- 3. Space Panoramas (A/B panoramas from renders)
CREATE TABLE public.floorplan_space_panoramas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id UUID NOT NULL REFERENCES public.floorplan_pipeline_spaces(id) ON DELETE CASCADE,
  pipeline_id UUID NOT NULL REFERENCES public.floorplan_pipelines(id) ON DELETE CASCADE,
  source_render_id UUID REFERENCES public.floorplan_space_renders(id) ON DELETE SET NULL,
  owner_id UUID NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('A', 'B')),
  status TEXT NOT NULL DEFAULT 'pending',
  output_upload_id UUID REFERENCES public.uploads(id),
  prompt_text TEXT,
  ratio TEXT DEFAULT '2:1',
  quality TEXT DEFAULT '2K',
  model TEXT,
  attempt_index INTEGER DEFAULT 1,
  locked_approved BOOLEAN DEFAULT false,
  qa_status TEXT DEFAULT 'pending',
  qa_report JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.floorplan_space_panoramas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own space panoramas"
  ON public.floorplan_space_panoramas FOR SELECT
  USING (auth.uid() = owner_id);

CREATE POLICY "Users can insert their own space panoramas"
  ON public.floorplan_space_panoramas FOR INSERT
  WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Users can update their own space panoramas"
  ON public.floorplan_space_panoramas FOR UPDATE
  USING (auth.uid() = owner_id);

CREATE POLICY "Users can delete their own space panoramas"
  ON public.floorplan_space_panoramas FOR DELETE
  USING (auth.uid() = owner_id);

-- 4. Space Final 360 (merged panorama per space)
CREATE TABLE public.floorplan_space_final360 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id UUID NOT NULL REFERENCES public.floorplan_pipeline_spaces(id) ON DELETE CASCADE,
  pipeline_id UUID NOT NULL REFERENCES public.floorplan_pipelines(id) ON DELETE CASCADE,
  panorama_a_id UUID REFERENCES public.floorplan_space_panoramas(id) ON DELETE SET NULL,
  panorama_b_id UUID REFERENCES public.floorplan_space_panoramas(id) ON DELETE SET NULL,
  owner_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  output_upload_id UUID REFERENCES public.uploads(id),
  merge_instructions TEXT,
  model TEXT,
  attempt_index INTEGER DEFAULT 1,
  locked_approved BOOLEAN DEFAULT false,
  qa_status TEXT DEFAULT 'pending',
  qa_report JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.floorplan_space_final360 ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own space final360"
  ON public.floorplan_space_final360 FOR SELECT
  USING (auth.uid() = owner_id);

CREATE POLICY "Users can insert their own space final360"
  ON public.floorplan_space_final360 FOR INSERT
  WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Users can update their own space final360"
  ON public.floorplan_space_final360 FOR UPDATE
  USING (auth.uid() = owner_id);

CREATE POLICY "Users can delete their own space final360"
  ON public.floorplan_space_final360 FOR DELETE
  USING (auth.uid() = owner_id);

-- 5. Add pipeline_mode to floorplan_pipelines
ALTER TABLE public.floorplan_pipelines 
  ADD COLUMN IF NOT EXISTS pipeline_mode TEXT DEFAULT 'legacy';

-- 6. Add whole_apartment_phase to track progress in new mode
ALTER TABLE public.floorplan_pipelines 
  ADD COLUMN IF NOT EXISTS whole_apartment_phase TEXT DEFAULT 'upload';

-- 7. Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_pipeline_spaces_pipeline ON public.floorplan_pipeline_spaces(pipeline_id);
CREATE INDEX IF NOT EXISTS idx_space_renders_space ON public.floorplan_space_renders(space_id);
CREATE INDEX IF NOT EXISTS idx_space_renders_pipeline ON public.floorplan_space_renders(pipeline_id);
CREATE INDEX IF NOT EXISTS idx_space_panoramas_space ON public.floorplan_space_panoramas(space_id);
CREATE INDEX IF NOT EXISTS idx_space_panoramas_pipeline ON public.floorplan_space_panoramas(pipeline_id);
CREATE INDEX IF NOT EXISTS idx_space_final360_space ON public.floorplan_space_final360(space_id);
CREATE INDEX IF NOT EXISTS idx_space_final360_pipeline ON public.floorplan_space_final360(pipeline_id);

-- 8. Add triggers for updated_at
CREATE TRIGGER update_pipeline_spaces_updated_at
  BEFORE UPDATE ON public.floorplan_pipeline_spaces
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_space_renders_updated_at
  BEFORE UPDATE ON public.floorplan_space_renders
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_space_panoramas_updated_at
  BEFORE UPDATE ON public.floorplan_space_panoramas
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_space_final360_updated_at
  BEFORE UPDATE ON public.floorplan_space_final360
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();