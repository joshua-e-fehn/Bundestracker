# Task — frontend-voting-pages

Build vote pages for Bundestracker. Do NOT ask questions. Read webapp/convex/votes.ts and webapp/convex/schema.ts, then build:

1. webapp/app/votes/page.tsx — vote list with table (date, title, result bar), filters, pagination. Query getVoteSheets from convex/votes.ts.
2. webapp/app/votes/[id]/page.tsx — vote detail: title, date, result badge, stacked vote bar (yes/no/abstain/absent), per-MP table with Fraktion filter and search, rebel vote highlighting.
3. webapp/components/vote-bar.tsx — horizontal stacked bar.
4. webapp/components/vote-table.tsx — per-MP vote table.
5. webapp/components/rebel-vote-badge.tsx — badge for MPs voting against party.
6. Add Convex queries to webapp/convex/votes.ts: getVoteSheetById (with voteRecords joined to MP data), getVoteSheets (paginated list with filters), getFraktionVoteBreakdown.

Use existing lib/i18n.ts for translations, lib/parties.ts for Fraktion colors. Bilingual DE/EN, German default.

Commit and push. Do NOT wait for input.
