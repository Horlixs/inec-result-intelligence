import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST required" }), {
      status: 405,
      headers: { "content-type": "application/json" },
    });
  }

  const { data: schedule, error: scheduleError } = await supabase
    .from("pipeline_schedule")
    .select("*")
    .eq("name", "irev-refresh")
    .eq("enabled", true)
    .single();

  if (scheduleError || !schedule) {
    return new Response(JSON.stringify({ ok: false, error: scheduleError?.message || "Schedule disabled" }), {
      status: 409,
      headers: { "content-type": "application/json" },
    });
  }

  const now = new Date();
  if (new Date(schedule.next_run_at) > now) {
    return new Response(JSON.stringify({ ok: true, skipped: true, next_run_at: schedule.next_run_at }), {
      headers: { "content-type": "application/json" },
    });
  }

  const { data, error } = await supabase.functions.invoke("irev-sync", {
    body: { mode: "scheduled-refresh" },
  });

  const nextRun = new Date(now.getTime() + schedule.interval_minutes * 60_000).toISOString();

  await supabase
    .from("pipeline_schedule")
    .update({
      last_run_at: now.toISOString(),
      next_run_at: nextRun,
      updated_at: now.toISOString(),
    })
    .eq("id", schedule.id);

  return new Response(JSON.stringify({
    ok: !error && data?.ok !== false,
    data,
    error: error?.message || data?.error || null,
    next_run_at: nextRun,
  }), {
    status: error || data?.ok === false ? 500 : 200,
    headers: { "content-type": "application/json" },
  });
});
