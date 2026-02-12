-- Step 1: Delete ALL old camera intent suggestions
-- This will force regeneration with the NEW AI logic

DELETE FROM camera_intents;

-- Step 2: Verify deletion
SELECT COUNT(*) as remaining_suggestions FROM camera_intents;
-- Should return: 0

-- Step 3: Check which pipelines will need regeneration
SELECT
  id,
  created_at,
  whole_apartment_phase
FROM floorplan_pipelines
WHERE whole_apartment_phase IN ('camera_intent_pending', 'camera_intent_confirmed')
ORDER BY created_at DESC
LIMIT 5;

-- After running this:
-- 1. Go to your pipeline in the browser
-- 2. Click "Define Camera Intent" button
-- 3. Wait 15-30 seconds (NEW AI generates more suggestions)
-- 4. You should see:
--    - Large spaces: 4-8 suggestions
--    - Normal spaces: 2-4 suggestions
--    - Suggestions mention "opposite corner", "side angle", etc.
