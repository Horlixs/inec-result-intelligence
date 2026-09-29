import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const url = Deno.env.get("SUPABASE_URL")!;
const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(url, key);

const MAX_JOBS_PER_REFRESH = 20;
const MAX_ATTEMPTS = 5;
const WORKER_ID = `irev-refresh:${crypto.randomUUID()}`;

async function invoke(name: string, body: unknown) {
  const response = await fetch(url.replace(/\/$/, "") + "/functions/v1/" + name, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer " + key,
    },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok === false) {
    throw new Error(data?.error || name + " failed with HTTP " + response.status);
  }
  return data;
}

async function enqueueDiscoveredSheets() {
  const { data: sheets, error } = await supabase
    .from("result_sheets")
    .select("id")
    .eq("status", "discovered")
    .order("discovered_at", { ascending: true })
    .limit(100);

  if (error) throw error;
  if (!sheets?.length) return 0;

  const { error: enqueueError } = await supabase
    .from("result_processing_jobs")
    .upsert(
      sheets.map(sheet => ({ result_sheet_id: sheet.id, status: "queued" })),
      { onConflict: "result_sheet_id", ignoreDuplicates: true },
    );

  if (enqueueError) throw enqueueError;
  return sheets.length;
}

async function claimJob() {
  const { data, error } = await supabase.rpc("claim_result_processing_job", {
    p_worker_id: WORKER_ID,
    p_max_attempts: MAX_ATTEMPTS,
  });

  if (error) throw error;
  return data?.[0] ?? null;
}

async function finishJob(jobId: string, attempts: number, success: boolean, errorMessage?: string) {
  const now = new Date();
  const retryable = !success && attempts < MAX_ATTEMPTS;

  const update = success
    ? {
        status: "completed",
        locked_at: null,
        locked_by: null,
        last_error: null,
        completed_at: now.toISOString(),
        updated_at: now.toISOString(),
      }
    : {
        status: retryable ? "queued" : "failed",
        locked_at: null,
        locked_by: null,
        last_error: errorMessage ?? "Unknown processing error",
        available_at: new Date(now.getTime() + 15 * 60_000).toISOString(),
        updated_at: now.toISOString(),
      };

  const { error } = await supabase
    .from("result_processing_jobs")
    .update(update)
    .eq("id", jobId);

  if (error) throw error;
}

Deno.serve(async request => {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST required" }), { status: 405 });
  }

  const started = new Date().toISOString();

  try {
    const discovery = await invoke("irev-sync", { mode: "scheduled-refresh" });
    const queued = await enqueueDiscoveredSheets();

    let processed = 0;
    let failed = 0;

    for (let i = 0; i < MAX_JOBS_PER_REFRESH; i++) {
      const job = await claimJob();
      if (!job) break;

      try {
        const result = await invoke("irev-process", {
          result_sheet_id: job.result_sheet_id,
        });

        await finishJob(job.job_id, job.attempts, Boolean(result?.ok), result?.error);
        if (result?.ok) processed++;
        else failed++;
      } catch (error) {
        failed++;
        try {
          await finishJob(
            job.job_id,
            job.attempts,
            false,
            error instanceof Error ? error.message : String(error),
          );
        } catch {
          // Preserve the original processing failure if queue bookkeeping also fails.
        }
      }
    }

    const { count: remaining } = await supabase
      .from("result_processing_jobs")
      .select("id", { count: "exact", head: true })
      .in("status", ["queued", "processing"]);

    await supabase.from("pipeline_runs").insert({
      started_at: started,
      finished_at: new Date().toISOString(),
      status: failed ? "completed_with_errors" : "completed",
      trigger_source: "scheduled",
      discovered: discovery?.discovered ?? 0,
      downloaded: processed,
      extracted: processed,
      failed,
      metadata: {
        mode: "scheduled-refresh",
        sheets_enqueued: queued,
        jobs_processed: processed,
        jobs_failed: failed,
        jobs_remaining: remaining ?? 0,
        max_jobs_per_refresh: MAX_JOBS_PER_REFRESH,
      },
    });

    return new Response(JSON.stringify({
      ok: true,
      discovered: discovery?.discovered ?? 0,
      queued,
      processed,
      failed,
      remaining: remaining ?? 0,
    }), {
      headers: { "content-type": "application/json" },
    });
  } catch (error) {
    await supabase.from("pipeline_runs").insert({
      started_at: started,
      finished_at: new Date().toISOString(),
      status: "failed",
      trigger_source: "scheduled",
      failed: 1,
      issues: [{ message: error instanceof Error ? error.message : String(error) }],
    });

    return new Response(JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
});
