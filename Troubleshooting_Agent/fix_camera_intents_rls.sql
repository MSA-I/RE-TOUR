-- Fix RLS policies for camera_intents table
-- Problem: Users can't update their own selections due to RLS blocking

-- Drop existing update policy
DROP POLICY IF EXISTS "Users can update their own camera intents" ON camera_intents;

-- Recreate with correct RLS check
CREATE POLICY "Users can update their own camera intents"
  ON camera_intents
  FOR UPDATE
  USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);

-- Verify policies exist
SELECT
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE tablename = 'camera_intents'
ORDER BY policyname;

-- Test query (should work for authenticated users)
-- UPDATE camera_intents SET is_selected = true WHERE id = 'some-uuid';
