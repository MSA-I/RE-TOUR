-- Add soft delete columns to uploads table
-- This fixes the 400 Bad Request error when querying with .is("deleted_at", null)
-- Issue: Frontend code queries deleted_at column that didn't exist in database schema

ALTER TABLE public.uploads
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT NULL;

-- Add comments for documentation
COMMENT ON COLUMN public.uploads.deleted_at IS
  'Soft delete timestamp. NULL = active (not deleted), non-NULL = deleted. Used for filtering uploads without hard deletion.';
COMMENT ON COLUMN public.uploads.deleted_by IS
  'User who soft-deleted this upload. NULL if not deleted. References auth.users(id).';

-- Add partial index for fast filtering of non-deleted uploads
-- This supports the most common query pattern: WHERE project_id = X AND deleted_at IS NULL
-- Partial index only indexes rows where deleted_at IS NULL (most uploads), saving space
CREATE INDEX IF NOT EXISTS idx_uploads_not_deleted
  ON public.uploads(project_id, created_at)
  WHERE deleted_at IS NULL;

-- Add index for finding deleted items by user (admin/cleanup queries)
CREATE INDEX IF NOT EXISTS idx_uploads_deleted_by
  ON public.uploads(deleted_by)
  WHERE deleted_at IS NOT NULL;

-- Verification query (should return all existing uploads with deleted_at = NULL)
DO $$
DECLARE
  upload_count int;
BEGIN
  SELECT COUNT(*) INTO upload_count FROM public.uploads WHERE deleted_at IS NULL;
  RAISE NOTICE 'Migration complete: % active uploads (deleted_at IS NULL)', upload_count;
END $$;
