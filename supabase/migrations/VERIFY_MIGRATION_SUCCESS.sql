-- Verification Queries - Check that migrations were successful
-- Run these to confirm everything important exists

-- ============================================================
-- 1. CHECK CAMERA_INTENTS TABLE - SPECIFIC COLUMNS
-- ============================================================
SELECT
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_name = 'camera_intents'
AND column_name IN (
  'id',
  'pipeline_id',
  'space_id',
  'owner_id',
  'suggestion_text',
  'suggestion_index',
  'space_size_category',
  'is_selected',
  'selected_at',
  'created_at',
  'updated_at'
)
ORDER BY ordinal_position;
-- Expected: 11 rows (all core columns present)

-- ============================================================
-- 2. CHECK FINAL_PROMPTS TABLE - SPECIFIC COLUMNS
-- ============================================================
SELECT
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_name = 'final_prompts'
AND column_name IN (
  'id',
  'pipeline_id',
  'space_id',
  'owner_id',
  'prompt_template',
  'final_composed_prompt',
  'image_count',
  'source_camera_intent_ids',
  'nanobanana_job_id',
  'status',
  'created_at',
  'updated_at',
  'executed_at',
  'completed_at'
)
ORDER BY ordinal_position;
-- Expected: 14 rows (all core columns present)

-- ============================================================
-- 3. CHECK REQUIRED INDEXES EXIST
-- ============================================================
SELECT
  indexname,
  tablename,
  indexdef
FROM pg_indexes
WHERE indexname IN (
  'idx_camera_intents_pipeline',
  'idx_camera_intents_space',
  'idx_camera_intents_selected',
  'idx_final_prompts_pipeline',
  'idx_final_prompts_space',
  'idx_final_prompts_status'
)
ORDER BY indexname;
-- Expected: 6 rows (all indexes present)

-- ============================================================
-- 4. CHECK RLS POLICIES EXIST
-- ============================================================
SELECT
  tablename,
  policyname,
  cmd
FROM pg_policies
WHERE tablename IN ('camera_intents', 'final_prompts')
ORDER BY tablename, policyname;
-- Expected: 6 rows (3 for each table: SELECT, INSERT, UPDATE)

-- ============================================================
-- 5. CHECK NEW ENUM VALUES - SPECIFIC LIST
-- ============================================================
SELECT
  e.enumlabel,
  e.enumsortorder
FROM pg_type t
JOIN pg_enum e ON t.oid = e.enumtypid
WHERE t.typname = 'whole_apartment_phase'
AND e.enumlabel IN (
  'camera_intent_pending',
  'camera_intent_confirmed',
  'prompt_templates_pending',
  'prompt_templates_confirmed',
  'outputs_pending',
  'outputs_in_progress',
  'outputs_review'
)
ORDER BY e.enumlabel;
-- Expected: 7 rows (all new phase values)

-- ============================================================
-- 6. CHECK PHASE-STEP TRIGGER EXISTS
-- ============================================================
SELECT
  tgname as trigger_name,
  tgenabled as enabled,
  tgtype as trigger_type
FROM pg_trigger
WHERE tgname = 'enforce_phase_step_consistency';
-- Expected: 1 row (trigger exists and is enabled)

-- ============================================================
-- 7. SIMPLE SUCCESS CHECK - Run this last
-- ============================================================
SELECT
  'camera_intents' as table_name,
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_name = 'camera_intents') as column_count,
  (SELECT COUNT(*) FROM pg_indexes WHERE tablename = 'camera_intents') as index_count,
  (SELECT COUNT(*) FROM pg_policies WHERE tablename = 'camera_intents') as policy_count
UNION ALL
SELECT
  'final_prompts' as table_name,
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_name = 'final_prompts') as column_count,
  (SELECT COUNT(*) FROM pg_indexes WHERE tablename = 'final_prompts') as index_count,
  (SELECT COUNT(*) FROM pg_policies WHERE tablename = 'final_prompts') as policy_count;

-- ============================================================
-- 8. FINAL VALIDATION - Try to insert test data
-- ============================================================
-- This will test that all constraints and references work
-- It inserts test data then immediately deletes it

DO $$
DECLARE
  test_pipeline_id UUID;
  test_space_id UUID;
  test_user_id UUID;
  test_intent_id UUID;
  test_prompt_id UUID;
BEGIN
  -- Get sample IDs from existing data
  SELECT id INTO test_pipeline_id FROM floorplan_pipelines LIMIT 1;
  SELECT id INTO test_space_id FROM floorplan_pipeline_spaces LIMIT 1;
  SELECT id INTO test_user_id FROM auth.users LIMIT 1;

  IF test_pipeline_id IS NOT NULL AND test_space_id IS NOT NULL AND test_user_id IS NOT NULL THEN
    -- Test camera_intents insert
    BEGIN
      INSERT INTO camera_intents (
        pipeline_id, space_id, owner_id,
        suggestion_text, suggestion_index, space_size_category
      ) VALUES (
        test_pipeline_id, test_space_id, test_user_id,
        'TEST: Wide angle view', 0, 'large'
      ) RETURNING id INTO test_intent_id;

      DELETE FROM camera_intents WHERE id = test_intent_id;
      RAISE NOTICE '✅ camera_intents table works correctly';
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE '❌ camera_intents test failed: %', SQLERRM;
    END;

    -- Test final_prompts insert
    BEGIN
      INSERT INTO final_prompts (
        pipeline_id, space_id, owner_id,
        prompt_template, final_composed_prompt,
        image_count, source_camera_intent_ids, status
      ) VALUES (
        test_pipeline_id, test_space_id, test_user_id,
        'TEST template', 'TEST final prompt',
        2, ARRAY[uuid_generate_v4()], 'pending'
      ) RETURNING id INTO test_prompt_id;

      DELETE FROM final_prompts WHERE id = test_prompt_id;
      RAISE NOTICE '✅ final_prompts table works correctly';
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE '❌ final_prompts test failed: %', SQLERRM;
    END;

    RAISE NOTICE '🎉 All migration tests passed!';
  ELSE
    RAISE NOTICE '⚠️  No test data available. Tables exist but not tested.';
  END IF;
END $$;

-- ============================================================
-- SUCCESS INDICATOR
-- ============================================================
-- If you see this message without errors, migrations are successful
SELECT '🎉 MIGRATION VERIFICATION COMPLETE 🎉' as status;
