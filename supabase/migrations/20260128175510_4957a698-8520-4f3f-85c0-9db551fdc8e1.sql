-- ═══════════════════════════════════════════════════════════════════════════════
-- Camera Anchor System: Per-camera anchor screenshots with mandatory workflow gate
-- ═══════════════════════════════════════════════════════════════════════════════

-- Add anchor status and artifact tracking to camera markers
ALTER TABLE public.pipeline_camera_markers
ADD COLUMN IF NOT EXISTS anchor_status text NOT NULL DEFAULT 'not_created'
  CHECK (anchor_status IN ('not_created', 'generating', 'ready', 'failed', 'outdated')),
ADD COLUMN IF NOT EXISTS anchor_base_plan_path text,
ADD COLUMN IF NOT EXISTS anchor_single_overlay_path text,
ADD COLUMN IF NOT EXISTS anchor_crop_overlay_path text,
ADD COLUMN IF NOT EXISTS anchor_created_at timestamptz,
ADD COLUMN IF NOT EXISTS anchor_transform_hash text,
ADD COLUMN IF NOT EXISTS anchor_error_message text;

-- Index for fast anchor status lookups
CREATE INDEX IF NOT EXISTS idx_camera_markers_anchor_status 
ON public.pipeline_camera_markers(pipeline_id, anchor_status);

-- Function to compute camera transform hash (for invalidation detection)
CREATE OR REPLACE FUNCTION public.compute_camera_transform_hash(
  p_x_norm numeric,
  p_y_norm numeric,
  p_yaw_deg numeric,
  p_fov_deg numeric,
  p_room_id uuid
) RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
  SELECT md5(
    COALESCE(p_x_norm::text, '') || ':' ||
    COALESCE(p_y_norm::text, '') || ':' ||
    COALESCE(p_yaw_deg::text, '') || ':' ||
    COALESCE(p_fov_deg::text, '') || ':' ||
    COALESCE(p_room_id::text, '')
  );
$$;

-- Trigger to auto-invalidate anchor when camera transform changes
CREATE OR REPLACE FUNCTION public.invalidate_anchor_on_transform_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  new_hash text;
  old_hash text;
BEGIN
  -- Only check if anchor was previously ready
  IF OLD.anchor_status = 'ready' THEN
    new_hash := compute_camera_transform_hash(NEW.x_norm, NEW.y_norm, NEW.yaw_deg, NEW.fov_deg, NEW.room_id);
    old_hash := compute_camera_transform_hash(OLD.x_norm, OLD.y_norm, OLD.yaw_deg, OLD.fov_deg, OLD.room_id);
    
    IF new_hash != old_hash THEN
      NEW.anchor_status := 'outdated';
      RAISE NOTICE '[CameraAnchor] Anchor invalidated for marker %: transform hash changed', NEW.id;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_invalidate_anchor_on_transform ON public.pipeline_camera_markers;
CREATE TRIGGER trg_invalidate_anchor_on_transform
  BEFORE UPDATE ON public.pipeline_camera_markers
  FOR EACH ROW
  WHEN (
    OLD.x_norm IS DISTINCT FROM NEW.x_norm OR
    OLD.y_norm IS DISTINCT FROM NEW.y_norm OR
    OLD.yaw_deg IS DISTINCT FROM NEW.yaw_deg OR
    OLD.fov_deg IS DISTINCT FROM NEW.fov_deg OR
    OLD.room_id IS DISTINCT FROM NEW.room_id
  )
  EXECUTE FUNCTION public.invalidate_anchor_on_transform_change();

-- Add realtime for anchor status changes
ALTER PUBLICATION supabase_realtime ADD TABLE public.pipeline_camera_markers;