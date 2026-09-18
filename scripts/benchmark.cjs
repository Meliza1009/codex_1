const fs = require('node:fs');
const path = require('node:path');
const load = require('./load-pilot.cjs');
const { streamPilotRun } = load('pilot');
const config = require('../benchmarks/issues.json');
const selected = process.argv[2] ? config.cases.filter((item) => item.url.endsWith('/' + process.argv[2])) : config.cases;
const output = path.resolve(__dirname, '../benchmarks/results');
fs.mkdirSync(output, { recursive: true });
// Cache responses within this invocation to conserve GitHub API quota.
const cache = new Map();
async function github(route, raw = false) {
  const key = `${raw}:${route}`;
  if (!cache.has(key)) cache.set(key, (async () => {
    const parts = raw ? route.match(/^\/repos\/([^/]+)\/([^/]+)\/contents\/(.+)\?ref=(.+)$/) : null;
    const url = parts ? `https://raw.githubusercontent.com/${parts[1]}/${parts[2]}/${parts[4]}/${parts[3]}` : 'https://api.github.com' + route;
    const response = await fetch(url, { headers: { 'User-Agent': 'Codex-Pilot-Benchmark', Accept: raw ? 'text/plain' : 'application/vnd.github+json', ...(!raw && process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}) }, signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw { code: response.status === 403 || response.status === 429 ? 'GITHUB_RATE_LIMITED' : 'GITHUB_REQUEST_FAILED', title: 'GitHub request failed', message: `GitHub ${response.status} for ${route}`, retryable: true };
    return raw ? response.text() : response.json();
  })());
  return cache.get(key);
}
(async () => {
  for (const item of selected) {
    const events = []; const started = Date.now();
    console.log(`START ${item.url}`);
    await streamPilotRun(item.url, (event) => { events.push(structuredClone(event)); if (event.type === 'activity') console.log(`${item.url} | ${event.activity.action}`); }, { github });
    const terminal = events.at(-1); const run = terminal?.run;
    const result = { ...item, testedAt: new Date().toISOString(), classification: run?.issueAnalysis?.kinds ?? [], rounds: run?.metrics.explorationRounds ?? 0, inspected: run?.metrics.filesInspected ?? 0, patchGenerated: Boolean(run?.patch), reviewerVerdict: run?.review.verdict ?? null, refusal: run?.refusal ?? null, error: terminal?.error ?? null, elapsedMs: Date.now() - started, events };
    const name = new URL(item.url).pathname.slice(1).replaceAll('/', '-') + '.json';
    fs.writeFileSync(path.join(output, name), JSON.stringify(result, null, 2));
    console.log(`RESULT ${item.url} ${JSON.stringify({ patch: result.patchGenerated, rounds: result.rounds, refusal: result.refusal?.code, error: result.error })}`);
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
