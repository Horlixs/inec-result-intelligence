-- Fix PaddleOCR queue claiming so only queued, available jobs can be claimed.
-- The previous RPC could return an already-completed job, causing the worker
-- to reprocess the same sheet while leaving the real queue untouched.

drop function if exists public.claim_result_processing_job(text, integer, text);

create function public.claim_result_processing_job(
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
begin
  return query
  with candidate as (
    select j.id
    from public.result_processing_jobs j
    where j.status = 'queued'
      and j.engine = p_engine
      and coalesce(j.attempts, 0) < p_max_attempts
      and (j.available_at is null or j.available_at <= now())
      and (j.locked_at is null or j.locked_at < now() - interval '15 minutes')
    order by j.available_at asc nulls first, j.created_at asc
    for update skip locked
    limit 1
  )
  update public.result_processing_jobs j
  set
    status = 'processing',
    attempts = coalesce(j.attempts, 0) + 1,
    locked_at = now(),
    locked_by = p_worker_id,
    updated_at = now()
  from candidate
  where j.id = candidate.id
  returning j.id, j.result_sheet_id, j.attempts, j.engine;
end;
$$;

grant execute on function public.claim_result_processing_job(text, integer, text)
  to service_role;
