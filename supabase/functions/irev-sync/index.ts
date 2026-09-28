import { classifyElection, discoverFromHtml, extractSameOriginLinks } from "./parser.ts";

const ORIGIN = "https://inecelectionresults.ng";
const UA = "INEC-Result-Intelligence/1.0 source-collector";
const API_BASES = [
  "https://dolphin-app-sleqh.ondigitalocean.app/api/v1",
  "https://lv001-g.inecelectionresults.ng/api/v1",
];
const PUBLIC_INEC_CLIENT_KEY = "4SXkHM7Amb1SbF4C8do6816dmbbwqPp7akRbrmcV";
const KNOWN_ELECTION_TYPE_IDS = [
  "5f129a04df41d910dcdc1d50", "5f129a04df41d910dcdc1d51", "5f129a04df41d910dcdc1d52",
  "5f129a04df41d910dcdc1d53", "5f129a04df41d910dcdc1d54", "5f129a04df41d910dcdc1d55",
  "5f129a04df41d910dcdc1d56",
];
const KNOWN_STATE_IDS = Array.from({ length: 37 }, (_, index) => index + 1);
const ELECTION_DISCOVERY_CONCURRENCY = 20;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function getSupabaseConfig() {
  const url = Deno.env.get("SUPABASE_URL")?.trim();
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();
  if (!url) throw new Error("Missing SUPABASE_URL secret");
  if (!key) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY secret");
  return { url: url.replace(/\/$/, ""), key };
}

async function supabaseRest(
  path: string,
  init: RequestInit = {},
): Promise<{ response: Response; body: unknown; text: string }> {
  const { url, key } = getSupabaseConfig();
  const headers = new Headers(init.headers);
  headers.set("apikey", key);
  headers.set("Authorization", `Bearer ${key}`);
  headers.set("Accept", "application/json");
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  const response = await fetch(`${url}/rest/v1/${path}`, { ...init, headers });
  const text = await response.text();
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { response, body, text };
}

function supabaseError(label: string, result: { response: Response; body: unknown; text: string }): Error | null {
  if (result.response.ok) return null;
  const detail = typeof result.body === "object" && result.body !== null
    ? JSON.stringify(result.body)
    : result.text;
  return new Error(`${label} failed (HTTP ${result.response.status}): ${detail.slice(0, 1000)}`);
}

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
    let payload: unknown;
    try { payload = JSON.parse(body); } catch { return KNOWN_ELECTION_TYPE_IDS; }
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
    for (const row of rawRows.filter((x): x is Record<string, unknown> => !!x && typeof x === "object")) {
      const id = String(row._id ?? row.id ?? row.election_id ?? "").trim();
      if (!id) continue;
      const name = String(row.full_name ?? row.name ?? row.title ?? row.election_name ?? id).trim();
      const electionDate = String(row.election_date ?? row.date ?? "").trim() || null;
      found.set("irev:" + id, { external_id: "irev:" + id, name, election_type: classifyElection(name), election_date: electionDate, source_url: ORIGIN + "/elections/" + id, status: "discovered" });
    }
  };

  const requestElectionList = async (base: string, electionTypeId: string, stateId: number) => {
    const url = base + "/elections?" + new URLSearchParams({ election_type: electionTypeId, state_id: String(stateId) }).toString();
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4000);
      const response = await fetch(url, { method: "GET", signal: controller.signal, headers: { "user-agent": UA, accept: "application/json, text/plain, */*", origin: ORIGIN, referer: ORIGIN + "/", "x-api-key": PUBLIC_INEC_CLIENT_KEY, "x-api-rt": String(Date.now()) } });
      clearTimeout(timeout);
      const body = await response.text();
      attempts.push({ base, endpoint: "elections", election_type: electionTypeId, state_id: stateId, status: response.status, content_type: response.headers.get("content-type"), length: body.length, preview: body.slice(0, 160) });
      if (!response.ok || !body) return;
      let payload: unknown;
      try { payload = JSON.parse(body); } catch { return; }
      const rawRows = Array.isArray(payload) ? payload : payload && typeof payload === "object" && Array.isArray((payload as Record<string, unknown>).data) ? (payload as Record<string, unknown>).data : [];
      recordRows(rawRows);
    } catch (error) {
      attempts.push({ base, endpoint: "elections", election_type: electionTypeId, state_id: stateId, error: error instanceof Error ? error.message : String(error) });
    }
  };

  for (const base of API_BASES) {
    const electionTypeIds = await discoverElectionTypeIds(base, attempts);
    const jobs: Array<{ electionTypeId: string; stateId: number }> = [];
    for (const electionTypeId of electionTypeIds) for (const stateId of KNOWN_STATE_IDS) jobs.push({ electionTypeId, stateId });
    for (let offset = 0; offset < jobs.length; offset += ELECTION_DISCOVERY_CONCURRENCY) {
      await Promise.all(jobs.slice(offset, offset + ELECTION_DISCOVERY_CONCURRENCY).map(job => requestElectionList(base, job.electionTypeId, job.stateId)));
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
  if (request.method !== "POST") return json({ ok: false, error: "POST required" }, 405);

  let stage = "startup";
  try {
    stage = "validate_supabase_config";
    getSupabaseConfig();

    stage = "fetch_homepage";
    const response = await fetch(ORIGIN + "/", { headers: { "user-agent": UA } });
    if (!response.ok) throw new Error("IReV returned HTTP " + response.status);
    const homepageHtml = await response.text();

    stage = "discover_irev_api";
    const discovered = new Map<string, ReturnType<typeof discoverFromHtml>[number]>();
    const apiDiscovery = await discoverFromIrevApi();
    for (const election of apiDiscovery.elections) discovered.set(election.external_id, election);

    const homepageDiagnostics = { http_status: response.status, content_type: response.headers.get("content-type"), content_length: response.headers.get("content-length"), html_length: homepageHtml.length, contains_elections_text: /elections/i.test(homepageHtml), contains_dawakin_text: /dawakin/i.test(homepageHtml), contains_next_data: /__NEXT_DATA__|_next/i.test(homepageHtml), sample: homepageHtml.slice(0, 500) };
    for (const election of discoverFromHtml(homepageHtml)) discovered.set(election.external_id, election);

    stage = "scan_directory_pages";
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
    stage = "upsert_elections";
    if (elections.length) {
      const result = await supabaseRest("elections?on_conflict=external_id", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(elections) });
      const error = supabaseError("elections upsert", result);
      if (error) throw error;
    }

    let resultSheetsDiscovered = 0;
    const electionStats: Array<Record<string, unknown>> = [];
    for (const election of elections) {
      try {
        stage = `process_election:${election.external_id}`;
        const lookup = await supabaseRest(`elections?select=id&external_id=eq.${encodeURIComponent(election.external_id)}&limit=1`, { method: "GET" });
        const lookupError = supabaseError("election lookup", lookup);
        if (lookupError) throw lookupError;
        const rows = Array.isArray(lookup.body) ? lookup.body as Array<Record<string, unknown>> : [];
        const electionId = rows[0]?.id;
        if (!electionId) { electionStats.push({ external_id: election.external_id, error: "saved election id not found" }); continue; }

        const resultLinks = await crawlElection(election.source_url);
        const sheetRows = resultLinks.map(url => ({ election_id: electionId, source_url: url, source_external_id: url, status: "discovered", evidence_status: "remote_only", storage_policy: "ephemeral" }));
        if (sheetRows.length) {
          const result = await supabaseRest("result_sheets?on_conflict=election_id,source_url", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(sheetRows) });
          const error = supabaseError("result_sheets upsert", result);
          if (error) throw error;
          resultSheetsDiscovered += sheetRows.length;
        }
        electionStats.push({ external_id: election.external_id, result_links: resultLinks.length });
      } catch (error) {
        electionStats.push({ external_id: election.external_id, error: error instanceof Error ? error.message : String(error) });
      }
    }

    stage = "insert_pipeline_run";
    const pipeline = await supabaseRest("pipeline_runs", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ started_at: startedAt, finished_at: new Date().toISOString(), status: "completed", trigger_source: "server", discovered: elections.length, metadata: { source: "IReV", mode: "server-side-bounded-crawl", result_sheets_discovered: resultSheetsDiscovered, elections: electionStats, homepage: homepageDiagnostics, scanned_directory_pages: scannedDirectoryPages, api_discovery_attempts: apiDiscovery.attempts } }) });
    const pipelineError = supabaseError("pipeline_runs insert", pipeline);
    if (pipelineError) throw pipelineError;

    return json({ ok: true, discovered: elections.length, result_sheets_discovered: resultSheetsDiscovered, elections: electionStats, diagnostics: { homepage: homepageDiagnostics, scanned_directory_pages: scannedDirectoryPages, api_discovery_attempts: apiDiscovery.attempts } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return json({ ok: false, stage, error: message }, 500);
  }
});