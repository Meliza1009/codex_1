export type StageId = "understanding" | "exploring" | "evidence" | "planning" | "writing" | "reviewing" | "revising" | "verifying";
export type StepStatus = "pending" | "investigating" | "completed" | "warning";

export type VerificationResult =
  | "verified"
  | "patch_applies_but_unverified"
  | "tests_failed"
  | "build_failed"
  | "patch_failed"
  | "verification_unavailable";

export type VerificationStage = {
  id: "workspace" | "patch" | "detect" | "build" | "test" | "issue";
  name: string;
  status: "pending" | "running" | "passed" | "failed" | "skipped";
  detail?: string;
  output?: string;
  durationMs?: number;
};

export type VerificationReport = {
  result: VerificationResult;
  verdictLabel: "VERIFIED FIX" | "PATCH PROPOSED — NOT VERIFIED" | "PATCH FAILED VERIFICATION";
  workspace?: string;
  stages: VerificationStage[];
  commandsDetected?: {
    install?: string;
    build?: string;
    test?: string;
    lint?: string;
  };
  issueVerificationDetail?: string;
  summary: string;
  durationMs: number;
  error?: string;
};

export type Stage = { id: StageId; label: string; status: "pending" | "active" | "complete" | "skipped" | "failed"; elapsedMs?: number };
export type Activity = { id: string; stage: StageId; action: string; detail: string; elapsedMs: number; status: "completed" | "warning" };
export type Search = { id?: string; round?: number; query: string; matches: number; detail: string };
export type InspectedFile = { path: string; reason: string; finding: string; lines: number };
export type PlanStep = { id: string; title: string; detail: string; paths?: string[]; status: StepStatus };
export type FileChange = { path: string; additions: number; deletions: number; diff: string; reason: string };
export type FileExplanation = { path: string; explanation: string; coverage: string[] };
export type EvidenceFile = { path: string; relevance: string; findings: string[]; symbols?: string[]; relationships?: string[] };
export type EvidenceReport = { decision: "continue" | "ready_to_patch" | "out_of_scope"; enoughEvidence: boolean; confidence: number; reason: string; evidence: EvidenceFile[]; additionalSearches: string[]; repeatSearches: string[]; missingEvidence?: import("./investigation").MissingEvidence[]; requiredCapability?: string };
export type Review = { status: "passed" | "warning"; verdict?: "approved" | "refused"; requirementsCovered?: boolean; unrelatedChanges?: boolean; likelySyntaxProblems?: boolean; apiBreakageRisk?: boolean; evidenceSupported?: boolean; feedback?: string[]; revisionCount?: number; checks: { label: string; status: "passed" | "warning" }[] };
export type RunError = { code: string; title: string; message: string; retryable?: boolean };

export type PilotRun = {
  issueAnalysis?: import("./investigation").IssueAnalysis;
  issue: { number: number; title: string; repository: string; url: string };
  repository: { branch: string; language: string; public: true; url: string };
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
  refusal?: { kind: "out_of_scope" | "budget_exhausted" | "insufficient_evidence"; reason: string; suggestedNextStep: string; code?: string; missingEvidence?: import("./investigation").MissingEvidence[] };
  limitations: string[];
  metrics: { elapsedMs: number; filesIndexed: number; filesInspected: number; searches: number; explorationRounds: number; revisions: number; filesChanged: number; additions: number; deletions: number };
  patch: string;
  verification?: VerificationReport;
};

export type RunEvent =
  | { type: "context"; issue: PilotRun["issue"]; repository: PilotRun["repository"] }
  | { type: "stage"; stage: Stage }
  | { type: "activity"; activity: Activity }
  | { type: "search"; search: Search }
  | { type: "inspection"; inspection: InspectedFile }
  | { type: "evidence"; evidence: EvidenceReport }
  | { type: "plan"; plan: PlanStep[] }
  | { type: "verification"; verification: VerificationReport }
  | { type: "completed"; run: PilotRun }
  | { type: "failed"; error: RunError; run?: PilotRun };
