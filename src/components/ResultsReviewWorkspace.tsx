import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";

type Sheet = {
  id: string;
  election_id: string;
  polling_unit_id: string | null;
  source_url: string;
  source_external_id: string | null;
  source_hash: string | null;
  mime_type: string | null;
  evidence_url: string | null;
  evidence_size_bytes: number | null;
  discovered_at: string;
  captured_at: string | null;
  processed_at: string | null;
  status: string;
  evidence_status: string | null;
  processing_attempts: number | null;
  last_error: string | null;
};

type Election = { id: string; name: string; election_type: string | null; election_date: string | null };
type PollingUnit = { id: string; name: string; pu_code: string | null; ward_id: string };
type Ward = { id: string; name: string; lga_id: string };
type Lga = { id: string; name: string; state_id: string };
type State = { id: string; name: string };

type Extraction = {
  id: string;
  result_sheet_id: string;
  engine: string;
  engine_version: string | null;
  confidence: number | null;
  status: string;
  raw_output: Record<string, unknown>;
  created_at: string;
};

type Entry = { id: string; extraction_id: string; label: string; votes: number | null; raw_label: string | null; raw_value: string | null };
type Check = { id: string; extraction_id: string; check_name: string; passed: boolean; severity: string; details: Record<string, unknown> | null; created_at: string };

type ReviewRecord = Sheet & {
  election?: Election;
  pollingUnit?: PollingUnit | null;
  ward?: Ward | null;
  lga?: Lga | null;
  state?: State | null;
  extraction?: Extraction | null;
  entries: Entry[];
  checks: Check[];
};

const issueStatuses = ["pending_review", "failed", "processing"];
const issueClass = "border-amber-500/20 bg-amber-500/5";
const inputClass = "rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-zinc-600";

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

function bytes(value: number | null) {
  if (!value) return "—";
  if (value < 1024 * 1024) return Math.round(value / 1024) + " KB";
  return (value / (1024 * 1024)).toFixed(2) + " MB";
}

function isIssue(sheet: Sheet, extraction: Extraction | null, checks: Check[]) {
  return issueStatuses.includes(sheet.status) ||
    Boolean(checks.some(check => !check.passed || check.severity === "error")) ||
    Boolean(extraction && extraction.confidence !== null && extraction.confidence < 0.85);
}

function statusLabel(status: string) {
  return status.replaceAll("_", " ");
}

export function ResultsReviewWorkspace() {
  const [rows, setRows] = useState<ReviewRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("issues");
  const [electionFilter, setElectionFilter] = useState("all");
  const [selected, setSelected] = useState<ReviewRecord | null>(null);
  const [reviewNote, setReviewNote] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!supabase) {
      setError("Supabase is not configured.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");
    try {
      const [sheets, elections, pus, wards, lgas, states, extractions, entries, checks] = await Promise.all([
        supabase.from("result_sheets").select("id,election_id,polling_unit_id,source_url,source_external_id,source_hash,mime_type,evidence_url,evidence_size_bytes,discovered_at,captured_at,processed_at,status,evidence_status,processing_attempts,last_error").order("processed_at", { ascending: false, nullsFirst: false }).limit(300),
        supabase.from("elections").select("id,name,election_type,election_date"),
        supabase.from("polling_units").select("id,name,pu_code,ward_id"),
        supabase.from("wards").select("id,name,lga_id"),
        supabase.from("lgas").select("id,name,state_id"),
        supabase.from("states").select("id,name"),
        supabase.from("extractions").select("id,result_sheet_id,engine,engine_version,confidence,status,raw_output,created_at").order("created_at", { ascending: false }).limit(500),
        supabase.from("result_entries").select("id,extraction_id,label,votes,raw_label,raw_value").limit(3000),
        supabase.from("validation_checks").select("id,extraction_id,check_name,passed,severity,details,created_at").order("created_at", { ascending: false }).limit(3000)
      ]);

      for (const result of [sheets, elections, pus, wards, lgas, states, extractions, entries, checks]) {
        if (result.error) throw result.error;
      }

      const electionMap = new Map((elections.data ?? []).map(x => [x.id, x]));
      const puMap = new Map((pus.data ?? []).map(x => [x.id, x]));
      const wardMap = new Map((wards.data ?? []).map(x => [x.id, x]));
      const lgaMap = new Map((lgas.data ?? []).map(x => [x.id, x]));
      const stateMap = new Map((states.data ?? []).map(x => [x.id, x]));
      const extractionMap = new Map<string, Extraction>();
      for (const x of extractions.data ?? []) if (!extractionMap.has(x.result_sheet_id)) extractionMap.set(x.result_sheet_id, x as Extraction);

      const entriesMap = new Map<string, Entry[]>();
      for (const x of entries.data ?? []) entriesMap.set(x.extraction_id, [...(entriesMap.get(x.extraction_id) ?? []), x as Entry]);

      const checksMap = new Map<string, Check[]>();
      for (const x of checks.data ?? []) checksMap.set(x.extraction_id, [...(checksMap.get(x.extraction_id) ?? []), x as Check]);

      const built = (sheets.data ?? []).map(sheet => {
        const extraction = extractionMap.get(sheet.id) ?? null;
        const pu = sheet.polling_unit_id ? puMap.get(sheet.polling_unit_id) ?? null : null;
        const ward = pu ? wardMap.get(pu.ward_id) ?? null : null;
        const lga = ward ? lgaMap.get(ward.lga_id) ?? null : null;
        const state = lga ? stateMap.get(lga.state_id) ?? null : null;
        const record: ReviewRecord = {
          ...(sheet as Sheet),
          election: electionMap.get(sheet.election_id),
          pollingUnit: pu,
          ward,
          lga,
          state,
          extraction,
          entries: extraction ? entriesMap.get(extraction.id) ?? [] : [],
          checks: extraction ? checksMap.get(extraction.id) ?? [] : []
        };
        return record;
      }).filter(record => isIssue(record, record.extraction ?? null, record.checks));

      setRows(built);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 30000);
    return () => window.clearInterval(timer);
  }, [load]);

  const elections = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of rows) if (row.election) map.set(row.election.id, row.election.name);
    return [...map.entries()];
  }, [rows]);

  const filtered = useMemo(() => rows.filter(row => {
    const electionOk = electionFilter === "all" || row.election_id === electionFilter;
    const statusOk = filter === "issues" || filter === "pending" && row.status === "pending_review" || filter === "failed" && row.status === "failed" || filter === "processing" && row.status === "processing";
    return electionOk && statusOk;
  }), [rows, filter, electionFilter]);

  async function review(action: "approve" | "reject") {
    if (!supabase || !selected) return;
    setSaving(true);
    try {
      const result = await supabase.rpc("review_result_sheet", {
        p_result_sheet_id: selected.id,
        p_action: action,
        p_note: reviewNote.trim() || null
      });
      if (result.error) throw result.error;
      setSelected(null);
      setReviewNote("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="space-y-5">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-zinc-500">Evidence control</p>
          <h1 className="mt-1 text-2xl font-semibold text-zinc-100">Review results</h1>
          <p className="mt-1 max-w-2xl text-sm text-zinc-500">Every result with a processing failure, validation issue, low-confidence extraction, or pending review is surfaced here with its source and extraction evidence.</p>
        </div>
        <button type="button" onClick={() => void load()} className="rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-2 text-xs font-medium text-zinc-300 hover:bg-zinc-800">Refresh</button>
      </header>

      {error && <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-300">{error}</div>}

      <div className="grid gap-3 sm:grid-cols-4">
        {[["issues", "All issues"], ["pending", "Pending review"], ["failed", "Failed"], ["processing", "Processing"]].map(([value, label]) => (
          <button key={value} type="button" onClick={() => setFilter(value)} className={"rounded-2xl border p-4 text-left " + (filter === value ? "border-zinc-600 bg-zinc-900" : "border-zinc-800/70 bg-zinc-900/40")}>
            <p className="text-xs text-zinc-500">{label}</p>
            <p className="mt-1 text-xl font-semibold text-zinc-100">{value === "issues" ? rows.length : rows.filter(x => x.status === value).length}</p>
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <select value={electionFilter} onChange={e => setElectionFilter(e.target.value)} className={inputClass + " sm:max-w-sm"}>
          <option value="all">All elections</option>
          {elections.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
        <div className="rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-500">{filtered.length} result{filtered.length === 1 ? "" : "s"} require attention</div>
      </div>

      {loading ? (
        <div className="rounded-3xl border border-zinc-800 bg-zinc-900/40 p-10 text-center text-sm text-zinc-500">Loading review queue…</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-3xl border border-zinc-800 bg-zinc-900/40 p-10 text-center"><p className="text-sm font-medium text-zinc-300">No results require review.</p><p className="mt-1 text-xs text-zinc-600">The queue is checked automatically every 30 seconds.</p></div>
      ) : (
        <div className="overflow-hidden rounded-3xl border border-zinc-800/70">
          {filtered.map(row => (
            <button key={row.id} type="button" onClick={() => { setSelected(row); setReviewNote(""); }} className={"block w-full border-b border-zinc-800/60 p-5 text-left last:border-b-0 hover:bg-zinc-900/80 " + issueClass}>
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-amber-300">{statusLabel(row.status)}</span>
                    {row.extraction && <span className="rounded-full border border-zinc-800 bg-zinc-950 px-2 py-1 text-[10px] text-zinc-500">{row.extraction.confidence === null ? "confidence —" : Math.round(row.extraction.confidence * 100) + "% confidence"}</span>}
                  </div>
                  <h2 className="mt-2 truncate text-sm font-semibold text-zinc-200">{row.election?.name ?? "Unknown election"}</h2>
                  <p className="mt-1 text-xs text-zinc-500">{[row.state?.name, row.lga?.name, row.ward?.name, row.pollingUnit?.name].filter(Boolean).join(" · ") || "Polling unit unavailable"}</p>
                  <p className="mt-2 line-clamp-2 text-xs text-red-300/80">{row.last_error || row.checks.filter(x => !x.passed).map(x => x.check_name).join(", ") || "Review required by processing state."}</p>
                </div>
                <div className="shrink-0 text-right text-[11px] text-zinc-600">
                  <p>{formatDate(row.processed_at || row.discovered_at)}</p>
                  <p className="mt-1">{row.processing_attempts ?? 0} attempt{row.processing_attempts === 1 ? "" : "s"}</p>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {selected && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/70 p-4">
          <div className="mx-auto my-6 max-w-6xl rounded-3xl border border-zinc-800 bg-zinc-950 shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-zinc-800 p-6">
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-zinc-600">Result review</p>
                <h2 className="mt-1 text-xl font-semibold text-zinc-100">{selected.pollingUnit?.name ?? "Unknown polling unit"}</h2>
                <p className="mt-1 text-xs text-zinc-500">{selected.election?.name ?? "Unknown election"} · {selected.pollingUnit?.pu_code ?? "No PU code"}</p>
              </div>
              <button type="button" onClick={() => setSelected(null)} className="rounded-xl border border-zinc-800 px-3 py-2 text-xs text-zinc-400">Close</button>
            </div>

            <div className="grid gap-5 p-6 lg:grid-cols-[1.4fr_1fr]">
              <div className="space-y-5">
                <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5">
                  <h3 className="text-sm font-semibold text-zinc-200">Source evidence</h3>
                  <dl className="mt-4 grid gap-3 text-xs sm:grid-cols-2">
                    <div><dt className="text-zinc-600">Source page</dt><dd className="mt-1 break-all text-zinc-300">{selected.source_url}</dd></div>
                    <div><dt className="text-zinc-600">Evidence asset</dt><dd className="mt-1 break-all text-zinc-300">{selected.evidence_url || "Not captured"}</dd></div>
                    <div><dt className="text-zinc-600">SHA-256</dt><dd className="mt-1 break-all text-zinc-300">{selected.source_hash || "Not recorded"}</dd></div>
                    <div><dt className="text-zinc-600">Type / size</dt><dd className="mt-1 text-zinc-300">{selected.mime_type || "—"} · {bytes(selected.evidence_size_bytes)}</dd></div>
                  </dl>
                  {selected.evidence_url && <a href={selected.evidence_url} target="_blank" rel="noreferrer" className="mt-4 inline-flex rounded-xl bg-zinc-100 px-4 py-2 text-xs font-semibold text-zinc-950">Open evidence</a>}
                  <a href={selected.source_url} target="_blank" rel="noreferrer" className="ml-2 inline-flex rounded-xl border border-zinc-800 px-4 py-2 text-xs font-medium text-zinc-300">Open source page</a>
                </div>

                <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5">
                  <div className="flex items-center justify-between"><h3 className="text-sm font-semibold text-zinc-200">Extracted result</h3><span className="text-xs text-zinc-500">{selected.extraction ? Math.round((selected.extraction.confidence ?? 0) * 100) + "% confidence" : "No extraction"}</span></div>
                  <div className="mt-4 overflow-hidden rounded-xl border border-zinc-800">
                    <table className="w-full text-left text-xs"><thead className="bg-zinc-950 text-zinc-500"><tr><th className="p-3">Candidate / label</th><th className="p-3 text-right">Votes</th></tr></thead><tbody>{selected.entries.length ? selected.entries.map(entry => <tr key={entry.id} className="border-t border-zinc-800/60"><td className="p-3 text-zinc-300">{entry.label}</td><td className="p-3 text-right font-medium text-zinc-100">{entry.votes ?? "—"}</td></tr>) : <tr><td colSpan={2} className="p-4 text-zinc-600">No candidate entries were saved.</td></tr>}</tbody></table>
                  </div>
                  {selected.extraction && <pre className="mt-4 max-h-56 overflow-auto rounded-xl bg-zinc-950 p-4 text-[11px] leading-5 text-zinc-500">{JSON.stringify(selected.extraction.raw_output, null, 2)}</pre>}
                </div>
              </div>

              <div className="space-y-5">
                <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5">
                  <h3 className="text-sm font-semibold text-zinc-200">Validation checks</h3>
                  <div className="mt-3 space-y-2">{selected.checks.length ? selected.checks.map(check => <div key={check.id} className="rounded-xl border border-zinc-800 bg-zinc-950 p-3"><div className="flex items-center justify-between gap-3"><span className="text-xs text-zinc-300">{check.check_name.replaceAll("_", " ")}</span><span className={check.passed ? "text-emerald-400" : "text-red-400"}>{check.passed ? "Passed" : "Failed"}</span></div><p className="mt-1 text-[11px] text-zinc-600">{check.severity}</p>{check.details && <pre className="mt-2 overflow-auto text-[10px] text-zinc-500">{JSON.stringify(check.details, null, 2)}</pre>}</div>) : <p className="text-xs text-zinc-600">No validation checks were recorded.</p>}</div>
                </div>

                <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5">
                  <h3 className="text-sm font-semibold text-zinc-200">Processing metadata</h3>
                  <dl className="mt-3 grid gap-2 text-xs">{[
                    ["Status", selected.status], ["Evidence", selected.evidence_status || "—"], ["Attempts", String(selected.processing_attempts ?? 0)], ["Discovered", formatDate(selected.discovered_at)], ["Captured", formatDate(selected.captured_at)], ["Processed", formatDate(selected.processed_at)]
                  ].map(([k,v]) => <div key={k} className="flex justify-between gap-4"><dt className="text-zinc-600">{k}</dt><dd className="text-right text-zinc-300">{v}</dd></div>)}</dl>
                  {selected.last_error && <div className="mt-4 rounded-xl border border-red-500/20 bg-red-500/5 p-3 text-xs text-red-300">{selected.last_error}</div>}
                </div>

                <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5">
                  <h3 className="text-sm font-semibold text-zinc-200">Reviewer decision</h3>
                  <textarea value={reviewNote} onChange={e => setReviewNote(e.target.value)} rows={4} className={inputClass + " mt-3 w-full resize-none"} placeholder="Add a review note or correction reason…" />
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <button disabled={saving} type="button" onClick={() => void review("reject")} className="rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-300 disabled:opacity-50">Reject</button>
                    <button disabled={saving} type="button" onClick={() => void review("approve")} className="rounded-xl bg-zinc-100 px-3 py-2 text-xs font-semibold text-zinc-950 disabled:opacity-50">Approve</button>
                  </div>
                  <p className="mt-2 text-[10px] text-zinc-600">Approval marks the sheet verified. Rejection sends it back to the processing/review path with the note retained.</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
