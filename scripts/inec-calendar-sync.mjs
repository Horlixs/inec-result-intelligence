const BASE="https://inecnigeria.org/elections/calendar";
const SUPABASE_URL=process.env.SUPABASE_URL;
const SERVICE_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY;
function strip(s){return s.replace(/<[^>]*>/g," ").replace(/&nbsp;/g," ").replace(/&amp;/g,"&").replace(/\\s+/g," ").trim()}
function dateOf(s){const m=s.match(/(January|February|March|April|May|June|July|August|September|October|November|December)\\s+\\d{1,2},\\s+\\d{4}/i);return m?new Date(m[0]).toISOString().slice(0,10):null}
function typeOf(s){const x=s.toLowerCase();if(x.includes("presidential"))return"presidential";if(x.includes("governorship"))return"governorship";if(x.includes("senatorial"))return"senatorial";if(x.includes("house of representatives"))return"house_of_representatives";if(x.includes("state constituency"))return"state_constituency";if(x.includes("federal constituency"))return"house_of_representatives";return"unknown"}
function slug(s){return s.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,180)}
const html=await (await fetch(BASE)).text();
const rows=[...html.matchAll(/<tr[\\s\\S]*?<\\/tr>/gi)].map(m=>[...m[0].matchAll(/<td[\\s\\S]*?<\\/td>/gi)].map(x=>strip(x[0]))).filter(r=>r.length>=2);
const records=[];
for(const cells of rows){const title=cells.find(x=>/election/i.test(x));const date=cells.find(x=>dateOf(x));if(!title||!date)continue;records.push({external_id:"inec-calendar:"+slug(title),name:title,election_type:typeOf(title),election_date:dateOf(date),source_url:BASE,status:"scheduled"})}
const unique=[...new Map(records.map(x=>[x.external_id,x])).values()];
console.log(JSON.stringify({source:BASE,discoveredAt:new Date().toISOString(),count:unique.length,elections:unique},null,2));
if(!SUPABASE_URL||!SERVICE_KEY)process.exit(0);
for(const e of unique){const res=await fetch(SUPABASE_URL+"/rest/v1/elections?on_conflict=external_id",{method:"POST",headers:{"apikey":SERVICE_KEY,"Authorization":"Bearer "+SERVICE_KEY,"Content-Type":"application/json","Prefer":"resolution=merge-duplicates,return=minimal"},body:JSON.stringify(e)});if(!res.ok)throw new Error("Supabase sync failed: "+res.status+" "+await res.text())}
console.error("Synced "+unique.length+" election records.");