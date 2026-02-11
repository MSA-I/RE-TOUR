-- Migration: Deprecate Camera Intent Infrastructure (Step 3 - FROZEN)
-- Date: 2026-02-10
-- Reason: Step 3 (Camera Intent) is architecturally frozen per pipeline specification
--         Active execution infrastructure violates the locked architectural contract

-- Mark camera_intents table as deprecated
COMMENT ON TABLE camera_intents IS
'DEPRECATED: This table is part of Step 3 (Camera Intent) which is architecturally FROZEN.
Step 3 exists as a SPECIFICATION-ONLY layer and must not execute.
DO NOT use this table for active pipeline operations.
Kept for historical reference and potential future activation when engine-class models exist.
See: RETOUR – PIPELINE (UPDATED & LOCKED).txt for architectural rationale.
Status: FROZEN (2026-02-10)';

-- Mark enums as deprecated
COMMENT ON TYPE camera_template_id IS
'DEPRECATED: Part of frozen Step 3 (Camera Intent) specification.
Templates A-H remain valid as conceptual framework but must not execute.
Status: FROZEN (2026-02-10)';

COMMENT ON TYPE view_direction_type IS
'DEPRECATED: Part of frozen Step 3 (Camera Intent) specification.
View direction vocabulary remains valid conceptually but must not execute.
Status: FROZEN (2026-02-10)';

-- Add columns to track deprecation
ALTER TABLE camera_intents
ADD COLUMN IF NOT EXISTS deprecated_at TIMESTAMP DEFAULT NOW(),
ADD COLUMN IF NOT EXISTS deprecation_reason TEXT DEFAULT 'Step 3 frozen per architectural contract';

-- Optional: Disable RLS policies to prevent new writes (uncomment if desired)
-- ALTER TABLE camera_intents DISABLE ROW LEVEL SECURITY;

-- Note: Table is kept for historical data but should not be written to
-- Active pipeline must function WITHOUT Step 3 execution
