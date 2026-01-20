-- Create floorplan_pipelines table for multi-step pipeline workflow
CREATE TABLE public.floorplan_pipelines (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL,
  floor_plan_upload_id UUID NOT NULL REFERENCES public.uploads(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'step1_pending' CHECK (
    status IN (
      'step1_pending', 'step1_running', 'step1_waiting_approval',
      'step2_pending', 'step2_running', 'step2_waiting_approval',
      'step3_pending', 'step3_running', 'step3_waiting_approval',
      'step4_pending', 'step4_running', 'step4_waiting_approval',
      'completed', 'failed'
    )
  ),
  current_step INTEGER NOT NULL DEFAULT 1,
  step_outputs JSONB DEFAULT '{}'::jsonb,
  last_error TEXT,
  camera_position TEXT,
  forward_direction TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS on floorplan_pipelines
ALTER TABLE public.floorplan_pipelines ENABLE ROW LEVEL SECURITY;

-- RLS policies for floorplan_pipelines
CREATE POLICY "Users can view their own pipelines" 
ON public.floorplan_pipelines 
FOR SELECT 
USING (auth.uid() = owner_id);

CREATE POLICY "Users can create their own pipelines" 
ON public.floorplan_pipelines 
FOR INSERT 
WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Users can update their own pipelines" 
ON public.floorplan_pipelines 
FOR UPDATE 
USING (auth.uid() = owner_id);

CREATE POLICY "Users can delete their own pipelines" 
ON public.floorplan_pipelines 
FOR DELETE 
USING (auth.uid() = owner_id);

-- Create floorplan_pipeline_events table for real-time progress
CREATE TABLE public.floorplan_pipeline_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  pipeline_id UUID NOT NULL REFERENCES public.floorplan_pipelines(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL,
  step_number INTEGER NOT NULL,
  ts TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  type TEXT NOT NULL,
  message TEXT NOT NULL,
  progress_int INTEGER NOT NULL DEFAULT 0
);

-- Enable RLS on floorplan_pipeline_events
ALTER TABLE public.floorplan_pipeline_events ENABLE ROW LEVEL SECURITY;

-- RLS policies for floorplan_pipeline_events
CREATE POLICY "Users can view their own pipeline events" 
ON public.floorplan_pipeline_events 
FOR SELECT 
USING (auth.uid() = owner_id);

CREATE POLICY "Users can insert their own pipeline events" 
ON public.floorplan_pipeline_events 
FOR INSERT 
WITH CHECK (auth.uid() = owner_id);

-- Create floorplan_pipeline_reviews table for step approvals
CREATE TABLE public.floorplan_pipeline_reviews (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  pipeline_id UUID NOT NULL REFERENCES public.floorplan_pipelines(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL,
  step_number INTEGER NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('approved', 'rejected')),
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS on floorplan_pipeline_reviews
ALTER TABLE public.floorplan_pipeline_reviews ENABLE ROW LEVEL SECURITY;

-- RLS policies for floorplan_pipeline_reviews
CREATE POLICY "Users can view their own pipeline reviews" 
ON public.floorplan_pipeline_reviews 
FOR SELECT 
USING (auth.uid() = owner_id);

CREATE POLICY "Users can insert their own pipeline reviews" 
ON public.floorplan_pipeline_reviews 
FOR INSERT 
WITH CHECK (auth.uid() = owner_id);

-- Enable realtime for pipeline events
ALTER PUBLICATION supabase_realtime ADD TABLE public.floorplan_pipeline_events;
ALTER PUBLICATION supabase_realtime ADD TABLE public.floorplan_pipelines;

-- Create indexes for performance
CREATE INDEX idx_floorplan_pipelines_project ON public.floorplan_pipelines(project_id);
CREATE INDEX idx_floorplan_pipelines_owner ON public.floorplan_pipelines(owner_id);
CREATE INDEX idx_floorplan_pipelines_floor_plan ON public.floorplan_pipelines(floor_plan_upload_id);
CREATE INDEX idx_floorplan_pipeline_events_pipeline ON public.floorplan_pipeline_events(pipeline_id);
CREATE INDEX idx_floorplan_pipeline_reviews_pipeline ON public.floorplan_pipeline_reviews(pipeline_id);