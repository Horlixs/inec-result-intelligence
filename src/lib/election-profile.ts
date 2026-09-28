export type ElectionProfileTab = "overview" | "candidates" | "timeline" | "polling" | "results" | "sources" | "updates";

export type ElectionProfile = {
  id: string;
  name: string;
  category: string;
  electionDate?: string;
  status: string;
  jurisdiction?: string;
  candidatesCount?: number;
  partiesCount?: number;
  pollingUnitsExpected?: number;
  resultSheetsExpected?: number;
  resultSheetsUploaded?: number;
  registeredVoters?: number;
};

export const ELECTION_PROFILE_TABS: ElectionProfileTab[] = ["overview", "candidates", "timeline", "polling", "results", "sources", "updates"];

export function resultSheetCoverage(expected = 0, uploaded = 0): number {
  if (expected <= 0) return 0;
  return Math.min(100, Math.round((uploaded / expected) * 1000) / 10);
}

export function electionStatus(electionDate?: string): "upcoming" | "today" | "completed" | "unknown" {
  if (!electionDate) return "unknown";
  const day = new Date(electionDate + "T00:00:00+01:00");
  const now = new Date();
  const today = new Date(now.toLocaleString("en-US", { timeZone: "Africa/Lagos" }));
  today.setHours(0, 0, 0, 0);
  day.setHours(0, 0, 0, 0);
  if (day.getTime() === today.getTime()) return "today";
  return day > today ? "upcoming" : "completed";
}
