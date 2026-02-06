-- Create system_prompt_templates table for centralized, versioned prompt templates
CREATE TABLE public.system_prompt_templates (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  template_type text NOT NULL,
  template_version integer NOT NULL DEFAULT 1,
  template_content text NOT NULL,
  placeholders jsonb NOT NULL DEFAULT '[]'::jsonb,
  description text,
  generated_by_ai boolean DEFAULT false,
  ai_generation_prompt text,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create unique partial index for active templates per type
CREATE UNIQUE INDEX unique_active_template_per_type 
ON public.system_prompt_templates (template_type) 
WHERE is_active = true;

-- Enable RLS
ALTER TABLE public.system_prompt_templates ENABLE ROW LEVEL SECURITY;

-- Create RLS policies (service role only for writes, authenticated can read)
CREATE POLICY "Authenticated users can view system templates"
ON public.system_prompt_templates
FOR SELECT
USING (auth.role() = 'authenticated');

-- Add trigger for updated_at
CREATE TRIGGER update_system_prompt_templates_updated_at
BEFORE UPDATE ON public.system_prompt_templates
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Insert initial opposite-view template placeholder
INSERT INTO public.system_prompt_templates (
  template_type, 
  template_version, 
  template_content, 
  placeholders,
  description,
  generated_by_ai,
  is_active
) VALUES (
  'opposite_view_template',
  1,
  'PENDING_AI_GENERATION',
  '["{{camera_position}}", "{{yaw_opposite}}", "{{floor_plan}}", "{{image_A}}", "{{constraints}}", "{{space_name}}", "{{space_type}}"]'::jsonb,
  'Reusable template for generating Camera B (opposite-facing view) renders anchored to Camera A output',
  false,
  false
);