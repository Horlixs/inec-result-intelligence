create table if not exists public.pipeline_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running',
  discovered integer not null default 0,
  downloaded integer not null default 0,
  extracted integer not null default 0,
  validated integer not null default 0,
  failed integer not null default 0,
  issues jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb
);

alter table public.pipeline_runs enable row level security;

create policy "Public can read pipeline runs"
on public.pipeline_runs for select
using (true);

create index if not exists pipeline_runs_started_at_idx
on public.pipeline_runs(started_at desc);