# Task — frontend-trend-graphs

Build trend graphs for Bundestracker MP profiles. Do NOT ask questions — proceed autonomously.

Read webapp/convex/schema.ts and webapp/convex/activityScores.ts first.

Tasks:
1. Install recharts: cd webapp && bun add recharts
2. Create webapp/components/trend-graphs.tsx — container with tabs for:
   - Activity over time (line chart: total score per month)
   - Speeches per month (bar chart)
   - Motions per month (bar chart)
   - Questions submitted (cumulative area chart)
   - Votes attended (stacked bar: yes/no/abstain/absent)
3. Add Convex query getMonthlyScoresByMP to activityScores.ts (or a new file) — returns monthly score breakdown for an MP
4. Use recharts for all charts. Dark theme compatible (use Tailwind CSS variables).
5. Bilingual labels (DE/EN) via lib/i18n.ts
6. Integrate into the MP profile page (webapp/app/mps/[id]/page.tsx) — add a 'Trends' tab/section

Commit and push. Do NOT wait for input.
