-- Migration: Add new phases for Steps 4-5 and rename existing phases
-- This migration adds new pipeline phase values and migrates existing pipelines

-- Add new phases to the whole_apartment_phase enum
DO $$ BEGIN
  ALTER TYPE whole_apartment_phase ADD VALUE IF NOT EXISTS 'camera_intent_pending';
  ALTER TYPE whole_apartment_phase ADD VALUE IF NOT EXISTS 'camera_intent_confirmed';
  ALTER TYPE whole_apartment_phase ADD VALUE IF NOT EXISTS 'prompt_templates_pending';
  ALTER TYPE whole_apartment_phase ADD VALUE IF NOT EXISTS 'prompt_templates_confirmed';
  ALTER TYPE whole_apartment_phase ADD VALUE IF NOT EXISTS 'outputs_pending';
  ALTER TYPE whole_apartment_phase ADD VALUE IF NOT EXISTS 'outputs_in_progress';
  ALTER TYPE whole_apartment_phase ADD VALUE IF NOT EXISTS 'outputs_review';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Migrate existing pipelines from old phases to new phases
UPDATE floorplan_pipelines
SET whole_apartment_phase = 'camera_intent_pending'
WHERE whole_apartment_phase = 'camera_plan_pending';

UPDATE floorplan_pipelines
SET whole_apartment_phase = 'camera_intent_confirmed'
WHERE whole_apartment_phase = 'camera_plan_confirmed';

UPDATE floorplan_pipelines
SET whole_apartment_phase = 'outputs_pending'
WHERE whole_apartment_phase = 'renders_pending';

UPDATE floorplan_pipelines
SET whole_apartment_phase = 'outputs_in_progress'
WHERE whole_apartment_phase = 'renders_in_progress';

UPDATE floorplan_pipelines
SET whole_apartment_phase = 'outputs_review'
WHERE whole_apartment_phase = 'renders_review';

-- Create migration_log table if it doesn't exist
CREATE TABLE IF NOT EXISTS public.migration_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  migration_name TEXT NOT NULL,
  applied_at TIMESTAMPTZ DEFAULT NOW()
);

-- Log migration for audit
INSERT INTO public.migration_log (migration_name, applied_at)
VALUES ('20250211_update_pipeline_phases', NOW());
