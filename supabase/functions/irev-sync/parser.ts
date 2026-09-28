export type DiscoveredElection = {
  external_id: string;
  name: string;
  election_type: string;
  election_date: string | null;
  source_url: string;
  status: string;
};

export function classifyElection(name: string): string {
  const value = name.toLowerCase();
  if (value.includes("presidential")) return "presidential";
  if (value.includes("governorship")) return "governorship";
  if (value.includes("senatorial")) return "senatorial";
  if (value.includes("representatives")) return "house_of_representatives";
  if (value.includes("assembly") || value.includes("assemby") || value.includes("constituency")) return "state_constituency";
  if (value.includes("chairmanship")) return "chairmanship";
  if (value.includes("councillor")) return "councillor";
  return "unknown";
}

function stripTags(value: string): string {
  return value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

export function discoverFromHtml(html: string, origin = "https://inecelectionresults.ng"): DiscoveredElection[] {
  const pattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const found = new Map<string, DiscoveredElection>();
  for (const match of html.matchAll(pattern)) {
    const href = match[1];
    const name = stripTags(match[2]);
    if (!name || !/elections\//i.test(href)) continue;
    const sourceUrl = new URL(href, origin).toString();
    const externalId = "irev:" + sourceUrl.replace(/^https:\/\/inecelectionresults\.ng\//, "").replace(/[^a-zA-Z0-9]+/g, "-").slice(0, 180);
    const date = name.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? null;
    found.set(externalId, {
      external_id: externalId,
      name,
      election_type: classifyElection(name),
      election_date: date,
      source_url: sourceUrl,
      status: "discovered",
    });
  }
  return [...found.values()];
}