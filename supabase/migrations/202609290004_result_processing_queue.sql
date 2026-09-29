create table if not exists public.result_processing_jobs (
  id uuid primary key default gen_random_uuid(),
  result_sheet_id uuid not null references public.result_sheets(id) on delete cascade,
  status text not null default 'queued'
    check (status in ('queued','processing','completed','failed')),
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique(result_sheet_id)
);

create index if not exists result_processing_jobs_ready_idx
  on public.result_processing_jobs(status, available_at, created_at);

create index if not exists result_processing_jobs_locked_idx
  on public.result_processing_jobs(status, locked_at)
  where status = 'processing';

alter table public.result_processing_jobs enable row level security;

create or replace function public.claim_result_processing_job(
  p_worker_id text,
  p_max_attempts integer default 5
)
returns table (
  job_id uuid,
  result_sheet_id uuid,
  attempts integer
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with stale as (
    update public.result_processing_jobs
    set
      status = 'queued',
      locked_at = null,
      locked_by = null,
      updated_at = now(),
      available_at = now()
    where status = 'processing'
      and locked_at < now() - interval '15 minutes'
      and attempts < p_max_attempts
    returning id
  ),
  candidate as (
    select id
    from public.result_processing_jobs
    where status = 'queued'
      and available_at <= now()
      and attempts < p_max_attempts
    order by created_at
    for update skip locked
    limit 1
  ),
  claimed as (
    update public.result_processing_jobs j
    set
      status = 'processing',
      attempts = j.attempts + 1,
      locked_at = now(),
      locked_by = p_worker_id,
      updated_at = now()
    from candidate c
    where j.id = c.id
    returning j.id, j.result_sheet_id, j.attempts
  )
  select id, result_sheet_id, attempts
  from claimed;
end;
$$;

revoke all on function public.claim_result_processing_job(text, integer) from public, anon, authenticated;
grant execute on function public.claim_result_processing_job(text, integer) to service_role;

comment on table public.result_processing_jobs is
  'Durable internal work queue for transient IReV result-sheet processing. Evidence remains remote-only; this table stores job state, not document bytes.';
