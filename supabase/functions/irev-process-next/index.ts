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
  // PaddleOCR runs in the existing GitHub Actions worker. Do not claim a
  // queue row here: doing so would route a Paddle job into the legacy
  // irev-process Edge Function and can permanently fail it on its timeout.
  const { data, error } = await supabase
    .from("result_processing_jobs")
    .select("id")
    .eq("status", "queued")
    .eq("engine", "paddle")
    .order("available_at", { ascending: true })
    .limit(1);

  if (error) throw error;

  if (!data?.length) {
    return {
      ok: true,
      status: "idle",
      message: "No queued PaddleOCR job is available.",
    };
  }

  return {
    ok: true,
    status: "scheduled",
    message: "PaddleOCR processing is handled by the existing worker. The queued job was left untouched for the worker to claim.",
    result_processing_job_id: data[0].id,
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
