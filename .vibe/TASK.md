# Bundestracker implementation-completeness audit

Joshua reports a concrete regression/gap: every MP personal detail page was planned to expose all available official contact information, starting with email and then phone, postal/office contact, website, and social links. On the current finished product he cannot find any of it. He wants a complete audit of whether other planned features are likewise absent, why each gap happened, and then implementation of all legitimate gaps.

This branch is Wave 1: evidence-based audit and execution map. Do not implement product features yet. Do not ask questions; proceed autonomously.

## Required investigation

1. Inspect the entire current repository, especially docs/plans/roadmaps/TODOs, Git history, merged and remote branches, pipeline enrichment code, Convex schema/queries, MP profile UI, tests, i18n, and deployment configuration.
2. Search Git history for prior implementation plans and mentions of MP email, phone, contact, social media, website, office/postal details, personal detail pages, questions, methodology/about, dissent, mandate badges, term normalization, quorum, lame-duck flags, own-resources votes, procedural clock, committee tracking, and every other feature claimed/planned.
3. Inspect current production at https://www.bundestracker.de using a browser, including multiple real MP profile pages on desktop and mobile. Check DOM, console, network, and whether missing contact data is a UI omission, query omission, ingest omission, source-coverage problem, production-data problem, or a combination.
4. Query production Convex read-only where useful to measure field coverage. Do not mutate production.
5. Distinguish precisely:
   - planned and fully implemented;
   - implemented in code but not deployed or not populated;
   - partially implemented/buried;
   - planned but absent;
   - intentionally deferred/deprioritized;
   - impossible/blocked by source availability or editorial risk;
   - stale plan item superseded by a better design.
6. For every gap, identify evidence (plan/doc/commit/file/live route), root cause, user impact, dependencies, likely file surfaces, data migration/backfill needs, and objective verification criteria.
7. Produce an execution graph suitable for parallel Vibe branches. Group only independent work; call out shared hot files such as i18n/schema/generated types so merges can be sequenced safely. Prioritize the contact-details promise first.
8. Be skeptical: do not treat every aspirational podcast idea as a committed implementation promise. The audit must separate explicit planned scope from later roadmap ideas.

## Deliverables

- Write the full report to `docs/implementation-gap-audit-2026-07-29.md` in this worktree.
- Also copy it to `/tmp/bundestracker-implementation-gap-audit.md` so the orchestrator can consume it before merge.
- Include at the top a concise matrix with stable IDs (`GAP-001`, etc.), status, evidence strength, root cause, implementation recommendation, dependencies, and whether it can run in parallel.
- Include a dedicated contact-data forensic section with live coverage counts and a clear explanation of why Joshua cannot see contact details now.
- Include a final "Implementation waves" section that is immediately executable by independent coding agents.
- Commit the report on this branch when complete. Do not push or open a PR. Stop at an idle prompt after reporting the commit SHA and exact audit counts.