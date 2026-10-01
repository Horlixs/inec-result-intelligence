import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const geminiKey = Deno.env.get("GOOGLE_GENERATIVE_AI_API_KEY");
const ORIGIN = "https://inecelectionresults.ng";
// Deployment verification marker: Gemini secret wiring test. // deployment secret sync checkpoint
const UA = "INEC-Result-Intelligence/1.0 evidence-collector";
const MAX_EVIDENCE_BYTES = 20 * 1024 * 1024;
const IREV_API_BASE = "https://dolphin-app-sleqh.ondigitalocean.app/api/v1";
const IREV_KEY = Deno.env.get("IREV_KEY")?.trim() || null;

function sha256(bytes: Uint8Array): Promise<string> {
  return crypto.subtle.digest("SHA-256", bytes).then(buffer =>
    [...new Uint8Array(buffer)].map(x => x.toString(16).padStart(2, "0")).join("")
  );
}

function isSupportedMime(mime: string) {
  return /^image\/(jpeg|png|webp)$/i.test(mime) || mime === "application/pdf";
}

function normaliseMime(value: string | null): string {
  if (value) return value.split(";")[0].toLowerCase();
  return "application/octet-stream";
}

function inferMimeFromBytes(bytes: Uint8Array, sourceUrl: string): string {
  if (bytes.length >= 5 &&
      bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 &&
      bytes[3] === 0x46 && bytes[4] === 0x2d) {
    return "application/pdf";
  }
  if (bytes.length >= 3 &&
      bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (bytes.length >= 8 &&
      bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e &&
      bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a &&
      bytes[6] === 0x1a && bytes[7] === 0x0a) {
    return "image/png";
  }
  if (bytes.length >= 12 &&
      bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
      bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
    return "image/webp";
  }

  try {
    const path = new URL(sourceUrl).pathname.toLowerCase();
    if (/\.pdf$/.test(path)) return "application/pdf";
    if (/\.(jpe?g)$/.test(path)) return "image/jpeg";
    if (/\.png$/.test(path)) return "image/png";
    if (/\.webp$/.test(path)) return "image/webp";
  } catch {}

  return "application/octet-stream";
}

function absoluteSameOrigin(value: string, baseUrl: string): string | null {
  try {
    const url = new URL(value, baseUrl);
    return url.origin === ORIGIN && url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

async function fetchWithRetry(
  input: RequestInfo | URL,
  init: RequestInit = {},
  attempts = 4,
  timeoutMs = 20000,
): Promise<Response> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(input, { ...init, signal: controller.signal });
      if (response.ok || ![408, 429, 500, 502, 503, 504].includes(response.status) || attempt === attempts) {
        return response;
      }
      lastError = new Error("HTTP " + response.status);
      const retryAfter = Number(response.headers.get("retry-after") ?? "");
      const delay = Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(retryAfter * 1000, 15000)
        : Math.min(attempt * 2000, 8000);
      await new Promise(resolve => setTimeout(resolve, delay));
    } catch (error) {
      lastError = error;
      if (attempt === attempts) throw error;
      await new Promise(resolve => setTimeout(resolve, Math.min(attempt * 2000, 8000)));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Request failed");
}

function extractDocumentAssets(html: string, pageUrl: string): string[] {
  const assets = new Set<string>();

  const add = (value: string) => {
    const url = absoluteSameOrigin(value, pageUrl);
    if (url) assets.add(url);
  };

  const anchors = /<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi;
  for (const match of html.matchAll(anchors)) {
    const href = match[1];
    if (/\.pdf(?:$|[?#])/i.test(href) || /download|pdf|document/i.test(href)) add(href);
  }

  const media = /<(?:iframe|embed|object|img)\b[^>]*(?:src|data)=["']([^"']+)["'][^>]*>/gi;
  for (const match of html.matchAll(media)) add(match[1]);

  return [...assets];
}

function pollingUnitRows(payload: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(payload)) {
    return payload.filter((value): value is Record<string, unknown> =>
      !!value && typeof value === "object"
    );
  }
  if (!payload || typeof payload !== "object") return [];
  const object = payload as Record<string, unknown>;
  for (const key of ["data", "polling_units", "pus", "results", "items"]) {
    const value = object[key];
    if (Array.isArray(value)) {
      return value.filter((item): item is Record<string, unknown> =>
        !!item && typeof item === "object"
      );
    }
  }
  return [];
}

function extractDocumentUrl(row: Record<string, unknown>): { url: string; documentId: string | null } | null {
  const nestedPu = row.polling_unit && typeof row.polling_unit === "object"
    ? row.polling_unit as Record<string, unknown>
    : null;

  const candidates: unknown[] = [
    row.document,
    row.result,
    row.result_sheet,
    row.file,
    row.file_url,
    row.document_url,
    row.url,
    row.href,
    nestedPu?.document,
    nestedPu?.result,
    nestedPu?.result_sheet,
    nestedPu?.file,
    nestedPu?.file_url,
    nestedPu?.document_url,
    nestedPu?.url,
    nestedPu?.href,
  ];

  const inspect = (value: unknown): { url: string; documentId: string | null } | null => {
    if (typeof value === "string" && value.trim()) {
      try {
        const url = new URL(value.trim(), ORIGIN + "/");
        if (url.protocol === "http:") url.protocol = "https:";
        if (url.protocol !== "https:") return null;
        return { url: url.toString(), documentId: null };
      } catch {
        return null;
      }
    }

    if (!value || typeof value !== "object") return null;

    const object = value as Record<string, unknown>;
    const documentId = String(
      object._id ?? object.id ?? object.document_id ?? ""
    ).trim() || null;

    for (const key of ["url", "document_url", "file_url", "src", "path", "href"]) {
      const found = inspect(object[key]);
      if (found) return { ...found, documentId: found.documentId ?? documentId };
    }

    // Some API responses wrap the actual asset one level deeper.
    for (const key of ["document", "result", "result_sheet", "file"]) {
      const found = inspect(object[key]);
      if (found) return { ...found, documentId: found.documentId ?? documentId };
    }

    return null;
  };

  for (const candidate of candidates) {
    const found = inspect(candidate);
    if (found) return found;
  }

  return null;
}

async function resolveCanonicalIrevSource(
  sheet: Record<string, unknown>,
  sourceUrl: string,
): Promise<{ url: string; documentId: string | null }> {
  let parsed: URL;
  try {
    parsed = new URL(sourceUrl);
  } catch {
    return { url: sourceUrl, documentId: null };
  }

  const match = parsed.pathname.match(
    /^\/elections\/([^/]+)\/pu\/([^/]+)\/document(?:\/)?$/,
  );
  if (!match) return { url: sourceUrl, documentId: null };

  const electionExternalId = decodeURIComponent(match[1]);
  const routePuId = decodeURIComponent(match[2]);
  const pollingUnitId = String(sheet.polling_unit_id ?? "").trim();
  if (!pollingUnitId) return { url: sourceUrl, documentId: null };

  const { data: pollingUnit, error: pollingUnitError } = await supabase
    .from("polling_units")
    .select("external_id,ward_id,pu_code,name,irev_pu_id")
    .eq("id", pollingUnitId)
    .single();
  if (pollingUnitError || !pollingUnit) {
    throw new Error(
      "Polling unit identity unavailable while resolving IReV document: " +
      (pollingUnitError?.message ?? "not found"),
    );
  }

  const { data: ward, error: wardError } = await supabase
    .from("wards")
    .select("irev_ward_oid,irev_ward_id")
    .eq("id", pollingUnit.ward_id)
    .single();
  if (wardError || !ward?.irev_ward_oid) {
    throw new Error(
      "Ward IReV identity unavailable while resolving IReV document: " +
      (wardError?.message ?? "not found"),
    );
  }

  const requestHeaders = {
    "user-agent": UA,
    accept: "application/json, text/plain, */*",
    origin: ORIGIN,
    referer: ORIGIN + "/",
    ...(IREV_KEY ? { "x-api-key": IREV_KEY } : {}),
    "x-api-rt": String(Date.now()),
  };

  const fetchWardRows = async (wardOid: string) => {
    const response = await fetchWithRetry(
      IREV_API_BASE + "/elections/" + encodeURIComponent(electionExternalId) +
      "/pus?ward=" + encodeURIComponent(wardOid),
      { headers: requestHeaders },
      4,
      20000,
    );

    if (!response.ok) {
      throw new Error("IReV document resolution HTTP " + response.status);
    }

    const text = await response.text();
    const payload = text ? JSON.parse(text) : null;
    return pollingUnitRows(payload);
  };

  let rows = await fetchWardRows(String(ward.irev_ward_oid));
  let resolvedWardOid = String(ward.irev_ward_oid);

  // Some IReV records have a stale/alternate ward object id. The public
  // collector resolves this through the election /lga hierarchy before calling
  // /pus, so mirror that behavior here instead of treating an empty /pus
  // response as a document-page problem.
  if (!rows.length) {
    const hierarchyResponse = await fetchWithRetry(
      IREV_API_BASE + "/elections/" + encodeURIComponent(electionExternalId) + "/lga",
      { headers: requestHeaders },
      4,
      20000,
    );
    if (!hierarchyResponse.ok) {
      throw new Error("IReV ward hierarchy resolution HTTP " + hierarchyResponse.status);
    }

    const hierarchyText = await hierarchyResponse.text();
    const hierarchy = hierarchyText ? JSON.parse(hierarchyText) : null;
    const hierarchyRows = hierarchy && typeof hierarchy === "object"
      ? (hierarchy as Record<string, unknown>).data
      : null;

    let matchedWardOid: string | null = null;
    if (Array.isArray(hierarchyRows)) {
      const targetOid = String(ward.irev_ward_oid).toLowerCase();
      const targetNumeric = Number(ward.irev_ward_id);

      outer:
      for (const lgaEntry of hierarchyRows) {
        if (!lgaEntry || typeof lgaEntry !== "object") continue;
        const lga = lgaEntry as Record<string, unknown>;
        const wardRows = Array.isArray(lga.wards) ? lga.wards : [];
        for (const wardEntry of wardRows) {
          if (!wardEntry || typeof wardEntry !== "object") continue;
          const candidate = wardEntry as Record<string, unknown>;
          const candidateOid = String(candidate._id ?? "").trim();
          const candidateNumeric = Number(candidate.ward_id ?? candidate.id);
          if (
            candidateOid &&
            (
              candidateOid.toLowerCase() === targetOid ||
              (Number.isInteger(targetNumeric) && Number.isInteger(candidateNumeric) && candidateNumeric === targetNumeric)
            )
          ) {
            matchedWardOid = candidateOid;
            break outer;
          }
        }
      }
    }

    if (matchedWardOid && matchedWardOid !== resolvedWardOid) {
      rows = await fetchWardRows(matchedWardOid);
      resolvedWardOid = matchedWardOid;
    }
  }

  const normaliseName = (value: unknown) =>
    String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");

  const targetExternalId = String(pollingUnit.external_id ?? "").trim();
  const targetCode = String(pollingUnit.pu_code ?? "").trim();
  const targetName = normaliseName(pollingUnit.name);
  const targetNumericId = Number(pollingUnit.irev_pu_id);

  let matchedRow: Record<string, unknown> | null = null;

  for (const row of rows) {
    const nestedPu = row.polling_unit && typeof row.polling_unit === "object"
      ? row.polling_unit as Record<string, unknown>
      : null;

    const rowIds = [
      nestedPu?._id,
      row.polling_unit_oid,
      row.external_id,
      row._id,
    ].map(value => String(value ?? "").trim()).filter(Boolean);

    const rowNumericId = Number(
      nestedPu?.polling_unit_id ?? row.pu_id ?? row.polling_unit_id ?? row.id,
    );
    const rowCode = String(
      row.pu_code ?? nestedPu?.pu_code ?? row.code ?? nestedPu?.code ?? "",
    ).trim();
    const rowName = normaliseName(
      row.name ?? row.polling_unit_name ?? nestedPu?.name,
    );

    const idMatch =
      rowIds.includes(routePuId) ||
      (targetExternalId && rowIds.includes(targetExternalId));
    const numericMatch =
      Number.isInteger(targetNumericId) &&
      Number.isInteger(rowNumericId) &&
      targetNumericId === rowNumericId;
    const codeMatch =
      Boolean(targetCode) &&
      Boolean(rowCode) &&
      targetCode.toLowerCase() === rowCode.toLowerCase();
    const nameMatch =
      Boolean(targetName) &&
      Boolean(rowName) &&
      targetName === rowName;

    if (idMatch || numericMatch || codeMatch || nameMatch) {
      matchedRow = row;
      break;
    }
  }

  if (!matchedRow) {
    throw new Error(
      "IReV direct document could not be matched for polling unit " +
      JSON.stringify({
        route_pu_id: routePuId,
        local_external_id: targetExternalId || null,
        local_pu_code: targetCode || null,
        local_name: targetName || null,
        local_irev_pu_id: Number.isInteger(targetNumericId) ? targetNumericId : null,
        ward_oid: resolvedWardOid,
        rows_received: rows.length,
      }),
    );
  }

  const document = extractDocumentUrl(matchedRow);
  if (!document) {
    throw new Error(
      "IReV polling-unit record matched, but it contains no direct document URL: " +
      JSON.stringify({
        route_pu_id: routePuId,
        local_pu_code: targetCode || null,
        local_name: targetName || null,
        ward_oid: resolvedWardOid,
      }),
    );
  }

  return document;
}

async function fetchEvidence(sourceUrl: string) {
  const first = await fetchWithRetry(sourceUrl, { headers: { "user-agent": UA, accept: "application/pdf,image/jpeg,image/png,image/webp,text/html,*/*" } });
  if (!first.ok) throw new Error("Source returned HTTP " + first.status);

  const declaredMime = normaliseMime(first.headers.get("content-type"));
  const firstBytes = new Uint8Array(await first.arrayBuffer());
  if (!firstBytes.length) throw new Error("Source returned an empty document.");
  if (firstBytes.byteLength > MAX_EVIDENCE_BYTES) {
    throw new Error("Evidence document exceeds the 20 MB processing limit.");
  }

  const inferredMime = inferMimeFromBytes(firstBytes, sourceUrl);
  const firstMime = isSupportedMime(declaredMime) ? declaredMime : inferredMime;

  if (isSupportedMime(firstMime)) {
    return { bytes: firstBytes, mime: firstMime, assetUrl: sourceUrl };
  }

  if (declaredMime !== "text/html") {
    throw new Error("Unsupported evidence MIME type: " + firstMime);
  }

  const html = new TextDecoder().decode(firstBytes);
  const assets = extractDocumentAssets(html, sourceUrl);

  const ranked = assets.sort((a, b) => {
    const score = (url: string) => /\.pdf(?:$|[?#])/i.test(url) ? 0 : /document|download/i.test(url) ? 1 : 2;
    return score(a) - score(b);
  });

  for (const assetUrl of ranked) {
    try {
      const response = await fetchWithRetry(assetUrl, { headers: { "user-agent": UA, referer: sourceUrl } }, 3, 15000);
      if (!response.ok) continue;

      const mime = normaliseMime(response.headers.get("content-type"));
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length > MAX_EVIDENCE_BYTES) continue;
      if (bytes.length && isSupportedMime(mime)) {
        return { bytes, mime, assetUrl };
      }
    } catch {
      // Try the next candidate asset.
    }
  }

  throw new Error("IReV document page did not expose a supported PDF or image asset.");
}

function validateExtracted(extracted: {
  registeredVoters?: number | null;
  accreditedVoters?: number | null;
  rejectedVotes?: number | null;
  candidates: Array<{ label: string; votes: number | null }>;
}) {
  const issues: Array<{ code: string; severity: "error" | "warning"; details: Record<string, unknown> }> = [];
  const labels = new Set<string>();

  if (!Array.isArray(extracted.candidates) || extracted.candidates.length === 0) {
    issues.push({ code: "no_candidate_rows", severity: "error", details: {} });
  }

  for (const candidate of extracted.candidates ?? []) {
    const label = String(candidate?.label ?? "").trim();
    if (!label) {
      issues.push({ code: "candidate_label_missing", severity: "error", details: {} });
      continue;
    }
    const key = label.toLowerCase();
    if (labels.has(key)) {
      issues.push({ code: "duplicate_candidate_label", severity: "error", details: { label } });
    }
    labels.add(key);

    if (candidate.votes !== null && (!Number.isInteger(candidate.votes) || candidate.votes < 0)) {
      issues.push({ code: "candidate_votes_invalid", severity: "error", details: { label, votes: candidate.votes } });
    }
  }

  const registered = extracted.registeredVoters;
  const accredited = extracted.accreditedVoters;
  const rejected = extracted.rejectedVotes;

  for (const [name, value] of [["registeredVoters", registered], ["accreditedVoters", accredited], ["rejectedVotes", rejected]] as const) {
    if (value !== null && value !== undefined && (!Number.isInteger(value) || value < 0)) {
      issues.push({ code: name + "_invalid", severity: "error", details: { value } });
    }
  }

  if (Number.isInteger(registered) && Number.isInteger(accredited) && accredited! > registered!) {
    issues.push({ code: "accredited_exceeds_registered", severity: "error", details: { registered, accredited } });
  }

  const knownVotes = (extracted.candidates ?? [])
    .map(candidate => candidate.votes)
    .filter((value): value is number => Number.isInteger(value) && value >= 0);

  if (Number.isInteger(accredited) && Number.isInteger(rejected) && knownVotes.length === (extracted.candidates ?? []).length) {
    const total = knownVotes.reduce((sum, value) => sum + value, 0) + rejected!;
    if (total !== accredited!) {
      issues.push({
        code: "vote_total_mismatch",
        severity: "warning",
        details: { candidate_votes: knownVotes.reduce((sum, value) => sum + value, 0), rejected_votes: rejected, accredited_voters: accredited, total },
      });
    }
  } else if (Number.isInteger(accredited) && knownVotes.length === (extracted.candidates ?? []).length && rejected == null) {
    const total = knownVotes.reduce((sum, value) => sum + value, 0);
    if (total > accredited!) {
      issues.push({
        code: "candidate_votes_exceed_accredited",
        severity: "error",
        details: { candidate_votes: total, accredited_voters: accredited },
      });
    }
  }

  return {
    valid: issues.every(issue => issue.severity !== "error"),
    issues,
  };
}

async function extractWithGemini(bytes: Uint8Array, mime: string) {
  if (!geminiKey) throw new Error("GOOGLE_GENERATIVE_AI_API_KEY is not configured.");
  if (!isSupportedMime(mime)) throw new Error("Unsupported evidence MIME type: " + mime);

  const prompt = `Extract the polling-unit election result sheet in this document. Return ONLY JSON:
{"pollingUnitName":string|null,"pollingUnitCode":string|null,"registeredVoters":number|null,"accreditedVoters":number|null,"rejectedVotes":number|null,"candidates":[{"label":string,"votes":number|null}],"confidence":number}
Do not guess. If a value is unreadable, use null. Preserve candidate labels as written. confidence must be between 0 and 1.
If this is a PDF, inspect the document visually and use the result sheet itself, not surrounding metadata.`;

  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunkSize, bytes.length)));
  }
  const base64 = btoa(binary);

  const body = {
    contents: [{
      parts: [
        { text: prompt },
        { inline_data: { mime_type: mime, data: base64 } },
      ],
    }],
    generationConfig: { temperature: 0, responseMimeType: "application/json", maxOutputTokens: 2048 },
  };

  const endpoint = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent";
  let response: Response | null = null;
  let lastError = "";

  for (let attempt = 1; attempt <= 3; attempt++) {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": geminiKey,
      },
      body: JSON.stringify(body),
    });

    if (response.ok) break;

    const message = (await response.text()).slice(0, 1000);
    lastError = "Gemini returned HTTP " + response.status + ": " + message;

    if (![429, 500, 502, 503, 504].includes(response.status) || attempt === 3) {
      throw new Error(lastError);
    }

    await new Promise(resolve => setTimeout(resolve, attempt * 3000));
  }

  if (!response || !response.ok) {
    throw new Error(lastError || "Gemini request failed.");
  }

  const json = await response.json();
  const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini returned no extraction.");

  return JSON.parse(text);
}

Deno.serve(async request => {
  if (request.method !== "POST") return new Response("POST required", { status: 405 });

  let payload: { result_sheet_id?: string } = {};
  try { payload = await request.json(); } catch { /* empty body */ }

  if (!payload.result_sheet_id) {
    return new Response(JSON.stringify({ ok: false, error: "result_sheet_id is required" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const id = payload.result_sheet_id;
  const { data: sheet, error: loadError } = await supabase
    .from("result_sheets")
    .select("*")
    .eq("id", id)
    .single();

  if (loadError || !sheet) {
    return new Response(JSON.stringify({
      ok: false,
      error: loadError?.message || "Result sheet not found",
    }), { status: 404 });
  }

  // A verified sheet is a terminal ingestion state. Never fetch or OCR it again
  // from a retry/manual invocation; discovery also ignores existing rows.
  if (sheet.status === "verified") {
    return new Response(JSON.stringify({
      ok: true,
      result_sheet_id: id,
      status: "already_verified",
      evidence_retained: false,
      source_url: sheet.source_url,
      processed_at: sheet.processed_at ?? null,
    }), { headers: { "content-type": "application/json" } });
  }

  const attempt = (sheet.processing_attempts ?? 0) + 1;

  await supabase.from("result_sheets").update({
    status: "downloaded",
    evidence_status: "processing",
    processing_attempts: attempt,
    last_error: null,
  }).eq("id", id);

  try {
    const resolvedSource = await resolveCanonicalIrevSource(sheet, sheet.source_url);
    if (resolvedSource.url !== sheet.source_url) {
      const { error: sourceUpdateError } = await supabase.from("result_sheets").update({
        source_url: resolvedSource.url,
        ...(resolvedSource.documentId ? { source_external_id: resolvedSource.documentId } : {}),
      }).eq("id", id);
      if (sourceUpdateError) throw sourceUpdateError;
    }

    const evidence = await fetchEvidence(resolvedSource.url);
    const hash = await sha256(evidence.bytes);

    if (sheet.source_hash === hash && sheet.status === "verified") {
      await supabase.from("result_sheets").update({
        evidence_status: "remote_only",
        processed_at: new Date().toISOString(),
        last_error: null,
      }).eq("id", id);

      return new Response(JSON.stringify({
        ok: true,
        result_sheet_id: id,
        status: "unchanged",
        evidence_retained: false,
        source_hash: hash,
        source_url: sheet.source_url,
        evidence_url: evidence.assetUrl,
        mime_type: evidence.mime,
        evidence_size_bytes: evidence.bytes.byteLength,
      }), { headers: { "content-type": "application/json" } });
    }

    await supabase.from("result_sheets").update({
      source_hash: hash,
      storage_path: null,
      mime_type: evidence.mime,
      evidence_url: evidence.assetUrl,
      evidence_size_bytes: evidence.bytes.byteLength,
      source_fetched_at: new Date().toISOString(),
      captured_at: new Date().toISOString(),
    }).eq("id", id);

    const extracted = await extractWithGemini(evidence.bytes, evidence.mime);
    const candidates = Array.isArray(extracted.candidates) ? extracted.candidates : [];
    const validation = validateExtracted({ ...extracted, candidates });
    const confidence = Number(extracted.confidence);
    const confidenceValid = Number.isFinite(confidence) && confidence >= 0 && confidence <= 1;

    const extractionStatus =
      validation.valid && confidenceValid && confidence >= 0.85
        ? "verified"
        : "pending_review";

    const { data: extraction, error: extractionError } = await supabase
      .from("extractions")
      .insert({
        result_sheet_id: id,
        engine: "google-gemini",
        engine_version: "gemini-3.5-flash-lite",
        raw_output: extracted,
        confidence: Number.isFinite(confidence) ? confidence : null,
        status: extractionStatus,
      })
      .select("id")
      .single();

    if (extractionError || !extraction) {
      throw extractionError || new Error("Extraction was not saved.");
    }

    const entries = candidates.map((candidate: { label: string; votes: number | null }) => ({
      extraction_id: extraction.id,
      label: candidate.label,
      votes: candidate.votes,
      raw_label: candidate.label,
      raw_value: candidate.votes === null ? null : String(candidate.votes),
    }));

    if (entries.length) {
      const { error } = await supabase.from("result_entries").insert(entries);
      if (error) throw error;
    }

    const checks = [
      {
        check_name: "deterministic_result_validation",
        passed: validation.valid,
        severity: validation.valid ? "info" : "error",
        details: { issues: validation.issues, candidate_count: candidates.length },
      },
      {
        check_name: "extraction_confidence_range",
        passed: confidenceValid,
        severity: "error",
        details: { confidence },
      },
      {
        check_name: "source_sha256_recorded",
        passed: Boolean(hash),
        severity: "info",
        details: {
          sha256: hash,
          source_url: sheet.source_url,
          evidence_url: evidence.assetUrl,
          mime_type: evidence.mime,
          byte_length: evidence.bytes.byteLength,
        },
      },
    ];

    await supabase.from("validation_checks").insert(
      checks.map(x => ({ ...x, extraction_id: extraction.id })),
    );

    await supabase.from("result_sheets").update({
      status: extractionStatus,
      evidence_status: "remote_only",
      storage_path: null,
      processed_at: new Date().toISOString(),
      last_error: null,
    }).eq("id", id);

    return new Response(JSON.stringify({
      ok: true,
      result_sheet_id: id,
      extraction_id: extraction.id,
      status: extractionStatus,
      evidence_retained: false,
      source_hash: hash,
      source_url: sheet.source_url,
      evidence_url: evidence.assetUrl,
      mime_type: evidence.mime,
      evidence_size_bytes: evidence.bytes.byteLength,
    }), { headers: { "content-type": "application/json" } });
  } catch (error) {
    await supabase.from("result_sheets").update({
      status: "pending_review",
      evidence_status: "remote_only",
      processing_attempts: attempt,
      last_error: error instanceof Error ? error.message : String(error),
    }).eq("id", id);

    return new Response(JSON.stringify({
      ok: false,
      result_sheet_id: id,
      error: error instanceof Error ? error.message : String(error),
      evidence_retained: false,
    }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
});
