-- Create unified job feed view that aggregates all job types across projects
CREATE OR REPLACE FUNCTION public.get_job_feed(status_filter text DEFAULT NULL)
RETURNS TABLE(
  job_type text,
  job_id uuid,
  project_id uuid,
  project_name text,
  source_filename text,
  status text,
  updated_at timestamptz,
  output_upload_id uuid,
  last_error text,
  deep_link_route text,
  step_number int
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  -- Panorama render jobs
  SELECT 
    'panorama_job'::text AS job_type,
    rj.id AS job_id,
    rj.project_id,
    p.name AS project_name,
    u.original_filename AS source_filename,
    rj.status::text,
    COALESCE(rj.updated_at, rj.created_at) AS updated_at,
    rj.output_upload_id,
    rj.last_error,
    '/projects/' || rj.project_id || '?tab=panorama-jobs&jobId=' || rj.id AS deep_link_route,
    NULL::int AS step_number
  FROM public.render_jobs rj
  JOIN public.projects p ON rj.project_id = p.id
  JOIN public.uploads u ON rj.panorama_upload_id = u.id
  WHERE rj.owner_id = auth.uid()
    AND (status_filter IS NULL 
      OR (status_filter = 'draft' AND rj.status = 'queued')
      OR (status_filter = 'active' AND rj.status = 'running')
      OR (status_filter = 'completed' AND rj.status IN ('approved', 'needs_review'))
      OR (status_filter = 'failed' AND rj.status IN ('failed', 'rejected'))
    )
  
  UNION ALL
  
  -- Batch job items
  SELECT 
    'batch_item'::text AS job_type,
    bi.id AS job_id,
    bj.project_id,
    p.name AS project_name,
    u.original_filename AS source_filename,
    bi.status::text,
    COALESCE(bi.created_at, bj.created_at) AS updated_at,
    bi.output_upload_id,
    bi.last_error,
    '/projects/' || bj.project_id || '?tab=panorama-jobs&batchId=' || bj.id || '&itemId=' || bi.id AS deep_link_route,
    NULL::int AS step_number
  FROM public.batch_jobs_items bi
  JOIN public.batch_jobs bj ON bi.batch_job_id = bj.id
  JOIN public.projects p ON bj.project_id = p.id
  JOIN public.uploads u ON bi.panorama_upload_id = u.id
  WHERE bi.owner_id = auth.uid()
    AND (status_filter IS NULL 
      OR (status_filter = 'draft' AND bi.status = 'pending')
      OR (status_filter = 'active' AND bi.status = 'processing')
      OR (status_filter = 'completed' AND bi.status = 'completed')
      OR (status_filter = 'failed' AND bi.status IN ('failed', 'rejected'))
    )
  
  UNION ALL
  
  -- Floorplan pipeline steps
  SELECT 
    'floorplan_step'::text AS job_type,
    fp.id AS job_id,
    fp.project_id,
    p.name AS project_name,
    u.original_filename AS source_filename,
    fp.status::text,
    fp.updated_at,
    NULL::uuid AS output_upload_id,
    fp.last_error,
    '/projects/' || fp.project_id || '?tab=floorplan-jobs&pipelineId=' || fp.id AS deep_link_route,
    fp.current_step AS step_number
  FROM public.floorplan_pipelines fp
  JOIN public.projects p ON fp.project_id = p.id
  JOIN public.uploads u ON fp.floor_plan_upload_id = u.id
  WHERE fp.owner_id = auth.uid()
    AND (status_filter IS NULL 
      OR (status_filter = 'draft' AND fp.status = 'pending')
      OR (status_filter = 'active' AND fp.status = 'running')
      OR (status_filter = 'completed' AND fp.status = 'completed')
      OR (status_filter = 'failed' AND fp.status IN ('failed', 'rejected'))
    )
  
  ORDER BY updated_at DESC;
END;
$$;

-- Update Step 1 suggestions to be 2D design styles only
DELETE FROM public.pipeline_suggestions WHERE step_number = 1;

INSERT INTO public.pipeline_suggestions (step_number, category, title, prompt, is_generated) VALUES
-- Architectural Blueprint Style
(1, 'blueprint', 'Architectural Blueprint', 'Transform into a professional architectural blueprint with clean cyan/white color scheme, precise technical linework, and engineering-grade clarity. Maintain exact geometry and scale while adding subtle paper texture.', false),
(1, 'blueprint', 'Engineering Schematic', 'Convert to high-contrast engineering schematic style with bold black lines on white, precise dimension markers, and technical drawing conventions. No decorative elements.', false),

-- Minimal Modern Style
(1, 'minimal', 'Minimal Modern CAD', 'Render as a clean minimal CAD print with pure black lines on white background, subtle paper texture, and crisp vector-like edges. Remove all noise and imperfections.', false),
(1, 'minimal', 'Monochrome Ink Plan', 'Create a bold monochrome ink drawing style with strong outlines, fine detail lines, and professional linework hierarchy. High contrast, no color.', false),

-- Artistic Styles
(1, 'artistic', 'Soft Watercolor Plan', 'Apply soft watercolor wash aesthetic while preserving crisp geometry - light warm tones, gentle paper texture, subtle shadows, architectural elegance.', false),
(1, 'artistic', 'Pencil Sketch Plan', 'Transform into an architectural pencil sketch with graphite shading, measured construction lines, subtle smudging effects, and hand-drawn character while keeping precise geometry.', false),

-- Presentation Styles  
(1, 'presentation', 'Premium Presentation Board', 'Elevate to high-end presentation board quality with muted sophisticated palette, subtle depth shadows, premium print texture, and gallery-worthy polish.', false),
(1, 'presentation', 'Real Estate Brochure', 'Style for real estate marketing with warm neutral tones, clear readable labels, inviting aesthetic, clean professional appearance suitable for property listings.', false),

-- Technical Cleanup
(1, 'technical', 'Technical Line Cleanup', 'Enhance line clarity with consistent wall thickness, straightened edges, removed artifacts, improved contrast, and professional drafting precision.', false),
(1, 'technical', 'High-Res Print Ready', 'Optimize for high-resolution printing with crisp anti-aliased lines, balanced contrast, subtle paper grain, and production-ready sharpness.', false);