# Handoff — website-feedback-intake

Public feedback intake: a footer control that collects a bug report, shows the
reporter exactly what will be sent, checks GitHub for duplicates, and files a
public issue — with the reporter's email address and screenshot deliberately
excluded from it.

Two independent review passes have been run against this branch and every
finding from both is resolved. Full evidence is in
`docs/verification/feedback-reporting.md`; that file is the thing to read before
touching anything here.

## Done

**The feature, end to end.**

- `webapp/lib/feedback.ts` — every sanitizer. Allowlists throughout, never
  denylists. URL query/path rules, error and stack bounding, request metadata
  with no field for a body or a header, an element describer that never reads an
  accessible name.
- `webapp/lib/feedback-issue.ts` — the public GitHub payload. `PublicReport` has
  no `contact` and no `screenshotId` member, so the body renderer physically
  cannot leak either.
- `webapp/lib/diagnostics.ts` — the browser collectors, defined by what they
  refuse to read, plus the anonymous client key.
- `webapp/lib/screenshot.ts` — DOM clone → redact → rasterise, in that order.
- `webapp/convex/feedback.ts` + `schema.ts` — the only unauthenticated public
  mutation in the deployment, its abuse gate, the GitHub publisher, and three
  retention sweeps.
- `webapp/components/feedback-widget.tsx` — describe → review → duplicates →
  send, with 74 bilingual strings in `lib/i18n.ts`.

**Review pass 1** (8 findings, `a167c62`..`3da5b8e`): screenshot redaction walker
desync (P0 — account surfaces were never covered), rejection accounting DoS
(P0), Markdown injection through diagnostics, orphaned uploads plus server-side
size enforcement, duplicate-search metering, foreign URL path leakage, publish
idempotency, `duplicateCandidates` propagation.

**Review pass 2** (4 findings, `5192dcc`..`002ae76`): the first-party check
failing in the Convex runtime (silently stripping the path from every report in
production), the search budget counting reports rather than searches, upload
records bound by guess rather than by id, and claimed upload rows never deleted.

**Structure pass** (5 findings, `230e0b9`..`68c3810`): repeated shapes in
`convex/feedback.ts` stated once (`normalizeClientKey`, `windowStart`,
`countUpTo`, `sweepBatch`), `clientKey()` moved out of the widget into the
service layer, and the reporter's five form fields folded into one `useDraft`.

## In Progress

Nothing. No partial edits, no stashes, no scratch files.

## Next

In the order a reviewer or the next session should take them:

1. **Open for review.** `vibe ship` — the structure gate has been run and
   reported 5 findings, all refactored and committed.
2. ⚠ **The PR is over the size budget.** 7174 changed lines across 21 files,
   against the ≤4000 / ≤20 in `.vibe/PROTOCOL.md`. File count is fine; lines are
   not. `vibe ship` will refuse to promote it. The commits are already clean
   logical units (4 feat, 5 fix, 3 refactor, 3 docs), so splitting along those
   lines is mechanical — but it is **the human's call** whether to split or
   waive, and nothing here should be split unilaterally.
3. **Operator setup before it does anything in production.** Four manual steps
   in `docs/verification/feedback-reporting.md` §"Operator setup". Nothing is
   configured on any deployment, so the widget currently hides itself.
4. **Optional follow-ups**, all named in the reviews and none blocking: focus is
   dropped on widget step transitions (a real a11y nit), `clearDiagnostics()`
   does not reset `sessionStart` so a second report in a long session renders
   large offsets, and four i18n keys are unreferenced.

## Blockers

**None for review.** Two things gate *production*, both external and both
documented rather than half-done:

- **No GitHub token exists.** Minting a fine-grained PAT needs an interactive
  login as the repo owner; it cannot be done from here and must never be
  committed. Until `GITHUB_FEEDBACK_TOKEN` and `GITHUB_FEEDBACK_REPO` are set,
  `feedback:isConfigured` returns false and the trigger does not render — a form
  that queues into a deployment which will never publish is worse than no form.
- **Two labels must be created first.** `POST /issues` silently *drops* an
  unknown label rather than erroring, so `via-website` and `data-correction`
  have to exist before the first report. `gh label create` commands are in the
  doc.

Also worth knowing rather than rediscovering: **`SITE_URL` is now load-bearing
for report quality**, not only for auth. Point it anywhere but the deployed
origin and every report silently loses its page path. There is no runtime
assertion possible — the value that would prove it correct is the one being
checked.

## Exact State

- **Last commit:** `68c3810` — `refactor: hold the reporter's answers as one draft`
- **Branch:** `website-feedback-intake`, 15 commits ahead of `main`, already
  pushed — `origin/website-feedback-intake` is at `68c3810`.
- **Tests:** **passing** — 1404 pass, 0 fail, 16931 assertions, 84 files
  (`bun test`). Baseline before this branch was 1268; 136 are new.
- **Typecheck:** passing (`tsc --noEmit`, no output).
- **Lint:** passing — 10 warnings, which is the **pre-existing** count, measured
  by stashing this branch's changes and re-running. This branch adds none.
- **Build:** passing (`pixi run build`, 25 routes).
- **Codegen:** `convex/_generated/api.d.ts` lists all 29 modules.
- **Uncommitted changes:** none. Working tree clean, no untracked files.

### Environment notes for whoever picks this up

A fresh worktree needs `bun install` and `webapp/convex/_generated/` copied from
the main checkout before either suite runs — both are gitignored except
`_generated`, which is committed and must list `feedback` (`check:codegen`
verifies this).

Convex behaviour here was verified against the **cached local backend**, which
needs no credentials, plus a stub GitHub API reached through the
`GITHUB_API_BASE` operator variable. `docs/verification/feedback-reporting.md`
§5c and §5d record what that established. Two cautions learned the hard way:
deploying to the local backend dirties the *tracked* `convex/_generated/` files
(restore them afterwards and re-run `check:codegen`), and pointing `next dev` at
it requires a temporary edit to `lib/convex-url.ts` that must be reverted
byte-for-byte — it is currently clean.
