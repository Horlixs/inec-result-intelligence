import { useState } from "react";
import { CheckCircle2, Loader2, Play, XCircle } from "lucide-react";
import { supabase } from "../lib/supabase";

export function PipelineRunner() {
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);

  async function run() {
    setRunning(true);
    setMessage("Starting server-side IReV collector…");
    setError(false);

    try {
      if (!supabase) throw new Error("Supabase is not configured.");

      const { data, error: invokeError } = await supabase.functions.invoke("irev-sync", {
        body: { mode: "discover" },
      });

      if (invokeError) throw invokeError;
      if (!data?.ok) throw new Error(data?.error || "The collector did not complete.");

      setMessage(
        `Done — ${data.discovered ?? 0} IReV election records discovered and synchronized. Original evidence will be retained according to its storage policy.`,
      );
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
            width: 360,
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
