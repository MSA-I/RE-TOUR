-- Drop the old check constraint and add a new one that includes 'floor_plan'
ALTER TABLE public.uploads DROP CONSTRAINT uploads_kind_check;

ALTER TABLE public.uploads ADD CONSTRAINT uploads_kind_check 
CHECK (kind = ANY (ARRAY['panorama'::text, 'design_ref'::text, 'output'::text, 'floor_plan'::text]));