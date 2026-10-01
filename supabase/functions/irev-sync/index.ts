import { classifyElection, discoverFromHtml, extractSameOriginLinks } from "./parser.ts";

const ORIGIN = "https://inecelectionresults.ng";
const CURRENT_IREV_ORIGIN = "https://irev.inecnigeria.org";
const UA = "INEC-Result-Intelligence/1.0 source-collector";
const API_BASES = [
  // DigitalOcean hosts the current IReV API used by the public frontend.
  "https://dolphin-app-sleqh.ondigitalocean.app/api/v1",
];
const IREV_KEY = Deno.env.get("IREV_KEY")?.trim() || null;
const KNOWN_ELECTION_TYPE_IDS = [
  "5f129a04df41d910dcdc1d50", "5f129a04df41d910dcdc1d51", "5f129a04df41d910dcdc1d52",
  "5f129a04df41d910dcdc1d53", "5f129a04df41d910dcdc1d54", "5f129a04df41d910dcdc1d55",
  "5f129a04df41d910dcdc1d56",
];
const KNOWN_STATE_IDS = Array.from({ length: 37 }, (_, index) => index + 1);
const ELECTION_DISCOVERY_CONCURRENCY = 20;
const MAX_ELECTIONS_PER_SYNC = 3;
const MAX_DIRECTORY_PAGES = 20;
const MAX_CRAWL_PAGES = 100;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "https://inec-result-intelligence.vercel.app",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, "content-type": "application/json; charset=utf-8" },
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

function extractLinks(html: string, pageUrl: string, allowedOrigin = ORIGIN): string[] {
  const links = new Set<string>();
  const add = (value: string) => {
    try {
      const url = new URL(value, pageUrl);
      if (url.origin !== allowedOrigin || url.protocol !== "https:") return;
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

function isCrawlablePage(url: string, allowedOrigin = ORIGIN): boolean {
  try {
    const parsed = new URL(url);
    return parsed.origin === allowedOrigin && parsed.pathname.toLowerCase().startsWith("/elections/") && !isDocumentUrl(url);
  } catch { return false; }
}

async function discoverElectionTypeIds(base: string, attempts: Array<Record<string, unknown>>): Promise<string[]> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const response = await fetch(base + "/election-types", {
      method: "GET", signal: controller.signal,
      headers: { "user-agent": UA, accept: "application/json, text/plain, */*", origin: ORIGIN, referer: ORIGIN + "/", ...(IREV_KEY ? { "x-api-key": IREV_KEY } : {}), "x-api-rt": String(Date.now()) },
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
      found.set("irev:" + id, {
        external_id: "irev:" + id,
        name,
        election_type: classifyElection(name),
        election_date: electionDate,
        source_url: ORIGIN + "/elections/" + id,
        status: "discovered",
        ...(Number.isFinite(Number(row.state_id)) ? { irev_state_id: Number(row.state_id) } : {}),
      } as ReturnType<typeof discoverFromHtml>[number] & { irev_state_id?: number });
    }
  };

  const requestElectionList = async (base: string, electionTypeId: string, stateId?: number) => {
    const params = new URLSearchParams({ election_type: electionTypeId });
    if (stateId != null) params.set("state_id", String(stateId));
    const url = base + "/elections?" + params.toString();
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const response = await fetch(url, {
        method: "GET",
        signal: controller.signal,
        headers: {
          "user-agent": UA,
          accept: "application/json, text/plain, */*",
          origin: ORIGIN,
          referer: ORIGIN + "/",
          "x-api-key": IREV_KEY,
          "x-api-rt": String(Date.now()),
        },
      });
      clearTimeout(timeout);
      const body = await response.text();
      attempts.push({
        base,
        endpoint: "elections",
        election_type: electionTypeId,
        ...(stateId == null ? {} : { state_id: stateId }),
        status: response.status,
        content_type: response.headers.get("content-type"),
        length: body.length,
        preview: body.slice(0, 160),
      });
      if (!response.ok || !body) return 0;
      let payload: unknown;
      try { payload = JSON.parse(body); } catch { return 0; }
      const rawRows = Array.isArray(payload)
        ? payload
        : payload && typeof payload === "object" && Array.isArray((payload as Record<string, unknown>).data)
          ? (payload as Record<string, unknown>).data
          : [];
      recordRows(rawRows);
      return rawRows.length;
    } catch (error) {
      attempts.push({
        base,
        endpoint: "elections",
        election_type: electionTypeId,
        ...(stateId == null ? {} : { state_id: stateId }),
        error: error instanceof Error ? error.message : String(error),
      });
      return 0;
    }
  };

  for (const base of API_BASES) {
    const electionTypeIds = await discoverElectionTypeIds(base, attempts);
    // The IReV API already exposes the complete election collection when queried
    // by election type. Use that authoritative route first; only fall back to
    // state-scoped requests when a type returns no rows. This keeps discovery
    // fast enough for scheduled runs and prevents the sync from timing out
    // before current elections are persisted.
    for (const electionTypeId of electionTypeIds) {
      const count = await requestElectionList(base, electionTypeId);
      if (count === 0) {
        const stateJobs = KNOWN_STATE_IDS.map((stateId) => ({ electionTypeId, stateId }));
        for (let offset = 0; offset < stateJobs.length; offset += ELECTION_DISCOVERY_CONCURRENCY) {
          await Promise.all(
            stateJobs.slice(offset, offset + ELECTION_DISCOVERY_CONCURRENCY)
              .map((job) => requestElectionList(base, job.electionTypeId, job.stateId)),
          );
        }
      }
    }
    if (found.size > 0) break;
  }
  return { elections: [...found.values()], attempts };
}

async function discoverFromCurrentIrevDirectory(): Promise<{ elections: ReturnType<typeof discoverFromHtml>; attempts: Array<Record<string, unknown>> }> {
  const elections = new Map<string, ReturnType<typeof discoverFromHtml>[number]>();
  const attempts: Array<Record<string, unknown>> = [];

  for (const typeId of KNOWN_ELECTION_TYPE_IDS) {
    const url = CURRENT_IREV_ORIGIN + "/elections/types/" + typeId;
    try {
      const response = await fetch(url, { headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml" } });
      const html = await response.text();
      attempts.push({ origin: CURRENT_IREV_ORIGIN, endpoint: "/elections/types/" + typeId, status: response.status, content_type: response.headers.get("content-type"), length: html.length });
      if (!response.ok) continue;
      for (const election of discoverFromHtml(html, CURRENT_IREV_ORIGIN)) elections.set(election.external_id, election);
    } catch (error) {
      attempts.push({ origin: CURRENT_IREV_ORIGIN, endpoint: "/elections/types/" + typeId, error: error instanceof Error ? error.message : String(error) });
    }
  }

  return { elections: [...elections.values()], attempts };
}

async function apiGet(base: string, path: string, diagnostics?: Array<Record<string, unknown>>): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(base + path, {
      headers: {
        "user-agent": UA,
        accept: "application/json, text/plain, */*",
        origin: ORIGIN,
        referer: ORIGIN + "/",
        "x-api-key": IREV_KEY,
        "x-api-rt": String(Date.now()),
      },
      signal: controller.signal,
    });
    const body = await response.text();
    diagnostics?.push({ base, endpoint: path, status: response.status, content_type: response.headers.get("content-type"), length: body.length, preview: body.slice(0, 500) });
    if (!response.ok || !body) return null;
    try { return JSON.parse(body); } catch { return null; }
  } finally {
    clearTimeout(timeout);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function apiRows(payload: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(payload)) return payload.filter(isRecord);
  if (!isRecord(payload)) return [];
  for (const key of ["data", "lgas", "election_lgas", "result", "results", "items"]) {
    const value = payload[key];
    if (Array.isArray(value)) {
      const rows = value.filter(isRecord);
      if (rows.length) return rows;
    }
    if (isRecord(value)) {
      const nested = apiRows(value);
      if (nested.length) return nested;
    }
  }
  return [];
}

function apiStateId(payload: unknown): number | null {
  if (!isRecord(payload)) return null;
  const state = isRecord(payload.state) ? payload.state : null;
  const data = isRecord(payload.data) ? payload.data : null;
  const dataState = data && isRecord(data.state) ? data.state : null;
  for (const candidate of [payload.state_id, payload.irev_state_id, state?.id, state?._id, data?.state_id, dataState?.id, dataState?._id]) {
    const value = Number(candidate);
    if (Number.isInteger(value) && value >= 1 && value <= 37) return value;
  }
  return null;
}

function objectId(value: unknown): string | null {
  const id = String(value ?? "").trim();
  return id && /^[a-f0-9]{24}$/i.test(id) ? id : null;
}

function documentUrl(row: Record<string, unknown>): string | null {
  const candidates = [
    row.document,
    row.result,
    row.result_sheet,
    row.file,
    row.file_url,
    row.document_url,
    row.url,
    row.path,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && /^https?:\/\//i.test(candidate)) return candidate;
    if (candidate && typeof candidate === "object") {
      const obj = candidate as Record<string, unknown>;
      for (const key of ["url", "file_url", "document_url", "path", "src"]) {
        const value = obj[key];
        if (typeof value === "string" && /^https?:\/\//i.test(value)) return value;
      }
    }
  }
  return null;
}

function puExternalId(row: Record<string, unknown>): string | null {
  return String(row.polling_unit_id ?? row._id ?? row.external_id ?? "").trim() || null;
}

async function discoverApiWardStructure(
  base: string,
  electionExternalId: string,
  electionId: string,
  irevStateId: number,
  diagnostics: Array<Record<string, unknown>>,
): Promise<number> {
  // The current election hierarchy is authoritative for ward identity; stored OIDs are refreshed before queueing.
  // polling-unit documents. Match those OIDs against our canonical geography
  // in batches instead of doing one database request per ward. The previous
  // per-ward lookup/upsert loop was the main source of the 150s idle timeout.
  let structure = await apiGet(
    base,
    "/elections/" + encodeURIComponent(electionExternalId) + "/lga",
    diagnostics,
  );

  let rows = apiRows(structure);
  if (!rows.length) {
    structure = await apiGet(
      base,
      "/elections/" + encodeURIComponent(electionExternalId) + "/lga/state/" + irevStateId,
      diagnostics,
    );
    rows = apiRows(structure);
  }
  if (!rows.length) return 0;

  const normalizeGeoName = (value: unknown) => String(value ?? "")
    .normalize("NFKD")
    .replace(/[\\u0300-\\u036f]/g, "")
    .toUpperCase()
    .replace(/\\b(LGA|LOCAL GOVERNMENT AREA|WARD|REGISTRATION AREA|RA)\\b/g, "")
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .replace(/\\s+/g, " ");
  const numericIdentity = (value: unknown): number | null => {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  };

  type ApiLga = {
    numericId: number | null;
    oid: string | null;
    name: string | null;
    wards: Array<{ numericId: number | null; oid: string | null; name: string | null }>;
  };

  const apiLgas: ApiLga[] = [];
  const lgaSeen = new Set<string>();
  for (const row of rows) {
    const lgaObject = row.lga && typeof row.lga === "object" ? row.lga as Record<string, unknown> : null;
    const numericId = numericIdentity(row.lga_id ?? row.id ?? lgaObject?.lga_id ?? lgaObject?.id);
    const oidCandidate = String(row._id ?? row.oid ?? lgaObject?._id ?? lgaObject?.oid ?? "").trim();
    const oid = /^[a-f0-9]{24}$/i.test(oidCandidate) ? oidCandidate : null;
    const name = String(row.name ?? row.lga_name ?? lgaObject?.name ?? lgaObject?.lga_name ?? "").trim() || null;
    const key = oid ?? (String(numericId ?? "null") + ":" + normalizeGeoName(name));
    if (!key || lgaSeen.has(key)) continue;
    lgaSeen.add(key);

    const wards = Array.isArray(row.wards)
      ? row.wards.filter(isRecord).map((ward) => {
          const wardNumeric = numericIdentity(ward.ward_id ?? ward.id);
          const wardOidCandidate = String(ward._id ?? ward.oid ?? "").trim();
          return {
            numericId: wardNumeric,
            oid: /^[a-f0-9]{24}$/i.test(wardOidCandidate) ? wardOidCandidate : null,
            name: String(ward.name ?? ward.ward_name ?? "").trim() || null,
          };
        }).filter((ward) => ward.oid || ward.numericId != null || ward.name)
      : [];

    apiLgas.push({ numericId, oid, name, wards });
  }

  const apiLgaIds = [...new Set(apiLgas.map((lga) => lga.numericId).filter((id): id is number => id != null))];
  const canonicalLgaByIrevId = new Map<number, Record<string, unknown>>();
  const canonicalLgaByName = new Map<string, Record<string, unknown>>();

  if (apiLgaIds.length) {
    const lookup = await supabaseRest(
      "lgas?select=id,state_id,name,irev_lga_id&irev_lga_id=in.(" + apiLgaIds.join(",") + ")",
      { method: "GET" },
    );
    const lookupError = supabaseError("canonical LGA identity lookup", lookup);
    if (lookupError) throw lookupError;
    for (const row of Array.isArray(lookup.body) ? lookup.body as Array<Record<string, unknown>> : []) {
      const id = numericIdentity(row.irev_lga_id);
      if (id != null) canonicalLgaByIrevId.set(id, row);
      const name = normalizeGeoName(row.name);
      if (name) canonicalLgaByName.set(name, row);
    }
  }

  const apiLgaNames = [...new Set(apiLgas.map((lga) => normalizeGeoName(lga.name)).filter(Boolean))];
  const missingNames = apiLgaNames.filter((name) => !canonicalLgaByName.has(name));
  if (missingNames.length) {
    const lookup = await supabaseRest(
      "lgas?select=id,state_id,name,irev_lga_id&name=in.(" + missingNames.map(encodeURIComponent).join(",") + ")",
      { method: "GET" },
    );
    const lookupError = supabaseError("canonical LGA name lookup", lookup);
    if (lookupError) throw lookupError;
    for (const row of Array.isArray(lookup.body) ? lookup.body as Array<Record<string, unknown>> : []) {
      const name = normalizeGeoName(row.name);
      if (name && !canonicalLgaByName.has(name)) canonicalLgaByName.set(name, row);
    }
  }

  const resolvedLgas = apiLgas.map((api) => ({
    api,
    canonical: (api.numericId != null ? canonicalLgaByIrevId.get(api.numericId) : undefined) ??
      (api.name ? canonicalLgaByName.get(normalizeGeoName(api.name)) : undefined),
  })).filter((item): item is { api: ApiLga; canonical: Record<string, unknown> } => !!item.canonical?.id);

  const unresolvedLgas = apiLgas.filter((api) =>
    !resolvedLgas.some((item) => item.api === api)
  ).map((api) => ({ name: api.name, numericId: api.numericId, wardCount: api.wards.length }));

  const lgaUpdates = resolvedLgas
    .filter(({ api }) => api.numericId != null)
    .map(({ api, canonical }) => ({
      id: canonical.id,
      state_id: canonical.state_id,
      name: canonical.name,
      irev_lga_id: api.numericId,
    }));

  if (lgaUpdates.length) {
    const update = await supabaseRest(
      "lgas?on_conflict=id",
      {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify(lgaUpdates),
      },
    );
    const updateError = supabaseError("canonical LGA identity upsert", update);
    if (updateError) throw updateError;
  }

  const canonicalLgaIds = [...new Set(resolvedLgas.map(({ canonical }) => String(canonical.id)))];
  const canonicalWards = new Map<string, Array<Record<string, unknown>>>();
  if (canonicalLgaIds.length) {
    const lookup = await supabaseRest(
      "wards?select=id,lga_id,name,irev_ward_id,irev_ward_oid&lga_id=in.(" + canonicalLgaIds.join(",") + ")",
      { method: "GET" },
    );
    const lookupError = supabaseError("canonical ward geography lookup", lookup);
    if (lookupError) throw lookupError;
    for (const row of Array.isArray(lookup.body) ? lookup.body as Array<Record<string, unknown>> : []) {
      const lgaId = String(row.lga_id);
      const current = canonicalWards.get(lgaId) ?? [];
      current.push(row);
      canonicalWards.set(lgaId, current);
    }
  }

  let matched = 0;
  let queued = 0;
  let repairedOids = 0;
  let matchedByNumericId = 0;
  let matchedByName = 0;
  const wardUpdates: Array<Record<string, unknown>> = [];
  const jobs: Array<Record<string, unknown>> = [];

  for (const item of resolvedLgas) {
    const lgaId = String(item.canonical.id);
    const wardsForLga = canonicalWards.get(lgaId) ?? [];
    const byNumericId = new Map<number, Record<string, unknown>>();
    const byName = new Map<string, Record<string, unknown>>();

    for (const ward of wardsForLga) {
      const numeric = numericIdentity(ward.irev_ward_id);
      if (numeric != null) byNumericId.set(numeric, ward);
      const name = normalizeGeoName(ward.name);
      if (name) byName.set(name, ward);
    }

    for (const apiWard of item.api.wards) {
      const canonical =
        (apiWard.numericId != null ? byNumericId.get(apiWard.numericId) : undefined) ??
        (apiWard.name ? byName.get(normalizeGeoName(apiWard.name)) : undefined);

      if (!canonical?.id) continue;

      matched++;
      if (apiWard.numericId != null && byNumericId.has(apiWard.numericId)) matchedByNumericId++;
      else matchedByName++;

      const previousOid = objectId(canonical.irev_ward_oid);
      if (apiWard.oid && previousOid?.toLowerCase() !== apiWard.oid.toLowerCase()) repairedOids++;

      wardUpdates.push({
        id: canonical.id,
        lga_id: canonical.lga_id,
        name: canonical.name,
        ...(apiWard.numericId != null ? { irev_ward_id: apiWard.numericId } : {}),
        ...(apiWard.oid ? { irev_ward_oid: apiWard.oid } : {}),
      });

      jobs.push({
        election_id: electionId,
        ward_id: canonical.id,
        status: "queued",
        available_at: new Date().toISOString(),
        ...(apiWard.numericId != null ? { irev_ward_id: apiWard.numericId } : {}),
      });
    }
  }

  const currentOids = [...new Set(
    wardUpdates
      .map((row) => objectId(row.irev_ward_oid))
      .filter((value): value is string => !!value),
  )];

  if (currentOids.length) {
    const clear = await supabaseRest(
      "wards?irev_ward_oid=in.(" + currentOids.join(",") + ")",
      {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ irev_ward_oid: null }),
      },
    );
    const clearError = supabaseError("stale ward OID cleanup", clear);
    if (clearError) throw clearError;
  }

  if (wardUpdates.length) {
    const update = await supabaseRest(
      "wards?on_conflict=id",
      {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify(wardUpdates),
      },
    );
    const updateError = supabaseError("canonical ward identity upsert", update);
    if (updateError) throw updateError;
    queued = jobs.length;
  }

  if (jobs.length) {
    const job = await supabaseRest(
      "irev_ward_sync_jobs?on_conflict=election_id,ward_id",
      {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify(jobs),
      },
    );
    const jobError = supabaseError("ward job batch upsert", job);
    if (jobError) throw jobError;
  }

  diagnostics.push({
    type: "ward_mapping",
    election_id: electionExternalId,
    api_lga_rows: rows.length,
    api_ward_rows: wards.length,
    matched_canonical_wards: matched,
    queued_jobs: queued,
  });

  return queued;
}

async function crawlElection(sourceUrl: string): Promise<string[]> {
  const sourceOrigin = new URL(sourceUrl).origin;
  const queue: Array<{ url: string; depth: number }> = [{ url: sourceUrl, depth: 0 }];
  const visited = new Set<string>();
  const resultPages = new Set<string>();
  while (queue.length && visited.size < MAX_CRAWL_PAGES) {
    const current = queue.shift()!;
    if (visited.has(current.url)) continue;
    visited.add(current.url);
    let response: Response;
    try { response = await fetch(current.url, { headers: { "user-agent": UA } }); } catch { continue; }
    if (!response.ok) continue;
    const contentType = (response.headers.get("content-type") || "").toLowerCase();
    if (!contentType.includes("text/html")) { if (isDocumentUrl(current.url)) resultPages.add(current.url); continue; }
    const html = await response.text();
    for (const link of extractLinks(html, current.url, sourceOrigin)) {
      if (isDocumentUrl(link)) resultPages.add(link);
      else if (current.depth < 4 && isCrawlablePage(link, sourceOrigin) && !visited.has(link)) queue.push({ url: link, depth: current.depth + 1 });
    }
  }
  return [...resultPages];
}

Deno.serve(async request => {
  const startedAt = new Date().toISOString();
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
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
    const geographyDiagnostics: Array<Record<string, unknown>> = [];
    for (const election of apiDiscovery.elections) discovered.set(election.external_id, election);

    stage = "discover_current_irev_directory";
    const currentDirectory = await discoverFromCurrentIrevDirectory();
    for (const election of currentDirectory.elections) discovered.set(election.external_id, election);

    const homepageDiagnostics = { http_status: response.status, content_type: response.headers.get("content-type"), content_length: response.headers.get("content-length"), html_length: homepageHtml.length, contains_elections_text: /elections/i.test(homepageHtml), contains_dawakin_text: /dawakin/i.test(homepageHtml), contains_next_data: /__NEXT_DATA__|_next/i.test(homepageHtml), sample: homepageHtml.slice(0, 500) };
    for (const election of discoverFromHtml(homepageHtml)) discovered.set(election.external_id, election);

    stage = "scan_directory_pages";
    const queue = extractSameOriginLinks(homepageHtml);
    const visited = new Set<string>([ORIGIN + "/"]);
    let scannedDirectoryPages = 0;
    while (queue.length && scannedDirectoryPages < MAX_DIRECTORY_PAGES) {
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
    const electionsToProcess = [...elections]
      .sort((a, b) => {
        const aTime = a.election_date ? Date.parse(a.election_date) : 0;
        const bTime = b.election_date ? Date.parse(b.election_date) : 0;
        return bTime - aTime;
      })
      .slice(0, MAX_ELECTIONS_PER_SYNC);
    stage = "upsert_elections";
    if (elections.length) {
      const result = await supabaseRest("elections?on_conflict=external_id", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(elections) });
      const error = supabaseError("elections upsert", result);
      if (error) throw error;
    }

    let resultSheetsDiscovered = 0;
    const electionStats: Array<Record<string, unknown>> = [];
    for (const election of electionsToProcess) {
      try {
        stage = `process_election:${election.external_id}`;
        const lookup = await supabaseRest(`elections?select=id&external_id=eq.${encodeURIComponent(election.external_id)}&limit=1`, { method: "GET" });
        const lookupError = supabaseError("election lookup", lookup);
        if (lookupError) throw lookupError;
        const rows = Array.isArray(lookup.body) ? lookup.body as Array<Record<string, unknown>> : [];
        const electionId = rows[0]?.id;
        if (!electionId) { electionStats.push({ external_id: election.external_id, error: "saved election id not found" }); continue; }

        let queuedWardJobs = 0;
        if (election.external_id.startsWith("irev:")) {
          const apiElectionId = election.external_id.slice("irev:".length);
          const electionStateId = Number((election as unknown as Record<string, unknown>).irev_state_id);
          const stateIdFromApi = Number.isFinite(electionStateId) && electionStateId >= 1 && electionStateId <= 37
            ? electionStateId
            : null;
          const stateIdMatch = election.name.match(/(?:^|[-\\s])(\\d{2})[-\\s]/);
          const stateIdFromName = stateIdMatch ? Number(stateIdMatch[1]) : null;
          const parsedStateId = stateIdFromName && stateIdFromName >= 1 && stateIdFromName <= 37 ? stateIdFromName : null;
          const candidateStateIds = stateIdFromApi
            ? [stateIdFromApi]
            : parsedStateId
              ? [parsedStateId]
              : [...KNOWN_STATE_IDS];

          if (!stateIdFromApi && !parsedStateId) {
            for (const base of API_BASES) {
              const detail = await apiGet(base, "/elections/" + encodeURIComponent(apiElectionId), geographyDiagnostics);
              const detailStateId = apiStateId(detail);
              if (detailStateId) {
                candidateStateIds.splice(0, candidateStateIds.length, detailStateId);
                break;
              }
            }
          }

          // The election-level /lga endpoint already returns the full hierarchy.
          // Calling it once is important: the previous implementation issued the
          // same expensive request once per candidate state, which amplified CPU
          // and memory usage inside the Edge Function.
          const fallbackStateId = stateIdFromApi ?? parsedStateId ?? 1;
          for (const base of API_BASES) {
            queuedWardJobs = await discoverApiWardStructure(
              base,
              apiElectionId,
              String(electionId),
              fallbackStateId,
              geographyDiagnostics,
            );
            if (queuedWardJobs > 0) break;
          }
        }

        // IReV elections are API-backed. Do not fall back to crawling the SPA
        // when hierarchy discovery returns zero; that crawl can consume hundreds
        // of HTML requests and exhaust the Edge Function resource budget.
        const resultLinks = election.external_id.startsWith("irev:")
          ? []
          : queuedWardJobs === 0
            ? await crawlElection(election.source_url)
            : [];
        const sheetRows = resultLinks.map(url => ({ election_id: electionId, source_url: url, source_external_id: url, status: "discovered", evidence_status: "remote_only", storage_policy: "ephemeral" }));
        if (sheetRows.length) {
          const result = await supabaseRest("result_sheets?on_conflict=election_id,source_url", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(sheetRows) });
          const error = supabaseError("result_sheets upsert", result);
          if (error) throw error;
          resultSheetsDiscovered += sheetRows.length;
        }
        electionStats.push({ external_id: election.external_id, result_links: resultLinks.length, queued_ward_jobs: queuedWardJobs });
      } catch (error) {
        electionStats.push({ external_id: election.external_id, error: error instanceof Error ? error.message : String(error) });
      }
    }

    stage = "insert_pipeline_run";
    const pipeline = await supabaseRest("pipeline_runs", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ started_at: startedAt, finished_at: new Date().toISOString(), status: "completed", trigger_source: "server", discovered: elections.length, metadata: { source: "IReV", mode: "server-side-bounded-crawl",
        max_elections_per_sync: MAX_ELECTIONS_PER_SYNC,
        max_directory_pages: MAX_DIRECTORY_PAGES,
        max_crawl_pages: MAX_CRAWL_PAGES,
        processed_elections: electionsToProcess.length,
        result_sheets_discovered: resultSheetsDiscovered,
        elections: electionStats, hierarchy: "IReV API with durable ward queue", homepage: homepageDiagnostics, scanned_directory_pages: scannedDirectoryPages, api_discovery_attempts: apiDiscovery.attempts, geography_diagnostics: geographyDiagnostics.slice(-60) } }) });
    const pipelineError = supabaseError("pipeline_runs insert", pipeline);
    if (pipelineError) throw pipelineError;

    return json({ ok: true, discovered: elections.length, processed: electionsToProcess.length, result_sheets_discovered: resultSheetsDiscovered, elections: electionStats, diagnostics: { homepage: homepageDiagnostics, scanned_directory_pages: scannedDirectoryPages, api_discovery_attempts: apiDiscovery.attempts, geography: geographyDiagnostics.slice(-60) } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return json({ ok: false, stage, error: message }, 500);
  }
});