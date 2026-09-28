import { ArrowUpRight, CalendarDays, CheckCircle2, ExternalLink, FileImage, MapPin, RefreshCw, Search, ShieldCheck, Users, XCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";

interface ElectionProfileProps {}
interface Election { id: string; name: string; election_type: string; election_date: string | null; source_url: string | null; status: string; }
interface Source { id: string; title: string; url: string; source_type: string; published_at: string | null; }
interface Stats { registered_voters: number | null; polling_units_expected: number | null; result_sheets_expected: number | null; result_sheets_uploaded: number | null; candidates_count: number | null; parties_count: number | null; }
type Tab = "overview" | "candidates" | "timeline" | "polling" | "results" | "sources";
interface MetricCardProps { label: string; value: string; icon: typeof Users; }
interface EmptyStateProps { label: string; }

const IREV = "https://inecelectionresults.ng/";
const GUIDANCE = "https://inecnigeria.org/voters/education";
const yearOf = (value?: string | null): string => value ? new Date(value).getFullYear().toString() : "Year unavailable";
const fmt = (value?: string | null): string => value ? new Intl.DateTimeFormat("en-NG", { dateStyle: "medium" }).format(new Date(value)) : "Not published";
const num = (value?: number | null): string => value == null ? "—" : new Intl.NumberFormat("en-NG").format(value);
const pct = (expected?: number | null, uploaded?: number | null): number => expected && uploaded != null ? Math.min(100, Math.round(uploaded / expected * 1000) / 10) : 0;

function MetricCard({ label, value, icon: Icon }: MetricCardProps) {
  return <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900/50 p-5 transition-all duration-200 ease-in-out hover:translate-y-[-1px] hover:bg-zinc-900/80">
    <div className="flex items-start justify-between"><div className="grid size-9 place-items-center rounded-xl bg-zinc-800/70 text-zinc-400"><Icon size={16} /></div><CheckCircle2 className="text-zinc-700" size={15} /></div>
    <p className="mt-5 text-xs text-zinc-500">{label}</p><p className="mt-1 font-display text-2xl font-semibold tracking-tight text-zinc-100">{value}</p>
  </div>;
}
function EmptyState({ label }: EmptyStateProps) {
  return <div className="rounded-2xl border border-dashed border-zinc-800/60 bg-zinc-950/30 px-6 py-12 text-center"><FileImage className="mx-auto text-zinc-700" size={28} /><p className="mt-3 text-sm text-zinc-500">No synchronized {label} records yet.</p></div>;
}

export function ElectionProfile(_props: ElectionProfileProps) {
  const [rows, setRows] = useState<Election[]>([]);
  const [selected, setSelected] = useState("");
  const [sources, setSources] = useState<Source[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<Tab>("overview");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load(): Promise<void> {
    setLoading(true); setError("");
    if (!supabase) { setError("Supabase is not configured in this deployment."); setLoading(false); return; }
    const response = await supabase.from("elections").select("id,name,election_type,election_date,source_url,status").order("election_date", { ascending: true });
    if (response.error) { setError(response.error.message); setLoading(false); return; }
    const data = (response.data ?? []) as Election[];
    setRows(data); setSelected((current) => current || data[0]?.id || ""); setLoading(false);
  }

  useEffect(() => { void load(); }, []);
  useEffect(() => {
    if (!supabase || !selected) return;
    void Promise.all([
      supabase.from("election_sources").select("id,title,url,source_type,published_at").eq("election_id", selected).order("published_at", { ascending: false }),
      supabase.from("election_statistics").select("registered_voters,polling_units_expected,result_sheets_expected,result_sheets_uploaded,candidates_count,parties_count").eq("election_id", selected).limit(1).maybeSingle(),
    ]).then(([sourceResponse, statsResponse]) => {
      setSources((sourceResponse.data ?? []) as Source[]);
      setStats((statsResponse.data ?? null) as Stats | null);
      if (sourceResponse.error || statsResponse.error) setError("Some profile data could not be loaded.");
    });
  }, [selected]);

  const filtered = useMemo(() => rows.filter((row) => `${yearOf(row.election_date)} ${row.election_type} ${row.name}`.toLowerCase().includes(q.toLowerCase())), [rows, q]);
  const election = rows.find((row) => row.id === selected);
  const tabs: Array<{ id: Tab; label: string }> = [
    { id: "overview", label: "Overview" }, { id: "candidates", label: "Candidates" }, { id: "timeline", label: "Timeline" },
    { id: "polling", label: "Polling" }, { id: "results", label: "Results" }, { id: "sources", label: "Sources" },
  ];

  return <section>
    <div>
      <div className="mb-5 rounded-2xl border border-zinc-800/60 bg-zinc-900/35 p-4 sm:p-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-zinc-800/70 text-zinc-400"><CalendarDays size={16} /></div>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-600">Election index</p>
              <p className="mt-1 text-[13px] font-medium text-zinc-300">Choose a year and category to inspect its evidence.</p>
            </div>
          </div>
          <div className="flex w-full gap-2 xl:w-auto">
            <label className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-zinc-800/60 bg-zinc-950/55 px-3 py-2.5 text-zinc-500 focus-within:border-zinc-700 xl:w-64">
              <Search size={14} /><input value={q} onChange={(event) => setQ(event.target.value)} placeholder="Search elections" className="min-w-0 flex-1 bg-transparent text-[12px] text-zinc-200 outline-none placeholder:text-zinc-700" />
            </label>
            <button onClick={() => void load()} aria-label="Refresh elections" className="rounded-xl border border-zinc-800/60 bg-zinc-950/40 p-2.5 text-zinc-500 transition-all duration-200 hover:bg-zinc-900 hover:text-zinc-200"><RefreshCw size={15} /></button>
          </div>
        </div>
        <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
          {loading ? [1,2,3].map((item) => <div key={item} className="h-10 min-w-32 animate-pulse rounded-xl bg-zinc-800/40" />) : filtered.length ? filtered.map((row) => {
            const selectedRow = row.id === selected;
            return <button key={row.id} onClick={() => { setSelected(row.id); setTab("overview"); }} className={`group inline-flex shrink-0 items-center gap-2.5 rounded-xl border px-3 py-2 text-left transition-all duration-200 ease-in-out hover:translate-y-[-1px] ${selectedRow ? "border-zinc-700/80 bg-zinc-100 text-zinc-950" : "border-zinc-800/60 bg-zinc-950/35 text-zinc-400 hover:border-zinc-700 hover:bg-zinc-900 hover:text-zinc-200"}`}>
              <span className="font-display text-sm font-semibold tracking-tight">{yearOf(row.election_date)}</span>
              <span className={`max-w-36 truncate text-[11px] font-medium ${selectedRow ? "text-zinc-600" : "text-zinc-600 group-hover:text-zinc-400"}`}>{row.election_type}</span>
              <ArrowUpRight size={13} className={selectedRow ? "text-zinc-500" : "text-zinc-700 group-hover:text-zinc-400"} />
            </button>;
          }) : <p className="px-1 py-3 text-xs text-zinc-600">No matching elections.</p>}
        </div>
      </div>

      <div className="min-w-0">
        {error && <div className="mb-5 flex items-start gap-3 rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4 text-sm text-amber-200"><XCircle size={18} className="mt-0.5 shrink-0" /><div><p className="font-medium">Data connection notice</p><p className="mt-1 text-xs text-amber-200/60">{error}</p></div></div>}
        {election ? <>
          <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900/35 p-5 sm:p-6">
            <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-start">
              <div>
                <div className="mb-3 flex flex-wrap items-center gap-2"><span className="rounded-full border border-emerald-500/20 bg-emerald-500/5 px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-emerald-300">{election.status || "scheduled"}</span><span className="rounded-full border border-zinc-800/60 px-2.5 py-1 text-[10px] text-zinc-500">{election.election_type}</span></div>
                <h2 className="max-w-3xl font-display text-[1.65rem] font-semibold leading-tight tracking-[-0.025em] text-zinc-50 sm:text-2xl">{election.name}</h2>
                <div className="mt-3 flex flex-wrap gap-4 text-xs text-zinc-500"><span className="inline-flex items-center gap-1.5"><CalendarDays size={14} />{fmt(election.election_date)}</span><span className="inline-flex items-center gap-1.5"><MapPin size={14} />Nigeria</span></div>
              </div>
              <a href={election.source_url ?? IREV} target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-zinc-800/60 bg-zinc-950/50 px-3.5 py-2.5 text-xs font-medium text-zinc-300 transition-all duration-200 hover:translate-y-[-1px] hover:bg-zinc-800">Open source <ExternalLink size={14} /></a>
            </div>
            <div className="mt-6 flex gap-1 overflow-x-auto border-b border-zinc-800/60">{tabs.map(({ id, label }) => <button key={id} onClick={() => setTab(id)} className={`whitespace-nowrap border-b-2 px-3 py-3 text-xs font-medium transition-all duration-200 ${tab === id ? "border-zinc-200 text-zinc-100" : "border-transparent text-zinc-600 hover:text-zinc-300"}`}>{label}</button>)}</div>
          </div>

          {tab === "overview" && <div className="mt-5 grid gap-5 xl:grid-cols-[1.15fr_1fr]">
            <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900/40 p-6">
              <div className="flex items-center gap-2 text-xs font-semibold text-zinc-300"><ShieldCheck size={15} /> Evidence chain</div>
              <h3 className="mt-4 font-display text-xl font-semibold tracking-tight">Numbers stay connected to their source.</h3>
              <p className="mt-3 max-w-xl text-sm leading-6 text-zinc-500">Original result documents form the evidence layer. Extracted values, validations and analytics remain derived records.</p>
              <a href={IREV} target="_blank" rel="noreferrer" className="mt-6 inline-flex items-center gap-2 text-xs font-medium text-zinc-300 transition-colors hover:text-white">IReV source <ExternalLink size={13} /></a>
            </div>
            <div className="grid grid-cols-2 gap-3">{[
              { label: "Registered voters", value: num(stats?.registered_voters), icon: Users },
              { label: "Polling units", value: num(stats?.polling_units_expected), icon: MapPin },
              { label: "Candidates", value: num(stats?.candidates_count), icon: ShieldCheck },
              { label: "Parties", value: num(stats?.parties_count), icon: Users },
            ].map((metric) => <MetricCard key={metric.label} {...metric} />)}</div>
          </div>}

          {tab === "polling" && <div className="mt-5 rounded-2xl border border-zinc-800/60 bg-zinc-900/40 p-6"><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-600">Polling operations</p><h3 className="mt-3 font-display text-xl font-semibold">Official operating guidance</h3><p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-500">Current INEC guidance covers polling-unit opening, accreditation, voting and BVAS verification.</p><div className="mt-5 grid gap-3 sm:grid-cols-2"><div className="rounded-xl border border-zinc-800/60 bg-zinc-950/40 p-4"><p className="text-xs text-zinc-600">General window</p><p className="mt-1 text-sm font-medium text-zinc-200">08:30–14:30</p></div><div className="rounded-xl border border-zinc-800/60 bg-zinc-950/40 p-4"><p className="text-xs text-zinc-600">Verification</p><p className="mt-1 text-sm font-medium text-zinc-200">PVC + BVAS</p></div></div><a href={GUIDANCE} target="_blank" rel="noreferrer" className="mt-5 inline-flex items-center gap-2 text-xs font-medium text-zinc-300 hover:text-white">View INEC guidance <ExternalLink size={13} /></a></div>}

          {tab === "results" && <div className="mt-5 rounded-2xl border border-zinc-800/60 bg-zinc-900/40 p-6"><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-600">Result evidence</p><div className="mt-3 flex items-end justify-between gap-4"><div><h3 className="font-display text-xl font-semibold">IReV result-sheet coverage</h3><p className="mt-1 text-xs text-zinc-600">Remote evidence discovered by the collector.</p></div><p className="font-display text-4xl font-semibold">{pct(stats?.result_sheets_expected, stats?.result_sheets_uploaded)}%</p></div><div className="mt-6 h-2 overflow-hidden rounded-full bg-zinc-800"><div className="h-full rounded-full bg-zinc-200 transition-all duration-500" style={{ width: `${pct(stats?.result_sheets_expected, stats?.result_sheets_uploaded)}%` }} /></div><p className="mt-3 text-xs text-zinc-600">{num(stats?.result_sheets_uploaded)} of {num(stats?.result_sheets_expected)} sheets recorded.</p></div>}

          {(tab === "sources" || tab === "candidates" || tab === "timeline") && (tab === "sources" ? sources.length ? <div className="mt-5 overflow-hidden rounded-2xl border border-zinc-800/60 bg-zinc-900/40">{sources.map((source) => <a key={source.id} href={source.url} target="_blank" rel="noreferrer" className="flex items-center justify-between gap-4 border-b border-zinc-800/60 p-4 transition-all duration-200 hover:bg-zinc-800/30 last:border-0"><div><p className="text-sm font-medium text-zinc-200">{source.title}</p><p className="mt-1 text-xs text-zinc-600">{source.source_type} · {fmt(source.published_at)}</p></div><ExternalLink size={15} className="shrink-0 text-zinc-600" /></a>)}</div> : <div className="mt-5"><EmptyState label="source" /></div> : <div className="mt-5"><EmptyState label={tab} /></div>)}
        </> : <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900/30 p-12 text-center"><FileImage className="mx-auto text-zinc-700" size={32} /><h3 className="mt-4 font-display text-lg font-semibold">No election selected</h3><p className="mt-2 text-sm text-zinc-600">Run the source pipeline to populate the intelligence workspace.</p></div>}
      </div>
    </div>
  </section>;
}
