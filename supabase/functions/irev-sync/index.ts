import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { classifyElection, discoverFromHtml, extractSameOriginLinks } from "./parser.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const ORIGIN = "https://inecelectionresults.ng";
const UA = "INEC-Result-Intelligence/1.0 source-collector";
const API_BASES = [
  "https://dolphin-app-sleqh.ondigitalocean.app/api/v1",
  "https://lv001-g.inecelectionresults.ng/api/v1",
];
const PUBLIC_INEC_CLIENT_KEY = "4SXkHM7Amb1SbF4C8do6816dmbbwqPp7akRbrmcV";

function extractLinks(html: string, pageUrl: string): string[] {
  const links = new Set<string>();
  const add = (value: string) => {
    try {
      const url = new URL(value, pageUrl);
      if (url.origin !== ORIGIN || url.protocol !== "https:") return;
      links.add(url.toString());
    } catch {}
  };
  const anchors = /<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi;
  for (const match of html.matchAll(anchors)) add(match[1]);
  const media = /<(?:img|iframe|embed|object)\b[^>]*(?:src|data)=["']([^"']+)["'][^>]*>/gi;
  for (const match of html.matchAll(media)) add(match[1]);
  return [...links];
}

function isDocumentUrl(url: string): boolean {
  try {
    const path = new URL(url).pathname.toLowerCase();
    return /\/document(?:$|\/)/.test(path) || /\.(pdf|jpe?g|png|webp)$/i.test(path) || /result|resultsheet|sheet|upload/.test(path);
  } catch { return false; }
}

function isCrawlablePage(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.origin === ORIGIN && parsed.pathname.toLowerCase().startsWith("/elections/") && !isDocumentUrl(url);
  } catch { return false; }
}

const KNOWN_ELECTION_TYPE_IDS = [
  "5f129a04df41d910dcdc1d50", "5f129a04df41d910dcdc1d51", "5f129a04df41d910dcdc1d52",
  "5f129a04df41d910dcdc1d53", "5f129a04df41d910dcdc1d54", "5f129a04df41d910dcdc1d55",
  "5f129a04df41d910dcdc1d56",
];
const KNOWN_STATE_IDS = Array.from({ length: 37 }, (_, index) => index + 1);
const ELECTION_DISCOVERY_CONCURRENCY = 20;

async function discoverElectionTypeIds(base: string, attempts: Array<Record<string, unknown>>): Promise<string[]> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const response = await fetch(base + "/election-types", {
      method: "GET", signal: controller.signal,
      headers: { "user-agent": UA, accept: "application/json, text/plain, */*", origin: ORIGIN, referer: ORIGIN + "/", "x-api-key": PUBLIC_INEC_CLIENT_KEY, "x-api-rt": String(Date.now()) },
    });
    clearTimeout(timeout);
    const body = await response.text();
    attempts.push({ base, endpoint: "election-types", status: response.status, content_type: response.headers.get("content-type"), length: body.length, preview: body.slice(0, 240) });
    if (!response.ok || !body) return KNOWN_ELECTION_TYPE_IDS;
    const payload: unknown = JSON.parse(body);
    const rawRows = Array.isArray(payload) ? payload : payload && typeof payload === "object" && Array.isArray((payload as Record<string, unknown>).data) ? (payload as Record<string, unknown>).data : [];
    const rows = rawRows.filter((row): row is Record<string, unknown> => !!row && typeof row === "object");
    const ids = rows.map(row => String(row._id ?? row.id ?? row.election_type_id ?? "").trim()).filter(id => /^[a-f0-9]{24}$/i.test(id));
    return ids.length ? [...new Set(ids)] : KNOWN_ELECTION_TYPE_IDS;
  } catch (error) {
    attempts.push({ base, endpoint: "election-types", error: error instanceof Error ? error.message : String(error) });
    return KNOWN_ELECTION_TYPE_IDS;
  }
}

async function discoverFromIrevApi() {
  const found = new Map<string, ReturnType<typeof discoverFromHtml>[number]>();
  const attempts: Array<Record<string, unknown>> = [];

  const recordRows = (rawRows: unknown) => {
    if (!Array.isArray(rawRows)) return;
    const rows = rawRows.filter((row): row is Record<string, unknown> => !!row && typeof row === "object");
    for (const row of rows) {
      const id = String(row._id ?? row.id ?? row.election_id ?? "").trim();
      if (!id) continue;
      const name = String(row.full_name ?? row.name ?? row.title ?? row.election_name ?? id).trim();
      const electionDate = String(row.election_date ?? row.date ?? "").trim() || null;
      found.set("irev:" + id, {
        external_id: "irev:" + id,
        name,
        election_type: classifyElection(name),
        election_date: electionDate,
        source_url: ORIGIN + "/elections/" + id,
        status: "discovered",
      });
    }
  };

  const requestElectionList = async (base: string, electionTypeId: string, stateId: number): Promise<boolean> => {
    const url = base + "/elections?" + new URLSearchParams({ election_type: electionTypeId, state_id: String(stateId) }).toString();
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4000);
      const response = await fetch(url, {
        method: "GET", signal: controller.signal,
        headers: { "user-agent": UA, accept: "application/json, text/plain, */*", origin: ORIGIN, referer: ORIGIN + "/", "x-api-key": PUBLIC_INEC_CLIENT_KEY, "x-api-rt": String(Date.now()) },
      });
      clearTimeout(timeout);
      const body = await response.text();
      attempts.push({ base, endpoint: "elections", election_type: electionTypeId, state_id: stateId, status: response.status, content_type: response.headers.get("content-type"), length: body.length, preview: body.slice(0, 160) });
      if (!response.ok || !body) return false;
      let payload: unknown;
      try { payload = JSON.parse(body); } catch { return false; }
      const rawRows = Array.isArray(payload) ? payload : payload && typeof payload === "object" && Array.isArray((payload as Record<string, unknown>).data) ? (payload as Record<string, unknown>).data : [];
      recordRows(rawRows);
      return Array.isArray(rawRows) && rawRows.length > 0;
    } catch (error) {
      attempts.push({ base, endpoint: "elections", election_type: electionTypeId, state_id: stateId, error: error instanceof Error ? error.message : String(error) });
      return false;
    }
  };

  for (const base of API_BASES) {
    const electionTypeIds = await discoverElectionTypeIds(base, attempts);
    const jobs: Array<{ electionTypeId: string; stateId: number }> = [];
    for (const electionTypeId of electionTypeIds) for (const stateId of KNOWN_STATE_IDS) jobs.push({ electionTypeId, stateId });
    for (let offset = 0; offset < jobs.length; offset += ELECTION_DISCOVERY_CONCURRENCY) {
      const batch = jobs.slice(offset, offset + ELECTION_DISCOVERY_CONCURRENCY);
      await Promise.all(batch.map(({ electionTypeId, stateId }) => requestElectionList(base, electionTypeId, stateId)));
    }
    if (found.size > 0) break;
  }
  return { elections: [...found.values()], attempts };
}

async function crawlElection(sourceUrl: string): Promise<string[]> {
  const queue: Array<{ url: string; depth: number }> = [{ url: sourceUrl, depth: 0 }];
  const visited = new Set<string>();
  const resultPages = new Set<string>();
  while (queue.length && visited.size < 750) {
    const current = queue.shift()!;
    if (visited.has(current.url)) continue;
    visited.add(current.url);
    let response: Response;
    try { response = await fetch(current.url, { headers: { "user-agent": UA } }); } catch { continue; }
    if (!response.ok) continue;
    const contentType = (response.headers.get("content-type") || "").toLowerCase();
    if (!contentType.includes("text/html")) { if (isDocumentUrl(current.url)) resultPages.add(current.url); continue; }
    const html = await response.text();
    for (const link of extractLinks(html, current.url)) {
      if (isDocumentUrl(link)) resultPages.add(link);
      else if (current.depth < 4 && isCrawlablePage(link) && !visited.has(link)) queue.push({ url: link, depth: current.depth + 1 });
    }
  }
  return [...resultPages];
}

Deno.serve(async request => {
  const startedAt = new Date().toISOString();
  if (request.method !== "POST") return new Response(JSON.stringify({ ok: false, error: "POST required" }), { status: 405, headers: { "content-type": "application/json" } });

  try {
    const response = await fetch(ORIGIN + "/", { headers: { "user-agent": UA } });
    if (!response.ok) throw new Error("IReV returned HTTP " + response.status);
    const homepageHtml = await response.text();
    const discovered = new Map<string, ReturnType<typeof discoverFromHtml>[number]>();
    const apiDiscovery = await discoverFromIrevApi();
    for (const election of apiDiscovery.elections) discovered.set(election.external_id, election);
    const homepageDiagnostics = { http_status: response.status, content_type: response.headers.get("content-type"), content_length: response.headers.get("content-length"), html_length: homepageHtml.length, contains_elections_text: /elections/i.test(homepageHtml), contains_dawakin_text: /dawakin/i.test(homepageHtml), contains_next_data: /__NEXT_DATA__|_next/i.test(homepageHtml), sample: homepageHtml.slice(0, 500) };
    for (const election of discoverFromHtml(homepageHtml)) discovered.set(election.external_id, election);

    const queue = extractSameOriginLinks(homepageHtml);
    const visited = new Set<string>([ORIGIN + "/"]);
    let scannedDirectoryPages = 0;
    while (queue.length && scannedDirectoryPages < 50) {
      const pageUrl = queue.shift()!;
      if (visited.has(pageUrl)) continue;
      visited.add(pageUrl);
      let pageResponse: Response;
      try { pageResponse = await fetch(pageUrl, { headers: { "user-agent": UA } }); } catch { continue; }
      if (!pageResponse.ok) continue;
      if (!(pageResponse.headers.get("content-type") || "").toLowerCase().includes("text/html")) continue;
      scannedDirectoryPages++;
      const pageHtml = await pageResponse.text();
      for (const election of discoverFromHtml(pageHtml)) discovered.set(election.external_id, election);
      for (const link of extractSameOriginLinks(pageHtml)) {
        try { if (!visited.has(link) && !new URL(link).pathname.toLowerCase().startsWith("/elections/")) queue.push(link); } catch {}
      }
    }

    const elections = [...discovered.values()];
    if (elections.length) {
      const result = await supabase.from("elections").upsert(elections, { onConflict: "external_id" });
      if (result.error) throw new Error("elections upsert failed: " + result.error.message);
    }

    let resultSheetsDiscovered = 0;
    const electionStats: Array<Record<string, unknown>> = [];
    for (const election of elections) {
      try {
        const lookup = await supabase.from("elections").select("id").eq("external_id", election.external_id).maybeSingle();
        if (lookup.error) throw new Error("election lookup failed: " + lookup.error.message);
        if (!lookup.data?.id) continue;
        const resultLinks = await crawlElection(election.source_url);
        const rows = resultLinks.map(url => ({ election_id: lookup.data.id, source_url: url, source_external_id: url, status: "discovered", evidence_status: "remote_only", storage_policy: "ephemeral" }));
        if (rows.length) {
          const result = await supabase.from("result_sheets").upsert(rows, { onConflict: "election_id,source_url", ignoreDuplicates: true });
          if (result.error) throw new Error("result_sheets upsert failed: " + result.error.message);
          resultSheetsDiscovered += rows.length;
        }
        electionStats.push({ external_id: election.external_id, result_links: resultLinks.length });
      } catch (error) {
        electionStats.push({ external_id: election.external_id, error: error instanceof Error ? error.message : String(error) });
      }
    }

    const pipeline = await supabase.from("pipeline_runs").insert({ started_at: startedAt, finished_at: new Date().toISOString(), status: "completed", trigger_source: "server", discovered: elections.length, metadata: { source: "IReV", mode: "server-side-bounded-crawl", result_sheets_discovered: resultSheetsDiscovered, elections: electionStats, homepage: homepageDiagnostics, scanned_directory_pages: scannedDirectoryPages, api_discovery_attempts: apiDiscovery.attempts } });
    if (pipeline.error) throw new Error("pipeline_runs insert failed: " + pipeline.error.message);

    return new Response(JSON.stringify({ ok: true, discovered: elections.length, result_sheets_discovered: resultSheetsDiscovered, elections: electionStats, diagnostics: { homepage: homepageDiagnostics, scanned_directory_pages: scannedDirectoryPages, api_discovery_attempts: apiDiscovery.attempts } }), { headers: { "content-type": "application/json" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    try { await supabase.from("pipeline_runs").insert({ started_at: startedAt, finished_at: new Date().toISOString(), status: "failed", trigger_source: "server", failed: 1, issues: [{ message }], metadata: { source: "IReV" } }); } catch {}
    return new Response(JSON.stringify({ ok: false, error: message }), { status: 500, headers: { "content-type": "application/json" } });
  }
});