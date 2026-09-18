# Investigation validation

Run deterministic orchestration checks with `node scripts/test-pilot.cjs`.
These use synthetic repository data and scripted structured responses; they do not establish model success rates.

Run `node scripts/benchmark.cjs` on the local Codex-authenticated machine to evaluate all 15 public issue candidates. An optional issue number runs matching candidates, for example `node scripts/benchmark.cjs 92`.
An existing `GITHUB_TOKEN` environment variable is supported to avoid unauthenticated API quota exhaustion. The script does not read `.env.local`; set the variable in the invoking environment if needed. It uses the configured local CLI model, with no hosted model API dependency.

Detailed results, events, proposed patches, classification, review verdict, refusal diagnostics and timing are written to ignored `benchmarks/results/`. Review these patches manually before making quality claims. No target repository is checked out, modified, or executed.

## Current validation: 2026-09-18

- Fifteen deterministic orchestration scenarios pass: the original ten plus cumulative evidence across rounds, planning with an inspected file omitted from the compact summary, harmless path normalization, plan repair using validation feedback, and persistent invalid-path diagnostics.
- Lint and production build pass after each architectural increment.
- A real local Codex invocation classified klona #46 and began exploration. The GitHub API then returned HTTP 403 while fetching source files.
- The original 15-case benchmark was blocked by GitHub rate limits before classification. `latest-summary.json` retains those historical infrastructure failures.
- After the evidence/planner mapping fix, a real rerun of clsx #111 completed in 464.2 seconds: 2 exploration rounds, 8 inspected files, 5 searches, 6 modified files, one reviewer-requested revision, and final reviewer approval. `clsx-111-validation.json` records the outcome. Proposed runtime, declarations, tests and documentation were inspected manually as text; target code and tests were not executed. This single successful proposal does not establish a general success rate.
- Source retrieval now uses GitHub's public raw-content endpoint and each local search scans at most 12 ranked candidates to reduce API cost.
- Production readiness remains **unproven** until the real benchmark runs to completion and proposed patches are manually reviewed.

For the hosted-mode smoke check, start a production server with `VERCEL=1` and run `node scripts/smoke-hosted.cjs http://localhost:3005`. This checks server-rendered sample structure and verifies that the hosted API refuses live execution. It is not a browser interaction test.

Known scope limits: no target execution or test execution; no new undiscovered file creation; dependency relationship extraction is heuristic rather than a language server; reference URLs and attached reproduction images are not fetched automatically. A missing essential fact remains a reason to stop honestly.
