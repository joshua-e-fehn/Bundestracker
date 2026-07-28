# Task — fix-scoring-32k

Fix the Convex 32k document read limit in activityScores.ts. The recomputeScores function reads too many activities at once. Add pagination: split the activityTallies query into batches by MP internalId, reading at most 500 activities per batch, and aggregate the results. Deploy with bunx convex deploy --yes. Push to main.
