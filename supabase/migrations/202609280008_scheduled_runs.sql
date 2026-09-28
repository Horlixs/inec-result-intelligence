alter table public.pipeline_runs
  add column if not exists trigger_source text not null default 'manual';

create index if not exists pipeline_runs_status_idx
  on public.pipeline_runs(status, started_at desc);

create table if not exists public.pipeline_schedule (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  enabled boolean not null default true,
  interval_minutes integer not null default 60 check (interval_minutes between 5 and 10080),
  next_run_at timestamptz not null default now(),
  last_run_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.pipeline_schedule enable row level security;

create policy "Public can read pipeline schedule"
on public.pipeline_schedule for select
using (true);

insert into public.pipeline_schedule (name, enabled, interval_minutes, next_run_at)
values ('irev-refresh', true, 60, now())
on conflict (name) do nothing;