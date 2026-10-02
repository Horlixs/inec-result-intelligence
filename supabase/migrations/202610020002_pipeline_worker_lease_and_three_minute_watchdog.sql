-- Reliable single-runner lease and 3-minute watchdog cadence.
-- Scheduler and manual invocations share the same lease so they can never
-- process the same queue concurrently. Manual requests get priority over
-- subsequent scheduler wake-ups until the manual run acquires/releases it.

create table if not exists public.pipeline_worker_lease (
  id boolean primary key default true check (id),
  owner_id text,
  mode text,
  acquired_at timestamptz,
  expires_at timestamptz,
  manual_requested_at timestamptz,
  updated_at timestamptz not null default now()
);

insert into public.pipeline_worker_lease (id)
values (true)
on conflict (id) do nothing;

create or replace function public.acquire_pipeline_worker_lease(
  p_worker_id text,
  p_mode text default 'scheduled'
)
returns table (
  acquired boolean,
  busy boolean,
  manual_requested boolean,
  owner_id text,
  mode text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_owner text;
  current_mode text;
  current_expires timestamptz;
  manual_at timestamptz;
  can_take boolean;
begin
  if p_mode = 'manual' then
    update public.pipeline_worker_lease
    set manual_requested_at = now(), updated_at = now()
    where id = true;
  end if;

  select l.owner_id, l.mode, l.expires_at, l.manual_requested_at
    into current_owner, current_mode, current_expires, manual_at
  from public.pipeline_worker_lease l
  where l.id = true
  for update;

  -- A stale manual request must not permanently stop automation.
  if manual_at is not null and manual_at < now() - interval '15 minutes' then
    manual_at := null;
    update public.pipeline_worker_lease
    set manual_requested_at = null, updated_at = now()
    where id = true;
  end if;

  can_take :=
    current_owner is null
    or current_expires is null
    or current_expires <= now()
    or current_owner = p_worker_id;

  -- Scheduler runs yield to a live manual request.
  if p_mode <> 'manual' and manual_at is not null then
    can_take := false;
  end if;

  if can_take then
    update public.pipeline_worker_lease
    set
      owner_id = p_worker_id,
      mode = p_mode,
      acquired_at = now(),
      expires_at = now() + interval '4 minutes',
      manual_requested_at = case when p_mode = 'manual' then null else manual_at end,
      updated_at = now()
    where id = true;

    return query
    select true, false, false, p_worker_id, p_mode;
    return;
  end if;

  return query
  select
    false,
    true,
    manual_at is not null,
    current_owner,
    current_mode;
end;
$$;

revoke all on function public.acquire_pipeline_worker_lease(text,text) from public, anon, authenticated;
grant execute on function public.acquire_pipeline_worker_lease(text,text) to service_role;

create or replace function public.release_pipeline_worker_lease(p_worker_id text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.pipeline_worker_lease
  set
    owner_id = null,
    mode = null,
    acquired_at = null,
    expires_at = null,
    updated_at = now()
  where id = true
    and owner_id = p_worker_id;

  return found;
end;
$$;

revoke all on function public.release_pipeline_worker_lease(text) from public, anon, authenticated;
grant execute on function public.release_pipeline_worker_lease(text) to service_role;

-- The result-processing watchdog runs every 3 minutes. Keep the existing
-- refresh schedule at its database-enforced minimum of 5 minutes; the
-- watchdog independently drains queued work every 3 minutes.
update public.pipeline_schedule
set
  interval_minutes = 5,
  next_run_at = least(next_run_at, now()),
  updated_at = now()
where name = 'irev-refresh';

-- Re-schedule the existing watchdog job. Supabase Cron uses the job name as
-- the stable identifier; scheduling the same name updates/replaces that job.
select cron.schedule(
  'irev-pipeline-watchdog',
  '*/3 * * * *',
  $cron$
    with cfg as (
      select
        max(decrypted_secret) filter (where name = 'project_url') as project_url,
        max(decrypted_secret) filter (where name = 'pipeline_cron_key') as pipeline_key,
        max(decrypted_secret) filter (where name = 'irev_cron_secret') as cron_secret
      from vault.decrypted_secrets
      where name in ('project_url', 'pipeline_cron_key', 'irev_cron_secret')
    )
    select net.http_post(
      url := cfg.project_url || '/functions/v1/irev-cron',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', cfg.pipeline_key,
        'x-cron-secret', cfg.cron_secret
      ),
      body := jsonb_build_object('trigger', 'supabase-cron', 'time', now()),
      timeout_milliseconds := 10000
    )
    from cfg
    where cfg.project_url is not null
      and cfg.pipeline_key is not null
      and cfg.cron_secret is not null;
  $cron$
);
