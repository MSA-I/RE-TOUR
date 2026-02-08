-- Create batch_jobs table for multi-image job batching
CREATE TABLE public.batch_jobs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL,
  change_request TEXT NOT NULL,
  base_prompt TEXT,
  style_profile JSONB,
  output_resolution TEXT DEFAULT '2K',
  status TEXT NOT NULL DEFAULT 'queued',
  progress_int INTEGER DEFAULT 0,
  total_items INTEGER DEFAULT 0,
  completed_items INTEGER DEFAULT 0,
  failed_items INTEGER DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create batch_jobs_items table for individual items within a batch
CREATE TABLE public.batch_jobs_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  batch_job_id UUID NOT NULL REFERENCES public.batch_jobs(id) ON DELETE CASCADE,
  panorama_upload_id UUID NOT NULL REFERENCES public.uploads(id),
  render_job_id UUID REFERENCES public.render_jobs(id),
  output_upload_id UUID REFERENCES public.uploads(id),
  owner_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  last_error TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS on batch_jobs
ALTER TABLE public.batch_jobs ENABLE ROW LEVEL SECURITY;

-- RLS policies for batch_jobs
CREATE POLICY "Users can view their own batch jobs"
  ON public.batch_jobs FOR SELECT
  USING (auth.uid() = owner_id);

CREATE POLICY "Users can create their own batch jobs"
  ON public.batch_jobs FOR INSERT
  WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Users can update their own batch jobs"
  ON public.batch_jobs FOR UPDATE
  USING (auth.uid() = owner_id);

CREATE POLICY "Users can delete their own batch jobs"
  ON public.batch_jobs FOR DELETE
  USING (auth.uid() = owner_id);

-- Enable RLS on batch_jobs_items
ALTER TABLE public.batch_jobs_items ENABLE ROW LEVEL SECURITY;

-- RLS policies for batch_jobs_items
CREATE POLICY "Users can view their own batch job items"
  ON public.batch_jobs_items FOR SELECT
  USING (auth.uid() = owner_id);

CREATE POLICY "Users can create their own batch job items"
  ON public.batch_jobs_items FOR INSERT
  WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Users can update their own batch job items"
  ON public.batch_jobs_items FOR UPDATE
  USING (auth.uid() = owner_id);

-- Create indexes for performance
CREATE INDEX idx_batch_jobs_project ON public.batch_jobs(project_id);
CREATE INDEX idx_batch_jobs_owner ON public.batch_jobs(owner_id);
CREATE INDEX idx_batch_jobs_status ON public.batch_jobs(status);
CREATE INDEX idx_batch_jobs_items_batch ON public.batch_jobs_items(batch_job_id);

-- Enable realtime for batch_jobs
ALTER PUBLICATION supabase_realtime ADD TABLE public.batch_jobs;

-- Create a database function to get projects with job counts
CREATE OR REPLACE FUNCTION public.get_projects_with_job_counts()
RETURNS TABLE (
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
  failed_filenames TEXT[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
    COALESCE(failed_files.filenames, ARRAY[]::TEXT[]) AS failed_filenames
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
  WHERE p.owner_id = auth.uid()
  ORDER BY p.created_at DESC;
END;
$$;