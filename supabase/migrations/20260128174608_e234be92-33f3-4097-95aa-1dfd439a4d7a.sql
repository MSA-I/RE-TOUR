-- Enable realtime for space render/panorama/final360 tables
-- This is required for the frontend to receive live updates when renders complete

ALTER PUBLICATION supabase_realtime ADD TABLE public.floorplan_space_renders;
ALTER PUBLICATION supabase_realtime ADD TABLE public.floorplan_space_panoramas;
ALTER PUBLICATION supabase_realtime ADD TABLE public.floorplan_space_final360;
ALTER PUBLICATION supabase_realtime ADD TABLE public.floorplan_pipeline_spaces;