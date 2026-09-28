import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { discoverFromHtml } from "./parser.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST required" }), { status: 405, headers: { "content-type": "application/json" } });
  }

  const startedAt = new Date().toISOString();

  try {
    const response = await fetch("https://inecelectionresults.ng/", {
      headers: { "user-agent": "INEC-Result-Intelligence/1.0 source-collector" },
    });
    if (!response.ok) throw new Error("IReV returned HTTP " + response.status);

    const html = await response.text();
    const elections = discoverFromHtml(html);

    if (elections.length) {
      const { error } = await supabase.from("elections").upsert(elections, { onConflict: "external_id" });
      if (error) throw error;
    }

    await supabase.from("pipeline_runs").insert({
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      status: "completed",
      discovered: elections.length,
      metadata: { source: "IReV", mode: "server-side-discovery" },
    });

    return new Response(JSON.stringify({
      ok: true,
      discovered: elections.length,
      elections,
      source: "https://inecelectionresults.ng/",
    }), { headers: { "content-type": "application/json" } });
  } catch (error) {
    await supabase.from("pipeline_runs").insert({
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      status: "failed",
      failed: 1,
      issues: [{ message: error instanceof Error ? error.message : String(error) }],
      metadata: { source: "IReV", mode: "server-side-discovery" },
    });

    return new Response(JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }), { status: 500, headers: { "content-type": "application/json" } });
  }
});
