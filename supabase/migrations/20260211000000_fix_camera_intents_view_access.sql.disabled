-- Fix camera_intents_with_spaces view access for PostgREST
-- Ensure the view is accessible to authenticated and anon roles

-- Grant SELECT on the view to authenticated and anon roles
GRANT SELECT ON camera_intents_with_spaces TO authenticated;
GRANT SELECT ON camera_intents_with_spaces TO anon;

-- Ensure USAGE on schema (should already exist, but defensive)
GRANT USAGE ON SCHEMA public TO authenticated, anon;

-- Notify PostgREST to reload schema cache
NOTIFY pgrst, 'reload schema';
