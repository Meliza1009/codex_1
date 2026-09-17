export type StageId = "understanding" | "exploring" | "planning" | "writing" | "reviewing";
export type StepStatus = "pending" | "investigating" | "completed" | "warning";

export type Stage = { id: StageId; label: string; status: StepStatus; elapsedMs?: number };
export type Activity = { id: string; stage: StageId; action: string; detail: string; elapsedMs: number; status: "completed" | "warning" };
export type Search = { query: string; matches: number; detail: string };
export type InspectedFile = { path: string; reason: string; finding: string; lines: number };
export type PlanStep = { id: string; title: string; detail: string; status: StepStatus };
export type FileChange = { path: string; additions: number; deletions: number; diff: string; reason: string };
export type FileExplanation = { path: string; explanation: string; coverage: string[] };
export type Review = { status: "passed" | "warning"; checks: { label: string; status: "passed" | "warning" }[] };
export type RunError = { code: string; title: string; message: string; retryable?: boolean };

export type PilotRun = {
  issue: { number: number; title: string; repository: string; url: string };
  repository: { branch: string; language: string; public: true; url: string };
  source: "live" | "sample";
  status: "completed" | "needs-review";
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
  limitations: string[];
  metrics: { elapsedMs: number; filesIndexed: number; filesInspected: number; searches: number; filesChanged: number; additions: number; deletions: number };
  patch: string;
};

export type RunEvent =
  | { type: "context"; issue: PilotRun["issue"]; repository: PilotRun["repository"] }
  | { type: "stage"; stage: Stage }
  | { type: "activity"; activity: Activity }
  | { type: "search"; search: Search }
  | { type: "inspection"; inspection: InspectedFile }
  | { type: "plan"; plan: PlanStep[] }
  | { type: "completed"; run: PilotRun }
  | { type: "failed"; error: RunError };
