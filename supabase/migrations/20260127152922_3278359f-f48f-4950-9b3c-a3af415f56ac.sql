-- Tighten overly-permissive RLS policy flagged by linter
-- Limit notification inserts to backend/service role only.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'notifications'
      AND policyname = 'Service can insert notifications'
  ) THEN
    DROP POLICY "Service can insert notifications" ON public.notifications;
  END IF;
END $$;

CREATE POLICY "Service can insert notifications"
ON public.notifications
FOR INSERT
WITH CHECK (auth.role() = 'service_role');