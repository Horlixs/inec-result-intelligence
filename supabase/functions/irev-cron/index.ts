import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const url = Deno.env.get("SUPABASE_URL")!;
const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(url, key);

Deno.serve(async request => {
  if (request.method !== "POST") return new Response(JSON.stringify({ error: "POST required" }), { status: 405 });
  const configuredSecret = Deno.env.get("IREV_CRON_SECRET");
  if (configuredSecret && request.headers.get("x-cron-secret") !== configuredSecret) {
    return new Response(JSON.stringify({ ok: false, error: "Unauthorized scheduler request" }), { status: 401 });
  }
  const { data: schedule, error } = await supabase.from("pipeline_schedule").select("*").eq("name", "irev-refresh").eq("enabled", true).single();
  if (error || !schedule) return new Response(JSON.stringify({ ok: false, error: error?.message || "Schedule disabled" }), { status: 409 });
  const now = new Date();
  if (new Date(schedule.next_run_at) > now) return new Response(JSON.stringify({ ok: true, skipped: true, next_run_at: schedule.next_run_at }));
  const response = await fetch(url.replace(/\/$/, "") + "/functions/v1/irev-refresh", {
    method: "POST",
    headers: { authorization: "Bearer " + key, "content-type": "application/json" },
    body: JSON.stringify({ trigger: "cron" }),
  });
  const data = await response.json().catch(() => ({}));
  const nextRun = new Date(now.getTime() + schedule.interval_minutes * 60_000).toISOString();
  await supabase.from("pipeline_schedule").update({ last_run_at: now.toISOString(), next_run_at: nextRun, updated_at: now.toISOString() }).eq("id", schedule.id);
  return new Response(JSON.stringify({ ...data, next_run_at: nextRun }), { status: response.ok ? 200 : 500, headers: { "content-type": "application/json" } });
});