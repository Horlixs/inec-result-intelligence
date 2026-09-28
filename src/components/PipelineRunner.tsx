import { useState } from "react";
import { CheckCircle2, Loader2, Play, XCircle } from "lucide-react";
import { supabase } from "../lib/supabase";

export function PipelineRunner(){
 const [running,setRunning]=useState(false),[message,setMessage]=useState(""),[error,setError]=useState(false);
 async function run(){
  setRunning(true);setMessage("Connecting to IReV…");setError(false);
  try {
   if(!supabase) throw new Error("Supabase is not configured.");
   const response=await fetch("https://inecelectionresults.ng/");
   if(!response.ok) throw new Error("IReV returned HTTP "+response.status);
   const html=await response.text();
   const links=[...html.matchAll(/<a[^>]+href=["\x27]([^"\x27]+)["\x27][^>]*>([\\s\\S]*?)<\\/a>/gi)].map(m=>({href:new URL(m[1],location.origin).toString(),name:m[2].replace(/<[^>]*>/g," ").replace(/\\s+/g," ").trim()})).filter(x=>/inecelectionresults\\.ng\\/elections\\//i.test(x.href)&&x.name.length>5);
   if(!links.length) throw new Error("IReV did not expose election links to the browser. The server-side collector is required for this source.");
   setMessage("Registering discovered elections…");
   const type=(x:string)=>{x=x.toLowerCase();if(x.includes("presidential"))return"presidential";if(x.includes("governorship"))return"governorship";if(x.includes("senatorial"))return"senatorial";if(x.includes("representatives"))return"house_of_representatives";if(x.includes("assembly")||x.includes("assemby")||x.includes("constituency"))return"state_constituency";if(x.includes("chairmanship"))return"chairmanship";if(x.includes("councillor"))return"councillor";return"unknown"};
   const data=[...new Map(links.map(x=>{const id="irev:"+x.href.replace(/^https:\/\/inecelectionresults\.ng\//,"").replace(/[^a-zA-Z0-9]+/g,"-").slice(0,180);return[id,{external_id:id,name:x.name,election_type:type(x.name),election_date:(x.name.match(/\\d{4}-\\d{2}-\\d{2}/)||[])[0]||null,source_url:x.href,status:"discovered"}]})).values()];
   const saved=await supabase.from("elections").upsert(data,{onConflict:"external_id"});
   if(saved.error) throw saved.error;
   setMessage("Done — "+data.length+" IReV election records discovered and synchronized. Now run Validate data.");
  } catch(e){setError(true);setMessage(e instanceof Error?e.message:String(e))}
  finally{setRunning(false)}
 }
 return <div style={{position:"fixed",left:22,bottom:22,zIndex:20}}>
  <button onClick={()=>void run()} disabled={running} style={{display:"inline-flex",alignItems:"center",gap:8,padding:"12px 15px",borderRadius:12,border:"1px solid #303844",background:"#11161d",color:"#edf2f7",fontWeight:700}}>{running?<><Loader2 size={16}/> Running…</>:<><Play size={16}/> Run pipeline</>}</button>
  {message&&<div style={{marginTop:10,width:360,padding:16,border:"1px solid #303844",borderRadius:14,background:"#0d1117",color:"#dce2e7",fontSize:12}}>{error?<XCircle size={16}/>:!running?<CheckCircle2 size={16}/>:<Loader2 size={16}/>} {message}</div>}
 </div>
}