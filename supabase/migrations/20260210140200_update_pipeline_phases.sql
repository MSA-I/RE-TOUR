-- Migration: Add new phases for Steps 4-5 and rename existing phases
-- This migration migrates existing pipelines from old phase names to new ones
-- Note: whole_apartment_phase is a TEXT column, not an enum, so no type modification needed

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
