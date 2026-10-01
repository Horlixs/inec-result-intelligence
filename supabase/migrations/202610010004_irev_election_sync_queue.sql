-- Durable election-level queue. Discovery persists every IReV election; this queue decides which
-- elections receive bounded hierarchy refresh work. It survives user inactivity and worker restarts.
create table if not exists public.irev_election_sync_jobs (
  id uuid primary key default gen_random_uuid(),
  election_id uuid not null references public.elections(id) on delete cascade,
  status text not null default 'queued',
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  last_error text,
  last_synced_at timestamptz,
  next_refresh_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(election_id)
);

create index if not exists idx_irev_election_sync_queue
  on public.irev_election_sync_jobs(status, available_at, next_refresh_at, created_at);

alter table public.irev_election_sync_jobs enable row level security;
drop policy if exists "Public can read IReV election sync jobs" on public.irev_election_sync_jobs;
create policy "Public can read IReV election sync jobs"
  on public.irev_election_sync_jobs for select using (true);

create or replace function public.enqueue_irev_election_sync_jobs()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare inserted_count integer := 0;
begin
  insert into public.irev_election_sync_jobs (election_id)
  select e.id
  from public.elections e
  where e.external_id like 'irev:%'
  on conflict (election_id) do nothing;

  get diagnostics inserted_count = row_count;

  -- Completed elections are revisited periodically so newly uploaded PUs/results
  -- are discovered without requiring a manual pipeline run.
  update public.irev_election_sync_jobs
  set status = 'queued', attempts = 0, available_at = now(), locked_at = null,
      locked_by = null, last_error = null, updated_at = now()
  where status = 'completed'
    and next_refresh_at <= now();

  return inserted_count;
end;
$$;

grant execute on function public.enqueue_irev_election_sync_jobs() to service_role;

create or replace function public.claim_irev_election_sync_jobs(
  p_worker_id text,
  p_limit integer default 5,
  p_max_attempts integer default 5
)
returns table (job_id uuid, election_id uuid, attempts integer)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with candidates as (
    select j.id
    from public.irev_election_sync_jobs j
    where (
      (j.status = 'queued' and j.available_at <= now())
      or (j.status = 'processing' and j.locked_at < now() - interval '15 minutes')
    )
    and j.attempts < p_max_attempts
    order by j.available_at asc, j.next_refresh_at asc, j.created_at asc
    for update skip locked
    limit greatest(1, least(p_limit, 20))
  )
  update public.irev_election_sync_jobs j
  set status = 'processing', attempts = j.attempts + 1,
      locked_at = now(), locked_by = p_worker_id, updated_at = now()
  from candidates c
  where j.id = c.id
  returning j.id, j.election_id, j.attempts;
end;
$$;

grant execute on function public.claim_irev_election_sync_jobs(text, integer, integer) to service_role;

create or replace function public.finish_irev_election_sync_job(
  p_job_id uuid,
  p_success boolean,
  p_error text default null,
  p_refresh_minutes integer default 60
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.irev_election_sync_jobs
  set status = case when p_success then 'completed' else 'queued' end,
      locked_at = null,
      locked_by = null,
      last_error = case when p_success then null else left(coalesce(p_error, 'Unknown error'), 2000) end,
      last_synced_at = case when p_success then now() else last_synced_at end,
      next_refresh_at = case when p_success then now() + make_interval(mins => greatest(5, p_refresh_minutes)) else now() + interval '15 minutes' end,
      available_at = case when p_success then now() + make_interval(mins => greatest(5, p_refresh_minutes)) else now() + interval '15 minutes' end,
      updated_at = now()
  where id = p_job_id;
end;
$$;

grant execute on function public.finish_irev_election_sync_job(uuid, boolean, text, integer) to service_role;
