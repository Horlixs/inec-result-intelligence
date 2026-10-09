import { Activity, ArrowDown, ArrowUp, ArrowUpDown, BarChart3, CheckCircle2, FileText, Layers3, Map as MapIcon, Search, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";

interface NavProps { onSelectElection?: (id:string)=>void; }
interface Election { id:string; name:string; election_type:string; election_date:string|null; }
interface CandidateRow { id:string; full_name:string; party_id:string|null; election_id:string; position:string|null; }
interface Party { id:string; abbreviation:string; name:string|null; }
interface Coverage { election_id:string; name:string; election_type:string; total_pus_expected:number; discovered_pus:number; verified_pus:number; in_review_pus:number; failed_pus:number; discovered_sheets:number; verified_sheets:number; unprocessed_sheets:number; in_review_sheets:number; failed_sheets:number; verified_entries:number; linked_candidates:number; states_with_results:number; lgas_with_results:number; wards_with_results:number; pus_with_records:number; pu_verification_percent:number; sheet_verification_percent:number; }
interface PipelineStatus { status:string; heartbeat_at:string|null; last_worker_started:string|null; last_worker_finished:string|null; last_successful_batch:string|null; last_error:string|null; jobs_processed_last_run:number; jobs_failed_last_run:number; queue_remaining:number; active_jobs:number; run_id:string|null; }
interface PipelineMetrics { queued_jobs:number; active_jobs:number; processed_today:number; failed_today:number; processed_24h:number; processed_7d:number; }
interface LiveProcessingStatus {
 queued_jobs:number;
 active_jobs:number;
 stale_processing_jobs:number;
 processed_today:number;
 failed_today:number;
 last_processing_at:string|null;
 last_completed_at:string|null;
 last_failed_at:string|null;
 schedule_enabled:boolean;
 interval_minutes:number;
 schedule_last_run_at:string|null;
 schedule_next_run_at:string|null;
}

const typeLabel=(x:string)=>({governorship:"Governor",presidential:"President",senatorial:"Senate",house_of_representatives:"House of Representatives",house_of_assembly:"State House of Assembly",chairmanship:"Chairman",councillor:"Councillor"}[x]??x.replace(/_/g," "));
const n=(v:number|null|undefined)=>v==null?"—":new Intl.NumberFormat("en-NG").format(v);
const pct=(v:number|null|undefined)=>`${(v??0).toFixed(1)}%`;

export function ResultsWorkspace({onSelectElection}:NavProps){
 const [rows,setRows]=useState<Election[]>([]);
 const [search,setSearch]=useState("");
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState("");
 useEffect(()=>{
  const client=supabase;
  if(!client){setLoading(false);return;}
  let cancelled=false;
  const q=search.trim();
  setLoading(true);
  setError("");
  const timer=window.setTimeout(()=>{
   void (async()=>{
    try{
     const base=client.from("elections").select("id,name,election_type,election_date").order("election_date",{ascending:false});
     const response=q ? await base.ilike("name",`%${q}%`).limit(100) : await base.limit(1000);
     if(cancelled)return;
     if(response.error)throw response.error;
     setRows((response.data??[]) as Election[]);
    }catch(e){
     if(!cancelled){
      setRows([]);
      setError(e instanceof Error?e.message:"Results could not be loaded.");
     }
    }finally{
     if(!cancelled)setLoading(false);
    }
   })();
  },250);
  return()=>{cancelled=true;window.clearTimeout(timer);};
 },[search]);
 const filteredRows=rows;

 return <section className="space-y-5">
  <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900/40 p-6">
   <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
    <div>
     <p className="text-[10px] font-semibold uppercase tracking-[.18em] text-zinc-600">Results workspace</p>
     <h2 className="mt-2 font-display text-2xl font-semibold text-zinc-100">Track results through the hierarchy</h2>
     <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-500">Choose an election to move from the election aggregate into state, LGA, ward and polling-unit result boards.</p>
    </div>
    <label className="relative block w-full lg:w-80">
     <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600"/>
     <input value={search} onChange={(e)=>setSearch(e.target.value)} placeholder="Search results by election…" aria-label="Search results by election" className="w-full rounded-xl border border-zinc-800 bg-zinc-950/70 py-2.5 pl-9 pr-9 text-sm text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-zinc-700 focus:ring-1 focus:ring-zinc-700"/>
     {search&&<button type="button" onClick={()=>setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-zinc-600 hover:text-zinc-300" aria-label="Clear search">×</button>}
    </label>
   </div>
  </div>
  <div className="flex items-center justify-between gap-3 px-1">
   <p className="text-[10px] uppercase tracking-[.16em] text-zinc-600">{loading?"Searching…":search.trim()?`${filteredRows.length} matching ${filteredRows.length===1?"election":"elections"}`:`${rows.length} elections loaded`}</p>
  </div>
  {error&&<div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-xs text-amber-200">{error}</div>}
  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
   {filteredRows.map(e=><button key={e.id} onClick={()=>onSelectElection?.(e.id)} className="rounded-2xl border border-zinc-800/60 bg-zinc-950/35 p-4 text-left hover:border-zinc-700 hover:bg-zinc-900"><span className="text-[10px] uppercase tracking-[.14em] text-zinc-600">{typeLabel(e.election_type)}</span><p className="mt-2 font-display text-sm font-semibold text-zinc-200">{e.name}</p><p className="mt-2 text-[11px] text-zinc-600">{e.election_date ?? "Date unavailable"}</p></button>)}
   {!filteredRows.length&&<div className="col-span-full rounded-2xl border border-dashed border-zinc-800/60 px-5 py-10 text-center text-sm text-zinc-600">{search.trim()?`No elections match "${search.trim()}".`:"No election records are available yet."}</div>}
  </div>
 </section>;
}

export function CandidatesWorkspace(){
 const [rows,setRows]=useState<CandidateRow[]>([]); const [parties,setParties]=useState<Party[]>([]); const [elections,setElections]=useState<Election[]>([]);
 useEffect(()=>{if(!supabase)return;void Promise.all([supabase.from("candidate_records").select("id,full_name,party_id,election_id,position").eq("status","published").is("valid_to",null).order("full_name").limit(500),supabase.from("parties").select("id,abbreviation,name"),supabase.from("elections").select("id,name,election_type,election_date")]).then(([a,b,c])=>{setRows((a.data??[]) as CandidateRow[]);setParties((b.data??[]) as Party[]);setElections((c.data??[]) as Election[]);});},[]);
 const pm=new globalThis.Map(parties.map(p=>[p.id,p])); const em=new globalThis.Map(elections.map(e=>[e.id,e]));
 return <section className="space-y-5"><div className="rounded-2xl border border-zinc-800/60 bg-zinc-900/40 p-6"><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-zinc-600">Candidate registry</p><h2 className="mt-2 font-display text-2xl font-semibold text-zinc-100">Candidates & parties</h2><p className="mt-2 text-sm leading-6 text-zinc-500">Canonical candidate identity is kept separate from OCR labels and can be traced to the election source record.</p></div><div className="overflow-hidden rounded-2xl border border-zinc-800/60 bg-zinc-900/40">{rows.length?<>{rows.map(r=><div key={r.id} className="grid grid-cols-[minmax(0,1fr)_100px_minmax(0,1fr)] gap-4 border-b border-zinc-800/50 p-4 last:border-0"><div><p className="text-sm font-medium text-zinc-200">{r.full_name}</p><p className="text-[10px] text-zinc-600">{r.position??typeLabel(em.get(r.election_id)?.election_type??"")} · {em.get(r.election_id)?.name??"Election"}</p></div><span className="text-xs font-semibold text-zinc-400">{r.party_id?pm.get(r.party_id)?.abbreviation:"—"}</span><span className="truncate text-xs text-zinc-600">{r.party_id?pm.get(r.party_id)?.name:"Party metadata unavailable"}</span></div>)}</>:<div className="p-10 text-center text-sm text-zinc-600">No published candidate records are synchronized yet.</div>}</div></section>;
}

export function AnalyticsWorkspace(){
 const [rows,setRows]=useState<Coverage[]>([]); const [pipeline,setPipeline]=useState<PipelineStatus|null>(null); const [metrics,setMetrics]=useState<PipelineMetrics|null>(null); const [live,setLive]=useState<LiveProcessingStatus|null>(null); const [loading,setLoading]=useState(true); const [error,setError]=useState(""); const [search,setSearch]=useState(""); const [sortKey,setSortKey]=useState<keyof Coverage>("name"); const [sortDirection,setSortDirection]=useState<"asc"|"desc">("asc");
 useEffect(()=>{const client=supabase;if(!client)return;let cancelled=false;
  const load=async()=>{
   const [r,p,m,l]=await Promise.all([
    client.from("election_pipeline_coverage").select("*").order("election_date",{ascending:false,nullsFirst:false}),
    client.from("pipeline_worker_status").select("*").eq("id","irev-ocr-drain").maybeSingle(),
    client.from("pipeline_worker_metrics").select("*").maybeSingle(),
    client.rpc("get_paddle_processing_status"),
   ]);
   if(cancelled)return;
   const firstError=r.error??p.error??l.error;
   if(firstError)setError(firstError.message);else setError("");
   setRows((r.data??[]) as Coverage[]);
   setPipeline((p.data??null) as PipelineStatus|null);
   setMetrics((m.data??null) as PipelineMetrics|null);
   // PostgREST returns SETOF/table RPC results as an array. Normalize the row
   // before storing it; treating the array itself as an object silently made
   // all live queue counters undefined while timestamps continued updating.
   const liveRow = Array.isArray(l.data) ? l.data[0] : l.data;
   setLive((liveRow??null) as LiveProcessingStatus|null);
   setLoading(false);
  };
  void load();
  const timer=window.setInterval(()=>{void load();},5000);
  return()=>{cancelled=true;window.clearInterval(timer);};
 },[]);
 const totals=useMemo(()=>rows.reduce((a,r)=>({elections:a.elections+1,pus:a.pus+r.total_pus_expected,discoveredPus:a.discoveredPus+r.discovered_pus,verifiedPus:a.verifiedPus+r.verified_pus,reviewPus:a.reviewPus+r.in_review_pus,failedPus:a.failedPus+r.failed_pus,sheets:a.sheets+r.discovered_sheets,verifiedSheets:a.verifiedSheets+r.verified_sheets,unprocessedSheets:a.unprocessedSheets+r.unprocessed_sheets,entries:a.entries+r.verified_entries,linkedCandidates:a.linkedCandidates+r.linked_candidates,wards:a.wards+r.wards_with_results,lgas:a.lgas+r.lgas_with_results,states:a.states+r.states_with_results}),{elections:0,pus:0,discoveredPus:0,verifiedPus:0,reviewPus:0,failedPus:0,sheets:0,verifiedSheets:0,unprocessedSheets:0,entries:0,linkedCandidates:0,wards:0,lgas:0,states:0}),[rows]);
 const cards=[["Elections tracked",totals.elections,Layers3],["Expected polling units",totals.pus,MapIcon],["PUs discovered",totals.discoveredPus,MapIcon],["PUs verified",totals.verifiedPus,CheckCircle2],["PUs in review",totals.reviewPus,Activity],["Result sheets discovered",totals.sheets,FileText],["Sheets verified",totals.verifiedSheets,CheckCircle2],["Sheets awaiting processing",totals.unprocessedSheets,Activity],["Verified result entries",totals.entries,BarChart3],["Candidate-linked entries",totals.linkedCandidates,Users],["Wards with records",totals.wards,MapIcon],["LGAs with records",totals.lgas,MapIcon]];
 const filteredRows=useMemo(()=>{const q=search.trim().toLowerCase(); const filtered=q?rows.filter(r=>[r.name,r.election_type,typeLabel(r.election_type),String(r.total_pus_expected),String(r.verified_pus),String(r.pu_verification_percent),String(r.discovered_sheets),String(r.verified_sheets),String(r.unprocessed_sheets+r.in_review_sheets),String(r.verified_entries)].some(v=>v.toLowerCase().includes(q))):rows; return [...filtered].sort((a,b)=>{const av=a[sortKey],bv=b[sortKey]; if(av==null&&bv==null)return 0;if(av==null)return 1;if(bv==null)return -1; const an=typeof av==="number",bn=typeof bv==="number"; const cmp=an&&bn?(av as number)-(bv as number):String(av).localeCompare(String(bv),undefined,{numeric:true,sensitivity:"base"});return sortDirection==="asc"?cmp:-cmp;});},[rows,search,sortKey,sortDirection]);
 const setSort=(key:keyof Coverage)=>{if(sortKey===key)setSortDirection(d=>d==="asc"?"desc":"asc");else{setSortKey(key);setSortDirection("asc");}};
 const sortButton=(label:string,key:keyof Coverage)=><button type="button" onClick={()=>setSort(key)} className="group inline-flex items-center gap-1.5 text-left transition-colors hover:text-zinc-300" title={`Sort by ${label}`}>{label}{sortKey===key?(sortDirection==="asc"?<ArrowUp size={12}/>:<ArrowDown size={12}/>):<ArrowUpDown size={12} className="opacity-50 group-hover:opacity-100" />}</button>;
 const queueCount=live?.queued_jobs??metrics?.queued_jobs??pipeline?.queue_remaining??0;
 const activeCount=live?.active_jobs??metrics?.active_jobs??pipeline?.active_jobs??0;
 const staleCount=live?.stale_processing_jobs??0;
 const pipelineState=live
  ? staleCount>0?"error":activeCount>0?"active":queueCount>0?"queued":"idle"
  : pipeline?.status==="error"?"error":activeCount>0?"active":queueCount>0?"queued":"idle";
 const pipelineLabel=pipelineState==="active"?"PaddleOCR Active":pipelineState==="queued"?"PaddleOCR Queued":pipelineState==="error"?"PaddleOCR Attention Required":"PaddleOCR Idle";
 const lastActivity=live?.last_processing_at??live?.last_completed_at??live?.last_failed_at??pipeline?.heartbeat_at;
 const nextAutomaticRun=live?.schedule_next_run_at;
 return <section className="space-y-5"><div className="sticky top-3 z-20 rounded-2xl border border-zinc-800/70 bg-zinc-950/95 px-4 py-3 shadow-xl shadow-black/20 backdrop-blur"><div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs"><div className="flex items-center gap-2 font-semibold text-zinc-100"><span className={"inline-flex h-2 w-2 rounded-full " + (pipelineState==="error" ? "bg-red-500" : pipelineState==="active" ? "bg-emerald-500" : pipelineState==="queued" ? "bg-amber-400" : "bg-zinc-500")}></span>{pipelineLabel}</div><div className="text-zinc-500">Last Paddle activity: <span className="text-zinc-300">{lastActivity ? new Date(lastActivity).toLocaleString() : "Not reported"}</span></div><div className="text-zinc-500">Processing: <span className="font-medium text-zinc-300">{n(activeCount)}</span></div><div className="text-zinc-500">Queue: <span className="font-medium text-zinc-300">{n(queueCount)}</span></div><div className="text-zinc-500">Today: <span className="font-medium text-zinc-300">{n(live?.processed_today??metrics?.processed_today??0)} processed</span></div><div className="text-zinc-500">Failed: <span className="font-medium text-red-300">{n(live?.failed_today??metrics?.failed_today??0)}</span></div>{nextAutomaticRun&&<div className="text-zinc-500">Next: <span className="font-medium text-zinc-300">{new Date(nextAutomaticRun).toLocaleString()}</span></div>}{staleCount>0&&<div className="text-amber-300">Stale: <span className="font-medium">{n(staleCount)}</span></div>}</div>{pipeline?.last_error&&<p className="mt-2 truncate border-t border-zinc-800/60 pt-2 text-[11px] text-amber-300" title={pipeline.last_error}>{pipeline.last_error}</p>}</div><div className="rounded-2xl border border-zinc-800/60 bg-zinc-900/40 p-6"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-zinc-600">Analytics</p><h2 className="mt-2 font-display text-2xl font-semibold text-zinc-100">Pipeline coverage & result intelligence</h2><p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-500">Processing counts and result totals are separated from official expected coverage. A partial election must never look complete simply because the currently processed sheets aggregate cleanly.</p></div><div className="rounded-xl border border-zinc-800/60 bg-zinc-950/40 px-4 py-3 text-right"><p className="text-[10px] uppercase tracking-[.14em] text-zinc-600">Verified PU coverage</p><p className="mt-1 font-display text-xl font-semibold text-zinc-100">{pct(totals.pus?100*totals.verifiedPus/totals.pus:0)}</p></div></div></div>{error&&<div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-xs text-amber-200">Analytics data could not be loaded: {error}</div>}{loading?<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{Array.from({length:12}).map((_,i)=><div key={i} className="h-28 animate-pulse rounded-2xl bg-zinc-900/50"/>)}</div>:<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{cards.map(([label,value,Icon]:any)=><div key={label as string} className="rounded-2xl border border-zinc-800/60 bg-zinc-900/40 p-5"><Icon size={17} className="text-zinc-500"/><p className="mt-5 text-xs text-zinc-600">{label}</p><p className="mt-1 font-display text-3xl font-semibold text-zinc-100">{n(value as number)}</p></div>)}</div>}<div className="overflow-hidden rounded-2xl border border-zinc-800/60 bg-zinc-900/40"><div className="border-b border-zinc-800/60 p-3"><label className="relative block max-w-md"><Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600"/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search elections, types, or values…" className="w-full rounded-xl border border-zinc-800 bg-zinc-950/70 py-2.5 pl-9 pr-9 text-sm text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-zinc-700 focus:ring-1 focus:ring-zinc-700"/>{search&&<button type="button" onClick={()=>setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-zinc-600 hover:text-zinc-300" aria-label="Clear search">×</button>}</label></div><div className="overflow-x-auto"><div className="min-w-[980px]"><div className="grid grid-cols-[minmax(240px,1.5fr)_100px_110px_110px_110px_110px_110px_120px] gap-3 border-b border-zinc-800/60 px-5 py-3 text-[10px] font-semibold uppercase tracking-[.12em] text-zinc-600"><span>{sortButton("Election","name")}</span><span>{sortButton("Expected PUs","total_pus_expected")}</span><span>{sortButton("Verified PUs","verified_pus")}</span><span>{sortButton("PU coverage","pu_verification_percent")}</span><span>{sortButton("Sheets","discovered_sheets")}</span><span>{sortButton("Verified","verified_sheets")}</span><span>{sortButton("Pending","unprocessed_sheets")}</span><span>{sortButton("Entries","verified_entries")}</span></div>{filteredRows.map(r=><div key={r.election_id} className="grid grid-cols-[minmax(240px,1.5fr)_100px_110px_110px_110px_110px_110px_120px] gap-3 border-b border-zinc-800/40 px-5 py-4 text-xs last:border-0"><div><p className="font-medium text-zinc-200">{r.name}</p><p className="mt-1 text-[10px] uppercase tracking-[.1em] text-zinc-600">{typeLabel(r.election_type)}</p></div><span className="text-zinc-400">{n(r.total_pus_expected)}</span><span className="text-zinc-400">{n(r.verified_pus)}</span><span className="text-zinc-300">{pct(r.pu_verification_percent)}</span><span className="text-zinc-400">{n(r.discovered_sheets)}</span><span className="text-zinc-300">{n(r.verified_sheets)}</span><span className="text-zinc-400">{n(r.unprocessed_sheets+r.in_review_sheets)}</span><span className="text-zinc-400">{n(r.verified_entries)}</span></div>)}{!filteredRows.length&&!loading&&<div className="p-10 text-center text-sm text-zinc-600">{search?`No elections match "${search}".`:"No election coverage records are available yet."}</div>}</div></div></div></section>;
}