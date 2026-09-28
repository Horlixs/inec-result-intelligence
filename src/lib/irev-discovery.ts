import {
  classifyElection,
  extractElectionLinks,
  normaliseElectionHref,
  parseElectionDate,
  parseElectionLocation,
  type DiscoveredElection,
} from "./election-catalog";

export const IREV_ELECTIONS_URL = "https://inecelectionresults.ng/";

export async function discoverIRevElections(
  fetcher: typeof fetch = fetch,
): Promise<DiscoveredElection[]> {
  const response = await fetcher(IREV_ELECTIONS_URL, {
    headers: { accept: "text/html,application/xhtml+xml" },
  });
  if (!response.ok) {
    throw new Error(`IReV discovery failed: HTTP ${response.status}`);
  }

  const html = await response.text();
  return extractElectionLinks(html).map(({ name, href }) => {
    const absoluteHref = normaliseElectionHref(href, IREV_ELECTIONS_URL);
    const date = parseElectionDate(name);
    return {
      name,
      href: absoluteHref,
      source: "irev" as const,
      category: classifyElection(name),
      electionDate: date,
      location: parseElectionLocation(name),
      externalId: extractExternalId(absoluteHref),
    };
  });
}

function extractExternalId(href: string): string | null {
  try {
    const url = new URL(href);
    const parts = url.pathname.split("/").filter(Boolean);
    const id = parts.at(-1);
    return id && /^[a-z0-9_-]{6,}$/i.test(id) ? id : null;
  } catch {
    return null;
  }
}

export function dedupeElections(
  elections: DiscoveredElection[],
): DiscoveredElection[] {
  const seen = new Map<string, DiscoveredElection>();
  for (const election of elections) {
    const key = election.externalId ?? election.href;
    if (!seen.has(key)) seen.set(key, election);
  }
  return [...seen.values()];
}
