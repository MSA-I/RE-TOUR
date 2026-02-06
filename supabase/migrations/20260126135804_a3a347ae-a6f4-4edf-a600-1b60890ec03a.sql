-- Create pipeline_camera_markers table for storing camera planning markers
CREATE TABLE public.pipeline_camera_markers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  pipeline_id UUID NOT NULL REFERENCES public.floorplan_pipelines(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL,
  -- Position on image (normalized 0..1)
  x_norm NUMERIC NOT NULL CHECK (x_norm >= 0 AND x_norm <= 1),
  y_norm NUMERIC NOT NULL CHECK (y_norm >= 0 AND y_norm <= 1),
  -- Orientation
  yaw_deg NUMERIC NOT NULL DEFAULT 0 CHECK (yaw_deg >= 0 AND yaw_deg < 360),
  fov_deg NUMERIC NOT NULL DEFAULT 80 CHECK (fov_deg >= 10 AND fov_deg <= 180),
  -- Metadata
  label TEXT NOT NULL,
  room_id UUID REFERENCES public.floorplan_pipeline_spaces(id) ON DELETE SET NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.pipeline_camera_markers ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Users can view their own camera markers"
ON public.pipeline_camera_markers FOR SELECT
USING (auth.uid() = owner_id);

CREATE POLICY "Users can insert their own camera markers"
ON public.pipeline_camera_markers FOR INSERT
WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Users can update their own camera markers"
ON public.pipeline_camera_markers FOR UPDATE
USING (auth.uid() = owner_id);

CREATE POLICY "Users can delete their own camera markers"
ON public.pipeline_camera_markers FOR DELETE
USING (auth.uid() = owner_id);

-- Create trigger for updated_at
CREATE TRIGGER update_camera_markers_updated_at
  BEFORE UPDATE ON public.pipeline_camera_markers
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Add camera_plan phases to floorplan_pipelines status constraint
ALTER TABLE public.floorplan_pipelines DROP CONSTRAINT IF EXISTS valid_status_values;
ALTER TABLE public.floorplan_pipelines ADD CONSTRAINT valid_status_values CHECK (
  status IN (
    -- Base states
    'draft', 'initialized', 'pending', 'running', 'completed', 'failed', 'cancelled',
    -- QA states
    'waiting_qa', 'ai_qa_fail', 'ai_qa_pass', 'retrying', 'blocked_for_human', 'stalled',
    -- Step 0 (Analysis)
    'step0_pending', 'step0_running', 'step0_waiting_approval', 'step0_rejected',
    'step0_qa_fail', 'step0_blocked_for_human',
    -- Step 1 (Top-Down)
    'step1_pending', 'step1_running', 'step1_waiting_approval', 'step1_rejected',
    'step1_qa_fail', 'step1_blocked_for_human',
    -- Step 2 (Style)
    'step2_pending', 'step2_running', 'step2_waiting_approval', 'step2_rejected',
    'step2_qa_fail', 'step2_blocked_for_human',
    -- Step 3 (Camera Planning) - NEW
    'step3_pending', 'step3_running', 'step3_waiting_approval', 'step3_rejected',
    'camera_plan_pending', 'camera_plan_confirmed',
    -- Step 4 (Spaces/Renders) - was Step 3
    'step4_pending', 'step4_running', 'step4_waiting_approval', 'step4_rejected',
    'step4_qa_fail', 'step4_blocked_for_human',
    'spaces_detected', 'spaces_detected_waiting_approval',
    -- Step 5 (Panoramas) - was Step 4
    'step5_pending', 'step5_running', 'step5_waiting_approval', 'step5_rejected',
    'step5_qa_fail', 'step5_blocked_for_human',
    -- Step 6 (Merge) - was Step 5
    'step6_pending', 'step6_running', 'step6_waiting_approval', 'step6_rejected',
    'step6_qa_fail', 'step6_blocked_for_human',
    -- Step 7 - NEW slot for future
    'step7_pending', 'step7_running', 'step7_waiting_approval', 'step7_rejected',
    -- Whole apartment phase-related (legacy compatibility)
    'top_down_3d_review', 'style_review',
    'space_analysis_pending', 'space_analysis_running', 'space_analysis_review', 'space_analysis_failed'
  )
);

-- Add camera_plan_confirmed_at column to track when camera plan was approved
ALTER TABLE public.floorplan_pipelines 
ADD COLUMN IF NOT EXISTS camera_plan_confirmed_at TIMESTAMP WITH TIME ZONE;