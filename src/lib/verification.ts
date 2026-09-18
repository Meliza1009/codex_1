import "server-only";

import type { VerificationReport, VerificationStage } from "./pilot-types";

export type VerificationOptions = {
  repositoryUrl: string;
  branch: string;
  commit?: string;
  patch: string;
  issue: { number: number; title: string; repository: string; url: string };
  onStep?: (stage: VerificationStage, report: Partial<VerificationReport>) => void;
};

/**
 * Target repositories are untrusted input. Codex Pilot deliberately does not
 * clone them, apply patches, or execute their commands. Developers may use the
 * downloaded patch, captured revision, and review record for their own QA.
 */
export async function verifyPatch(options: VerificationOptions): Promise<VerificationReport> {
  const stage: VerificationStage = {
    id: "workspace",
    name: "Developer-side QA",
    status: "skipped",
    detail: "Codex Pilot does not execute target repository code.",
  };
  const report: VerificationReport = {
    result: "verification_unavailable",
    verdictLabel: "PATCH PROPOSED — NOT EXECUTED",
    stages: [stage],
    summary: `Patch execution was not performed. Apply the downloaded patch to ${options.repositoryUrl} at ${options.commit || options.branch} and run repository-defined QA in your approved developer environment.`,
    durationMs: 0,
  };
  options.onStep?.(stage, report);
  return report;
}
