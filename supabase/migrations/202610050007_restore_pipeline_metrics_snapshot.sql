-- Replace the privileged pipeline metrics view with a small, read-only snapshot table.
-- The previous security-invoker view could not read the protected internal queue
-- because result_processing_jobs intentionally has no public SELECT policy.
-- Keep the public dashboard surface limited to aggregate metrics only.

drop view if exists public.pipeline_worker_metrics;

create table if not exists public.pipeline_worker_metrics (
  id boolean primary key default true check (id),
  queued_jobs bigint not null default 0,
  active_jobs bigint not null default 0,
  processed_today bigint not null default 0,
  failed_today bigint not null default 0,
  processed_24h bigint not null default 0,
  processed_7d bigint not null default 0,
  updated_at timestamptz not null default now()
);

insert into public.pipeline_worker_metrics (id)
values (true)
on conflict (id) do nothing;

alter table public.pipeline_worker_metrics enable row level security;

revoke all on table public.pipeline_worker_metrics from anon, authenticated;
grant select on table public.pipeline_worker_metrics to anon, authenticated;

drop policy if exists "Public can read pipeline metrics" on public.pipeline_worker_metrics;
create policy "Public can read pipeline metrics"
  on public.pipeline_worker_metrics
  for select
  to anon, authenticated
  using (true);

grant all on table public.pipeline_worker_metrics to service_role;
