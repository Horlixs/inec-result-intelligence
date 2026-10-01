-- Revisit the three IReV elections that were marked completed before the
-- canonical-ward fallback was deployed. They returned valid /lga data but
-- could not map it into the imported INEC geography, so no ward jobs were queued.
update public.irev_election_sync_jobs j
set
  status = 'queued',
  attempts = 0,
  available_at = now(),
  locked_at = null,
  locked_by = null,
  last_error = null,
  updated_at = now()
from public.elections e
where e.id = j.election_id
  and e.external_id in (
    'irev:6407c78e685b6f6c3539598d',
    'irev:6407d831ce35006e9214acfc',
    'irev:6407d82fce35006e9214ac51'
  );
