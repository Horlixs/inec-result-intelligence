create table if not exists public.irev_ward_sync_jobs (
  id uuid primary key default gen_random_uuid(),
  election_id uuid not null references public.elections(id) on delete cascade,
  ward_id uuid not null references public.wards(id) on delete cascade,
  status text not null default 'queued',
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  last_error text,
  discovered_sheets integer not null default 0,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(election_id, ward_id)
);

create index if not exists idx_irev_ward_sync_jobs_queue
  on public.irev_ward_sync_jobs(status, available_at, created_at);

alter table public.irev_ward_sync_jobs enable row level security;
create policy "Public can read IReV ward sync jobs"
  on public.irev_ward_sync_jobs for select using (true);

create or replace function public.claim_irev_ward_sync_job(
  p_worker_id text,
  p_max_attempts integer default 5
)
returns table (
  job_id uuid,
  election_id uuid,
  ward_id uuid,
  attempts integer
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with candidate as (
    select j.id
    from public.irev_ward_sync_jobs j
    where (
      (j.status = 'queued' and j.available_at <= now())
      or (j.status = 'processing' and j.locked_at < now() - interval '15 minutes')
    )
    and j.attempts < p_max_attempts
    order by j.available_at asc, j.created_at asc
    for update skip locked
    limit 1
  )
  update public.irev_ward_sync_jobs j
  set
    status = 'processing',
    attempts = j.attempts + 1,
    locked_at = now(),
    locked_by = p_worker_id,
    updated_at = now()
  from candidate
  where j.id = candidate.id
  returning j.id, j.election_id, j.ward_id, j.attempts;
end;
$$;

grant execute on function public.claim_irev_ward_sync_job(text, integer) to service_role;
