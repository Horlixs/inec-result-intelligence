import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const url = Deno.env.get("SUPABASE_URL");
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

type Stage =
  | "env"
  | "import"
  | "load-states"
  | "load-lgas"
  | "load-wards"
  | "load-polling-units"
  | "upsert-states"
  | "upsert-lgas"
  | "upsert-wards"
  | "build-polling-units"
  | "upsert-polling-units";

type SupabaseLikeError = {
  message?: string;
  code?: string;
  details?: string;
  hint?: string;
};

const errorDetails = (error: unknown) => {
  if (typeof error === "object" && error !== null) {
    const value = error as SupabaseLikeError;
    return {
      message: value.message ?? String(error),
      ...(value.code ? { code: value.code } : {}),
      ...(value.details ? { details: value.details } : {}),
      ...(value.hint ? { hint: value.hint } : {}),
    };
  }

  return { message: String(error) };
};

const response = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

Deno.serve(async request => {
  if (request.method !== "POST") {
    return response({ error: "POST required" }, 405);
  }

  let stage: Stage = "env";

  try {
    if (!url || !serviceKey) {
      return response({
        ok: false,
        stage,
        error: "Missing required Supabase Edge Function environment variables",
        missing: [
          ...(!url ? ["SUPABASE_URL"] : []),
          ...(!serviceKey ? ["SUPABASE_SERVICE_ROLE_KEY"] : []),
        ],
      }, 500);
    }

    const supabase = createClient(url, serviceKey);

    stage = "import";
    const geo = await import("npm:nigeria-inec-geo@1.0.0");

    stage = "load-states";
    const states = geo.states();

    stage = "load-lgas";
    const lgas = geo.lgas();

    stage = "load-wards";
    const wards = geo.wards();

    stage = "load-polling-units";
    const pollingUnits = geo.pollingUnits();

    stage = "upsert-states";
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

    stage = "upsert-lgas";
    const lgaRows = lgas.map((item: {
      state_code?: string | number;
      stateCode?: string | number;
      code: string | number;
      name: string;
    }) => {
      const stateCode = String(item.state_code ?? item.stateCode).padStart(2, "0");
      const stateId = stateIds.get(stateCode);
      if (!stateId) throw new Error("Unknown state code " + stateCode);
      return {
        state_id: stateId,
        code: String(item.code).padStart(2, "0"),
        name: item.name,
      };
    });

    const { data: lgaData, error: lgaError } = await supabase
      .from("lgas")
      .upsert(lgaRows, { onConflict: "state_id,code" })
      .select("id,state_id,code");

    if (lgaError) throw lgaError;

    const lgaIds = new Map((lgaData ?? []).map(row => [
      row.state_id + "/" + row.code,
      row.id,
    ]));

    stage = "upsert-wards";
    const wardRows = wards.map((item: {
      state_code?: string | number;
      stateCode?: string | number;
      lga_code?: string | number;
      lgaCode?: string | number;
      code: string | number;
      name: string;
      full_code?: string;
    }) => {
      const stateCode = String(item.state_code ?? item.stateCode).padStart(2, "0");
      const lgaCode = String(item.lga_code ?? item.lgaCode).padStart(2, "0");
      const stateId = stateIds.get(stateCode);
      const lgaId = lgaIds.get(stateId + "/" + lgaCode);
      if (!lgaId) throw new Error("Unknown LGA " + stateCode + "/" + lgaCode);
      return {
        lga_id: lgaId,
        code: String(item.code).padStart(2, "0"),
        name: item.name,
        external_id: item.full_code ?? null,
      };
    });

    const { data: wardData, error: wardError } = await supabase
      .from("wards")
      .upsert(wardRows, { onConflict: "lga_id,code" })
      .select("id,lga_id,code");

    if (wardError) throw wardError;

    const wardIds = new Map((wardData ?? []).map(row => [
      row.lga_id + "/" + row.code,
      row.id,
    ]));

    stage = "build-polling-units";
    const puRows = pollingUnits.map((item: {
      full_code: string;
      name: string;
    }) => {
      const parts = String(item.full_code).split("/");
      if (parts.length !== 4) {
        throw new Error("Invalid polling-unit code: " + item.full_code);
      }

      const stateId = stateIds.get(parts[0]);
      if (!stateId) {
        throw new Error("Unknown state for polling unit " + item.full_code);
      }

      const lgaId = lgaIds.get(stateId + "/" + parts[1]);
      if (!lgaId) {
        throw new Error("Unknown LGA for polling unit " + item.full_code);
      }

      const wardId = wardIds.get(lgaId + "/" + parts[2]);
      if (!wardId) {
        throw new Error("Unknown ward for polling unit " + item.full_code);
      }

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

    stage = "upsert-polling-units";
    const batchSize = 5000;

    for (let i = 0; i < puRows.length; i += batchSize) {
      const batch = puRows.slice(i, i + batchSize);
      const { error } = await supabase
        .from("polling_units")
        .upsert(batch, { onConflict: "ward_id,pu_code" });

      if (error) {
        throw new Error(JSON.stringify({
          batchStart: i,
          batchSize: batch.length,
          ...errorDetails(error),
        }));
      }
    }

    return response({
      ok: true,
      source: "nigeria-inec-geo snapshot",
      states: stateRows.length,
      lgas: lgaRows.length,
      wards: wardRows.length,
      pollingUnits: puRows.length,
    });
  } catch (error) {
    return response({
      ok: false,
      stage,
      error: errorDetails(error),
    }, 500);
  }
});
