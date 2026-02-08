-- Fix overly permissive RLS policies for service_role
-- Replace "true" conditions with proper role checks

-- Drop the overly permissive service role policies
DROP POLICY IF EXISTS "Service role can manage all pipeline jobs" ON public.pipeline_jobs;
DROP POLICY IF EXISTS "Service role can manage all pipeline artifacts" ON public.pipeline_artifacts;
DROP POLICY IF EXISTS "Service role can manage all pipeline decisions" ON public.pipeline_decisions;

-- The service role automatically bypasses RLS, so we don't need explicit policies
-- The user-level policies are sufficient for proper access control