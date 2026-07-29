import { type FunctionArgs, type FunctionReference, httpRouter } from "convex/server"
import { internal } from "./_generated/api"
import { type ActionCtx, httpAction } from "./_generated/server"
import { authComponent, createAuth } from "./betterAuth/auth"

/**
 * HTTP surface: Better Auth's own routes, plus the pipeline ingestion API.
 *
 * The ingestion API exists because the data pipeline is Python and the
 * database is Convex. There is no Convex client for Python, so the pipeline
 * reaches the deployment over HTTP and authenticates with a shared key in an
 * `Authorization: Bearer` header — a second mechanism to Better Auth, on
 * purpose, because a session is a thing only a browser can obtain.
 *
 * This file is transport only: key check, parsing, status codes. What the key
 * is allowed to *reach* is the `internal.*` mutations named below, every one an
 * upsert on a natural key — see convex/lib/ingest.ts for why that is the only
 * write shape here, and for the batch ceiling these routes inherit.
 */

const http = httpRouter()

// Registered first, and unconditionally: `registerRoutes` builds a Better Auth
// instance at module load, so a deployment missing BETTER_AUTH_SECRET fails
// this whole module — the pipeline routes included, whether or not they use it.
//
// CORS is on because the browser calls this from the Vercel domain while the
// auth backend runs here on Convex. The allowed origins come from
// `trustedOrigins` in betterAuth/auth.ts rather than being repeated here.
authComponent.registerRoutes(http, createAuth, { cors: true })

// --- auth -----------------------------------------------------------------

/**
 * Compares two secrets without leaking their contents through timing.
 *
 * Digests first rather than comparing the raw strings: it fixes the loop bound
 * so the length of the supplied key is not observable either. `crypto.subtle`
 * is ambient in Convex's V8 runtime; `node:crypto`'s `timingSafeEqual` would
 * force `"use node"`, which an httpAction module cannot use.
 */
async function secretEquals(a: string, b: string): Promise<boolean> {
  const encoder = new TextEncoder()
  const [digestA, digestB] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(a)),
    crypto.subtle.digest("SHA-256", encoder.encode(b)),
  ])
  const bytesA = new Uint8Array(digestA)
  const bytesB = new Uint8Array(digestB)
  let diff = 0
  for (let i = 0; i < bytesA.length; i++) {
    diff |= bytesA[i] ^ bytesB[i]
  }
  return diff === 0
}

async function authorized(request: Request): Promise<boolean> {
  const expected = process.env.PIPELINE_API_KEY
  // An unset key denies rather than allows. Convex env vars are per-deployment,
  // so forgetting it on production is a live possibility and the failure has to
  // be a locked door, not an open one.
  if (!expected) return false
  const offered = request.headers.get("Authorization")?.replace(/^Bearer /, "") ?? ""
  return await secretEquals(offered, expected)
}

// --- request / response plumbing -----------------------------------------

function json(body: unknown, status: number): Response {
  return Response.json(body, { status })
}

/**
 * Maps a thrown error to a response.
 *
 * Everything reachable from here is an `internal` function whose throws are
 * precondition failures — an unknown electoral period, a malformed record, an
 * id that decodes to nothing. Those are the caller's fault, so the default is
 * 400 with the message passed through: a pipeline that gets told *why* can
 * correct itself and log something useful, where an opaque 500 just gets
 * retried tomorrow.
 *
 * `not found` is matched anywhere in the message rather than at the start,
 * because a throw crossing the Convex boundary arrives wrapped as
 * `"Uncaught Error: …"`.
 */
function errorResponse(error: unknown): Response {
  const message = error instanceof Error ? error.message : String(error)
  return json({ error: message }, /not found/i.test(message) ? 404 : 400)
}

type PipelineHandler = (ctx: ActionCtx, request: Request, segments: string[]) => Promise<Response>

/**
 * Wraps a handler with the key check and error mapping.
 *
 * A combinator rather than a copied preamble so an ingestion route added later
 * cannot ship without the key check — the only way to register one is to go
 * through here.
 */
function pipelineRoute(handler: PipelineHandler) {
  return httpAction(async (ctx, request) => {
    if (!(await authorized(request))) {
      return json({ error: "Unauthorized" }, 401)
    }
    const segments = new URL(request.url).pathname.split("/").filter(Boolean)
    try {
      return await handler(ctx, request, segments)
    } catch (error) {
      // Reaching Convex through `runMutation` turns an argument-validator
      // rejection into a thrown error rather than a return value, so a
      // malformed record arrives here. Without the catch it would be a 500.
      return errorResponse(error)
    }
  })
}

/** Bodies are handed straight to Convex argument validators, which reject
 * unknown and mistyped fields — so this only has to guarantee an object. */
export async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  const body = await request.json()
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new Error("Request body must be a JSON object")
  }
  return body as Record<string, unknown>
}

/**
 * Asserts a request body into the argument type of the mutation it is passed
 * to, which TypeScript infers from the call site.
 *
 * Nothing is checked here and nothing can be: the value came off the wire. The
 * real check is the mutation's own argument validator, which rejects unknown,
 * missing and mistyped fields and throws — landing in `pipelineRoute`'s catch
 * as a 400 naming the offending field. This exists to say that once rather
 * than scatter casts down the file.
 */
function asArgs<T>(body: Record<string, unknown>): T {
  return body as unknown as T
}

// --- pipeline -------------------------------------------------------------

/**
 * `GET /api/pipeline/health` — does this key still open the door?
 *
 * The Python pipeline calls this before a long sync so a rotated or missing
 * `PIPELINE_API_KEY` surfaces as one clean 401 at the start, rather than as
 * several thousand of them an hour in.
 */
http.route({
  path: "/api/pipeline/health",
  method: "GET",
  handler: pipelineRoute(async () => {
    return json({ ok: true }, 200)
  }),
})

// --- ingestion ------------------------------------------------------------

/**
 * Registers `POST /api/pipeline/<path>` as a front door to one mutation.
 *
 * A table rather than thirteen near-identical `http.route` blocks, which is how
 * a key check ends up applied to twelve routes out of thirteen. The mutation
 * reference carries its own argument type, so `FunctionArgs` recovers it and
 * the body is asserted once here rather than cast per route.
 *
 * 200, not 201: a batch upsert is not a creation, and the inserted/updated
 * split is how the pipeline tells an incremental sync from one rewriting the
 * world nightly because a natural key stopped matching.
 */
function ingestionRoute<Ref extends FunctionReference<"mutation", "internal">>(
  path: string,
  mutation: Ref,
): void {
  http.route({
    path: `/api/pipeline/${path}`,
    method: "POST",
    handler: pipelineRoute(async (ctx, request) => {
      const body = await readJsonBody(request)
      return json(await ctx.runMutation(mutation, asArgs<FunctionArgs<Ref>>(body)), 200)
    }),
  })
}

// The roster first: everything else joins to it, and every other ingestion
// mutation rejects a record naming an MP who is not on it — §11.1's dependency
// order, enforced rather than merely documented.
ingestionRoute("mps", internal.mps.upsertMPs)

/** Attaches a DIP person id once the name match resolves it (§7.2). Separate
 * from the roster upsert because it happens a stage later and from a different
 * source — and §11.1 puts the roster first precisely so it need not wait. */
ingestionRoute("mps/link-dip", internal.mps.linkDipPersonId)

ingestionRoute("vote-sheets", internal.votes.upsertVoteSheet)
ingestionRoute("vote-records", internal.votes.upsertVoteRecords)

/**
 * Computes the per-record dissent flags and the period tally for ballots
 * ingested before those fields existed; loop on the returned `cursor` until
 * `done`.
 *
 * A migration rather than routine work — `upsertVoteRecords` maintains the tally
 * for every ballot from now on — so it is a route to be called deliberately,
 * like `search/backfill` above and for the same reason. Run it once per
 * deployment after this deploy; it is idempotent, so re-running repairs a tally
 * that has drifted rather than doubling it. See convex/votes.ts.
 */
ingestionRoute("votes/backfill-dissent", internal.votes.backfillDissent)

/**
 * Copies each vote record's ballot period and date onto the record — the
 * migration for the period-scoped vote index. Loop until `done`.
 *
 * A migration rather than routine work: `upsertVoteRecords` writes both columns
 * on every record from now on, so this exists only for the rows that predate
 * them. Needs no cursor — the un-migrated rows are exactly those the index
 * selects, and a migrated row leaves that range by being written — so a crashed
 * run resumes by being run again.
 *
 * ⚠ **Run this before `votes/backfill-dissent`, and before the next score
 * recomputation.** Both now read votes through the period-scoped index, and a
 * record this has not reached is absent from that range: the failure is an
 * undercount that repairs itself, not a wrong attribution, but it is a real one.
 * `votes:voteScopeCoverage` reports what remains, read-only. See convex/votes.ts.
 */
ingestionRoute("votes/backfill-scope", internal.votes.backfillVoteRecordScope)
ingestionRoute("motions", internal.motions.upsertMotions)
ingestionRoute("motion-sponsors", internal.motions.upsertMotionSponsors)
ingestionRoute("speeches", internal.speeches.upsertSpeeches)
ingestionRoute("questions", internal.questions.upsertQuestions)
ingestionRoute("committee-memberships", internal.committees.upsertCommitteeMemberships)
ingestionRoute("activities", internal.activities.upsertActivities)
ingestionRoute("activity-events", internal.activityEvents.addActivityEvents)
ingestionRoute("scores", internal.activityScores.upsertScore)

/** Regenerates the synthetic hemicycle. Derived in Convex from the roster
 * rather than posted, because there is nothing to post — see
 * convex/seating.ts. */
ingestionRoute("seating/generate", internal.seating.generateSeating)

/** Rescores a slice of the roster; loop until `hasMore` is false. For a
 * backfill that wants its scores now rather than at the cron's next run — see
 * convex/scoreSweep.ts for why it is sliced. */
ingestionRoute("scores/recompute", internal.activityScores.recomputeScores)

/**
 * Fills `searchText` on feed events written before the field existed; loop on
 * the returned `cursor` until `done`.
 *
 * A migration rather than routine work — every new event derives the field on
 * write — so it is a route to be called deliberately, not a cron. Run it once
 * per deployment, and again after any change to the folding rule in
 * lib/search.ts. See convex/search.ts.
 */
ingestionRoute("search/backfill", internal.search.backfillSearchText)

export default http
