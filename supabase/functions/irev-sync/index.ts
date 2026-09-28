import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { discoverFromHtml } from "./parser.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

function extractResultLinks(html: string, origin: string): string[] {
  const pattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const links = new Set<string>();
  for (const match of html.matchAll(pattern)) {
    const href = match[1];
    const text = match[2].replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
    if (!/result|polling|sheet|view/.test(text + " " + href.toLowerCase())) continue;
    try {
      const url = new URL(href, origin);
      if (url.origin === origin && url.pathname !== "/") links.add(url.toString());
    } catch { /* ignore malformed links */ }
  }
  return [...links];
}

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST required" }), { status: 405, headers: { "content-type": "application/json" } });
  }

  const startedAt = new Date().toISOString();

  try {
    const response = await fetch("https://inecelectionresults.ng/", {
      headers: { "user-agent": "INEC-Result-Intelligence/1.0 source-collector" },
    });
    if (!response.ok) throw new Error("IReV returned HTTP " + response.status);

    const html = await response.text();
    const elections = discoverFromHtml(html);

    if (elections.length) {
      const { error } = await supabase.from("elections").upsert(elections, { onConflict: "external_id" });
      if (error) throw error;
    }

    let resultSheetsDiscovered = 0;

    for (const election of elections) {
      try {
        const page = await fetch(election.source_url, {
          headers: { "user-agent": "INEC-Result-Intelligence/1.0 source-collector" },
        });
        if (!page.ok) continue;

        const pageHtml = await page.text();
        const resultLinks = extractResultLinks(pageHtml, "https://inecelectionresults.ng");

        const { data: savedElection } = await supabase
          .from("elections")
          .select("id")
          .eq("external_id", election.external_id)
          .maybeSingle();

        if (!savedElection?.id || !resultLinks.length) continue;

        const rows = resultLinks.map(url => ({
          election_id: savedElection.id,
          source_url: url,
          source_external_id: url,
          status: "discovered",
          evidence_status: "stored",
          storage_policy: "ephemeral",
        }));

        const { error } = await supabase
          .from("result_sheets")
          .upsert(rows, { onConflict: "election_id,source_url", ignoreDuplicates: true });

        if (!error) resultSheetsDiscovered += rows.length;
      } catch {
        // One inaccessible election page must not stop the entire discovery run.
      }
    }

    await supabase.from("pipeline_runs").insert({
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      status: "completed",
      discovered: elections.length,
      metadata: {
        source: "IReV",
        mode: "server-side-discovery",
        result_sheets_discovered: resultSheetsDiscovered,
      },
    });

    return new Response(JSON.stringify({
      ok: true,
      discovered: elections.length,
      result_sheets_discovered: resultSheetsDiscovered,
      elections,
      source: "https://inecelectionresults.ng/",
    }), { headers: { "content-type": "application/json" } });
  } catch (error) {
    await supabase.from("pipeline_runs").insert({
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      status: "failed",
      failed: 1,
      issues: [{ message: error instanceof Error ? error.message : String(error) }],
      metadata: { source: "IReV", mode: "server-side-discovery" },
    });

    return new Response(JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }), { status: 500, headers: { "content-type": "application/json" } });
  }
});
