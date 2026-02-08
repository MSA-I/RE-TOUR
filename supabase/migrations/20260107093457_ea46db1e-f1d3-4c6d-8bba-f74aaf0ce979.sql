-- Create virtual_tour_jobs table for MVP scaffolding
CREATE TABLE public.virtual_tour_jobs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id UUID NOT NULL,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'processing', 'preview_ready', 'completed', 'failed')),
  input_asset_ids UUID[] NOT NULL DEFAULT '{}',
  input_type TEXT NOT NULL DEFAULT 'upload' CHECK (input_type IN ('upload', 'attach', 'mixed')),
  max_items INTEGER NOT NULL DEFAULT 100,
  preview_url TEXT,
  last_error TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.virtual_tour_jobs ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
CREATE POLICY "Users can view their own virtual tour jobs" 
ON public.virtual_tour_jobs 
FOR SELECT 
USING (auth.uid() = owner_id);

CREATE POLICY "Users can create their own virtual tour jobs" 
ON public.virtual_tour_jobs 
FOR INSERT 
WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Users can update their own virtual tour jobs" 
ON public.virtual_tour_jobs 
FOR UPDATE 
USING (auth.uid() = owner_id);

CREATE POLICY "Users can delete their own virtual tour jobs" 
ON public.virtual_tour_jobs 
FOR DELETE 
USING (auth.uid() = owner_id);

-- Add updated_at trigger
CREATE TRIGGER update_virtual_tour_jobs_updated_at
BEFORE UPDATE ON public.virtual_tour_jobs
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Enable realtime for the table
ALTER PUBLICATION supabase_realtime ADD TABLE public.virtual_tour_jobs;