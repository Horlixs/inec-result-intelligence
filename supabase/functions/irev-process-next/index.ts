import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
const CORS = {
  "Access-Control-Allow-Origin": "https://inec-result-intelligence.vercel.app",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "content-type": "application/json; charset=utf-8" },
  });
}

async function run() {
  const requestedAt = new Date().toISOString();

  const { count: activeCount, error: activeError } = await supabase
    .from("result_processing_jobs")
    .select("id", { count: "exact", head: true })
    .eq("status", "processing")
    .eq("engine", "paddle");

  if (activeError) throw activeError;

  if ((activeCount ?? 0) > 0) {
    return {
      ok: true,
      status: "busy",
      message: "A PaddleOCR result is already processing. No second job was started.",
      active_jobs: activeCount ?? 0,
    };
  }

  const { data, error } = await supabase.rpc("claim_result_processing_job", {
    p_worker_id: `manual-button:${crypto.randomUUID()}`,
    p_max_attempts: 3,
    p_engine: "paddle",
  });

  if (error) throw error;

  if (!data?.length) {
    return {
      ok: true,
      status: "idle",
      message: "No queued PaddleOCR job is available.",
    };
  }

  const job = data[0];
  const jobId = job.job_id;

  const { data: runRow, error: runError } = await supabase
    .from("pipeline_runs")
    .insert({
      started_at: requestedAt,
      status: "requested",
      trigger_source: "manual_processing_button",
      metadata: {
        run_type: "processing",
        requested_job_id: jobId,
        trigger_mode: "manual_claim",
      },
    })
    .select("id")
    .single();

  if (runError) throw runError;

  const { error: scheduleError } = await supabase
    .from("pipeline_schedule")
    .update({
      last_run_at: requestedAt,
      next_run_at: new Date(Date.now() + 15 * 60_000).toISOString(),
      updated_at: requestedAt,
    })
    .eq("name", "paddle-ocr-processing");

  if (scheduleError) throw scheduleError;

  return {
    ok: true,
    status: "processing",
    message: "A queued PaddleOCR job was claimed for processing. The existing PaddleOCR worker will complete the claimed job.",
    result_processing_job_id: jobId,
    requested_at: requestedAt,
    pipeline_run_id: runRow.id,
  };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (request.method !== "POST") return json({ ok: false, error: "POST required" }, 405);
  try {
    return json(await run());
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
