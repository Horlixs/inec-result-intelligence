import { CheckCircle2, Loader2, Play, XCircle } from "lucide-react";
import { useState } from "react";
import { supabase } from "../lib/supabase";

interface PipelineRunnerProps {}
interface SyncResponse { ok?: boolean; error?: string; discovered?: number; }
interface SheetRow { id: string; }

export function PipelineRunner(_props: PipelineRunnerProps) {
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);

  async function run(): Promise<void> {
    setRunning(true); setMessage("Discovering elections and result sheets…"); setError(false);
    try {
      if (!supabase) throw new Error("Supabase is not configured.");
      const client = supabase;
      const response = await client.functions.invoke<SyncResponse>("irev-sync", { body: { mode: "discover" } });
      if (response.error) throw response.error;
      if (!response.data?.ok) throw new Error(response.data?.error ?? "The collector did not complete.");
      const sheetResponse = await client.from("result_sheets").select("id").order("discovered_at", { ascending: true });
      if (sheetResponse.error) throw sheetResponse.error;
      const ids = ((sheetResponse.data ?? []) as SheetRow[]).map((row) => row.id);
      if (!ids.length) { setMessage(`Discovery complete — ${response.data.discovered ?? 0} elections found. No result-sheet source links are available yet.`); return; }
      let completed = 0; let failed = 0; const concurrency = 3;
      setMessage(`Refreshing ${ids.length} result sheets…`);
      for (let index = 0; index < ids.length; index += concurrency) {
        const batch = ids.slice(index, index + concurrency);
        const results = await Promise.all(batch.map(async (id: string): Promise<boolean> => {
          const result = await client.functions.invoke<{ ok?: boolean }>("irev-process", { body: { result_sheet_id: id } });
          return !result.error && result.data?.ok === true;
        }));
        completed += results.filter(Boolean).length; failed += results.filter((value: boolean) => !value).length;
        setMessage(`Processing result sheets… ${completed}/${ids.length} completed, ${failed} failed.`);
      }
      setMessage(`Refresh complete — ${response.data.discovered ?? 0} elections discovered, ${ids.length} source URLs checked, ${failed} failed.`);
      setError(failed > 0);
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
