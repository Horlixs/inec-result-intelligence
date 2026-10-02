import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Plus, Save, Search, Trash2, X } from "lucide-react";
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
  reviewed_at?: string | null;
  reviewed_by?: string | null;
  review_note?: string | null;
};

type Election = { id: string; name: string; election_type: string | null; election_date: string | null };
type PollingUnit = { id: string; name: string; pu_code: string | null; ward_id: string };
type Ward = { id: string; name: string; lga_id: string };
type Lga = { id: string; name: string; state_id: string };
type State = { id: string; name: string };
type Candidate = { id: string; name: string; ballot_order: number | null; party_id: string | null; party?: { abbreviation: string; name: string | null } | null };

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

type Entry = {
  id: string;
  extraction_id: string;
  candidate_id: string | null;
  label: string;
  votes: number | null;
  raw_label: string | null;
  raw_value: string | null;
};

type Check = {
  id: string;
  extraction_id: string;
  check_name: string;
  passed: boolean;
  severity: string;
  details: Record<string, unknown> | null;
  created_at: string;
};

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

type EntryDraft = {
  id?: string;
  candidate_id: string | null;
  label: string;
  votes: string;
  raw_label: string;
};

const issueStatuses = ["pending_review", "failed", "processing"];
const issueClass = "border-amber-500/20 bg-amber-500/5";
const inputClass = "rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-zinc-600";

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}


function isIssue(sheet: Sheet, extraction: Extraction | null, checks: Check[]) {
  // A check's severity describes the importance of a failed check; a passed
  // check must never turn a verified result into a review issue.
  return issueStatuses.includes(sheet.status) ||
    Boolean(checks.some(check => !check.passed)) ||
    Boolean(extraction && extraction.confidence !== null && extraction.confidence < 0.85);
}

function statusLabel(status: string) {
  return status.replaceAll("_", " ");
}

function draftEntries(entries: Entry[]): EntryDraft[] {
  return entries.map(entry => ({
    id: entry.id,
    candidate_id: entry.candidate_id,
    label: entry.label,
    votes: entry.votes === null ? "" : String(entry.votes),
    raw_label: entry.raw_label ?? entry.label,
  }));
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
  const [drafts, setDrafts] = useState<EntryDraft[]>([]);
  const [candidateOptions, setCandidateOptions] = useState<Candidate[]>([]);
  const [pollingUnitOptions, setPollingUnitOptions] = useState<PollingUnit[]>([]);
  const [pollingUnitSearch, setPollingUnitSearch] = useState("");
  const [optionsLoading, setOptionsLoading] = useState(false);

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
        supabase.from("result_sheets").select("id,election_id,polling_unit_id,source_url,source_external_id,source_hash,mime_type,evidence_url,evidence_size_bytes,discovered_at,captured_at,processed_at,status,evidence_status,processing_attempts,last_error,reviewed_at,reviewed_by,review_note").order("processed_at", { ascending: false, nullsFirst: false }).limit(1000),
        supabase.from("elections").select("id,name,election_type,election_date"),
        supabase.from("polling_units").select("id,name,pu_code,ward_id").limit(1000),
        supabase.from("wards").select("id,name,lga_id").limit(1000),
        supabase.from("lgas").select("id,name,state_id").limit(1000),
        supabase.from("states").select("id,name").limit(1000),
        supabase.from("extractions").select("id,result_sheet_id,engine,engine_version,confidence,status,raw_output,created_at").order("created_at", { ascending: false }).limit(1000),
        supabase.from("result_entries").select("id,extraction_id,candidate_id,label,votes,raw_label,raw_value").limit(5000),
        supabase.from("validation_checks").select("id,extraction_id,check_name,passed,severity,details,created_at").order("created_at", { ascending: false }).limit(5000)
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

  useEffect(() => {
    if (!selected || !supabase) return;
    setDrafts(draftEntries(selected.entries));
    setPollingUnitSearch(selected.pollingUnit?.pu_code || selected.pollingUnit?.name || "");
    setPollingUnitOptions(selected.pollingUnit ? [selected.pollingUnit] : []);
    setCandidateOptions([]);
    setOptionsLoading(true);

    void (async () => {
      try {
        const { data, error: candidateError } = await supabase
          .from("candidates")
          .select("id,name,ballot_order,party_id,parties(abbreviation,name)")
          .eq("election_id", selected.election_id)
          .order("ballot_order", { ascending: true, nullsFirst: false })
          .order("name", { ascending: true })
          .limit(1000);

        if (candidateError) throw candidateError;
        setCandidateOptions((data ?? []) as Candidate[]);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setOptionsLoading(false);
      }
    })();
  }, [selected]);

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

  async function findPollingUnits() {
    if (!supabase || !selected) return;
    const term = pollingUnitSearch.trim();
    if (!term) {
      setPollingUnitOptions(selected.pollingUnit ? [selected.pollingUnit] : []);
      return;
    }

    setOptionsLoading(true);
    setError("");
    try {
      const [byCode, byName] = await Promise.all([
        supabase.from("polling_units").select("id,name,pu_code,ward_id").ilike("pu_code", "%" + term + "%").limit(50),
        supabase.from("polling_units").select("id,name,pu_code,ward_id").ilike("name", "%" + term + "%").limit(50)
      ]);
      if (byCode.error) throw byCode.error;
      if (byName.error) throw byName.error;

      const merged = new Map<string, PollingUnit>();
      for (const item of [...(byCode.data ?? []), ...(byName.data ?? [])]) merged.set(item.id, item as PollingUnit);
      if (selected.pollingUnit) merged.set(selected.pollingUnit.id, selected.pollingUnit);
      setPollingUnitOptions([...merged.values()]);
      if (!merged.size) setError("No polling unit matched that code or name.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setOptionsLoading(false);
    }
  }

  function updateDraft(index: number, patch: Partial<EntryDraft>) {
    setDrafts(current => current.map((entry, i) => i === index ? { ...entry, ...patch } : entry));
  }

  function addDraft() {
    setDrafts(current => [...current, { candidate_id: null, label: "", votes: "", raw_label: "" }]);
  }

  function removeDraft(index: number) {
    setDrafts(current => current.filter((_, i) => i !== index));
  }

  async function saveReview(action: "save" | "approve" | "reject") {
    if (!supabase || !selected) return;

    const selectedPu = pollingUnitOptions.find(item => item.id === selected.polling_unit_id) ??
      pollingUnitOptions.find(item => item.id === (selected.pollingUnit?.id ?? ""));
    if (!selectedPu) {
      setError("Select the correct polling unit before saving or approving this result.");
      return;
    }

    setSaving(true);
    setError("");
    try {
      const entries = drafts.map(entry => ({
        ...(entry.id ? { id: entry.id } : {}),
        candidate_id: entry.candidate_id || null,
        label: entry.label.trim(),
        votes: entry.votes.trim() === "" ? null : Number(entry.votes),
        raw_label: entry.raw_label.trim() || entry.label.trim()
      }));

      if (entries.some(entry => !entry.label)) {
        throw new Error("Every candidate/result label must be filled in.");
      }
      if (entries.some(entry => entry.votes !== null && (!Number.isInteger(entry.votes) || entry.votes < 0))) {
        throw new Error("Votes must be whole numbers greater than or equal to zero.");
      }

      const result = await supabase.rpc("save_result_review", {
        p_result_sheet_id: selected.id,
        p_polling_unit_id: selectedPu.id,
        p_entries: entries,
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
          <p className="mt-1 max-w-2xl text-sm text-zinc-500">Inspect the official source, correct OCR fields when necessary, map the polling unit, then approve the corrected result.</p>
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
            <button key={row.id} type="button" onClick={() => { setSelected(row); setReviewNote(row.review_note ?? ""); }} className={"block w-full border-b border-zinc-800/60 p-5 text-left last:border-b-0 hover:bg-zinc-900/80 " + issueClass}>
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
          <div className="mx-auto my-6 max-w-7xl rounded-3xl border border-zinc-800 bg-zinc-950 shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-zinc-800 p-6">
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-zinc-600">Result correction workspace</p>
                <h2 className="mt-1 text-xl font-semibold text-zinc-100">{selected.election?.name ?? "Unknown election"}</h2>
                <p className="mt-1 text-xs text-zinc-500">{selected.state?.name ?? "State unavailable"} · {selected.lga?.name ?? "LGA unavailable"} · {selected.ward?.name ?? "Ward unavailable"}</p>
              </div>
              <button type="button" onClick={() => setSelected(null)} className="rounded-xl border border-zinc-800 px-3 py-2 text-xs text-zinc-400"><X size={16}/></button>
            </div>

            <div className="grid gap-5 p-6 xl:grid-cols-[1.05fr_1.45fr]">
              <div className="space-y-5">
                <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5">
                  <div className="flex items-center justify-between gap-3">
                    <div><h3 className="text-sm font-semibold text-zinc-200">Official source</h3><p className="mt-1 text-xs text-zinc-600">Use the source itself as the authority for corrections.</p></div>
                    <span className="rounded-full border border-zinc-800 bg-zinc-950 px-2 py-1 text-[10px] text-zinc-500">{selected.extraction ? Math.round((selected.extraction.confidence ?? 0) * 100) + "% OCR confidence" : "No extraction"}</span>
                  </div>
                  <dl className="mt-4 grid gap-3 text-xs">
                    <div><dt className="text-zinc-600">Source page</dt><dd className="mt-1 break-all text-zinc-300">{selected.source_url}</dd></div>
                    <div><dt className="text-zinc-600">Evidence asset</dt><dd className="mt-1 break-all text-zinc-300">{selected.evidence_url || "Not captured"}</dd></div>
                    <div><dt className="text-zinc-600">SHA-256</dt><dd className="mt-1 break-all text-zinc-300">{selected.source_hash || "Not recorded"}</dd></div>
                  </dl>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {selected.evidence_url && <a href={selected.evidence_url} target="_blank" rel="noreferrer" className="inline-flex rounded-xl bg-zinc-100 px-4 py-2 text-xs font-semibold text-zinc-950">Open evidence</a>}
                    <a href={selected.source_url} target="_blank" rel="noreferrer" className="inline-flex rounded-xl border border-zinc-800 px-4 py-2 text-xs font-medium text-zinc-300">Open source page</a>
                  </div>
                </div>

                <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5">
                  <h3 className="text-sm font-semibold text-zinc-200">Polling unit identity</h3>
                  <p className="mt-1 text-xs text-zinc-600">If OCR or discovery failed to map the polling unit, search the official/local geography and select the correct record.</p>
                  <div className="mt-4 flex gap-2">
                    <input value={pollingUnitSearch} onChange={e => setPollingUnitSearch(e.target.value)} onKeyDown={e => { if (e.key === "Enter") void findPollingUnits(); }} className={inputClass + " min-w-0 flex-1"} placeholder="PU code or polling unit name" />
                    <button type="button" onClick={() => void findPollingUnits()} disabled={optionsLoading} className="inline-flex items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs font-semibold text-zinc-200 disabled:opacity-50"><Search size={14}/> Find</button>
                  </div>
                  <div className="mt-3 space-y-2">
                    {pollingUnitOptions.map(pu => (
                      <button key={pu.id} type="button" onClick={() => { setSelected(current => current ? { ...current, polling_unit_id: pu.id, pollingUnit: pu } : current); setPollingUnitSearch(pu.pu_code || pu.name); }} className={"w-full rounded-xl border p-3 text-left " + (selected.polling_unit_id === pu.id ? "border-zinc-500 bg-zinc-800" : "border-zinc-800 bg-zinc-950 hover:bg-zinc-900")}>
                        <p className="text-xs font-medium text-zinc-200">{pu.name}</p>
                        <p className="mt-1 text-[11px] text-zinc-500">{pu.pu_code || "No PU code"} · {selected.polling_unit_id === pu.id ? "Selected" : "Select this polling unit"}</p>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5">
                  <h3 className="text-sm font-semibold text-zinc-200">Validation history</h3>
                  <div className="mt-3 space-y-2">
                    {selected.checks.length ? selected.checks.map(check => (
                      <div key={check.id} className="rounded-xl border border-zinc-800 bg-zinc-950 p-3">
                        <div className="flex items-center justify-between gap-3"><span className="text-xs text-zinc-300">{check.check_name.replaceAll("_", " ")}</span><span className={check.passed ? "text-emerald-400" : "text-red-400"}>{check.passed ? "Passed" : "Failed"}</span></div>
                        <p className="mt-1 text-[11px] text-zinc-600">{check.severity}</p>
                        {check.details && <pre className="mt-2 max-h-28 overflow-auto text-[10px] text-zinc-500">{JSON.stringify(check.details, null, 2)}</pre>}
                      </div>
                    )) : <p className="text-xs text-zinc-600">No validation checks were recorded.</p>}
                  </div>
                </div>
              </div>

              <div className="space-y-5">
                <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div><h3 className="text-sm font-semibold text-zinc-200">Correct extracted result</h3><p className="mt-1 text-xs text-zinc-600">Edit the OCR output to match the official source. Changes are written atomically and audited.</p></div>
                    <button type="button" onClick={addDraft} className="inline-flex items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs font-semibold text-zinc-300 hover:bg-zinc-900"><Plus size={14}/> Add row</button>
                  </div>

                  <div className="mt-4 space-y-3">
                    {drafts.length === 0 && <div className="rounded-xl border border-dashed border-zinc-800 p-6 text-center text-xs text-zinc-600">No candidate/result rows were extracted. Add the rows exactly as shown on the source.</div>}
                    {drafts.map((entry, index) => (
                      <div key={entry.id ?? "new-" + index} className="rounded-2xl border border-zinc-800 bg-zinc-950 p-4">
                        <div className="grid gap-3 md:grid-cols-[1.1fr_1fr_130px_auto]">
                          <input value={entry.label} onChange={e => updateDraft(index, { label: e.target.value })} className={inputClass} placeholder="Candidate / result label" />
                          <select value={entry.candidate_id ?? ""} onChange={e => updateDraft(index, { candidate_id: e.target.value || null })} className={inputClass}>
                            <option value="">No candidate mapping</option>
                            {candidateOptions.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.party?.abbreviation ? candidate.party.abbreviation + " · " : ""}{candidate.name}</option>)}
                          </select>
                          <input value={entry.votes} onChange={e => updateDraft(index, { votes: e.target.value.replace(/[^0-9]/g, "") })} className={inputClass} inputMode="numeric" placeholder="Votes" />
                          <button type="button" onClick={() => removeDraft(index)} className="grid place-items-center rounded-xl border border-red-500/20 bg-red-500/5 px-3 text-red-300 hover:bg-red-500/10" aria-label="Remove row"><Trash2 size={15}/></button>
                        </div>
                        <div className="mt-3">
                          <label className="text-[10px] uppercase tracking-wide text-zinc-600">OCR/raw label</label>
                          <input value={entry.raw_label} onChange={e => updateDraft(index, { raw_label: e.target.value })} className={inputClass + " mt-1 w-full"} placeholder="Original OCR label, e.g. L?" />
                        </div>
                      </div>
                    ))}
                  </div>

                  {selected.extraction && <details className="mt-4 rounded-xl border border-zinc-800 bg-zinc-950 p-3"><summary className="cursor-pointer text-xs text-zinc-500">View original OCR JSON</summary><pre className="mt-3 max-h-64 overflow-auto text-[10px] leading-5 text-zinc-600">{JSON.stringify(selected.extraction.raw_output, null, 2)}</pre></details>}
                </div>

                <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5">
                  <h3 className="text-sm font-semibold text-zinc-200">Reviewer decision</h3>
                  <textarea value={reviewNote} onChange={e => setReviewNote(e.target.value)} rows={4} className={inputClass + " mt-3 w-full resize-none"} placeholder="Explain any correction made, especially when OCR was wrong…" />
                  <div className="mt-4 grid gap-2 sm:grid-cols-3">
                    <button disabled={saving} type="button" onClick={() => void saveReview("save")} className="inline-flex items-center justify-center gap-2 rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-3 text-xs font-semibold text-zinc-200 disabled:opacity-50"><Save size={14}/> Save corrections</button>
                    <button disabled={saving} type="button" onClick={() => void saveReview("reject")} className="rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-3 text-xs font-semibold text-red-300 disabled:opacity-50">Reject / send back</button>
                    <button disabled={saving} type="button" onClick={() => void saveReview("approve")} className="inline-flex items-center justify-center gap-2 rounded-xl bg-zinc-100 px-3 py-3 text-xs font-semibold text-zinc-950 disabled:opacity-50"><CheckCircle2 size={14}/> {saving ? "Saving…" : "Approve corrected result"}</button>
                  </div>
                  <p className="mt-3 text-[10px] leading-5 text-zinc-600">Approve is only allowed after a real polling unit is selected and at least one result row is present. The corrected polling-unit identity and entries become the verified data used by result views and aggregates.</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
