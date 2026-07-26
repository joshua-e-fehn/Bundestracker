import { httpRouter } from "convex/server"
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
 * is allowed to *reach* belongs in a dedicated `convex/ingest.ts`, so that
 * question has one short answer rather than a route handler each to audit.
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

// Ingestion routes attach here — `POST /api/pipeline/members`,
// `/api/pipeline/activities`, and so on. Each one parses its body with
// `readJsonBody`, hands it to an `internal.ingest.*` mutation that upserts on
// the DIP record id, and returns 201. Register them with `pipelineRoute` so
// they inherit the key check.

export default http
