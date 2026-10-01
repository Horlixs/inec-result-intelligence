import { BarChart3, ChevronRight, MapPin, RefreshCw, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";

type Level = "election" | "state" | "lga" | "ward" | "polling";
type ScopeProps = {
  electionId: string;
  stateId: string;
  lgaId: string;
  wardId: string;
  pollingUnitId: string;
  stateName?: string;
  lgaName?: string;
  wardName?: string;
  pollingUnitName?: string;
  pollingUnitCode?: string | null;
  onState: (id: string) => void;
  onLga: (id: string) => void;
  onWard: (id: string) => void;
  onPollingUnit: (id: string) => void;
  onClear: () => void;
};

interface TotalRow {
  label: string;
  candidate_id?: string | null;
  candidate_name?: string | null;
  party_id?: string | null;
  party_abbreviation?: string | null;
  party_name?: string | null;
  total_votes: number | null;
  polling_units_with_entry: number | null;
  verified_result_sheets: number | null;
}
interface Candidate {
  id: string;
  name: string;
  party_id: string | null;
  ballot_order: number | null;
}
interface Party {
  id: string;
  abbreviation: string;
  name: string | null;
}
interface Child {
  id: string;
  name: string;
  code?: string | null;
}
interface Enriched {
  label: string;
  candidate_name: string | null;
  party_abbreviation: string | null;
  party_name: string | null;
}

const n = (v: number | null | undefined) => v == null ? "—" : new Intl.NumberFormat("en-NG").format(v);

export function ResultsExplorer({
  electionId, stateId, lgaId, wardId, pollingUnitId,
  stateName, lgaName, wardName, pollingUnitName, pollingUnitCode,
  onState, onLga, onWard, onPollingUnit, onClear,
}: ScopeProps) {
  const [rows, setRows] = useState<TotalRow[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [parties, setParties] = useState<Party[]>([]);
  const [identity, setIdentity] = useState<Enriched[]>([]);
  const [children, setChildren] = useState<Child[]>([]);
  const [level, setLevel] = useState<Level>("election");
  const [loading, setLoading] = useState(false);
  const [childrenLoading, setChildrenLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!supabase || !electionId) return;
    setLevel(pollingUnitId ? "polling" : wardId ? "ward" : lgaId ? "lga" : stateId ? "state" : "election");
  }, [electionId, stateId, lgaId, wardId, pollingUnitId]);

  useEffect(() => {
    if (!supabase || !electionId) return;
    let cancelled = false;
    setLoading(true);
    setError("");

    async function load(): Promise<void> {
      try {
        const candidatePromise = supabase!.from("candidates").select("id,name,party_id,ballot_order").eq("election_id", electionId).order("ballot_order", { ascending: true, nullsFirst: false }).order("name");
        const recordPromise = supabase!.from("candidate_records").select("candidate_id,full_name,party_id,ballot_order").eq("election_id", electionId).eq("status", "published").is("valid_to", null).order("ballot_order", { ascending: true, nullsFirst: false });
        const partyPromise = supabase!.from("parties").select("id,abbreviation,name").order("abbreviation");
        const identityPromise = Promise.resolve({ data: [], error: null });

        const [candidateRes, recordRes, partyRes, identityRes] = await Promise.all([candidatePromise, recordPromise, partyPromise, identityPromise]);
        if (candidateRes.error) throw candidateRes.error;
        if (recordRes.error && !/does not exist|relation/i.test(recordRes.error.message)) throw recordRes.error;
        if (partyRes.error) throw partyRes.error;
        // Candidate/party enrichment is optional during rollout; the verified result layer remains usable if the view has not migrated yet.
        if (cancelled) return;

        const base = (candidateRes.data ?? []) as Candidate[];
        const records = (recordRes.data ?? []) as Array<{candidate_id:string|null;full_name:string;party_id:string|null;ballot_order:number|null}>;
        const byId = new Map<string, Candidate>(base.map((c) => [c.id, c]));
        for (const r of records) {
          if (r.candidate_id) byId.set(r.candidate_id, { id:r.candidate_id, name:r.full_name, party_id:r.party_id, ballot_order:r.ballot_order });
        }
        setCandidates([...byId.values()].sort((a,b) => (a.ballot_order ?? 9999) - (b.ballot_order ?? 9999) || a.name.localeCompare(b.name)));
        setParties((partyRes.data ?? []) as Party[]);
        setIdentity((identityRes.data ?? []) as Enriched[]);

        if (pollingUnitId) {
          const result = await supabase!.from("polling_unit_candidate_results").select("label,candidate_id,candidate_name,party_id,party_abbreviation,party_name,votes,polling_units_with_entry,verified_result_sheets").eq("election_id", electionId).eq("polling_unit_id", pollingUnitId).order("votes", { ascending:false, nullsFirst:false }).order("label");
          if (result.error) throw result.error;
          setRows((result.data ?? []).map((r:any) => ({label:r.label,total_votes:r.votes,polling_units_with_entry:1,verified_result_sheets:1})));
        } else if (stateId) {
          let q = supabase!.from("geographic_candidate_totals").select("label,candidate_id,candidate_name,party_id,party_abbreviation,party_name,total_votes,polling_units_with_entry,verified_result_sheets").eq("election_id", electionId).eq("state_id", stateId);
          if (lgaId) q = q.eq("lga_id", lgaId);
          if (wardId) q = q.eq("ward_id", wardId);
          const result = await q.order("total_votes", {ascending:false, nullsFirst:false}).order("label");
          if (result.error) throw result.error;
          setRows((result.data ?? []) as TotalRow[]);
        } else {
          const result = await supabase!.from("election_candidate_totals").select("label,candidate_id,candidate_name,party_id,party_abbreviation,party_name,total_votes,polling_units_with_entry,verified_result_sheets").eq("election_id", electionId).order("total_votes", {ascending:false, nullsFirst:false}).order("label");
          if (result.error) throw result.error;
          setRows((result.data ?? []) as TotalRow[]);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Results could not be loaded.");
          setRows([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [electionId, stateId, lgaId, wardId, pollingUnitId]);

  useEffect(() => {
    if (!supabase || !electionId) return;
    let cancelled = false;
    setChildrenLoading(true);
    async function loadChildren(): Promise<void> {
      try {
        if (!stateId) {
          const result = await supabase!.from("states").select("id,name").order("name");
          if (!cancelled) setChildren((result.data ?? []) as Child[]);
        } else if (!lgaId) {
          const result = await supabase!.from("lgas").select("id,name,code").eq("state_id", stateId).order("name");
          if (!cancelled) setChildren((result.data ?? []) as Child[]);
        } else if (!wardId) {
          const result = await supabase!.from("wards").select("id,name,code").eq("lga_id", lgaId).order("name");
          if (!cancelled) setChildren((result.data ?? []) as Child[]);
        } else if (!pollingUnitId) {
          const result = await supabase!.from("polling_units").select("id,name,pu_code").eq("ward_id", wardId).order("name");
          if (!cancelled) setChildren((result.data ?? []).map((x:any) => ({id:x.id,name:x.name,code:x.pu_code})) as Child[]);
        } else {
          if (!cancelled) setChildren([]);
        }
      } finally {
        if (!cancelled) setChildrenLoading(false);
      }
    }
    void loadChildren();
    return () => { cancelled = true; };
  }, [electionId, stateId, lgaId, wardId, pollingUnitId]);

  const identityMap = useMemo(() => {
    const map = new Map<string, Enriched>();
    for (const x of identity) {
      if (!map.has(x.label)) map.set(x.label, x);
    }
    return map;
  }, [identity]);

  const partyMap = useMemo(() => new Map(parties.map((p) => [p.id, p])), [parties]);
  const candidateByName = useMemo(() => new Map(candidates.map((c) => [c.name.toLowerCase(), c])), [candidates]);
  const board = useMemo(() => {
    const values = new Map<string, TotalRow>();
    for (const r of rows) values.set(r.label, r);
    return candidates.map((c) => {
      const party = c.party_id ? partyMap.get(c.party_id) : undefined;
      const match = rows.find((r) => r.candidate_id === c.id || r.candidate_name?.toLowerCase() === c.name.toLowerCase() || r.label.toLowerCase() === c.name.toLowerCase());
      return {
        label: match?.label ?? c.name,
        candidate: c.name,
        party: party?.abbreviation ?? match?.party_abbreviation ?? "—",
        partyName: party?.name ?? match?.party_name ?? null,
        votes: match?.total_votes ?? 0,
        units: match?.polling_units_with_entry ?? 0,
        sheets: match?.verified_result_sheets ?? 0,
      };
    }).concat(rows.filter((r) => !candidateByName.has((identityMap.get(r.label)?.candidate_name ?? r.label).toLowerCase())).map((r) => {
      return { label:r.label, candidate:r.candidate_name ?? "Identity not linked", party:r.party_abbreviation ?? "—", partyName:r.party_name ?? null, votes:r.total_votes ?? 0, units:r.polling_units_with_entry ?? 0, sheets:r.verified_result_sheets ?? 0 };
    })).sort((a,b) => b.votes-a.votes || a.label.localeCompare(b.label));
  }, [rows,candidates,partyMap,identityMap,candidateByName]);

  const maxVotes = Math.max(1, ...board.map((r) => r.votes));
  const totalVotes = board.reduce((sum,r) => sum + r.votes, 0);
  const levelLabel = pollingUnitId ? "Polling Unit" : wardId ? "Ward" : lgaId ? "LGA" : stateId ? "State" : "Election";

  function go(child: Child) {
    if (!stateId) onState(child.id);
    else if (!lgaId) onLga(child.id);
    else if (!wardId) onWard(child.id);
    else onPollingUnit(child.id);
  }

  const crumbs = [
    {label:"Election", active:!stateId, onClick:onClear},
    ...(stateName ? [{label:stateName, active:!lgaId, onClick:()=>{onState(stateId); onLga(""); onWard(""); onPollingUnit("");}}] : []),
    ...(lgaName ? [{label:lgaName, active:!wardId, onClick:()=>{onLga(lgaId); onWard(""); onPollingUnit("");}}] : []),
    ...(wardName ? [{label:wardName, active:!pollingUnitId, onClick:()=>{onWard(wardId); onPollingUnit("");}}] : []),
    ...(pollingUnitName ? [{label:pollingUnitName, active:true, onClick:()=>{}}] : []),
  ];

  return <div className="space-y-5">
    <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900/40 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-600">Results explorer</p>
          <h3 className="mt-1 font-display text-xl font-semibold text-zinc-100">{levelLabel} result board</h3>
          <p className="mt-1 text-xs text-zinc-600">Verified result entries only. Missing or unprocessed polling units are not treated as zero.</p>
        </div>
        <button onClick={() => window.location.reload()} className="inline-flex items-center gap-2 rounded-xl border border-zinc-800/60 px-3 py-2 text-xs text-zinc-400 hover:bg-zinc-800/60"><RefreshCw size={13}/> Refresh</button>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-1.5 text-[11px]">
        {crumbs.map((c,i) => <span key={c.label+i} className="inline-flex items-center gap-1.5">{i>0 && <ChevronRight size={11} className="text-zinc-700"/>}<button onClick={c.onClick} className={c.active ? "text-zinc-100 font-medium" : "text-zinc-500 hover:text-zinc-200"}>{c.label}</button></span>)}
      </div>
    </div>

    {!pollingUnitId && <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900/30 p-5">
      <div className="flex items-center gap-2"><MapPin size={15} className="text-zinc-500"/><div><p className="text-sm font-medium text-zinc-200">{level === "election" ? "Geographic result tree" : "Next level"}</p><p className="text-[11px] text-zinc-600">Open a {level === "election" ? "state" : level === "state" ? "local government area" : level === "lga" ? "ward" : "polling unit"} to recalculate the result board.</p></div></div>
      {childrenLoading ? <div className="mt-4 h-12 animate-pulse rounded-xl bg-zinc-800/40"/> : children.length ? <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {children.slice(0,60).map((child) => <button key={child.id} onClick={()=>go(child)} className="group flex items-center justify-between gap-3 rounded-xl border border-zinc-800/60 bg-zinc-950/40 p-3.5 text-left hover:border-zinc-700 hover:bg-zinc-900">
          <span className="min-w-0"><span className="block truncate text-sm font-medium text-zinc-200">{child.name}</span>{child.code && <span className="text-[10px] text-zinc-600">{child.code}</span>}</span><ChevronRight size={15} className="text-zinc-700 group-hover:text-zinc-300"/>
        </button>)}
      </div> : <p className="mt-4 text-xs text-zinc-600">No child geography records are available.</p>}
    </div>}

    {error && <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-xs text-amber-200">{error}</div>}

    <div className="grid gap-5 xl:grid-cols-[1.45fr_.75fr]">
      <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900/40 p-5">
        <div className="flex items-center justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-600">All parties / candidates</p><p className="mt-1 text-xs text-zinc-500">{board.length} contesting result row{board.length===1?"":"s"} · {n(totalVotes)} recorded votes</p></div><ShieldCheck size={16} className="text-emerald-400/70"/></div>
        {loading ? <div className="mt-5 space-y-2">{[1,2,3,4].map(i=><div key={i} className="h-12 rounded-xl bg-zinc-800/40 animate-pulse"/>)}</div> : board.length ? <div className="mt-4 overflow-hidden rounded-xl border border-zinc-800/60">
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(90px,.45fr)_auto] gap-3 bg-zinc-950/60 px-4 py-3 text-[10px] font-semibold uppercase tracking-[.12em] text-zinc-600"><span>Candidate</span><span>Party</span><span className="text-right">Votes</span></div>
          {board.map((r,i)=><div key={r.label+i} className="grid grid-cols-[minmax(0,1fr)_minmax(90px,.45fr)_auto] gap-3 border-t border-zinc-800/50 px-4 py-3.5">
            <div className="min-w-0"><p className="truncate text-sm font-medium text-zinc-200">{r.candidate}</p><p className="mt-0.5 truncate text-[10px] text-zinc-600">{r.label}{r.partyName ? " · "+r.partyName : ""}</p></div>
            <span className="text-xs font-semibold text-zinc-400">{r.party}</span><span className="font-display text-sm font-semibold text-zinc-100">{n(r.votes)}</span>
          </div>)}
        </div> : <p className="mt-6 text-sm text-zinc-600">No verified result entries have been recorded at this scope.</p>}
      </div>

      <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900/40 p-5">
        <div className="flex items-center gap-2"><BarChart3 size={15} className="text-zinc-500"/><div><p className="text-sm font-medium text-zinc-200">Vote distribution</p><p className="text-[10px] text-zinc-600">Recorded votes by contest entry</p></div></div>
        <div className="mt-5 space-y-3">{board.slice(0,12).map((r)=><div key={"chart-"+r.label}><div className="mb-1 flex justify-between gap-2 text-[10px]"><span className="truncate text-zinc-500">{r.party !== "—" ? r.party : r.candidate}</span><span className="text-zinc-400">{n(r.votes)}</span></div><div className="h-2 overflow-hidden rounded-full bg-zinc-800"><div className="h-full rounded-full bg-zinc-400/70" style={{width: Math.max(1, r.votes/maxVotes*100)+"%"}}/></div></div>)}</div>
      </div>
    </div>

    {pollingUnitId && <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900/40 p-5">
      <p className="text-[10px] font-semibold uppercase tracking-[.16em] text-zinc-600">Polling-unit evidence</p>
      <p className="mt-1 text-sm text-zinc-300">{pollingUnitName}{pollingUnitCode ? " · "+pollingUnitCode : ""}</p>
      <p className="mt-2 text-xs text-zinc-600">This level represents the extracted result from the verified polling-unit result sheet. Use the evidence link in the processed archive for the source document.</p>
    </div>}
  </div>;
}
