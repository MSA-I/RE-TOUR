-- Create enums for project and job statuses
CREATE TYPE public.project_status AS ENUM ('draft', 'active', 'completed', 'failed');
CREATE TYPE public.job_status AS ENUM ('queued', 'running', 'needs_review', 'approved', 'rejected', 'failed');

-- Projects table
CREATE TABLE public.projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  status public.project_status NOT NULL DEFAULT 'draft',
  created_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

-- Projects RLS policies
CREATE POLICY "Users can view their own projects"
  ON public.projects FOR SELECT
  USING (auth.uid() = owner_id);

CREATE POLICY "Users can create their own projects"
  ON public.projects FOR INSERT
  WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Users can update their own projects"
  ON public.projects FOR UPDATE
  USING (auth.uid() = owner_id);

CREATE POLICY "Users can delete their own projects"
  ON public.projects FOR DELETE
  USING (auth.uid() = owner_id);

-- Uploads table
CREATE TABLE public.uploads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('panorama', 'design_ref', 'output')),
  bucket text NOT NULL,
  path text NOT NULL,
  original_filename text,
  mime_type text,
  size_bytes bigint,
  created_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.uploads ENABLE ROW LEVEL SECURITY;

-- Uploads RLS policies
CREATE POLICY "Users can view their own uploads"
  ON public.uploads FOR SELECT
  USING (auth.uid() = owner_id);

CREATE POLICY "Users can create their own uploads"
  ON public.uploads FOR INSERT
  WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Users can update their own uploads"
  ON public.uploads FOR UPDATE
  USING (auth.uid() = owner_id);

CREATE POLICY "Users can delete their own uploads"
  ON public.uploads FOR DELETE
  USING (auth.uid() = owner_id);

-- Render jobs table
CREATE TABLE public.render_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  panorama_upload_id uuid NOT NULL REFERENCES public.uploads(id),
  design_ref_upload_ids jsonb DEFAULT '[]'::jsonb,
  change_request text NOT NULL,
  base_prompt text,
  style_profile jsonb,
  status public.job_status NOT NULL DEFAULT 'queued',
  attempts int NOT NULL DEFAULT 0,
  last_error text,
  output_upload_id uuid REFERENCES public.uploads(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.render_jobs ENABLE ROW LEVEL SECURITY;

-- Render jobs RLS policies
CREATE POLICY "Users can view their own render jobs"
  ON public.render_jobs FOR SELECT
  USING (auth.uid() = owner_id);

CREATE POLICY "Users can create their own render jobs"
  ON public.render_jobs FOR INSERT
  WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Users can update their own render jobs"
  ON public.render_jobs FOR UPDATE
  USING (auth.uid() = owner_id);

CREATE POLICY "Users can delete their own render jobs"
  ON public.render_jobs FOR DELETE
  USING (auth.uid() = owner_id);

-- Job reviews table
CREATE TABLE public.job_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.render_jobs(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  decision text NOT NULL CHECK (decision IN ('approved', 'rejected')),
  notes text,
  created_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.job_reviews ENABLE ROW LEVEL SECURITY;

-- Job reviews RLS policies
CREATE POLICY "Users can view their own job reviews"
  ON public.job_reviews FOR SELECT
  USING (auth.uid() = owner_id);

CREATE POLICY "Users can create their own job reviews"
  ON public.job_reviews FOR INSERT
  WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Users can update their own job reviews"
  ON public.job_reviews FOR UPDATE
  USING (auth.uid() = owner_id);

CREATE POLICY "Users can delete their own job reviews"
  ON public.job_reviews FOR DELETE
  USING (auth.uid() = owner_id);

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Create trigger for render_jobs updated_at
CREATE TRIGGER update_render_jobs_updated_at
  BEFORE UPDATE ON public.render_jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();