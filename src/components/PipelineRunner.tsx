import { useState } from "react";
import { CheckCircle2, Loader2, Play, XCircle } from "lucide-react";
import { supabase } from "../lib/supabase";

export function PipelineRunner() {
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);

  async function run() {
    setRunning(true);
    setMessage("Discovering elections and result sheets…");
    setError(false);

    try {
      if (!supabase) throw new Error("Supabase is not configured.");
      const client = supabase;

      const { data, error: invokeError } = await client.functions.invoke("irev-sync", {
        body: { mode: "discover" },
      });
      if (invokeError) throw invokeError;
      if (!data?.ok) throw new Error(data?.error || "The collector did not complete.");

      const { data: sheets, error: sheetError } = await supabase
        .from("result_sheets")
        .select("id")
        .order("discovered_at", { ascending: true });

      if (sheetError) throw sheetError;

      const ids = (sheets ?? []).map((row) => row.id);
      if (!ids.length) {
        setMessage(`Discovery complete — ${data.discovered ?? 0} elections found. No new result-sheet source links were available for processing.`);
        return;
      }

      let completed = 0;
      let failed = 0;
      const concurrency = 3;

      setMessage(`Refreshing ${ids.length} result sheets — fetching remote URLs → hashing → extracting only changed evidence…`);

      for (let i = 0; i < ids.length; i += concurrency) {
        const batch = ids.slice(i, i + concurrency);
        const results = await Promise.all(
          batch.map(async (id) => {
            const result = await client.functions.invoke("irev-process", {
              body: { result_sheet_id: id },
            });
            return result.error || !result.data?.ok ? false : true;
          }),
        );

        completed += results.filter(Boolean).length;
        failed += results.filter((value) => !value).length;
        setMessage(`Processing result sheets… ${completed}/${ids.length} completed, ${failed} failed.`);
      }

      setMessage(
        `Refresh complete — ${data.discovered ?? 0} elections discovered, ${ids.length} source URLs checked, ${failed} failed. Result documents are fetched transiently and never stored in Supabase Storage.`,
      );
      setError(failed > 0);
    } catch (e) {
      setError(true);
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div style={{ position: "fixed", left: 22, bottom: 22, zIndex: 20 }}>
      <button
        onClick={() => void run()}
        disabled={running}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          padding: "12px 15px",
          borderRadius: 12,
          border: "1px solid #303844",
          background: "#11161d",
          color: "#edf2f7",
          fontWeight: 700,
        }}
      >
        {running ? <><Loader2 size={16} /> Running…</> : <><Play size={16} /> Run pipeline</>}
      </button>

      {message && (
        <div
          style={{
            marginTop: 10,
            width: 390,
            padding: 16,
            border: "1px solid #303844",
            borderRadius: 14,
            background: "#0d1117",
            color: "#dce2e7",
            fontSize: 12,
            display: "flex",
            alignItems: "flex-start",
            gap: 8,
          }}
        >
          {error ? <XCircle size={16} /> : !running ? <CheckCircle2 size={16} /> : <Loader2 size={16} />}
          <span>{message}</span>
        </div>
      )}
    </div>
  );
}
