-- Clear existing camera intents to trigger regeneration
-- Run this in Supabase SQL Editor

DELETE FROM camera_intents WHERE pipeline_id = 'YOUR_PIPELINE_ID_HERE';

-- Replace YOUR_PIPELINE_ID_HERE with your actual pipeline ID
-- You can find it in the URL or from the floorplan_pipelines table
