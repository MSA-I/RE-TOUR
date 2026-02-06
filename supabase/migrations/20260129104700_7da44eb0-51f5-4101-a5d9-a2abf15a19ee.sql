-- Create table for camera scan items (per-marker results with crops)
CREATE TABLE public.pipeline_camera_scan_items (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  scan_id uuid NOT NULL REFERENCES public.pipeline_camera_scans(id) ON DELETE CASCADE,
  marker_id uuid NOT NULL REFERENCES public.pipeline_camera_markers(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL,
  
  -- OCR/Label detection results
  detected_room_label text,
  detected_label_confidence numeric DEFAULT 0,
  detected_label_bbox_norm jsonb, -- {x, y, w, h} normalized 0-1
  
  -- Crop asset info
  crop_storage_path text,
  crop_public_url text,
  crop_width integer,
  crop_height integer,
  crop_expires_at timestamp with time zone,
  
  -- Prompt hints from analysis
  prompt_hint_text text,
  
  -- Temp flag for cleanup
  is_temporary boolean DEFAULT true,
  
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  
  CONSTRAINT unique_scan_marker UNIQUE (scan_id, marker_id)
);

-- Enable RLS
ALTER TABLE public.pipeline_camera_scan_items ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Users can view their own scan items"
  ON public.pipeline_camera_scan_items FOR SELECT
  USING (auth.uid() = owner_id);

CREATE POLICY "Users can insert their own scan items"
  ON public.pipeline_camera_scan_items FOR INSERT
  WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Users can update their own scan items"
  ON public.pipeline_camera_scan_items FOR UPDATE
  USING (auth.uid() = owner_id);

CREATE POLICY "Users can delete their own scan items"
  ON public.pipeline_camera_scan_items FOR DELETE
  USING (auth.uid() = owner_id);

-- Create index for efficient lookups
CREATE INDEX idx_scan_items_scan_id ON public.pipeline_camera_scan_items(scan_id);
CREATE INDEX idx_scan_items_marker_id ON public.pipeline_camera_scan_items(marker_id);

-- Add update trigger for updated_at
CREATE TRIGGER update_scan_items_updated_at
  BEFORE UPDATE ON public.pipeline_camera_scan_items
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();