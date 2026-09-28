export type CandidateInput = {
  fullName: string;
  party?: string;
  position?: string;
  constituency?: string;
  ballotOrder?: number;
  status?: string;
  photoUrl?: string;
};

export function normalizeCandidateName(name: string): string {
  return name.replace(/\s+/g, " ").replace(/\s*,\s*/g, ", ").trim();
}

export function normalizeCandidate(input: CandidateInput): CandidateInput {
  return {
    ...input,
    fullName: normalizeCandidateName(input.fullName),
    party: input.party?.replace(/\s+/g, " ").trim(),
    position: input.position?.replace(/\s+/g, " ").trim(),
    constituency: input.constituency?.replace(/\s+/g, " ").trim(),
  };
}
