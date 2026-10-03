-- The current irev-batch worker calls claim_result_processing_job with a
-- third p_engine argument, while the deployed queue RPC has the original
-- two-argument signature. That mismatch makes every sheet-processing claim
-- fail before a job can enter processing.
--
-- Keep the existing two-argument RPC intact and add an explicit compatibility
-- overload for the worker. The worker remains service-role only, and the
-- existing database retry/locking rules stay authoritative.

create or replace function public.claim_result_processing_job(
  p_worker_id text,
  p_max_attempts integer,
  p_engine text
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
  -- The processing engine is recorded on the queued job by enqueueSheets().
  -- The current server-side irev-process function is the active processor, so
  -- the engine argument is intentionally compatibility-only here. Keeping it
  -- out of the claim predicate prevents a stale engine label from making the
  -- queue appear empty.
  return query
  select claimed.job_id, claimed.result_sheet_id, claimed.attempts
  from public.claim_result_processing_job(
    p_worker_id,
    least(greatest(coalesce(p_max_attempts, 3), 1), 3)
  ) as claimed;
end;
$$;

revoke all on function public.claim_result_processing_job(text, integer, text) from public, anon, authenticated;
grant execute on function public.claim_result_processing_job(text, integer, text) to service_role;
