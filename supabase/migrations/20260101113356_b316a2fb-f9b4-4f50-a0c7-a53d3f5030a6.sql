-- Render job logs for "terminal"-style debugging
CREATE TABLE public.render_job_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  job_id uuid NOT NULL REFERENCES public.render_jobs(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL,
  level text NOT NULL DEFAULT 'info',
  message text NOT NULL
);

CREATE INDEX idx_render_job_logs_job_id_created_at
  ON public.render_job_logs (job_id, created_at DESC);

ALTER TABLE public.render_job_logs ENABLE ROW LEVEL SECURITY;

-- RLS: only the job owner can access their logs
CREATE POLICY "Render job logs: select own"
  ON public.render_job_logs
  FOR SELECT
  USING (auth.uid() = owner_id);

CREATE POLICY "Render job logs: insert own"
  ON public.render_job_logs
  FOR INSERT
  WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Render job logs: delete own"
  ON public.render_job_logs
  FOR DELETE
  USING (auth.uid() = owner_id);

-- Enable realtime so the UI terminal can stream updates
ALTER PUBLICATION supabase_realtime ADD TABLE public.render_job_logs;