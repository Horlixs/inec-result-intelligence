export type OfficialSourceKind = "calendar" | "guideline" | "candidate_list" | "press_release" | "result_portal" | "official_page";

export type OfficialSource = {
  kind: OfficialSourceKind;
  title: string;
  url: string;
  contentHash?: string;
  retrievedAt: string;
};

export function classifyOfficialSource(title: string, url: string): OfficialSourceKind {
  const value = (title + " " + url).toLowerCase();
  if (value.includes("calendar") || value.includes("timetable")) return "calendar";
  if (value.includes("guideline") || value.includes("regulation")) return "guideline";
  if (value.includes("candidate") || value.includes("nominated")) return "candidate_list";
  if (value.includes("press") || value.includes("statement")) return "press_release";
  if (value.includes("irev") || value.includes("result")) return "result_portal";
  return "official_page";
}

export function buildSourceSnapshot(title: string, url: string, contentHash: string, retrievedAt = new Date().toISOString()): OfficialSource {
  return { kind: classifyOfficialSource(title, url), title, url, contentHash, retrievedAt };
}
