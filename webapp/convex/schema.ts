import { defineSchema } from "convex/server"

/**
 * The application schema.
 *
 * Empty at scaffold time — the Bundestag domain tables (members, motions,
 * speeches, votes, questions, committee memberships, activity scores) land
 * here as the pipeline work arrives.
 *
 * Two things to know before adding a table:
 *
 *  - Better Auth's tables (user, session, account, verification, jwks) are
 *    *not* here. They live in the component's own schema, at
 *    `convex/betterAuth/schema.ts`. A table that belongs to a user references
 *    them by `v.string()` — the Better Auth user id — and never by
 *    `v.id("user")`, because there is no local `user` table to name.
 *
 *  - Rows written by the Python pipeline carry the DIP record id, so ingestion
 *    can upsert and a half-finished sync can be re-run without duplicating.
 *    Give those tables an index on that id.
 *
 * Schema validation is on (the default): until a table is declared here,
 * writing to it is rejected. That is the intended state — it makes the first
 * ingestion mutation declare its shape rather than inherit one by accident.
 */
export default defineSchema({})
