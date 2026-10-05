export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "POST required" });

  const base = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!base || !serviceKey) return res.status(500).json({ ok: false, error: "Supabase service environment is not configured." });

  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  const workerId = `manual-paddle:${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  try {
    const claimResponse = await fetch(`${base}/rest/v1/rpc/claim_result_processing_job`, {
      method: "POST",
      headers,
      body: JSON.stringify({ p_worker_id: workerId, p_max_attempts: 3, p_engine: "paddle" }),
    });
    const claimText = await claimResponse.text();
    let claimBody;
    try { claimBody = claimText ? JSON.parse(claimText) : null; } catch { claimBody = null; }
    if (!claimResponse.ok) throw new Error(claimBody?.message || claimBody?.error || claimText || `Claim failed with HTTP ${claimResponse.status}.`);

    const job = Array.isArray(claimBody) ? claimBody[0] : claimBody;
    if (!job?.job_id || !job?.result_sheet_id) {
      return res.status(200).json({ ok: true, status: "idle", message: "No queued PaddleOCR job is available." });
    }

    const processResponse = await fetch(`${base}/functions/v1/irev-process`, {
      method: "POST",
      headers,
      body: JSON.stringify({ result_sheet_id: String(job.result_sheet_id) }),
    });
    const processText = await processResponse.text();
    let processBody;
    try { processBody = processText ? JSON.parse(processText) : null; } catch { processBody = { error: processText }; }

    const attempts = Number(job.attempts ?? 1);
    const succeeded = processResponse.ok && processBody?.ok === true;
    const update = succeeded
      ? { status: "completed", locked_at: null, locked_by: null, last_error: null, completed_at: new Date().toISOString(), updated_at: new Date().toISOString() }
      : { status: attempts < 3 ? "queued" : "failed", locked_at: null, locked_by: null, last_error: String(processBody?.error || `irev-process HTTP ${processResponse.status}`), available_at: new Date(Date.now() + 15 * 60_000).toISOString(), updated_at: new Date().toISOString() };

    const finishResponse = await fetch(`${base}/rest/v1/result_processing_jobs?id=eq.${encodeURIComponent(job.job_id)}`, {
      method: "PATCH",
      headers: { ...headers, Prefer: "return=minimal" },
      body: JSON.stringify(update),
    });
    if (!finishResponse.ok) {
      const finishText = await finishResponse.text();
      throw new Error(`Queue update failed with HTTP ${finishResponse.status}: ${finishText}`);
    }

    return res.status(succeeded ? 200 : 502).json({
      ok: succeeded,
      status: succeeded ? "completed" : update.status,
      result_sheet_id: job.result_sheet_id,
      job_id: job.job_id,
      attempts,
      processor: "irev-process",
      result: processBody,
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}
