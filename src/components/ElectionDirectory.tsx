import { ArrowRight, CalendarDays, Layers3 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { supabase } from "../lib/supabase";

interface Election { id: string; name: string; election_type: string; election_date: string | null; status: string; }
type Category = "Federal" | "State" | "Local Government";

function yearOf(value: string | null): string { return value ? new Date(value).getFullYear().toString() : "Unknown"; }
function categoryOf(type: string): Category {
  if (["presidential", "senatorial", "house_of_representatives"].includes(type)) return "Federal";
  if (["governorship", "house_of_assembly", "state_constituency"].includes(type)) return "State";
  return "Local Government";
}
function typeLabel(type: string): string {
  const labels: Record<string,string> = { presidential:"Presidential", senatorial:"Senate", house_of_representatives:"House of Representatives", governorship:"Governorship", house_of_assembly:"State House of Assembly", state_constituency:"State Constituency", chairmanship:"Chairmanship", councillor:"Councillor" };
  return labels[type] ?? type.replace(/_/g," ");
}
function dateLabel(value: string | null): string { return value ? new Intl.DateTimeFormat("en-NG",{dateStyle:"medium"}).format(new Date(value)) : "Date unavailable"; }

export function ElectionDirectory() {
  const [rows,setRows]=useState<Election[]>([]);
  const [loading,setLoading]=useState(true);
  useEffect(()=>{ if(!supabase){setLoading(false);return;} void supabase.from("elections").select("id,name,election_type,election_date,status").order("election_date",{ascending:false}).then(r=>{setRows((r.data??[]) as Election[]);setLoading(false);}); },[]);
  const years=useMemo(()=>{const m=new Map<string,Election[]>(); for(const e of rows){const y=yearOf(e.election_date);m.set(y,[...(m.get(y)??[]),e]);} return [...m.entries()].sort((a,b)=>Number(b[0])-Number(a[0]));},[rows]);
  if(loading) return <div className="rounded-3xl border border-zinc-800/60 bg-zinc-900/35 p-12 text-center text-sm text-zinc-500">Loading election archive…</div>;
  return <section>
    <div className="mb-7"><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-600">Election archive</p><h2 className="mt-2 font-display text-3xl font-semibold tracking-tight text-zinc-100">Browse elections by year</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-500">Each year is a complete election workspace. Open a year to move across federal, state and local-government contests without losing the context of that election cycle.</p></div>
    <div className="space-y-5">
      {years.map(([year,elections])=>{
        const cats=["Federal","State","Local Government"] as Category[];
        return <Link key={year} to="/elections/year/$year" params={{year}} className="group block overflow-hidden rounded-3xl border border-zinc-800/70 bg-gradient-to-br from-zinc-900/80 via-zinc-900/45 to-zinc-950/80 p-5 transition-all duration-300 hover:-translate-y-0.5 hover:border-zinc-700 hover:shadow-2xl hover:shadow-black/20 sm:p-7">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-start gap-5"><div className="grid size-16 shrink-0 place-items-center rounded-2xl border border-zinc-700/60 bg-zinc-950/80 font-display text-xl font-semibold text-zinc-100">{year}</div><div><div className="flex flex-wrap items-center gap-2"><span className="rounded-full border border-zinc-800 bg-zinc-950/60 px-2.5 py-1 text-[10px] uppercase tracking-wider text-zinc-500">{elections.length} elections</span><span className="text-xs text-zinc-600">Election cycle</span></div><h3 className="mt-2 font-display text-xl font-semibold text-zinc-100 sm:text-2xl">Explore the {year} election records</h3><p className="mt-1 text-xs text-zinc-600">Move between election categories, offices and individual result pages.</p></div></div>
            <ArrowRight size={20} className="hidden text-zinc-600 transition-transform group-hover:translate-x-1 lg:block"/>
          </div>
          <div className="mt-7 grid gap-3 md:grid-cols-3">
            {cats.map(cat=>{const list=elections.filter(e=>categoryOf(e.election_type)===cat);return <div key={cat} className="rounded-2xl border border-zinc-800/60 bg-zinc-950/45 p-4"><div className="flex items-center justify-between"><span className="text-xs font-semibold text-zinc-300">{cat}</span><span className="text-[11px] text-zinc-600">{list.length}</span></div><div className="mt-3 space-y-2">{list.slice(0,3).map(e=><div key={e.id} className="truncate text-[11px] text-zinc-600">{typeLabel(e.election_type)}</div>)}{list.length>3&&<div className="text-[11px] text-zinc-700">+ {list.length-3} more</div>}</div></div>})}
          </div>
        </Link>
      })}
    </div>
  </section>;
}

export function ElectionYearPage({ year }: { year: string }) {
  const [rows,setRows]=useState<Election[]>([]);
  const [loading,setLoading]=useState(true);
  const [category,setCategory]=useState<Category|"">("");
  useEffect(()=>{if(!supabase){setLoading(false);return;} void supabase.from("elections").select("id,name,election_type,election_date,status").gte("election_date",year+"-01-01").lt("election_date",(Number(year)+1)+"-01-01").order("election_date",{ascending:false}).then(r=>{setRows((r.data??[]) as Election[]);setLoading(false);});},[year]);
  const visible=useMemo(()=>category?rows.filter(e=>categoryOf(e.election_type)===category):rows,[rows,category]);
  return <section>
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><div className="mb-2 flex items-center gap-2 text-xs text-zinc-600"><Link to="/elections" className="hover:text-zinc-300">Elections</Link><span>/</span><span>{year}</span></div><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-600">Election year</p><h2 className="mt-2 font-display text-4xl font-semibold tracking-tight text-zinc-100">{year}</h2><p className="mt-2 text-sm text-zinc-500">All recorded elections for this year, organized by electoral level.</p></div><Link to="/elections" className="rounded-xl border border-zinc-800/70 px-3.5 py-2.5 text-xs text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100">All years</Link></div>
    <div className="mb-6 grid gap-3 sm:grid-cols-3">{(["Federal","State","Local Government"] as Category[]).map(cat=><button key={cat} onClick={()=>setCategory(category===cat?"":cat)} className={"rounded-2xl border p-4 text-left transition-all "+(category===cat?"border-zinc-500 bg-zinc-100 text-zinc-950":"border-zinc-800/70 bg-zinc-900/40 text-zinc-300 hover:border-zinc-700")}><div className="flex items-center justify-between"><span className="text-sm font-semibold">{cat}</span><span className="text-xs opacity-60">{rows.filter(e=>categoryOf(e.election_type)===cat).length}</span></div><p className="mt-1 text-[11px] opacity-60">Browse this level</p></button>)}</div>
    {loading?<div className="rounded-2xl border border-zinc-800/60 p-10 text-center text-sm text-zinc-500">Loading {year} elections…</div>:<div className="grid gap-4 lg:grid-cols-2">{visible.map(e=><Link key={e.id} to="/elections/$electionId/results" params={{electionId:e.id}} className="group rounded-2xl border border-zinc-800/70 bg-zinc-900/40 p-5 transition-all hover:-translate-y-0.5 hover:border-zinc-700 hover:bg-zinc-900/70"><div className="flex items-start justify-between gap-4"><div><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-600">{categoryOf(e.election_type)}</p><h3 className="mt-2 font-display text-lg font-semibold text-zinc-100">{typeLabel(e.election_type)}</h3><p className="mt-1 text-sm text-zinc-500">{e.name}</p></div><ArrowRight size={17} className="shrink-0 text-zinc-700 transition-transform group-hover:translate-x-1"/></div><div className="mt-5 flex flex-wrap gap-4 text-[11px] text-zinc-600"><span className="inline-flex items-center gap-1.5"><CalendarDays size={13}/>{dateLabel(e.election_date)}</span><span className="inline-flex items-center gap-1.5"><Layers3 size={13}/>{e.status||"recorded"}</span></div></Link>)}</div>}
    {!loading&&!visible.length&&<div className="rounded-2xl border border-dashed border-zinc-800/70 p-10 text-center text-sm text-zinc-600">No elections are recorded for this category in {year}.</div>}
  </section>;
}
