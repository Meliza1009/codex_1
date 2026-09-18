const { mkdir, writeFile } = require("node:fs/promises");
const { join } = require("node:path");
const load = require("./load-pilot.cjs");
const { streamPilotRun } = load("pilot");

// The default is intentionally small. Override with newline-separated public
// issue URLs to run a larger local benchmark; Pilot only reads repositories.
const defaultUrls = [
  "https://github.com/lukeed/clsx/issues/100",
  "https://github.com/google/uuid/issues/97",
  "https://github.com/lukeed/clsx/issues/112",
];
const urls = (process.env.CODEX_PILOT_BENCHMARK_URLS || defaultUrls.join("\n"))
  .split(/\r?\n/).map((url) => url.trim()).filter(Boolean).slice(0, 5);

async function run(url) {
  const started = Date.now();
  let terminal;
  await streamPilotRun(url, (event) => {
    if (event.type === "completed" || event.type === "failed") terminal = event;
  });
  const run = terminal?.run;
  return {
    issueUrl: url,
    repository: run?.issue.repository,
    classification: run?.issueAnalysis?.kinds ?? [],
    explorationRounds: run?.metrics.explorationRounds ?? 0,
    filesInspected: run?.metrics.filesInspected ?? 0,
    patchGenerated: Boolean(run?.patchVersions?.length),
    reviewerVerdict: run?.review?.verdict ?? "not_reached",
    revisionCount: run?.metrics.revisions ?? 0,
    finalState: run?.status ?? "failed_before_run",
    reasonCode: run?.refusal?.code ?? terminal?.error?.code,
    runtimeMs: Date.now() - started,
  };
}

(async () => {
  const results = [];
  for (const url of urls) {
    try { results.push(await run(url)); }
    catch (error) { results.push({ issueUrl: url, classification: [], explorationRounds: 0, filesInspected: 0, patchGenerated: false, reviewerVerdict: "not_reached", revisionCount: 0, finalState: "runner_error", reasonCode: error?.code || "BENCHMARK_RUNNER_ERROR", runtimeMs: 0 }); }
  }
  const report = { generatedAt: new Date().toISOString(), total: results.length, results };
  const folder = join(process.cwd(), "reports");
  await mkdir(folder, { recursive: true });
  const path = join(folder, `benchmark-${Date.now()}.json`);
  await writeFile(path, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ report: path, results }, null, 2));
})();
