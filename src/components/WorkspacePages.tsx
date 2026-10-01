import { BarChart3, CheckCircle2, FileText, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

interface NavProps { onSelectElection?: (id:string)=>void; }
interface Election { id:string; name:string; election_type:string; election_date:string|null; }
interface CandidateRow { id:string; full_name:string; party_id:string|null; election_id:string; position:string|null; }
interface Party { id:string; abbreviation:string; name:string|null; }

const typeLabel=(x:string)=>({governorship:"Governor",presidential:"President",senatorial:"Senate",house_of_representatives:"House of Representatives",house_of_assembly:"State House of Assembly",chairmanship:"Chairman",councillor:"Councillor"}[x]??x.replace(/_/g," "));
const n=(v:number|null|undefined)=>v==null?"—":new Intl.NumberFormat("en-NG").format(v);

export function ResultsWorkspace({onSelectElection}:NavProps){
 const [rows,setRows]=useState<Election[]>([]);
 useEffect(()=>{if(!supabase)return;void supabase.from("elections").select("id,name,election_type,election_date").order("election_date",{ascending:false}).limit(24).then(r=>setRows((r.data??[]) as Election[]));},[]);
 return <section className="space-y-5">
  <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900/40 p-6"><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-zinc-600">Results workspace</p><h2 className="mt-2 font-display text-2xl font-semibold text-zinc-100">Track results through the hierarchy</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-500">Choose an election to move from the election aggregate into state, LGA, ward and polling-unit result boards.</p></div>
  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{rows.map(e=><button key={e.id} onClick={()=>onSelectElection?.(e.id)} className="rounded-2xl border border-zinc-800/60 bg-zinc-950/35 p-4 text-left hover:border-zinc-700 hover:bg-zinc-900"><span className="text-[10px] uppercase tracking-[.14em] text-zinc-600">{typeLabel(e.election_type)}</span><p className="mt-2 font-display text-sm font-semibold text-zinc-200">{e.name}</p><p className="mt-2 text-[11px] text-zinc-600">{e.election_date ?? "Date unavailable"}</p></button>)}</div>
 </section>;
}

export function CandidatesWorkspace(){
 const [rows,setRows]=useState<CandidateRow[]>([]); const [parties,setParties]=useState<Party[]>([]); const [elections,setElections]=useState<Election[]>([]);
 useEffect(()=>{if(!supabase)return;void Promise.all([supabase.from("candidate_records").select("id,full_name,party_id,election_id,position").eq("status","published").is("valid_to",null).order("full_name").limit(200),supabase.from("parties").select("id,abbreviation,name"),supabase.from("elections").select("id,name,election_type,election_date")]).then(([a,b,c])=>{setRows((a.data??[]) as CandidateRow[]);setParties((b.data??[]) as Party[]);setElections((c.data??[]) as Election[]);});},[]);
 const pm=new Map(parties.map(p=>[p.id,p])); const em=new Map(elections.map(e=>[e.id,e]));
 return <section className="space-y-5"><div className="rounded-2xl border border-zinc-800/60 bg-zinc-900/40 p-6"><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-zinc-600">Candidate registry</p><h2 className="mt-2 font-display text-2xl font-semibold text-zinc-100">Candidates & parties</h2><p className="mt-2 text-sm leading-6 text-zinc-500">Canonical candidate identity is kept separate from OCR labels and can be traced to the election source record.</p></div><div className="overflow-hidden rounded-2xl border border-zinc-800/60 bg-zinc-900/40">{rows.length?<>{rows.map(r=><div key={r.id} className="grid grid-cols-[minmax(0,1fr)_100px_minmax(0,1fr)] gap-4 border-b border-zinc-800/50 p-4 last:border-0"><div><p className="text-sm font-medium text-zinc-200">{r.full_name}</p><p className="text-[10px] text-zinc-600">{r.position??typeLabel(em.get(r.election_id)?.election_type??"")} · {em.get(r.election_id)?.name??"Election"}</p></div><span className="text-xs font-semibold text-zinc-400">{r.party_id?pm.get(r.party_id)?.abbreviation:"—"}</span><span className="truncate text-xs text-zinc-600">{r.party_id?pm.get(r.party_id)?.name:"Party metadata unavailable"}</span></div>)}</>:<div className="p-10 text-center text-sm text-zinc-600">No published candidate records are synchronized yet.</div>}</div></section>;
}

export function AnalyticsWorkspace(){
 const [counts,setCounts]=useState({sheets:0,extractions:0,entries:0,checks:0});
 useEffect(()=>{if(!supabase)return;void Promise.all(["result_sheets","extractions","result_entries","validation_checks"].map(t=>supabase!.from(t).select("id",{count:"exact",head:true}))).then(([a,b,c,d])=>setCounts({sheets:a.count??0,extractions:b.count??0,entries:c.count??0,checks:d.count??0}));},[]);
 const cards=[["Verified/result sheets",counts.sheets,FileText],["Extractions",counts.extractions,CheckCircle2],["Result entries",counts.entries,BarChart3],["Validation checks",counts.checks,ShieldIcon]];
 return <section className="space-y-5"><div className="rounded-2xl border border-zinc-800/60 bg-zinc-900/40 p-6"><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-zinc-600">Analytics</p><h2 className="mt-2 font-display text-2xl font-semibold text-zinc-100">Pipeline coverage & processing</h2><p className="mt-2 text-sm leading-6 text-zinc-500">These counters describe persisted intelligence records. Election and geographic result boards remain drill-down views over the same verified layer.</p></div><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{cards.map(([label,value,Icon]:any)=><div key={label as string} className="rounded-2xl border border-zinc-800/60 bg-zinc-900/40 p-5"><Icon size={17} className="text-zinc-500"/><p className="mt-5 text-xs text-zinc-600">{label}</p><p className="mt-1 font-display text-3xl font-semibold text-zinc-100">{n(value as number)}</p></div>)}</div></section>;
}
function ShieldIcon(props:any){return <Users {...props}/>;}
