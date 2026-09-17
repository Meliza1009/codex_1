# Codex Pilot

Paste a public GitHub issue and receive a focused, reviewable patch proposal. Codex Pilot visibly loads the issue, comments, repository tree, and a small set of relevant source files. It streams observable investigation milestones, asks the locally authenticated Codex CLI for structured edits, then runs a dedicated patch-review pass before building a downloadable unified diff.

## Run locally

```powershell
npm install
Copy-Item .env.example .env.local
codex login
npm run dev
```

Open `http://localhost:3000`. Add `GITHUB_TOKEN` to `.env.local` if GitHub’s unauthenticated API limit becomes restrictive.

## Hosting modes

- **Local live demo:** leave `CODEX_PILOT_LIVE_RUNS` unset (or set it to `true`), run `codex login`, then start the app with `npm run dev`.
- **Hosted sample preview:** set both `CODEX_PILOT_LIVE_RUNS=false` and `NEXT_PUBLIC_CODEX_PILOT_LIVE_RUNS=false` at build time. The page clearly labels its sample run and refuses submissions instead of attempting to access a Codex CLI session that the host does not have.

## Boundaries

- Public GitHub issues only; pull requests and private repositories are rejected.
- Repositories are read through GitHub’s REST API, capped at 25 MB and 10,000 files.
- The locally authenticated Codex CLI receives only the issue, comments, and selected file contents. It runs in an ephemeral, read-only sandbox with its shell tool disabled.
- The agent may replace content only in a file it inspected. Codex Pilot validates the replacements and generates the diff itself.
- Target repositories are never cloned, executed, tested, or modified.

If Codex cannot return a supported, confident edit, the app clearly refuses to offer an empty patch. GitHub rate limits, private or missing repositories, closed issues, unsupported files, and large repositories receive dedicated failure states.
