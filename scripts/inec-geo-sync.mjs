const stateRowsDb = await upsert("states", stateRows, "code");
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
const lgaRowsDb = await upsert("lgas", lgaRows, "state_id,code");
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
const wardRowsDb = await upsert("wards", wardRows, "lga_id,code");
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
