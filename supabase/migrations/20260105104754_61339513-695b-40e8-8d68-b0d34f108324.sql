-- Add navigation routing fields to notifications table
ALTER TABLE public.notifications
ADD COLUMN IF NOT EXISTS target_route text,
ADD COLUMN IF NOT EXISTS target_params jsonb DEFAULT '{}'::jsonb;