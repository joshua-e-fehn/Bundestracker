# Task — data-mp-enrichment

Wave 8 Agent H: MP photos, biography, and occupation enrichment for Bundestracker. Do NOT ask questions — proceed autonomously.

Read /opt/data/workspace/Bundestrack-Plan-V2.md (Wave 8 section) and AGENTS.md.

Your tasks:
1. RESEARCH abgeordnetenwatch.de API — check if it has photos and biographical data for WP21 MPs. Check their API docs. Also check bundestag.de for image URLs.
2. IMPLEMENT a Python module (pipeline/src/bundestrack/api/abgeordnetenwatch.py) that fetches:
   - MP photos (portrait image URLs)
   - Occupation/profession
   - Education
   - Biography text
   - Contact information (email, phone, office address, social media)
3. UPDATE the Convex schema (webapp/convex/schema.ts) to add fields: photoUrl, occupation, education, biography, email, phone, officeAddress
4. UPDATE the pipeline transform to include these new fields in MP payloads
5. UPDATE the pipeline sync to fetch and enrich MPs during sync
6. UPDATE the frontend to display photos instead of initials (with initials as fallback for MPs without photos)
7. DISPLAY occupation prominently in: member table (after party), profile page, activity feed entries, seating map tooltips
8. Also fetch contact data from the Bundestag Stammdaten API (email, phone, address) and store it
9. Update the MP profile page to show all contact information in a clean section

Commit and push. Do NOT wait for input.

---

## Findings that changed the task (verified live, 2026-07-27)

Three instructions above rest on premises the sources do not support. Each was
tested against the live source rather than assumed; what shipped instead is
recorded here so the difference is a decision on the record rather than a silent
omission.

**§6.5 is out of date — portraits are 100 %, not 36.5 %.**
`docs/api-research.md` §6.5 found no official bulk portrait source, could not
reach the profile pages (WAF 303), and settled on Wikimedia Commons at 36.5 % of
WP21. The Bundestag's own AJAX MP listing answers 200 and carries a portrait for
**639 of 639**, each with a photographer credit; 635 join to the roster through
the existing resolver, none ambiguously. That is the source used. §6.5's
*licensing* warning stands and is now concrete: the images are credited rather
than open-licensed, so they are hotlinked with the credit displayed beside them
and never rehosted.

**Task 8's premise is false — no email or phone is published anywhere.**
`MDB_STAMMDATEN.DTD` declares `BIOGRAFISCHE_ANGABEN` with no contact elements at
all (the 15 MB dump holds one `@` character in total), and 13 sampled biography
pages carry zero `mailto:` and zero `tel:` links. What the Bundestag publishes is
a contact *form*, plus constituency-office addresses and the MP's own social
profiles. Those ship, and the Contact card states in words that no address or
number is published — an unexplained absence would read as data the pipeline had
failed to fetch. The Berlin office is deliberately not stored: it is
`Platz der Republik 1` for all 630, so it is a UI constant, not 630 rows.

**Task 7's activity-feed occupation is deliberately omitted.**
`components/activity-feed-item.tsx:235` records that the feed row already wraps
at three names plus badges, which was a Wave 6 fix; a fourth element would undo
it. Occupation reaches the reader there through the profile link. Every other
surface named in task 7 — member table after party, profile page, seating
tooltip — has it.

**Also corrected:** occupation and education come from abgeordnetenwatch's
`politicians` endpoint, which carries `ext_id_bundestagsverwaltung` — the 8-digit
Stammdaten id — so that join is by id and needs no name matching. Task 2 asked
for biography text; Stammdaten's `VITA_KURZ` already supplies it for 95.6 % of
WP21 and was already ingested as `bio`, so no new source was needed.
