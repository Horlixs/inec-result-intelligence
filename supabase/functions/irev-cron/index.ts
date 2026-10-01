import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const url = Deno.env.get("SUPABASE_URL")!;
const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(url, key);

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

Deno.serve(async request => {
  if (request.method !== "POST") return json({ ok: false, error: "POST required" }, 405);

  // This endpoint is intentionally callable by pg_cron/pg_net without a JWT.
  // The database-side claim below makes the schedule single-consumer: concurrent
  // invocations cannot start multiple refresh/drain runs for the same slot.
  const { data: schedule, error: scheduleError } = await supabase
    .from("pipeline_schedule")
    .select("*")
    .eq("name", "irev-ocr-drain")
    .eq("enabled", true)
    .single();

  if (scheduleError || !schedule) {
    return json({ ok: false, error: scheduleError?.message || "Schedule disabled" }, 409);
  }

  const now = new Date();
  if (new Date(schedule.next_run_at) > now) {
    return json({ ok: true, skipped: true, next_run_at: schedule.next_run_at });
  }

  // Claim the slot atomically. The UPDATE condition prevents two concurrent
  // callers from both deciding that the schedule is due.
  const nextRun = new Date(now.getTime() + Number(schedule.interval_minutes) * 60_000).toISOString();
  const { data: claimed, error: claimError } = await supabase
    .from("pipeline_schedule")
    .update({
      last_run_at: now.toISOString(),
      next_run_at: nextRun,
      updated_at: now.toISOString(),
    })
    .eq("id", schedule.id)
    .eq("enabled", true)
    .lte("next_run_at", now.toISOString())
    .select("id, interval_minutes, next_run_at")
    .maybeSingle();

  if (claimError) return json({ ok: false, error: claimError.message }, 500);
  if (!claimed) return json({ ok: true, skipped: true, reason: "schedule_already_claimed" });

  const response = await fetch(url.replace(/\/$/, "") + "/functions/v1/irev-batch", {
    method: "POST",
    headers: {
      authorization: "Bearer " + key,
      apikey: key,
      "content-type": "application/json",
    },
    body: JSON.stringify({ trigger: "supabase-cron" }),
  });

  const data = await response.json().catch(() => ({}));
  return json({ ...data, scheduler: "supabase-cron", next_run_at: claimed.next_run_at }, response.ok ? 200 : 500);
});
