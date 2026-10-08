-- Keep PaddleOCR's automatic processing cadence at 10 minutes while
-- allowing a manual Run processing click to reset the same timer.
insert into public.pipeline_schedule (name, enabled, interval_minutes, next_run_at)
values ('paddle-ocr-processing', true, 10, now())
on conflict (name) do update
set interval_minutes = 10,
    enabled = true,
    updated_at = now();

comment on table public.pipeline_schedule is
  'Scheduler state for IReV refresh and PaddleOCR processing. PaddleOCR is gated to a 10-minute automatic cadence; manual processing requests advance the next run from the click time.';
