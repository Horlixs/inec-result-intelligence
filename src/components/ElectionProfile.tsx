import { useEffect, useMemo, useState } from "react";
import { CalendarDays, ExternalLink, FileImage, MapPin, RefreshCw, Search, ShieldCheck, Users } from "lucide-react";
import { supabase } from "../lib/supabase";
import "../election-profile.css";

type Election = { id:string; name:string; election_type:string; election_date:string|null; source_url:string|null; status:string };
type Source = { id:string; title:string; url:string; source_type:string; published_at:string|null };
type Stats = { registered_voters:number|null; polling_units_expected:number|null; result_sheets_expected:number|null; result_sheets_uploaded:number|null; candidates_count:number|null; parties_count:number|null };

const CALENDAR="https://inecnigeria.org/elections/calendar";
const IREV="https://inecelectionresults.ng/";
const GUIDANCE="https://inecnigeria.org/voters/education";
const fmt=(v?:string|null)=>v?new Intl.DateTimeFormat("en-NG",{dateStyle:"medium"}).format(new Date(v)):"Not published";
const num=(v?:number|null)=>v==null?"—":new Intl.NumberFormat("en-NG").format(v);
const pct=(a?:number|null,b?:number|null)=>a&&b!=null?Math.min(100,Math.round(b/a*1000)/10):0;

export function ElectionProfile(){
 const [rows,setRows]=useState<Election[]>([]),[selected,setSelected]=useState(""),[sources,setSources]=useState<Source[]>([]),[stats,setStats]=useState<Stats|null>(null),[q,setQ]=useState(""),[tab,setTab]=useState("overview"),[loading,setLoading]=useState(true),[error,setError]=useState("");
 async function load(){
  setLoading(true);setError("");
  if(!supabase){setError("Supabase is not configured in this deployment.");setLoading(false);return}
  const r=await supabase.from("elections").select("id,name,election_type,election_date,source_url,status").order("election_date",{ascending:true});
  if(r.error){setError(r.error.message);setLoading(false);return}
  const data=(r.data||[]) as Election[];setRows(data);setSelected(x=>x||data[0]?.id||"");setLoading(false);
 }
 useEffect(()=>{void load()},[]);
 useEffect(()=>{
  if(!supabase||!selected)return;
  Promise.all([
   supabase.from("election_sources").select("id,title,url,source_type,published_at").eq("election_id",selected).order("published_at",{ascending:false}),
   supabase.from("election_statistics").select("registered_voters,polling_units_expected,result_sheets_expected,result_sheets_uploaded,candidates_count,parties_count").eq("election_id",selected).limit(1).maybeSingle()
  ]).then(([s,st])=>{setSources((s.data||[]) as Source[]);setStats((st.data||null) as Stats|null);if(s.error||st.error)setError("Some profile data could not be loaded.")});
 },[selected]);
 const filtered=useMemo(()=>rows.filter(x=>x.name.toLowerCase().includes(q.toLowerCase())),[rows,q]),e=rows.find(x=>x.id===selected);
 const tabs=["overview","candidates","timeline","polling","results","sources"];
 return <main className="profile-shell">
  <header className="profile-nav"><div className="profile-brand"><div className="profile-mark">IR</div><div><strong>INEC Result Intelligence</strong><span>Evidence-first election data</span></div></div><button className="refresh" onClick={()=>void load()}><RefreshCw size={15}/> Sync view</button></header>
  <section className="directory"><div className="directory-head"><div><span className="kicker">ELECTION INTELLIGENCE</span><h1>Election profiles.</h1><p>Official election metadata, candidate records, operational information and result evidence in one traceable view.</p></div><div className="directory-actions"><a href={CALENDAR} target="_blank" rel="noreferrer">INEC calendar <ExternalLink size={14}/></a><a href={IREV} target="_blank" rel="noreferrer">Open IReV <ExternalLink size={14}/></a></div></div>
   <div className="election-picker"><div className="searchbox"><Search size={17}/><input value={q} onChange={x=>setQ(x.target.value)} placeholder="Search elections..."/></div><div className="election-list">{loading?<div className="empty">Loading synchronized elections…</div>:filtered.length?filtered.map(x=><button className={x.id===selected?"election-row active":"election-row"} key={x.id} onClick={()=>{setSelected(x.id);setTab("overview")}}><span><strong>{x.name}</strong><small>{x.election_type} · {fmt(x.election_date)}</small></span></button>):<div className="empty">No synchronized elections found. Run the official-source sync to populate this directory.</div>}</div></div>
  </section>
  {error&&<div className="notice">{error}</div>}
  {e?<section className="profile"><div className="profile-heading"><div><span className="kicker">OFFICIAL ELECTION RECORD</span><h2>{e.name}</h2><div className="meta"><span><CalendarDays size={15}/>{fmt(e.election_date)}</span><span><MapPin size={15}/>Nigeria</span><span className="status-chip">{e.status||"scheduled"}</span></div></div>{e.source_url&&<a className="source-link" href={e.source_url} target="_blank" rel="noreferrer">Source <ExternalLink size={14}/></a>}</div>
   <nav className="tabs">{tabs.map(x=><button className={tab===x?"tab active":"tab"} key={x} onClick={()=>setTab(x)}>{x}</button>)}</nav>
   {tab==="overview"&&<div className="content-grid"><div className="hero-card"><span className="kicker">SOURCE STATUS</span><h3>Evidence stays attached to the number.</h3><p>Original source documents remain the evidence layer. Extracted values, validations and analytics are derived records.</p><div className="source-row"><a href={IREV} target="_blank" rel="noreferrer"><FileImage size={17}/> IReV result portal</a><a href={CALENDAR} target="_blank" rel="noreferrer"><CalendarDays size={17}/> Official calendar</a></div></div><div className="stat-grid"><div className="stat"><Users size={17}/><span>Registered voters</span><strong>{num(stats?.registered_voters)}</strong></div><div className="stat"><MapPin size={17}/><span>Polling units</span><strong>{num(stats?.polling_units_expected)}</strong></div><div className="stat"><ShieldCheck size={17}/><span>Candidate records</span><strong>{num(stats?.candidates_count)}</strong></div><div className="stat"><Users size={17}/><span>Parties</span><strong>{num(stats?.parties_count)}</strong></div></div></div>}
   {tab==="polling"&&<div className="content-grid"><div className="hero-card"><span className="kicker">POLLING OPERATIONS</span><h3>Official operating guidance</h3><p>Current INEC guidance covers polling-unit opening, accreditation, voting and BVAS verification.</p><a className="source-link" href={GUIDANCE} target="_blank" rel="noreferrer">View INEC guidance <ExternalLink size={14}/></a></div><div className="stat-grid"><div className="stat"><span>General polling window</span><strong>08:30–14:30</strong></div><div className="stat"><span>Verification</span><strong>PVC + BVAS</strong></div><div className="stat"><span>Expected units</span><strong>{num(stats?.polling_units_expected)}</strong></div><div className="stat"><span>Result sheets</span><strong>{num(stats?.result_sheets_expected)}</strong></div></div></div>}
   {tab==="results"&&<div className="result-card"><span className="kicker">RESULT EVIDENCE</span><h3>IReV result-sheet coverage</h3><div className="coverage"><strong>{pct(stats?.result_sheets_expected,stats?.result_sheets_uploaded)}%</strong><div><div className="bar"><span style={{width:pct(stats?.result_sheets_expected,stats?.result_sheets_uploaded)+"%"}}/></div><small>{num(stats?.result_sheets_uploaded)} of {num(stats?.result_sheets_expected)} sheets recorded in synchronized statistics.</small></div></div></div>}
   {(tab==="sources"||tab==="candidates"||tab==="timeline")&&<div className="table-card"><span className="kicker">{tab.toUpperCase()}</span><h3>{tab==="sources"?"Official source registry":tab==="candidates"?"Candidate records":"Election timeline"}</h3>{tab==="sources"&&sources.length?<div className="table">{sources.map(s=><a className="table-row link-row" key={s.id} href={s.url} target="_blank" rel="noreferrer"><strong>{s.title}</strong><span>{s.source_type} · {fmt(s.published_at)}</span><ExternalLink size={15}/></a>)}</div>:<div className="empty">No synchronized {tab} records yet.</div>}</div>}
  </section>:<section className="empty-state"><div className="profile-mark">IR</div><h2>Connect the official source.</h2><p>{error||"Run the INEC source sync to create the first election records."}</p><code>npm run inec:sync</code></section>}
 </main>
}
