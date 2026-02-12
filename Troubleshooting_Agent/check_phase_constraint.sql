-- Find the check constraint that's blocking camera_intent phases

-- 1. List all check constraints on floorplan_pipelines
SELECT
    conname AS constraint_name,
    pg_get_constraintdef(oid) AS constraint_definition
FROM pg_constraint
WHERE conrelid = 'floorplan_pipelines'::regclass
AND contype = 'c'
ORDER BY conname;

-- 2. Specifically look for valid_whole_apartment_phase constraint
SELECT
    conname AS constraint_name,
    pg_get_constraintdef(oid) AS constraint_definition
FROM pg_constraint
WHERE conrelid = 'floorplan_pipelines'::regclass
AND conname = 'valid_whole_apartment_phase';

-- 3. Show the table definition to see all constraints
\d floorplan_pipelines
