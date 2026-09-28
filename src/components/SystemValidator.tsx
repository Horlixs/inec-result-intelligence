import { CheckCircle2, Loader2, ShieldCheck, XCircle } from "lucide-react";
import { useState } from "react";
import { supabase } from "../lib/supabase";
import { validateExtractedResult } from "../lib/irev";
import type { ExtractedResult } from "../lib/irev";

interface SystemValidatorProps {}
interface ValidationResult { checked: number; passed: number; failed: number; issues: string[]; }
interface CandidateRecord { label?: unknown; votes?: unknown; }
interface RawExtraction { pollingUnitName?: unknown; pollingUnitCode?: unknown; registeredVoters?: unknown; accreditedVoters?: unknown; rejectedVotes?: unknown; candidates?: unknown; }

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null; }
function asNullableNumber(value: unknown): number | null { if (value === null || value === undefined || value === "") return null; const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; }
function asCandidate(value: unknown): { label: string; votes: number | null } { const record: CandidateRecord = isRecord(value) ? value : {}; return { label: String(record.label ?? ""), votes: asNullableNumber(record.votes) }; }
function toExtractedResult(value: unknown): ExtractedResult | null {
  if (!isRecord(value) || !Array.isArray(value.candidates)) return null;
  const raw: RawExtraction = value;
  const candidates: unknown[] = raw.candidates;
  return {
    pollingUnitName: raw.pollingUnitName == null ? null : String(raw.pollingUnitName),
    pollingUnitCode: raw.pollingUnitCode == null ? null : String(raw.pollingUnitCode),
    registeredVoters: asNullableNumber(raw.registeredVoters),
    accreditedVoters: asNullableNumber(raw.accreditedVoters),
    rejectedVotes: asNullableNumber(raw.rejectedVotes),
    candidates: candidates.map(asCandidate),
  };
}

export function SystemValidator(_props: SystemValidatorProps) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ValidationResult | null>(null);
  async function run(): Promise<void> {
    if (!supabase) { setResult({ checked: 0, passed: 0, failed: 1, issues: ["Supabase is not configured."] }); return; }
    setRunning(true); setResult(null);
    try {
      const response = await supabase.from("result_sheets").select("id,source_url,source_hash");
      if (response.error) throw response.error;
      const issues: string[] = []; let passed = 0;
      for (const sheet of response.data ?? []) {
        let valid = true;
        if (!sheet.source_url || !/^https:\/\//i.test(sheet.source_url)) { issues.push(`${sheet.id}: invalid source URL`); valid = false; }
        if (!sheet.source_hash) { issues.push(`${sheet.id}: missing SHA-256 source hash`); valid = false; }
        const extractionResponse = await supabase.from("extractions").select("id,raw_output,confidence").eq("result_sheet_id", sheet.id);
        if (extractionResponse.error) { issues.push(`${sheet.id}: ${extractionResponse.error.message}`); valid = false; continue; }
        if (!extractionResponse.data?.length) { issues.push(`${sheet.id}: no extraction recorded`); valid = false; }
        for (const extraction of extractionResponse.data ?? []) {
          if (extraction.confidence != null && (extraction.confidence < 0 || extraction.confidence > 1)) { issues.push(`${extraction.id}: confidence outside 0–1`); valid = false; }
          const extracted = toExtractedResult(extraction.raw_output);
          if (extracted) {
            const checked = validateExtractedResult(extracted);
            if (!checked.valid) { issues.push(...checked.issues.map((issue: string) => `${extraction.id}: ${issue}`)); valid = false; }
          }
        }
        if (valid) passed += 1;
      }
      setResult({ checked: response.data?.length ?? 0, passed, failed: (response.data?.length ?? 0) - passed, issues: issues.slice(0, 50) });
    } catch (caught: unknown) {
      setResult({ checked: 0, passed: 0, failed: 1, issues: [caught instanceof Error ? caught.message : "Validation failed."] });
    } finally { setRunning(false); }
  }
  return (
    <div className="fixed bottom-4 right-4 z-40 sm:bottom-6 sm:right-6">
      {result && <div className="absolute bottom-14 right-0 max-h-96 w-[min(22rem,calc(100vw-2rem))] overflow-auto rounded-2xl border border-zinc-800/60 bg-zinc-950/95 p-5 shadow-2xl shadow-black/40 backdrop-blur-xl">
        <div className="flex items-center gap-2 text-sm font-semibold text-zinc-100">{result.failed ? <XCircle className="text-red-400" size={18} /> : <CheckCircle2 className="text-emerald-400" size={18} />}{result.failed ? "Validation needs review" : "Validation passed"}</div>
        <p className="mt-2 text-xs text-zinc-500">{result.passed}/{result.checked} result sheets passed.</p>
        {result.issues.length > 0 && <ul className="mt-4 space-y-2 text-xs leading-5 text-amber-300/80">{result.issues.map((issue: string, index: number) => <li key={`${issue}-${index}`}>• {issue}</li>)}</ul>}
      </div>}
      <button onClick={() => void run()} disabled={running} className="inline-flex items-center gap-2 rounded-xl border border-zinc-800/60 bg-zinc-900/90 px-4 py-2.5 text-sm font-semibold text-zinc-100 shadow-xl shadow-black/20 transition-all duration-200 ease-in-out hover:translate-y-[-1px] hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60">
        {running ? <Loader2 className="animate-spin" size={16} /> : <ShieldCheck size={16} />}{running ? "Validating…" : "Validate data"}
      </button>
    </div>
  );
}
