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
    const payload = await request.json().catch(() => ({}));
    const mode = payload?.mode === "polling-units" ? "polling-units" : "hierarchy";
    const stateCode = payload?.stateCode ? String(payload.stateCode).padStart(2, "0") : null;

    stage = "import";
    const geo = await import("npm:nigeria-inec-geo@1.0.0");

    if (mode === "hierarchy") {
      stage = "load-states";
      const states = geo.states();
      stage = "load-lgas";
      const lgas = geo.lgas();
      stage = "load-wards";
      const wards = geo.wards();

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
        const code = String(item.state_code ?? item.stateCode).padStart(2, "0");
        const stateId = stateIds.get(code);
        if (!stateId) throw new Error("Unknown state code " + code);
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
        const code = String(item.state_code ?? item.stateCode).padStart(2, "0");
        const lgaCode = String(item.lga_code ?? item.lgaCode).padStart(2, "0");
        const stateId = stateIds.get(code);
        const lgaId = lgaIds.get(stateId + "/" + lgaCode);
        if (!lgaId) throw new Error("Unknown LGA " + code + "/" + lgaCode);
        return {
          lga_id: lgaId,
          code: String(item.code).padStart(2, "0"),
          name: item.name,
          external_id: item.full_code ?? null,
        };
      });

      const { error: wardError } = await supabase
        .from("wards")
        .upsert(wardRows, { onConflict: "lga_id,code" });

      if (wardError) throw wardError;

      return response({
        ok: true,
        mode,
        states: stateRows.length,
        lgas: lgaRows.length,
        wards: wardRows.length,
      });
    }

    if (!stateCode) {
      return response({ ok: false, stage, error: "stateCode is required for polling-units mode" }, 400);
    }

    stage = "load-states";
    const { data: stateRows, error: stateError } = await supabase
      .from("states")
      .select("id,code")
      .eq("code", stateCode)
      .single();

    if (stateError) throw stateError;

    stage = "load-lgas";
    const { data: lgaRows, error: lgaError } = await supabase
      .from("lgas")
      .select("id,code")
      .eq("state_id", stateRows.id);

    if (lgaError) throw lgaError;

    const lgaByCode = new Map((lgaRows ?? []).map(row => [row.code, row.id]));
    const lgaIds = (lgaRows ?? []).map(row => row.id);

    stage = "load-wards";
    const { data: wardRows, error: wardError } = await supabase
      .from("wards")
      .select("id,lga_id,code")
      .in("lga_id", lgaIds.length ? lgaIds : ["00000000-0000-0000-0000-000000000000"]);

    if (wardError) throw wardError;

    const wardByCode = new Map((wardRows ?? []).map(row => [
      row.lga_id + "/" + row.code,
      row.id,
    ]));

    stage = "load-polling-units";
    const pollingUnits = geo.pollingUnits().filter((item: { full_code: string }) =>
      String(item.full_code).startsWith(stateCode + "/")
    );

    stage = "build-polling-units";
    const batchSize = 1000;

    for (let i = 0; i < pollingUnits.length; i += batchSize) {
      const batch = pollingUnits.slice(i, i + batchSize).map((item: {
        full_code: string;
        name: string;
      }) => {
        const parts = String(item.full_code).split("/");
        if (parts.length !== 4) throw new Error("Invalid polling-unit code: " + item.full_code);

        const lgaId = lgaByCode.get(parts[1]);
        if (!lgaId) throw new Error("Unknown LGA for polling unit " + item.full_code);

        const wardId = wardByCode.get(lgaId + "/" + parts[2]);
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

      stage = "upsert-polling-units";
      const { error } = await supabase
        .from("polling_units")
        .upsert(batch, { onConflict: "ward_id,pu_code" });

      if (error) {
        throw new Error(JSON.stringify({
          stateCode,
          batchStart: i,
          batchSize: batch.length,
          ...errorDetails(error),
        }));
      }
    }

    return response({
      ok: true,
      mode,
      stateCode,
      pollingUnits: pollingUnits.length,
    });
  } catch (error) {
    return response({
      ok: false,
      stage,
      error: errorDetails(error),
    }, 500);
  }
});
