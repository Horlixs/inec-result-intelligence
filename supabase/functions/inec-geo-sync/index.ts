import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const url = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(url, serviceKey);

Deno.serve(async request => {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST required" }), { status: 405 });
  }

  const geo = await import("npm:nigeria-inec-geo@1.0.0");
  const states = geo.states();
  const lgas = geo.lgas();
  const wards = geo.wards();
  const pollingUnits = geo.pollingUnits();

  const stateRows = states.map((item: { code: string | number; name: string }) => ({
    name: item.name,
    code: String(item.code).padStart(2, "0"),
  }));

  const { data: stateData, error: stateError } = await supabase
    .from("states")
    .upsert(stateRows, { onConflict: "code" })
    .select("id,code");

  if (stateError) throw stateError;

  const stateIds = new Map((stateData ?? []).map(row => [row.code, row.id]));

  const lgaRows = lgas.map((item: { state_code?: string | number; stateCode?: string | number; code: string | number; name: string }) => {
    const stateCode = String(item.state_code ?? item.stateCode).padStart(2, "0");
    const stateId = stateIds.get(stateCode);
    if (!stateId) throw new Error("Unknown state code " + stateCode);
    return { state_id: stateId, code: String(item.code).padStart(2, "0"), name: item.name };
  });

  const { data: lgaData, error: lgaError } = await supabase
    .from("lgas")
    .upsert(lgaRows, { onConflict: "state_id,code" })
    .select("id,state_id,code");

  if (lgaError) throw lgaError;

  const lgaIds = new Map((lgaData ?? []).map(row => [row.state_id + "/" + row.code, row.id]));

  const wardRows = wards.map((item: { state_code?: string | number; stateCode?: string | number; lga_code?: string | number; lgaCode?: string | number; code: string | number; name: string; full_code?: string }) => {
    const stateCode = String(item.state_code ?? item.stateCode).padStart(2, "0");
    const lgaCode = String(item.lga_code ?? item.lgaCode).padStart(2, "0");
    const stateId = stateIds.get(stateCode);
    const lgaId = lgaIds.get(stateId + "/" + lgaCode);
    if (!lgaId) throw new Error("Unknown LGA " + stateCode + "/" + lgaCode);
    return { lga_id: lgaId, code: String(item.code).padStart(2, "0"), name: item.name, external_id: item.full_code ?? null };
  });

  const { data: wardData, error: wardError } = await supabase
    .from("wards")
    .upsert(wardRows, { onConflict: "lga_id,code" })
    .select("id,lga_id,code");

  if (wardError) throw wardError;

  const wardIds = new Map((wardData ?? []).map(row => [row.lga_id + "/" + row.code, row.id]));

  const puRows = pollingUnits.map((item: { full_code: string; name: string }) => {
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

  for (let i = 0; i < puRows.length; i += 5000) {
    const { error } = await supabase.from("polling_units").upsert(puRows.slice(i, i + 5000), { onConflict: "ward_id,pu_code" });
    if (error) throw error;
  }

  return new Response(JSON.stringify({
    ok: true,
    source: "nigeria-inec-geo snapshot",
    states: stateRows.length,
    lgas: lgaRows.length,
    wards: wardRows.length,
    pollingUnits: puRows.length
  }), { headers: { "content-type": "application/json" } });
});
