const electionId = "6aae6541d0998b3b55a9af98";
const requestedWardOid = "5f0f39814d89fc3a883de129";
const base = "https://dolphin-app-sleqh.ondigitalocean.app/api/v1";
const key = process.env.IREV_API_KEY?.trim();

if (!key) {
  throw new Error("IREV_API_KEY GitHub Secret is not configured for this workflow.");
}

async function get(path) {
  const url = `${base}${path}`;
  const response = await fetch(url, {
    headers: {
      "user-agent": "INEC-Result-Intelligence/1.0 source-collector",
      accept: "application/json, text/plain, */*",
      origin: "https://inecelectionresults.ng",
      referer: "https://inecelectionresults.ng/",
      "x-api-key": key,
      "x-api-rt": String(Date.now()),
    },
  });
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch {}
  console.log(JSON.stringify({
    request: path,
    status: response.status,
    contentType: response.headers.get("content-type"),
    length: text.length,
    prefix: text.slice(0, 1000),
  }, null, 2));
  if (!response.ok) throw new Error(`IReV ${path} returned HTTP ${response.status}`);
  return payload;
}

function arrays(value, path = "$", out = []) {
  if (!value || typeof value !== "object" || out.length >= 50) return out;
  if (Array.isArray(value)) {
    out.push({ path, values: value });
    return out;
  }
  for (const [key, child] of Object.entries(value)) arrays(child, path + "." + key, out);
  return out;
}

function objectId(value) {
  const id = String(value ?? "").trim();
  return /^[a-f0-9]{24}$/i.test(id) ? id : null;
}

function findWard(payload, targetOid) {
  for (const candidate of arrays(payload)) {
    for (const raw of candidate.values) {
      if (!raw || typeof raw !== "object") continue;
      const lga = raw;
      const wards = Array.isArray(lga.wards) ? lga.wards : [];
      for (const ward of wards) {
        if (!ward || typeof ward !== "object") continue;
        const oid = objectId(ward._id);
        const numeric = Number(ward.ward_id ?? ward.id);
        if (oid?.toLowerCase() === targetOid.toLowerCase()) {
          return {
            oid,
            numericId: Number.isInteger(numeric) ? numeric : null,
            name: ward.name ?? ward.ward_name ?? null,
            lgaOid: objectId(lga._id),
            lgaName: lga.name ?? lga.lga_name ?? null,
            lgaPath: candidate.path,
            wardKeys: Object.keys(ward),
          };
        }
      }
    }
  }
  return null;
}

function rows(payload) {
  if (Array.isArray(payload)) return payload.filter(x => x && typeof x === "object");
  if (!payload || typeof payload !== "object") return [];
  for (const key of ["data", "polling_units", "pus", "results", "items"]) {
    const value = payload[key];
    if (Array.isArray(value)) return value.filter(x => x && typeof x === "object");
    if (value && typeof value === "object") {
      const nested = rows(value);
      if (nested.length) return nested;
    }
  }
  return [];
}

const hierarchy = await get(`/elections/${electionId}/lga`);
const match = findWard(hierarchy, requestedWardOid);

console.log("=== WARD RESOLUTION ===");
console.log(JSON.stringify({
  requested_ward_oid: requestedWardOid,
  resolved: match,
}, null, 2));

if (!match?.oid) {
  console.error("Could not resolve the requested LGA-context identifier to a ward OID.");
  process.exit(2);
}

const pusPath = `/elections/${electionId}/pus?ward=${encodeURIComponent(match.oid)}`;
const puPayload = await get(pusPath);
const puRows = rows(puPayload);

console.log("=== POLLING UNIT RESULT ===");
console.log(JSON.stringify({
  requested_ward_oid: requestedWardOid,
  resolved_ward_oid: match.oid,
  resolved_ward_name: match.name,
  resolved_lga_oid: match.lgaOid,
  resolved_lga_name: match.lgaName,
  polling_units: puRows.length,
  payload_success: puPayload?.success ?? null,
}, null, 2));

console.log("=== POLLING UNIT RECORDS ===");
for (const [index, row] of puRows.slice(0, 20).entries()) {
  const pu = row.polling_unit && typeof row.polling_unit === "object" ? row.polling_unit : null;
  console.log(JSON.stringify({
    index,
    keys: Object.keys(row),
    id: row._id ?? row.id ?? row.external_id ?? pu?._id ?? pu?.id ?? null,
    name: row.name ?? row.polling_unit_name ?? pu?.name ?? null,
    code: row.pu_code ?? row.code ?? pu?.pu_code ?? pu?.code ?? null,
    document: row.document ?? pu?.document ?? null,
    result: row.result ?? pu?.result ?? null,
    url: row.url ?? row.file_url ?? pu?.url ?? pu?.file_url ?? null,
  }, null, 2));
}

console.log("=== RAW POLLING UNIT SAMPLE ===");
console.log(JSON.stringify(puPayload, null, 2).slice(0, 20000));
