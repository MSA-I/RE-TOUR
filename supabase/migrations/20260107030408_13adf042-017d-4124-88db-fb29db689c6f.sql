-- Drop and recreate get_projects_with_job_counts to include last_job_updated_at
DROP FUNCTION IF EXISTS public.get_projects_with_job_counts();

CREATE FUNCTION public.get_projects_with_job_counts()
RETURNS TABLE(
  id UUID,
  name TEXT,
  status TEXT,
  created_at TIMESTAMPTZ,
  owner_id UUID,
  style_profile JSONB,
  completed_jobs_count BIGINT,
  failed_jobs_count BIGINT,
  active_jobs_count BIGINT,
  completed_filenames TEXT[],
  failed_filenames TEXT[],
  last_job_updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    p.id,
    p.name,
    p.status::TEXT,
    p.created_at,
    p.owner_id,
    p.style_profile,
    COALESCE(job_counts.completed_count, 0) AS completed_jobs_count,
    COALESCE(job_counts.failed_count, 0) AS failed_jobs_count,
    COALESCE(job_counts.active_count, 0) AS active_jobs_count,
    COALESCE(completed_files.filenames, ARRAY[]::TEXT[]) AS completed_filenames,
    COALESCE(failed_files.filenames, ARRAY[]::TEXT[]) AS failed_filenames,
    COALESCE(job_updated.last_updated, p.created_at) AS last_job_updated_at
  FROM public.projects p
  LEFT JOIN (
    SELECT 
      rj.project_id,
      COUNT(*) FILTER (WHERE rj.status IN ('approved', 'needs_review')) AS completed_count,
      COUNT(*) FILTER (WHERE rj.status = 'failed') AS failed_count,
      COUNT(*) FILTER (WHERE rj.status IN ('queued', 'running')) AS active_count
    FROM public.render_jobs rj
    GROUP BY rj.project_id
  ) job_counts ON p.id = job_counts.project_id
  LEFT JOIN (
    SELECT 
      rj.project_id,
      ARRAY_AGG(u.original_filename ORDER BY rj.updated_at DESC) FILTER (WHERE u.original_filename IS NOT NULL) AS filenames
    FROM public.render_jobs rj
    JOIN public.uploads u ON rj.panorama_upload_id = u.id
    WHERE rj.status IN ('approved', 'needs_review')
    GROUP BY rj.project_id
  ) completed_files ON p.id = completed_files.project_id
  LEFT JOIN (
    SELECT 
      rj.project_id,
      ARRAY_AGG(u.original_filename ORDER BY rj.updated_at DESC) FILTER (WHERE u.original_filename IS NOT NULL) AS filenames
    FROM public.render_jobs rj
    JOIN public.uploads u ON rj.panorama_upload_id = u.id
    WHERE rj.status = 'failed'
    GROUP BY rj.project_id
  ) failed_files ON p.id = failed_files.project_id
  LEFT JOIN (
    SELECT 
      project_id,
      MAX(updated_at) AS last_updated
    FROM (
      SELECT project_id, updated_at FROM public.render_jobs
      UNION ALL
      SELECT project_id, updated_at FROM public.floorplan_pipelines
      UNION ALL
      SELECT project_id, updated_at FROM public.image_edit_jobs
      UNION ALL
      SELECT bj.project_id, bi.created_at AS updated_at
      FROM public.batch_jobs bj
      JOIN public.batch_jobs_items bi ON bj.id = bi.batch_job_id
    ) all_jobs
    GROUP BY project_id
  ) job_updated ON p.id = job_updated.project_id
  WHERE p.owner_id = auth.uid()
  ORDER BY p.created_at DESC;
END;
$$;