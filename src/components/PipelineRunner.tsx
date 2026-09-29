import { CheckCircle2, Loader2, Play, XCircle } from "lucide-react";
import { useState } from "react";
import { supabase } from "../lib/supabase";

interface PipelineRunnerProps {}
interface SyncResponse { ok?: boolean; error?: string; discovered?: number; }
interface BatchResponse { ok?: boolean; error?: string; processed?: number; failed?: number; remaining?: number; ward_jobs?: { processed?: number; failed?: number }; }

export function PipelineRunner(_props: PipelineRunnerProps) {
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);

  async function post(path: string, body: unknown) {
    const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data?.ok) throw new Error(data?.error ?? `Request failed with HTTP ${response.status}.`);
    return data as BatchResponse;
  }

  async function run(): Promise<void> {
    setRunning(true); setError(false); setMessage("Discovering elections and queueing IReV wards…");
    try {
      if (!supabase) throw new Error("Supabase is not configured.");
      const discoveryResponse = await fetch("/api/irev-sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "discover" }) });
      const discovery = await discoveryResponse.json() as SyncResponse;
      if (!discoveryResponse.ok || !discovery?.ok) throw new Error(discovery?.error ?? `Discovery failed with HTTP ${discoveryResponse.status}.`);

      let remaining = Number.POSITIVE_INFINITY;
      let batchNumber = 0;
      let wards = 0;
      let sheets = 0;
      let failures = 0;
      setMessage(`Discovery complete — ${discovery.discovered ?? 0} elections found. Processing in bounded batches…`);

      while (remaining > 0) {
        batchNumber++;
        const batch = await post("/api/irev-batch", {});
        const wardCount = batch.ward_jobs?.processed ?? 0;
        const sheetCount = batch.processed ?? 0;
        wards += wardCount;
        sheets += sheetCount;
        failures += batch.failed ?? 0;
        remaining = batch.remaining ?? 0;
        setMessage(`Batch ${batchNumber}: ${wardCount} wards + ${sheetCount} result sheets processed. ${remaining} jobs remaining${failures ? `, ${failures} failed/retried` : ""}.`);
        if (wardCount === 0 && sheetCount === 0 && remaining > 0) throw new Error("The queue still contains jobs, but this batch made no progress. Check the pipeline logs.");
      }

      setMessage(`Pipeline complete — ${wards} ward jobs and ${sheets} result-sheet jobs processed.`);
      setError(failures > 0);
    } catch (caught: unknown) {
      setError(true); setMessage(caught instanceof Error ? caught.message : "The pipeline could not be completed.");
    } finally { setRunning(false); }
  }

  return (
    <div className="fixed bottom-4 left-4 z-40 sm:bottom-6 sm:left-6">
      {message && <div className="mb-3 flex w-[min(24rem,calc(100vw-2rem))] items-start gap-3 rounded-2xl border border-zinc-800/60 bg-zinc-950/95 p-4 text-xs leading-5 text-zinc-300 shadow-2xl shadow-black/40 backdrop-blur-xl">
        {error ? <XCircle className="mt-0.5 shrink-0 text-red-400" size={16} /> : !running ? <CheckCircle2 className="mt-0.5 shrink-0 text-emerald-400" size={16} /> : <Loader2 className="mt-0.5 shrink-0 animate-spin text-zinc-400" size={16} />}
        <span>{message}</span>
      </div>}
      <button onClick={() => void run()} disabled={running} className="inline-flex items-center gap-2 rounded-xl border border-zinc-700/70 bg-zinc-100 px-4 py-2.5 text-sm font-semibold text-zinc-950 shadow-xl shadow-black/20 transition-all duration-200 ease-in-out hover:translate-y-[-1px] hover:bg-white disabled:cursor-not-allowed disabled:opacity-60">
        {running ? <Loader2 className="animate-spin" size={16} /> : <Play size={16} />}{running ? "Running pipeline…" : "Run pipeline"}
      </button>
    </div>
  );
}
