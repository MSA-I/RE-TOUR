-- Phase 1: Image I/O Service - Add preview tracking and metadata to uploads

-- Add new columns for preview/original tracking and metadata
ALTER TABLE public.uploads 
ADD COLUMN IF NOT EXISTS preview_upload_id uuid REFERENCES public.uploads(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS is_preview boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS original_width integer,
ADD COLUMN IF NOT EXISTS original_height integer,
ADD COLUMN IF NOT EXISTS file_hash text,
ADD COLUMN IF NOT EXISTS processing_status text DEFAULT 'ready' CHECK (processing_status IN ('pending', 'processing', 'ready', 'failed'));

-- Create index for preview lookups
CREATE INDEX IF NOT EXISTS idx_uploads_preview_upload_id ON public.uploads(preview_upload_id) WHERE preview_upload_id IS NOT NULL;

-- Create index for finding originals from previews
CREATE INDEX IF NOT EXISTS idx_uploads_is_preview ON public.uploads(is_preview) WHERE is_preview = true;

-- Create pipeline_runs table for tracking orchestration state
CREATE TABLE IF NOT EXISTS public.pipeline_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_id uuid NOT NULL REFERENCES public.floorplan_pipelines(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL,
  current_step integer NOT NULL DEFAULT 0,
  total_retries integer NOT NULL DEFAULT 0,
  step_retries integer NOT NULL DEFAULT 0,
  started_at timestamp with time zone NOT NULL DEFAULT now(),
  completed_at timestamp with time zone,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed', 'blocked')),
  supervisor_decisions jsonb DEFAULT '[]'::jsonb,
  last_error text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS on pipeline_runs
ALTER TABLE public.pipeline_runs ENABLE ROW LEVEL SECURITY;

-- RLS policies for pipeline_runs
CREATE POLICY "Users can view their own pipeline runs" ON public.pipeline_runs FOR SELECT USING (auth.uid() = owner_id);
CREATE POLICY "Users can insert their own pipeline runs" ON public.pipeline_runs FOR INSERT WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "Users can update their own pipeline runs" ON public.pipeline_runs FOR UPDATE USING (auth.uid() = owner_id);
CREATE POLICY "Users can delete their own pipeline runs" ON public.pipeline_runs FOR DELETE USING (auth.uid() = owner_id);

-- Unique constraint to prevent duplicate active runs
CREATE UNIQUE INDEX IF NOT EXISTS idx_pipeline_runs_active ON public.pipeline_runs(pipeline_id) WHERE status IN ('pending', 'running');

-- Create worker_outputs table for logging all worker results
CREATE TABLE IF NOT EXISTS public.worker_outputs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.pipeline_runs(id) ON DELETE CASCADE,
  worker_type text NOT NULL CHECK (worker_type IN ('image_io', 'info_worker', 'comparison_worker', 'supervisor')),
  step_id text NOT NULL,
  input_schema_hash text,
  output_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  schema_valid boolean DEFAULT false,
  supervisor_approved boolean,
  processing_time_ms integer,
  llm_model_used text,
  error_message text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS on worker_outputs
ALTER TABLE public.worker_outputs ENABLE ROW LEVEL SECURITY;

-- RLS policies for worker_outputs (join through pipeline_runs)
CREATE POLICY "Users can view their own worker outputs" ON public.worker_outputs FOR SELECT 
USING (EXISTS (SELECT 1 FROM public.pipeline_runs pr WHERE pr.id = run_id AND pr.owner_id = auth.uid()));

CREATE POLICY "Users can insert their own worker outputs" ON public.worker_outputs FOR INSERT 
WITH CHECK (EXISTS (SELECT 1 FROM public.pipeline_runs pr WHERE pr.id = run_id AND pr.owner_id = auth.uid()));

-- Create index for fast worker output lookups
CREATE INDEX IF NOT EXISTS idx_worker_outputs_run_id ON public.worker_outputs(run_id);
CREATE INDEX IF NOT EXISTS idx_worker_outputs_worker_type ON public.worker_outputs(worker_type);

-- Add updated_at trigger for pipeline_runs
CREATE TRIGGER update_pipeline_runs_updated_at
BEFORE UPDATE ON public.pipeline_runs
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();