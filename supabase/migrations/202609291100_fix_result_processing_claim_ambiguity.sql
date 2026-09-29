-- Fix PL/pgSQL output-column ambiguity in the result-processing queue claim function.
-- The unqualified "attempts" in the final SELECT conflicted with the
-- function's OUT parameter of the same name (SQLSTATE 42702).

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
  select claimed.id, claimed.result_sheet_id, claimed.attempts
  from claimed;
end;
$$;

revoke all on function public.claim_result_processing_job(text, integer) from public, anon, authenticated;
grant execute on function public.claim_result_processing_job(text, integer) to service_role;
