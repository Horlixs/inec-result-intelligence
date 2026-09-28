import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const geo = require("nigeria-inec-geo");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
}

const BATCH_SIZE = 500;

async function upsert(table, rows, onConflict) {
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const url = new URL(SUPABASE_URL + "/rest/v1/" + table);
    url.searchParams.set("on_conflict", onConflict);
    const response = await fetch(url, {
      method: "POST",
      headers: {
        apikey: SERVICE_KEY,
        Authorization: "Bearer " + SERVICE_KEY,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(batch),
    });
    if (!response.ok) throw new Error("Supabase " + table + " failed: " + await response.text());
    process.stdout.write("\r" + table + ": " + Math.min(i + batch.length, rows.length) + "/" + rows.length);
  }
  process.stdout.write("\n");
}

async function selectIds(table, filterColumn, filterValue, select = "id") {
  const url = new URL(SUPABASE_URL + "/rest/v1/" + table);
  url.searchParams.set(filterColumn, "eq." + filterValue);
  url.searchParams.set("select", select);
  const response = await fetch(url, {
    headers: { apikey: SERVICE_KEY, Authorization: "Bearer " + SERVICE_KEY },
  });
  if (!response.ok) throw new Error("Could not resolve " + table + ": " + await response.text());
  return response.json();
}

const states = geo.states();
const lgas = geo.lgas();
const wards = geo.wards();
const pollingUnits = geo.pollingUnits();

const stateRows = states.map((item) => ({
  name: item.name,
  code: String(item.code).padStart(2, "0"),
}));
await upsert("states", stateRows, "code");

const stateRowsDb = await selectIds("states", "code", "not.null", "id,code");
const stateIds = new Map(stateRowsDb.map((row) => [row.code, row.id]));

const lgaRows = lgas.map((item) => {
  const stateCode = String(item.state_code ?? item.stateCode).padStart(2, "0");
  if (!stateIds.has(stateCode)) throw new Error("Unknown state code " + stateCode);
  return {
    state_id: stateIds.get(stateCode),
    code: String(item.code).padStart(2, "0"),
    name: item.name,
  };
});
await upsert("lgas", lgaRows, "state_id,code");

const lgaRowsDb = await selectIds("lgas", "code", "not.null", "id,state_id,code");
const lgaIds = new Map(lgaRowsDb.map((row) => [row.state_id + "/" + row.code, row.id]));

const wardRows = wards.map((item) => {
  const stateCode = String(item.state_code ?? item.stateCode).padStart(2, "0");
  const lgaCode = String(item.lga_code ?? item.lgaCode).padStart(2, "0");
  const lgaId = lgaIds.get(stateIds.get(stateCode) + "/" + lgaCode);
  if (!lgaId) throw new Error("Unknown LGA " + stateCode + "/" + lgaCode + " for ward " + item.name);
  return {
    lga_id: lgaId,
    code: String(item.code).padStart(2, "0"),
    name: item.name,
    external_id: item.full_code ?? null,
  };
});
await upsert("wards", wardRows, "lga_id,code");

const wardRowsDb = await selectIds("wards", "code", "not.null", "id,lga_id,code");
const wardIds = new Map(wardRowsDb.map((row) => [row.lga_id + "/" + row.code, row.id]));

const puRows = pollingUnits.map((item) => {
  const parts = String(item.full_code).split("/");
  if (parts.length !== 4) throw new Error("Invalid polling-unit code: " + item.full_code);
  const stateId = stateIds.get(parts[0]);
  const lgaId = lgaIds.get(stateId + "/" + parts[1]);
  const wardId = wardIds.get(lgaId + "/" + parts[2]);
  if (!wardId) throw new Error("Unknown ward for polling unit " + item.full_code);
  return {
    ward_id: wardId,
    pu_code: parts[3].padStart(3, "0"),
    name: item.name,
    external_id: item.full_code,
    state_code: parts[0],
    lga_code: parts[1],
    ward_code: parts[2],
  };
});
await upsert("polling_units", puRows, "ward_id,pu_code");

console.log(JSON.stringify({
  syncedAt: new Date().toISOString(),
  source: "INEC Continuous Voter Registration Polling Unit Portal snapshot",
  states: stateRows.length,
  lgas: lgaRows.length,
  wards: wardRows.length,
  pollingUnits: puRows.length,
}, null, 2));
