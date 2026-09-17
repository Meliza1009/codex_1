import "server-only";

import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Activity, FileChange, FileExplanation, InspectedFile, PilotRun, PlanStep, Review, RunError, RunEvent, Search, Stage, StageId } from "@/lib/pilot-types";

type GithubIssue = { number: number; title: string; body: string | null; comments: number; html_url: string; state: "open" | "closed"; pull_request?: unknown };
type GithubRepo = { full_name: string; default_branch: string; size: number; archived: boolean; disabled: boolean; html_url: string; private: boolean };
type TreeItem = { path: string; type: "blob" | "tree"; size?: number };
type Candidate = { path: string; content: string; reason: string };
type Proposal = { summary?: string; plan?: { title?: string; detail?: string }[]; edits?: { path?: string; content?: string; reason?: string }[]; explanations?: { path?: string; explanation?: string; coverage?: string[] }[]; confidence?: "high" | "medium" | "low"; limitations?: string[] };
type ReviewerResponse = { verdict?: "passed" | "warning"; checks?: { label?: string; status?: "passed" | "warning" }[] };

const API = "https://api.github.com";
const MAX_REPO_KB = 25_000;
const MAX_TREE_ENTRIES = 10_000;
const MAX_FILE_BYTES = 120_000;
const MAX_INSPECTED_FILES = 6;
const MAX_CHANGED_FILES = 4;
const MAX_CONTEXT_CHARS = 110_000;
const IGNORED_PATH = /(^|\/)(node_modules|dist|build|\.next|coverage|vendor|generated)(\/|$)|(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$|\.min\.[cm]?[jt]s$|\.(png|jpe?g|gif|svg|ico|pdf|zip|gz|woff2?|map)$/i;

const stageLabels: Record<StageId, string> = {
  understanding: "Understanding issue",
  exploring: "Exploring repository",
  planning: "Planning",
  writing: "Generating patch",
  reviewing: "Reviewing patch",
};

function headers() {
  const token = process.env.GITHUB_TOKEN;
  return { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "codex-pilot", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

function toRunError(error: unknown): RunError {
  if (error && typeof error === "object" && "code" in error && "title" in error && "message" in error) return error as RunError;
  const message = error instanceof Error ? error.message : "Codex Pilot could not complete this run.";
  return { code: "run_failed", title: "Run interrupted", message, retryable: true };
}

function fail(code: string, title: string, message: string, retryable = false): never {
  throw { code, title, message, retryable } satisfies RunError;
}

async function github<T>(path: string, raw = false): Promise<T> {
  const response = await fetch(`${API}${path}`, { headers: raw ? { ...headers(), Accept: "application/vnd.github.raw+json" } : headers(), cache: "no-store" });
  if (!response.ok) {
    if (response.status === 404) fail("private_or_missing", "Repository or issue unavailable", "Codex Pilot supports public GitHub issues only. Check the URL and repository visibility.");
    if (response.status === 403 || response.status === 429) fail("github_rate_limited", "GitHub rate limit reached", "GitHub temporarily limited this request. Add GITHUB_TOKEN or try again shortly.", true);
    fail("github_request_failed", "GitHub request failed", `GitHub returned status ${response.status}.`, response.status >= 500);
  }
  return (raw ? response.text() : response.json()) as Promise<T>;
}

export function parseIssueUrl(value: string) {
  const normalized = value.startsWith("http") ? value : `https://${value}`;
  let url: URL;
  try { url = new URL(normalized); } catch { return fail("invalid_url", "Enter a GitHub issue URL", "Use a public URL such as github.com/owner/repository/issues/123."); }
  const parts = url.pathname.split("/").filter(Boolean);
  if (!["github.com", "www.github.com"].includes(url.hostname) || parts.length !== 4 || parts[2] !== "issues" || !/^\d+$/.test(parts[3])) {
    return fail("invalid_url", "Enter a GitHub issue URL", "Codex Pilot accepts public GitHub issue URLs only.");
  }
  return { owner: parts[0], repo: parts[1], number: Number(parts[3]) };
}

function words(...values: string[]) {
  return [...new Set(values.join(" ").toLowerCase().match(/[a-z][a-z0-9_-]{2,}/g) ?? [])]
    .filter((word) => !["with", "that", "this", "from", "when", "issue", "does", "after", "into", "should", "would", "please", "have", "will", "there"].includes(word))
    .slice(0, 12);
}

function candidateSourceFiles(tree: TreeItem[]) {
  return tree.filter((item) => item.type === "blob" && (item.size ?? 0) <= MAX_FILE_BYTES && !IGNORED_PATH.test(item.path));
}

function candidatePaths(tree: TreeItem[], terms: string[]) {
  const usable = candidateSourceFiles(tree);
  return usable.map((item) => {
    const matches = terms.filter((term) => item.path.toLowerCase().includes(term));
    const score = matches.length * 4 + (/\.(ts|tsx|js|jsx|py|go|rb|java|rs|php|cs)$/i.test(item.path) ? 1 : 0);
    return { path: item.path, matches, score };
  }).sort((a, b) => b.score - a.score || a.path.length - b.path.length).slice(0, MAX_INSPECTED_FILES);
}

function countLines(value: string) { return value ? value.split("\n").length : 0; }
function wholeFileDiff(path: string, before: string, after: string) {
  const oldLines = before.replace(/\r\n/g, "\n").split("\n");
  const newLines = after.replace(/\r\n/g, "\n").split("\n");
  return [`diff --git a/${path} b/${path}`, `--- a/${path}`, `+++ b/${path}`, `@@ -1,${oldLines.length} +1,${newLines.length} @@`, ...oldLines.map((line) => `-${line}`), ...newLines.map((line) => `+${line}`), ""].join("\n");
}

function parseJson<T>(value: string, fallback: T): T {
  try { return JSON.parse(value) as T; } catch {
    const start = value.indexOf("{"); const end = value.lastIndexOf("}");
    if (start >= 0 && end > start) { try { return JSON.parse(value.slice(start, end + 1)) as T; } catch {} }
    return fallback;
  }
}

const proposalSchema = {
  type: "object", additionalProperties: false, required: ["summary", "plan", "edits", "explanations", "confidence", "limitations"],
  properties: {
    summary: { type: "string" },
    plan: { type: "array", maxItems: 6, items: { type: "object", additionalProperties: false, required: ["title", "detail"], properties: { title: { type: "string" }, detail: { type: "string" } } } },
    edits: { type: "array", maxItems: MAX_CHANGED_FILES, items: { type: "object", additionalProperties: false, required: ["path", "content", "reason"], properties: { path: { type: "string" }, content: { type: "string" }, reason: { type: "string" } } } },
    explanations: { type: "array", maxItems: MAX_CHANGED_FILES, items: { type: "object", additionalProperties: false, required: ["path", "explanation", "coverage"], properties: { path: { type: "string" }, explanation: { type: "string" }, coverage: { type: "array", items: { type: "string" } } } } },
    confidence: { type: "string", enum: ["high", "medium", "low"] }, limitations: { type: "array", items: { type: "string" } },
  },
} as const;

const reviewSchema = { type: "object", additionalProperties: false, required: ["verdict", "checks"], properties: { verdict: { type: "string", enum: ["passed", "warning"] }, checks: { type: "array", maxItems: 5, items: { type: "object", additionalProperties: false, required: ["label", "status"], properties: { label: { type: "string" }, status: { type: "string", enum: ["passed", "warning"] } } } } } } as const;

async function runCodex(prompt: string, schema?: object) {
  const folder = await mkdtemp(join(tmpdir(), "codex-pilot-"));
  const output = join(folder, "answer.json");
  const schemaPath = join(folder, "response-schema.json");
  try {
    if (schema) await writeFile(schemaPath, JSON.stringify(schema), "utf8");
    await new Promise<void>((resolve, reject) => {
      const child = spawn("codex", ["exec", "--ephemeral", "--skip-git-repo-check", "--sandbox", "read-only", "--disable", "shell_tool", ...(schema ? ["--output-schema", schemaPath] : []), "--output-last-message", output, "-"], { cwd: process.cwd(), windowsHide: true, stdio: ["pipe", "ignore", "pipe"] });
      let stderr = "";
      child.stderr.on("data", (chunk) => { stderr += String(chunk); });
      child.on("error", reject);
      child.on("close", (code) => code === 0 ? resolve() : reject(new Error(stderr || "Codex exited with status " + code + ".")));
      child.stdin.end(prompt);
    });
    return await readFile(output, "utf8");
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

async function responseJson<T>(instructions: string, input: string, schema: object, name: string): Promise<T> {
  void name;
  try {
    const output = await runCodex(instructions + "\n\nReturn JSON only. Do not use Markdown fences.\n\nINPUT\n" + input, schema);
    return parseJson<T>(output, {} as T);
  } catch {
    fail("codex_unavailable", "Codex CLI unavailable", "Codex Pilot could not start the locally authenticated Codex CLI. Run codex login and try again.", true);
  }
}

export async function streamPilotRun(issueUrl: string, emit: (event: RunEvent) => void) {
  const started = Date.now(); const elapsed = () => Date.now() - started;
  const stages: Stage[] = (Object.keys(stageLabels) as StageId[]).map((id) => ({ id, label: stageLabels[id], status: "pending" }));
  const activity: Activity[] = []; const searches: Search[] = []; const inspectedFiles: InspectedFile[] = [];
  const setStage = (id: StageId, status: Stage["status"]) => { const stage = stages.find((item) => item.id === id)!; stage.status = status; if (status !== "pending") stage.elapsedMs = elapsed(); emit({ type: "stage", stage: { ...stage } }); };
  const addActivity = (stage: StageId, action: string, detail: string, status: Activity["status"] = "completed") => { const item = { id: String(activity.length + 1), stage, action, detail, status, elapsedMs: elapsed() } satisfies Activity; activity.push(item); emit({ type: "activity", activity: item }); };
  try {
    const input = parseIssueUrl(issueUrl); const slug = `${input.owner}/${input.repo}`; const encoded = `${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}`;
    setStage("understanding", "investigating");
    const [issue, repo] = await Promise.all([github<GithubIssue>(`/repos/${encoded}/issues/${input.number}`), github<GithubRepo>(`/repos/${encoded}`)]);
    if (issue.pull_request) fail("pull_request", "That link is a pull request", "Paste a public GitHub issue URL instead.");
    if (issue.state === "closed") fail("closed_issue", "Issue is closed", "Choose an open issue so Codex Pilot can investigate an unresolved problem.");
    if (repo.private) fail("private_repository", "Repository is private", "Codex Pilot currently supports public repositories only.");
    if (repo.archived || repo.disabled) fail("repository_unavailable", "Repository unavailable", "This repository is archived or unavailable.");
    if (repo.size > MAX_REPO_KB) fail("repository_too_large", "Repository too large", "This repository exceeds the 25 MB exploration limit. Try a smaller public repository.");
    const languageMap = await github<Record<string, number>>(`/repos/${encoded}/languages`);
    const language = Object.entries(languageMap).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "Unknown";
    const issueInfo = { number: issue.number, title: issue.title, repository: slug, url: issue.html_url }; const repository = { branch: repo.default_branch, language, public: true as const, url: repo.html_url };
    emit({ type: "context", issue: issueInfo, repository }); addActivity("understanding", "Parsed issue requirements", `Loaded issue #${issue.number} and its description.`);
    const comments = issue.comments ? await github<{ body: string }[]>(`/repos/${encoded}/issues/${input.number}/comments?per_page=20`) : [];
    addActivity("understanding", "Read discussion", comments.length ? `Read ${comments.length} issue comment${comments.length === 1 ? "" : "s"}.` : "No issue comments were present."); setStage("understanding", "completed");
    setStage("exploring", "investigating");
    const treeResponse = await github<{ tree: TreeItem[]; truncated: boolean }>(`/repos/${encoded}/git/trees/${encodeURIComponent(repo.default_branch)}?recursive=1`);
    if (treeResponse.truncated || treeResponse.tree.length > MAX_TREE_ENTRIES) fail("repository_too_large", "Repository too large", "Codex Pilot found more source entries than this prototype can explore safely.");
    const filesIndexed = candidateSourceFiles(treeResponse.tree).length; addActivity("exploring", "Scanned repository tree", `Scanned repository tree: ${filesIndexed} candidate source files on ${repo.default_branch}.`);
    const terms = words(issue.title, issue.body ?? "", ...comments.map((comment) => comment.body)); const rankedPaths = candidatePaths(treeResponse.tree, terms);
    if (!rankedPaths.length) fail("unsupported_files", "No supported source files found", "The repository has no safely inspectable source files for this issue.");
    const search: Search = { query: terms.slice(0, 3).join(" ") || "issue context", matches: rankedPaths.filter((item) => item.score > 0).length, detail: `Ranked ${rankedPaths.length} relevant files from issue language and paths.` };
    searches.push(search); emit({ type: "search", search }); addActivity("exploring", `Search: “${search.query}”`, `${search.matches || rankedPaths.length} likely matches found.`);
    const candidates: Candidate[] = []; let contextChars = 0;
    for (const ranked of rankedPaths) {
      const content = await github<string>(`/repos/${encoded}/contents/${ranked.path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(repo.default_branch)}`, true);
      if (contextChars + content.length > MAX_CONTEXT_CHARS) break; contextChars += content.length;
      const reason = ranked.matches.length ? `Issue terms matched this path: ${ranked.matches.map((word) => `“${word}”`).join(", ")}.` : "Its source-file path ranked highly for this issue.";
      candidates.push({ path: ranked.path, content, reason }); const inspection: InspectedFile = { path: ranked.path, reason, finding: `Loaded ${countLines(content)} lines for focused analysis.`, lines: countLines(content) };
      inspectedFiles.push(inspection); emit({ type: "inspection", inspection }); addActivity("exploring", `Read ${ranked.path}`, inspection.finding);
    }
    if (!candidates.length) fail("context_limit", "Relevant files exceed the context limit", "Codex Pilot could not safely fit relevant source files into this run."); setStage("exploring", "completed");
    setStage("planning", "investigating");
    const proposal = await responseJson<Proposal>("You are Codex Pilot, a careful repository investigator. Produce a minimal, reviewable patch using only the supplied issue, comments, and inspected file contents. Do not claim to execute code or tests. Edit only supplied paths. If evidence is insufficient, return edits as an empty array and set low confidence. Keep explanations concise and factual.", `ISSUE\n#${issue.number}: ${issue.title}\n${issue.body ?? "(No description)"}\n\nCOMMENTS\n${comments.map((comment) => comment.body).join("\n---\n").slice(0, 6000) || "(No comments)"}\n\nINSPECTED FILES\n${candidates.map((candidate) => `--- ${candidate.path}\n${candidate.content}`).join("\n\n")}`, proposalSchema, "pilot_patch");
    const plan: PlanStep[] = (proposal.plan ?? []).slice(0, 6).map((step, index) => ({ id: String(index + 1), title: step.title || `Implementation step ${index + 1}`, detail: step.detail || "Focused change based on inspected evidence.", status: "completed" }));
    if (!plan.length) plan.push({ id: "1", title: "Review inspected evidence", detail: "No confident implementation plan was returned.", status: "warning" }); emit({ type: "plan", plan }); addActivity("planning", "Created implementation plan", `${plan.length} focused step${plan.length === 1 ? "" : "s"} generated.`); setStage("planning", "completed");
    setStage("writing", "investigating"); const allowed = new Map(candidates.map((candidate) => [candidate.path, candidate.content]));
    const edits = (proposal.edits ?? []).filter((edit) => typeof edit.path === "string" && typeof edit.content === "string" && allowed.has(edit.path) && edit.content.length <= MAX_FILE_BYTES && edit.content !== allowed.get(edit.path)).slice(0, MAX_CHANGED_FILES);
    if (!edits.length || proposal.confidence === "low") fail("no_confident_patch", "Unable to produce a confident patch", "The issue needs evidence beyond the files Codex Pilot could safely inspect. No patch was generated.");
    const files: FileChange[] = edits.map((edit) => { const before = allowed.get(edit.path!)!; const after = edit.content!; return { path: edit.path!, additions: countLines(after), deletions: countLines(before), diff: wholeFileDiff(edit.path!, before, after), reason: edit.reason || "This focused edit addresses the issue evidence." }; });
    files.forEach((file) => addActivity("writing", `Modified ${file.path}`, `Proposed edit (+${file.additions} −${file.deletions}).`)); const patch = files.map((file) => file.diff).join("\n"); addActivity("writing", "Generated unified diff", `Built a reviewable patch from ${files.length} inspected source file${files.length === 1 ? "" : "s"}.`); setStage("writing", "completed");
    setStage("reviewing", "investigating");
    const reviewResult = await responseJson<ReviewerResponse>("You are the patch reviewer for Codex Pilot. Review only the supplied issue, inspected files, and proposed patch. Do not claim that the repository or tests ran. Return a passed verdict only when requirements appear covered, only relevant files changed, and existing public APIs look structurally consistent. Use concise, concrete checks; include the execution and test limitations as warnings.", `ISSUE\n#${issue.number}: ${issue.title}\n${issue.body ?? "(No description)"}\n\nPATCH\n${patch}\n\nINSPECTED PATHS\n${candidates.map((candidate) => candidate.path).join("\n")}`, reviewSchema, "pilot_review");
    const review: Review = { status: reviewResult.verdict === "warning" ? "warning" : "passed", checks: (reviewResult.checks ?? []).slice(0, 5).map((check) => ({ label: check.label || "Patch reviewed", status: check.status === "warning" ? "warning" : "passed" })) };
    if (!review.checks.length) review.checks = [{ label: "Changed files were inspected before editing", status: "passed" }, { label: "Tests were not executed", status: "warning" }]; review.checks.forEach((check) => addActivity("reviewing", check.label, check.status === "passed" ? "Reviewer check passed." : "Manual follow-up is recommended.", check.status === "passed" ? "completed" : "warning")); setStage("reviewing", review.status === "passed" ? "completed" : "warning");
    const explanations: FileExplanation[] = files.map((file) => { const explanation = (proposal.explanations ?? []).find((item) => item.path === file.path); return { path: file.path, explanation: explanation?.explanation || file.reason, coverage: explanation?.coverage?.slice(0, 3) ?? ["Focused change proposed from inspected evidence"] }; });
    const additions = files.reduce((sum, file) => sum + file.additions, 0); const deletions = files.reduce((sum, file) => sum + file.deletions, 0);
    const run: PilotRun = { issue: issueInfo, repository, source: "live", status: review.status === "passed" ? "completed" : "needs-review", summary: proposal.summary || "Codex Pilot proposed a focused patch from the inspected repository evidence.", stages, activity, searches, inspectedFiles, plan, files, explanations, review, confidence: proposal.confidence === "high" ? "high" : "medium", limitations: [...new Set([...(proposal.limitations ?? []), "Repository code was not executed.", "Automated tests were not run."])].slice(0, 4), metrics: { elapsedMs: elapsed(), filesIndexed, filesInspected: inspectedFiles.length, searches: searches.length, filesChanged: files.length, additions, deletions }, patch };
    emit({ type: "completed", run });
  } catch (error) { emit({ type: "failed", error: toRunError(error) }); }
}
