// Bounded, resumable worker: never tries to drain the entire IReV queue in one invocation.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
const IREV_BASE = "https://dolphin-app-sleqh.ondigitalocean.app/api/v1";
const IREV_KEY = Deno.env.get("IREV_KEY")?.trim() || null;
const MAX_WARD_JOBS = 5;
const CONCURRENT_SHEET_JOBS = 3;
const MAX_SHEET_BATCHES = 3;
const MAX_SHEET_JOBS = CONCURRENT_SHEET_JOBS * MAX_SHEET_BATCHES;
const MAX_ATTEMPTS = 3;
const DEADLINE_MS = 110_000;
const WORKER_ID = `irev-batch:${crypto.randomUUID()}`;
const CORS = { "Access-Control-Allow-Origin": "https://inec-result-intelligence.vercel.app", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Max-Age": "86400" };
function json(data: unknown, status = 200) { return new Response(JSON.stringify(data), { status, headers: { ...CORS, "content-type": "application/json; charset=utf-8" } }); }
function rows(payload: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(payload)) return payload.filter(x => !!x && typeof x === "object") as Array<Record<string, unknown>>;
  if (!payload || typeof payload !== "object") return [];
  const obj = payload as Record<string, unknown>;
  for (const key of ["data", "polling_units", "pus", "results", "items"]) { const value = obj[key]; if (Array.isArray(value)) return value.filter(x => !!x && typeof x === "object") as Array<Record<string, unknown>>; if (value && typeof value === "object") { const nested = rows(value); if (nested.length) return nested; } }
  return [];
}
function objectId(value: unknown) { const id = String(value ?? "").trim(); return /^[a-f0-9]{24}$/i.test(id) ? id : null; }
function errorMessage(error: unknown) { if (error instanceof Error) return error.message; if (typeof error === "string") return error; try { return JSON.stringify(error); } catch { return String(error); } }
function documentUrl(row: Record<string, unknown>) {
  const pu = row.polling_unit && typeof row.polling_unit === "object"
    ? row.polling_unit as Record<string, unknown>
    : null;

  const resolve = (value: unknown): string | null => {
    if (typeof value !== "string" || !value.trim()) return null;
    try {
      const u = new URL(value.trim(), "https://inecelectionresults.ng/");
      if (u.protocol === "http:") u.protocol = "https:";
      return u.protocol === "https:" ? u.toString() : null;
    } catch {
      return null;
    }
  };

  const inspect = (value: unknown): string | null => {
    const direct = resolve(value);
    if (direct) return direct;
    if (!value || typeof value !== "object") return null;
    const obj = value as Record<string, unknown>;
    for (const key of ["url", "document_url", "file_url", "src", "path", "href"]) {
      const found = resolve(obj[key]);
      if (found) return found;
    }
    return null;
  };

  const values = [
    row.document, row.result, row.result_sheet, row.file,
    row.file_url, row.document_url, row.url, row.href,
    pu?.document, pu?.result, pu?.result_sheet, pu?.file,
    pu?.file_url, pu?.document_url, pu?.url,
    row.old_documents, pu?.old_documents,
  ];

  for (const value of values) {
    if (Array.isArray(value)) {
      for (const item of [...value].reverse()) {
        const found = inspect(item);
        if (found) return found;
      }
    } else {
      const found = inspect(value);
      if (found) return found;
    }
  }

  return null;
}

function apiArray(payload: unknown, keys: string[]): Array<Record<string, unknown>> {
  if (Array.isArray(payload)) return payload.filter(x => !!x && typeof x === "object") as Array<Record<string, unknown>>;
  if (!payload || typeof payload !== "object") return [];
  const obj = payload as Record<string, unknown>;
  for (const key of keys) { const value = obj[key]; if (Array.isArray(value)) return value.filter(x => !!x && typeof x === "object") as Array<Record<string, unknown>>; }
  return [];
}

function apiObjectId(value: unknown): string | null { const id = String(value ?? "").trim(); return /^[a-f0-9]{24}$/i.test(id) ? id : null; }

function findWardInElectionLga(payload: unknown, wardOid: string, wardNumericId: number | null) {
  const lgas = apiArray(payload, ["data", "lgas", "election_lgas", "results", "items"]);
  for (const lga of lgas) {
    const wards = Array.isArray(lga.wards) ? lga.wards : [];
    for (const raw of wards) {
      if (!raw || typeof raw !== "object") continue;
      const ward = raw as Record<string, unknown>;
      const oid = apiObjectId(ward._id);
      const numeric = Number(ward.ward_id ?? ward.id);
      if ((oid && oid.toLowerCase() === wardOid.toLowerCase()) || (wardNumericId != null && Number.isInteger(numeric) && numeric === wardNumericId)) return { oid, numericId: Number.isInteger(numeric) ? numeric : null, name: String(ward.name ?? ward.ward_name ?? "").trim() || null, lgaOid: apiObjectId(lga._id) };
    }
  }
  return null;
}
async function claimWard() { const { data, error } = await supabase.rpc("claim_irev_ward_sync_job", { p_worker_id: WORKER_ID, p_max_attempts: MAX_ATTEMPTS }); if (error) throw error; return data?.[0] ?? null; }
async function processWard(job: Record<string, unknown>) {
  const electionId = String(job.election_id);
  const wardId = String(job.ward_id);
  const [election, ward] = await Promise.all([
    supabase.from("elections").select("external_id").eq("id", electionId).single(),
    supabase.from("wards").select("irev_ward_oid,irev_ward_id").eq("id", wardId).single(),
  ]);
  if (election.error || !election.data?.external_id) throw new Error("Election IReV identity unavailable");
  if (ward.error || !ward.data?.irev_ward_oid) throw new Error("Ward IReV identity unavailable");

  const irevElectionId = String(election.data.external_id).replace(/^irev:/, "");
  const wardOid = String(ward.data.irev_ward_oid);
  const wardNumericId = Number(ward.data.irev_ward_id);
  let resolvedWard = {
    oid: apiObjectId(wardOid),
    numericId: Number.isInteger(wardNumericId) ? wardNumericId : null,
    name: null as string | null,
    lgaOid: null as string | null,
  };
  let hierarchySource: "canonical" | "election_lga_fallback" = "canonical";

  let payload = await fetchWard(irevElectionId, wardOid);
  let puRows = rows(payload);
  if (!puRows.length) {
    const hierarchy = await irevGet(irevElectionId, "/lga");
    const matched = findWardInElectionLga(hierarchy, wardOid, resolvedWard.numericId);
    if (matched?.oid && matched.oid.toLowerCase() !== wardOid.toLowerCase()) {
      resolvedWard = matched;
      hierarchySource = "election_lga_fallback";
      payload = await fetchWard(irevElectionId, matched.oid);
      puRows = rows(payload);
    }
  }

  const diagnostics = {
    requested_ward_oid: wardOid,
    requested_ward_numeric_id: resolvedWard.numericId,
    resolved_ward_oid: resolvedWard.oid,
    resolved_ward_name: resolvedWard.name,
    resolved_lga_oid: resolvedWard.lgaOid,
    hierarchy_source: hierarchySource,
    polling_units: puRows.length,
    payload_success: payload && typeof payload === "object"
      ? (payload as Record<string, unknown>).success ?? null
      : null,
  };

  type NormalizedPu = {
    name: string;
    pu_code: string | null;
    external_id: string | null;
    irev_pu_id: number | null;
    source_url: string | null;
    source_external_id: string;
  };

  const normalized: NormalizedPu[] = [];
  for (const row of puRows) {
    const pu = row.polling_unit && typeof row.polling_unit === "object"
      ? row.polling_unit as Record<string, unknown>
      : null;
    const externalId = String(pu?._id ?? row.polling_unit_oid ?? row.external_id ?? row._id ?? "").trim() || null;
    const numericId = Number(pu?.polling_unit_id ?? row.pu_id ?? row.polling_unit_id ?? row.id);
    const code = String(row.pu_code ?? pu?.pu_code ?? row.code ?? pu?.code ?? "").trim() || null;
    const name = String(row.name ?? row.polling_unit_name ?? pu?.name ?? "").trim() || "Unknown polling unit";
    const sourceUrl = documentUrl(row);
    const document = row.document && typeof row.document === "object"
      ? row.document as Record<string, unknown>
      : {};

    normalized.push({
      name,
      pu_code: code,
      external_id: externalId,
      irev_pu_id: Number.isInteger(numericId) ? numericId : null,
      source_url: sourceUrl,
      source_external_id: String(document._id ?? row.document_id ?? pu?.document_id ?? externalId ?? sourceUrl ?? (wardId + ":" + name)),
    });
  }

  // Persist the whole ward in bulk. The old implementation performed multiple
  // database round-trips per polling unit and could exhaust the Edge Function
  // wall-clock budget before it reached the result-sheet inserts.
  const puRowsToUpsert = normalized.map((pu) => ({
    ward_id: wardId,
    name: pu.name,
    pu_code: pu.pu_code,
    external_id: pu.external_id,
    irev_pu_id: pu.irev_pu_id,
  }));
  if (puRowsToUpsert.length) {
    const { error } = await supabase
      .from("polling_units")
      .upsert(puRowsToUpsert, { onConflict: "ward_id,name", ignoreDuplicates: false });
    if (error) throw error;
  }

  const pollingUnits = await supabase
    .from("polling_units")
    .select("id,name,pu_code,external_id,irev_pu_id")
    .eq("ward_id", wardId);
  if (pollingUnits.error) throw pollingUnits.error;

  const byCode = new Map<string, string>();
  const byExternal = new Map<string, string>();
  const byName = new Map<string, string>();
  for (const row of pollingUnits.data ?? []) {
    if (row.pu_code) byCode.set(String(row.pu_code), row.id);
    if (row.external_id) byExternal.set(String(row.external_id), row.id);
    if (row.name) byName.set(String(row.name), row.id);
  }

  const sheetRows = normalized
    .filter((pu) => pu.source_url)
    .map((pu) => {
      const pollingUnitId =
        (pu.pu_code ? byCode.get(pu.pu_code) : undefined) ??
        (pu.external_id ? byExternal.get(pu.external_id) : undefined) ??
        byName.get(pu.name);
      if (!pollingUnitId) throw new Error("Polling unit identity could not be resolved: " + pu.name);

      return {
        election_id: electionId,
        polling_unit_id: pollingUnitId,
        source_url: pu.source_url,
        source_external_id: pu.source_external_id,
        status: "discovered",
        evidence_status: "remote_only",
        storage_policy: "ephemeral",
        discovered_at: new Date().toISOString(),
      };
    });

  if (sheetRows.length) {
    const { error } = await supabase
      .from("result_sheets")
      .upsert(sheetRows, { onConflict: "election_id,source_url", ignoreDuplicates: true });
    if (error) throw error;
  }

  return {
    polling_units: puRows.length,
    result_sheets: sheetRows.length,
    diagnostics,
  };
}
async function finishWard(jobId: string, attempts: number, ok: boolean, error?: string) { const update = ok ? { status: "completed", locked_at: null, locked_by: null, last_error: null, last_synced_at: new Date().toISOString(), updated_at: new Date().toISOString() } : { status: attempts < MAX_ATTEMPTS ? "queued" : "failed", locked_at: null, locked_by: null, last_error: errorMessage(error), available_at: new Date(Date.now() + 15 * 60_000).toISOString(), updated_at: new Date().toISOString() }; const result = await supabase.from("irev_ward_sync_jobs").update(update).eq("id", jobId); if (result.error) throw result.error; }
async function enqueueSheets() { const { data, error } = await supabase.from("result_sheets").select("id").eq("status", "discovered").order("discovered_at", { ascending: true }).limit(100); if (error) throw error; if (!data?.length) return 0; const result = await supabase.from("result_processing_jobs").upsert(data.map(x => ({ result_sheet_id: x.id, status: "queued" })), { onConflict: "result_sheet_id", ignoreDuplicates: true }); if (result.error) throw result.error; return data.length; }
async function claimSheet() { const { data, error } = await supabase.rpc("claim_result_processing_job", { p_worker_id: WORKER_ID, p_max_attempts: MAX_ATTEMPTS }); if (error) throw error; return data?.[0] ?? null; }
async function invokeProcess(sheetId: string) { const response = await fetch(`${SUPABASE_URL.replace(/\/$/, "")}/functions/v1/irev-process`, { method: "POST", headers: { authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY, "content-type": "application/json" }, body: JSON.stringify({ result_sheet_id: sheetId }) }); const body = await response.json().catch(() => ({})); if (!response.ok || body?.ok === false) throw new Error(body?.error ?? `irev-process HTTP ${response.status}`); return body; }
async function finishSheet(jobId: string, attempts: number, ok: boolean, error?: string, defer = false) {
  const update = ok
    ? { status: "completed", locked_at: null, locked_by: null, last_error: null, completed_at: new Date().toISOString(), updated_at: new Date().toISOString() }
    : defer
      ? { status: "queued", attempts: Math.max(0, attempts - 1), locked_at: null, locked_by: null, last_error: error ?? "Temporarily deferred", available_at: new Date(Date.now() + 65_000).toISOString(), updated_at: new Date().toISOString() }
      : { status: attempts < MAX_ATTEMPTS ? "queued" : "failed", locked_at: null, locked_by: null, last_error: error ?? "Unknown processing error", available_at: new Date(Date.now() + 15 * 60_000).toISOString(), updated_at: new Date().toISOString() };
  const result = await supabase.from("result_processing_jobs").update(update).eq("id", jobId);
  if (result.error) throw result.error;
}

async function queueCounts() {
  const [wardQueued, wardProcessing, sheetQueued, sheetProcessing] = await Promise.all([
    supabase.from("irev_ward_sync_jobs").select("id", { count: "exact", head: true }).eq("status", "queued"),
    supabase.from("irev_ward_sync_jobs").select("id", { count: "exact", head: true }).eq("status", "processing"),
    supabase.from("result_processing_jobs").select("id", { count: "exact", head: true }).eq("status", "queued"),
    supabase.from("result_processing_jobs").select("id", { count: "exact", head: true }).eq("status", "processing"),
  ]);
  if (wardQueued.error) throw wardQueued.error;
  if (wardProcessing.error) throw wardProcessing.error;
  if (sheetQueued.error) throw sheetQueued.error;
  if (sheetProcessing.error) throw sheetProcessing.error;
  return {
    ward_jobs: (wardQueued.count ?? 0) + (wardProcessing.count ?? 0),
    sheet_jobs: (sheetQueued.count ?? 0) + (sheetProcessing.count ?? 0),
    ward_queued: wardQueued.count ?? 0,
    ward_processing: wardProcessing.count ?? 0,
    sheet_queued: sheetQueued.count ?? 0,
    sheet_processing: sheetProcessing.count ?? 0,
    total: (wardQueued.count ?? 0) + (wardProcessing.count ?? 0) + (sheetQueued.count ?? 0) + (sheetProcessing.count ?? 0),
  };
}
async function updateHeartbeat(values: Record<string, unknown>) {
  const { error } = await supabase.from("pipeline_worker_status").upsert({
    id: "irev-ocr-drain",
    worker_name: "IReV OCR Drain",
    heartbeat_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...values,
  }, { onConflict: "id" });
  if (error) console.error("worker heartbeat update failed:", error.message);
}
async function refreshHeartbeat(extra: Record<string, unknown> = {}) {
  try {
    const counts = await queueCounts();
    await updateHeartbeat({
      queue_remaining: counts.sheet_queued,
      active_jobs: counts.sheet_processing,
      ...extra,
    });
    return counts;
  } catch (error) {
    console.error("worker heartbeat refresh failed:", error instanceof Error ? error.message : String(error));
    return null;
  }
}
Deno.serve(async request => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (request.method !== "POST") return json({ ok: false, error: "POST required" }, 405);
  const started = Date.now(); const runId = WORKER_ID; let wardProcessed = 0; let wardFailed = 0; let sheetProcessed = 0; let sheetFailed = 0; let queued = 0; const sheetDiagnostics: Array<Record<string, unknown>> = [];
  try {
    await updateHeartbeat({ status: "running", run_id: runId, last_worker_started: new Date().toISOString(), last_error: null, jobs_processed_last_run: 0, jobs_failed_last_run: 0 });
    await refreshHeartbeat();
    const wardDiagnostics: Array<Record<string, unknown>> = [];
    while (wardProcessed + wardFailed < MAX_WARD_JOBS && Date.now() - started < DEADLINE_MS) {
      const job = await claimWard();
      if (!job) break;
      try {
        const outcome = await processWard(job);
        wardDiagnostics.push({ election_id: job.election_id, ward_id: job.ward_id, ...outcome.diagnostics, polling_units: outcome.polling_units, result_sheets: outcome.result_sheets });
        await finishWard(job.job_id, Number(job.attempts), true);
        wardProcessed++;
      } catch (error) {
        wardFailed++;
        wardDiagnostics.push({ election_id: job.election_id, ward_id: job.ward_id, error: error instanceof Error ? error.message : String(error) });
        await finishWard(job.job_id, Number(job.attempts), false, error instanceof Error ? error.message : String(error));
      }
    }
    if (Date.now() - started < DEADLINE_MS) queued = await enqueueSheets();
    let rateLimited = false;
    // Claim and process up to three sheets concurrently. The next batch is not
    // claimed until every job in the current batch has settled.
    while (sheetProcessed + sheetFailed < MAX_SHEET_JOBS && Date.now() - started < DEADLINE_MS) {
      const claimCount = Math.min(CONCURRENT_SHEET_JOBS, MAX_SHEET_JOBS - sheetProcessed - sheetFailed);
      const claimed = (await Promise.all(Array.from({ length: claimCount }, () => claimSheet()))).filter(Boolean) as Array<Record<string, unknown>>;
      if (!claimed.length) break;

      const outcomes = await Promise.allSettled(claimed.map(async (job) => {
        try {
          const result = await invokeProcess(String(job.result_sheet_id));
          await finishSheet(job.job_id as string, Number(job.attempts), Boolean(result?.ok), result?.error);
          return { job, ok: Boolean(result?.ok), status: result?.status ?? null, error: result?.error ?? null, rateLimited: false };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const isRateLimited = /HTTP 429|RESOURCE_EXHAUSTED|quota exceeded|rate limit/i.test(message);
          await finishSheet(job.job_id as string, Number(job.attempts), false, message, isRateLimited);
          return { job, ok: false, status: null, error: message, rateLimited: isRateLimited };
        }
      }));

      for (const outcome of outcomes) {
        if (outcome.status === "fulfilled") {
          const value = outcome.value;
          sheetDiagnostics.push({ job_id: value.job.job_id, result_sheet_id: value.job.result_sheet_id, ok: value.ok, status: value.status, deferred: value.rateLimited, error: value.error });
          if (value.ok) sheetProcessed++; else if (value.rateLimited) rateLimited = true; else sheetFailed++;
        } else {
          sheetFailed++;
          sheetDiagnostics.push({ ok: false, error: outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason) });
        }
      }

      await refreshHeartbeat({
        jobs_processed_last_run: sheetProcessed,
        jobs_failed_last_run: sheetFailed,
      });

      if (rateLimited) break;
      if (claimed.length < claimCount) break;
    }
    const remaining = await refreshHeartbeat({
      status: "idle",
      last_worker_finished: new Date().toISOString(),
      last_successful_batch: (sheetProcessed > 0 && sheetFailed === 0) ? new Date().toISOString() : undefined,
      jobs_processed_last_run: sheetProcessed,
      jobs_failed_last_run: sheetFailed,
      last_error: sheetFailed > 0 ? (sheetDiagnostics.find(x => x.error)?.error as string ?? null) : null,
    }) ?? { total: 0, ward_jobs: 0, sheet_jobs: 0 };
    return json({ ok: true, run_id: runId, queued, processed: sheetProcessed, failed: sheetFailed, ward_jobs: { processed: wardProcessed, failed: wardFailed }, ward_diagnostics: wardDiagnostics, sheet_diagnostics: sheetDiagnostics, remaining: remaining.total, remaining_ward_jobs: remaining.ward_jobs, remaining_sheet_jobs: remaining.sheet_jobs, max_ward_jobs: MAX_WARD_JOBS, max_sheet_jobs: MAX_SHEET_JOBS, concurrent_sheet_jobs: CONCURRENT_SHEET_JOBS, rate_limited: rateLimited, elapsed_ms: Date.now() - started });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await updateHeartbeat({
      status: "error",
      heartbeat_at: new Date().toISOString(),
      last_worker_finished: new Date().toISOString(),
      last_error: message.slice(0, 2000),
      jobs_processed_last_run: sheetProcessed,
      jobs_failed_last_run: sheetFailed,
    });
    return json({ ok: false, run_id: runId, error: message, ward_jobs: { processed: wardProcessed, failed: wardFailed }, processed: sheetProcessed, failed: sheetFailed }, 500);
  }
});
