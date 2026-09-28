export type ElectionCategory =
  | "presidential" | "governorship" | "senatorial" | "house_of_representatives"
  | "house_of_assembly" | "state_constituency" | "chairmanship" | "councillor" | "unknown";

export type DiscoveredElection = {
  name: string;
  href: string;
  source: "irev";
  category: ElectionCategory;
  electionDate: string | null;
  location: string | null;
  externalId: string | null;
};

const CATEGORY_RULES: Array<[ElectionCategory, RegExp]> = [
  ["presidential", /presidential/i],
  ["governorship", /governorship/i],
  ["senatorial", /senatorial/i],
  ["house_of_representatives", /house of representatives/i],
  ["house_of_assembly", /house of assemby|house of assembly/i],
  ["state_constituency", /state constituency/i],
  ["chairmanship", /chairmanship/i],
  ["councillor", /councillor/i],
];

export function classifyElection(name: string): ElectionCategory {
  return CATEGORY_RULES.find(([, pattern]) => pattern.test(name))?.[0] ?? "unknown";
}

export function parseElectionDate(name: string): string | null {
  const match = name.match(/(\d{4})-(\d{2})-(\d{2})/);
  return match ? match.slice(1).join("-") : null;
}

export function parseElectionLocation(name: string): string | null {
  const parts = name.split("-").map((part) => part.trim()).filter(Boolean);
  return parts.length >= 3 ? parts.slice(2).join(" - ") : null;
}

export function normaliseElectionHref(href: string, origin: string): string {
  return new URL(href, origin).toString();
}
