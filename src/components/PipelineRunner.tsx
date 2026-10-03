import { CheckCircle2, Loader2, Play, XCircle } from "lucide-react";
import { useState } from "react";
import { supabase } from "../lib/supabase";

interface PipelineRunnerProps {}
interface SyncResponse { ok?: boolean; error?: string; discovered?: number; }
interface BatchResponse { ok?: boolean; error?: unknown; processed?: number; failed?: number; remaining?: number; ward_jobs?: { processed?: number; failed?: number }; processing_delegated?: boolean; }

function errorText(value: unknown): string { if (value instanceof Error) return value.message; if (typeof value === "string") return value; if (value && typeof value === "object") { const record = value as Record<string, unknown>; if (typeof record.message === "string") return record.message; if (typeof record.error === "string") return record.error; try { return JSON.stringify(value); } catch { return "The pipeline returned an unreadable error."; } } return String(value ?? "The pipeline could not be completed."); }

export function PipelineRunner(_props: PipelineRunnerProps) {
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);

  async function post(path: string, body: unknown) {
    const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data?.ok) throw new Error(errorText(data?.error) || `Request failed with HTTP ${response.status}.`);
    return data as BatchResponse;
  }

  async function run(): Promise<void> {
    setRunning(true); setError(false); setMessage("Discovering elections and queueing IReV wards…");
    try {
      if (!supabase) throw new Error("Supabase is not configured.");
      const discoveryResponse = await fetch("/api/irev-sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "discover" }) });
      const discovery = await discoveryResponse.json() as SyncResponse;
      if (!discoveryResponse.ok || !discovery?.ok) throw new Error(discovery?.error ?? `Discovery failed with HTTP ${discoveryResponse.status}.`);

      const batch = await post("/api/irev-batch", {});
      const wardCount = batch.ward_jobs?.processed ?? 0;
      const sheetQueue = batch.remaining ?? 0;
      setMessage(`Discovery complete — ${discovery.discovered ?? 0} elections found. ${wardCount} ward jobs synchronized; ${sheetQueue} result-processing jobs are queued for the PaddleOCR worker.`);
      setError((batch.ward_jobs?.failed ?? 0) > 0);
    } catch (caught: unknown) {
      setError(true); setMessage(errorText(caught));
    } finally { setRunning(false); }
  }

  return (
    <div className="fixed bottom-20 left-4 right-4 z-40 sm:bottom-6 sm:left-6 sm:right-auto">
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
