alter table public.pipeline_worker_status
  add column if not exists last_run_at timestamptz;
