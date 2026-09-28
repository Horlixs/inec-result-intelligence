const ORIGIN = "https://inecelectionresults.ng/";

const CATEGORY_RULES = [
  ["presidential", /presidential/i],
  ["governorship", /governorship/i],
  ["senatorial", /senatorial/i],
  ["house_of_representatives", /house of representatives/i],
  ["house_of_assembly", /house of assemby|house of assembly/i],
  ["state_constituency", /state constituency/i],
  ["chairmanship", /chairmanship/i],
  ["councillor", /councillor/i],
];

function classify(name) { return CATEGORY_RULES.find(([, r]) => r.test(name))?.[0] ?? "unknown"; }
function dateOf(name) { const m = name.match(/(\\d{4})-(\\d{2})-(\\d{2})/); return m ? m.slice(1).join("-") : null; }
function locationOf(name) { const p = name.split("-").map(x => x.trim()).filter(Boolean); return p.length >= 3 ? p.slice(2).join(" - ") : null; }
function links(html) {
  const out=[]; const seen=new Set();
  const re=/<a\\b[^>]*href=["']([^"']+)["'][^>]*>([\\s\\S]*?)<\\/a>/gi;
  for (const m of html.matchAll(re)) {
    const name=m[2].replace(/<[^>]*>/g," ").replace(/\\s+/g," ").trim();
    const href=m[1].trim(); if (!name || !href || !/election/i.test(name)) continue;
    const key=href+"|"+name; if (seen.has(key)) continue; seen.add(key); out.push({name,href:new URL(href,ORIGIN).toString()});
  }
  return out;
}

const response=await fetch(ORIGIN,{headers:{accept:"text/html,application/xhtml+xml"}});
if(!response.ok) throw new Error("IReV discovery failed: HTTP "+response.status);
const html=await response.text();
const elections=links(html).map(({name,href})=>({name,href,source:"irev",category:classify(name),electionDate:dateOf(name),location:locationOf(name)}));
console.log(JSON.stringify({source:"IReV",discoveredAt:new Date().toISOString(),count:elections.length,elections},null,2));
