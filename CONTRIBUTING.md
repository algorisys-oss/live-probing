# Contributing to LiveProbe

Short and practical. The governing engineering doctrine is [`LOOPS.md`](LOOPS.md); the project
conventions live in [`CLAUDE.md`](CLAUDE.md). This file is the branch/PR workflow on top of those.

## Branch model

- **`dev` is the working branch.** All work lands on `dev` (or a short-lived feature branch merged
  into `dev`). Base your work on the latest `dev`.
- **`main` mirrors `dev`.** It is not a place you commit to directly — it only ever fast-forwards to
  `dev` during a sync. Do **not** `git push origin main` by hand.
- **Never commit straight to `main`.** A direct commit to `main` diverges it from `dev` and forces a
  merge to reconcile. If you have push access, please self-restrain; ideally we protect `main` on
  GitHub (see below).

### The `sync` flow

"Sync" means: commit → push `dev` → fast-forward `main` to `dev` → push `main` → switch back to
`dev`. Don't push between syncs, and check the branch before pushing.

```bash
git checkout dev
# ... commit your work on dev ...
git push origin dev
git checkout main && git merge --ff-only dev && git push origin main
git checkout dev
```

If `main` has moved ahead of `dev` (someone committed to it directly), the fast-forward fails.
Reconcile by bringing that commit onto `dev` first (`git merge origin/main` on `dev`, resolve, push),
then fast-forward `main`. Prevention beats reconciliation — keep work on `dev`.

### Recommended: protect `main` on GitHub

A convention holds better with a guardrail. In the repo settings, add a branch-protection rule for
`main`: require pull requests (or at least restrict who can push). That makes "commit straight to
`main`" impossible rather than merely discouraged. If several people push to `dev` too, prefer
short-lived feature branches → PR into `dev` so `dev` itself doesn't diverge under you.

## Before you push

- `npm test` — core + server + collector unit tests must be green.
- `npm run typecheck` — must be clean.
- `npm run test:e2e` — Playwright UI e2e when you touched the UI (first run:
  `npx playwright install chromium`).
- **Verify behavior, not just tests.** Drive the affected flow end to end (LOOPS rule V) — for the UI,
  load it in a browser; for ingest, post an event and read it back.

## How we work (the load-bearing rules)

These come from [`LOOPS.md`](LOOPS.md) — read it once, it's the system prompt for this repo:

- **Scope lock (IV).** Only touch what the task needs. No "while I was in there" changes, no drive-by
  reformatting.
- **TDD (V, XII).** Tests first, failing then green — especially for the pure functions (event model,
  exporters, layout).
- **Minimal dependencies (VIII).** Node built-ins first; any new dep needs a written reason.
- **Naming.** All files and folders are lowercase-hyphenated (e.g. `trace-window.ts`, `flow-view/`).
- **Reference oracle (XXXVII).** OpenTelemetry span semantics decide arrow direction — map to OTel,
  don't invent a parallel taxonomy.

## Update the docs with your change

Each of these has one job; keep them current as the final step of a task:

- **`CHANGELOG.md`** — every functional change, newest first, under a dated heading. Append-only.
- **`HANDOFF.md`** — the *current* state so the next person can pick up cold. Rolling (reflects now,
  not history). Update the "Last task" section.
- **`IMPLEMENT.md`** — the discussion-to-code audit trail for anything planned then built.
- **`todo.md`** — check off what's done; add backlog items.

## Commit messages

Conventional-commit style (`feat:`, `fix:`, `docs:`, `chore:` …), imperative mood, wrapped body
explaining the *why*. Reference the behavior, not the ticket, in code comments (that's a doctrine
rule) — but the PR/commit body is the right place for context.

## Where to look

Start at [`HANDOFF.md`](HANDOFF.md) (current state + how to run), then [`todo.md`](todo.md),
[`README.md`](README.md), and [`docs/`](docs/). Commands are in the README and `CLAUDE.md`.
