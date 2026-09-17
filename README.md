# Codex Pilot

Paste a public GitHub issue and receive a focused, reviewable patch proposal. Codex Pilot loads the issue, comments, repository tree, and a small set of relevant source files. It asks the locally authenticated Codex CLI to propose structured edits, then builds the downloadable unified diff itself.

## Run locally

```powershell
npm install
Copy-Item .env.example .env.local
codex login
npm run dev
```

Open `http://localhost:3000`. Add `GITHUB_TOKEN` to `.env.local` if GitHub’s unauthenticated API limit becomes restrictive.

## Boundaries

- Public GitHub issues only; pull requests and private repositories are rejected.
- Repositories are read through GitHub’s REST API, capped at 25 MB and 10,000 files.
- Codex runs with a read-only sandbox and its shell tool disabled. It receives only the issue, comments, and selected file contents.
- The agent may replace content only in a file it inspected. Codex Pilot generates the diff from those replacements.
- Target repositories are never cloned, executed, tested, or modified.

If Codex cannot return a supported edit, the app retains the investigation and clearly marks the result as needing review instead of offering an empty patch.
