-- Retire synthetic IReV SPA document routes created by earlier discovery logic.
-- A /elections/:election/pu/:pu/document path is a client route, not evidence.
-- Real evidence must come from the IReV API document asset.

with synthetic as (
  select id
  from public.result_sheets
  where source_url like 'https://inecelectionresults.ng/elections/%/pu/%/document'
    and status in ('discovered', 'failed')
)
delete from public.result_processing_jobs
where result_sheet_id in (select id from synthetic);

update public.result_sheets
set
  status = 'skipped',
  last_error = 'IReV polling-unit record did not expose a document asset',
  evidence_status = 'remote_only'
where source_url like 'https://inecelectionresults.ng/elections/%/pu/%/document'
  and status in ('discovered', 'failed');
