# Task — convex-verify

Verify and fix the Convex ingestion pipeline. The schema and domain modules were just merged in PR #3. Your job is to verify that the Convex mutations, HTTP endpoints, and crons all work correctly together.

Specifically:

1. Read webapp/convex/schema.ts and all domain modules (mps.ts, votes.ts, motions.ts, speeches.ts, questions.ts, committees.ts, activities.ts, activityEvents.ts, activityScores.ts, seating.ts, userPreferences.ts).

2. Read webapp/convex/http.ts — verify the HTTP mutation endpoints are correctly wired for the Python pipeline to call via POST. Each endpoint should accept JSON, validate it, and call the corresponding mutation.

3. Read webapp/convex/crons.ts — verify the daily cron is properly configured to recompute activity scores.

4. Read webapp/lib/scoring.ts — verify the activity score computation matches the concept doc's default weights (25% motions, 20% speeches, 15% questions, 15% reports, 10% voting participation, 10% committee work, 5% legislative sponsorship).

5. Run bunx convex dev in the webapp directory to deploy to a dev Convex deployment. Fix any schema validation errors, type errors, or import issues you find.

6. Test the HTTP endpoints by calling them with curl using sample data:
   - POST to upsert an MP
   - POST to upsert a vote sheet with vote records
   - POST to upsert a motion
   - Verify the data appears in queries

7. Create webapp/convex/lib/ingest.ts if it doesn't exist or improve the existing one — this is the shared ingestion logic (idempotent upserts by external ID, batch writes, error handling).

8. If you find any issues, fix them. Commit and push all fixes.

The goal is a verified, working Convex backend that the Python pipeline can write to and the frontend can read from.
