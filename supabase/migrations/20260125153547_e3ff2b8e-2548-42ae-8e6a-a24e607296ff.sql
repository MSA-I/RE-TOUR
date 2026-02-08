-- Drop the old check constraint and recreate with _rejected statuses included
ALTER TABLE public.floorplan_pipelines
DROP CONSTRAINT floorplan_pipelines_status_check;

ALTER TABLE public.floorplan_pipelines
ADD CONSTRAINT floorplan_pipelines_status_check CHECK (
  status = ANY (ARRAY[
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
    'step4_pending'::text,
    'step4_running'::text,
    'step4_waiting_approval'::text,
    'step4_rejected'::text,
    'completed'::text,
    'failed'::text
  ])
);