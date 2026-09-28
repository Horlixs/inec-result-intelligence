export type ExtractedResult = {
  candidateVotes: Record<string, number>;
  accreditedVoters?: number;
  totalVotesCast?: number;
  rejectedVotes?: number;
};

export type ValidationIssue = { code: string; message: string; severity: "error" | "warning" };

export function validateResult(result: ExtractedResult): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const votes = Object.values(result.candidateVotes).reduce((sum, value) => sum + value, 0);
  if (Object.values(result.candidateVotes).some((v) => !Number.isInteger(v) || v < 0)) {
    issues.push({ code: "INVALID_VOTE_VALUE", message: "Candidate vote counts must be non-negative integers.", severity: "error" });
  }
  if (result.totalVotesCast != null && votes > result.totalVotesCast) {
    issues.push({ code: "CANDIDATE_TOTAL_EXCEEDS_CAST", message: "Candidate vote total exceeds total votes cast.", severity: "error" });
  }
  if (result.accreditedVoters != null && result.totalVotesCast != null && result.totalVotesCast > result.accreditedVoters) {
    issues.push({ code: "CAST_EXCEEDS_ACCREDITED", message: "Total votes cast exceeds accredited voters.", severity: "error" });
  }
  if (result.rejectedVotes != null && result.rejectedVotes < 0) {
    issues.push({ code: "INVALID_REJECTED_VOTES", message: "Rejected votes cannot be negative.", severity: "error" });
  }
  return issues;
}
