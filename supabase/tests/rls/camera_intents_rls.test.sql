BEGIN;
SELECT plan(7);

-- Create test users
INSERT INTO auth.users (id, email) VALUES ('user1_uuid', 'user1@example.com');
INSERT INTO auth.users (id, email) VALUES ('user2_uuid', 'user2@example.com');

-- Setup test data dependencies
INSERT INTO floorplan_pipelines (id, owner_id, name) VALUES ('pipe1_uuid', 'user1_uuid', 'User 1 Pipeline');
INSERT INTO floorplan_pipeline_spaces (id, pipeline_id, name) VALUES ('space1_uuid', 'pipe1_uuid', 'Living Room');

-- Switch to User 1
SET ROLE authenticated;
SET request.jwt.claim.sub = 'user1_uuid';
SET request.jwt.claims = '{"sub": "user1_uuid", "role": "authenticated"}';

-- 1. Test Select Own Data
INSERT INTO camera_intents (id, pipeline_id, space_id, owner_id, suggestion_text, suggestion_index, space_size_category)
VALUES ('intent1_uuid', 'pipe1_uuid', 'space1_uuid', 'user1_uuid', 'Wide shot', 0, 'large');

SELECT results_eq(
    'SELECT count(*) FROM camera_intents WHERE id = ''intent1_uuid''',
    ARRAY[1::bigint],
    'User 1 should see their own camera intent'
);

-- 2. Test Insert Own Data
SELECT lives_ok(
    $$ INSERT INTO camera_intents (id, pipeline_id, space_id, owner_id, suggestion_text, suggestion_index, space_size_category)
       VALUES (uuid_generate_v4(), 'pipe1_uuid', 'space1_uuid', 'user1_uuid', 'Detail shot', 1, 'large') $$,
    'User 1 should be able to insert their own data'
);

-- 3. Test Update Own Data
SELECT lives_ok(
    $$ UPDATE camera_intents SET is_selected = TRUE WHERE id = 'intent1_uuid' $$,
    'User 1 should be able to update their own data'
);

-- Switch to User 2
SET request.jwt.claim.sub = 'user2_uuid';
SET request.jwt.claims = '{"sub": "user2_uuid", "role": "authenticated"}';

-- 4. Test View Other's Data (Should be empty)
SELECT results_eq(
    'SELECT count(*) FROM camera_intents WHERE id = ''intent1_uuid''',
    ARRAY[0::bigint],
    'User 2 should NOT see User 1s camera intent'
);

-- 5. Test Update Other's Data (Should be 0 rows affected)
PREPARE update_other AS
UPDATE camera_intents SET suggestion_text = 'Hacked' WHERE id = 'intent1_uuid';

SELECT results_eq(
    'WITH rows AS (UPDATE camera_intents SET suggestion_text = ''Hacked'' WHERE id = ''intent1_uuid'' RETURNING 1) SELECT count(*) FROM rows',
    ARRAY[0::bigint],
    'User 2 should NOT be able to update User 1s data'
);

-- 6. Test Insert for Other User (Should fail RLS check)
-- Note: The valid case requires a pipeline owned by user 2 usually, 
-- but here we test the specific table policy. If the policy says "check(auth.uid() = owner_id)", 
-- trying to insert owner_id='user1_uuid' as user2 should fail.
PREPARE insert_other AS
INSERT INTO camera_intents (id, pipeline_id, space_id, owner_id, suggestion_text, suggestion_index, space_size_category)
VALUES (uuid_generate_v4(), 'pipe1_uuid', 'space1_uuid', 'user1_uuid', 'Malicious', 2, 'large');

SELECT throws_ok(
    'insert_other',
    'new row violates row-level security policy "Users can insert their own camera intents"',
    'User 2 cannot insert data owned by User 1'
);

-- 7. Test Insert Own Data for User 2 (Should succeed if ref constraints allowed)
-- Need to create pipeline for User 2 first to satisfy FK
SET ROLE postgres; -- Switch back to admin to setup User 2 pipeline
INSERT INTO floorplan_pipelines (id, owner_id, name) VALUES ('pipe2_uuid', 'user2_uuid', 'User 2 Pipeline');
INSERT INTO floorplan_pipeline_spaces (id, pipeline_id, name) VALUES ('space2_uuid', 'pipe2_uuid', 'Kitchen');

SET ROLE authenticated;
SET request.jwt.claim.sub = 'user2_uuid';
SET request.jwt.claims = '{"sub": "user2_uuid", "role": "authenticated"}';

SELECT lives_ok(
    $$ INSERT INTO camera_intents (id, pipeline_id, space_id, owner_id, suggestion_text, suggestion_index, space_size_category)
       VALUES (uuid_generate_v4(), 'pipe2_uuid', 'space2_uuid', 'user2_uuid', 'Kitchen Shot', 0, 'large') $$,
    'User 2 can insert their own data'
);

SELECT * FROM finish();
ROLLBACK;
