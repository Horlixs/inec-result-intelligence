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

async function cronSecret() {
  const { data, error } = await supabase.rpc("get_irev_cron_secret");
  if (error) throw error;
  return typeof data === "string" ? data : null;
}

async function queueState() {
  const [wardQueued, wardProcessing, sheetQueued, sheetProcessing, discoveredSheets] = await Promise.all([
    supabase.from("irev_ward_sync_jobs").select("id", { count: "exact", head: true }).eq("status", "queued"),
    supabase.from("irev_ward_sync_jobs").select("id", { count: "exact", head: true }).eq("status", "processing"),
    supabase.from("result_processing_jobs").select("id", { count: "exact", head: true }).eq("status", "queued"),
    supabase.from("result_processing_jobs").select("id", { count: "exact", head: true }).eq("status", "processing"),
    supabase.from("result_sheets").select("id", { count: "exact", head: true }).eq("status", "discovered"),
  ]);

  for (const result of [wardQueued, wardProcessing, sheetQueued, sheetProcessing, discoveredSheets]) {
    if (result.error) throw result.error;
  }

  return {
    ward_queued: wardQueued.count ?? 0,
    ward_processing: wardProcessing.count ?? 0,
    sheet_queued: sheetQueued.count ?? 0,
    sheet_processing: sheetProcessing.count ?? 0,
    discovered_sheets: discoveredSheets.count ?? 0,
  };
}

async function invoke(path: string, body: Record<string, unknown>) {
  const response = await fetch(url.replace(/\/$/, "") + path, {
    method: "POST",
    headers: {
      authorization: "Bearer " + key,
      apikey: key,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${path} HTTP ${response.status}: ${data?.error ?? "request failed"}`);
  return data;
}

Deno.serve(async request => {
  if (request.method !== "POST") return json({ error: "POST required" }, 405);

  try {
    const expectedSecret = await cronSecret();
    if (!expectedSecret || request.headers.get("x-cron-secret") !== expectedSecret) {
      return json({ ok: false, error: "Unauthorized scheduler request" }, 401);
    }

    let payload: { force?: boolean; trigger?: string } = {};
    try { payload = await request.json(); } catch {}

    const { data: schedule, error: scheduleError } = await supabase
      .from("pipeline_schedule")
      .select("*")
      .eq("name", "irev-refresh")
      .eq("enabled", true)
      .single();
    if (scheduleError || !schedule) {
      return json({ ok: false, error: scheduleError?.message || "Schedule disabled" }, 409);
    }

    const now = new Date();
    const refreshDue = payload.force || new Date(schedule.next_run_at) <= now;
    let refresh: unknown = null;
    let refreshSkipped = false;

    if (refreshDue) {
      refresh = await invoke("/functions/v1/irev-refresh", {
        trigger: payload.force ? "manual" : "supabase-cron",
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
    } else {
      refreshSkipped = true;
    }

    const before = await queueState();
    const workWaiting = before.ward_queued > 0 || before.sheet_queued > 0 || before.discovered_sheets > 0;
    let batch: unknown = null;

    // The batch worker owns the durable lease. This removes the race where
    // two schedulers both observe zero active rows and start simultaneously.
    // If a manual run has requested priority, the worker returns a clean
    // skipped/busy response and the next 3-minute tick will try again.
    if (workWaiting) {
      batch = await invoke("/functions/v1/irev-batch", {
        trigger: "supabase-cron-watchdog",
        mode: "scheduled",
      });
    }

    const after = await queueState();
    return json({
      ok: true,
      trigger: payload.trigger ?? "unknown",
      refresh_due: refreshDue,
      refresh_skipped: refreshSkipped,
      refresh,
      watchdog: {
        work_waiting: workWaiting,
        worker_active: before.ward_processing > 0 || before.sheet_processing > 0,
        invoked: batch !== null,
        before,
        after,
      },
      next_run_at: schedule.next_run_at,
    });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
