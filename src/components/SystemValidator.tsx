import { useState } from "react";
import { CheckCircle2, Loader2, ShieldCheck, XCircle } from "lucide-react";
import { supabase } from "../lib/supabase";
import { validateExtractedResult } from "../lib/irev";

export function SystemValidator(){
 const [running,setRunning]=useState(false),[result,setResult]=useState<{checked:number;passed:number;failed:number;issues:string[]}|null>(null);
 async function run(){
  if(!supabase){setResult({checked:0,passed:0,failed:1,issues:["Supabase is not configured."]});return}
  setRunning(true);setResult(null);
  const {data:sheets,error}=await supabase.from("result_sheets").select("id,election_id,source_url,source_hash");
  if(error){setResult({checked:0,passed:0,failed:1,issues:[error.message]});setRunning(false);return}
  const issues:string[]=[];let passed=0;
  for(const sheet of sheets||[]){
   let ok=true;
   if(!sheet.source_url||!/^https:\/\//i.test(sheet.source_url)){issues.push(sheet.id+": invalid source URL");ok=false}
   if(!sheet.source_hash){issues.push(sheet.id+": missing SHA-256 source hash");ok=false}
   const {data:extractions}=await supabase.from("extractions").select("id,raw_output,confidence").eq("result_sheet_id",sheet.id);
   if(!extractions?.length){issues.push(sheet.id+": no extraction recorded");ok=false}
   for(const ex of extractions||[]){
    if(ex.confidence!=null&&(ex.confidence<0||ex.confidence>1)){issues.push(ex.id+": confidence outside 0–1");ok=false}
    const raw=ex.raw_output as any;
    if(Array.isArray(raw?.candidates)){
     const checked=validateExtractedResult({pollingUnitName:raw.pollingUnitName??null,pollingUnitCode:raw.pollingUnitCode??null,registeredVoters:raw.registeredVoters==null?null:Number(raw.registeredVoters),accreditedVoters:raw.accreditedVoters==null?null:Number(raw.accreditedVoters),rejectedVotes:raw.rejectedVotes==null?null:Number(raw.rejectedVotes),candidates:raw.candidates.map((c:any)=>({label:String(c.label??""),votes:c.votes==null?null:Number(c.votes)}))});
     if(!checked.valid){issues.push(...checked.issues.map(x=>ex.id+": "+x));ok=false}
    }
   }
   if(ok)passed++;
  }
  setResult({checked:(sheets||[]).length,passed,failed:(sheets||[]).length-passed,issues:issues.slice(0,50)});setRunning(false);
 }
 return <div style={{position:"fixed",right:22,bottom:22,zIndex:20}}>
  <button onClick={()=>void run()} disabled={running} style={{display:"inline-flex",alignItems:"center",gap:8,padding:"12px 15px",borderRadius:12,border:"1px solid #303844",background:"#f3f5f7",color:"#080b10",fontWeight:700,cursor:"pointer"}}>{running?<><Loader2 size={16}/> Validating…</>:<><ShieldCheck size={16}/> Validate data</>}</button>
  {result&&<div style={{position:"absolute",right:0,bottom:52,width:340,maxHeight:360,overflow:"auto",padding:18,border:"1px solid #303844",borderRadius:14,background:"#0d1117",boxShadow:"0 20px 60px #0008"}}><div style={{display:"flex",gap:9,alignItems:"center"}}>{result.failed?<XCircle color="#ef8d8d"/>:<CheckCircle2 color="#72e0a2"/>}<b>{result.failed?"Validation needs review":"Validation passed"}</b></div><p style={{fontSize:12,color:"#7f8995"}}>{result.passed}/{result.checked} result sheets passed.</p>{result.issues.length>0&&<ul style={{fontSize:11,color:"#cdb98d",lineHeight:1.6}}>{result.issues.map((x,i)=><li key={i}>{x}</li>)}</ul>}</div>}
 </div>
}