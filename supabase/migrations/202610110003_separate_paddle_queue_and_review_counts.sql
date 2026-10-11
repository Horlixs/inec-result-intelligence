-- The PaddleOCR analytics panel needs live queue counts and independent
-- result-sheet review counts. Pending review is not the same as a failed job.
drop function if exists public.get_paddle_processing_status();

create function public.get_paddle_processing_status()
returns table (
  queued_jobs bigint,
  active_jobs bigint,
  stale_processing_jobs bigint,
  processed_today bigint,
  failed_today bigint,
  last_processing_at timestamptz,
  last_completed_at timestamptz,
  last_failed_at timestamptz,
  schedule_enabled boolean,
  interval_minutes integer,
  schedule_last_run_at timestamptz,
  schedule_next_run_at timestamptz,
  failed_result_sheets bigint,
  pending_review_sheets bigint
)
language sql
security definer
set search_path = public
as $$
  with job_counts as (
    select
      count(*) filter (
        where j.status = 'queued' and j.engine = 'paddle'
      )::bigint as queued_jobs,
      count(*) filter (
        where j.status = 'processing'
          and j.engine = 'paddle'
          and j.locked_at >= now() - interval '15 minutes'
      )::bigint as active_jobs,
      count(*) filter (
        where j.status = 'processing'
          and j.engine = 'paddle'
          and (j.locked_at is null or j.locked_at < now() - interval '15 minutes')
      )::bigint as stale_processing_jobs,
      count(*) filter (
        where j.status = 'completed'
          and j.engine = 'paddle'
          and j.completed_at >= date_trunc('day', now())
      )::bigint as processed_today,
      count(*) filter (
        where j.status = 'failed'
          and j.engine = 'paddle'
          and j.updated_at >= date_trunc('day', now())
      )::bigint as failed_today,
      max(j.locked_at) filter (
        where j.status = 'processing' and j.engine = 'paddle'
      ) as last_processing_at,
      max(j.completed_at) filter (
        where j.status = 'completed' and j.engine = 'paddle'
      ) as last_completed_at,
      max(j.updated_at) filter (
        where j.status = 'failed' and j.engine = 'paddle'
      ) as last_failed_at
    from public.result_processing_jobs j
  ),
  sheet_counts as (
    select
      count(*) filter (where rs.status = 'failed')::bigint as failed_result_sheets,
      count(*) filter (where rs.status = 'pending_review')::bigint as pending_review_sheets
    from public.result_sheets rs
  )
  select
    jc.queued_jobs,
    jc.active_jobs,
    jc.stale_processing_jobs,
    jc.processed_today,
    jc.failed_today,
    jc.last_processing_at,
    jc.last_completed_at,
    jc.last_failed_at,
    coalesce(ps.enabled, true),
    coalesce(ps.interval_minutes, 15),
    ps.last_run_at,
    ps.next_run_at,
    sc.failed_result_sheets,
    sc.pending_review_sheets
  from job_counts jc
  cross join sheet_counts sc
  left join public.pipeline_schedule ps
    on ps.name = 'paddle-ocr-processing';
$$;

revoke all on function public.get_paddle_processing_status() from public;
grant execute on function public.get_paddle_processing_status()
  to anon, authenticated, service_role;

notify pgrst, 'reload schema';
