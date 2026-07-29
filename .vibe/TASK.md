# Fix production enrichment integrity (GAP-001, GAP-026, GAP-027, GAP-028)

Read `docs/implementation-gap-audit-2026-07-29.md` from the audit branch/merged main if available and inspect the live code and tests. Implement the structural fix for the production data wipe without mutating or deploying to production.

Acceptance criteria:
- Roster/DIP crosswalk upserts must not overwrite already-populated enrichment fields with null when the resolver has not loaded enrichment because TTL says it is fresh.
- Contact freshness must be scoped so historical backfills cannot mark a different Wahlperiode's current members fresh or otherwise starve their enrichment.
- Empty/unparsed contact responses must not be stamped as successful.
- Name matching handles the documented middle-initial misses and all misses are routed through the existing quarantine/retry mechanism rather than only logged.
- Add regression tests that reproduce the exact destructive-TTL scenario and prove coverage survives an ordinary sync inside TTL.
- Preserve resumability, source honesty, and current backfill behavior. Do not fabricate email/phone or synthetic contact data.
- Run relevant Python tests and repository checks available in this worktree.
- Write `/tmp/fix-enrichment-integrity-report.md` with changed files, root cause, test evidence, remaining migration/deploy steps, and any interactions with the ongoing historical-backfill commits.
- Commit all source/test changes on this branch. Do not push, deploy, run a production pipeline, or open a PR. Stop idle with the commit SHA.

This branch is based on the current `complete-historical-backfill` work so those unmerged pipeline fixes are visible. Keep your own task changes in clearly separable commit(s). Do not ask questions; proceed autonomously.