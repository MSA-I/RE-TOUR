-- Drop existing constraint and recreate with camera planning phases
ALTER TABLE floorplan_pipelines DROP CONSTRAINT IF EXISTS valid_whole_apartment_phase;

ALTER TABLE floorplan_pipelines ADD CONSTRAINT valid_whole_apartment_phase CHECK (
  whole_apartment_phase IS NULL OR whole_apartment_phase = ANY(ARRAY[
    'upload',
    'space_analysis_pending', 'space_analysis_running', 'space_analysis_complete', 'space_analysis_review', 'space_analysis_failed',
    'top_down_3d_pending', 'top_down_3d_running', 'top_down_3d_review', 'top_down_3d_approved',
    'style_pending', 'style_running', 'style_review', 'style_approved',
    'detect_spaces_pending', 'detecting_spaces', 'spaces_detected', 'spaces_detected_waiting_approval',
    'camera_plan_pending', 'camera_plan_confirmed',
    'renders_pending', 'renders_in_progress', 'renders_review', 'renders_approved',
    'panoramas_pending', 'panoramas_in_progress', 'panoramas_review', 'panoramas_approved',
    'merging_pending', 'merging_in_progress', 'merging_review',
    'completed', 'failed'
  ])
);