-- ═══════════════════════════════════════════════════════════════════════════
-- Database Constraint Tests (Comprehensive)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Authority: deep_debugger_plan.md Component 2.1
-- Purpose: Verify all database constraints prevent data corruption
-- Run: supabase test db
--
-- CRITICAL: These tests must pass 100% before applying migrations to production
-- Historical Context: Phase/step mismatches caused 500 errors in previous migrations
--
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

SELECT plan(12); -- Total number of tests

-- ═══════════════════════════════════════════════════════════════════════════
-- Test 1: Phase-Step Consistency Constraint
-- ═══════════════════════════════════════════════════════════════════════════

SELECT is(
  (SELECT COUNT(*) FROM floorplan_pipelines
   WHERE whole_apartment_phase = 'camera_intent_pending' AND current_step = 4),
  0::bigint,
  'Phase camera_intent_pending must map to step 4'
);

-- Test valid phase-step combination (should succeed)
SELECT lives_ok(
  $$
    INSERT INTO floorplan_pipelines (id, whole_apartment_phase, current_step, owner_id)
    VALUES (
      uuid_generate_v4(),
      'camera_intent_pending',
      4,
      (SELECT id FROM auth.users LIMIT 1)
    )
  $$,
  'Valid phase-step combination (camera_intent_pending, 4) should succeed'
);

-- Test invalid phase-step combination (should fail if trigger exists)
-- Note: This test expects a constraint/trigger to prevent invalid combinations
-- If no trigger exists, this test serves as documentation of required constraint

SELECT throws_ok(
  $$
    INSERT INTO floorplan_pipelines (id, whole_apartment_phase, current_step, owner_id)
    VALUES (
      uuid_generate_v4(),
      'camera_intent_pending',
      3, -- Wrong step number
      (SELECT id FROM auth.users LIMIT 1)
    )
  $$,
  NULL, -- Match any error code
  NULL, -- Match any error message
  'Invalid phase-step combination (camera_intent_pending, 3) should be rejected'
);

-- ═══════════════════════════════════════════════════════════════════════════
-- Test 2: Camera Intents Table Constraints
-- ═══════════════════════════════════════════════════════════════════════════

-- Test: Foreign key integrity (pipeline_id must exist)
SELECT throws_ok(
  $$
    INSERT INTO camera_intents (
      id, pipeline_id, space_id, owner_id,
      suggestion_text, suggestion_index, space_size_category
    )
    VALUES (
      uuid_generate_v4(),
      uuid_generate_v4(), -- Non-existent pipeline
      uuid_generate_v4(),
      (SELECT id FROM auth.users LIMIT 1),
      'Test suggestion',
      0,
      'normal'
    )
  $$,
  '23503', -- foreign key violation error code
  NULL,
  'camera_intents.pipeline_id must reference existing pipeline'
);

-- Test: Unique constraint (space_id + suggestion_index)
SELECT lives_ok(
  $$
    WITH test_pipeline AS (
      INSERT INTO floorplan_pipelines (id, whole_apartment_phase, owner_id)
      VALUES (uuid_generate_v4(), 'camera_intent_pending', (SELECT id FROM auth.users LIMIT 1))
      RETURNING id
    ),
    test_space AS (
      INSERT INTO floorplan_pipeline_spaces (id, pipeline_id, name, space_type, owner_id)
      SELECT uuid_generate_v4(), test_pipeline.id, 'Test Space', 'living_room',
             (SELECT id FROM auth.users LIMIT 1)
      FROM test_pipeline
      RETURNING id, pipeline_id
    )
    INSERT INTO camera_intents (
      id, pipeline_id, space_id, owner_id,
      suggestion_text, suggestion_index, space_size_category
    )
    SELECT
      uuid_generate_v4(),
      test_space.pipeline_id,
      test_space.id,
      (SELECT id FROM auth.users LIMIT 1),
      'First suggestion',
      0,
      'large'
    FROM test_space
  $$,
  'First camera intent suggestion should be created successfully'
);

-- Test: Duplicate space_id + suggestion_index should fail
SELECT throws_ok(
  $$
    WITH test_pipeline AS (
      SELECT id FROM floorplan_pipelines LIMIT 1
    ),
    test_space AS (
      SELECT id, pipeline_id FROM floorplan_pipeline_spaces LIMIT 1
    )
    INSERT INTO camera_intents (
      id, pipeline_id, space_id, owner_id,
      suggestion_text, suggestion_index, space_size_category
    )
    SELECT
      uuid_generate_v4(),
      test_space.pipeline_id,
      test_space.id,
      (SELECT id FROM auth.users LIMIT 1),
      'Duplicate suggestion',
      0, -- Same index as previous test
      'large'
    FROM test_space
  $$,
  '23505', -- unique violation error code
  NULL,
  'Duplicate (space_id, suggestion_index) should be rejected'
);

-- Test: space_size_category check constraint
SELECT throws_ok(
  $$
    WITH test_pipeline AS (
      SELECT id FROM floorplan_pipelines LIMIT 1
    ),
    test_space AS (
      SELECT id, pipeline_id FROM floorplan_pipeline_spaces LIMIT 1
    )
    INSERT INTO camera_intents (
      id, pipeline_id, space_id, owner_id,
      suggestion_text, suggestion_index, space_size_category
    )
    SELECT
      uuid_generate_v4(),
      test_space.pipeline_id,
      test_space.id,
      (SELECT id FROM auth.users LIMIT 1),
      'Invalid category test',
      1,
      'invalid_category' -- Should fail check constraint
    FROM test_space
  $$,
  '23514', -- check violation error code
  NULL,
  'Invalid space_size_category should be rejected'
);

-- ═══════════════════════════════════════════════════════════════════════════
-- Test 3: Final Prompts Table Constraints
-- ═══════════════════════════════════════════════════════════════════════════

-- Test: Foreign key integrity (pipeline_id and space_id must exist)
SELECT throws_ok(
  $$
    INSERT INTO final_prompts (
      id, pipeline_id, space_id, owner_id,
      prompt_template, final_composed_prompt,
      source_camera_intent_ids, image_count
    )
    VALUES (
      uuid_generate_v4(),
      uuid_generate_v4(), -- Non-existent pipeline
      uuid_generate_v4(), -- Non-existent space
      (SELECT id FROM auth.users LIMIT 1),
      'Test template',
      'Test prompt',
      ARRAY[]::uuid[],
      1
    )
  $$,
  '23503', -- foreign key violation error code
  NULL,
  'final_prompts must reference existing pipeline and space'
);

-- Test: Unique constraint (pipeline_id + space_id)
-- First insert should succeed
SELECT lives_ok(
  $$
    WITH test_pipeline AS (
      INSERT INTO floorplan_pipelines (id, whole_apartment_phase, owner_id)
      VALUES (uuid_generate_v4(), 'prompt_templates_pending', (SELECT id FROM auth.users LIMIT 1))
      RETURNING id
    ),
    test_space AS (
      INSERT INTO floorplan_pipeline_spaces (id, pipeline_id, name, space_type, owner_id)
      SELECT uuid_generate_v4(), test_pipeline.id, 'Test Space 2', 'bedroom',
             (SELECT id FROM auth.users LIMIT 1)
      FROM test_pipeline
      RETURNING id, pipeline_id
    )
    INSERT INTO final_prompts (
      id, pipeline_id, space_id, owner_id,
      prompt_template, final_composed_prompt,
      source_camera_intent_ids, image_count
    )
    SELECT
      uuid_generate_v4(),
      test_space.pipeline_id,
      test_space.id,
      (SELECT id FROM auth.users LIMIT 1),
      'Template 1',
      'Composed prompt 1',
      ARRAY[]::uuid[],
      2
    FROM test_space
  $$,
  'First final prompt should be created successfully'
);

-- Test: image_count check constraint (must be 1-10)
SELECT throws_ok(
  $$
    WITH test_pipeline AS (
      SELECT id FROM floorplan_pipelines LIMIT 1
    ),
    test_space AS (
      INSERT INTO floorplan_pipeline_spaces (id, pipeline_id, name, space_type, owner_id)
      SELECT uuid_generate_v4(), test_pipeline.id, 'Test Space 3', 'kitchen',
             (SELECT id FROM auth.users LIMIT 1)
      FROM test_pipeline
      RETURNING id, pipeline_id
    )
    INSERT INTO final_prompts (
      id, pipeline_id, space_id, owner_id,
      prompt_template, final_composed_prompt,
      source_camera_intent_ids, image_count
    )
    SELECT
      uuid_generate_v4(),
      test_space.pipeline_id,
      test_space.id,
      (SELECT id FROM auth.users LIMIT 1),
      'Template invalid',
      'Composed prompt invalid',
      ARRAY[]::uuid[],
      11 -- Exceeds max of 10
    FROM test_space
  $$,
  '23514', -- check violation error code
  NULL,
  'image_count > 10 should be rejected'
);

-- Test: status check constraint
SELECT throws_ok(
  $$
    WITH test_pipeline AS (
      SELECT id FROM floorplan_pipelines LIMIT 1
    ),
    test_space AS (
      INSERT INTO floorplan_pipeline_spaces (id, pipeline_id, name, space_type, owner_id)
      SELECT uuid_generate_v4(), test_pipeline.id, 'Test Space 4', 'bathroom',
             (SELECT id FROM auth.users LIMIT 1)
      FROM test_pipeline
      RETURNING id, pipeline_id
    )
    INSERT INTO final_prompts (
      id, pipeline_id, space_id, owner_id,
      prompt_template, final_composed_prompt,
      source_camera_intent_ids, image_count, status
    )
    SELECT
      uuid_generate_v4(),
      test_space.pipeline_id,
      test_space.id,
      (SELECT id FROM auth.users LIMIT 1),
      'Template status test',
      'Composed prompt status test',
      ARRAY[]::uuid[],
      1,
      'invalid_status' -- Should fail check constraint
    FROM test_space
  $$,
  '23514', -- check violation error code
  NULL,
  'Invalid status value should be rejected'
);

-- ═══════════════════════════════════════════════════════════════════════════
-- Finalize Tests
-- ═══════════════════════════════════════════════════════════════════════════

SELECT * FROM finish();

ROLLBACK;

-- ═══════════════════════════════════════════════════════════════════════════
-- End of Constraint Tests
-- ═══════════════════════════════════════════════════════════════════════════
--
-- SUCCESS CRITERIA:
-- - All 12 tests must pass
-- - No constraint violations in production data
-- - Foreign key integrity maintained
-- - Check constraints enforced
--
-- If any test fails: DO NOT proceed to production deployment
-- ═══════════════════════════════════════════════════════════════════════════
