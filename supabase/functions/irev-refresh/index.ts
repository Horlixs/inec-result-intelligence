import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const url = Deno.env.get("SUPABASE_URL")!;
const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(url, key);

const MAX_ATTEMPTS = 5;
const WORKER_ID = `irev-refresh:${crypto.randomUUID()}`;

const IREV_API_BASES = [
  "https://dolphin-app-sleqh.ondigitalocean.app/api/v1",
];
const IREV_KEY = Deno.env.get("IREV_KEY")?.trim() || null;
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
            ...(IREV_KEY ? { "x-api-key": IREV_KEY } : {}),
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
  if (!payload || typeof payload !== "object") return [];
  const object = payload as Record<string, unknown>;
  for (const key of ["data", "polling_units", "pus", "results", "items"]) {
    const value = object[key];
    if (Array.isArray(value)) return value.filter((row): row is Record<string, unknown> => !!row && typeof row === "object");
    if (value && typeof value === "object") {
      const nested = irevRows(value);
      if (nested.length) return nested;
    }
  }
  return [];
}

function getDocumentUrl(row: Record<string, unknown>): string | null {
  const nestedPu = row.polling_unit && typeof row.polling_unit === "object"
    ? row.polling_unit as Record<string, unknown>
    : null;

  const resolveUrl = (value: unknown): string | null => {
    if (typeof value !== "string" || !value.trim()) return null;
    try {
      const parsed = new URL(value.trim(), "https://inecelectionresults.ng/");
      if (parsed.protocol === "http:") parsed.protocol = "https:";
      return parsed.protocol === "https:" ? parsed.toString() : null;
    } catch {
      return null;
    }
  };

  const inspect = (value: unknown): string | null => {
    const direct = resolveUrl(value);
    if (direct) return direct;
    if (!value || typeof value !== "object") return null;
    const object = value as Record<string, unknown>;
    for (const key of ["url", "document_url", "file_url", "src", "path", "href"]) {
      const resolved = resolveUrl(object[key]);
      if (resolved) return resolved;
    }
    return null;
  };

  for (const value of [
    row.document, row.result, row.result_sheet, row.file,
    row.file_url, row.document_url, row.url, row.href,
    nestedPu?.document, nestedPu?.result, nestedPu?.result_sheet,
    nestedPu?.file, nestedPu?.file_url, nestedPu?.document_url, nestedPu?.url,
    row.old_documents, nestedPu?.old_documents,
  ]) {
    if (Array.isArray(value)) {
      for (const item of [...value].reverse()) {
        const resolved = inspect(item);
        if (resolved) return resolved;
      }
    } else {
      const resolved = inspect(value);
      if (resolved) return resolved;
    }
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
  let rowsWithDocuments = 0;
  let constructedDocuments = 0;

  for (const row of rows) {
    const nestedPu = row.polling_unit && typeof row.polling_unit === "object"
      ? row.polling_unit as Record<string, unknown>
      : null;

    const puExternalId = String(
      nestedPu?._id ?? row.polling_unit_oid ?? row.external_id ?? row._id ?? "",
    ).trim();

    const puNumericId = Number(
      nestedPu?.polling_unit_id ?? row.pu_id ?? row.polling_unit_id ?? row.id,
    );

    const puCode = String(
      row.pu_code ?? nestedPu?.pu_code ?? row.code ?? nestedPu?.code ?? "",
    ).trim() || null;

    const puName = String(
      row.name ?? row.polling_unit_name ?? nestedPu?.name ?? "",
    ).trim() || "Unknown polling unit";

    let pollingUnitId: string | null = null;

    if (puCode) {
      const lookup = await supabase
        .from("polling_units")
        .select("id")
        .eq("ward_id", wardId)
        .eq("pu_code", puCode)
        .maybeSingle();
      if (lookup.error) throw lookup.error;
      pollingUnitId = lookup.data?.id ?? null;
    }

    if (!pollingUnitId && puExternalId) {
      const lookup = await supabase
        .from("polling_units")
        .select("id")
        .eq("ward_id", wardId)
        .eq("external_id", puExternalId)
        .maybeSingle();
      if (lookup.error) throw lookup.error;
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
      const { error } = await supabase.from("polling_units").update({
        name: puName,
        external_id: puExternalId || null,
        irev_pu_id: Number.isInteger(puNumericId) ? puNumericId : null,
      }).eq("id", pollingUnitId);
      if (error) throw error;
    }

    const url = getDocumentUrl(row);

    const existing = await supabase
      .from("result_sheets")
      .select("id,status,source_url")
      .eq("election_id", electionId)
      .eq("polling_unit_id", pollingUnitId)
      .order("discovered_at", { ascending: false })
      .limit(20);

    if (existing.error) throw existing.error;

    // A polling-unit without a document is not an OCR failure. Keep the PU,
    // but never create an artificial /document SPA route.
    if (!url) {
      const staleIds = (existing.data ?? [])
        .filter(sheet => sheet.source_url?.includes("/pu/") && sheet.source_url?.endsWith("/document"))
        .map(sheet => sheet.id);

      if (staleIds.length) {
        const { error } = await supabase
          .from("result_sheets")
          .update({
            status: "skipped",
            last_error: "IReV polling-unit record has no document asset",
            evidence_status: "remote_only",
            updated_at: new Date().toISOString(),
          })
          .in("id", staleIds);
        if (error) throw error;

        const { error: jobError } = await supabase
          .from("result_processing_jobs")
          .delete()
          .in("result_sheet_id", staleIds);
        if (jobError) throw jobError;
      }

      continue;
    }

    rowsWithDocuments++;

    const document =
      row.document && typeof row.document === "object"
        ? row.document as Record<string, unknown>
        : nestedPu?.document && typeof nestedPu.document === "object"
          ? nestedPu.document as Record<string, unknown>
          : {};

    const sourceExternalId = String(
      document._id ??
      row.document_id ??
      nestedPu?.document_id ??
      puExternalId ??
      url,
    );

    const staleSheet = (existing.data ?? []).find(sheet =>
      sheet.source_url?.includes("/pu/") && sheet.source_url?.endsWith("/document")
    );

    if (staleSheet) {
      const { error: updateError } = await supabase
        .from("result_sheets")
        .update({
          source_url: url,
          source_external_id: sourceExternalId,
          status: "discovered",
          evidence_status: "remote_only",
          storage_policy: "ephemeral",
          discovered_at: new Date().toISOString(),
          last_error: null,
          processing_attempts: 0,
          processed_at: null,
        })
        .eq("id", staleSheet.id);
      if (updateError) throw updateError;

      const { error: resetJobError } = await supabase
        .from("result_processing_jobs")
        .delete()
        .eq("result_sheet_id", staleSheet.id);
      if (resetJobError) throw resetJobError;

      const { error: queueJobError } = await supabase
        .from("result_processing_jobs")
        .insert({
          result_sheet_id: staleSheet.id,
          status: "queued",
          attempts: 0,
          available_at: new Date().toISOString(),
        });
      if (queueJobError) throw queueJobError;

      sheets++;
      continue;
    }

    const result = await supabase.from("result_sheets").insert({
      election_id: electionId,
      polling_unit_id: pollingUnitId,
      source_url: url,
      source_external_id: sourceExternalId,
      status: "discovered",
      evidence_status: "remote_only",
      storage_policy: "ephemeral",
      discovered_at: new Date().toISOString(),
    }, { ignoreDuplicates: true });

    if (result.error) throw result.error;
    sheets++;

  return {
    polling_units: rows.length,
    result_sheets: sheets,
    rows_with_documents: rowsWithDocuments,
    constructed_documents: constructedDocuments,
  };
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
    // IReV sync now only discovers elections and advances the durable election/ward
    // queues. The dedicated OCR drain owns ward polling-unit discovery and result
    // processing, so this refresh function must not duplicate that expensive work.
    stage = "queue-state";
    const [{ count: remaining }, { count: wardQueue }] = await Promise.all([
      supabase.from("result_processing_jobs").select("id", { count: "exact", head: true }).in("status", ["queued", "processing"]),
      supabase.from("irev_ward_sync_jobs").select("id", { count: "exact", head: true }).in("status", ["queued", "processing"]),
    ]);
    const processed = Number(discovery?.processed ?? 0);
    const failed = Number(discovery?.failed_election_jobs ?? 0);
    const wardJobs = { processed: 0, failed: 0 };
    const queued = 0;

    await supabase.from("pipeline_runs").insert({
      started_at: started,
      finished_at: new Date().toISOString(),
      status: failed ? "completed_with_errors" : "completed",
      trigger_source: "scheduled",
      discovered: discovery?.discovered ?? 0,
      downloaded: 0,
      extracted: 0,
      failed,
      metadata: {
        mode: "scheduled-refresh",
        sheets_enqueued: queued,
        election_jobs_processed: processed,
        election_jobs_failed: failed,
        jobs_remaining: remaining ?? 0,
        ward_jobs_remaining: wardQueue ?? 0,
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
