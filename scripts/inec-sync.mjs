const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");

const CALENDAR = "https://inecnigeria.org/elections/calendar";
const GUIDELINES = "https://inecnigeria.org/elections/guidelines";
const VOTER_EDUCATION = "https://inecnigeria.org/voters/education";
const IREV = "https://inecelectionresults.ng/";

async function fetchText(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${url}`);
  return r.text();
}
function clean(value) { return value.replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim(); }
function hash(text) {
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))
    .then(b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join(""));
}
function source(title, url, html, type) {
  return hash(html).then(content_hash => ({ title, url, content_hash, source_type: type, retrieved_at: new Date().toISOString() }));
}
function findElectionNames(html) {
  const names = new Set();
  const re = /(?:Election Title|election-title)[\s\S]{0,1500}?<[^>]*>([^<]{10,220}(?:Election|Bye-Election)[^<]*)<\/[^>]+>/gi;
  for (const m of html.matchAll(re)) names.add(clean(m[1]));
  return [...names];
}
function findLinks(html, origin) {
  const out=[]; const re=/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const m of html.matchAll(re)) {
    const title=clean(m[2]); if (!title) continue;
    let url; try { url=new URL(m[1],origin).toString(); } catch { continue; }
    if (/candidate|election|timetable|calendar|result|guideline|procedure/i.test(title+" "+url)) out.push({title,url});
  }
  return out;
}
async function upsert(path, body) {
  const r = await fetch(SUPABASE_URL + "/rest/v1/" + path, {
    method: "POST",
    headers: { apikey: SERVICE_KEY, Authorization: "Bearer "+SERVICE_KEY, "Content-Type":"application/json", Prefer:"resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error("Supabase "+path+" failed: "+await r.text());
}

const [calendar, guidelines, voterEducation, irev] = await Promise.all([fetchText(CALENDAR), fetchText(GUIDELINES), fetchText(VOTER_EDUCATION), fetchText(IREV)]);
const now = new Date().toISOString();
const sources = await Promise.all([
  source("INEC Election Calendar", CALENDAR, calendar, "official_inec"),
  source("INEC Election Regulations & Guidelines", GUIDELINES, guidelines, "guideline"),
  source("INEC Voter Education & Guidelines", VOTER_EDUCATION, voterEducation, "official_inec"),
  source("INEC IReV Result Viewing Portal", IREV, irev, "irev"),
]);
await upsert("election_sources", sources);

const discovered = findLinks(calendar, CALENDAR);
console.log(JSON.stringify({
  retrievedAt: now,
  sourceCount: sources.length,
  electionNames: findElectionNames(calendar),
  relevantLinks: discovered,
  operatingRule: { ruleKey:"general_polling_hours", ruleName:"General polling hours", value:{ opens:"08:30", closes:"14:30", timezone:"Africa/Lagos", queue_rule:"voters already on queue by 14:30 may vote" } }
}, null, 2));
