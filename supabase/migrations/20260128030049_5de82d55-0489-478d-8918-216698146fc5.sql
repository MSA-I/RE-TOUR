-- Add marker_type and mirror_enabled to pipeline_camera_markers for panorama point concept
ALTER TABLE public.pipeline_camera_markers
ADD COLUMN IF NOT EXISTS marker_type text NOT NULL DEFAULT 'panorama_point',
ADD COLUMN IF NOT EXISTS mirror_enabled boolean NOT NULL DEFAULT true;

-- Add comment explaining the panorama point concept
COMMENT ON TABLE public.pipeline_camera_markers IS 'Each record represents a Panorama Point with embedded dual cameras (A at yaw_deg, B at yaw_deg+180). The marker_type and mirror_enabled columns support this "2 cameras in 1" concept.';

-- Update the camera scans results to support embedded_cameras format
COMMENT ON COLUMN public.pipeline_camera_scans.results_json IS 'JSONB array of panorama point scan results. Each entry has panorama_point_id, room_validation, embedded_cameras[] with camera_slot A/B contexts, and global_rules.';