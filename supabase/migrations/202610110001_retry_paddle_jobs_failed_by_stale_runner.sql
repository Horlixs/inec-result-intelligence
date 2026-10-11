-- A runner shutdown during model initialization leaves the claimed queue row
-- stale because finish_job() never gets a chance to run. The recovery RPC marks
-- exhausted stale locks with this exact message. Requeue only those jobs: do not
-- retry terminal failures that contain a real OCR/source error.
with retried as (
  update public.result_processing_jobs j
  set
    status = 'queued',
    attempts = 0,
    available_at = now(),
    locked_at = null,
    locked_by = null,
    last_error = null,
    updated_at = now()
  where j.engine = 'paddle'
    and j.status = 'failed'
    and j.last_error = 'Maximum processing attempts reached after a stale worker lock'
  returning j.result_sheet_id
)
update public.result_sheets rs
set
  status = 'discovered',
  evidence_status = 'remote_only',
  last_error = null
from retried r
where rs.id = r.result_sheet_id;
