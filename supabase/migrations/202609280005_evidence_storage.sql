insert into storage.buckets (id, name, public)
values ('result-evidence', 'result-evidence', false)
on conflict (id) do nothing;

create policy "service role manages result evidence"
on storage.objects for all
using (bucket_id = 'result-evidence' and auth.role() = 'service_role')
with check (bucket_id = 'result-evidence' and auth.role() = 'service_role');

alter table public.result_sheets
  add column if not exists processing_attempts integer not null default 0,
  add column if not exists last_error text,
  add column if not exists processed_at timestamptz;

create index if not exists result_sheets_processing_idx
  on public.result_sheets(status, discovered_at);