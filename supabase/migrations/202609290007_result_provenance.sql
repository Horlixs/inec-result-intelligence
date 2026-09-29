create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

alter table public.result_sheets
  add column if not exists evidence_url text,
  add column if not exists evidence_size_bytes bigint,
  add column if not exists source_fetched_at timestamptz;

create index if not exists result_sheets_evidence_url_idx
  on public.result_sheets(evidence_url)
  where evidence_url is not null;

comment on column public.result_sheets.source_hash is
  'SHA-256 of the exact remote evidence asset fetched for extraction. The bytes are not stored in Supabase.';

comment on column public.result_sheets.evidence_url is
  'Exact remote asset URL that produced source_hash. source_url may instead identify the public result page that links to this asset.';

comment on column public.result_sheets.evidence_size_bytes is
  'Byte length of the exact remote evidence asset fetched transiently for extraction.';

comment on column public.result_sheets.source_fetched_at is
  'Timestamp when the exact remote evidence asset was fetched and hashed.';

