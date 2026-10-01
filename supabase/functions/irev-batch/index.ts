// Bounded, resumable worker: never tries to drain the entire IReV queue in one invocation.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
const IREV_BASE = "https://dolphin-app-sleqh.ondigitalocean.app/api/v1";
const IREV_KEY = Deno.env.get("IREV_KEY")?.trim();
if (!IREV_KEY) throw new Error("Missing IREV_KEY secret");
const MAX_WARD_JOBS = 1;
const MAX_SHEET_JOBS = 1;
const MAX_ATTEMPTS = 5;
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
function documentUrl(row: Record<string, unknown>, electionId: string) {
  const pu = row.polling_unit && typeof row.polling_unit === "object" ? row.polling_unit as Record<string, unknown> : null;
  const resolve = (value: unknown): string | null => { if (typeof value !== "string" || !value.trim()) return null; try { const u = new URL(value.trim(), "https://inecelectionresults.ng/"); if (u.protocol === "http:") u.protocol = "https:"; return u.protocol === "https:" ? u.toString() : null; } catch { return null; } };
  const inspect = (value: unknown): string | null => { const direct = resolve(value); if (direct) return direct; if (!value || typeof value !== "object") return null; const obj = value as Record<string, unknown>; for (const key of ["url", "document_url", "file_url", "src", "path", "href"]) { const found = resolve(obj[key]); if (found) return found; } return null; };
  for (const value of [row.document, row.result, row.result_sheet, row.file, row.file_url, row.document_url, row.url, row.href, pu?.document, pu?.result, pu?.result_sheet, pu?.file, pu?.file_url, pu?.document_url, pu?.url]) { const found = inspect(value); if (found) return found; }
  const puId = String(pu?._id ?? row.polling_unit_oid ?? row.external_id ?? row._id ?? "").trim();
  if (objectId(electionId) && objectId(puId)) return `https://inecelectionresults.ng/elections/${encodeURIComponent(electionId)}/pu/${encodeURIComponent(puId)}/document`;
  return null;
}
async function irevGet(electionId: string, path: string) {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(IREV_BASE + "/elections/" + encodeURIComponent(electionId) + path, {
      headers: { "user-agent": "INEC-Result-Intelligence/1.0 source-collector", accept: "application/json, text/plain, */*", origin: "https://inecelectionresults.ng", referer: "https://inecelectionresults.ng/", "x-api-key": IREV_KEY, "x-api-rt": String(Date.now()) },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error("IReV " + path + " HTTP " + response.status);
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  } finally { clearTimeout(timer); }
}

async function fetchWard(electionId: string, wardOid: string) {
  return irevGet(electionId, "/pus?ward=" + encodeURIComponent(wardOid));
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
  const electionId = String(job.election_id); const wardId = String(job.ward_id);
  const election = await supabase.from("elections").select("external_id").eq("id", electionId).single(); if (election.error || !election.data?.external_id) throw new Error("Election IReV identity unavailable");
  const ward = await supabase.from("wards").select("irev_ward_oid").eq("id", wardId).single(); if (ward.error || !ward.data?.irev_ward_oid) throw new Error("Ward IReV identity unavailable");
  const irevElectionId = String(election.data.external_id).replace(/^irev:/, "");
  const wardOid = String(ward.data.irev_ward_oid);
  const wardNumericId = Number(ward.data.irev_ward_id);
  let resolvedWard = { oid: apiObjectId(wardOid), numericId: Number.isInteger(wardNumericId) ? wardNumericId : null, name: null as string | null, lgaOid: null as string | null };
  let hierarchySource: "canonical" | "election_lga_fallback" = "canonical";
  let payload = await fetchWard(irevElectionId, wardOid);
  let puRows = rows(payload);
  if (!puRows.length) {
    const hierarchy = await irevGet(irevElectionId, "/lga");
    const matched = findWardInElectionLga(hierarchy, wardOid, resolvedWard.numericId);
    if (matched?.oid && matched.oid.toLowerCase() !== wardOid.toLowerCase()) { resolvedWard = matched; hierarchySource = "election_lga_fallback"; payload = await fetchWard(irevElectionId, matched.oid); puRows = rows(payload); }
  }
  const diagnostics = { requested_ward_oid: wardOid, requested_ward_numeric_id: resolvedWard.numericId, resolved_ward_oid: resolvedWard.oid, resolved_ward_name: resolvedWard.name, resolved_lga_oid: resolvedWard.lgaOid, hierarchy_source: hierarchySource, polling_units: puRows.length, payload_success: payload && typeof payload === "object" ? (payload as Record<string, unknown>).success ?? null : null };
  let sheets = 0;
  for (const row of puRows) {
    const pu = row.polling_unit && typeof row.polling_unit === "object" ? row.polling_unit as Record<string, unknown> : null;
    const externalId = String(pu?._id ?? row.polling_unit_oid ?? row.external_id ?? row._id ?? "").trim() || null;
    const numericId = Number(pu?.polling_unit_id ?? row.pu_id ?? row.polling_unit_id ?? row.id);
    const code = String(row.pu_code ?? pu?.pu_code ?? row.code ?? pu?.code ?? "").trim() || null;
    const name = String(row.name ?? row.polling_unit_name ?? pu?.name ?? "").trim() || "Unknown polling unit";
    let pollingUnitId: string | null = null;
    if (code) { const lookup = await supabase.from("polling_units").select("id").eq("ward_id", wardId).eq("pu_code", code).maybeSingle(); if (lookup.error) throw lookup.error; pollingUnitId = lookup.data?.id ?? null; }
    if (!pollingUnitId && externalId) { const lookup = await supabase.from("polling_units").select("id").eq("ward_id", wardId).eq("external_id", externalId).maybeSingle(); if (lookup.error) throw lookup.error; pollingUnitId = lookup.data?.id ?? null; }
    if (!pollingUnitId) { const created = await supabase.from("polling_units").insert({ ward_id: wardId, pu_code: code, name, external_id: externalId, irev_pu_id: Number.isInteger(numericId) ? numericId : null }).select("id").single(); if (created.error) throw created.error; pollingUnitId = created.data.id; } else { const updated = await supabase.from("polling_units").update({ name, external_id: externalId, irev_pu_id: Number.isInteger(numericId) ? numericId : null }).eq("id", pollingUnitId); if (updated.error) throw updated.error; }
    const sourceUrl = documentUrl(row, irevElectionId); if (!sourceUrl) continue;
    const document = row.document && typeof row.document === "object" ? row.document as Record<string, unknown> : {};
    const sourceExternalId = String(document._id ?? row.document_id ?? pu?.document_id ?? externalId ?? sourceUrl);
    const result = await supabase.from("result_sheets").upsert({ election_id: electionId, polling_unit_id: pollingUnitId, source_url: sourceUrl, source_external_id: sourceExternalId, status: "discovered", evidence_status: "remote_only", storage_policy: "ephemeral", discovered_at: new Date().toISOString() }, { onConflict: "election_id,source_url" });
    if (result.error) throw result.error; sheets++;
  }
  return { polling_units: puRows.length, result_sheets: sheets, diagnostics };
}
async function finishWard(jobId: string, attempts: number, ok: boolean, error?: string) { const update = ok ? { status: "completed", locked_at: null, locked_by: null, last_error: null, last_synced_at: new Date().toISOString(), updated_at: new Date().toISOString() } : { status: attempts < MAX_ATTEMPTS ? "queued" : "failed", locked_at: null, locked_by: null, last_error: error ?? "Unknown error", available_at: new Date(Date.now() + 15 * 60_000).toISOString(), updated_at: new Date().toISOString() }; const result = await supabase.from("irev_ward_sync_jobs").update(update).eq("id", jobId); if (result.error) throw result.error; }
async function enqueueSheets() { const { data, error } = await supabase.from("result_sheets").select("id").eq("status", "discovered").order("discovered_at", { ascending: true }).limit(100); if (error) throw error; if (!data?.length) return 0; const result = await supabase.from("result_processing_jobs").upsert(data.map(x => ({ result_sheet_id: x.id, status: "queued" })), { onConflict: "result_sheet_id", ignoreDuplicates: true }); if (result.error) throw result.error; return data.length; }
async function claimSheet() { const { data, error } = await supabase.rpc("claim_result_processing_job", { p_worker_id: WORKER_ID, p_max_attempts: MAX_ATTEMPTS }); if (error) throw error; return data?.[0] ?? null; }
async function invokeProcess(sheetId: string) { const response = await fetch(`${SUPABASE_URL.replace(/\/$/, "")}/functions/v1/irev-process`, { method: "POST", headers: { authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY, "content-type": "application/json" }, body: JSON.stringify({ result_sheet_id: sheetId }) }); const body = await response.json().catch(() => ({})); if (!response.ok || body?.ok === false) throw new Error(body?.error ?? `irev-process HTTP ${response.status}`); return body; }
async function finishSheet(jobId: string, attempts: number, ok: boolean, error?: string) { const update = ok ? { status: "completed", locked_at: null, locked_by: null, last_error: null, completed_at: new Date().toISOString(), updated_at: new Date().toISOString() } : { status: attempts < MAX_ATTEMPTS ? "queued" : "failed", locked_at: null, locked_by: null, last_error: error ?? "Unknown error", available_at: new Date(Date.now() + 15 * 60_000).toISOString(), updated_at: new Date().toISOString() }; const result = await supabase.from("result_processing_jobs").update(update).eq("id", jobId); if (result.error) throw result.error; }
async function queueCounts() { const [wards, sheets] = await Promise.all([supabase.from("irev_ward_sync_jobs").select("id", { count: "exact", head: true }).in("status", ["queued", "processing"]), supabase.from("result_processing_jobs").select("id", { count: "exact", head: true }).in("status", ["queued", "processing"])]); if (wards.error) throw wards.error; if (sheets.error) throw sheets.error; return { ward_jobs: wards.count ?? 0, sheet_jobs: sheets.count ?? 0, total: (wards.count ?? 0) + (sheets.count ?? 0) }; }
Deno.serve(async request => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (request.method !== "POST") return json({ ok: false, error: "POST required" }, 405);
  const started = Date.now(); let wardProcessed = 0; let wardFailed = 0; let sheetProcessed = 0; let sheetFailed = 0; let queued = 0;
  try {
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
    while (sheetProcessed + sheetFailed < MAX_SHEET_JOBS && Date.now() - started < DEADLINE_MS) { const job = await claimSheet(); if (!job) break; try { const result = await invokeProcess(String(job.result_sheet_id)); await finishSheet(job.job_id, Number(job.attempts), Boolean(result?.ok), result?.error); if (result?.ok) sheetProcessed++; else sheetFailed++; } catch (error) { sheetFailed++; await finishSheet(job.job_id, Number(job.attempts), false, error instanceof Error ? error.message : String(error)); } }
    const remaining = await queueCounts();
    return json({ ok: true, queued, processed: sheetProcessed, failed: sheetFailed, ward_jobs: { processed: wardProcessed, failed: wardFailed }, ward_diagnostics: wardDiagnostics, remaining: remaining.total, remaining_ward_jobs: remaining.ward_jobs, remaining_sheet_jobs: remaining.sheet_jobs, max_ward_jobs: MAX_WARD_JOBS, max_sheet_jobs: MAX_SHEET_JOBS, elapsed_ms: Date.now() - started });
  } catch (error) { return json({ ok: false, error: error instanceof Error ? error.message : String(error), ward_jobs: { processed: wardProcessed, failed: wardFailed }, processed: sheetProcessed, failed: sheetFailed }, 500); }
});
