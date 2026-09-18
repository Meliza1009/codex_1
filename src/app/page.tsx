"use client";

import { FormEvent, useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import type { Activity, InspectedFile, PilotRun, RunError, RunEvent, VerificationReport, VerificationStage } from "@/lib/pilot-types";

const examples = [
  { label: "clsx #100", url: "https://github.com/lukeed/clsx/issues/100" },
  { label: "uuid #97", url: "https://github.com/google/uuid/issues/97" },
  { label: "clsx #112", url: "https://github.com/lukeed/clsx/issues/112" },
];

const configuredHostedPreview = process.env.NEXT_PUBLIC_CODEX_PILOT_LIVE_RUNS === "false";
const subscribeToLocation = () => () => {};
const hostedPreviewFromLocation = () => configuredHostedPreview || window.location.hostname.endsWith(".vercel.app");

const sample: PilotRun = {
  issue: { number: 123, title: "Dark mode resets after page refresh", repository: "acme/astro-ui", url: "https://github.com/acme/astro-ui/issues/123" },
  repository: { branch: "main", language: "TypeScript", public: true, url: "https://github.com/acme/astro-ui" },
  source: "sample",
  status: "completed",
  summary: "Theme state is recreated from the default after a refresh. The patch restores the saved selection before applying it.",
  stages: [
    { id: "understanding", label: "Understanding issue", status: "complete", elapsedMs: 1200 },
    { id: "exploring", label: "Exploring repository", status: "complete", elapsedMs: 4100 },
    { id: "evidence", label: "Evidence gate", status: "complete", elapsedMs: 4600 },
    { id: "planning", label: "Planning", status: "complete", elapsedMs: 5200 },
    { id: "writing", label: "Generating patch", status: "complete", elapsedMs: 7600 },
    { id: "reviewing", label: "Reviewing patch", status: "complete", elapsedMs: 11300 },
    { id: "revising", label: "Revising patch", status: "skipped" },
    { id: "verifying", label: "Verifying patch", status: "complete", elapsedMs: 14500 },
  ],
  activity: [
    { id: "1", stage: "understanding", action: "Parsed issue requirements", detail: "Loaded issue #123 and its description.", elapsedMs: 400, status: "completed" },
    { id: "2", stage: "understanding", action: "Read discussion", detail: "No issue comments were present.", elapsedMs: 1200, status: "completed" },
    { id: "3", stage: "exploring", action: "Scanned repository tree", detail: "184 candidate source files discovered on main.", elapsedMs: 2300, status: "completed" },
    { id: "4", stage: "exploring", action: "Search: theme persistence refresh", detail: "3 likely matches found.", elapsedMs: 2800, status: "completed" },
    { id: "5", stage: "exploring", action: "Read src/hooks/useTheme.ts", detail: "Theme state initializes with a hard-coded default.", elapsedMs: 3300, status: "completed" },
    { id: "6", stage: "exploring", action: "Read src/providers/ThemeProvider.tsx", detail: "Theme applies but never persists the selection.", elapsedMs: 3800, status: "completed" },
    { id: "7", stage: "exploring", action: "Search: ThemeProvider", detail: "Follow-up search found the global state owner.", elapsedMs: 4100, status: "completed" },
    { id: "8", stage: "evidence", action: "Evidence sufficient", detail: "Theme initialization and persistence logic were both located.", elapsedMs: 4600, status: "completed" },
    { id: "9", stage: "planning", action: "Created implementation plan", detail: "4 focused steps generated.", elapsedMs: 5200, status: "completed" },
    { id: "10", stage: "writing", action: "Modified 2 source files", detail: "Generated a reviewable unified diff.", elapsedMs: 7600, status: "completed" },
    { id: "11", stage: "reviewing", action: "Issue requirements covered", detail: "Reviewer check passed.", elapsedMs: 9000, status: "completed" },
    { id: "12", stage: "reviewing", action: "Only relevant files modified", detail: "Reviewer check passed.", elapsedMs: 9700, status: "completed" },
    { id: "13", stage: "verifying", action: "Created temporary workspace", detail: "Cloned clean copy of acme/astro-ui into .codex-pilot/workspaces/sample-123.", elapsedMs: 12000, status: "completed" },
    { id: "14", stage: "verifying", action: "Patch applied cleanly", detail: "2 files modified without conflicts.", elapsedMs: 12500, status: "completed" },
    { id: "15", stage: "verifying", action: "Validation passed", detail: "Build passed, 14/14 tests passed, theme persistence verified.", elapsedMs: 14500, status: "completed" },
  ],
  searches: [{ query: "theme persistence refresh", matches: 3, detail: "Ranked relevant state and provider files." }],
  inspectedFiles: [
    { path: "src/hooks/useTheme.ts", reason: "This hook owns theme state initialization referenced by the issue.", finding: "Theme state initializes with a hard-coded default.", lines: 42 },
    { path: "src/providers/ThemeProvider.tsx", reason: "This provider applies the active theme to the document.", finding: "The selected value is never persisted.", lines: 57 },
    { path: "src/app/layout.tsx", reason: "Checked for a conflicting theme initialization path.", finding: "No conflicting theme initialization found.", lines: 31 },
  ],
  plan: [
    { id: "1", title: "Locate theme initialization", detail: "src/hooks/useTheme.ts", status: "completed" },
    { id: "2", title: "Add persistence mechanism", detail: "Store selection through the existing hook setter.", status: "completed" },
    { id: "3", title: "Restore persisted preference", detail: "Apply the restored theme after browser hydration.", status: "completed" },
    { id: "4", title: "Preserve external API", detail: "No calling-code changes required.", status: "completed" },
  ],
  files: [
    {
      path: "src/hooks/useTheme.ts",
      additions: 14,
      deletions: 3,
      reason: "Initializes from browser storage and writes changes back to storage.",
      diff: "@@ -4,10 +4,21 @@\n export function useTheme() {\n-  const [theme, setTheme] = useState<Theme>(\"light\");\n+  const [theme, setTheme] = useState<Theme>(() => {\n+    if (typeof window === \"undefined\") return \"light\";\n+    return (localStorage.getItem(\"theme\") as Theme) ?? \"light\";\n+  });\n \n-  return { theme, setTheme };\n+  const updateTheme = (nextTheme: Theme) => {\n+    setTheme(nextTheme);\n+    localStorage.setItem(\"theme\", nextTheme);\n+  };\n+\n+  return { theme, setTheme: updateTheme };\n }",
    },
    {
      path: "src/providers/ThemeProvider.tsx",
      additions: 7,
      deletions: 1,
      reason: "Applies the restored value after hydration.",
      diff: "@@ -12,7 +12,13 @@\n-  useEffect(() => document.documentElement.dataset.theme = theme, [theme]);\n+  useEffect(() => {\n+    document.documentElement.dataset.theme = theme;\n+    document.documentElement.style.colorScheme = theme;\n+  }, [theme]);",
    },
  ],
  explanations: [
    { path: "src/hooks/useTheme.ts", explanation: "Stores the selected theme and initializes state from the saved browser value.", coverage: ["Theme survives refresh", "Server rendering stays safe"] },
    { path: "src/providers/ThemeProvider.tsx", explanation: "Ensures the restored preference is applied when the provider initializes.", coverage: ["Existing provider API unchanged"] },
  ],
  review: {
    status: "passed",
    checks: [
      { label: "Issue requirements covered", status: "passed" },
      { label: "Only relevant files modified", status: "passed" },
      { label: "Existing public API preserved", status: "passed" },
    ],
  },
  evidence: {
    decision: "ready_to_patch",
    enoughEvidence: true,
    confidence: 0.82,
    reason: "Theme initialization and persistence logic were both located.",
    evidence: [
      { path: "src/hooks/useTheme.ts", relevance: "Owns theme state.", findings: ["Theme defaults to light.", "No persistence is present."] },
      { path: "src/providers/ThemeProvider.tsx", relevance: "Applies the selected theme globally.", findings: ["Consumes the theme hook."] },
    ],
    additionalSearches: [],
    repeatSearches: [],
  },
  confidence: "high",
  limitations: ["Validated in isolated temporary workspace; upstream repo untouched."],
  metrics: { elapsedMs: 14500, filesIndexed: 184, filesInspected: 3, searches: 2, explorationRounds: 2, revisions: 0, filesChanged: 2, additions: 21, deletions: 4 },
  patch: "diff --git a/src/hooks/useTheme.ts b/src/hooks/useTheme.ts\n@@ -4,10 +4,21 @@\n export function useTheme() {\n-  const [theme, setTheme] = useState<Theme>(\"light\");\n+  const [theme, setTheme] = useState<Theme>(() => {\n+    if (typeof window === \"undefined\") return \"light\";\n+    return (localStorage.getItem(\"theme\") as Theme) ?? \"light\";\n+  });\n \n-  return { theme, setTheme };\n+  const updateTheme = (nextTheme: Theme) => {\n+    setTheme(nextTheme);\n+    localStorage.setItem(\"theme\", nextTheme);\n+  };\n+\n+  return { theme, setTheme: updateTheme };\n }\n",
  originalPatch: "diff --git a/src/hooks/useTheme.ts b/src/hooks/useTheme.ts\n@@ -4,10 +4,21 @@\n export function useTheme() {\n-  const [theme, setTheme] = useState<Theme>(\"light\");\n+  const [theme, setTheme] = useState<Theme>(() => {\n+    if (typeof window === \"undefined\") return \"light\";\n+    return (localStorage.getItem(\"theme\") as Theme) ?? \"light\";\n+  });\n \n-  return { theme, setTheme };\n+  const updateTheme = (nextTheme: Theme) => {\n+    setTheme(nextTheme);\n+    localStorage.setItem(\"theme\", nextTheme);\n+  };\n+\n+  return { theme, setTheme: updateTheme };\n }\n",
  finalPatch: "diff --git a/src/hooks/useTheme.ts b/src/hooks/useTheme.ts\n@@ -4,10 +4,21 @@\n export function useTheme() {\n-  const [theme, setTheme] = useState<Theme>(\"light\");\n+  const [theme, setTheme] = useState<Theme>(() => {\n+    if (typeof window === \"undefined\") return \"light\";\n+    return (localStorage.getItem(\"theme\") as Theme) ?? \"light\";\n+  });\n \n-  return { theme, setTheme };\n+  const updateTheme = (nextTheme: Theme) => {\n+    setTheme(nextTheme);\n+    localStorage.setItem(\"theme\", nextTheme);\n+  };\n+\n+  return { theme, setTheme: updateTheme };\n }\n",
  patchVersions: [
    {
      version: 1,
      label: "Patch v1",
      patch: "diff --git a/src/hooks/useTheme.ts b/src/hooks/useTheme.ts\n@@ -4,10 +4,21 @@\n export function useTheme() {\n-  const [theme, setTheme] = useState<Theme>(\"light\");\n+  const [theme, setTheme] = useState<Theme>(() => {\n+    if (typeof window === \"undefined\") return \"light\";\n+    return (localStorage.getItem(\"theme\") as Theme) ?? \"light\";\n+  });\n \n-  return { theme, setTheme };\n+  const updateTheme = (nextTheme: Theme) => {\n+    setTheme(nextTheme);\n+    localStorage.setItem(\"theme\", nextTheme);\n+  };\n+\n+  return { theme, setTheme: updateTheme };\n }\n",
      files: [
        {
          path: "src/hooks/useTheme.ts",
          additions: 14,
          deletions: 3,
          reason: "Initializes from browser storage and writes changes back to storage.",
          diff: "@@ -4,10 +4,21 @@\n export function useTheme() {\n-  const [theme, setTheme] = useState<Theme>(\"light\");\n+  const [theme, setTheme] = useState<Theme>(() => {\n+    if (typeof window === \"undefined\") return \"light\";\n+    return (localStorage.getItem(\"theme\") as Theme) ?? \"light\";\n+  });\n \n-  return { theme, setTheme };\n+  const updateTheme = (nextTheme: Theme) => {\n+    setTheme(nextTheme);\n+    localStorage.setItem(\"theme\", nextTheme);\n+  };\n+\n+  return { theme, setTheme: updateTheme };\n }",
        },
        {
          path: "src/providers/ThemeProvider.tsx",
          additions: 7,
          deletions: 1,
          reason: "Applies the restored value after hydration.",
          diff: "@@ -12,7 +12,13 @@\n-  useEffect(() => document.documentElement.dataset.theme = theme, [theme]);\n+  useEffect(() => {\n+    document.documentElement.dataset.theme = theme;\n+    document.documentElement.style.colorScheme = theme;\n+  }, [theme]);",
        },
      ],
      explanations: [
        { path: "src/hooks/useTheme.ts", explanation: "Stores the selected theme and initializes state from the saved browser value.", coverage: ["Theme survives refresh", "Server rendering stays safe"] },
        { path: "src/providers/ThemeProvider.tsx", explanation: "Ensures the restored preference is applied when the provider initializes.", coverage: ["Existing provider API unchanged"] },
      ],
      createdMs: 7600,
    },
  ],
  verification: {
    result: "verified",
    verdictLabel: "VERIFIED FIX",
    summary: "Temporary workspace created at .codex-pilot/workspaces/sample-123. Patch applied cleanly. Build and existing tests passed (14/14). Theme persistence verified.",
    durationMs: 3200,
    workspace: ".codex-pilot/workspaces/sample-123",
    commandsDetected: { build: "npm run build", test: "npm test" },
    stages: [
      { id: "workspace", name: "Temporary workspace", status: "passed", detail: "Workspace created at .codex-pilot/workspaces/sample-123" },
      { id: "patch", name: "Patch application", status: "passed", detail: "2 files modified cleanly (src/hooks/useTheme.ts, src/providers/ThemeProvider.tsx)" },
      { id: "detect", name: "Command detection", status: "passed", detail: "Detected: build: npm run build · test: npm test" },
      { id: "build", name: "Static/build check", status: "passed", detail: "✓ npm run build passed in 1.4s" },
      { id: "test", name: "Existing tests", status: "passed", detail: "✓ npm test passed: 14/14 passed" },
      { id: "issue", name: "Issue verification", status: "passed", detail: "✓ Theme persistence after refresh verified" },
    ],
  },
};

const iconPaths = {
  arrow: "M5 12h14m-6-6 6 6-6 6",
  play: "m8 5 11 7-11 7V5Z",
  download: "M12 3v12m0 0 4-4m4 4-4m4 4-4m-5 8h18",
  copy: "M8 8h11v11H8z M5 16H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1",
  external: "M14 5h5v5m0-5-8 8 M19 14v5H5V5h5",
  chevron: "m9 18 6-6-6-6",
  close: "m6 6 12 12M18 6 6 18",
  search: "m21 21-4.35-4.35m1.35-5.15a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0Z",
  file: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z M14 2v6h6",
  check: "m5 13 4 4L19 7",
} as const;

function Icon({ name }: { name: keyof typeof iconPaths }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d={iconPaths[name]} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function formatTime(ms: number) {
  return `${(ms / 1000).toFixed(1)}s`;
}

function liveShell(issue: PilotRun["issue"], repository: PilotRun["repository"]): Partial<PilotRun> {
  return {
    issue,
    repository,
    source: "live",
    status: "needs-review",
    summary: "",
    stages: sample.stages.map((stage, index) => ({
      ...stage,
      status: index === 0 ? "active" : "pending",
      elapsedMs: undefined,
    })),
    activity: [],
    searches: [],
    inspectedFiles: [],
    plan: [],
    files: [],
    explanations: [],
    review: { status: "warning", checks: [] },
    confidence: "low",
    limitations: [],
    metrics: { elapsedMs: 0, filesIndexed: 0, filesInspected: 0, searches: 0, explorationRounds: 0, revisions: 0, filesChanged: 0, additions: 0, deletions: 0 },
    patch: "",
    patchVersions: [],
  };
}

function numberedDiff(diff: string) {
  let before = 0;
  let after = 0;
  return diff.split("\n").map((text, index) => {
    const hunk = text.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      before = Number(hunk[1]);
      after = Number(hunk[2]);
      return { text, index, before: "", after: "", kind: "hunk" };
    }
    if (text.startsWith("\\ No newline") || text.startsWith("diff ") || text.startsWith("---") || text.startsWith("+++")) {
      return { text, index, before: "", after: "", kind: "meta" };
    }
    if (text.startsWith("+")) return { text, index, before: "", after: String(after++), kind: "add" };
    if (text.startsWith("-")) return { text, index, before: String(before++), after: "", kind: "remove" };
    return { text, index, before: text ? String(before++) : "", after: text ? String(after++) : "", kind: "context" };
  });
}

export default function Home() {
  const [url, setUrl] = useState("");
  const [run, setRun] = useState<Partial<PilotRun> | null>(null);
  const [tab, setTab] = useState<"diff" | "plan" | "explanation" | "review" | "verification">("diff");
  const [selectedVersion, setSelectedVersion] = useState<number | undefined>(undefined);
  const [fileIndex, setFileIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<RunError | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [how, setHow] = useState(false);

  const hostedPreview = useSyncExternalStore(subscribeToLocation, hostedPreviewFromLocation, () => configuredHostedPreview);
  const active = (run || sample) as PilotRun;
  const activeStage = active.stages.find((stage) => stage.status === "active");

  useEffect(() => {
    document.title = loading
      ? `Codex Pilot · Investigating ${active.issue.repository}`
      : verifying
      ? "Codex Pilot · Verifying patch"
      : active.verification?.result === "verified"
      ? "Codex Pilot · Verified fix"
      : active.files.length
      ? "Codex Pilot · Patch proposed"
      : "Codex Pilot — Autonomous GitHub Issue Solver";
  }, [active.files.length, active.issue.repository, active.verification?.result, loading, verifying]);

  function receive(event: RunEvent) {
    if (event.type === "context") {
      setRun(liveShell(event.issue, event.repository));
      return;
    }
    if (event.type === "completed") {
      setRun(event.run);
      setFileIndex(0);
      setTab("diff");
      setLoading(false);
      return;
    }
    if (event.type === "failed") {
      if (event.run) setRun(event.run);
      setError(event.error);
      setLoading(false);
      return;
    }
    setRun((previous) => {
      if (!previous) return previous;
      if (event.type === "stage") return { ...previous, stages: previous.stages?.map((stage) => (stage.id === event.stage.id ? event.stage : stage)) };
      if (event.type === "activity") return { ...previous, activity: [...(previous.activity || []), event.activity] };
      if (event.type === "search") return { ...previous, searches: [...(previous.searches || []), event.search] };
      if (event.type === "inspection") return { ...previous, inspectedFiles: [...(previous.inspectedFiles || []).filter((file) => file.path !== event.inspection.path), event.inspection] };
      if (event.type === "evidence") return { ...previous, evidence: event.evidence };
      if (event.type === "plan") return { ...previous, plan: event.plan };
      if (event.type === "verification") return { ...previous, verification: event.verification };
      return previous;
    });
  }

  async function start(event: FormEvent, supplied?: string) {
    event.preventDefault();
    if (loading || verifying) return;
    const issueUrl = supplied || url;
    setError(null);
    setFileIndex(0);
    if (!issueUrl.trim()) {
      setRun(null);
      setTab("diff");
      return;
    }
    if (hostedPreview) {
      setError({
        code: "hosted_preview",
        title: "Live runs are available locally",
        message: "This hosted preview intentionally shows a sample investigation. Run Codex Pilot locally to investigate a public issue.",
      });
      return;
    }
    setRun(null);
    setLoading(true);
    try {
      const response = await fetch("/api/runs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ issueUrl }) });
      if (!response.ok || !response.body) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || "Could not start Codex Pilot.");
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let terminal = false;
      const consume = (message: string) => {
        const data = message.split("\n").find((line) => line.startsWith("data: "));
        if (!data) return;
        const parsed = JSON.parse(data.slice(6)) as RunEvent;
        if (parsed.type === "completed" || parsed.type === "failed") terminal = true;
        receive(parsed);
      };
      try {
        for (;;) {
          const part = await reader.read();
          buffer += decoder.decode(part.value || new Uint8Array(), { stream: !part.done });
          const messages = buffer.replace(/\r\n/g, "\n").split("\n\n");
          buffer = messages.pop() || "";
          messages.forEach(consume);
          if (part.done) {
            if (buffer.trim()) consume(buffer);
            break;
          }
        }
      } finally {
        reader.releaseLock();
      }
      if (!terminal) throw new Error("The investigation connection ended before a result arrived. Please retry.");
    } catch (caught) {
      setError({
        code: "network_error",
        title: "Investigation interrupted",
        message: caught instanceof Error ? caught.message : "Check your connection and try again.",
        retryable: true,
      });
      setRun((previous) => (previous ? { ...previous, stages: previous.stages?.map((stage) => ({ ...stage, status: stage.status === "active" ? "failed" : stage.status === "pending" ? "skipped" : stage.status })) } : previous));
    } finally {
      setLoading(false);
    }
  }

  async function startVerification() {
    if (verifying || loading || !active.patch) return;
    setError(null);
    setTab("verification");

    if (hostedPreview || active.source === "sample") {
      setVerifying(true);
      setRun((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          stages: prev.stages?.map((s) => (s.id === "verifying" ? { ...s, status: "active", elapsedMs: undefined } : s)),
        };
      });

      const demoSteps: { stage: VerificationStage; delay: number }[] = [
        { stage: { id: "workspace", name: "Temporary workspace", status: "passed", detail: "Creating disposable workspace at .codex-pilot/workspaces/sample-123..." }, delay: 400 },
        { stage: { id: "patch", name: "Patch application", status: "passed", detail: "Patch applied cleanly (2 files modified)" }, delay: 600 },
        { stage: { id: "detect", name: "Command detection", status: "passed", detail: "Detected commands: build: npm run build · test: npm test" }, delay: 500 },
        { stage: { id: "build", name: "Static/build check", status: "passed", detail: "✓ npm run build passed in 1.4s" }, delay: 700 },
        { stage: { id: "test", name: "Existing tests", status: "passed", detail: "✓ npm test passed: 14/14 passed" }, delay: 800 },
        { stage: { id: "issue", name: "Issue verification", status: "passed", detail: "✓ Theme persistence after refresh verified" }, delay: 500 },
      ];

      const currentStages: VerificationStage[] = [];
      for (const step of demoSteps) {
        await new Promise((r) => setTimeout(r, step.delay));
        currentStages.push(step.stage);
        setRun((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            verification: {
              result: "verified",
              verdictLabel: "VERIFIED FIX",
              summary: "Temporary workspace created at .codex-pilot/workspaces/sample-123. Patch applied cleanly. Build and existing tests passed (14/14). Theme persistence verified.",
              durationMs: 3500,
              workspace: ".codex-pilot/workspaces/sample-123",
              commandsDetected: { build: "npm run build", test: "npm test" },
              stages: [...currentStages],
            },
          };
        });
      }

      setRun((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          stages: prev.stages?.map((s) => (s.id === "verifying" ? { ...s, status: "complete", elapsedMs: 3500 } : s)),
        };
      });
      setVerifying(false);
      return;
    }

    setVerifying(true);
    setRun((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        stages: prev.stages?.map((s) => (s.id === "verifying" ? { ...s, status: "active", elapsedMs: undefined } : s)),
      };
    });

    try {
      const response = await fetch("/api/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repositoryUrl: active.repository.url,
          branch: active.repository.branch,
          patch: active.patch,
          issue: active.issue,
          issueAnalysis: active.issueAnalysis,
          files: active.files,
        }),
      });

      if (!response.ok || !response.body) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || "Could not start patch verification.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      for (;;) {
        const part = await reader.read();
        buffer += decoder.decode(part.value || new Uint8Array(), { stream: !part.done });
        const messages = buffer.replace(/\r\n/g, "\n").split("\n\n");
        buffer = messages.pop() || "";

        for (const msg of messages) {
          const line = msg.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;
          const event = JSON.parse(line.slice(6)) as { type: string; stage?: VerificationStage; report?: VerificationReport };
          if (event.type === "step" && event.report) {
            const partial = event.report;
            setRun((prev) => {
              if (!prev) return prev;
              return {
                ...prev,
                verification: {
                  ...(prev.verification || {
                    result: "patch_applies_but_unverified",
                    verdictLabel: "PATCH PROPOSED — NOT VERIFIED",
                    summary: "Validation in progress...",
                    durationMs: 0,
                    stages: [],
                  }),
                  ...partial,
                },
              };
            });
          } else if (event.type === "completed" && event.report) {
            const report: VerificationReport = event.report;
            setRun((prev) => {
              if (!prev) return prev;
              return {
                ...prev,
                verification: report,
                stages: prev.stages?.map((s) =>
                  s.id === "verifying" ? { ...s, status: report.result === "verified" ? "complete" : "failed", elapsedMs: report.durationMs } : s
                ),
              };
            });
          }
        }
        if (part.done) break;
      }
    } catch (err) {
      setError({
        code: "verification_error",
        title: "Verification interrupted",
        message: err instanceof Error ? err.message : "Verification encountered an error.",
        retryable: true,
      });
      setRun((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          stages: prev.stages?.map((s) => (s.id === "verifying" ? { ...s, status: "failed" } : s)),
        };
      });
    } finally {
      setVerifying(false);
    }
  }

  const patch = active.patch || active.files.map((file) => file.diff).join("\n");

  function download() {
    const blob = new Blob([patch], { type: "text/x-diff" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `issue-${active.issue.number}-proposal.diff`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  function copy() {
    void navigator.clipboard.writeText(patch);
  }

  const stageActivity = (id: string) => active.activity.filter((item) => item.stage === id);

  return (
    <main className="min-h-screen bg-[#0d1117] text-[#c9d1d9]">
      <header className="border-b border-[#30363d] bg-[#161b22]">
        <div className="mx-auto flex h-14 max-w-[1440px] items-center justify-between px-4 sm:px-6">
          <Link className="flex items-center gap-2.5 font-semibold text-white" href="/">
            <span className="grid h-7 w-7 place-items-center rounded-md bg-[#238636] text-white">
              <Icon name="arrow" />
            </span>
            <span>Codex Pilot</span>
            <span className="hidden border-l border-[#30363d] pl-2.5 text-xs font-normal text-[#8b949e] sm:block">
              Issue investigation & patch verification workspace
            </span>
          </Link>
          <div className="flex items-center gap-2 text-xs text-[#8b949e]">
            <span className={(loading || verifying ? "animate-pulse bg-[#58a6ff]" : "bg-[#3fb950]") + " h-2 w-2 rounded-full"} />
            {loading ? activeStage?.label || "Starting" : verifying ? "Verifying patch…" : hostedPreview ? "Hosted sample" : "Local agent ready"}
          </div>
        </div>
      </header>

      <section className="border-b border-[#30363d] bg-[#161b22]">
        <div className="mx-auto max-w-[1440px] px-4 py-7 sm:px-6">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="font-mono text-[11px] font-medium uppercase tracking-[.16em] text-[#58a6ff]">
                Autonomous repository investigation & verification
              </p>
              <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
                From issue to verified fix.
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-[#8b949e]">
                Codex Pilot selectively explores public repositories, builds a reviewable patch, and validates it against disposable working copies.
              </p>
            </div>
            <div className="flex gap-2 text-xs text-[#8b949e]">
              <span className="rounded-full border border-[#30363d] bg-[#0d1117] px-2.5 py-1">Public issues</span>
              <span className="rounded-full border border-[#30363d] bg-[#0d1117] px-2.5 py-1">Isolated validation</span>
              <span className="rounded-full border border-[#30363d] bg-[#0d1117] px-2.5 py-1">No upstream touch</span>
            </div>
          </div>

          <form onSubmit={(event) => start(event)} className="mt-6 flex flex-col gap-2 sm:flex-row">
            <div className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-[#30363d] bg-[#0d1117] px-3 focus-within:border-[#58a6ff]">
              <Icon name="search" />
              <input
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                className="h-11 min-w-0 flex-1 bg-transparent font-mono text-sm text-[#c9d1d9] outline-none placeholder:text-[#484f58]"
                placeholder="github.com/owner/repository/issues/123"
                aria-label="GitHub issue URL"
              />
            </div>
            <button
              disabled={loading || verifying || hostedPreview}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-[#238636] px-4 text-sm font-medium text-white hover:bg-[#2ea043] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Icon name="play" />
              {loading ? "Investigating…" : hostedPreview ? "Live runs available locally" : "Run investigation"}
            </button>
          </form>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span
              className={
                (active.source === "sample" ? "border-[#d29922]/40 bg-[#d29922]/10 text-[#e3b341]" : "border-[#58a6ff]/40 bg-[#58a6ff]/10 text-[#79c0ff]") +
                " rounded-full border px-2 py-1 font-mono text-[10px] font-semibold tracking-[.12em]"
              }
            >
              {active.source === "sample" ? "SAMPLE RUN" : "LIVE RUN"}
            </span>
            {hostedPreview ? (
              <span className="font-mono text-[11px] text-[#d29922]">DEMO MODE — live GitHub runs & verification are available locally</span>
            ) : (
              <>
                <span className="ml-1 text-xs text-[#8b949e]">Try an example:</span>
                {examples.map((example) => (
                  <button
                    key={example.url}
                    disabled={loading || verifying}
                    onClick={(event) => {
                      setUrl(example.url);
                      void start(event as unknown as FormEvent, example.url);
                    }}
                    className="font-mono text-xs text-[#58a6ff] hover:underline"
                  >
                    {example.label}
                  </button>
                ))}
              </>
            )}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[1440px] px-4 py-5 sm:px-6">
        {error && (
          <div role="alert" className="mb-5 rounded-md border border-[#f85149]/40 bg-[#f85149]/[.08] p-4">
            <p className="text-sm font-medium text-[#ff7b72]">{error.title}</p>
            <p className="mt-1 text-sm text-[#c9d1d9]">{error.message}</p>
            {error.retryable && (
              <button onClick={(event) => start(event as unknown as FormEvent)} className="mt-2 text-sm text-[#58a6ff] hover:underline">
                Try again
              </button>
            )}
          </div>
        )}

        <Repo run={active} copy={copy} download={download} openHow={() => setHow(true)} />

        <div className="mt-5 grid gap-5 xl:grid-cols-[350px_minmax(0,1fr)]">
          <aside className="space-y-5">
            <section className="rounded-md border border-[#30363d] bg-[#161b22]">
              <SectionTitle label="Agent activity" detail={loading || verifying ? "LIVE" : formatTime(active.metrics.elapsedMs)} />
              <div className="divide-y divide-[#21262d]">
                {active.stages.map((stage) => (
                  <Stage key={stage.id} stage={stage} activity={stageActivity(stage.id)} />
                ))}
              </div>
            </section>
            <Evidence run={active} expanded={expanded} setExpanded={setExpanded} />
          </aside>

          <section className="min-w-0 overflow-hidden rounded-md border border-[#30363d] bg-[#161b22]">
            <PatchHeader
              run={active}
              verifying={verifying}
              onVerify={startVerification}
              onViewDiff={() => setTab("diff")}
              onDownload={download}
            />

            <div className="flex flex-wrap gap-5 border-b border-[#30363d] px-4">
              {(["diff", "plan", "explanation", "review", "verification"] as const).map((name) => (
                <button
                  key={name}
                  onClick={() => setTab(name)}
                  className={
                    (tab === name ? "border-b-2 border-[#f78166] text-white" : "border-b-2 border-transparent text-[#8b949e]") +
                    " -mb-px py-3 text-sm capitalize flex items-center gap-1.5"
                  }
                >
                  {name === "verification" ? "Patch verification" : name}
                  {name === "diff" && <span className="ml-1.5 font-mono text-xs text-[#8b949e]">{active.files.length}</span>}
                  {name === "review" && (
                    active.review?.verdict === "approved" || (active.review?.status === "passed" && active.status === "completed") ? (
                      <span className="ml-1 text-[#3fb950] font-bold">✓</span>
                    ) : active.review ? (
                      <span className="ml-1 text-[#d29922] font-bold">!</span>
                    ) : null
                  )}
                  {name === "verification" && active.verification?.result === "verified" && (
                    <span className="ml-1 text-[#3fb950] font-bold">✓</span>
                  )}
                  {name === "verification" && active.verification && active.verification.result !== "verified" && (
                    <span className="ml-1 text-[#f85149] font-bold">!</span>
                  )}
                </button>
              ))}
            </div>

            {tab === "diff" && (
              <Diff
                run={active}
                index={fileIndex}
                setIndex={setFileIndex}
                selectedVersion={selectedVersion}
                setSelectedVersion={setSelectedVersion}
              />
            )}
            {tab === "plan" && <Plan run={active} />}
            {tab === "explanation" && <Explanation run={active} />}
            {tab === "review" && <ReviewPanel run={active} />}
            {tab === "verification" && (
              <VerificationPanel
                run={active}
                verifying={verifying}
                onVerify={startVerification}
              />
            )}
          </section>
        </div>
      </section>

      {how && <How run={active} close={() => setHow(false)} />}
    </main>
  );
}

function SectionTitle({ label, detail }: { label: string; detail?: string }) {
  return (
    <div className="flex items-center justify-between border-b border-[#30363d] px-4 py-3">
      <h3 className="text-sm font-medium text-white">{label}</h3>
      {detail && <span className="font-mono text-[10px] text-[#8b949e]">{detail}</span>}
    </div>
  );
}

function Repo({ run, copy, download, openHow }: { run: PilotRun; copy: () => void; download: () => void; openHow: () => void }) {
  return (
    <div className="rounded-md border border-[#30363d] bg-[#161b22] p-4 sm:flex sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="flex items-center gap-2 font-mono text-sm">
          <span className="font-medium text-[#58a6ff]">{run.issue.repository}</span>
          <span className="text-[#484f58]">/</span>
          <span>#{run.issue.number}</span>
        </div>
        <h2 className="mt-1 truncate text-base font-medium text-white">{run.issue.title}</h2>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[#8b949e]">
          <span>branch <b className="font-mono font-normal text-[#c9d1d9]">{run.repository.branch}</b></span>
          <span>language <b className="font-normal text-[#c9d1d9]">{run.repository.language}</b></span>
          <a href={run.issue.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[#58a6ff] hover:underline">
            View issue <Icon name="external" />
          </a>
        </div>
      </div>
      <div className="mt-4 flex gap-2 sm:mt-0">
        <button onClick={openHow} className="rounded-md border border-[#30363d] px-3 py-2 text-xs hover:bg-[#21262d]">
          How it works
        </button>
        {run.patch && (
          <>
            <button onClick={copy} className="inline-flex items-center gap-1.5 rounded-md border border-[#30363d] px-3 py-2 text-xs hover:bg-[#21262d]">
              <Icon name="copy" />Copy
            </button>
            <button onClick={download} className="inline-flex items-center gap-1.5 rounded-md bg-[#238636] px-3 py-2 text-xs font-medium text-white hover:bg-[#2ea043]">
              <Icon name="download" />Download
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function PatchHeader({
  run,
  verifying,
  onVerify,
  onViewDiff,
  onDownload,
}: {
  run: PilotRun;
  verifying: boolean;
  onVerify: () => void;
  onViewDiff: () => void;
  onDownload: () => void;
}) {
  const refused = run.status === "refused";
  const hasPatch = Boolean(run.patch && run.files.length > 0);
  const statusLabel = refused
    ? hasPatch
      ? "PATCH PROPOSED — REVIEW UNRESOLVED"
      : "NO PATCH PROPOSED"
    : run.verification
    ? run.verification.verdictLabel
    : run.files.length
    ? "PATCH PROPOSED — NOT VERIFIED"
    : "Investigation in progress";

  const statusColor = refused
    ? "text-[#d29922]"
    : run.verification?.result === "verified"
    ? "text-[#3fb950]"
    : run.verification?.result === "tests_failed" || run.verification?.result === "build_failed" || run.verification?.result === "patch_failed"
    ? "text-[#f85149]"
    : "text-[#d29922]";

  return (
    <div className="border-b border-[#30363d] bg-[#0d1117] px-4 py-4 sm:flex sm:items-center sm:justify-between">
      <div>
        <p className={`${statusColor} font-mono text-[11px] font-medium uppercase tracking-[.14em]`}>
          {statusLabel}
        </p>
        <p className="mt-1 text-lg font-semibold text-white">
          {refused && !hasPatch ? (
            run.refusal?.kind === "budget_exhausted" ? "Exploration budget exhausted" : run.refusal?.kind === "out_of_scope" ? "Required capability unavailable" : "Patch not approved"
          ) : (
            <>
              {run.metrics.filesChanged || run.files.length} files modified{" "}
              <span className="ml-2 font-mono text-sm font-normal text-[#3fb950]">+{run.metrics.additions}</span>{" "}
              <span className="font-mono text-sm font-normal text-[#f85149]">−{run.metrics.deletions}</span>
              {refused && hasPatch && (
                <span className="ml-2 rounded-full border border-[#d29922]/40 bg-[#d29922]/10 px-2 py-0.5 text-xs font-normal text-[#e3b341]">
                  Review unapproved
                </span>
              )}
            </>
          )}
        </p>
      </div>

      {run.patch && (
        <div className="mt-4 flex flex-wrap items-center gap-2 sm:mt-0">
          <button
            onClick={onViewDiff}
            className="inline-flex items-center gap-1 rounded-md border border-[#30363d] bg-[#161b22] px-3 py-1.5 text-xs text-[#c9d1d9] hover:bg-[#21262d]"
          >
            View Diff
          </button>
          <button
            onClick={onVerify}
            disabled={verifying}
            className="inline-flex items-center gap-1.5 rounded-md bg-[#238636] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#2ea043] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Icon name="check" />
            {verifying ? "Verifying…" : "Verify Patch"}
          </button>
          <button
            onClick={onDownload}
            className="inline-flex items-center gap-1 rounded-md border border-[#30363d] bg-[#161b22] px-3 py-1.5 text-xs text-[#c9d1d9] hover:bg-[#21262d]"
          >
            <Icon name="download" />
            Download Patch
          </button>
        </div>
      )}
    </div>
  );
}

function Stage({ stage, activity }: { stage: PilotRun["stages"][number]; activity: Activity[] }) {
  const active = stage.status === "active";
  return (
    <div className="px-4 py-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className={
              (active ? "animate-spin border-[#58a6ff] border-t-transparent" : stage.status === "complete" ? "border-[#3fb950] bg-[#3fb950]" : stage.status === "failed" ? "border-[#d29922]" : "border-[#484f58]") +
              " h-3 w-3 rounded-full border"
            }
          />
          <p className={(active ? "text-[#79c0ff]" : "text-[#c9d1d9]") + " text-xs font-medium"}>
            {stage.label}
            {(stage.status === "skipped" || stage.status === "failed") && <span className="ml-2 text-[#8b949e]">— {stage.status}</span>}
          </p>
        </div>
        {stage.elapsedMs && <span className="font-mono text-[10px] text-[#6e7681]">{formatTime(stage.elapsedMs)}</span>}
      </div>
      {activity.length > 0 && (
        <div className="ml-5 mt-2 space-y-1 border-l border-[#30363d] pl-3">
          {activity.map((item) => (
            <p key={item.id} className={(item.status === "warning" ? "text-[#d29922]" : "text-[#8b949e]") + " text-[11px] leading-4"}>
              {item.action}
              <span className="block text-[#6e7681]">{item.detail}</span>
            </p>
          ))}
        </div>
      )}
      {active && <p className="ml-5 mt-2 font-mono text-[10px] text-[#58a6ff]">working…</p>}
    </div>
  );
}

function Evidence({ run, expanded, setExpanded }: { run: PilotRun; expanded: string | null; setExpanded: (path: string | null) => void }) {
  return (
    <section className="rounded-md border border-[#30363d] bg-[#161b22]">
      <SectionTitle label="Repository evidence" />
      <div className="p-3">
        <p className="mb-2 font-mono text-[10px] uppercase tracking-[.12em] text-[#8b949e]">Searches</p>
        {run.searches.map((search, index) => (
          <div key={search.id ?? `${search.round ?? 0}-${search.query}-${index}`} className="mb-4 rounded border border-[#30363d] bg-[#0d1117] px-3 py-2">
            <p className="font-mono text-xs text-[#c9d1d9]">{search.query}</p>
            <p className="mt-1 text-[11px] text-[#8b949e]">
              {search.matches} matches · {search.detail}
            </p>
          </div>
        ))}
        <p className="mb-2 font-mono text-[10px] uppercase tracking-[.12em] text-[#8b949e]">Files inspected</p>
        <div className="space-y-1">
          {run.inspectedFiles.map((item) => (
            <Inspection item={item} key={item.path} expanded={expanded === item.path} onToggle={() => setExpanded(expanded === item.path ? null : item.path)} />
          ))}
        </div>
      </div>
    </section>
  );
}

function Inspection({ item, expanded, onToggle }: { item: InspectedFile; expanded: boolean; onToggle: () => void }) {
  return (
    <div className="rounded border border-transparent hover:border-[#30363d] hover:bg-[#0d1117]">
      <button onClick={onToggle} className="flex w-full items-center gap-2 px-2 py-2 text-left">
        <span className="text-[#8b949e]"><Icon name="file" /></span>
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-[#c9d1d9]">{item.path}</span>
        <span className={(expanded ? "rotate-90" : "") + " text-[#8b949e] transition-transform"}><Icon name="chevron" /></span>
      </button>
      {expanded && (
        <div className="border-t border-[#30363d] px-3 py-3">
          <p className="font-mono text-[10px] uppercase tracking-[.12em] text-[#58a6ff]">Why this file</p>
          <p className="mt-1 text-xs leading-5 text-[#c9d1d9]">{item.reason}</p>
          <p className="mt-2 text-xs leading-5 text-[#8b949e]">{item.finding}</p>
        </div>
      )}
    </div>
  );
}

function Diff({
  run,
  index,
  setIndex,
  selectedVersion,
  setSelectedVersion,
}: {
  run: PilotRun;
  index: number;
  setIndex: (index: number) => void;
  selectedVersion?: number;
  setSelectedVersion?: (version: number) => void;
}) {
  const versions = run.patchVersions ?? [];
  const hasPatch = Boolean(run.files.length > 0 || versions.length > 0);

  if (run.status === "refused" && !hasPatch) {
    return (
      <div className="grid min-h-[440px] place-items-center p-6">
        <div className="max-w-xl rounded-md border border-[#d29922]/40 bg-[#d29922]/[.07] p-5">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-[#d29922]" />
            <p className="font-mono text-[11px] uppercase tracking-[.14em] text-[#e3b341]">
              Safe Refusal — No Patch Proposed
            </p>
          </div>
          <p className="mt-2 text-xs text-[#8b949e]">
            Codex Pilot safely stopped because the issue cannot be resolved solely from target repository evidence without speculative assumptions.
          </p>
          <div className="mt-4 rounded border border-[#30363d] bg-[#0d1117] p-3 text-sm leading-6 text-white">
            {run.refusal?.reason || "The available repository evidence was not sufficient for a trustworthy patch."}
          </div>
          {run.refusal?.missingEvidence && run.refusal.missingEvidence.length > 0 && (
            <div className="mt-3 space-y-1.5">
              <p className="font-mono text-[10px] uppercase tracking-[.1em] text-[#8b949e]">Missing Evidence Details</p>
              {run.refusal.missingEvidence.map((item, i) => (
                <div key={`${i}-${item.fact}`} className="rounded bg-[#161b22] px-3 py-2 text-xs">
                  <span className="font-medium text-[#e3b341]">{item.fact}</span>
                  <span className="block text-[#8b949e] mt-0.5">{item.whyNeeded}</span>
                </div>
              ))}
            </div>
          )}
          {run.refusal?.code && (
            <p className="mt-3 font-mono text-[11px] text-[#8b949e]">
              Refusal policy code: <span className="text-[#c9d1d9]">{run.refusal.code}</span>
            </p>
          )}
          <p className="mt-3 border-t border-[#30363d] pt-3 text-xs leading-5 text-[#8b949e]">
            <b className="text-[#c9d1d9]">Suggested next step:</b> {run.refusal?.suggestedNextStep || "Provide the missing repository references or clarify the requested change."}
          </p>
        </div>
      </div>
    );
  }

  const currentVersion = (selectedVersion && versions.find((v) => v.version === selectedVersion)) || (versions.length ? versions[versions.length - 1] : undefined);
  const files = currentVersion ? currentVersion.files : run.files;

  const file = files[index] || files[0];
  if (!file) return <div className="grid min-h-[440px] place-items-center text-sm text-[#8b949e]">Patch workspace waiting for evidence.</div>;

  return (
    <div>
      {/* Reviewer Refusal Warning Banner (when patch exists but review failed) */}
      {run.status === "refused" && (
        <div className="border-b border-[#d29922]/40 bg-[#d29922]/10 p-4">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-[#d29922]" />
            <p className="font-mono text-[11px] font-semibold uppercase tracking-[.14em] text-[#e3b341]">
              Reviewer Refusal — Unresolved Concerns
            </p>
          </div>
          <p className="mt-1 text-xs text-[#c9d1d9]">{run.refusal?.reason || "The reviewer found unaddressed concerns or missing requirements."}</p>
          {currentVersion?.reviewerFeedback && currentVersion.reviewerFeedback.length > 0 && (
            <div className="mt-2 rounded border border-[#d29922]/30 bg-[#0d1117] p-2 text-xs text-[#e3b341]">
              <span className="font-semibold">Reviewer Concerns:</span> {currentVersion.reviewerFeedback.join("; ")}
            </div>
          )}
          <p className="mt-2 text-[11px] text-[#8b949e]">
            The proposed code and unified diff below remain fully inspectable and downloadable.
          </p>
        </div>
      )}

      {/* Version Selector (when multiple patch versions exist) */}
      {versions.length > 1 && (
        <div className="flex items-center gap-2 border-b border-[#30363d] bg-[#161b22] px-4 py-2 text-xs">
          <span className="font-mono text-[11px] uppercase tracking-[.1em] text-[#8b949e]">Version:</span>
          {versions.map((v) => {
            const isSelected = (currentVersion?.version ?? versions[versions.length - 1].version) === v.version;
            return (
              <button
                key={v.version}
                onClick={() => {
                  setSelectedVersion?.(v.version);
                  setIndex(0);
                }}
                className={`rounded px-2.5 py-1 font-mono text-xs transition-colors ${
                  isSelected
                    ? "bg-[#238636] text-white font-medium"
                    : "bg-[#0d1117] text-[#8b949e] hover:text-white border border-[#30363d]"
                }`}
              >
                {v.label}
              </button>
            );
          })}
        </div>
      )}

      <div className="flex overflow-x-auto border-b border-[#30363d] bg-[#0d1117] px-3">
        {files.map((change, fileIndex) => (
          <button
            key={change.path}
            onClick={() => setIndex(fileIndex)}
            className={
              ((files[index] ? index === fileIndex : fileIndex === 0) ? "border-b-2 border-[#f78166] bg-[#161b22] text-white" : "border-b-2 border-transparent text-[#8b949e]") +
              " -mb-px shrink-0 px-3 py-3 font-mono text-xs"
            }
          >
            {change.path.split("/").pop()} <span className="ml-1 text-[#3fb950]">+{change.additions}</span>
            <span className="ml-1 text-[#f85149]">−{change.deletions}</span>
          </button>
        ))}
      </div>
      <div className="border-b border-[#30363d] px-4 py-3">
        <p className="font-mono text-xs text-[#58a6ff]">{file.path}</p>
        <p className="mt-1 text-xs text-[#8b949e]">{file.reason}</p>
      </div>
      <div className="max-h-[560px] overflow-auto bg-[#0d1117] p-3 font-mono text-xs leading-5">
        {numberedDiff(file.diff).map((line) => (
          <div
            key={line.index}
            className={
              (line.kind === "add"
                ? "bg-[#238636]/20 text-[#aff5b4]"
                : line.kind === "remove"
                ? "bg-[#da3633]/20 text-[#ffdcd7]"
                : line.kind === "hunk"
                ? "bg-[#1f6feb]/20 text-[#79c0ff]"
                : line.kind === "meta"
                ? "text-[#8b949e]"
                : "text-[#c9d1d9]") + " grid min-w-[620px] grid-cols-[3rem_3rem_1fr]"
            }
          >
            <span className="select-none border-r border-[#21262d] pr-2 text-right text-[#6e7681]">{line.before}</span>
            <span className="select-none border-r border-[#21262d] pr-2 text-right text-[#6e7681]">{line.after}</span>
            <span className="whitespace-pre-wrap px-3">{line.text || " "}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Plan({ run }: { run: PilotRun }) {
  return (
    <div className="p-5">
      <p className="max-w-3xl rounded-md border border-[#1f6feb]/40 bg-[#1f6feb]/10 p-4 text-sm leading-6 text-[#c9d1d9]">
        {run.summary || "Codex Pilot is collecting evidence before it proposes a patch."}
      </p>
      <div className="mt-6 divide-y divide-[#30363d] rounded-md border border-[#30363d]">
        {run.plan.map((step, index) => {
          const active = step.status === "investigating";
          const complete = step.status === "completed";
          return (
            <div className="flex gap-4 px-4 py-4" key={step.id}>
              <span
                className={
                  (active ? "border-[#58a6ff] border-t-transparent animate-spin" : complete ? "border-[#3fb950] bg-[#3fb950]" : step.status === "warning" ? "border-[#d29922]" : "border-[#484f58]") +
                  " mt-0.5 h-4 w-4 shrink-0 rounded-full border"
                }
              />
              <span className="font-mono text-xs text-[#58a6ff]">{String(index + 1).padStart(2, "0")}</span>
              <div className="min-w-0">
                <p className="text-sm text-white">{step.title}</p>
                <p className="mt-1 text-xs text-[#8b949e]">{step.detail}</p>
                {step.paths?.length ? <p className="mt-2 truncate font-mono text-[11px] text-[#79c0ff]">{step.paths.join(" · ")}</p> : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Explanation({ run }: { run: PilotRun }) {
  return (
    <div className="p-5">
      <div className="space-y-5">
        {run.explanations.map((item) => (
          <div key={item.path} className="border-l-2 border-[#58a6ff] pl-4">
            <p className="font-mono text-xs text-[#58a6ff]">{item.path}</p>
            <p className="mt-2 text-sm leading-6 text-[#c9d1d9]">{item.explanation}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {item.coverage.map((coverage) => (
                <span key={coverage} className="rounded-full border border-[#238636]/60 bg-[#238636]/10 px-2 py-1 text-[10px] text-[#aff5b4]">
                  {coverage}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-8 grid gap-4 lg:grid-cols-2">
        <div className="rounded-md border border-[#30363d] bg-[#0d1117] p-4">
          <p className="font-mono text-[10px] uppercase tracking-[.12em] text-[#8b949e]">Patch review</p>
          {run.review.checks.map((check) => (
            <p key={check.label} className={(check.status === "passed" ? "text-[#aff5b4]" : "text-[#e3b341]") + " mt-3 text-xs"}>
              {check.status === "passed" ? "✓" : "!"} {check.label}
            </p>
          ))}
        </div>
        <div className="rounded-md border border-[#d29922]/40 bg-[#d29922]/[.07] p-4">
          <p className="font-mono text-[10px] uppercase tracking-[.12em] text-[#e3b341]">Not verified</p>
          {run.limitations.map((item) => (
            <p key={item} className="mt-3 text-xs text-[#c9d1d9]">
              ! {item}
            </p>
          ))}
        </div>
      </div>
    </div>
  );
}

function ReviewPanel({ run }: { run: PilotRun }) {
  const review = run.review;
  const isApproved = review?.verdict === "approved" || (review?.status === "passed" && run.status === "completed");

  return (
    <div className="p-5 space-y-6">
      <div className="rounded-md border border-[#30363d] bg-[#0d1117] p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span
              className={`rounded-full border px-2.5 py-1 font-mono text-[10px] font-semibold tracking-[.12em] ${
                isApproved
                  ? "border-[#3fb950] bg-[#3fb950]/10 text-[#aff5b4]"
                  : "border-[#d29922] bg-[#d29922]/10 text-[#e3b341]"
              }`}
            >
              {isApproved ? "REVIEW APPROVED" : "REVIEW REFUSED"}
            </span>
            <span className="font-mono text-xs text-[#8b949e]">
              {review?.revisionCount ? `${review.revisionCount} revision round${review.revisionCount === 1 ? "" : "s"}` : "Initial review"}
            </span>
          </div>
          <p className="mt-2 text-sm text-[#c9d1d9]">
            {isApproved
              ? "All reviewer safety and requirement checks passed without blocking concerns."
              : run.refusal?.reason || review?.feedback?.join(" ") || "The reviewer found unaddressed concerns or missing requirements."}
          </p>
        </div>
      </div>

      {review?.feedback && review.feedback.length > 0 && (
        <div className="space-y-2">
          <h4 className="font-mono text-[10px] uppercase tracking-[.12em] text-[#8b949e]">
            Reviewer Feedback & Concerns
          </h4>
          <div className="space-y-1.5">
            {review.feedback.map((item, idx) => (
              <div key={idx} className="rounded bg-[#0d1117] border border-[#30363d] p-3 text-xs text-[#e3b341]">
                • {item}
              </div>
            ))}
          </div>
        </div>
      )}

      {review?.checks && review.checks.length > 0 && (
        <div className="space-y-2">
          <h4 className="font-mono text-[10px] uppercase tracking-[.12em] text-[#8b949e]">
            Review Checks
          </h4>
          <div className="divide-y divide-[#30363d] rounded-md border border-[#30363d] bg-[#0d1117]">
            {review.checks.map((check, idx) => {
              const passed = check.status === "passed";
              return (
                <div key={idx} className="flex items-center justify-between p-3 text-xs">
                  <div className="flex items-center gap-2">
                    <span className={`h-2.5 w-2.5 rounded-full ${passed ? "bg-[#3fb950]" : "bg-[#d29922]"}`} />
                    <span className="font-medium text-white">{check.label}</span>
                  </div>
                  <span className={`font-mono text-[10px] uppercase tracking-[.1em] ${passed ? "text-[#aff5b4]" : "text-[#e3b341]"}`}>
                    {check.status}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {run.patchVersions && run.patchVersions.length > 0 && (
        <div className="space-y-2">
          <h4 className="font-mono text-[10px] uppercase tracking-[.12em] text-[#8b949e]">
            Patch History
          </h4>
          <div className="divide-y divide-[#30363d] rounded-md border border-[#30363d] bg-[#0d1117]">
            {run.patchVersions.map((v) => (
              <div key={v.version} className="flex items-center justify-between p-3 text-xs">
                <div>
                  <span className="font-medium text-white">{v.label}</span>
                  <span className="ml-2 font-mono text-[11px] text-[#8b949e]">
                    ({v.files.length} file{v.files.length === 1 ? "" : "s"} modified)
                  </span>
                  {v.reviewerFeedback && v.reviewerFeedback.length > 0 && (
                    <p className="mt-1 text-[11px] text-[#e3b341]">
                      Feedback: {v.reviewerFeedback.join("; ")}
                    </p>
                  )}
                </div>
                <span className="font-mono text-[10px] text-[#6e7681]">
                  +{v.files.reduce((s, f) => s + f.additions, 0)} -{v.files.reduce((s, f) => s + f.deletions, 0)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function VerificationPanel({
  run,
  verifying,
  onVerify,
}: {
  run: PilotRun;
  verifying: boolean;
  onVerify: () => void;
}) {
  const verification = run.verification;
  const statusColors = {
    "VERIFIED FIX": "border-[#238636] bg-[#238636]/10 text-[#aff5b4]",
    "PATCH PROPOSED — NOT VERIFIED": "border-[#d29922] bg-[#d29922]/10 text-[#e3b341]",
    "PATCH FAILED VERIFICATION": "border-[#f85149] bg-[#f85149]/10 text-[#ff7b72]",
  };

  return (
    <div className="p-5 space-y-6">
      <div className="rounded-md border border-[#30363d] bg-[#0d1117] p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span
              className={`rounded-full border px-2.5 py-1 font-mono text-[10px] font-semibold tracking-[.12em] ${
                verification ? statusColors[verification.verdictLabel] : "border-[#d29922] bg-[#d29922]/10 text-[#e3b341]"
              }`}
            >
              {verification ? verification.verdictLabel : "PATCH PROPOSED — NOT VERIFIED"}
            </span>
            {verification?.durationMs ? (
              <span className="font-mono text-xs text-[#8b949e]">
                {formatTime(verification.durationMs)}
              </span>
            ) : null}
          </div>
          <p className="mt-2 text-sm text-[#c9d1d9]">
            {verification
              ? verification.summary
              : "Verify this patch against an isolated temporary working copy of the target repository."}
          </p>
          {verification?.commandsDetected && (
            <p className="mt-1 font-mono text-xs text-[#58a6ff]">
              Detected commands:{" "}
              {[
                verification.commandsDetected.build && `build: ${verification.commandsDetected.build}`,
                verification.commandsDetected.test && `test: ${verification.commandsDetected.test}`,
                verification.commandsDetected.lint && `lint: ${verification.commandsDetected.lint}`,
              ]
                .filter(Boolean)
                .join(" · ") || "None"}
            </p>
          )}
        </div>
        <div className="shrink-0 flex items-center gap-2">
          <button
            disabled={verifying}
            onClick={onVerify}
            className="inline-flex items-center gap-1.5 rounded-md bg-[#238636] px-3.5 py-2 text-xs font-medium text-white hover:bg-[#2ea043] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Icon name="check" />
            {verifying ? "Verifying patch…" : verification ? "Re-verify Patch" : "Verify Patch"}
          </button>
        </div>
      </div>

      {verification && (
        <div className="space-y-3">
          <h4 className="font-mono text-[10px] uppercase tracking-[.12em] text-[#8b949e]">
            Validation Stages
          </h4>
          <div className="divide-y divide-[#30363d] rounded-md border border-[#30363d] bg-[#0d1117]">
            {verification.stages.map((stage) => {
              const passed = stage.status === "passed";
              const failed = stage.status === "failed";
              const running = stage.status === "running";

              return (
                <div key={stage.id} className="p-3 text-xs">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span
                        className={`h-2.5 w-2.5 rounded-full ${
                          passed
                            ? "bg-[#3fb950]"
                            : failed
                            ? "bg-[#f85149]"
                            : running
                            ? "animate-pulse bg-[#58a6ff]"
                            : "bg-[#484f58]"
                        }`}
                      />
                      <span className="font-medium text-white">{stage.name}</span>
                      {stage.durationMs ? (
                        <span className="font-mono text-[10px] text-[#6e7681]">
                          {formatTime(stage.durationMs)}
                        </span>
                      ) : null}
                    </div>
                    <span
                      className={`font-mono text-[10px] uppercase tracking-[.1em] ${
                        passed
                          ? "text-[#aff5b4]"
                          : failed
                          ? "text-[#ff7b72]"
                          : running
                          ? "text-[#58a6ff]"
                          : "text-[#6e7681]"
                      }`}
                    >
                      {stage.status}
                    </span>
                  </div>
                  {stage.detail && (
                    <p className="mt-1 pl-4 text-[#8b949e] font-mono text-[11px]">
                      {stage.detail}
                    </p>
                  )}
                  {stage.output && (
                    <pre className="mt-2 max-h-40 overflow-auto rounded bg-[#161b22] p-2 font-mono text-[10px] text-[#c9d1d9]">
                      {stage.output}
                    </pre>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="rounded-md border border-[#30363d] bg-[#161b22] p-4 text-xs text-[#8b949e] space-y-1">
        <p className="font-medium text-[#c9d1d9]">Isolated Verification Contract</p>
        <p>• Runs inside a temporary, disposable working directory (.codex-pilot/workspaces/)</p>
        <p>• Never automatically commits, pushes, or opens pull requests</p>
        <p>• Preserves user clones and cleans up temporary files immediately after verification</p>
      </div>
    </div>
  );
}

function How({ run, close }: { run: PilotRun; close: () => void }) {
  const steps: [string, string][] = [
    ["Issue", "Parsed #" + run.issue.number + " and discussion"],
    ["Repository scan", String(run.metrics.filesIndexed) + " candidate source files discovered"],
    ["Search", run.searches[0] ? "Search " + run.searches[0].query + " found " + (run.searches[0].matches || "relevant") + " matches" : "No search completed yet"],
    ["File selection", String(run.inspectedFiles.length) + " files opened for focused analysis"],
    ["Plan", String(run.plan.length) + " implementation steps generated"],
    ["Patch", String(run.files.length) + " files changed in a unified diff"],
    ["Review", String(run.review.checks.length) + " checks reviewed"],
    ["Verification", "Validated against disposable repository working copy before any upstream action"],
  ];
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-xl rounded-md border border-[#30363d] bg-[#161b22] shadow-2xl">
        <div className="flex items-start justify-between border-b border-[#30363d] p-5">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[.14em] text-[#58a6ff]">Investigation map</p>
            <h3 className="mt-1 text-lg font-semibold text-white">How Codex reached and verified this patch</h3>
          </div>
          <button onClick={close} className="rounded p-1 text-[#8b949e] hover:bg-[#21262d] hover:text-white" aria-label="Close">
            <Icon name="close" />
          </button>
        </div>
        <div className="p-5">
          {steps.map(([label, detail], index) => (
            <div className="flex gap-4 pb-4 last:pb-0" key={label}>
              <div className="flex flex-col items-center">
                <span className="grid h-6 w-6 place-items-center rounded-full border border-[#1f6feb] bg-[#1f6feb]/10 font-mono text-[10px] text-[#79c0ff]">{index + 1}</span>
                {index < steps.length - 1 && <span className="mt-1 h-full w-px bg-[#30363d]" />}
              </div>
              <div>
                <p className="text-sm font-medium text-white">{label}</p>
                <p className="mt-1 text-xs text-[#8b949e]">{detail}</p>
              </div>
            </div>
          ))}
        </div>
        <p className="border-t border-[#30363d] px-5 py-4 text-xs leading-5 text-[#8b949e]">
          Codex Pilot executes verification only inside isolated, disposable local checkouts.
        </p>
      </div>
    </div>
  );
}
