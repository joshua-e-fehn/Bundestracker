# Task — fix-ui-issues

Fix multiple UI/UX issues on Bundestracker. Do NOT ask questions — fix everything autonomously.

## Issues to fix:

### 1. Homepage: Add seating map preview
- Add a small/medium version of the parliament seating map (the hemicycle SVG from /seating) to the homepage hero area
- Place it in the empty top-right whitespace next to the hero text
- It should be visually appealing, clickable, and link to /seating
- Use the existing seating-map.tsx component or create a compact variant

### 2. Homepage: Fix the activity heatmap in 'Most active members'
- The dot-matrix activity heatmap in each member card is too tall/narrow
- Make it wider and shorter (more like GitHub's contribution graph — wider rows, fewer rows)
- Fix alignment — the heatmap, name, and score should be properly aligned in each card row

### 3. Homepage: Fix top-right navbar whitespace
- The area next to the search icon in the top right has unused whitespace
- Either add useful elements or tighten the layout

### 4. Members page: Add more filters
- Add filters for: Federal state (Bundesland), Committee membership, Election method (direct/list)
- Add a sort dropdown in addition to clickable column headers

### 5. Members page: Fix sorting on ALL columns
- Every column should be sortable (ascending/descending): Name, Party, Constituency, Activity score, Voting participation
- Clicking a column header should toggle asc/desc
- Show sort indicator (↑/↓ arrows) on the active sort column

### 6. Members page: Fix CSS overflow bug
- Currently clicking any MP row opens Lisa Badum's page (the last visible entry)
- This is a CSS overlap/overflow issue where the link areas are misaligned
- Fix the table row layout so each row's click target is correct

### 7. Members page: Activity score and Voting participation show dashes
- These columns show '—' for all MPs instead of values
- The seed data includes activity scores — the query needs to join the score data properly
- Fix the Convex query to include activity scores and voting participation in the MP list

### 8. Votes page: Only 2 votes shown
- Check whether the seed data only has 2 votes or if it's a query/filter issue
- If the seed data is limited, that's expected for now — but verify the query isn't filtering anything out

### 9. Rankings page: Fix tab overflow
- The 9 category tabs may overflow on smaller screens
- Add horizontal scroll (overflow-x: auto) or make tabs wrap properly
- Ensure the select dropdowns don't overflow either

### 10. Rankings page: Only 'Most active' tab has data
- Other tabs (Most speeches, Most motions, etc.) may show empty tables
- Ensure each tab queries the correct metric from the activity scores

## Approach:
1. Start the dev server (cd webapp && bun run dev)
2. Take screenshots before and after each fix
3. Fix all issues
4. Verify each fix in the browser
5. Commit and push all fixes

Do NOT wait for input. Fix everything, screenshot your work, commit, and push.
