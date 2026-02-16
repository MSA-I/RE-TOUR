-- Migration: Drop old camera_intents table to allow new schema
-- The original camera_intents table (from 20260210105014) has incompatible schema
-- This migration allows the new schema in 20260210140000 to be created properly

DROP TABLE IF EXISTS public.camera_intents CASCADE;

-- Drop related types if they exist
DROP TYPE IF EXISTS camera_template_id CASCADE;
DROP TYPE IF EXISTS view_direction_type CASCADE;
