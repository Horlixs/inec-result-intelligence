-- Recover Paddle jobs that were exhausted against the retired INEC document host.
-- The worker now prefers the live IReV document backup URL, so these jobs can
-- be safely retried without changing the queue architecture.
update public.result_processing_jobs j
set
  status = 'queued',
  attempts = 0,
  locked_at = null,
  locked_by = null,
  available_at = now(),
  last_error = null,
  updated_at = now()
from public.result_sheets rs
where j.result_sheet_id = rs.id
  and j.engine = 'paddle'
  and j.status = 'failed'
  and j.attempts >= 3
  and lower(coalesce(rs.source_url, '')) like '%docs.inecelectionresults.net%';
