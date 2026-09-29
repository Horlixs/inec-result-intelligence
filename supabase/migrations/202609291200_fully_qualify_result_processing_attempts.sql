-- Fully qualify result-processing queue columns that share names with RETURNS TABLE output parameters.
-- PostgreSQL treats RETURNS TABLE columns as output variables, so every reference
-- to the table's attempts column must be explicitly qualified.

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
    update public.result_processing_jobs j
    set
      status = 'queued',
      locked_at = null,
      locked_by = null,
      updated_at = now(),
      available_at = now()
    where j.status = 'processing'
      and j.locked_at < now() - interval '15 minutes'
      and j.attempts < p_max_attempts
    returning j.id
  ),
  candidate as (
    select j.id
    from public.result_processing_jobs j
    where j.status = 'queued'
      and j.available_at <= now()
      and j.attempts < p_max_attempts
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
