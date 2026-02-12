-- Migration: Add output and QA fields to final_prompts table
-- Purpose: Enable per-space output display and QA integration in Step 6
-- Date: 2026-02-12

-- ════════════════════════════════════════════════════════════════════════════
-- Add Output Fields
-- ════════════════════════════════════════════════════════════════════════════

-- Array of upload IDs for generated images
ALTER TABLE final_prompts
  ADD COLUMN IF NOT EXISTS output_upload_ids text[] DEFAULT ARRAY[]::text[];

-- ════════════════════════════════════════════════════════════════════════════
-- Add QA Fields
-- ════════════════════════════════════════════════════════════════════════════

-- QA decision (approved, failed, pending)
ALTER TABLE final_prompts
  ADD COLUMN IF NOT EXISTS qa_status text;

-- Detailed QA report (criteria breakdown)
ALTER TABLE final_prompts
  ADD COLUMN IF NOT EXISTS qa_report jsonb;

-- Numeric QA score (0-100 or 0.0-1.0)
ALTER TABLE final_prompts
  ADD COLUMN IF NOT EXISTS qa_score numeric;

-- Human-readable QA feedback
ALTER TABLE final_prompts
  ADD COLUMN IF NOT EXISTS qa_feedback text;

-- QA rejection reason (if failed)
ALTER TABLE final_prompts
  ADD COLUMN IF NOT EXISTS qa_reason text;

-- ════════════════════════════════════════════════════════════════════════════
-- Add Approval Fields
-- ════════════════════════════════════════════════════════════════════════════

-- Manual approval override (bypass QA failure)
ALTER TABLE final_prompts
  ADD COLUMN IF NOT EXISTS manual_approved boolean DEFAULT false;

-- Locked approval state (cannot be changed once locked)
ALTER TABLE final_prompts
  ADD COLUMN IF NOT EXISTS locked_approved boolean DEFAULT false;

-- Attempt number (for retry tracking)
ALTER TABLE final_prompts
  ADD COLUMN IF NOT EXISTS attempt_number integer DEFAULT 1;

-- Approval timestamp
ALTER TABLE final_prompts
  ADD COLUMN IF NOT EXISTS approved_at timestamptz;

-- User who approved (reference to auth.users)
ALTER TABLE final_prompts
  ADD COLUMN IF NOT EXISTS approved_by uuid;

-- Add foreign key constraint for approved_by (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'final_prompts_approved_by_fkey'
    AND table_name = 'final_prompts'
  ) THEN
    ALTER TABLE final_prompts
      ADD CONSTRAINT final_prompts_approved_by_fkey
      FOREIGN KEY (approved_by) REFERENCES auth.users(id);
  END IF;
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- Add Indexes for Performance
-- ════════════════════════════════════════════════════════════════════════════

-- Index for querying by QA status (e.g., find all failed outputs)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE indexname = 'idx_final_prompts_qa_status'
  ) THEN
    CREATE INDEX idx_final_prompts_qa_status ON final_prompts(qa_status);
  END IF;
END $$;

-- Index for querying approved outputs
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE indexname = 'idx_final_prompts_approved'
  ) THEN
    CREATE INDEX idx_final_prompts_approved ON final_prompts(locked_approved);
  END IF;
END $$;

-- Index for querying by attempt number (find retries)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE indexname = 'idx_final_prompts_attempt'
  ) THEN
    CREATE INDEX idx_final_prompts_attempt ON final_prompts(pipeline_id, space_id, attempt_number);
  END IF;
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- Add Comments for Documentation
-- ════════════════════════════════════════════════════════════════════════════

COMMENT ON COLUMN final_prompts.output_upload_ids IS 'Array of upload IDs for generated images';
COMMENT ON COLUMN final_prompts.qa_status IS 'QA decision: approved, failed, or pending';
COMMENT ON COLUMN final_prompts.qa_report IS 'Detailed QA report with criteria breakdown';
COMMENT ON COLUMN final_prompts.qa_score IS 'Numeric QA score (0-100 or 0.0-1.0)';
COMMENT ON COLUMN final_prompts.qa_feedback IS 'Human-readable QA feedback message';
COMMENT ON COLUMN final_prompts.qa_reason IS 'Reason for QA rejection (if failed)';
COMMENT ON COLUMN final_prompts.manual_approved IS 'Manual approval override (bypass QA failure)';
COMMENT ON COLUMN final_prompts.locked_approved IS 'Locked approval state (immutable once set)';
COMMENT ON COLUMN final_prompts.attempt_number IS 'Attempt number for retry tracking (1 = first attempt)';
COMMENT ON COLUMN final_prompts.approved_at IS 'Timestamp when output was approved';
COMMENT ON COLUMN final_prompts.approved_by IS 'User who approved the output';

-- ════════════════════════════════════════════════════════════════════════════
-- Verification Queries (Run in Supabase SQL Editor)
-- ════════════════════════════════════════════════════════════════════════════

-- Verify all new columns exist
-- SELECT column_name, data_type, is_nullable, column_default
-- FROM information_schema.columns
-- WHERE table_name = 'final_prompts'
-- AND column_name IN (
--   'output_upload_ids', 'qa_status', 'qa_report', 'qa_score', 'qa_feedback', 'qa_reason',
--   'manual_approved', 'locked_approved', 'attempt_number', 'approved_at', 'approved_by'
-- )
-- ORDER BY ordinal_position;

-- Verify indexes exist
-- SELECT indexname, indexdef
-- FROM pg_indexes
-- WHERE tablename = 'final_prompts'
-- AND indexname IN (
--   'idx_final_prompts_qa_status',
--   'idx_final_prompts_approved',
--   'idx_final_prompts_attempt'
-- );

-- Verify foreign key constraint exists
-- SELECT constraint_name, constraint_type
-- FROM information_schema.table_constraints
-- WHERE table_name = 'final_prompts'
-- AND constraint_name = 'final_prompts_approved_by_fkey';
