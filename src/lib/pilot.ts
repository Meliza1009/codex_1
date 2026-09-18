import "server-only";

import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Activity, EvidenceFile, EvidenceReport, FileChange, FileExplanation, InspectedFile, PilotRun, PlanStep, Review, RunError, RunEvent, Search, Stage, StageId } from "@/lib/pilot-types";

type GithubIssue = { number: number; title: string; body: string | null; comments: number; html_url: string; state: "open" | "closed"; pull_request?: unknown };
type GithubRepo = { default_branch: string; size: number; archived: boolean; disabled: boolean; html_url: string; private: boolean };
type TreeItem = { path: string; type: "blob" | "tree"; size?: number };
type RankedPath = { path: string; matches: string[]; score: number };
type SearchItem = { path: string };
type SearchResponse = { items?: SearchItem[] };
type SelectedPath = { path?: string; reason?: string };
type SelectionResponse = { selections?: SelectedPath[] };
type ExplorerResponse = { enoughEvidence?: boolean; confidence?: number; reason?: string; evidence?: { path?: string; relevance?: string; findings?: string[] }[]; additionalSearches?: string[] };
type PlannerResponse = { summary?: string; confidence?: "high" | "medium" | "low"; steps?: { title?: string; detail?: string; paths?: string[] }[] };
type CoderResponse = { edits?: { path?: string; content?: string; reason?: string }[]; explanations?: { path?: string; explanation?: string; coverage?: string[] }[]; confidence?: "high" | "medium" | "low"; limitations?: string[] };
type ReviewerResponse = { requirementsCovered?: boolean; unrelatedChanges?: boolean; likelySyntaxProblems?: boolean; apiBreakageRisk?: boolean; evidenceSupported?: boolean; verdict?: "approve" | "revise" | "refuse"; feedback?: string[] };
type GithubClient = <T>(path: string, raw?: boolean) => Promise<T>;
type CodexRunner = (prompt: string, schema?: object) => Promise<string>;

export type PilotDependencies = { github?: GithubClient; runCodex?: CodexRunner };

type AgentRunState = {
  issue?: PilotRun["issue"];
  repository?: PilotRun["repository"];
  issueData?: GithubIssue;
  comments: { body: string }[];
  manifest: RankedPath[];
  contentCache: Map<string, string>;
  originals: Map<string, string>;
  searches: Search[];
  inspectedFiles: InspectedFile[];
  evidence?: EvidenceReport;
  plan: PlanStep[];
  files: FileChange[];
  explanations: FileExplanation[];
  review?: Review;
  limitations: string[];
  stages: Stage[];
  activity: Activity[];
  filesIndexed: number;
  explorationRounds: number;
  revisionCount: number;
  summary: string;
};

const API = "https://api.github.com";
const MAX_REPO_KB = 25_000;
const MAX_TREE_ENTRIES = 10_000;
const MAX_FILE_BYTES = 40_000;
const MAX_CANDIDATE_MANIFEST = 60;
const MAX_SEARCH_SCAN_FILES = 48;
const MAX_EXPLORATION_ROUNDS = 3;
const MAX_FILES_INSPECTED = 12;
const MAX_FILES_PER_ROUND = 4;
const MAX_CHANGED_FILES = 5;
const MAX_CONTEXT_CHARS = 120_000;
const MAX_REVISION_ROUNDS = 1;
const IGNORED_PATH = /(^|\/)(node_modules|dist|build|\.next|coverage|vendor|generated|\.git)(\/|$)|(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$|\.min\.[cm]?[jt]s$|\.(png|jpe?g|gif|svg|ico|pdf|zip|gz|woff2?|map)$/i;
const stageLabels: Record<StageId, string> = { understanding: "Understanding issue", exploring: "Exploring repository", evidence: "Evidence gate", planning: "Planning", writing: "Generating patch", reviewing: "Reviewing patch", revising: "Revising patch" };

function headers() { const token = process.env.GITHUB_TOKEN; return { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "codex-pilot", ...(token ? { Authorization: `Bearer ${token}` } : {}) }; }
function fail(code: string, title: string, message: string, retryable = false): never { throw { code, title, message, retryable } satisfies RunError; }
function toRunError(error: unknown): RunError { if (error && typeof error === "object" && "code" in error && "title" in error && "message" in error) return error as RunError; return { code: "run_failed", title: "Run interrupted", message: error instanceof Error ? error.message : "Codex Pilot could not complete this run.", retryable: true }; }

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
  const normalized = value.startsWith("http") ? value : `https://${value}`; let url: URL;
  try { url = new URL(normalized); } catch { return fail("invalid_url", "Enter a GitHub issue URL", "Use a public URL such as github.com/owner/repository/issues/123."); }
  const parts = url.pathname.split("/").filter(Boolean);
  if (!["github.com", "www.github.com"].includes(url.hostname) || parts.length !== 4 || parts[2] !== "issues" || !/^\d+$/.test(parts[3])) fail("invalid_url", "Enter a GitHub issue URL", "Codex Pilot accepts public GitHub issue URLs only.");
  return { owner: parts[0], repo: parts[1], number: Number(parts[3]) };
}

function words(...values: string[]) { return [...new Set(values.join(" ").toLowerCase().match(/[a-z][a-z0-9_-]{2,}/g) ?? [])].filter((word) => !["with", "that", "this", "from", "when", "issue", "does", "after", "into", "should", "would", "please", "have", "will", "there"].includes(word)).slice(0, 12); }
function sourceFiles(tree: TreeItem[]) { return tree.filter((item) => item.type === "blob" && (item.size ?? 0) <= MAX_FILE_BYTES && !IGNORED_PATH.test(item.path)); }
function rankPaths(tree: TreeItem[], terms: string[]) { return sourceFiles(tree).map((item) => { const matches = terms.filter((term) => item.path.toLowerCase().includes(term)); return { path: item.path, matches, score: matches.length * 4 + (/\.(ts|tsx|js|jsx|py|go|rb|java|rs|php|cs)$/i.test(item.path) ? 1 : 0) }; }).sort((a, b) => b.score - a.score || a.path.length - b.path.length).slice(0, MAX_CANDIDATE_MANIFEST); }
function countLines(value: string) { return value ? value.split("\n").length : 0; }
function wholeFileDiff(path: string, before: string, after: string) { const oldLines = before.replace(/\r\n/g, "\n").split("\n"); const newLines = after.replace(/\r\n/g, "\n").split("\n"); return [`diff --git a/${path} b/${path}`, `--- a/${path}`, `+++ b/${path}`, `@@ -1,${oldLines.length} +1,${newLines.length} @@`, ...oldLines.map((line) => `-${line}`), ...newLines.map((line) => `+${line}`), ""].join("\n"); }
function parseJson<T>(value: string, fallback: T): T { try { return JSON.parse(value) as T; } catch { const start = value.indexOf("{"); const end = value.lastIndexOf("}"); if (start >= 0 && end > start) { try { return JSON.parse(value.slice(start, end + 1)) as T; } catch {} } return fallback; } }
function compactIssue(state: AgentRunState) { const issue = state.issueData!; return `ISSUE\n#${issue.number}: ${issue.title}\n${issue.body ?? "(No description)"}\n\nCOMMENTS\n${state.comments.map((comment) => comment.body).join("\n---\n").slice(0, 6000) || "(No comments)"}`; }
function evidenceSummary(evidence?: EvidenceReport) { return evidence ? evidence.evidence.map((item) => `- ${item.path}: ${item.relevance}\n  Findings: ${item.findings.join("; ")}`).join("\n") : "(No evidence yet)"; }
function inspectedContents(state: AgentRunState) { return [...state.originals].map(([path, content]) => `--- ${path}\n${content}`).join("\n\n"); }
function manifestSummary(paths: RankedPath[]) { return paths.map((item) => `- ${item.path}${item.matches.length ? ` (path matches: ${item.matches.join(", ")})` : ""}`).join("\n"); }

const selectionSchema = { type: "object", additionalProperties: false, required: ["selections"], properties: { selections: { type: "array", minItems: 1, maxItems: MAX_FILES_PER_ROUND, items: { type: "object", additionalProperties: false, required: ["path", "reason"], properties: { path: { type: "string" }, reason: { type: "string" } } } } } } as const;
const evidenceSchema = { type: "object", additionalProperties: false, required: ["enoughEvidence", "confidence", "reason", "evidence", "additionalSearches"], properties: { enoughEvidence: { type: "boolean" }, confidence: { type: "number", minimum: 0, maximum: 1 }, reason: { type: "string" }, evidence: { type: "array", maxItems: MAX_FILES_INSPECTED, items: { type: "object", additionalProperties: false, required: ["path", "relevance", "findings"], properties: { path: { type: "string" }, relevance: { type: "string" }, findings: { type: "array", maxItems: 4, items: { type: "string" } } } } }, additionalSearches: { type: "array", maxItems: 3, items: { type: "string" } } } } as const;
const plannerSchema = { type: "object", additionalProperties: false, required: ["summary", "confidence", "steps"], properties: { summary: { type: "string" }, confidence: { type: "string", enum: ["high", "medium", "low"] }, steps: { type: "array", minItems: 1, maxItems: 6, items: { type: "object", additionalProperties: false, required: ["title", "detail", "paths"], properties: { title: { type: "string" }, detail: { type: "string" }, paths: { type: "array", minItems: 1, maxItems: MAX_CHANGED_FILES, items: { type: "string" } } } } } } } as const;
const coderSchema = { type: "object", additionalProperties: false, required: ["edits", "explanations", "confidence", "limitations"], properties: { edits: { type: "array", maxItems: MAX_CHANGED_FILES, items: { type: "object", additionalProperties: false, required: ["path", "content", "reason"], properties: { path: { type: "string" }, content: { type: "string" }, reason: { type: "string" } } } }, explanations: { type: "array", maxItems: MAX_CHANGED_FILES, items: { type: "object", additionalProperties: false, required: ["path", "explanation", "coverage"], properties: { path: { type: "string" }, explanation: { type: "string" }, coverage: { type: "array", items: { type: "string" } } } } }, confidence: { type: "string", enum: ["high", "medium", "low"] }, limitations: { type: "array", items: { type: "string" } } } } as const;
const reviewSchema = { type: "object", additionalProperties: false, required: ["requirementsCovered", "unrelatedChanges", "likelySyntaxProblems", "apiBreakageRisk", "evidenceSupported", "verdict", "feedback"], properties: { requirementsCovered: { type: "boolean" }, unrelatedChanges: { type: "boolean" }, likelySyntaxProblems: { type: "boolean" }, apiBreakageRisk: { type: "boolean" }, evidenceSupported: { type: "boolean" }, verdict: { type: "string", enum: ["approve", "revise", "refuse"] }, feedback: { type: "array", maxItems: 4, items: { type: "string" } } } } as const;

async function runCodex(prompt: string, schema?: object) {
  const folder = await mkdtemp(join(tmpdir(), "codex-pilot-")); const output = join(folder, "answer.json"); const schemaPath = join(folder, "response-schema.json");
  try {
    if (schema) await writeFile(schemaPath, JSON.stringify(schema), "utf8");
    await new Promise<void>((resolve, reject) => { const child = spawn("codex", ["exec", "--ephemeral", "--skip-git-repo-check", "--sandbox", "read-only", "--disable", "shell_tool", ...(schema ? ["--output-schema", schemaPath] : []), "--output-last-message", output, "-"], { cwd: process.cwd(), windowsHide: true, stdio: ["pipe", "ignore", "pipe"] }); let stderr = ""; child.stderr.on("data", (chunk) => { stderr += String(chunk); }); child.on("error", reject); child.on("close", (code) => code === 0 ? resolve() : reject(new Error(stderr || `Codex exited with status ${code}.`))); child.stdin.end(prompt); });
    return await readFile(output, "utf8");
  } finally { await rm(folder, { recursive: true, force: true }); }
}
async function responseJson<T>(runner: CodexRunner, instructions: string, input: string, schema: object): Promise<T> { try { return parseJson<T>(await runner(`${instructions}\n\nReturn JSON only. Do not use Markdown fences.\n\nINPUT\n${input}`, schema), {} as T); } catch { fail("codex_unavailable", "Codex CLI unavailable", "Codex Pilot could not start the locally authenticated Codex CLI. Run codex login and try again.", true); } }

function createState(): AgentRunState { return { comments: [], manifest: [], contentCache: new Map(), originals: new Map(), searches: [], inspectedFiles: [], plan: [], files: [], explanations: [], limitations: [], stages: (Object.keys(stageLabels) as StageId[]).map((id) => ({ id, label: stageLabels[id], status: "pending" })), activity: [], filesIndexed: 0, explorationRounds: 0, revisionCount: 0, summary: "" }; }
function emitters(state: AgentRunState, emit: (event: RunEvent) => void, started: number) {
  const elapsed = () => Date.now() - started;
  const stage = (id: StageId, status: Stage["status"]) => { const item = state.stages.find((candidate) => candidate.id === id)!; item.status = status; if (status !== "pending") item.elapsedMs = elapsed(); emit({ type: "stage", stage: { ...item } }); };
  const activity = (id: StageId, action: string, detail: string, status: Activity["status"] = "completed") => { const item = { id: String(state.activity.length + 1), stage: id, action, detail, status, elapsedMs: elapsed() } satisfies Activity; state.activity.push(item); emit({ type: "activity", activity: item }); };
  return { elapsed, stage, activity };
}
function selectedPaths(items: SelectedPath[] | undefined, candidates: RankedPath[], limit: number) { const available = new Set(candidates.map((item) => item.path)); const seen = new Set<string>(); return (items ?? []).filter((item) => typeof item.path === "string" && available.has(item.path) && !seen.has(item.path) && (seen.add(item.path), true)).slice(0, limit).map((item) => ({ path: item.path!, reason: item.reason?.trim() || "Selected because it is relevant to the issue." })); }
function validEvidence(result: ExplorerResponse, state: AgentRunState): EvidenceReport { const available = new Set(state.originals.keys()); const evidence: EvidenceFile[] = (result.evidence ?? []).filter((item) => typeof item.path === "string" && available.has(item.path)).map((item) => ({ path: item.path!, relevance: item.relevance?.trim() || "Inspected for issue relevance.", findings: (item.findings ?? []).filter(Boolean).slice(0, 4) })).filter((item) => item.findings.length); return { enoughEvidence: result.enoughEvidence === true, confidence: Math.max(0, Math.min(1, Number(result.confidence) || 0)), reason: result.reason?.trim() || "The explorer did not provide an evidence decision.", evidence, additionalSearches: [...new Set((result.additionalSearches ?? []).map((item) => item.trim()).filter(Boolean))].slice(0, 3) }; }
function buildFiles(proposal: CoderResponse, originals: Map<string, string>, approvedPaths: Set<string>) { const edits = proposal.edits ?? []; if (!edits.length || proposal.confidence === "low" || edits.length > MAX_CHANGED_FILES || new Set(edits.map((edit) => edit.path)).size !== edits.length) return { reason: "The coder could not produce a confident patch within the approved scope." }; const files: FileChange[] = []; for (const edit of edits) { if (typeof edit.path !== "string" || typeof edit.content !== "string" || !approvedPaths.has(edit.path) || !originals.has(edit.path) || edit.content.length > MAX_FILE_BYTES || edit.content === originals.get(edit.path)) return { reason: "The coder proposed an edit outside the approved inspected-file scope." }; const before = originals.get(edit.path)!; files.push({ path: edit.path, additions: countLines(edit.content), deletions: countLines(before), diff: wholeFileDiff(edit.path, before, edit.content), reason: edit.reason || "This focused edit addresses inspected evidence." }); } return { files };
}

async function understandIssue(state: AgentRunState, issueUrl: string, client: GithubClient, emit: (event: RunEvent) => void, tools: ReturnType<typeof emitters>) {
  const input = parseIssueUrl(issueUrl); const encoded = `${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}`; tools.stage("understanding", "investigating");
  const [issue, repo] = await Promise.all([client<GithubIssue>(`/repos/${encoded}/issues/${input.number}`), client<GithubRepo>(`/repos/${encoded}`)]);
  if (issue.pull_request) fail("pull_request", "That link is a pull request", "Paste a public GitHub issue URL instead."); if (issue.state === "closed") fail("closed_issue", "Issue is closed", "Choose an open issue so Codex Pilot can investigate an unresolved problem."); if (repo.private) fail("private_repository", "Repository is private", "Codex Pilot currently supports public repositories only."); if (repo.archived || repo.disabled) fail("repository_unavailable", "Repository unavailable", "This repository is archived or unavailable."); if (repo.size > MAX_REPO_KB) fail("repository_too_large", "Repository too large", "This repository exceeds the 25 MB exploration limit. Try a smaller public repository.");
  const languageMap = await client<Record<string, number>>(`/repos/${encoded}/languages`); state.issueData = issue; state.issue = { number: issue.number, title: issue.title, repository: `${input.owner}/${input.repo}`, url: issue.html_url }; state.repository = { branch: repo.default_branch, language: Object.entries(languageMap).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "Unknown", public: true, url: repo.html_url }; emit({ type: "context", issue: state.issue, repository: state.repository }); tools.activity("understanding", "Parsed issue requirements", `Loaded issue #${issue.number} and its description.`);
  state.comments = issue.comments ? await client<{ body: string }[]>(`/repos/${encoded}/issues/${input.number}/comments?per_page=20`) : []; tools.activity("understanding", "Read discussion", state.comments.length ? `Read ${state.comments.length} issue comment${state.comments.length === 1 ? "" : "s"}.` : "No issue comments were present."); tools.stage("understanding", "completed"); return { encoded };
}

async function scanRepository(state: AgentRunState, encoded: string, client: GithubClient, tools: ReturnType<typeof emitters>) {
  tools.stage("exploring", "investigating"); const tree = await client<{ tree: TreeItem[]; truncated: boolean }>(`/repos/${encoded}/git/trees/${encodeURIComponent(state.repository!.branch)}?recursive=1`); if (tree.truncated || tree.tree.length > MAX_TREE_ENTRIES) fail("repository_too_large", "Repository too large", "Codex Pilot found more source entries than this prototype can explore safely."); state.filesIndexed = sourceFiles(tree.tree).length; state.manifest = rankPaths(tree.tree, words(state.issueData!.title, state.issueData!.body ?? "", ...state.comments.map((comment) => comment.body))); if (!state.manifest.length) fail("unsupported_files", "No supported source files found", "The repository has no safely inspectable source files for this issue."); tools.activity("exploring", "Scanned repository tree", `${state.filesIndexed} candidate source files discovered on ${state.repository!.branch}.`);
}

async function fetchContent(state: AgentRunState, encoded: string, path: string, client: GithubClient) { const existing = state.contentCache.get(path); if (existing !== undefined) return existing; const content = await client<string>(`/repos/${encoded}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(state.repository!.branch)}`, true); if (content.length > MAX_FILE_BYTES) return ""; state.contentCache.set(path, content); return content; }

async function searchRepository(state: AgentRunState, encoded: string, terms: string[], client: GithubClient, tools: ReturnType<typeof emitters>, emit: (event: RunEvent) => void) {
  const query = terms.join(" ").trim(); if (!query) return [] as RankedPath[]; let paths: string[] = [];
  if (process.env.GITHUB_TOKEN) { try { const result = await client<SearchResponse>(`/search/code?q=${encodeURIComponent(`${terms.join(" ")} repo:${state.issue!.repository}`)}&per_page=30`); paths = (result.items ?? []).map((item) => item.path); } catch { paths = []; } }
  if (!paths.length) { const lower = terms.map((term) => term.toLowerCase()); for (const item of state.manifest.slice(0, MAX_SEARCH_SCAN_FILES)) { const content = await fetchContent(state, encoded, item.path, client); if (content && lower.some((term) => content.toLowerCase().includes(term))) paths.push(item.path); } }
  const matches = state.manifest.filter((item) => paths.includes(item.path) || terms.some((term) => item.path.toLowerCase().includes(term))).sort((a, b) => (paths.includes(b.path) ? 1 : 0) - (paths.includes(a.path) ? 1 : 0) || b.score - a.score).slice(0, MAX_CANDIDATE_MANIFEST); const search: Search = { query, matches: matches.length, detail: process.env.GITHUB_TOKEN && paths.length ? "Matched repository code search results." : "Matched a bounded local source scan and repository paths." }; state.searches.push(search); emit({ type: "search", search }); tools.activity("exploring", `Search: "${query}"`, `${matches.length} likely file match${matches.length === 1 ? "" : "es"} found.`); return matches;
}

async function selectAndInspect(state: AgentRunState, candidates: RankedPath[], encoded: string, client: GithubClient, codex: CodexRunner, tools: ReturnType<typeof emitters>, emit: (event: RunEvent) => void) {
  const remaining = MAX_FILES_INSPECTED - state.inspectedFiles.length; const selected = await responseJson<SelectionResponse>(codex, "You are the repository explorer for Codex Pilot. From the supplied search results, select the smallest set of files to inspect next. Use prior evidence to follow imports, callers, or state ownership. Select no more than four files and do not propose code.", `${compactIssue(state)}\n\nPRIOR EVIDENCE\n${evidenceSummary(state.evidence)}\n\nSEARCH RESULTS\n${manifestSummary(candidates.filter((item) => !state.originals.has(item.path)))}`, selectionSchema); const paths = selectedPaths(selected.selections, candidates.filter((item) => !state.originals.has(item.path)), Math.min(MAX_FILES_PER_ROUND, remaining)); if (!paths.length) return false;
  for (const item of paths) { const content = await fetchContent(state, encoded, item.path, client); if (!content || [...state.originals.values()].reduce((total, value) => total + value.length, 0) + content.length > MAX_CONTEXT_CHARS) continue; state.originals.set(item.path, content); const inspection: InspectedFile = { path: item.path, reason: item.reason, finding: `Loaded ${countLines(content)} lines for focused analysis.`, lines: countLines(content) }; state.inspectedFiles.push(inspection); emit({ type: "inspection", inspection }); tools.activity("exploring", `Read ${item.path}`, inspection.finding); }
  return state.inspectedFiles.length > 0;
}

async function evaluateEvidence(state: AgentRunState, codex: CodexRunner, tools: ReturnType<typeof emitters>, emit: (event: RunEvent) => void) {
  tools.stage("evidence", "investigating"); const result = await responseJson<ExplorerResponse>(codex, "You are the evidence gate for Codex Pilot. Build a compact evidence package only from the inspected file contents. Decide whether it is sufficient to support a minimal code patch. If it is not sufficient, request up to three specific symbol or concept searches. Do not propose code, execution, or tests.", `${compactIssue(state)}\n\nINSPECTED FILES\n${inspectedContents(state)}`, evidenceSchema); state.evidence = validEvidence(result, state); emit({ type: "evidence", evidence: state.evidence }); tools.activity("evidence", state.evidence.enoughEvidence ? "Evidence sufficient" : "Additional context required", state.evidence.reason, state.evidence.enoughEvidence ? "completed" : "warning"); tools.stage("evidence", state.evidence.enoughEvidence ? "completed" : "warning"); return state.evidence.enoughEvidence;
}

async function exploreRepository(state: AgentRunState, encoded: string, client: GithubClient, codex: CodexRunner, tools: ReturnType<typeof emitters>, emit: (event: RunEvent) => void) {
  let terms = words(state.issueData!.title, state.issueData!.body ?? "", ...state.comments.map((comment) => comment.body)).slice(0, 3); for (let round = 1; round <= MAX_EXPLORATION_ROUNDS; round += 1) { state.explorationRounds = round; tools.activity("exploring", `Exploration round ${round}`, round === 1 ? "Starting from issue language." : "Following the evidence gate's requested context."); const candidates = await searchRepository(state, encoded, terms, client, tools, emit); if (!candidates.length || !(await selectAndInspect(state, candidates, encoded, client, codex, tools, emit))) return { enough: false, reason: "The explorer could not identify another safe file to inspect.", next: "Inspect runtime logs or execute the repository." }; if (await evaluateEvidence(state, codex, tools, emit)) { tools.stage("exploring", "completed"); return { enough: true }; } if (round === MAX_EXPLORATION_ROUNDS || state.inspectedFiles.length >= MAX_FILES_INSPECTED) break; terms = state.evidence?.additionalSearches ?? []; if (!terms.length) return { enough: false, reason: state.evidence?.reason || "The explorer could not name the missing evidence.", next: "Inspect runtime logs or execute the repository." }; }
  return { enough: false, reason: state.evidence?.reason || "Evidence remained insufficient after the exploration limit.", next: "Inspect runtime logs or execute the repository." };
}

async function createPlan(state: AgentRunState, codex: CodexRunner, tools: ReturnType<typeof emitters>, emit: (event: RunEvent) => void) {
  tools.stage("planning", "investigating"); const result = await responseJson<PlannerResponse>(codex, "You are the planner for Codex Pilot. Create a minimal file-linked implementation plan using only the supplied issue and evidence package. Do not infer unlisted repository details, propose code, execution, tests, or unrelated changes.", `${compactIssue(state)}\n\nEVIDENCE PACKAGE\n${evidenceSummary(state.evidence)}`, plannerSchema); const allowed = new Set(state.evidence!.evidence.map((item) => item.path)); state.plan = (result.steps ?? []).slice(0, 6).map((step, index): PlanStep => ({ id: String(index + 1), title: step.title?.trim() || `Implementation step ${index + 1}`, detail: step.detail?.trim() || "Focused change supported by evidence.", paths: (step.paths ?? []).filter((path) => allowed.has(path)).slice(0, MAX_CHANGED_FILES), status: "pending" })).filter((step) => step.paths?.length); if (!state.plan.length || result.confidence === "low") return false; state.summary = result.summary || "Codex Pilot formed a focused plan from the evidence package."; emit({ type: "plan", plan: state.plan }); tools.activity("planning", "Created implementation plan", `${state.plan.length} evidence-linked step${state.plan.length === 1 ? "" : "s"} generated.`); tools.stage("planning", "completed"); return true;
}

async function generatePatch(state: AgentRunState, codex: CodexRunner, tools: ReturnType<typeof emitters>, emit: (event: RunEvent) => void, feedback?: string) {
  tools.stage("writing", "investigating"); state.plan.forEach((step) => { step.status = "investigating"; }); emit({ type: "plan", plan: state.plan }); const approved = new Set(state.plan.flatMap((step) => step.paths ?? [])); const originalContents = [...state.originals].filter(([path]) => approved.has(path)).map(([path, content]) => `--- ${path}\n${content}`).join("\n\n"); const proposal = await responseJson<CoderResponse>(codex, "You are the coder for Codex Pilot. Return minimal updated full-file contents only for the approved files provided. Preserve APIs unless the issue requires a change. Do not create files, run code, or claim tests. Return low confidence and no edits when the evidence is insufficient.", `${compactIssue(state)}\n\nEVIDENCE PACKAGE\n${evidenceSummary(state.evidence)}\n\nPLAN\n${state.plan.map((step) => `${step.title}: ${step.detail}\nPaths: ${step.paths?.join(", ")}`).join("\n\n")}\n\nAPPROVED ORIGINAL FILES\n${originalContents}${feedback ? `\n\nREVIEWER FEEDBACK\n${feedback}` : ""}`, coderSchema); const built = buildFiles(proposal, state.originals, approved); if (!("files" in built) || !built.files) return { ok: false, reason: built.reason || "The coder could not produce a safe patch." }; state.files = built.files; state.explanations = state.files.map((file) => { const explanation = (proposal.explanations ?? []).find((item) => item.path === file.path); return { path: file.path, explanation: explanation?.explanation || file.reason, coverage: explanation?.coverage?.slice(0, 3) ?? ["Focused change proposed from inspected evidence"] }; }); state.limitations = proposal.limitations ?? []; state.files.forEach((file) => tools.activity("writing", `Modified ${file.path}`, `Proposed edit (+${file.additions} -${file.deletions}).`)); tools.activity("writing", feedback ? "Generated revised diff" : "Generated unified diff", `Built a reviewable patch from ${state.files.length} approved source file${state.files.length === 1 ? "" : "s"}.`); state.plan.forEach((step) => { step.status = "completed"; }); emit({ type: "plan", plan: state.plan }); tools.stage("writing", "completed"); return { ok: true };
}

async function reviewPatch(state: AgentRunState, codex: CodexRunner, tools: ReturnType<typeof emitters>) {
  tools.stage("reviewing", "investigating"); const result = await responseJson<ReviewerResponse>(codex, "You are the patch reviewer for Codex Pilot. Judge only the supplied issue, evidence package, plan, original changed files, and generated patch. Approve only if all requirements appear covered, no unrelated changes are present, syntax/API risk appears low, and evidence supports the patch. Return revise for one specific fixable concern, otherwise refuse. Never claim execution or tests.", `${compactIssue(state)}\n\nEVIDENCE PACKAGE\n${evidenceSummary(state.evidence)}\n\nPLAN\n${state.plan.map((step) => `${step.title}: ${step.detail}`).join("\n")}\n\nORIGINAL CHANGED FILES\n${[...state.originals].filter(([path]) => state.files.some((file) => file.path === path)).map(([path, content]) => `--- ${path}\n${content}`).join("\n\n")}\n\nPATCH\n${state.files.map((file) => file.diff).join("\n")}`, reviewSchema); const feedback = (result.feedback ?? []).filter(Boolean).slice(0, 4); const safe = result.requirementsCovered === true && result.unrelatedChanges === false && result.likelySyntaxProblems === false && result.apiBreakageRisk === false && result.evidenceSupported === true; const verdict = result.verdict === "approve" && safe ? "approve" : result.verdict === "revise" && state.revisionCount < MAX_REVISION_ROUNDS ? "revise" : "refuse"; state.review = { status: verdict === "approve" ? "passed" : "warning", verdict: verdict === "approve" ? "approved" : "refused", requirementsCovered: result.requirementsCovered === true, unrelatedChanges: result.unrelatedChanges === true, likelySyntaxProblems: result.likelySyntaxProblems === true, apiBreakageRisk: result.apiBreakageRisk === true, evidenceSupported: result.evidenceSupported === true, feedback, revisionCount: state.revisionCount, checks: [{ label: "Issue requirements covered", status: result.requirementsCovered ? "passed" : "warning" }, { label: "Only relevant files modified", status: !result.unrelatedChanges ? "passed" : "warning" }, { label: "Existing API appears preserved", status: !result.apiBreakageRisk ? "passed" : "warning" }, { label: "Repository code and tests were not executed", status: "warning" }] }; return verdict;
}

function runMetrics(state: AgentRunState, elapsed: number) { const additions = state.files.reduce((sum, file) => sum + file.additions, 0); const deletions = state.files.reduce((sum, file) => sum + file.deletions, 0); return { elapsedMs: elapsed, filesIndexed: state.filesIndexed, filesInspected: state.inspectedFiles.length, searches: state.searches.length, explorationRounds: state.explorationRounds, revisions: state.revisionCount, filesChanged: state.files.length, additions, deletions }; }
function runFor(state: AgentRunState, elapsed: number, status: PilotRun["status"], refusal?: PilotRun["refusal"]): PilotRun { return { issue: state.issue!, repository: state.repository!, source: "live", status, summary: state.summary || (status === "refused" ? "Codex Pilot stopped without proposing a patch." : "Codex Pilot proposed a focused patch from the inspected evidence."), stages: state.stages, activity: state.activity, searches: state.searches, inspectedFiles: state.inspectedFiles, evidence: state.evidence, plan: state.plan, files: state.files, explanations: state.explanations, review: state.review ?? { status: "warning", verdict: "refused", revisionCount: state.revisionCount, checks: [] }, confidence: state.evidence?.confidence && state.evidence.confidence >= 0.8 ? "high" : state.evidence?.confidence && state.evidence.confidence >= 0.5 ? "medium" : "low", refusal, limitations: [...new Set([...state.limitations, "Repository code was not executed.", "Automated tests were not run."])].slice(0, 4), metrics: runMetrics(state, elapsed), patch: state.files.map((file) => file.diff).join("\n") }; }
function refuse(state: AgentRunState, reason: string, suggestedNextStep: string, tools: ReturnType<typeof emitters>, emit: (event: RunEvent) => void) { state.summary = "Codex Pilot stopped because the inspected evidence was not strong enough for a trustworthy patch."; tools.activity("evidence", "Investigation stopped", reason, "warning"); tools.stage("evidence", "warning"); emit({ type: "completed", run: runFor(state, tools.elapsed(), "refused", { reason, suggestedNextStep }) }); }

export async function streamPilotRun(issueUrl: string, emit: (event: RunEvent) => void, dependencies: PilotDependencies = {}) {
  const state = createState(); const client = dependencies.github ?? github; const codex = dependencies.runCodex ?? runCodex; const tools = emitters(state, emit, Date.now());
  try {
    const { encoded } = await understandIssue(state, issueUrl, client, emit, tools); await scanRepository(state, encoded, client, tools); const exploration = await exploreRepository(state, encoded, client, codex, tools, emit); if (!exploration.enough) return refuse(state, exploration.reason!, exploration.next!, tools, emit);
    if (!(await createPlan(state, codex, tools, emit))) return refuse(state, "The planner could not map the evidence to a confident implementation plan.", "Inspect additional source files or refine the issue requirements.", tools, emit);
    const initial = await generatePatch(state, codex, tools, emit); if (!initial.ok) return refuse(state, initial.reason!, "Inspect additional source files or refine the issue requirements.", tools, emit);
    let verdict = await reviewPatch(state, codex, tools); if (verdict === "revise") { state.revisionCount = 1; tools.activity("reviewing", "Revision requested", state.review?.feedback?.join(" ") || "Reviewer found a focused concern.", "warning"); tools.stage("reviewing", "warning"); tools.stage("revising", "investigating"); tools.activity("revising", "Applying reviewer feedback", "Revising only the already approved files."); const revision = await generatePatch(state, codex, tools, emit, state.review?.feedback?.join(" ")); if (!revision.ok) return refuse(state, revision.reason!, "Review the proposed change manually.", tools, emit); tools.stage("revising", "completed"); verdict = await reviewPatch(state, codex, tools); }
    if (verdict !== "approve") return refuse(state, state.review?.feedback?.join(" ") || "The reviewer could not approve this patch within the allowed revision limit.", "Review the evidence manually or execute the repository outside Codex Pilot.", tools, emit);
    state.review!.checks.forEach((check) => tools.activity("reviewing", check.label, check.status === "passed" ? "Reviewer check passed." : "Manual follow-up is recommended.", check.status === "passed" ? "completed" : "warning")); tools.stage("reviewing", "completed"); emit({ type: "completed", run: runFor(state, tools.elapsed(), "completed") });
  } catch (error) { emit({ type: "failed", error: toRunError(error) }); }
}
