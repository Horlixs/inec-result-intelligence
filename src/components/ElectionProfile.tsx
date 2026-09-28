import { ArrowUpRight, CalendarDays, CheckCircle2, ChevronDown, ChevronRight, ExternalLink, FileImage, MapPin, RefreshCw, Search, ShieldCheck, Users, XCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";

interface ElectionProfileProps {}
interface Election { id: string; name: string; election_type: string; election_date: string | null; source_url: string | null; status: string; }
interface Source { id: string; title: string; url: string; source_type: string; published_at: string | null; }
interface Stats { registered_voters: number | null; polling_units_expected: number | null; result_sheets_expected: number | null; result_sheets_uploaded: number | null; candidates_count: number | null; parties_count: number | null; }
interface State { id: string; name: string; code: string | null; }
interface Lga { id: string; state_id: string; name: string; }
interface Ward { id: string; lga_id: string; name: string; }
interface PollingUnit { id: string; ward_id: string; name: string; pu_code: string | null; }
type Tab = "overview" | "candidates" | "timeline" | "polling" | "results" | "sources";
type Category = "Federal" | "State" | "Local Government";
interface MetricCardProps { label: string; value: string; icon: typeof Users; }
interface EmptyStateProps { label: string; }

const IREV = "https://inecelectionresults.ng/";
const GUIDANCE = "https://inecnigeria.org/voters/education";

const yearOf = (value?: string | null): string => value ? new Date(value).getFullYear().toString() : "Year unavailable";
const fmt = (value?: string | null): string => value ? new Intl.DateTimeFormat("en-NG", { dateStyle: "medium" }).format(new Date(value)) : "Not published";
const num = (value?: number | null): string => value == null ? "—" : new Intl.NumberFormat("en-NG").format(value);
const pct = (expected?: number | null, uploaded?: number | null): number => expected && uploaded != null ? Math.min(100, Math.round(uploaded / expected * 1000) / 10) : 0;

function categoryOf(type: string): Category {
  if (["presidential", "senatorial", "house_of_representatives"].includes(type)) return "Federal";
  if (["governorship", "house_of_assembly", "state_constituency"].includes(type)) return "State";
  if (["chairmanship", "councillor"].includes(type)) return "Local Government";
  return "Federal";
}

function humanElectionType(type: string): string {
  const labels: Record<string, string> = {
    presidential: "President",
    senatorial: "Senate",
    house_of_representatives: "House of Representatives",
    governorship: "Governor",
    house_of_assembly: "State House of Assembly",
    state_constituency: "State House of Assembly",
    chairmanship: "Local Government Chairman",
    councillor: "Councillor",
    unknown: "Other election",
  };
  return labels[type] ?? type.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function MetricCard({ label, value, icon: Icon }: MetricCardProps) {
  return <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900/50 p-5 transition-all duration-200 hover:-translate-y-px hover:bg-zinc-900/80">
    <div className="flex items-start justify-between"><div className="grid size-9 place-items-center rounded-xl bg-zinc-800/70 text-zinc-400"><Icon size={16} /></div><CheckCircle2 className="text-zinc-700" size={15} /></div>
    <p className="mt-5 text-xs text-zinc-500">{label}</p><p className="mt-1 font-display text-2xl font-semibold tracking-tight text-zinc-100">{value}</p>
  </div>;
}

function EmptyState({ label }: EmptyStateProps) {
  return <div className="rounded-2xl border border-dashed border-zinc-800/60 bg-zinc-950/30 px-6 py-12 text-center"><FileImage className="mx-auto text-zinc-700" size={28} /><p className="mt-3 text-sm text-zinc-500">No synchronized {label} records yet.</p></div>;
}

interface SelectBoxProps { label: string; value: string; options: Array<{ value: string; label: string }>; placeholder: string; onChange: (value: string) => void; disabled?: boolean; }
function SelectBox({ label, value, options, placeholder, onChange, disabled = false }: SelectBoxProps) {
  return <label className="block min-w-0">
    <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-600">{label}</span>
    <span className="relative block">
      <select value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} className="w-full appearance-none rounded-xl border border-zinc-800/70 bg-zinc-950/70 px-3 py-2.5 pr-9 text-[12px] font-medium text-zinc-300 outline-none transition-colors focus:border-zinc-600 disabled:cursor-not-allowed disabled:opacity-40">
        <option value="">{placeholder}</option>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      <ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-zinc-600" />
    </span>
  </label>;
}

export function ElectionProfile(_props: ElectionProfileProps) {
  const [rows, setRows] = useState<Election[]>([]);
  const [states, setStates] = useState<State[]>([]);
  const [lgas, setLgas] = useState<Lga[]>([]);
  const [wards, setWards] = useState<Ward[]>([]);
  const [pollingUnits, setPollingUnits] = useState<PollingUnit[]>([]);
  const [year, setYear] = useState("");
  const [category, setCategory] = useState<Category | "">("");
  const [type, setType] = useState("");
  const [stateId, setStateId] = useState("");
  const [lgaId, setLgaId] = useState("");
  const [wardId, setWardId] = useState("");
  const [pollingUnitId, setPollingUnitId] = useState("");
  const [selected, setSelected] = useState("");
  const [sources, setSources] = useState<Source[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<Tab>("overview");
  const [loading, setLoading] = useState(true);
  const [geoLoading, setGeoLoading] = useState(false);
  const [error, setError] = useState("");
  const [geoElectionIds, setGeoElectionIds] = useState<string[] | null>(null);
  const [geoReady, setGeoReady] = useState(false);

  async function load(): Promise<void> {
    setLoading(true); setError("");
    if (!supabase) { setError("Supabase is not configured in this deployment."); setLoading(false); return; }
    const [electionsResponse, statesResponse] = await Promise.all([
      supabase.from("elections").select("id,name,election_type,election_date,source_url,status").order("election_date", { ascending: true }),
      supabase.from("states").select("id,name,code").order("name", { ascending: true }),
    ]);
    if (electionsResponse.error) { setError(electionsResponse.error.message); setLoading(false); return; }
    setRows((electionsResponse.data ?? []) as Election[]);
    setStates((statesResponse.data ?? []) as State[]);
    setLoading(false);
  }

  useEffect(() => { void load(); }, []);

  useEffect(() => {
    if (!supabase || !stateId || !type) { setLgas([]); return; }
    setGeoLoading(true);
    void supabase.from("lgas").select("id,state_id,name").eq("state_id", stateId).order("name", { ascending: true }).then((response) => {
      setLgas((response.data ?? []) as Lga[]); setGeoLoading(false);
    });
  }, [stateId]);

  useEffect(() => {
    if (!supabase || !lgaId || !type) { setWards([]); return; }
    setGeoLoading(true);
    void supabase.from("wards").select("id,lga_id,name").eq("lga_id", lgaId).order("name", { ascending: true }).then((response) => {
      setWards((response.data ?? []) as Ward[]); setGeoLoading(false);
    });
  }, [lgaId]);

  useEffect(() => {
    if (!supabase || !wardId || !type) { setPollingUnits([]); return; }
    setGeoLoading(true);
    void supabase.from("polling_units").select("id,ward_id,name,pu_code").eq("ward_id", wardId).order("name", { ascending: true }).then((response) => {
      setPollingUnits((response.data ?? []) as PollingUnit[]); setGeoLoading(false);
    });
  }, [wardId]);

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

  const scopedRows = useMemo(() => rows.filter((row) => {
    const matchesYear = !year || yearOf(row.election_date) === year;
    const matchesCategory = !category || categoryOf(row.election_type) === category;
    return matchesYear && matchesCategory;
  }), [rows, year, category]);
  const years = useMemo(() => [...new Set(rows.map((row) => yearOf(row.election_date)).filter((value) => value !== "Year unavailable"))].sort((a, b) => Number(b) - Number(a)), [rows]);
  const categoryOrder: Category[] = ["Federal", "State", "Local Government"];
  const categoryOptions = useMemo(() => [...new Set(rows.filter((row) => !year || yearOf(row.election_date) === year).map((row) => categoryOf(row.election_type)))].sort((a, b) => categoryOrder.indexOf(a) - categoryOrder.indexOf(b)).map((value) => ({ value, label: value })), [rows, year]);
  const typeOrder = ["presidential", "senatorial", "house_of_representatives", "governorship", "house_of_assembly", "state_constituency", "chairmanship", "councillor"];
  const typeOptions = useMemo(() => [...new Set(scopedRows.map((row) => row.election_type))].sort((a, b) => typeOrder.indexOf(a) - typeOrder.indexOf(b)).map((value) => ({ value, label: humanElectionType(value) })), [scopedRows]);
  const filtered = useMemo(() => rows.filter((row) => {
    const matchesYear = !year || yearOf(row.election_date) === year;
    const matchesCategory = !category || categoryOf(row.election_type) === category;
    const matchesType = !type || row.election_type === type;
    const matchesGeo = !stateId || (!geoReady ? true : geoElectionIds?.includes(row.id) === true);
    const query = q.trim().toLowerCase();
    const matchesSearch = !query || row.name.toLowerCase().includes(query) || humanElectionType(row.election_type).toLowerCase().includes(query);
    return matchesYear && matchesCategory && matchesType && matchesGeo && matchesSearch;
  }), [rows, year, category, type, stateId, geoElectionIds, q]);

  useEffect(() => {
    if (!supabase || !year || !type || !stateId) {
      setGeoElectionIds(null);
      setGeoReady(false);
      return;
    }
    const electionIds = rows.filter((row) => yearOf(row.election_date) === year && categoryOf(row.election_type) === category && row.election_type === type).map((row) => row.id);
    if (!electionIds.length) { setGeoElectionIds([]); return; }
    setGeoLoading(true);
    setGeoReady(false);
    setError("");
    void supabase.rpc("election_ids_for_geography", {
      election_ids: electionIds,
      p_state_id: stateId,
      p_lga_id: lgaId || null,
      p_ward_id: wardId || null,
      p_polling_unit_id: pollingUnitId || null,
    }).then((response) => {
      if (response.error) {
        setGeoElectionIds([]);
        setError("The selected geographic scope could not be matched to the available result records.");
      } else {
        setGeoElectionIds([...new Set((response.data ?? []).map((row) => String(row)))]);
      }
      setGeoReady(true);
      setGeoLoading(false);
    });
  }, [year, category, type, stateId, lgaId, wardId, pollingUnitId, rows]);

  const election = rows.find((row) => row.id === selected);
  const selectedState = states.find((item) => item.id === stateId);
  const selectedLga = lgas.find((item) => item.id === lgaId);
  const selectedWard = wards.find((item) => item.id === wardId);
  const selectedPu = pollingUnits.find((item) => item.id === pollingUnitId);

  function resetFrom(level: "year" | "category" | "type" | "state" | "lga" | "ward"): void {
    if (level === "year") { setYear(""); setCategory(""); setType(""); setStateId(""); setLgaId(""); setWardId(""); setPollingUnitId(""); setGeoElectionIds(null); }
    if (level === "category") { setCategory(""); setType(""); setStateId(""); setLgaId(""); setWardId(""); setPollingUnitId(""); setGeoElectionIds(null); }
    if (level === "type") { setType(""); setStateId(""); setLgaId(""); setWardId(""); setPollingUnitId(""); setGeoElectionIds(null); }
    if (level === "state") { setStateId(""); setLgaId(""); setWardId(""); setPollingUnitId(""); setGeoElectionIds(null); }
    if (level === "lga") { setLgaId(""); setWardId(""); setPollingUnitId(""); setGeoElectionIds(null); }
    if (level === "ward") { setWardId(""); setPollingUnitId(""); setGeoElectionIds(null); }
    setSelected("");
  }

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: "overview", label: "Overview" }, { id: "candidates", label: "Candidates" }, { id: "timeline", label: "Timeline" },
    { id: "polling", label: "Polling" }, { id: "results", label: "Results" }, { id: "sources", label: "Sources" },
  ];

  return <section>
    <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900/35 p-4 sm:p-5">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-600">Election explorer</p>
          <h2 className="mt-1 font-display text-lg font-semibold tracking-tight text-zinc-100">Explore elections by year, office and place</h2>
          <p className="mt-1 text-xs leading-5 text-zinc-600">Start with a year, then choose the election category and type. From there, narrow the results from state to local government area, ward and polling unit.</p>
        </div>
        <div className="flex w-full gap-2 xl:w-auto">
          <label className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-zinc-800/60 bg-zinc-950/55 px-3 py-2.5 text-zinc-500 focus-within:border-zinc-700 xl:w-64">
            <Search size={14} /><input value={q} onChange={(event) => setQ(event.target.value)} placeholder="Search within selection" className="min-w-0 flex-1 bg-transparent text-[12px] text-zinc-200 outline-none placeholder:text-zinc-700" />
          </label>
          <button onClick={() => void load()} aria-label="Refresh elections and geography" className="rounded-xl border border-zinc-800/60 bg-zinc-950/40 p-2.5 text-zinc-500 transition-all duration-200 hover:bg-zinc-900 hover:text-zinc-200"><RefreshCw size={15} /></button>
        </div>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-3">
        <SelectBox label="1 · Year" value={year} placeholder="Select a year" options={years.map((value) => ({ value, label: value }))} onChange={(value) => { setYear(value); setCategory(""); setType(""); setStateId(""); setLgaId(""); setWardId(""); setPollingUnitId(""); setGeoElectionIds(null); setSelected(""); }} />
        <SelectBox label="2 · Category" value={category} placeholder="Select a category" options={categoryOptions} onChange={(value) => { setCategory(value as Category | ""); setType(""); setStateId(""); setLgaId(""); setWardId(""); setPollingUnitId(""); setGeoElectionIds(null); setSelected(""); }} disabled={!year} />
        <SelectBox label="3 · Type of election" value={type} placeholder="Select an election type" options={typeOptions} onChange={(value) => { setType(value); setStateId(""); setLgaId(""); setWardId(""); setPollingUnitId(""); setGeoElectionIds(null); setSelected(""); }} disabled={!category} />
      </div>

      <div className="mt-5 border-t border-zinc-800/60 pt-5">
        <div className="mb-3 flex items-center justify-between">
          <div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-600">Geographic scope</p><p className="mt-1 text-xs text-zinc-600">{type ? "Optional. Narrow the selected election from state to polling unit." : "Choose a year, category and election type first."}</p></div>
          {geoLoading && <RefreshCw size={14} className="animate-spin text-zinc-600" />}
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <SelectBox label="4 · State" value={stateId} placeholder="All states" options={[{ value: "", label: "All states" }, ...states.map((item) => ({ value: item.id, label: item.name }))]} onChange={(value) => { setStateId(value); setLgaId(""); setWardId(""); setPollingUnitId(""); setSelected(""); setGeoElectionIds(null); }} disabled={!type} />
          <SelectBox label="5 · Local Government Area" value={lgaId} placeholder="All local government areas" options={[{ value: "", label: "All local government areas" }, ...lgas.map((item) => ({ value: item.id, label: item.name }))]} onChange={(value) => { setLgaId(value); setWardId(""); setPollingUnitId(""); setGeoElectionIds(null); setGeoReady(false); setSelected(""); }} disabled={!stateId} />
          <SelectBox label="6 · Ward" value={wardId} placeholder="All wards" options={[{ value: "", label: "All wards" }, ...wards.map((item) => ({ value: item.id, label: item.name }))]} onChange={(value) => { setWardId(value); setPollingUnitId(""); setGeoElectionIds(null); setGeoReady(false); setSelected(""); }} disabled={!lgaId} />
          <SelectBox label="7 · Polling Unit" value={pollingUnitId} placeholder="All polling units" options={[{ value: "", label: "All polling units" }, ...pollingUnits.map((item) => ({ value: item.id, label: item.pu_code ? item.name + " · " + item.pu_code : item.name }))]} onChange={(value) => { setPollingUnitId(value); setSelected(""); }} disabled={!wardId} />
        </div>
        {(selectedState || selectedLga || selectedWard || selectedPu) && <div className="mt-4 flex flex-wrap items-center gap-1.5 text-[11px]">
          <button onClick={() => resetFrom("state")} className="text-zinc-500 hover:text-zinc-200">Nigeria</button>
          {selectedState && <><ChevronRight size={12} className="text-zinc-700" /><button onClick={() => resetFrom("lga")} className="text-zinc-300 hover:text-zinc-100">{selectedState.name}</button></>}
          {selectedLga && <><ChevronRight size={12} className="text-zinc-700" /><button onClick={() => resetFrom("ward")} className="text-zinc-300 hover:text-zinc-100">{selectedLga.name}</button></>}
          {selectedWard && <><ChevronRight size={12} className="text-zinc-700" /><span className="text-zinc-300">{selectedWard.name}</span></>}
          {selectedPu && <><ChevronRight size={12} className="text-zinc-700" /><span className="text-zinc-500">{selectedPu.name}</span></>}
        </div>}
      </div>

      <div className="mt-5 border-t border-zinc-800/60 pt-5">
        <div className="flex items-center justify-between gap-4">
          <div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-600">Available elections</p><p className="mt-1 text-xs text-zinc-600">{filtered.length} matching record{filtered.length === 1 ? "" : "s"}</p></div>
          {(year || category || type || stateId || lgaId || wardId || pollingUnitId) && <button onClick={() => { setYear(""); setCategory(""); setType(""); setStateId(""); setLgaId(""); setWardId(""); setPollingUnitId(""); setGeoElectionIds(null); setSelected(""); }} className="text-xs font-medium text-zinc-500 hover:text-zinc-200">Clear all</button>}
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {loading ? [1,2,3].map((item) => <div key={item} className="h-14 animate-pulse rounded-xl bg-zinc-800/40" />) : filtered.length ? filtered.map((row) => {
            const selectedRow = row.id === selected;
            return <button key={row.id} onClick={() => { setSelected(row.id); setTab("overview"); }} className={`group flex min-w-0 items-center justify-between gap-3 rounded-xl border px-3.5 py-3 text-left transition-all duration-200 ${selectedRow ? "border-zinc-600 bg-zinc-100 text-zinc-950" : "border-zinc-800/60 bg-zinc-950/35 text-zinc-300 hover:border-zinc-700 hover:bg-zinc-900"}`}>
              <span className="min-w-0"><span className={`block truncate font-display text-sm font-semibold ${selectedRow ? "text-zinc-950" : "text-zinc-200"}`}>{yearOf(row.election_date)} · {humanElectionType(row.election_type)}</span><span className={`mt-0.5 block truncate text-[11px] ${selectedRow ? "text-zinc-600" : "text-zinc-600"}`}>{row.name}</span></span>
              <ArrowUpRight size={14} className={selectedRow ? "text-zinc-500" : "shrink-0 text-zinc-700 group-hover:text-zinc-300"} />
            </button>;
          }) : <div className="col-span-full rounded-xl border border-dashed border-zinc-800/60 px-5 py-8 text-center text-xs text-zinc-600">No elections match this path. Try stepping back one level or clear a filter.</div>}
        </div>
      </div>
    </div>

    <div className="mt-5 min-w-0">
      {error && <div className="mb-5 flex items-start gap-3 rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4 text-sm text-amber-200"><XCircle size={18} className="mt-0.5 shrink-0" /><div><p className="font-medium">Data connection notice</p><p className="mt-1 text-xs text-amber-200/60">{error}</p></div></div>}
      {election ? <>
        <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900/35 p-5 sm:p-6">
          <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-start">
            <div className="min-w-0">
              <div className="mb-3 flex flex-wrap items-center gap-2"><span className="rounded-full border border-emerald-500/20 bg-emerald-500/5 px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-emerald-300">{election.status || "scheduled"}</span><span className="rounded-full border border-zinc-800/60 px-2.5 py-1 text-[10px] text-zinc-500">{humanElectionType(election.election_type)}</span></div>
              <h2 className="max-w-3xl font-display text-[1.65rem] font-semibold leading-tight tracking-[-0.025em] text-zinc-50 sm:text-2xl">{election.name}</h2>
              <div className="mt-3 flex flex-wrap gap-4 text-xs text-zinc-500"><span className="inline-flex items-center gap-1.5"><CalendarDays size={14} />{fmt(election.election_date)}</span><span className="inline-flex items-center gap-1.5"><MapPin size={14} />Nigeria</span></div>
            </div>
            <a href={election.source_url ?? IREV} target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-zinc-800/60 bg-zinc-950/50 px-3.5 py-2.5 text-xs font-medium text-zinc-300 transition-all duration-200 hover:-translate-y-px hover:bg-zinc-800">Open source <ExternalLink size={14} /></a>
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
      </> : <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900/30 p-12 text-center"><FileImage className="mx-auto text-zinc-700" size={32} /><h3 className="mt-4 font-display text-lg font-semibold">No election selected</h3><p className="mt-2 text-sm text-zinc-600">Choose a year, category and election type above, then narrow by geography if needed.</p></div>}
    </div>
  </section>;
}
