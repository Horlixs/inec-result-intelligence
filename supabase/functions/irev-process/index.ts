import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const geminiKey = Deno.env.get("GOOGLE_GENERATIVE_AI_API_KEY");

function sha256(bytes: Uint8Array): Promise<string> {
  return crypto.subtle.digest("SHA-256", bytes).then(buffer =>
    [...new Uint8Array(buffer)].map(x => x.toString(16).padStart(2, "0")).join("")
  );
}

function isImage(mime: string) {
  return /^image\/(jpeg|png|webp)$/i.test(mime);
}

function normaliseMime(value: string | null): string {
  if (value) return value.split(";")[0].toLowerCase();
  return "application/octet-stream";
}

function safeName(url: string) {
  return url.replace(/^https?:\/\//, "").replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 180);
}

function validate(values: Array<{ label: string; votes: number | null }>) {
  return values.every(x => x.label && (x.votes === null || (Number.isInteger(x.votes) && x.votes >= 0)));
}

async function extractWithGemini(bytes: Uint8Array, mime: string) {
  if (!geminiKey) throw new Error("GOOGLE_GENERATIVE_AI_API_KEY is not configured.");
  if (!isImage(mime)) throw new Error("Downloaded result is not a supported image. PDF/document OCR adapter is required before processing this file.");

  const prompt = `Extract the polling-unit election result sheet in this image. Return ONLY JSON:
{"pollingUnitName":string|null,"pollingUnitCode":string|null,"registeredVoters":number|null,"accreditedVoters":number|null,"rejectedVotes":number|null,"candidates":[{"label":string,"votes":number|null}],"confidence":number}
Do not guess. If a value is unreadable, use null. Preserve candidate labels as written. confidence must be between 0 and 1.`;

  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunkSize, bytes.length)));
  }
  const base64 = btoa(binary);

  const body = {
    contents: [{ parts: [
      { text: prompt },
      { inline_data: { mime_type: mime, data: base64 } },
    ]}],
    generationConfig: { temperature: 0, responseMimeType: "application/json" },
  };

  const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" + encodeURIComponent(geminiKey), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error("Gemini returned HTTP " + response.status);
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
    return new Response(JSON.stringify({ ok: false, error: "result_sheet_id is required" }), { status: 400 });
  }

  const id = payload.result_sheet_id;
  const { data: sheet, error: loadError } = await supabase.from("result_sheets").select("*").eq("id", id).single();
  if (loadError || !sheet) return new Response(JSON.stringify({ ok: false, error: loadError?.message || "Result sheet not found" }), { status: 404 });

  const attempt = (sheet.processing_attempts ?? 0) + 1;
  await supabase.from("result_sheets").update({ status: "downloaded", evidence_status: "processing", processing_attempts: attempt, last_error: null }).eq("id", id);

  let storagePath = sheet.storage_path as string | null;
  try {
    const source = await fetch(sheet.source_url, { headers: { "user-agent": "INEC-Result-Intelligence/1.0 evidence-collector" } });
    if (!source.ok) throw new Error("Source returned HTTP " + source.status);

    const bytes = new Uint8Array(await source.arrayBuffer());
    if (!bytes.length) throw new Error("Source returned an empty document.");

    const mime = normaliseMime(source.headers.get("content-type"));
    const hash = await sha256(bytes);

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
      }), { headers: { "content-type": "application/json" } });
    }

    await supabase.from("result_sheets").update({
      source_hash: hash,
      storage_path: null,
      mime_type: mime,
      captured_at: new Date().toISOString(),
    }).eq("id", id);

    const extracted = await extractWithGemini(bytes, mime);
    const candidates = Array.isArray(extracted.candidates) ? extracted.candidates : [];
    const structurallyValid = validate(candidates);
    const confidence = Number(extracted.confidence);
    const extractionStatus = structurallyValid && Number.isFinite(confidence) && confidence >= 0 && confidence <= 1
      ? (confidence >= 0.85 ? "verified" : "pending_review")
      : "pending_review";

    const { data: extraction, error: extractionError } = await supabase.from("extractions").insert({
      result_sheet_id: id,
      engine: "google-gemini",
      engine_version: "gemini-2.5-flash",
      raw_output: extracted,
      confidence: Number.isFinite(confidence) ? confidence : null,
      status: extractionStatus,
    }).select("id").single();
    if (extractionError || !extraction) throw extractionError || new Error("Extraction was not saved.");

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
      { check_name: "candidate_votes_nonnegative_integer", passed: structurallyValid, severity: structurallyValid ? "info" : "error", details: { count: candidates.length } },
      { check_name: "extraction_confidence_range", passed: Number.isFinite(confidence) && confidence >= 0 && confidence <= 1, severity: "error", details: { confidence } },
      { check_name: "source_sha256_recorded", passed: Boolean(hash), severity: "info", details: { sha256: hash } },
    ];
    await supabase.from("validation_checks").insert(checks.map(x => ({ ...x, extraction_id: extraction.id })));

    // Remote-only evidence policy: keep the canonical source URL and hash,
    // but never persist the downloaded document bytes in Supabase Storage.
    const keepRemoteSource = true;

    await supabase.from("result_sheets").update({
      status: extractionStatus,
      evidence_status: "remote_only",
      storage_path: null,
      processed_at: new Date().toISOString(),
      last_error: null,
    }).eq("id", id);

    return new Response(JSON.stringify({ ok: true, result_sheet_id: id, extraction_id: extraction.id, status: extractionStatus, evidence_retained: keepRemoteSource, source_hash: hash }), { headers: { "content-type": "application/json" } });
  } catch (error) {
    await supabase.from("result_sheets").update({
      status: "pending_review",
      evidence_status: "stored",
      processing_attempts: attempt,
      last_error: error instanceof Error ? error.message : String(error),
    }).eq("id", id);

    return new Response(JSON.stringify({ ok: false, result_sheet_id: id, error: error instanceof Error ? error.message : String(error), evidence_retained: false }), { status: 500, headers: { "content-type": "application/json" } });
  }
});
