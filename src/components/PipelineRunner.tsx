import { CheckCircle2, Loader2, Play, ScanSearch, XCircle } from "lucide-react";
import { useState } from "react";
import { supabase } from "../lib/supabase";

interface PipelineRunnerProps {}
interface SyncResponse { ok?: boolean; error?: string; discovered?: number; }
interface BatchResponse { ok?: boolean; error?: unknown; processed?: number; failed?: number; remaining?: number; ward_jobs?: { processed?: number; failed?: number }; queue?: { ward_queued?: number; ward_processing?: number; sheet_queued?: number; sheet_processing?: number; total?: number }; processing_delegated?: boolean; }
interface ProcessingResponse { ok?: boolean; status?: string; error?: unknown; result_sheet_id?: string; result?: { status?: string; error?: string }; }

function errorText(value: unknown): string { if (value instanceof Error) return value.message; if (typeof value === "string") return value; if (value && typeof value === "object") { const record = value as Record<string, unknown>; if (typeof record.message === "string") return record.message; if (typeof record.error === "string") return record.error; try { return JSON.stringify(value); } catch { return "The pipeline returned an unreadable error."; } } return String(value ?? "The pipeline could not be completed."); }

export function PipelineRunner(_props: PipelineRunnerProps) {
  const [running, setRunning] = useState<"discovery" | "processing" | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);

  async function post(path: string, body: unknown) {
    const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data?.ok) throw new Error(errorText(data?.error) || `Request failed with HTTP ${response.status}.`);
    return data as BatchResponse;
  }

  async function runDiscovery(): Promise<void> {
    setRunning("discovery"); setError(false); setMessage("Discovering elections and queueing IReV wards…");
    try {
      if (!supabase) throw new Error("Supabase is not configured.");
      const discoveryResponse = await fetch("/api/irev-sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "discover" }) });
      const discovery = await discoveryResponse.json() as SyncResponse;
      if (!discoveryResponse.ok || !discovery?.ok) throw new Error(discovery?.error ?? `Discovery failed with HTTP ${discoveryResponse.status}.`);

      const batch = await post("/api/irev-batch", {});
      const wardCount = batch.ward_jobs?.processed ?? 0;
      const wardFailed = batch.ward_jobs?.failed ?? 0;
      const sheetQueue = batch.queue?.sheet_queued ?? 0;
      setMessage(`Discovery complete — ${discovery.discovered ?? 0} elections found. ${wardCount} ward jobs processed in this run; ${sheetQueue} result-processing jobs are currently queued for the PaddleOCR worker.${wardFailed ? ` ${wardFailed} ward jobs failed.` : ""}`);
      setError(wardFailed > 0);
    } catch (caught: unknown) {
      setError(true); setMessage(errorText(caught));
    } finally { setRunning(null); }
  }

  async function runProcessing(): Promise<void> {
    setRunning("processing"); setError(false); setMessage("Starting one queued PaddleOCR processing job…");
    try {
      const response = await fetch("/api/irev-process-next", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const data = await response.json().catch(() => ({})) as ProcessingResponse;
      if (data.status === "idle") {
        setMessage("Processing queue is currently empty.");
        return;
      }
      if (!response.ok || !data.ok) throw new Error(errorText(data.error ?? data.result?.error) || `Processing failed with HTTP ${response.status}.`);
      setMessage(`Processing completed successfully — result sheet ${data.result_sheet_id ?? ""} was processed by the existing IReV processor.`);
    } catch (caught: unknown) {
      setError(true); setMessage(errorText(caught));
    } finally { setRunning(null); }
  }

  return (
    <div className="fixed bottom-4 left-4 z-[60] sm:bottom-6 lg:left-[18rem]">
      {message && <div className="mb-3 flex w-[min(30rem,calc(100vw-2rem))] items-start gap-3 rounded-2xl border border-zinc-800/60 bg-zinc-950/95 p-4 text-xs leading-5 text-zinc-300 shadow-2xl shadow-black/40 backdrop-blur-xl">
        {error ? <XCircle className="mt-0.5 shrink-0 text-red-400" size={16} /> : !running ? <CheckCircle2 className="mt-0.5 shrink-0 text-emerald-400" size={16} /> : <Loader2 className="mt-0.5 shrink-0 animate-spin text-zinc-400" size={16} />}
        <span>{message}</span>
      </div>}
      <div className="flex items-center gap-2">
        <button onClick={() => void runDiscovery()} disabled={running !== null} className="inline-flex items-center gap-2 rounded-xl border border-zinc-700/70 bg-zinc-100 px-4 py-2.5 text-sm font-semibold text-zinc-950 shadow-xl shadow-black/20 transition-all duration-200 ease-in-out hover:translate-y-[-1px] hover:bg-white disabled:cursor-not-allowed disabled:opacity-60">
          {running === "discovery" ? <Loader2 className="animate-spin" size={16} /> : <ScanSearch size={16} />}{running === "discovery" ? "Running discovery…" : "Run discovery"}
        </button>
        <button onClick={() => void runProcessing()} disabled={running !== null} className="inline-flex items-center gap-2 rounded-xl border border-zinc-700/70 bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-zinc-100 shadow-xl shadow-black/20 transition-all duration-200 ease-in-out hover:translate-y-[-1px] hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60">
          {running === "processing" ? <Loader2 className="animate-spin" size={16} /> : <Play size={16} />}{running === "processing" ? "Processing…" : "Run processing"}
        </button>
      </div>
    </div>
  );
}
