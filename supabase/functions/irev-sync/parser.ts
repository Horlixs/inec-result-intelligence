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
  return value.replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/\s+/g, " ").trim();
}

function toElectionUrl(href: string, origin: string): string | null {
  try {
    const url = new URL(href, origin);
    if (url.origin !== origin || url.protocol !== "https:") return null;
    if (!url.pathname.toLowerCase().startsWith("/elections/")) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function externalIdFor(sourceUrl: string): string {
  return "irev:" + sourceUrl
    .replace(/^https:\/\/inecelectionresults\.ng\//, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .slice(0, 180);
}

function electionFromLink(href: string, label: string, origin: string): DiscoveredElection | null {
  const sourceUrl = toElectionUrl(href, origin);
  if (!sourceUrl) return null;

  const name = label || "IReV election " + new URL(sourceUrl).pathname.split("/")[2];
  const date = name.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? null;

  return {
    external_id: externalIdFor(sourceUrl),
    name,
    election_type: classifyElection(name),
    election_date: date,
    source_url: sourceUrl,
    status: "discovered",
  };
}

export function discoverFromHtml(html: string, origin = "https://inecelectionresults.ng"): DiscoveredElection[] {
  const found = new Map<string, DiscoveredElection>();
  const pattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

  for (const match of html.matchAll(pattern)) {
    const election = electionFromLink(match[1], stripTags(match[2]), origin);
    if (election) found.set(election.external_id, election);
  }

  // Some IReV pages expose routes inside serialized state/scripts rather than
  // ordinary anchor tags. Capture those routes as a second, anchor-independent
  // discovery path.
  const routePattern = /(?:https?:\\/\\/inecelectionresults\\.ng)?(\\/elections\\/[A-Za-z0-9_-]+(?:[?][^"'\\s<>\\\\]*)?)/gi;
  for (const match of html.matchAll(routePattern)) {
    const election = electionFromLink(match[1], "", origin);
    if (election && !found.has(election.external_id)) found.set(election.external_id, election);
  }

  return [...found.values()];
}

export function extractSameOriginLinks(html: string, origin = "https://inecelectionresults.ng"): string[] {
  const links = new Set<string>();
  const pattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi;

  for (const match of html.matchAll(pattern)) {
    try {
      const url = new URL(match[1], origin);
      if (url.origin === origin && url.protocol === "https:") links.add(url.toString());
    } catch {
      // ignore malformed URLs
    }
  }

  return [...links];
}
