-- One-time recovery of terminal OCR jobs after the evidence-resolution fix.
-- Reset attempts so the normal 5-minute IReV OCR Drain can process them again.
update public.result_processing_jobs
set
  status = 'queued',
  attempts = 0,
  available_at = now(),
  locked_at = null,
  locked_by = null,
  last_error = null,
  completed_at = null,
  updated_at = now()
where status = 'failed';