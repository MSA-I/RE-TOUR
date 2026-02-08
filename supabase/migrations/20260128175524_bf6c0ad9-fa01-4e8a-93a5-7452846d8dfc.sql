-- Fix search_path security warning for compute_camera_transform_hash
DROP FUNCTION IF EXISTS public.compute_camera_transform_hash(numeric, numeric, numeric, numeric, uuid);
CREATE OR REPLACE FUNCTION public.compute_camera_transform_hash(
  p_x_norm numeric,
  p_y_norm numeric,
  p_yaw_deg numeric,
  p_fov_deg numeric,
  p_room_id uuid
) RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = public
AS $$
  SELECT md5(
    COALESCE(p_x_norm::text, '') || ':' ||
    COALESCE(p_y_norm::text, '') || ':' ||
    COALESCE(p_yaw_deg::text, '') || ':' ||
    COALESCE(p_fov_deg::text, '') || ':' ||
    COALESCE(p_room_id::text, '')
  );
$$;