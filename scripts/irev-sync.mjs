const IREV_URL = "https://inecelectionresults.ng/";
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
}

const html = await (await fetch(IREV_URL)).text();
const rows = [];
const re = /<a\\b[^>]*href=["']([^"']+)["'][^>]*>([\\s\\S]*?)<\\/a>/gi;
const seen = new Set();
for (const m of html.matchAll(re)) {
  const name = m[2].replace(/<[^>]*>/g, " ").replace(/\\s+/g, " ").trim();
  const href = new URL(m[1].trim(), IREV_URL).toString();
  if (!name || !/election/i.test(name) || seen.has(href)) continue;
  seen.add(href);
  const date = name.match(/(\\d{4})-(\\d{2})-(\\d{2})/);
  rows.push({ external_id: href, name, election_type: classify(name), election_date: date ? date[0] : null, source_url: href, status: "active" });
}

const response = await fetch(SUPABASE_URL + "/rest/v1/elections?on_conflict=external_id", {
  method: "POST",
  headers: { apikey: SERVICE_KEY, Authorization: "Bearer " + SERVICE_KEY, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
  body: JSON.stringify(rows),
});
if (!response.ok) throw new Error("Supabase sync failed: HTTP " + response.status + " " + await response.text());
console.log(JSON.stringify({ synced: rows.length, syncedAt: new Date().toISOString() }, null, 2));

function classify(name) {
  if (/presidential/i.test(name)) return "presidential";
  if (/governorship/i.test(name)) return "governorship";
  if (/senatorial/i.test(name)) return "senatorial";
  if (/house of representatives/i.test(name)) return "house_of_representatives";
  if (/house of assemby|house of assembly/i.test(name)) return "house_of_assembly";
  if (/state constituency/i.test(name)) return "state_constituency";
  if (/chairmanship/i.test(name)) return "chairmanship";
  if (/councillor/i.test(name)) return "councillor";
  return "unknown";
}
