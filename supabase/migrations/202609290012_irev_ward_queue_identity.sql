-- Keep the IReV numeric ward identity available on queue jobs as well as
-- the canonical ward UUID. The sync worker may receive this value from the
-- public IReV hierarchy when constructing a queued job.
alter table public.irev_ward_sync_jobs
  add column if not exists irev_ward_id integer;

create index if not exists idx_irev_ward_sync_jobs_irev_ward
  on public.irev_ward_sync_jobs(election_id, irev_ward_id);
