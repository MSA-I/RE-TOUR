-- ============================================================================
-- PIPELINE REFACTOR: Prevent WORKER_LIMIT, enforce payload control
-- Creates: pipeline_jobs, pipeline_artifacts, pipeline_decisions tables
-- Updates: pipeline_runs with additional fields
-- ============================================================================

-- 1) Update pipeline_runs table with additional fields
ALTER TABLE public.pipeline_runs 
  ADD COLUMN IF NOT EXISTS ratio text DEFAULT '16:9',
  ADD COLUMN IF NOT EXISTS ratio_locked boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS quality_post_step4 text DEFAULT '2K',
  ADD COLUMN IF NOT EXISTS payload_size_estimate integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_error_stack text;

-- 2) Create pipeline_jobs table for queued execution
CREATE TABLE IF NOT EXISTS public.pipeline_jobs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES public.pipeline_runs(id) ON DELETE CASCADE,
  step_id text NOT NULL,
  service text NOT NULL CHECK (service IN ('image_io', 'info_worker', 'comparison', 'supervisor')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed', 'blocked')),
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  payload_ref jsonb, -- References to artifact IDs, NOT actual data
  result_ref jsonb,  -- References to output artifact IDs
  idempotency_key text UNIQUE, -- For deduplication
  locked_at timestamptz, -- For distributed locking
  locked_by text, -- Function instance ID
  started_at timestamptz,
  completed_at timestamptz,
  last_error text,
  last_error_stack text,
  processing_time_ms integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  owner_id uuid NOT NULL
);

-- Index for finding pending jobs and preventing duplicates
CREATE INDEX IF NOT EXISTS idx_pipeline_jobs_run_step ON public.pipeline_jobs(run_id, step_id, service);
CREATE INDEX IF NOT EXISTS idx_pipeline_jobs_status ON public.pipeline_jobs(status, created_at);
CREATE INDEX IF NOT EXISTS idx_pipeline_jobs_owner ON public.pipeline_jobs(owner_id);

-- 3) Create pipeline_artifacts table for storage references
CREATE TABLE IF NOT EXISTS public.pipeline_artifacts (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES public.pipeline_runs(id) ON DELETE CASCADE,
  step_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('preview', 'original', 'json', 'metadata')),
  upload_id uuid REFERENCES public.uploads(id) ON DELETE SET NULL, -- Link to uploads table
  storage_bucket text,
  storage_path text,
  signed_url_cached text, -- Cached signed URL (expires)
  signed_url_expires_at timestamptz,
  metadata_json jsonb, -- Dimensions, hash, quality, etc.
  created_at timestamptz NOT NULL DEFAULT now(),
  owner_id uuid NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pipeline_artifacts_run_step ON public.pipeline_artifacts(run_id, step_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_artifacts_upload ON public.pipeline_artifacts(upload_id);

-- 4) Create pipeline_decisions table for supervisor audit trail
CREATE TABLE IF NOT EXISTS public.pipeline_decisions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES public.pipeline_runs(id) ON DELETE CASCADE,
  job_id uuid REFERENCES public.pipeline_jobs(id) ON DELETE SET NULL,
  step_id text NOT NULL,
  decision text NOT NULL CHECK (decision IN ('proceed', 'retry', 'block')),
  schema_validations jsonb NOT NULL DEFAULT '[]',
  rule_checks jsonb NOT NULL DEFAULT '[]',
  llm_audit jsonb, -- Consistency score, contradictions, etc.
  retry_budget_remaining integer NOT NULL DEFAULT 3,
  block_reason text,
  processing_time_ms integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  owner_id uuid NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pipeline_decisions_run ON public.pipeline_decisions(run_id, step_id);

-- 5) Enable RLS on all new tables
ALTER TABLE public.pipeline_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pipeline_artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pipeline_decisions ENABLE ROW LEVEL SECURITY;

-- RLS Policies for pipeline_jobs
CREATE POLICY "Users can view their own pipeline jobs"
  ON public.pipeline_jobs FOR SELECT
  USING (auth.uid() = owner_id);

CREATE POLICY "Users can insert their own pipeline jobs"
  ON public.pipeline_jobs FOR INSERT
  WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Users can update their own pipeline jobs"
  ON public.pipeline_jobs FOR UPDATE
  USING (auth.uid() = owner_id);

CREATE POLICY "Users can delete their own pipeline jobs"
  ON public.pipeline_jobs FOR DELETE
  USING (auth.uid() = owner_id);

-- RLS Policies for pipeline_artifacts
CREATE POLICY "Users can view their own pipeline artifacts"
  ON public.pipeline_artifacts FOR SELECT
  USING (auth.uid() = owner_id);

CREATE POLICY "Users can insert their own pipeline artifacts"
  ON public.pipeline_artifacts FOR INSERT
  WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Users can update their own pipeline artifacts"
  ON public.pipeline_artifacts FOR UPDATE
  USING (auth.uid() = owner_id);

CREATE POLICY "Users can delete their own pipeline artifacts"
  ON public.pipeline_artifacts FOR DELETE
  USING (auth.uid() = owner_id);

-- RLS Policies for pipeline_decisions
CREATE POLICY "Users can view their own pipeline decisions"
  ON public.pipeline_decisions FOR SELECT
  USING (auth.uid() = owner_id);

CREATE POLICY "Users can insert their own pipeline decisions"
  ON public.pipeline_decisions FOR INSERT
  WITH CHECK (auth.uid() = owner_id);

-- Service role can manage all jobs (for edge functions)
CREATE POLICY "Service role can manage all pipeline jobs"
  ON public.pipeline_jobs FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role');

CREATE POLICY "Service role can manage all pipeline artifacts"
  ON public.pipeline_artifacts FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role');

CREATE POLICY "Service role can manage all pipeline decisions"
  ON public.pipeline_decisions FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role');

-- 6) Add updated_at trigger
CREATE TRIGGER update_pipeline_jobs_updated_at
  BEFORE UPDATE ON public.pipeline_jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- 7) Function to acquire job lock (atomic)
CREATE OR REPLACE FUNCTION public.acquire_job_lock(
  p_run_id uuid,
  p_step_id text,
  p_service text,
  p_lock_owner text,
  p_lock_duration_seconds integer DEFAULT 300
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job_id uuid;
  v_now timestamptz := now();
BEGIN
  -- Try to find an unlocked pending job or one with expired lock
  UPDATE pipeline_jobs
  SET 
    locked_at = v_now,
    locked_by = p_lock_owner,
    status = 'running',
    started_at = COALESCE(started_at, v_now),
    attempts = attempts + 1,
    updated_at = v_now
  WHERE id = (
    SELECT id FROM pipeline_jobs
    WHERE run_id = p_run_id
      AND step_id = p_step_id
      AND service = p_service
      AND (
        status = 'pending' 
        OR (status = 'running' AND locked_at < v_now - (p_lock_duration_seconds || ' seconds')::interval)
      )
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  )
  RETURNING id INTO v_job_id;
  
  RETURN v_job_id;
END;
$$;

-- 8) Function to release job lock
CREATE OR REPLACE FUNCTION public.release_job_lock(
  p_job_id uuid,
  p_status text,
  p_result_ref jsonb DEFAULT NULL,
  p_error text DEFAULT NULL,
  p_error_stack text DEFAULT NULL,
  p_processing_time_ms integer DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE pipeline_jobs
  SET 
    locked_at = NULL,
    locked_by = NULL,
    status = p_status,
    result_ref = COALESCE(p_result_ref, result_ref),
    completed_at = CASE WHEN p_status IN ('completed', 'failed', 'blocked') THEN now() ELSE NULL END,
    last_error = p_error,
    last_error_stack = p_error_stack,
    processing_time_ms = p_processing_time_ms,
    updated_at = now()
  WHERE id = p_job_id;
  
  RETURN FOUND;
END;
$$;

-- 9) Function to check if a job is already running (for deduplication)
CREATE OR REPLACE FUNCTION public.is_job_running(
  p_run_id uuid,
  p_step_id text,
  p_service text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_running boolean;
BEGIN
  SELECT EXISTS(
    SELECT 1 FROM pipeline_jobs
    WHERE run_id = p_run_id
      AND step_id = p_step_id
      AND service = p_service
      AND status = 'running'
      AND locked_at > now() - interval '5 minutes'
  ) INTO v_running;
  
  RETURN v_running;
END;
$$;