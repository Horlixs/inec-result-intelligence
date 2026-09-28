alter table public.result_sheets
  add column if not exists storage_policy text not null default 'durable'
    check (storage_policy in ('durable', 'ephemeral')),
  add column if not exists retention_until timestamptz,
  add column if not exists evidence_status text not null default 'stored'
    check (evidence_status in ('stored', 'processing', 'extracted', 'deleted_after_extraction', 'retention_expired'));

create index if not exists result_sheets_retention_idx
  on public.result_sheets(retention_until)
  where retention_until is not null;

comment on column public.result_sheets.storage_policy is
  'durable keeps the original evidence object; ephemeral permits deletion only after a successful extraction and recorded source hash.';

comment on column public.result_sheets.evidence_status is
  'Tracks whether the original evidence object is still retained. Deletion never removes the source URL or SHA-256 hash.';
