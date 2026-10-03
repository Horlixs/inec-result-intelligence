-- Route result-sheet jobs to an explicit OCR engine. New jobs use PaddleOCR;
-- the existing Gemini path remains available for explicit engine='gemini' jobs.
alter table public.result_processing_jobs
  add column if not exists engine text not null default 'paddle'
  check (engine in ('paddle','gemini'));

create index if not exists result_processing_jobs_engine_ready_idx
  on public.result_processing_jobs(engine, status, available_at, created_at);

drop function if exists public.claim_result_processing_job(text, integer);

create function public.claim_result_processing_job(
  p_worker_id text,
  p_max_attempts integer default 5,
  p_engine text default 'paddle'
)
returns table (job_id uuid, result_sheet_id uuid, attempts integer)
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_engine not in ('paddle','gemini') then
    raise exception 'Invalid processing engine';
  end if;

  return query
  with stale as (
    update public.result_processing_jobs
    set status='queued', locked_at=null, locked_by=null,
        updated_at=now(), available_at=now()
    where status='processing'
      and locked_at < now() - interval '15 minutes'
      and attempts < p_max_attempts
      and engine = p_engine
    returning id
  ), candidate as (
    select id
    from public.result_processing_jobs
    where status='queued'
      and available_at <= now()
      and attempts < p_max_attempts
      and engine = p_engine
    order by created_at
    for update skip locked
    limit 1
  ), claimed as (
    update public.result_processing_jobs j
    set status='processing', attempts=j.attempts+1,
        locked_at=now(), locked_by=p_worker_id, updated_at=now()
    from candidate c
    where j.id=c.id
    returning j.id,j.result_sheet_id,j.attempts
  )
  select id,result_sheet_id,attempts from claimed;
end;
$$;

revoke all on function public.claim_result_processing_job(text,integer,text) from public,anon,authenticated;
grant execute on function public.claim_result_processing_job(text,integer,text) to service_role;
