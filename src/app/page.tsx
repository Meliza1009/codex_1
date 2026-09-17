"use client";

import { FormEvent, useMemo, useState } from "react";

type Activity = { id: string; phase: string; action: string; detail: string; status: "done" | "active" | "pending" };
type FileChange = { path: string; additions: number; deletions: number; diff: string; reason: string };
type Run = {
  issue: { number: number; title: string; repository: string; url: string };
  status: "completed" | "needs-review" | "failed";
  summary: string;
  plan: string[];
  activity: Activity[];
  inspectedFiles: string[];
  files: FileChange[];
  explanation: string[];
  patch: string;
  source: "codex" | "guided";
};

const sample: Run = {
  issue: { number: 123, title: "Dark mode resets after page refresh", repository: "acme/astro-ui", url: "https://github.com/acme/astro-ui/issues/123" },
  status: "completed", source: "guided",
  summary: "The selected theme is created from the default value after each reload. Persisting it in browser storage and restoring it during initialization keeps the preference stable.",
  activity: [
    { id: "1", phase: "UNDERSTANDING", action: "Read issue", detail: "Loaded issue #123 and its description.", status: "done" },
    { id: "2", phase: "UNDERSTANDING", action: "Read discussion", detail: "No extra constraints found in comments.", status: "done" },
    { id: "3", phase: "REPOSITORY EXPLORATION", action: "Loaded repository structure", detail: "Indexed 184 text files from the default branch.", status: "done" },
    { id: "4", phase: "REPOSITORY EXPLORATION", action: "Searched \"theme\"", detail: "Found state and provider code in 3 files.", status: "done" },
    { id: "5", phase: "REPOSITORY EXPLORATION", action: "Read useTheme.ts", detail: "It initializes theme state with a hard-coded default.", status: "done" },
    { id: "6", phase: "REPOSITORY EXPLORATION", action: "Read ThemeProvider.tsx", detail: "It applies the theme but does not persist the selection.", status: "done" },
    { id: "7", phase: "GENERATING PATCH", action: "Validated patch", detail: "Generated a consistent unified diff from 2 file edits.", status: "done" },
  ],
  inspectedFiles: ["src/hooks/useTheme.ts", "src/providers/ThemeProvider.tsx", "src/app/layout.tsx"],
  plan: ["Find where the theme value is initialized.", "Persist the selected theme when it changes.", "Restore the saved preference before applying the theme.", "Keep the provider API unchanged for callers."],
  files: [
    { path: "src/hooks/useTheme.ts", additions: 14, deletions: 3, reason: "Initialize from storage and write changes back to storage.", diff: "@@ -4,10 +4,21 @@\n export function useTheme() {\n-  const [theme, setTheme] = useState<Theme>(\"light\");\n+  const [theme, setTheme] = useState<Theme>(() => {\n+    if (typeof window === \"undefined\") return \"light\";\n+    return (localStorage.getItem(\"theme\") as Theme) ?? \"light\";\n+  });\n \n-  return { theme, setTheme };\n+  const updateTheme = (nextTheme: Theme) => {\n+    setTheme(nextTheme);\n+    localStorage.setItem(\"theme\", nextTheme);\n+  };\n+\n+  return { theme, setTheme: updateTheme };\n }" },
    { path: "src/providers/ThemeProvider.tsx", additions: 7, deletions: 1, reason: "Apply the restored value after hydration.", diff: "@@ -12,7 +12,13 @@ export function ThemeProvider({ children }) {\n-  useEffect(() => document.documentElement.dataset.theme = theme, [theme]);\n+  useEffect(() => {\n+    document.documentElement.dataset.theme = theme;\n+    document.documentElement.style.colorScheme = theme;\n+  }, [theme]);" },
  ],
  explanation: ["Theme selection previously existed only in component state, so every refresh recreated the light default.", "The hook now restores a saved value only in the browser, avoiding server-rendering access to localStorage.", "Updates use the existing setter interface, so components that consume the provider do not change."],
  patch: "diff --git a/src/hooks/useTheme.ts b/src/hooks/useTheme.ts\n--- a/src/hooks/useTheme.ts\n+++ b/src/hooks/useTheme.ts\n@@ -4,10 +4,21 @@\n export function useTheme() {\n-  const [theme, setTheme] = useState<Theme>(\"light\");\n+  const [theme, setTheme] = useState<Theme>(() => {\n+    if (typeof window === \"undefined\") return \"light\";\n+    return (localStorage.getItem(\"theme\") as Theme) ?? \"light\";\n+  });\n@@ -12,7 +12,13 @@ export function ThemeProvider({ children }) {\n-  useEffect(() => document.documentElement.dataset.theme = theme, [theme]);\n+  useEffect(() => {\n+    document.documentElement.dataset.theme = theme;\n+    document.documentElement.style.colorScheme = theme;\n+  }, [theme]);\n",
};

function Icon({ name }: { name: string }) {
  const paths: Record<string, string> = { arrow: "M5 12h14m-6-6 6 6-6 6", play: "m8 5 11 7-11 7V5Z", download: "M12 3v12m0 0 4-4m-4 4-4m-5 8h18", check: "m5 12 4 4L19 6", file: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z M14 2v6h6" };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d={paths[name]} strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

export default function Home() {
  const [url, setUrl] = useState("");
  const [run, setRun] = useState<Run | null>(null);
  const [tab, setTab] = useState<"plan" | "diff" | "explanation">("plan");
  const [file, setFile] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const activeRun = run ?? sample;
  const total = useMemo(() => activeRun.files.reduce((count, item) => count + item.additions + item.deletions, 0), [activeRun]);
  async function start(event: FormEvent) {
    event.preventDefault(); setError("");
    if (!url.trim()) { setRun(sample); return; }
    setLoading(true);
    try {
      const response = await fetch("/api/runs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ issueUrl: url }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not start Codex Pilot.");
      setRun(data); setFile(0); setTab("plan");
    } catch (err) { setError(err instanceof Error ? err.message : "Could not start Codex Pilot."); }
    finally { setLoading(false); }
  }
  function download() {
    const blob = new Blob([activeRun.patch], { type: "text/x-diff" }); const link = document.createElement("a");
    link.href = URL.createObjectURL(blob); link.download = `issue-${activeRun.issue.number}-fix.patch`; link.click(); URL.revokeObjectURL(link.href);
  }
  return <main className="min-h-screen bg-[#090b10] text-slate-100 selection:bg-cyan-400/30">
    <header className="border-b border-white/[.08] px-5 py-4 lg:px-8"><div className="mx-auto flex max-w-[1500px] items-center justify-between gap-6"><a className="flex items-center gap-3" href="/"><span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-cyan-300 to-blue-600 text-[#07131c]"><Icon name="arrow" /></span><span className="font-semibold tracking-tight">Codex <span className="text-cyan-300">Pilot</span></span></a><div className="hidden items-center gap-3 text-xs text-slate-500 sm:flex"><span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_12px_#34d399]" />Local agent ready</div></div></header>
    <section className="border-b border-white/[.08] bg-[radial-gradient(ellipse_at_top,#11233a_0%,transparent_55%)] px-5 py-10 lg:px-8"><div className="mx-auto max-w-[1120px]"><p className="mb-3 text-xs font-medium tracking-[.18em] text-cyan-300">AGENTIC CODING, VISIBLE</p><h1 className="max-w-2xl text-3xl font-semibold tracking-tight text-white sm:text-5xl">Paste the issue. Watch Codex find the fix.</h1><p className="mt-4 max-w-xl text-sm leading-6 text-slate-400 sm:text-base">Codex Pilot reads a public GitHub issue, explores the codebase selectively, and creates a downloadable patch without running the repository.</p><form onSubmit={start} className="mt-7 flex flex-col gap-3 sm:flex-row"><div className="flex flex-1 items-center gap-3 rounded-xl border border-white/10 bg-black/30 px-4 focus-within:border-cyan-300/60"><span className="text-slate-600">github.com/</span><input value={url} onChange={(event) => setUrl(event.target.value)} className="h-12 min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-slate-600" placeholder="owner/repo/issues/123" aria-label="GitHub issue URL" /></div><button disabled={loading} className="flex h-12 items-center justify-center gap-2 rounded-xl bg-cyan-300 px-5 text-sm font-semibold text-[#07131c] transition hover:bg-cyan-200 disabled:cursor-wait disabled:opacity-70"><Icon name="play" />{loading ? "Piloting…" : "Run Codex Pilot"}</button></form>{error && <p className="mt-3 text-sm text-rose-300">{error}</p>}<p className="mt-3 text-xs text-slate-600">Leave empty to explore the included demo run.</p></div></section>
    <section className="mx-auto max-w-[1500px] px-5 py-7 lg:px-8"><div className="mb-6 flex flex-col justify-between gap-3 sm:flex-row sm:items-end"><div><p className="text-xs font-medium tracking-[.16em] text-slate-500">ISSUE #{activeRun.issue.number} · {activeRun.issue.repository}</p><h2 className="mt-1 text-xl font-medium text-white">{activeRun.issue.title}</h2></div><div className="flex items-center gap-3"><span className={`rounded-full border px-3 py-1 text-xs ${activeRun.source === "codex" ? "border-cyan-300/30 bg-cyan-300/10 text-cyan-200" : "border-amber-300/30 bg-amber-300/10 text-amber-200"}`}>{activeRun.source === "codex" ? "Codex run" : "Preview run"}</span><button onClick={download} className="flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-200 hover:bg-white/[.06]"><Icon name="download" />Download patch</button></div></div>
      <div className="grid gap-5 lg:grid-cols-[.85fr_1.35fr]"><aside className="rounded-2xl border border-white/[.08] bg-[#0d1118] p-5 shadow-2xl shadow-black/20"><div className="mb-5 flex items-center justify-between"><h3 className="text-sm font-medium">Agent activity</h3><span className="text-xs text-slate-500">{activeRun.activity.length} actions</span></div><div className="space-y-5">{["UNDERSTANDING", "REPOSITORY EXPLORATION", "GENERATING PATCH"].map((phase) => <div key={phase}><p className="mb-2 text-[10px] font-medium tracking-[.14em] text-slate-600">{phase}</p><div className="space-y-3">{activeRun.activity.filter((item) => item.phase === phase).map((item) => <div className="flex gap-3" key={item.id}><span className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full bg-emerald-400/15 text-emerald-300"><Icon name="check" /></span><div><p className="text-xs text-slate-200">{item.action}</p><p className="mt-0.5 text-[11px] leading-4 text-slate-500">{item.detail}</p></div></div>)}</div></div>)}</div><div className="mt-6 border-t border-white/[.07] pt-5"><p className="mb-3 text-[10px] font-medium tracking-[.14em] text-slate-600">FILES INSPECTED</p><div className="space-y-1">{activeRun.inspectedFiles.map((path) => <button onClick={() => { const index = activeRun.files.findIndex((item) => item.path === path); if (index >= 0) { setFile(index); setTab("diff"); } }} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left font-mono text-[11px] text-slate-400 hover:bg-white/[.05]" key={path}><span className="text-cyan-300"><Icon name="file" /></span>{path}</button>)}</div></div></aside>
      <section className="overflow-hidden rounded-2xl border border-white/[.08] bg-[#0d1118] shadow-2xl shadow-black/20"><div className="flex items-center gap-1 border-b border-white/[.08] p-2">{(["plan", "diff", "explanation"] as const).map((name) => <button key={name} onClick={() => setTab(name)} className={`rounded-lg px-3 py-2 text-xs capitalize transition ${tab === name ? "bg-white/[.09] text-white" : "text-slate-500 hover:text-slate-300"}`}>{name}{name === "diff" && <span className="ml-1.5 text-cyan-300">{activeRun.files.length}</span>}</button>)}</div>{tab === "plan" && <div className="p-6"><div className="rounded-xl border border-cyan-300/10 bg-cyan-300/[.035] p-4 text-sm leading-6 text-slate-300">{activeRun.summary}</div><ol className="mt-6 space-y-4">{activeRun.plan.map((step, index) => <li className="flex gap-4" key={step}><span className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-cyan-300/30 font-mono text-xs text-cyan-200">{index + 1}</span><span className="pt-0.5 text-sm text-slate-300">{step}</span></li>)}</ol><p className="mt-8 border-t border-white/[.07] pt-4 text-xs text-slate-600">Codex generated a proposal from selected files. Repository code and tests were not run.</p></div>}{tab === "diff" && <div><div className="flex flex-wrap gap-1 border-b border-white/[.08] px-3 py-2">{activeRun.files.map((change, index) => <button onClick={() => setFile(index)} className={`rounded-md px-2 py-1 font-mono text-[11px] ${file === index ? "bg-cyan-300/10 text-cyan-200" : "text-slate-500 hover:text-slate-300"}`} key={change.path}>{change.path.split("/").pop()} <span className="text-emerald-400">+{change.additions}</span> <span className="text-rose-400">−{change.deletions}</span></button>)}</div><div className="p-5"><p className="mb-3 text-xs text-slate-400">{activeRun.files[file]?.reason}</p><pre className="overflow-x-auto rounded-xl border border-white/[.07] bg-[#080a0e] p-4 font-mono text-xs leading-5 text-slate-300">{activeRun.files[file]?.diff.split("\n").map((line, index) => <span className={line.startsWith("+") ? "block bg-emerald-400/[.08] text-emerald-200" : line.startsWith("-") ? "block bg-rose-400/[.08] text-rose-200" : line.startsWith("@@") ? "block text-cyan-300" : "block"} key={index}>{line || " "}</span>)}</pre><p className="mt-4 text-xs text-slate-600">{activeRun.files.length} files changed · {total} changed lines</p></div></div>}{tab === "explanation" && <div className="p-6"><h3 className="text-base font-medium text-white">Why this patch</h3><div className="mt-5 space-y-4">{activeRun.explanation.map((paragraph) => <p className="border-l-2 border-cyan-300/30 pl-4 text-sm leading-6 text-slate-300" key={paragraph}>{paragraph}</p>)}</div><div className="mt-8 rounded-xl border border-amber-300/10 bg-amber-300/[.035] p-4 text-xs leading-5 text-amber-100/70">This is a proposed change. Inspect the diff and run the target repository’s own checks before applying it.</div></div>}</section></div></section></main>;
}
