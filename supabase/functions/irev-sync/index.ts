import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { discoverFromHtml, extractSameOriginLinks } from "./parser.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const ORIGIN = "https://inecelectionresults.ng";
const UA = "INEC-Result-Intelligence/1.0 source-collector";

function extractLinks(html: string, pageUrl: string): string[] {
  const links = new Set<string>();
  const add = (value: string) => {
    try {
      const url = new URL(value, pageUrl);
      if (url.origin !== ORIGIN || url.protocol !== "https:") return;
      links.add(url.toString());
    } catch { /* ignore malformed URLs */ }
  };

  const anchors = /<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi;
  for (const match of html.matchAll(anchors)) add(match[1]);

  const media = /<(?:img|iframe|embed|object)\b[^>]*(?:src|data)=["']([^"']+)["'][^>]*>/gi;
  for (const match of html.matchAll(media)) add(match[1]);

  return [...links];
}

function isDocumentUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.toLowerCase();
    return /\/document(?:$|\/)/.test(path) ||
      /\.(pdf|jpe?g|png|webp)$/i.test(path) ||
      /result|resultsheet|sheet|upload/.test(path);
  } catch {
    return false;
  }
}

function isCrawlablePage(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.origin !== ORIGIN) return false;
    const path = parsed.pathname.toLowerCase();
    return path.startsWith("/elections/") && !isDocumentUrl(url);
  } catch {
    return false;
  }
}

async function crawlElection(sourceUrl: string): Promise<string[]> {
  const queue: Array<{ url: string; depth: number }> = [{ url: sourceUrl, depth: 0 }];
  const visited = new Set<string>();
  const resultPages = new Set<string>();
  const maxPages = 750;

  while (queue.length && visited.size < maxPages) {
    const current = queue.shift()!;
    if (visited.has(current.url)) continue;
    visited.add(current.url);

    let response: Response;
    try {
      response = await fetch(current.url, { headers: { "user-agent": UA } });
    } catch {
      continue;
    }
    if (!response.ok) continue;

    const contentType = (response.headers.get("content-type") || "").toLowerCase();
    if (!contentType.includes("text/html")) {
      if (isDocumentUrl(current.url)) resultPages.add(current.url);
      continue;
    }

    const html = await response.text();
    for (const link of extractLinks(html, current.url)) {
      if (isDocumentUrl(link)) {
        resultPages.add(link);
        continue;
      }
      if (current.depth < 4 && isCrawlablePage(link) && !visited.has(link)) {
        queue.push({ url: link, depth: current.depth + 1 });
      }
    }
  }

  return [...resultPages];
}

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST required" }), {
      status: 405,
      headers: { "content-type": "application/json" },
    });
  }

  const startedAt = new Date().toISOString();

  try {
    const response = await fetch(ORIGIN + "/", { headers: { "user-agent": UA } });
    if (!response.ok) throw new Error("IReV returned HTTP " + response.status);

    const homepageHtml = await response.text();
    const discovered = new Map<string, ReturnType<typeof discoverFromHtml>[number]>();
    for (const election of discoverFromHtml(homepageHtml)) discovered.set(election.external_id, election);

    // The current IReV homepage is application-driven and may expose the
    // election directory through category/navigation pages instead of direct
    // anchor tags in the initial HTML. Follow a small bounded set of same-origin
    // HTML links so discovery does not depend on the homepage rendering mode.
    const queue = extractSameOriginLinks(homepageHtml);
    const visited = new Set<string>([ORIGIN + "/"]);
    let scannedDirectoryPages = 0;
    while (queue.length && scannedDirectoryPages < 50) {
      const pageUrl = queue.shift()!;
      if (visited.has(pageUrl)) continue;
      visited.add(pageUrl);

      let pageResponse: Response;
      try {
        pageResponse = await fetch(pageUrl, { headers: { "user-agent": UA } });
      } catch {
        continue;
      }
      if (!pageResponse.ok) continue;
      const contentType = (pageResponse.headers.get("content-type") || "").toLowerCase();
      if (!contentType.includes("text/html")) continue;

      scannedDirectoryPages++;
      const pageHtml = await pageResponse.text();
      for (const election of discoverFromHtml(pageHtml)) discovered.set(election.external_id, election);

      for (const link of extractSameOriginLinks(pageHtml)) {
        try {
          const parsed = new URL(link);
          if (!visited.has(link) && !parsed.pathname.toLowerCase().startsWith("/elections/")) {
            queue.push(link);
          }
        } catch {
          // ignore malformed links
        }
      }
    }

    const elections = [...discovered.values()];

    if (elections.length) {
      const { error } = await supabase
        .from("elections")
        .upsert(elections, { onConflict: "external_id" });
      if (error) throw error;
    }

    let resultSheetsDiscovered = 0;
    const electionStats: Array<Record<string, unknown>> = [];

    for (const election of elections) {
      try {
        const { data: savedElection } = await supabase
          .from("elections")
          .select("id")
          .eq("external_id", election.external_id)
          .maybeSingle();

        if (!savedElection?.id) continue;

        const resultLinks = await crawlElection(election.source_url);

        const rows = resultLinks.map(url => ({
          election_id: savedElection.id,
          source_url: url,
          source_external_id: url,
          status: "discovered",
          evidence_status: "remote_only",
          storage_policy: "ephemeral",
        }));

        if (rows.length) {
          const { error } = await supabase
            .from("result_sheets")
            .upsert(rows, {
              onConflict: "election_id,source_url",
              ignoreDuplicates: true,
            });
          if (!error) resultSheetsDiscovered += rows.length;
        }

        electionStats.push({
          external_id: election.external_id,
          pages_scanned: "bounded",
          result_links: resultLinks.length,
        });
      } catch (error) {
        electionStats.push({
          external_id: election.external_id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    await supabase.from("pipeline_runs").insert({
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      status: "completed",
      trigger_source: "server",
      discovered: elections.length,
      metadata: {
        source: "IReV",
        mode: "server-side-bounded-crawl",
        result_sheets_discovered: resultSheetsDiscovered,
        elections: electionStats,
      },
    });

    return new Response(JSON.stringify({
      ok: true,
      discovered: elections.length,
      result_sheets_discovered: resultSheetsDiscovered,
      elections: electionStats,
    }), {
      headers: { "content-type": "application/json" },
    });
  } catch (error) {
    await supabase.from("pipeline_runs").insert({
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      status: "failed",
      trigger_source: "server",
      failed: 1,
      issues: [{ message: error instanceof Error ? error.message : String(error) }],
      metadata: { source: "IReV" },
    });

    return new Response(JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
});
