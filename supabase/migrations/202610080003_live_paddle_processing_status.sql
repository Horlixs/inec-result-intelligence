-- Expose live PaddleOCR queue state to the public analytics dashboard without
-- exposing individual processing-job rows.
create or replace function public.get_paddle_processing_status()
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
  schedule_next_run_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  with counts as (
    select
      count(*) filter (
        where j.status = 'queued'
          and j.engine = 'paddle'
      )::bigint as queued_jobs,
      count(*) filter (
        where j.status = 'processing'
          and j.engine = 'paddle'
          and j.locked_at >= now() - interval '15 minutes'
      )::bigint as active_jobs,
      count(*) filter (
        where j.status = 'processing'
          and j.engine = 'paddle'
          and j.locked_at < now() - interval '15 minutes'
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
        where j.status = 'processing'
          and j.engine = 'paddle'
      ) as last_processing_at,
      max(j.completed_at) filter (
        where j.status = 'completed'
          and j.engine = 'paddle'
      ) as last_completed_at,
      max(j.updated_at) filter (
        where j.status = 'failed'
          and j.engine = 'paddle'
      ) as last_failed_at
    from public.result_processing_jobs j
  )
  select
    counts.queued_jobs,
    counts.active_jobs,
    counts.stale_processing_jobs,
    counts.processed_today,
    counts.failed_today,
    counts.last_processing_at,
    counts.last_completed_at,
    counts.last_failed_at,
    coalesce(s.enabled, true),
    coalesce(s.interval_minutes, 15),
    s.last_run_at,
    s.next_run_at
  from counts
  left join public.pipeline_schedule s
    on s.name = 'paddle-ocr-processing';
$$;

revoke all on function public.get_paddle_processing_status()
  from public;
grant execute on function public.get_paddle_processing_status()
  to anon, authenticated, service_role;

notify pgrst, 'reload schema';

-- Standardize the automatic processing cadence at 15 minutes.
insert into public.pipeline_schedule (name, enabled, interval_minutes, next_run_at)
values ('paddle-ocr-processing', true, 15, now())
on conflict (name) do update
set
  enabled = true,
  interval_minutes = 15,
  updated_at = now();
