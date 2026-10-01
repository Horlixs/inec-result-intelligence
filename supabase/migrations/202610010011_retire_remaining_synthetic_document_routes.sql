-- Remove any remaining synthetic SPA document routes regardless of host.
-- Real IReV evidence observed from the API is an image/PDF asset URL, not a
-- /pu/:id/document application route.

with synthetic as (
  select id
  from public.result_sheets
  where source_url like '%/pu/%/document'
)
delete from public.result_processing_jobs
where result_sheet_id in (select id from synthetic);

update public.result_sheets
set
  status = 'skipped',
  last_error = 'IReV polling-unit record did not expose a document asset',
  evidence_status = 'remote_only'
where source_url like '%/pu/%/document'
  and status not in ('verified', 'pending_review');
