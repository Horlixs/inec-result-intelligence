-- Safety cap for result-sheet processing retries.
-- The worker may request a larger limit, but the database enforces a hard ceiling of 3 attempts.
create or replace function public.claim_result_processing_job(
  p_worker_id text,
  p_max_attempts integer default 3
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
declare
  v_max_attempts integer := least(greatest(coalesce(p_max_attempts, 3), 1), 3);
begin
  -- Jobs that have exhausted the safety cap are terminal failures and must not
  -- remain indefinitely in the queued state.
  update public.result_processing_jobs j
  set
    status = 'failed',
    locked_at = null,
    locked_by = null,
    updated_at = now(),
    last_error = coalesce(j.last_error, 'Maximum automatic processing attempts reached')
  where j.status in ('queued', 'processing')
    and j.attempts >= v_max_attempts
    and (j.status <> 'processing' or j.locked_at < now() - interval '15 minutes');

  return query
  with stale as (
    update public.result_processing_jobs j
    set
      status = 'queued',
      locked_at = null,
      locked_by = null,
      updated_at = now(),
      available_at = now()
    where j.status = 'processing'
      and j.locked_at < now() - interval '15 minutes'
      and j.attempts < v_max_attempts
    returning j.id
  ),
  candidate as (
    select j.id
    from public.result_processing_jobs j
    where j.status = 'queued'
      and j.available_at <= now()
      and j.attempts < v_max_attempts
    order by j.created_at
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
  select claimed.id, claimed.result_sheet_id, claimed.attempts
  from claimed;
end;
$$;

revoke all on function public.claim_result_processing_job(text, integer) from public, anon, authenticated;
grant execute on function public.claim_result_processing_job(text, integer) to service_role;
