export type IRevElection = { id: string; name: string; href: string };

export type ResultSheetCandidate = { label: string; votes: number | null };

export type ExtractedResult = {
  pollingUnitName: string | null;
  pollingUnitCode: string | null;
  registeredVoters: number | null;
  accreditedVoters: number | null;
  rejectedVotes: number | null;
  candidates: ResultSheetCandidate[];
};

export const IREV_PUBLIC_ORIGIN = "https://inecelectionresults.ng";

export function normaliseSourceUrl(url: string): string {
  const parsed = new URL(url, IREV_PUBLIC_ORIGIN);
  if (parsed.protocol !== "https:") throw new Error("Only HTTPS source URLs are accepted.");
  return parsed.toString();
}

export function validateExtractedResult(result: ExtractedResult) {
  const issues: string[] = [];
  for (const candidate of result.candidates) {
    if (candidate.votes !== null && (!Number.isInteger(candidate.votes) || candidate.votes < 0)) {
      issues.push("Invalid vote value for " + candidate.label);
    }
  }
  if (result.registeredVoters !== null && result.accreditedVoters !== null && result.accreditedVoters > result.registeredVoters) {
    issues.push("Accredited voters exceed registered voters");
  }
  if (result.rejectedVotes !== null && result.rejectedVotes < 0) issues.push("Rejected votes cannot be negative");
  return { valid: issues.length === 0, issues };
}
