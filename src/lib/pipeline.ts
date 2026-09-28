export type ProcessingStage = "discovered" | "downloaded" | "extracted" | "validated" | "pending_review" | "verified" | "rejected";

export type EvidenceRecord = {
  sourceUrl: string;
  sourceHash: string;
  storagePath: string;
  discoveredAt: string;
};

export function nextStage(stage: ProcessingStage, validationPassed: boolean): ProcessingStage {
  if (stage === "discovered") return "downloaded";
  if (stage === "downloaded") return "extracted";
  if (stage === "extracted") return validationPassed ? "validated" : "pending_review";
  if (stage === "validated") return "verified";
  return stage;
}
