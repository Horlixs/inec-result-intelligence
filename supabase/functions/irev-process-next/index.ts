import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
const GITHUB_DISPATCH_TOKEN = Deno.env.get("GITHUB_DISPATCH_TOKEN")?.trim() || null;
const GITHUB_OWNER = "Horlixs";
const GITHUB_REPO = "inec-result-intelligence";
const GITHUB_WORKFLOW = "paddle-ocr-worker.yml";
const GITHUB_REF = "main";

async function dispatchPaddleWorker() {
  if (!GITHUB_DISPATCH_TOKEN) {
    throw new Error("PaddleOCR worker dispatch is not configured: GITHUB_DISPATCH_TOKEN is missing.");
  }

  const response = await fetch(
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/${GITHUB_WORKFLOW}/dispatches`,
    {
      method: "POST",
      headers: {
        "Accept": "application/vnd.github+json",
        "Authorization": `Bearer ${GITHUB_DISPATCH_TOKEN}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
        "User-Agent": "INEC-Result-Intelligence/1.0",
      },
      body: JSON.stringify({ ref: GITHUB_REF }),
    },
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub worker dispatch failed (HTTP ${response.status}): ${body.slice(0, 500)}`);
  }
}

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
  const { data, error } = await supabase
    .from("result_processing_jobs")
    .select("id")
    .eq("status", "queued")
    .eq("engine", "paddle")
    .order("available_at", { ascending: true })
    .limit(1);

  if (error) throw error;

  const requestedAt = new Date().toISOString();

  if (!data?.length) {
    return {
      ok: true,
      status: "idle",
      message: "No queued PaddleOCR job is available.",
    };
  }

  const jobId = data[0].id;
  const { data: runRow, error: runError } = await supabase
    .from("pipeline_runs")
    .insert({
      started_at: requestedAt,
      status: "requested",
      trigger_source: "manual_processing_button",
      metadata: {
        run_type: "processing",
        requested_job_id: jobId,
      },
    })
    .select("id")
    .single();

  if (runError) throw runError;

  const { error: releaseError } = await supabase
    .from("result_processing_jobs")
    .update({
      available_at: requestedAt,
      locked_at: null,
      locked_by: null,
      updated_at: requestedAt,
    })
    .eq("id", jobId)
    .eq("status", "queued")
    .eq("engine", "paddle");

  if (releaseError) throw releaseError;

  return {
    ok: true,
    status: "scheduled",
    message: "Processing requested. The queued PaddleOCR job has been released for the existing worker to claim.",
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
