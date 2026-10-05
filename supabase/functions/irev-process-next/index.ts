import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
const MAX_ATTEMPTS = 3;
const WORKER_ID = `manual-paddle:${crypto.randomUUID()}`;
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

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try { return JSON.stringify(error); } catch { return String(error); }
}

async function run() {
  const { data, error } = await supabase.rpc("claim_result_processing_job", {
    p_worker_id: WORKER_ID,
    p_max_attempts: MAX_ATTEMPTS,
    p_engine: "paddle",
  });
  if (error) throw error;

  const job = Array.isArray(data) ? data[0] : data;
  if (!job?.job_id || !job?.result_sheet_id) {
    return { ok: true, status: "idle", message: "No queued PaddleOCR job is available." };
  }

  const response = await fetch(`${SUPABASE_URL}/functions/v1/irev-process`, {
    method: "POST",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ result_sheet_id: String(job.result_sheet_id) }),
  });
  const text = await response.text();
  let result: Record<string, unknown> = {};
  try { result = text ? JSON.parse(text) : {}; } catch { result = { error: text }; }

  const attempts = Number(job.attempts ?? 1);
  const succeeded = response.ok && result.ok === true;
  const update = succeeded
    ? {
        status: "completed",
        locked_at: null,
        locked_by: null,
        last_error: null,
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
    : {
        status: attempts < MAX_ATTEMPTS ? "queued" : "failed",
        locked_at: null,
        locked_by: null,
        last_error: String(result.error || `irev-process HTTP ${response.status}`),
        available_at: new Date(Date.now() + 15 * 60_000).toISOString(),
        updated_at: new Date().toISOString(),
      };

  const { error: finishError } = await supabase
    .from("result_processing_jobs")
    .update(update)
    .eq("id", job.job_id);
  if (finishError) throw finishError;

  return {
    ok: succeeded,
    status: succeeded ? "completed" : update.status,
    result_sheet_id: job.result_sheet_id,
    job_id: job.job_id,
    attempts,
    processor: "irev-process",
    result,
  };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (request.method !== "POST") return json({ ok: false, error: "POST required" }, 405);
  try {
    return json(await run());
  } catch (error) {
    return json({ ok: false, error: errorMessage(error) }, 500);
  }
});
