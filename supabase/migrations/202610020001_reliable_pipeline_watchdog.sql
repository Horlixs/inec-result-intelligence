-- Move pipeline liveness to Supabase Cron so worker wake-ups do not depend on
-- GitHub Actions schedule delivery. GitHub remains a secondary trigger.

create extension if not exists pg_cron;
create extension if not exists pg_net;
create extension if not exists supabase_vault with schema vault;

-- The scheduler secret is generated once and never stored in source control.
do $$
declare
  existing_id uuid;
begin
  select id into existing_id
  from vault.decrypted_secrets
  where name = 'irev_cron_secret'
  limit 1;

  if existing_id is null then
    perform vault.create_secret(
      encode(gen_random_bytes(32), 'hex'),
      'irev_cron_secret',
      'Private authentication secret for the IReV pipeline watchdog cron.'
    );
  end if;
end
$$;

create or replace function public.get_irev_cron_secret()
returns text
language sql
security definer
set search_path = public, vault
as $$
  select decrypted_secret
  from vault.decrypted_secrets
  where name = 'irev_cron_secret'
  limit 1;
$$;

revoke all on function public.get_irev_cron_secret() from public, anon, authenticated;
grant execute on function public.get_irev_cron_secret() to service_role;

update public.pipeline_schedule
set
  interval_minutes = 5,
  next_run_at = least(next_run_at, now()),
  updated_at = now()
where name = 'irev-refresh';

select cron.schedule(
  'irev-pipeline-watchdog',
  '*/5 * * * *',
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
