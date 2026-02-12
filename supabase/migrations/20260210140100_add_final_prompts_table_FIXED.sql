-- Migration: Create final_prompts table for final composed prompts (Spec Step 4)
-- FIXED VERSION: Uses IF NOT EXISTS and handles partial migrations
-- This version is idempotent and safe to run multiple times

-- Create table if it doesn't exist
CREATE TABLE IF NOT EXISTS final_prompts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pipeline_id UUID NOT NULL REFERENCES floorplan_pipelines(id) ON DELETE CASCADE,
  space_id UUID NOT NULL REFERENCES floorplan_pipeline_spaces(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL REFERENCES auth.users(id),

  -- Prompt composition
  prompt_template TEXT NOT NULL,
  final_composed_prompt TEXT NOT NULL,
  image_count INT DEFAULT 1 CHECK (image_count >= 1 AND image_count <= 10),

  -- Source tracking
  source_camera_intent_ids UUID[] NOT NULL, -- Array of selected intent IDs

  -- Execution tracking
  nanobanana_job_id TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'queued', 'generating', 'complete', 'failed')),

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  executed_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,

  -- Constraints
  UNIQUE(pipeline_id, space_id)
);

-- Create indexes only if they don't exist
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_final_prompts_pipeline') THEN
    CREATE INDEX idx_final_prompts_pipeline ON final_prompts(pipeline_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_final_prompts_space') THEN
    CREATE INDEX idx_final_prompts_space ON final_prompts(space_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_final_prompts_status') THEN
    CREATE INDEX idx_final_prompts_status ON final_prompts(status);
  END IF;
END $$;

-- Enable RLS
ALTER TABLE final_prompts ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (to avoid duplicates)
DROP POLICY IF EXISTS "Users can view their own final prompts" ON final_prompts;
DROP POLICY IF EXISTS "Users can insert their own final prompts" ON final_prompts;
DROP POLICY IF EXISTS "Users can update their own final prompts" ON final_prompts;

-- Create RLS policies
CREATE POLICY "Users can view their own final prompts"
  ON final_prompts FOR SELECT
  USING (auth.uid() = owner_id);

CREATE POLICY "Users can insert their own final prompts"
  ON final_prompts FOR INSERT
  WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Users can update their own final prompts"
  ON final_prompts FOR UPDATE
  USING (auth.uid() = owner_id);
