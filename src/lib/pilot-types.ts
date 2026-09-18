export type StageId = "understanding" | "exploring" | "evidence" | "planning" | "writing" | "reviewing" | "revising" | "verifying";
export type StepStatus = "pending" | "investigating" | "completed" | "warning";

// Legacy result values remain readable for stored sample runs. New runs only
// produce verification_unavailable because Pilot never executes target code.
export type VerificationResult = "verified" | "patch_applies_but_unverified" | "tests_failed" | "build_failed" | "patch_failed" | "verification_unavailable";
export type VerificationStage = { id: "workspace" | "patch" | "detect" | "build" | "test" | "issue"; name: string; status: "pending" | "running" | "passed" | "failed" | "skipped"; detail?: string; output?: string; durationMs?: number };
export type VerificationReport = {
  result: VerificationResult;
  verdictLabel: "VERIFIED FIX" | "PATCH PROPOSED — NOT VERIFIED" | "PATCH PROPOSED — NOT EXECUTED" | "PATCH FAILED VERIFICATION";
  workspace?: string;
  stages: VerificationStage[];
  commandsDetected?: { install?: string; build?: string; test?: string; lint?: string };
  issueVerificationDetail?: string;
  summary: string;
  durationMs: number;
  error?: string;
};

export type FileRole = "source" | "test" | "docs" | "config" | "generated" | "types";
export type RequirementType = "mustImplement" | "mustPreserve" | "mustTest" | "optionalDocs";
export type StructuredRequirement = { id: string; type: RequirementType; text: string; status: "unmapped" | "planned" | "implemented" | "tested" | "preserved" | "failed"; coveredByFiles?: string[]; reviewVerdict?: "pass" | "fail"; detail?: string };
export type Stage = { id: StageId; label: string; status: "pending" | "active" | "complete" | "skipped" | "failed"; elapsedMs?: number };
export type Activity = { id: string; stage: StageId; action: string; detail: string; elapsedMs: number; status: "completed" | "warning" };
export type Search = { id?: string; round?: number; query: string; matches: number; detail: string };
export type InspectedFile = { path: string; reason: string; finding: string; lines: number };
export type PatchOperation = "create" | "modify" | "delete";
export type PlanStep = { id: string; title: string; detail: string; paths?: string[]; operation?: PatchOperation; status: StepStatus; requirementsCovered?: string[] };
export type FileChange = { path: string; operation: PatchOperation; additions: number; deletions: number; diff: string; reason: string; role?: FileRole; requirementsCovered?: string[]; originalContent?: string | null; updatedContent?: string | null };
export type FileExplanation = { path: string; explanation: string; coverage: string[] };
export type EvidenceFile = { path: string; relevance: string; findings: string[]; symbols?: string[]; relationships?: string[] };
export type EvidenceReport = { decision: "continue" | "ready_to_patch" | "out_of_scope"; enoughEvidence: boolean; confidence: number; reason: string; evidence: EvidenceFile[]; additionalSearches: string[]; repeatSearches: string[]; missingEvidence?: import("./investigation").MissingEvidence[]; requiredCapability?: string };
export type Review = { status: "passed" | "warning"; verdict?: "approved" | "refused"; requirementsCovered?: boolean; unrelatedChanges?: boolean; likelySyntaxProblems?: boolean; apiBreakageRisk?: boolean; evidenceSupported?: boolean; feedback?: string[]; revisionCount?: number; requirementCoverage?: Record<string, "pass" | "fail">; checks: { label: string; status: "passed" | "warning" }[] };
export type RunError = { code: string; title: string; message: string; retryable?: boolean };
export type PatchVersion = { version: number; label: string; patch: string; files: FileChange[]; explanations: FileExplanation[]; reviewerFeedback?: string[]; createdMs: number };
export type PilotRun = {
  issueAnalysis?: import("./investigation").IssueAnalysis;
  issue: { number: number; title: string; repository: string; url: string };
  repository: { branch: string; language: string; public: true; url: string; commit?: string };
  source: "live" | "sample";
  status: "completed" | "needs-review" | "refused";
  summary: string;
  stages: Stage[];
  activity: Activity[];
  searches: Search[];
  inspectedFiles: InspectedFile[];
  plan: PlanStep[];
  files: FileChange[];
  explanations: FileExplanation[];
  review: Review;
  confidence: "high" | "medium" | "low";
  evidence?: EvidenceReport;
  refusal?: { kind: "out_of_scope" | "budget_exhausted" | "insufficient_evidence" | "planning_failed" | "patch_generation_failed"; title?: string; reason: string; suggestedNextStep: string; code?: string; missingEvidence?: import("./investigation").MissingEvidence[] };
  limitations: string[];
  metrics: { elapsedMs: number; filesIndexed: number; filesInspected: number; searches: number; explorationRounds: number; revisions: number; filesChanged: number; additions: number; deletions: number };
  patch: string;
  originalPatch?: string;
  revisedPatch?: string;
  finalPatch?: string;
  patchVersions?: PatchVersion[];
  verification?: VerificationReport;
  requirements?: StructuredRequirement[];
};
export type RunEvent =
  | { type: "context"; issue: PilotRun["issue"]; repository: PilotRun["repository"] }
  | { type: "stage"; stage: Stage }
  | { type: "activity"; activity: Activity }
  | { type: "search"; search: Search }
  | { type: "inspection"; inspection: InspectedFile }
  | { type: "evidence"; evidence: EvidenceReport }
  | { type: "requirements"; requirements: StructuredRequirement[] }
  | { type: "plan"; plan: PlanStep[] }
  | { type: "verification"; verification: VerificationReport }
  | { type: "completed"; run: PilotRun }
  | { type: "failed"; error: RunError; run?: PilotRun };
