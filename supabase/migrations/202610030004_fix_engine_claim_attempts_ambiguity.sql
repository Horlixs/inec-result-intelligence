-- Fix the engine-aware processing claim function by qualifying every queue column
-- that can collide with RETURNS TABLE output variables.
create or replace function public.claim_result_processing_job(
  p_worker_id text,
  p_max_attempts integer default 5,
  p_engine text default 'paddle'
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
  if p_engine not in ('paddle', 'gemini') then
    raise exception 'Invalid processing engine';
  end if;

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
      and j.attempts < least(greatest(coalesce(p_max_attempts, 5), 1), 5)
      and j.engine = p_engine
    returning j.id
  ),
  candidate as (
    select j.id
    from public.result_processing_jobs j
    where j.status = 'queued'
      and j.available_at <= now()
      and j.attempts < least(greatest(coalesce(p_max_attempts, 5), 1), 5)
      and j.engine = p_engine
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

revoke all on function public.claim_result_processing_job(text, integer, text)
  from public, anon, authenticated;

grant execute on function public.claim_result_processing_job(text, integer, text)
  to service_role;
