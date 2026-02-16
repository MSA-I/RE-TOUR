-- Migration: Create camera_intents table for Camera Intent suggestions (Spec Step 3)
-- FIXED VERSION: Uses IF NOT EXISTS and handles partial migrations
-- This version is idempotent and safe to run multiple times

-- Create table if it doesn't exist
CREATE TABLE IF NOT EXISTS camera_intents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pipeline_id UUID NOT NULL REFERENCES floorplan_pipelines(id) ON DELETE CASCADE,
  space_id UUID NOT NULL REFERENCES floorplan_pipeline_spaces(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL REFERENCES auth.users(id),

  -- Suggestion details
  suggestion_text TEXT NOT NULL,
  suggestion_index INT NOT NULL, -- 0-based index within space
  space_size_category TEXT NOT NULL CHECK (space_size_category IN ('large', 'normal')),

  -- Selection state
  is_selected BOOLEAN DEFAULT FALSE,
  selected_at TIMESTAMPTZ,

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Constraints
  UNIQUE(space_id, suggestion_index)
);

-- Create indexes only if they don't exist
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_camera_intents_pipeline') THEN
    CREATE INDEX idx_camera_intents_pipeline ON camera_intents(pipeline_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_camera_intents_space') THEN
    CREATE INDEX idx_camera_intents_space ON camera_intents(space_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_camera_intents_selected') THEN
    CREATE INDEX idx_camera_intents_selected ON camera_intents(pipeline_id, is_selected) WHERE is_selected = TRUE;
  END IF;
END $$;

-- Enable RLS
ALTER TABLE camera_intents ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (to avoid duplicates)
DROP POLICY IF EXISTS "Users can view their own camera intents" ON camera_intents;
DROP POLICY IF EXISTS "Users can insert their own camera intents" ON camera_intents;
DROP POLICY IF EXISTS "Users can update their own camera intents" ON camera_intents;

-- Create RLS policies
CREATE POLICY "Users can view their own camera intents"
  ON camera_intents FOR SELECT
  USING (auth.uid() = owner_id);

CREATE POLICY "Users can insert their own camera intents"
  ON camera_intents FOR INSERT
  WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Users can update their own camera intents"
  ON camera_intents FOR UPDATE
  USING (auth.uid() = owner_id);
