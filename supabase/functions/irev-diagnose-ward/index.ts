// Deployment marker: diagnostic must run only after the Edge Function deployment completes.
const IREV_BASE = "https://dolphin-app-sleqh.ondigitalocean.app/api/v1";
const ALLOWED_ORIGIN = "https://inec-result-intelligence.vercel.app";

const CORS = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "content-type": "application/json; charset=utf-8" },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function objectId(value: unknown): string | null {
  const id = String(value ?? "").trim();
  return /^[a-f0-9]{24}$/i.test(id) ? id : null;
}

function arrays(value: unknown, path = "$", out: Array<{ path: string; values: Array<Record<string, unknown>> }> = []) {
  if (!value || typeof value !== "object" || out.length >= 50) return out;
  if (Array.isArray(value)) {
    const values = value.filter(isRecord);
    if (values.length) out.push({ path, values });
    return out;
  }
  for (const [key, child] of Object.entries(value)) arrays(child, path + "." + key, out);
  return out;
}

function findWard(payload: unknown, targetOid: string) {
  for (const candidate of arrays(payload)) {
    for (const lga of candidate.values) {
      const wards = Array.isArray(lga.wards) ? lga.wards : [];
      for (const raw of wards) {
        if (!isRecord(raw)) continue;
        const oid = objectId(raw._id);
        if (oid?.toLowerCase() !== targetOid.toLowerCase()) continue;
        const numeric = Number(raw.ward_id ?? raw.id);
        return {
          oid,
          numeric_id: Number.isInteger(numeric) ? numeric : null,
          name: raw.name ?? raw.ward_name ?? null,
          lga_oid: objectId(lga._id),
          lga_name: lga.name ?? lga.lga_name ?? null,
          hierarchy_path: candidate.path,
          ward_keys: Object.keys(raw),
        };
      }
    }
  }
  return null;
}

function rows(payload: unknown) {
  if (Array.isArray(payload)) return payload.filter(isRecord);
  if (!isRecord(payload)) return [];
  for (const key of ["data", "polling_units", "pus", "results", "items"]) {
    const value = payload[key];
    if (Array.isArray(value)) return value.filter(isRecord);
  }
  return [];
}

async function irevGet(electionId: string, path: string, publicKey: string | null) {
  const url = IREV_BASE + "/elections/" + encodeURIComponent(electionId) + path;
  try {
    const response = await fetch(url, {
      headers: {
        "user-agent": "INEC-Result-Intelligence/1.0 diagnostic",
        accept: "application/json, text/plain, */*",
        origin: "https://inecelectionresults.ng",
        referer: "https://inecelectionresults.ng/",
        ...(publicKey ? { "x-api-key": publicKey } : {}),
        "x-api-rt": String(Date.now()),
      },
    });
    const responseText = await response.text();
    let body: unknown = null;
    let parseError: string | null = null;
    try {
      body = responseText ? JSON.parse(responseText) : null;
    } catch (error) {
      parseError = error instanceof Error ? error.message : String(error);
    }
    return {
      ok: true,
      status: response.status,
      content_type: response.headers.get("content-type"),
      length: responseText.length,
      parse_error: parseError,
      body,
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      content_type: null,
      length: 0,
      parse_error: null,
      body: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

Deno.serve(async request => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (request.method !== "POST") return json({ ok: false, error: "POST required" }, 405);

  try {
    const publicKey = Deno.env.get("IREV_KEY")?.trim() || null;

    const input = await request.json().catch(() => ({}));
    const electionId = String(input?.election_id ?? "").trim();
    const wardOid = objectId(input?.ward_oid);

    if (!objectId(electionId)) return json({ ok: false, error: "Invalid election_id" }, 400);
    if (!wardOid) return json({ ok: false, error: "Invalid ward_oid" }, 400);

    const hierarchy = await irevGet(electionId, "/lga", publicKey);
    if (!hierarchy.ok) {
      return json({
        ok: false,
        stage: "hierarchy_fetch",
        election_id: electionId,
        requested_ward_oid: wardOid,
        error: hierarchy.error,
      }, 502);
    }

    const resolved = findWard(hierarchy.body, wardOid);

    if (!resolved) {
      return json({
        ok: true,
        stage: "ward_resolution",
        election_id: electionId,
        requested_ward_oid: wardOid,
        hierarchy: {
          status: hierarchy.status,
          content_type: hierarchy.content_type,
          length: hierarchy.length,
          parse_error: hierarchy.parse_error,
        },
        resolved: null,
        polling_units: null,
        note: "The requested value was not found as a ward OID inside the election LGA hierarchy.",
      });
    }

    const pus = await irevGet(electionId, "/pus?ward=" + encodeURIComponent(resolved.oid!), publicKey);
    if (!pus.ok) {
      return json({
        ok: false,
        stage: "polling_units_fetch",
        election_id: electionId,
        requested_ward_oid: wardOid,
        resolved,
        error: pus.error,
      }, 502);
    }

    const puRows = rows(pus.body);

    return json({
      ok: true,
      stage: "complete",
      election_id: electionId,
      requested_ward_oid: wardOid,
      resolved,
      hierarchy: {
        status: hierarchy.status,
        content_type: hierarchy.content_type,
        length: hierarchy.length,
        parse_error: hierarchy.parse_error,
      },
      polling_unit_response: {
        status: pus.status,
        content_type: pus.content_type,
        length: pus.length,
        parse_error: pus.parse_error,
        success: isRecord(pus.body) ? pus.body.success ?? null : null,
        count: puRows.length,
        sample_keys: puRows.slice(0, 10).map(row => Object.keys(row)),
        sample: puRows.slice(0, 10),
      },
    });
  } catch (error) {
    console.error("[irev-diagnose-ward] Unexpected runtime error", error);
    return json({
      ok: false,
      stage: "runtime",
      error: error instanceof Error ? error.message : String(error),
    }, 500);
  }
});
