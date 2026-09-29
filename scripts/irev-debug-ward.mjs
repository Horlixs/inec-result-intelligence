import fs from "node:fs";

const electionId = "6aae6541d0998b3b55a9af98";
const wardOid = "5f0f39814d89fc3a883de129";
const base = "https://dolphin-app-sleqh.ondigitalocean.app/api/v1";
const source = fs.readFileSync("supabase/functions/irev-batch/index.ts", "utf8");
const key = source.match(/const IREV_KEY = "([^"]+)"/)?.[1];
if (!key) throw new Error("Could not read the existing IReV API key from the worker source.");

const url = `${base}/elections/${electionId}/pus?ward=${wardOid}`;
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
console.log(JSON.stringify({
  url,
  status: response.status,
  contentType: response.headers.get("content-type"),
  length: text.length,
  prefix: text.slice(0, 2000),
}, null, 2));

if (!response.ok) process.exit(1);

let payload;
try { payload = JSON.parse(text); } catch (error) {
  console.error("Response was not JSON:", error.message);
  process.exit(1);
}

function describe(value, depth = 0) {
  if (depth > 4) return "[max-depth]";
  if (Array.isArray(value)) return { type: "array", length: value.length, first: value.length ? describe(value[0], depth + 1) : null };
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = describe(v, depth + 1);
    return out;
  }
  return { type: typeof value, value };
}

console.log("=== SHAPE ===");
console.log(JSON.stringify(describe(payload), null, 2));

console.log("=== OBJECT ARRAY CANDIDATES ===");
const candidates = [];
function collect(value, path = "$") {
  if (candidates.length >= 20) return;
  if (Array.isArray(value)) {
    for (let i = 0; i < Math.min(value.length, 20); i++) {
      if (value[i] && typeof value[i] === "object") candidates.push({ path: path + "[" + i + "]", value: value[i] });
      if (candidates.length >= 20) break;
    }
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) collect(v, path + "." + k);
  }
}
collect(payload);
for (const item of candidates.slice(0, 10)) {
  const object = item.value;
  console.log(JSON.stringify({
    path: item.path,
    keys: Object.keys(object),
    id: object._id ?? object.id ?? object.external_id ?? null,
    polling_unit: object.polling_unit && typeof object.polling_unit === "object"
      ? { keys: Object.keys(object.polling_unit), id: object.polling_unit._id ?? object.polling_unit.id ?? null }
      : object.polling_unit ?? null,
    document: object.document ?? null,
    result: object.result ?? null,
    url: object.url ?? null,
    file_url: object.file_url ?? null,
  }, null, 2));
}

console.log("=== RAW SAMPLE ===");
console.log(JSON.stringify(payload, null, 2).slice(0, 12000));

// diagnostic trigger marker
