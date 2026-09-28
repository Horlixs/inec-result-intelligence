alter table public.result_sheets
  drop constraint if exists result_sheets_evidence_status_check;

alter table public.result_sheets
  add constraint result_sheets_evidence_status_check
  check (evidence_status in ('stored', 'processing', 'extracted', 'deleted_after_extraction', 'retention_expired', 'remote_only'));

update public.result_sheets
set storage_policy = 'ephemeral',
    evidence_status = 'remote_only',
    storage_path = null
where storage_path is null;

comment on table public.result_sheets is
  'Evidence-first result metadata. The source document may remain remote-only: source_url and source_hash are retained while document bytes are fetched transiently for extraction and are not stored in Supabase Storage.';
