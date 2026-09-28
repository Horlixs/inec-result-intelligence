const INEC_CALENDAR_URL = "https://inecnigeria.org/elections/calendar";
const INEC_GUIDELINES_URL = "https://inecnigeria.org/elections/guidelines";
const INEC_HOME = "https://inecnigeria.org/";
const IREV_URL = "https://inecelectionresults.ng/";

async function getHtml(url) {
  const r = await fetch(url, { headers: { accept: "text/html,application/xhtml+xml" } });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return r.text();
}

function links(html, origin) {
  const out = [];
  const seen = new Set();
  const re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const m of html.matchAll(re)) {
    const title = m[2].replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    if (!title) continue;
    const url = new URL(m[1], origin).toString();
    if (seen.has(url)) continue;
    seen.add(url);
    out.push({ title, url });
  }
  return out;
}

function hash(text) {
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))
    .then(bytes => [...new Uint8Array(bytes)].map(x => x.toString(16).padStart(2, "0")).join(""));
}

const [calendar, guidelines, home, irev] = await Promise.all([
  getHtml(INEC_CALENDAR_URL),
  getHtml(INEC_GUIDELINES_URL),
  getHtml(INEC_HOME),
  getHtml(IREV_URL),
]);

const sources = [
  { source_type: "official_inec", title: "INEC Election Calendar", url: INEC_CALENDAR_URL, content_hash: await hash(calendar), metadata: { family: "calendar" } },
  { source_type: "guideline", title: "INEC Election Regulations & Guidelines", url: INEC_GUIDELINES_URL, content_hash: await hash(guidelines), metadata: { family: "guidelines" } },
  { source_type: "official_inec", title: "INEC Official Website", url: INEC_HOME, content_hash: await hash(home), metadata: { family: "official" } },
  { source_type: "irev", title: "INEC IReV Result Viewing Portal", url: IREV_URL, content_hash: await hash(irev), metadata: { family: "results" } },
];

console.log(JSON.stringify({
  retrievedAt: new Date().toISOString(),
  sources,
  calendarLinks: links(calendar, INEC_CALENDAR_URL),
  guidelineLinks: links(guidelines, INEC_GUIDELINES_URL),
  irevLinks: links(irev, IREV_URL).filter(x => /election/i.test(x.title)),
}, null, 2));
