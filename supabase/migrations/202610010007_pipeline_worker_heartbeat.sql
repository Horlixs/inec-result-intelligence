-- Persistent remote worker heartbeat so the application can show whether the autonomous
-- IReV pipeline is actually alive instead of relying on GitHub Actions history.
create table if not exists public.pipeline_worker_status (
  id text primary key,
  worker_name text not null,
  status text not null default 'idle',
  heartbeat_at timestamptz not null default now(),
  last_worker_started timestamptz,
  last_worker_finished timestamptz,
  last_successful_batch timestamptz,
  last_error text,
  jobs_processed_last_run integer not null default 0,
  jobs_failed_last_run integer not null default 0,
  queue_remaining integer not null default 0,
  active_jobs integer not null default 0,
  run_id text,
  updated_at timestamptz not null default now()
);

alter table public.pipeline_worker_status enable row level security;
drop policy if exists "Public can read pipeline worker status" on public.pipeline_worker_status;
create policy "Public can read pipeline worker status"
  on public.pipeline_worker_status for select using (true);

grant select on public.pipeline_worker_status to anon, authenticated;

insert into public.pipeline_worker_status (id, worker_name, status)
values ('irev-ocr-drain', 'IReV OCR Drain', 'idle')
on conflict (id) do nothing;
