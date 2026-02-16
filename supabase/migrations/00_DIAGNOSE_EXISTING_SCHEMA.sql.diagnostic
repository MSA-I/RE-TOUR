-- Diagnostic Query: Check what already exists in the database
-- Run this first to see current state

-- Check if camera_intents table exists
SELECT
  'camera_intents' as table_name,
  EXISTS (
    SELECT FROM information_schema.tables
    WHERE table_schema = 'public'
    AND table_name = 'camera_intents'
  ) as table_exists;

-- Check if final_prompts table exists
SELECT
  'final_prompts' as table_name,
  EXISTS (
    SELECT FROM information_schema.tables
    WHERE table_schema = 'public'
    AND table_name = 'final_prompts'
  ) as table_exists;

-- Check camera_intents indexes
SELECT
  indexname,
  tablename
FROM pg_indexes
WHERE tablename = 'camera_intents'
ORDER BY indexname;

-- Check final_prompts indexes
SELECT
  indexname,
  tablename
FROM pg_indexes
WHERE tablename = 'final_prompts'
ORDER BY indexname;

-- Check camera_intents columns
SELECT
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_name = 'camera_intents'
ORDER BY ordinal_position;

-- Check final_prompts columns
SELECT
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_name = 'final_prompts'
ORDER BY ordinal_position;

-- Check RLS policies on camera_intents
SELECT
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd
FROM pg_policies
WHERE tablename = 'camera_intents';

-- Check RLS policies on final_prompts
SELECT
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd
FROM pg_policies
WHERE tablename = 'final_prompts';

-- Check if new enum values exist
SELECT e.enumlabel, e.enumsortorder
FROM pg_type t
JOIN pg_enum e ON t.oid = e.enumtypid
WHERE t.typname = 'whole_apartment_phase'
ORDER BY e.enumsortorder;

-- Check if trigger exists
SELECT tgname, tgenabled
FROM pg_trigger
WHERE tgname = 'enforce_phase_step_consistency';
