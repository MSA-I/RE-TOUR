-- Create camera_intents table for Step 4: Camera Intent Architecture
-- This implements the architectural contract defined in system_planning_document.md.resolved
-- Section 5: Camera Intent Output Contract (MANDATORY)

-- Create view direction type enum
CREATE TYPE view_direction_type AS ENUM (
  'into_space',
  'toward_adjacent',
  'at_threshold_inward',
  'at_threshold_outward',
  'corner',
  'feature',
  'angled',
  'elevated'
);

-- Create template ID type (A through H)
CREATE TYPE camera_template_id AS ENUM ('A', 'B', 'C', 'D', 'E', 'F', 'G', 'H');

-- Create camera_intents table
CREATE TABLE public.camera_intents (
  -- Identity (Section 5.2: Stable Identity Requirement)
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  camera_id TEXT NOT NULL UNIQUE, -- Deterministic identifier: f(standing_space_id, template_id, target_space_id)

  -- Pipeline context
  pipeline_id UUID NOT NULL REFERENCES public.floorplan_pipelines(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL,

  -- Standing position (Section 5.5: Mandatory Fields)
  standing_space_id UUID NOT NULL REFERENCES public.floorplan_pipeline_spaces(id) ON DELETE CASCADE,
  standing_space_name TEXT NOT NULL,

  -- Template information (Section 5.5: Mandatory Fields)
  template_id camera_template_id NOT NULL,
  template_description TEXT NOT NULL,

  -- View direction (Section 5.5: Mandatory Fields)
  view_direction_type view_direction_type NOT NULL,

  -- Target space (Section 5.5: Conditional Fields - MUST be present for templates B, C, D)
  target_space_id UUID REFERENCES public.floorplan_pipeline_spaces(id) ON DELETE CASCADE,
  target_space_name TEXT,

  -- Intent description (Section 5.5: Mandatory Fields)
  intent_description TEXT NOT NULL,

  -- Processing metadata
  generation_order INTEGER NOT NULL DEFAULT 0, -- Deterministic ordering (Section 5.3)
  is_selected BOOLEAN NOT NULL DEFAULT true, -- User selection for execution

  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),

  -- Constraints (Section 5.5: Explicitly Forbidden Fields)
  -- Note: This table MUST NOT contain:
  -- - Camera position coordinates (x, y, z)
  -- - Camera orientation vectors
  -- - Field of view or lens parameters
  -- - Geometric measurements
  -- - Creative directives
  -- - Model-specific parameters
  -- - Validation metadata
  -- - Cross-intent references

  -- Conditional field constraints (Section 5.5)
  CONSTRAINT target_space_required_for_adjacency_templates CHECK (
    (template_id IN ('B', 'C', 'D') AND target_space_id IS NOT NULL AND target_space_name IS NOT NULL)
    OR
    (template_id NOT IN ('B', 'C', 'D') AND target_space_id IS NULL AND target_space_name IS NULL)
  )
);

-- Add table comment (Section 1.1: Purpose)
COMMENT ON TABLE public.camera_intents IS 'Step 4: Camera Intent - Deterministic intent-definition layer that translates architectural space definitions into concrete camera standing positions and viewing directions. See system_planning_document.md.resolved Section 1-8 for complete specification.';

-- Add column comments
COMMENT ON COLUMN public.camera_intents.camera_id IS 'Stable deterministic identifier derived from standing_space_id + template_id + target_space_id. Must be reproducible across executions.';
COMMENT ON COLUMN public.camera_intents.standing_space_id IS 'Reference to the space where the camera is positioned (standing location)';
COMMENT ON COLUMN public.camera_intents.template_id IS 'Camera position template identifier (A=into_space, B=toward_adjacent, C=threshold_inward, D=threshold_outward, E=corner, F=feature, G=angled, H=elevated)';
COMMENT ON COLUMN public.camera_intents.view_direction_type IS 'Enumeration of view direction semantics matching the template type';
COMMENT ON COLUMN public.camera_intents.target_space_id IS 'Reference to target/adjacent space (required for templates B, C, D; must be null otherwise)';
COMMENT ON COLUMN public.camera_intents.generation_order IS 'Deterministic ordering: spaces iterate in stable order, templates A→H apply within each space';
COMMENT ON COLUMN public.camera_intents.is_selected IS 'User selection flag - which camera intents to execute for image generation';

-- Create indexes for common query patterns
CREATE INDEX idx_camera_intents_pipeline_id ON public.camera_intents(pipeline_id);
CREATE INDEX idx_camera_intents_owner_id ON public.camera_intents(owner_id);
CREATE INDEX idx_camera_intents_standing_space ON public.camera_intents(standing_space_id);
CREATE INDEX idx_camera_intents_template ON public.camera_intents(template_id);
CREATE INDEX idx_camera_intents_selected ON public.camera_intents(pipeline_id, is_selected) WHERE is_selected = true;
CREATE INDEX idx_camera_intents_generation_order ON public.camera_intents(pipeline_id, generation_order);

-- Composite index for deterministic retrieval
CREATE INDEX idx_camera_intents_deterministic ON public.camera_intents(pipeline_id, standing_space_id, template_id, target_space_id);

-- Enable Row Level Security (Section 5.5: Encoding Constraint)
ALTER TABLE public.camera_intents ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Users can only access their own camera intents
CREATE POLICY "Users can view their own camera intents"
  ON public.camera_intents
  FOR SELECT
  USING (auth.uid() = owner_id);

CREATE POLICY "Users can insert their own camera intents"
  ON public.camera_intents
  FOR INSERT
  WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Users can update their own camera intents"
  ON public.camera_intents
  FOR UPDATE
  USING (auth.uid() = owner_id);

CREATE POLICY "Users can delete their own camera intents"
  ON public.camera_intents
  FOR DELETE
  USING (auth.uid() = owner_id);

-- Create trigger for updated_at
CREATE TRIGGER update_camera_intents_updated_at
  BEFORE UPDATE ON public.camera_intents
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Add camera_intent pipeline status values (Section 7: Integration)
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
    -- Step 3 (Camera Planning) - existing
    'step3_pending', 'step3_running', 'step3_waiting_approval', 'step3_rejected',
    'camera_plan_pending', 'camera_plan_confirmed',
    -- Step 4 (Camera Intent Generation) - NEW
    'step4_camera_intent_pending', 'step4_camera_intent_generated', 'step4_camera_intent_confirmed',
    -- Step 4 (Spaces/Renders) - renumbered from old Step 4
    'step4_pending', 'step4_running', 'step4_waiting_approval', 'step4_rejected',
    'step4_qa_fail', 'step4_blocked_for_human',
    'spaces_detected', 'spaces_detected_waiting_approval',
    -- Step 5 (Panoramas) - was Step 4
    'step5_pending', 'step5_running', 'step5_waiting_approval', 'step5_rejected',
    'step5_qa_fail', 'step5_blocked_for_human',
    -- Step 6 (Merge) - was Step 5
    'step6_pending', 'step6_running', 'step6_waiting_approval', 'step6_rejected',
    'step6_qa_fail', 'step6_blocked_for_human',
    -- Step 7 - Future slot
    'step7_pending', 'step7_running', 'step7_waiting_approval', 'step7_rejected',
    -- Whole apartment phase-related (legacy compatibility)
    'top_down_3d_review', 'style_review',
    'space_analysis_pending', 'space_analysis_running', 'space_analysis_review', 'space_analysis_failed'
  )
);

-- Add camera_intent_generated_at timestamp to track when intents were generated
ALTER TABLE public.floorplan_pipelines
ADD COLUMN IF NOT EXISTS camera_intent_generated_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS camera_intent_confirmed_at TIMESTAMP WITH TIME ZONE;

-- Add comments
COMMENT ON COLUMN public.floorplan_pipelines.camera_intent_generated_at IS 'Timestamp when Step 4 camera intents were generated';
COMMENT ON COLUMN public.floorplan_pipelines.camera_intent_confirmed_at IS 'Timestamp when user confirmed which camera intents to execute';
