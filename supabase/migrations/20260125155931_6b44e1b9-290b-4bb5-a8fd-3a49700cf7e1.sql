-- Add unique constraint to prevent duplicate spaces per pipeline
-- If duplicates exist, this will fail - run cleanup first

-- First clean up duplicate spaces (keep oldest one per name/pipeline combo)
WITH duplicates AS (
  SELECT id, pipeline_id, name,
    ROW_NUMBER() OVER (PARTITION BY pipeline_id, name ORDER BY created_at ASC) as rn
  FROM floorplan_pipeline_spaces
)
DELETE FROM floorplan_pipeline_spaces
WHERE id IN (
  SELECT id FROM duplicates WHERE rn > 1
);

-- Clean up orphaned renders, panoramas, and final360s for deleted spaces
DELETE FROM floorplan_space_renders
WHERE space_id NOT IN (SELECT id FROM floorplan_pipeline_spaces);

DELETE FROM floorplan_space_panoramas
WHERE space_id NOT IN (SELECT id FROM floorplan_pipeline_spaces);

DELETE FROM floorplan_space_final360
WHERE space_id NOT IN (SELECT id FROM floorplan_pipeline_spaces);

-- Add spaces_detected to status constraint
ALTER TABLE public.floorplan_pipelines
DROP CONSTRAINT floorplan_pipelines_status_check;

ALTER TABLE public.floorplan_pipelines
ADD CONSTRAINT floorplan_pipelines_status_check CHECK (
  status = ANY (ARRAY[
    'pending'::text,
    'step1_pending'::text,
    'step1_running'::text,
    'step1_waiting_approval'::text,
    'step1_rejected'::text,
    'step2_pending'::text,
    'step2_running'::text,
    'step2_waiting_approval'::text,
    'step2_rejected'::text,
    'step3_pending'::text,
    'step3_running'::text,
    'step3_waiting_approval'::text,
    'step3_rejected'::text,
    'spaces_detected'::text,
    'step4_pending'::text,
    'step4_running'::text,
    'step4_waiting_approval'::text,
    'step4_rejected'::text,
    'completed'::text,
    'failed'::text
  ])
);

-- Add unique constraint for spaces per pipeline (prevents duplicates)
ALTER TABLE floorplan_pipeline_spaces 
ADD CONSTRAINT unique_space_per_pipeline UNIQUE (pipeline_id, name);