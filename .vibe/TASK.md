# Engineering hygiene and small data-contract gaps (GAP-013, GAP-014, GAP-023, GAP-024)

Read `docs/implementation-gap-audit-2026-07-29.md` and inspect current repository conventions. Implement these independent, low-risk completeness fixes:

- Add GitHub CI for the real repository gates using Pixi and Bun only: lint, typecheck, tests, and an appropriate production-equivalent web build. Reuse existing scripts; no npm/pnpm/yarn.
- Make a clean checkout capable of typechecking/testing without hidden local Convex generated state. Choose the smallest reproducible bootstrap consistent with Convex/Vercel conventions; document it.
- Remove/update the stale auth-route comment claiming `/sign-in` does not exist.
- Include `voteSheets` in the seed purge contract with focused tests so future purges cannot leave ballots behind.
- Correct only directly implicated documentation statements; do not touch GitHub OAuth credentials or claim OAuth works if it does not.
- Run the new workflow commands locally as far as possible and record exact results.
- Write `/tmp/engineering-hygiene-gaps-report.md` with changed files and verification.
- Commit all changes. Do not push, deploy, or open a PR. Stop idle with the commit SHA.

Do not ask questions; proceed autonomously.

## Follow-up 1 (independent verification)

The full gate failed at `pixi run build` in an environment without
`NEXT_PUBLIC_CONVEX_URL`/`NEXT_PUBLIC_CONVEX_SITE_URL`, so the new CI workflow
may fail on GitHub. Fix the CI/build verification contract so a clean
credential-free checkout has safe explicit valid public Convex URLs for the
build, without weakening the runtime guard or exposing secrets. Rebase onto
latest `origin/main`, resolve conflicts semantically, rerun the exact CI gates in
a clean environment, update the report, commit, and return idle. Do not push or
open a PR.

## Follow-up 2 (review of PR #50)

Fix the medium finding in `/tmp/review-pr49-pr50.md` (F1). The build wrapper must
never substitute placeholder URLs for a half-configured pair or any
deploying/production build. Preserve credential-free CI when both URLs are
absent, but restore loud failure when exactly one is set and when
`CONVEX_DEPLOY_KEY` or production deployment context is present. Add focused
tests for all matrix cases, rerun gates, commit and push the PR branch. Then
return idle with evidence.
