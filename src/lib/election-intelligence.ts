export type ElectionSource = {
  id: string;
  title: string;
  url: string;
  sourceType: "official_inec" | "irev" | "candidate_list" | "timetable" | "guideline" | "press_release" | "other";
  publishedAt?: string;
  retrievedAt?: string;
  contentHash?: string;
};

export type ElectionTimelineItem = {
  activityKey: string;
  activityName: string;
  description?: string;
  startsAt?: string;
  endsAt?: string;
  timezone: string;
  status: "scheduled" | "ongoing" | "completed" | "revised" | "cancelled";
  sourceId?: string;
};

export type CandidateRecord = {
  id: string;
  fullName: string;
  party?: string;
  position?: string;
  constituency?: string;
  ballotOrder?: number;
  status: "published" | "nominated" | "substituted" | "withdrawn" | "disqualified" | "deceased" | "unknown";
  photoUrl?: string;
  sourceId?: string;
};

export type OperatingRule = {
  ruleKey: string;
  ruleName: string;
  value: unknown;
  effectiveFrom?: string;
  effectiveTo?: string;
  sourceId?: string;
};

export type ElectionIntelligence = {
  electionId: string;
  sources: ElectionSource[];
  timeline: ElectionTimelineItem[];
  candidates: CandidateRecord[];
  operatingRules: OperatingRule[];
};

export const DEFAULT_INEC_SOURCE = "https://www.inecnigeria.org/";
export const IREV_SOURCE = "https://inecelectionresults.ng/";

export function sourceLabel(type: ElectionSource["sourceType"]): string {
  return type === "irev" ? "IReV" : type === "candidate_list" ? "Candidate list" : type === "timetable" ? "Timetable" : "INEC official";
}
