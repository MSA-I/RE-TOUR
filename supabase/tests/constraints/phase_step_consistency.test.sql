BEGIN;
SELECT plan(5);

-- 1. Insert pipeline with new phase 'camera_intent_pending', expect step 4
INSERT INTO floorplan_pipelines (id, owner_id, whole_apartment_phase, name)
VALUES (uuid_generate_v4(), auth.uid(), 'camera_intent_pending', 'Test Pipeline 1');

SELECT results_eq(
    'SELECT current_step FROM floorplan_pipelines WHERE name = ''Test Pipeline 1''',
    ARRAY[4],
    'camera_intent_pending should default to step 4'
);

-- 2. Insert pipeline with 'outputs_review', expect step 6
INSERT INTO floorplan_pipelines (id, owner_id, whole_apartment_phase, name)
VALUES (uuid_generate_v4(), auth.uid(), 'outputs_review', 'Test Pipeline 2');

SELECT results_eq(
    'SELECT current_step FROM floorplan_pipelines WHERE name = ''Test Pipeline 2''',
    ARRAY[6],
    'outputs_review should default to step 6'
);

-- 3. Test explicit correct step assignment
INSERT INTO floorplan_pipelines (id, owner_id, whole_apartment_phase, current_step, name)
VALUES (uuid_generate_v4(), auth.uid(), 'prompt_templates_confirmed', 5, 'Test Pipeline 3');

SELECT results_eq(
    'SELECT current_step FROM floorplan_pipelines WHERE name = ''Test Pipeline 3''',
    ARRAY[5],
    'Explicit correct step should be accepted'
);

-- 4. Test mismatch step assignment (should fail)
PREPARE mismatch_insert AS
INSERT INTO floorplan_pipelines (id, owner_id, whole_apartment_phase, current_step, name)
VALUES (uuid_generate_v4(), auth.uid(), 'camera_intent_pending', 2, 'Fail Pipeline');

SELECT throws_ok(
    'mismatch_insert',
    'Phase camera_intent_pending expects step 4 but current_step is 2',
    'Mismatched phase/step should raise exception'
);

-- 5. Test unknown phase (should fail)
-- Note: Enum validation might catch this before the trigger, but good to test custom trigger logic if possible
-- or at least verify the enum constraint works
PREPARE unknown_phase AS
INSERT INTO floorplan_pipelines (id, owner_id, whole_apartment_phase, name)
VALUES (uuid_generate_v4(), auth.uid(), 'invalid_phase_name', 'Fail Pipeline 2');

-- This error comes from Postgres enum check, not our function, but ensures data integrity
SELECT throws_like(
    'unknown_phase',
    '%"invalid_phase_name"%',
    'Invalid phase name should be rejected'
);

SELECT * FROM finish();
ROLLBACK;
