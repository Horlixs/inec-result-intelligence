import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

Deno.serve(async request => {
  if (request.method !== "POST") return new Response("POST required", { status: 405 });

  try {
    const [sheets, extractions, entries, checks, jobs] = await Promise.all([
      supabase.from("result_sheets").select("id,status,evidence_status,processed_at,processing_attempts,last_error,source_url,evidence_url,mime_type,evidence_size_bytes").order("processed_at", { ascending: false, nullsFirst: false }).limit(10),
      supabase.from("extractions").select("id,result_sheet_id,engine,engine_version,confidence,status,created_at").order("created_at", { ascending: false }).limit(10),
      supabase.from("result_entries").select("id,extraction_id,label,votes").order("id", { ascending: false }).limit(20),
      supabase.from("validation_checks").select("id,extraction_id,check_name,passed,severity").order("id", { ascending: false }).limit(20),
      supabase.from("result_processing_jobs").select("id,result_sheet_id,status,attempts,last_error,available_at,completed_at").order("created_at", { ascending: false }).limit(20),
    ]);

    for (const result of [sheets, extractions, entries, checks, jobs]) {
      if (result.error) throw result.error;
    }

    const processed = (sheets.data ?? []).filter(x => x.processed_at);
    const successful = (sheets.data ?? []).filter(x => x.status === "verified" || x.status === "pending_review");

    return new Response(JSON.stringify({
      ok: true,
      counts: {
        result_sheets: sheets.data?.length ?? 0,
        processed_sheets: processed.length,
        success_or_review_sheets: successful.length,
        extractions: extractions.data?.length ?? 0,
        result_entries: entries.data?.length ?? 0,
        validation_checks: checks.data?.length ?? 0,
      },
      latest_sheets: (sheets.data ?? []).slice(0, 10),
      latest_extraction: extractions.data?.[0] ?? null,
      latest_entries: (entries.data ?? []).slice(0, 10),
      latest_checks: (checks.data ?? []).slice(0, 10),
      latest_jobs: (jobs.data ?? []).slice(0, 20),
    }), { headers: { "content-type": "application/json" } });
  } catch (error) {
    return new Response(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }), {
      status: 500, headers: { "content-type": "application/json" },
    });
  }
});
