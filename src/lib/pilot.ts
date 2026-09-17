import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type Activity = { id: string; phase: string; action: string; detail: string; status: "done" };
export type FileChange = { path: string; additions: number; deletions: number; diff: string; reason: string };
export type PilotRun = {
  issue: { number: number; title: string; repository: string; url: string };
  status: "completed" | "needs-review";
  source: "codex" | "guided";
  summary: string;
  plan: string[];
  activity: Activity[];
  inspectedFiles: string[];
  files: FileChange[];
  explanation: string[];
  patch: string;
};

type GithubIssue = { number: number; title: string; body: string | null; comments: number; html_url: string; pull_request?: unknown };
type GithubRepo = { full_name: string; default_branch: string; size: number; archived: boolean; disabled: boolean };
type TreeItem = { path: string; type: "blob" | "tree"; size?: number };
type Candidate = { path: string; content: string };

const API = "https://api.github.com";
const MAX_REPO_KB = 25_000;
const MAX_FILES = 10_000;
const MAX_FILE_BYTES = 180_000;

function headers() {
  const token = process.env.GITHUB_TOKEN;
  return { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "codex-pilot", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

async function github<T>(path: string, raw = false): Promise<T> {
  const response = await fetch(`${API}${path}`, { headers: raw ? { ...headers(), Accept: "application/vnd.github.raw+json" } : headers(), cache: "no-store" });
  if (!response.ok) {
    if (response.status === 404) throw new Error("GitHub could not find that public issue or repository.");
    if (response.status === 403) throw new Error("GitHub rate limited this request. Add GITHUB_TOKEN and try again.");
    throw new Error(`GitHub request failed (${response.status}).`);
  }
  return (raw ? response.text() : response.json()) as Promise<T>;
}

export function parseIssueUrl(value: string) {
  const normalized = value.startsWith("http") ? value : `https://${value}`;
  let url: URL;
  try { url = new URL(normalized); } catch { throw new Error("Enter a GitHub issue URL, for example github.com/owner/repo/issues/123."); }
  const parts = url.pathname.split("/").filter(Boolean);
  if (!["github.com", "www.github.com"].includes(url.hostname) || parts.length !== 4 || parts[2] !== "issues" || !/^\d+$/.test(parts[3])) {
    throw new Error("Codex Pilot accepts public GitHub issue URLs only.");
  }
  return { owner: parts[0], repo: parts[1], number: Number(parts[3]), canonical: `https://github.com/${parts.join("/")}` };
}

function words(...values: string[]) {
  return [...new Set(values.join(" ").toLowerCase().match(/[a-z][a-z0-9_-]{2,}/g) ?? [])]
    .filter((word) => !["with", "that", "this", "from", "when", "issue", "does", "after", "into", "should", "would", "please", "have", "will", "there"].includes(word))
    .slice(0, 12);
}

function candidatePaths(tree: TreeItem[], terms: string[]) {
  const usable = tree.filter((item) => item.type === "blob" && (item.size ?? 0) <= MAX_FILE_BYTES && !/\.(png|jpe?g|gif|svg|ico|pdf|zip|lock|min\.js)$/i.test(item.path));
  return usable
    .map((item) => ({ item, score: terms.reduce((score, term) => score + (item.path.toLowerCase().includes(term) ? 3 : 0), 0) + (/\.(ts|tsx|js|jsx|py|go|rb|java|rs)$/i.test(item.path) ? 1 : 0) }))
    .sort((a, b) => b.score - a.score || a.item.path.length - b.item.path.length)
    .slice(0, 4)
    .map(({ item }) => item.path);
}

function countLines(value: string) { return value ? value.split("\n").length : 0; }
function wholeFileDiff(path: string, before: string, after: string) {
  const oldLines = before.replace(/\r\n/g, "\n").split("\n");
  const newLines = after.replace(/\r\n/g, "\n").split("\n");
  return [`diff --git a/${path} b/${path}`, `--- a/${path}`, `+++ b/${path}`, `@@ -1,${oldLines.length} +1,${newLines.length} @@`, ...oldLines.map((line) => `-${line}`), ...newLines.map((line) => `+${line}`), ""].join("\n");
}

function extractJson(value: string) {
  const start = value.indexOf("{"); const end = value.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Codex returned no structured patch.");
  return JSON.parse(value.slice(start, end + 1)) as { summary?: string; plan?: string[]; edits?: { path: string; content: string; reason?: string }[]; explanation?: string[] };
}

async function runCodex(prompt: string) {
  const folder = await mkdtemp(join(tmpdir(), "codex-pilot-"));
  const output = join(folder, "answer.json");
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn("codex", ["exec", "--ephemeral", "--skip-git-repo-check", "--sandbox", "read-only", "--disable", "shell_tool", "--output-last-message", output, "-"], { cwd: process.cwd(), windowsHide: true, stdio: ["pipe", "ignore", "pipe"] });
      let stderr = "";
      child.stderr.on("data", (chunk) => { stderr += String(chunk); });
      child.on("error", reject);
      child.on("close", (code) => code === 0 ? resolve() : reject(new Error(stderr || `Codex exited with status ${code}.`)));
      child.stdin.end(prompt);
    });
    return extractJson(await readFile(output, "utf8"));
  } finally { await rm(folder, { recursive: true, force: true }); }
}

function blankRun(issue: GithubIssue, repository: string, activity: Activity[], inspectedFiles: string[], cause?: string, source: "codex" | "guided" = "guided"): PilotRun {
  return {
    issue: { number: issue.number, title: issue.title, repository, url: issue.html_url }, status: "needs-review", source,
    summary: "Codex Pilot collected the issue and relevant source files, but it could not produce a validated patch in this run.",
    plan: ["Review the issue requirements.", "Inspect the selected implementation files.", "Make the smallest compatible change.", "Run the repository’s own checks after applying the patch."],
    activity: [...activity, { id: String(activity.length + 1), phase: "GENERATING PATCH", action: "Patch needs review", detail: cause ?? "No structured patch was produced.", status: "done" }],
    inspectedFiles, files: [], explanation: ["The investigation completed without executing the repository.", "No patch is offered because the agent response could not be validated."], patch: "",
  };
}

export async function createPilotRun(issueUrl: string): Promise<PilotRun> {
  const input = parseIssueUrl(issueUrl);
  const slug = `${input.owner}/${input.repo}`;
  const encoded = `${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}`;
  const activity: Activity[] = [];
  const add = (phase: string, action: string, detail: string) => activity.push({ id: String(activity.length + 1), phase, action, detail, status: "done" });
  const [issue, repo] = await Promise.all([github<GithubIssue>(`/repos/${encoded}/issues/${input.number}`), github<GithubRepo>(`/repos/${encoded}`)]);
  if (issue.pull_request) throw new Error("That URL points to a pull request. Enter an issue URL instead.");
  if (repo.archived || repo.disabled) throw new Error("This repository is archived or unavailable.");
  if (repo.size > MAX_REPO_KB) throw new Error("This repository is too large for the local MVP (limit: 25 MB). Try a smaller public repository.");
  add("UNDERSTANDING", "Read issue", `Loaded issue #${issue.number} and its description.`);
  const comments = issue.comments ? await github<{ body: string }[]>(`/repos/${encoded}/issues/${input.number}/comments?per_page=20`) : [];
  add("UNDERSTANDING", "Read discussion", comments.length ? `Read ${comments.length} issue comments.` : "No discussion comments were present.");
  const treeResponse = await github<{ tree: TreeItem[]; truncated: boolean }>(`/repos/${encoded}/git/trees/${encodeURIComponent(repo.default_branch)}?recursive=1`);
  if (treeResponse.truncated || treeResponse.tree.length > MAX_FILES) throw new Error("This repository has too many files for the local MVP.");
  add("REPOSITORY EXPLORATION", "Loaded repository structure", `Indexed ${treeResponse.tree.filter((item) => item.type === "blob").length} files from ${repo.default_branch}.`);
  const terms = words(issue.title, issue.body ?? "", ...comments.map((comment) => comment.body));
  const paths = candidatePaths(treeResponse.tree, terms);
  add("REPOSITORY EXPLORATION", `Searched \"${terms.slice(0, 3).join(" ") || "issue context"}\"`, `Selected ${paths.length} likely implementation files.`);
  const candidates = await Promise.all(paths.map(async (path) => ({ path, content: await github<string>(`/repos/${encoded}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(repo.default_branch)}`, true) })));
  for (const candidate of candidates) add("REPOSITORY EXPLORATION", `Read ${candidate.path.split("/").pop()}`, `Loaded ${countLines(candidate.content)} lines for focused analysis.`);
  const prompt = `You are Codex Pilot. Propose a minimal patch for a public GitHub issue using only the supplied issue and file contents. Do not use shell, network, tools, or assumptions about unseen files. Do not execute code. You may edit only a supplied file and must return complete replacement content for it. Return JSON only, matching {"summary":string,"plan":string[],"edits":[{"path":string,"content":string,"reason":string}],"explanation":string[]}. If evidence is insufficient, return edits as [].\n\nISSUE\n#${issue.number}: ${issue.title}\n${issue.body ?? "(No description)"}\n\nCOMMENTS\n${comments.map((comment) => comment.body).join("\n---\n").slice(0, 6000) || "(No comments)"}\n\nFILES\n${candidates.map((candidate) => `--- ${candidate.path}\n${candidate.content.slice(0, 40000)}`).join("\n\n")}`;
  let proposal: Awaited<ReturnType<typeof runCodex>>;
  try { proposal = await runCodex(prompt); } catch (error) { return blankRun(issue, slug, activity, paths, error instanceof Error ? error.message : undefined); }
  const allowed = new Map(candidates.map((candidate) => [candidate.path, candidate.content]));
  const edits = (proposal.edits ?? []).filter((edit) => allowed.has(edit.path) && typeof edit.content === "string" && edit.content.length <= MAX_FILE_BYTES && edit.content !== allowed.get(edit.path)).slice(0, 6);
  if (!edits.length) return blankRun(issue, slug, activity, paths, "Codex did not return a supported source-file edit.", "codex");
  const files: FileChange[] = edits.map((edit) => {
    const before = allowed.get(edit.path) ?? ""; const diff = wholeFileDiff(edit.path, before, edit.content);
    return { path: edit.path, additions: countLines(edit.content), deletions: countLines(before), diff, reason: edit.reason || "Codex proposed this focused update." };
  });
  const patch = files.map((file) => file.diff).join("\n");
  add("GENERATING PATCH", "Validated patch", `Built a unified diff from ${files.length} inspected file${files.length === 1 ? "" : "s"}.`);
  return { issue: { number: issue.number, title: issue.title, repository: slug, url: issue.html_url }, status: "completed", source: "codex", summary: proposal.summary || "Codex proposed a focused patch from the inspected files.", plan: (proposal.plan ?? []).slice(0, 6), activity, inspectedFiles: paths, files, explanation: (proposal.explanation ?? []).slice(0, 5), patch };
}
