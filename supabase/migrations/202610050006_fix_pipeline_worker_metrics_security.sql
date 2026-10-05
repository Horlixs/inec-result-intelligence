create or replace view public.pipeline_worker_metrics
with (security_invoker = true)
as
select
  coalesce((select count(*) from public.result_processing_jobs where status='queued'),0)::bigint as queued_jobs,
  coalesce((select count(*) from public.result_processing_jobs where status='processing'),0)::bigint as active_jobs,
  coalesce((select count(*) from public.result_processing_jobs where status='completed' and completed_at >= date_trunc('day', now())),0)::bigint as processed_today,
  coalesce((select count(*) from public.result_processing_jobs where status='failed' and updated_at >= date_trunc('day', now())),0)::bigint as failed_today,
  coalesce((select count(*) from public.result_processing_jobs where status='completed' and completed_at >= now() - interval '24 hours'),0)::bigint as processed_24h,
  coalesce((select count(*) from public.result_processing_jobs where status='completed' and completed_at >= now() - interval '7 days'),0)::bigint as processed_7d;

grant select on public.pipeline_worker_metrics to anon, authenticated;
notify pgrst, 'reload schema';
