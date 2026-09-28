import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const url = Deno.env.get("SUPABASE_URL")!;
const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(url, key);

async function invoke(name: string, body: unknown) {
  const response = await fetch(url.replace(/\/$/, "") + "/functions/v1/" + name, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer " + key },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok === false) throw new Error(data?.error || name + " failed with HTTP " + response.status);
  return data;
}

Deno.serve(async request => {
  if (request.method !== "POST") return new Response(JSON.stringify({ error: "POST required" }), { status: 405 });
  const started = new Date().toISOString();
  try {
    const discovery = await invoke("irev-sync", { mode: "scheduled-refresh" });
    const { data: sheets, error } = await supabase.from("result_sheets").select("id").in("status", ["discovered", "pending_review"]).order("discovered_at", { ascending: true }).limit(100);
    if (error) throw error;
    let processed = 0, failed = 0;
    for (const sheet of sheets ?? []) {
      try {
        const result = await invoke("irev-process", { result_sheet_id: sheet.id });
        result?.ok ? processed++ : failed++;
      } catch { failed++; }
    }
    await supabase.from("pipeline_runs").insert({
      started_at: started, finished_at: new Date().toISOString(),
      status: failed ? "completed_with_errors" : "completed", trigger_source: "scheduled",
      discovered: discovery?.discovered ?? 0, downloaded: processed, extracted: processed, failed,
      metadata: { mode: "scheduled-refresh", result_sheets_checked: sheets?.length ?? 0 },
    });
    return new Response(JSON.stringify({ ok: true, discovered: discovery?.discovered ?? 0, checked: sheets?.length ?? 0, processed, failed }), { headers: { "content-type": "application/json" } });
  } catch (error) {
    await supabase.from("pipeline_runs").insert({ started_at: started, finished_at: new Date().toISOString(), status: "failed", trigger_source: "scheduled", failed: 1, issues: [{ message: error instanceof Error ? error.message : String(error) }] });
    return new Response(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }), { status: 500, headers: { "content-type": "application/json" } });
  }
});