-- Prioritize the newest elections when advancing the durable IReV election queue.
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
    left join public.elections e on e.id = j.election_id
    where (
      (j.status = 'queued' and j.available_at <= now())
      or (j.status = 'processing' and j.locked_at < now() - interval '15 minutes')
    )
    and j.attempts < p_max_attempts
    order by
      coalesce(e.election_date, date '1900-01-01') desc,
      j.available_at asc,
      j.next_refresh_at asc,
      j.created_at asc
    for update of j skip locked
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
