# Task — frontend-seating-map

Build the parliament seating map for Bundestracker. Do NOT ask any questions — proceed autonomously. Read AGENTS.md and docs/api-research.md section 9 (seating arrangements — no official data exists, generate synthetically from Fraktion sizes).

Build:
1. /seating page — SVG hemicycle with 730+ seats, clickable, color modes (party, coalition/opposition, activity, attendance, committee), zoom/pan, legend
2. webapp/lib/seating.ts — synthetic seat position generation from Fraktion sizes (arc layout, government right, opposition left)
3. Components: seating-map.tsx (SVG), seating-legend.tsx, color-mode-toggle.tsx, seat-tooltip.tsx
4. Convex: update seating.ts with upsertSeatingAssignments (generate from MP data) and getSeatingWithMPs (join seating with MP profiles + activity scores)

Bilingual DE/EN, German default.

Commit and push when done. Do NOT wait for user input.
