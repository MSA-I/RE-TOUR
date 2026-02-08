-- =====================================================
-- BRANCHING ROOM-AWARE PIPELINE ARCHITECTURE v2
-- =====================================================

-- 1. Add new columns to floorplan_pipelines for v2 architecture
ALTER TABLE public.floorplan_pipelines 
ADD COLUMN IF NOT EXISTS architecture_version TEXT DEFAULT 'v1_linear',
ADD COLUMN IF NOT EXISTS global_phase TEXT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS global_3d_render_id UUID,
ADD COLUMN IF NOT EXISTS global_style_bible JSONB;

-- 2. Create pipeline_spatial_maps table (Step 0 output)
CREATE TABLE public.pipeline_spatial_maps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_id UUID NOT NULL REFERENCES public.floorplan_pipelines(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL,
  rooms JSONB NOT NULL DEFAULT '[]',
  adjacency_graph JSONB DEFAULT '[]',
  raw_analysis TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.pipeline_spatial_maps ENABLE ROW LEVEL SECURITY;

-- RLS policies for pipeline_spatial_maps
CREATE POLICY "Users can view their own spatial maps"
ON public.pipeline_spatial_maps FOR SELECT
USING (auth.uid() = owner_id);

CREATE POLICY "Users can insert their own spatial maps"
ON public.pipeline_spatial_maps FOR INSERT
WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Users can update their own spatial maps"
ON public.pipeline_spatial_maps FOR UPDATE
USING (auth.uid() = owner_id);

CREATE POLICY "Users can delete their own spatial maps"
ON public.pipeline_spatial_maps FOR DELETE
USING (auth.uid() = owner_id);

-- 3. Create room_sub_pipelines table (per-room tracking)
CREATE TABLE public.room_sub_pipelines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_id UUID NOT NULL REFERENCES public.floorplan_pipelines(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL,
  room_id TEXT NOT NULL,
  room_type TEXT NOT NULL,
  room_label TEXT,
  bounds JSONB,
  status TEXT NOT NULL DEFAULT 'pending',
  camera_renders JSONB DEFAULT '[]',
  panorama_upload_id UUID,
  panorama_qa_decision TEXT,
  panorama_qa_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(pipeline_id, room_id)
);

-- Enable RLS
ALTER TABLE public.room_sub_pipelines ENABLE ROW LEVEL SECURITY;

-- RLS policies for room_sub_pipelines
CREATE POLICY "Users can view their own room sub-pipelines"
ON public.room_sub_pipelines FOR SELECT
USING (auth.uid() = owner_id);

CREATE POLICY "Users can insert their own room sub-pipelines"
ON public.room_sub_pipelines FOR INSERT
WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Users can update their own room sub-pipelines"
ON public.room_sub_pipelines FOR UPDATE
USING (auth.uid() = owner_id);

CREATE POLICY "Users can delete their own room sub-pipelines"
ON public.room_sub_pipelines FOR DELETE
USING (auth.uid() = owner_id);

-- Trigger for updated_at
CREATE TRIGGER update_room_sub_pipelines_updated_at
BEFORE UPDATE ON public.room_sub_pipelines
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- 4. Create global_qa_results table (cross-room consistency)
CREATE TABLE public.global_qa_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_id UUID NOT NULL REFERENCES public.floorplan_pipelines(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL,
  room_pair TEXT[] NOT NULL,
  consistency_decision TEXT,
  inconsistency_type TEXT,
  inconsistency_details TEXT,
  rerender_triggered BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.global_qa_results ENABLE ROW LEVEL SECURITY;

-- RLS policies for global_qa_results
CREATE POLICY "Users can view their own global QA results"
ON public.global_qa_results FOR SELECT
USING (auth.uid() = owner_id);

CREATE POLICY "Users can insert their own global QA results"
ON public.global_qa_results FOR INSERT
WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Users can update their own global QA results"
ON public.global_qa_results FOR UPDATE
USING (auth.uid() = owner_id);

CREATE POLICY "Users can delete their own global QA results"
ON public.global_qa_results FOR DELETE
USING (auth.uid() = owner_id);

-- 5. Create room_sub_pipeline_events table (per-room event tracking)
CREATE TABLE public.room_sub_pipeline_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_sub_pipeline_id UUID NOT NULL REFERENCES public.room_sub_pipelines(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL,
  step_type TEXT NOT NULL,
  progress_int INTEGER DEFAULT 0,
  ts TIMESTAMPTZ NOT NULL DEFAULT now(),
  type TEXT NOT NULL,
  message TEXT NOT NULL
);

-- Enable RLS
ALTER TABLE public.room_sub_pipeline_events ENABLE ROW LEVEL SECURITY;

-- RLS policies for room_sub_pipeline_events
CREATE POLICY "Users can view their own room sub-pipeline events"
ON public.room_sub_pipeline_events FOR SELECT
USING (auth.uid() = owner_id);

CREATE POLICY "Users can insert their own room sub-pipeline events"
ON public.room_sub_pipeline_events FOR INSERT
WITH CHECK (auth.uid() = owner_id);

-- Add indexes for performance
CREATE INDEX idx_spatial_maps_pipeline ON public.pipeline_spatial_maps(pipeline_id);
CREATE INDEX idx_room_sub_pipelines_pipeline ON public.room_sub_pipelines(pipeline_id);
CREATE INDEX idx_room_sub_pipelines_status ON public.room_sub_pipelines(status);
CREATE INDEX idx_global_qa_results_pipeline ON public.global_qa_results(pipeline_id);
CREATE INDEX idx_room_sub_pipeline_events_room ON public.room_sub_pipeline_events(room_sub_pipeline_id);