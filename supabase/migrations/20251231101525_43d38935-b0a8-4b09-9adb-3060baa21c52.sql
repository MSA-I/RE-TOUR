-- Add style_profile column to projects table for storing the generated style bible
ALTER TABLE public.projects 
ADD COLUMN IF NOT EXISTS style_profile jsonb DEFAULT NULL;