-- Restore the queue's stale-processing recovery while keeping the
-- engine-aware claim contract used by the PaddleOCR worker.
--
-- A GitHub Actions run can be terminated by its workflow timeout or runner
-- failure after a job has been marked processing. Such a job must become
-- claimable again instead of permanently blocking the queue.

create or replace function public.claim_result_processing_job(
  p_worker_id text,
  p_max_attempts integer,
  p_engine text
)
returns table(
  job_id uuid,
  result_sheet_id uuid,
  attempts integer,
  engine text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_max_attempts integer := least(greatest(coalesce(p_max_attempts, 3), 1), 3);
begin
  if p_engine not in ('paddle', 'gemini') then
    raise exception 'Invalid processing engine';
  end if;

  -- A worker can disappear after claiming a job. Requeue stale work while it
  -- still has retry budget; make exhausted stale work terminally failed.
  update public.result_processing_jobs j
  set
    status = 'failed',
    locked_at = null,
    locked_by = null,
    updated_at = now(),
    last_error = coalesce(j.last_error, 'Maximum processing attempts reached after a stale worker lock')
  where j.status = 'processing'
    and j.locked_at < now() - interval '15 minutes'
    and j.attempts >= v_max_attempts
    and j.engine = p_engine;

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
    and j.engine = p_engine;

  return query
  with candidate as (
    select j.id
    from public.result_processing_jobs j
    where j.status = 'queued'
      and j.engine = p_engine
      and coalesce(j.attempts, 0) < v_max_attempts
      and (j.available_at is null or j.available_at <= now())
    order by
      j.created_at asc
    for update skip locked
    limit 1
  ),
  claimed as (
    update public.result_processing_jobs j
    set
      status = 'processing',
      attempts = coalesce(j.attempts, 0) + 1,
      locked_at = now(),
      locked_by = p_worker_id,
      updated_at = now()
    from candidate c
    where j.id = c.id
    returning j.id, j.result_sheet_id, j.attempts, j.engine
  )
  select claimed.id, claimed.result_sheet_id, claimed.attempts, claimed.engine
  from claimed;
end;
$$;

revoke all on function public.claim_result_processing_job(text, integer, text)
  from public, anon, authenticated;

grant execute on function public.claim_result_processing_job(text, integer, text)
  to service_role;

-- Repair any already-stuck Paddle jobs immediately when this migration lands.
update public.result_processing_jobs j
set
  status = case when j.attempts >= 3 then 'failed' else 'queued' end,
  locked_at = null,
  locked_by = null,
  available_at = case when j.attempts >= 3 then j.available_at else now() end,
  updated_at = now(),
  last_error = case
    when j.attempts >= 3
      then coalesce(j.last_error, 'Maximum processing attempts reached after a stale worker lock')
    else j.last_error
  end
where j.status = 'processing'
  and j.engine = 'paddle'
  and j.locked_at < now() - interval '15 minutes';
