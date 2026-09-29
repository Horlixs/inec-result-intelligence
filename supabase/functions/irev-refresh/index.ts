import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const url = Deno.env.get("SUPABASE_URL")!;
const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(url, key);

const MAX_JOBS_PER_REFRESH = 5;
const MAX_ATTEMPTS = 5;
const WORKER_ID = `irev-refresh:${crypto.randomUUID()}`;

const IREV_API_BASES = [
  "https://dolphin-app-sleqh.ondigitalocean.app/api/v1",
];
const IREV_PUBLIC_KEY = "4SXkHM7Amb1SbF4C8do6816dmbbwqPp7akRbrmcV";
const WARD_MAX_ATTEMPTS = 5;

async function fetchIrevWard(electionExternalId: string, wardObjectId: string): Promise<unknown> {
  let lastError: unknown = null;
  for (const base of IREV_API_BASES) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);
    try {
      const response = await fetch(
        base + "/elections/" + encodeURIComponent(electionExternalId) + "/pus?ward=" + encodeURIComponent(wardObjectId),
        {
          headers: {
            "user-agent": "INEC-Result-Intelligence/1.0 source-collector",
            accept: "application/json, text/plain, */*",
            origin: "https://inecelectionresults.ng",
            referer: "https://inecelectionresults.ng/",
            "x-api-key": IREV_PUBLIC_KEY,
            "x-api-rt": String(Date.now()),
          },
          signal: controller.signal,
        },
      );
      if (!response.ok) {
        lastError = new Error("IReV API HTTP " + response.status);
        continue;
      }
      const text = await response.text();
      return text ? JSON.parse(text) : null;
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("IReV ward request failed");
}

function irevRows(payload: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(payload)) return payload.filter((row): row is Record<string, unknown> => !!row && typeof row === "object");
  if (payload && typeof payload === "object") {
    const data = (payload as Record<string, unknown>).data;
    if (Array.isArray(data)) return data.filter((row): row is Record<string, unknown> => !!row && typeof row === "object");
  }
  return [];
}

function getDocumentUrl(
  row: Record<string, unknown>,
  electionExternalId: string,
): string | null {
  const direct = [row.url, row.document_url, row.file_url];
  for (const value of direct) {
    if (typeof value === "string" && value.startsWith("http")) return value;
  }

  for (const value of [row.document, row.result, row.result_sheet, row.file]) {
    if (!value || typeof value !== "object") continue;
    const object = value as Record<string, unknown>;
    for (const key of ["url", "document_url", "file_url", "src", "path"]) {
      const candidate = object[key];
      if (typeof candidate === "string" && candidate.startsWith("http")) return candidate;
    }
  }

  // The current IReV UI exposes the uploaded sheet behind the polling-unit
  // "Open" action. Some API responses contain only the polling-unit identity,
  // so reconstruct the public document route when the direct asset/page URL
  // is omitted from the payload.
  const puId = String(
    row.polling_unit_id ??
    row.pollingUnitId ??
    row._id ??
    row.external_id ??
    row.id ??
    "",
  ).trim();

  if (/^[a-f0-9]{24}$/i.test(electionExternalId) && /^[a-f0-9]{24}$/i.test(puId)) {
    return "https://inecelectionresults.ng/elections/" +
      encodeURIComponent(electionExternalId) +
      "/pu/" +
      encodeURIComponent(puId) +
      "/document";
  }

  return null;
}

async function processWardJob(job: Record<string, unknown>) {
  const electionId = String(job.election_id);
  const wardId = String(job.ward_id);

  const election = await supabase.from("elections").select("external_id").eq("id", electionId).single();
  if (election.error || !election.data?.external_id) throw new Error("Election IReV identity unavailable");

  const ward = await supabase.from("wards").select("irev_ward_oid").eq("id", wardId).single();
  if (ward.error || !ward.data?.irev_ward_oid) throw new Error("Ward IReV object identity unavailable");

  const irevElectionId = String(election.data.external_id).replace(/^irev:/, "");
  const payload = await fetchIrevWard(irevElectionId, String(ward.data.irev_ward_oid));
  const rows = irevRows(payload);
  let sheets = 0;

  for (const row of rows) {
    const puExternalId = String(row.polling_unit_id ?? row._id ?? row.external_id ?? "").trim();
    const puNumericId = Number(row.pu_id ?? row.polling_unit_id ?? row.id);
    const puCode = String(row.pu_code ?? row.code ?? "").trim() || null;
    const puName = String(row.name ?? row.polling_unit_name ?? "").trim() || "Unknown polling unit";
    let pollingUnitId: string | null = null;

    if (puCode) {
      const lookup = await supabase.from("polling_units").select("id").eq("ward_id", wardId).eq("pu_code", puCode).maybeSingle();
      pollingUnitId = lookup.data?.id ?? null;
    }

    if (!pollingUnitId) {
      const created = await supabase.from("polling_units").insert({
        ward_id: wardId,
        pu_code: puCode,
        name: puName,
        external_id: puExternalId || null,
        irev_pu_id: Number.isInteger(puNumericId) ? puNumericId : null,
      }).select("id").single();
      if (created.error) throw created.error;
      pollingUnitId = created.data.id;
    } else {
      const { error: identityError } = await supabase.from("polling_units").update({
        name: puName,
        external_id: puExternalId || null,
        irev_pu_id: Number.isInteger(puNumericId) ? puNumericId : null,
      }).eq("id", pollingUnitId);
      if (identityError) throw identityError;
    }

    const url = getDocumentUrl(row, irevElectionId);
    if (!url) continue;

    const document = row.document && typeof row.document === "object"
      ? row.document as Record<string, unknown>
      : {};
    const sourceExternalId = String(document._id ?? row.document_id ?? url);

    const result = await supabase.from("result_sheets").upsert({
      election_id: electionId,
      polling_unit_id: pollingUnitId,
      source_url: url,
      source_external_id: sourceExternalId,
      status: "discovered",
      evidence_status: "remote_only",
      storage_policy: "ephemeral",
      discovered_at: new Date().toISOString(),
    }, { onConflict: "election_id,source_url" });
    if (result.error) throw result.error;
    sheets++;
  }

  return { polling_units: rows.length, result_sheets: sheets };
}

async function drainWardJobs(maxJobs: number) {
  const workerId = "irev-ward-refresh";
  const claimFunction = "claim_" + "irev_ward_sync_job";
  let processed = 0;
  let failed = 0;
  for (let index = 0; index < maxJobs; index++) {
    const result = await supabase.rpc(claimFunction, {
      p_worker_id: workerId,
      p_max_attempts: WARD_MAX_ATTEMPTS,
    });
    if (result.error) throw result.error;
    const job = result.data?.[0];
    if (!job) break;
    try {
      const outcome = await processWardJob(job);
      await supabase.from("irev_ward_sync_jobs").update({
        status: "completed",
        locked_at: null,
        locked_by: null,
        last_error: null,
        discovered_sheets: outcome.result_sheets,
        last_synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", job.job_id);
      processed++;
    } catch (error) {
      failed++;
      await supabase.from("irev_ward_sync_jobs").update({
        status: Number(job.attempts) < WARD_MAX_ATTEMPTS ? "queued" : "failed",
        locked_at: null,
        locked_by: null,
        last_error: error instanceof Error ? error.message : String(error),
        available_at: new Date(Date.now() + 900000).toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", job.job_id);
    }
  }
  return { processed, failed };
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try { return JSON.stringify(error); } catch { return String(error); }
}

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
    throw new Error(name + " failed with HTTP " + response.status + ": " + errorMessage(data?.error ?? data?.message ?? data));
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
  let stage = "startup";

  try {
    stage = "irev-sync";
    const discovery = await invoke("irev-sync", { mode: "scheduled-refresh" });
    stage = "drain-ward-jobs";
    const wardJobs = await drainWardJobs(5);
    stage = "enqueue-discovered-sheets";
    const queued = await enqueueDiscoveredSheets();

    let processed = 0;
    let failed = 0;

    for (let i = 0; i < MAX_JOBS_PER_REFRESH; i++) {
      stage = "process-result-sheet";
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
      ward_jobs: wardJobs,
      discovery: {
        processed_elections: discovery?.processed ?? 0,
        result_sheets_discovered: discovery?.result_sheets_discovered ?? 0,
        elections: discovery?.elections ?? [],
        diagnostics: discovery?.diagnostics ?? {},
      },
    }), {
      headers: { "content-type": "application/json" },
    });
  } catch (error) {
    const message = errorMessage(error);
    console.error("IReV refresh failed", { stage, error: message });
    await supabase.from("pipeline_runs").insert({
      started_at: started,
      finished_at: new Date().toISOString(),
      status: "failed",
      trigger_source: "scheduled",
      failed: 1,
      issues: [{ stage, message }],
    });

    return new Response(JSON.stringify({
      ok: false,
      error: message,
      stage,
    }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
});
