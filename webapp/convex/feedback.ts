import { v } from "convex/values"
import {
  isFeedbackKind,
  LIMITS,
  type SafeDiagnostics,
  sanitizeBreadcrumb,
  sanitizeEnvironment,
  sanitizeError,
  sanitizeRequest,
  sanitizeUrl,
  truncate,
  validateReport,
} from "../lib/feedback"
// Relative, not "@/lib/…": convex/tsconfig.json defines no path aliases.
import {
  duplicateSearchTerms,
  issueBody,
  issueLabels,
  issueTitle,
  type PublicReport,
} from "../lib/feedback-issue"
import { internal } from "./_generated/api"
import type { Id } from "./_generated/dataModel"
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  type MutationCtx,
  mutation,
  type QueryCtx,
  query,
} from "./_generated/server"
import { getUserId } from "./lib/auth"
import { preferredLocale, safeDiagnostics } from "./schema"

/**
 * The feedback intake: an anonymous stranger's bug report, on its way to a
 * public GitHub issue.
 *
 * ## The trust model, which is unlike every other file here
 *
 * Every other write path in this deployment is either the Python pipeline
 * holding a shared key (convex/http.ts) or a signed-in reader touching their
 * own preferences (convex/userPreferences.ts). This one is **an unauthenticated
 * public mutation**, which is the only one in the codebase, and it is therefore
 * written against a caller assumed to be a hand-written HTTP request rather
 * than this app's widget.
 *
 * That assumption is what dictates the shape:
 *
 *  - Every free-text field is re-truncated here even though the widget already
 *    truncated it. The widget's limits are a courtesy to the reader; these are
 *    the actual bound.
 *  - Every diagnostic is re-sanitized here through the same functions the
 *    browser used, because a caller who skipped the browser skipped them.
 *  - The GitHub token is never reachable from the mutation. Publication is a
 *    separate scheduled action, so a caller cannot make the deployment perform
 *    an authenticated outbound request synchronously and read the timing.
 *
 * ## Why the write and the publish are two functions
 *
 * A mutation cannot `fetch`. That is a Convex constraint rather than a design
 * choice, but it produces the right design anyway: the report is durably stored
 * first and published second, so GitHub being down is a retry rather than a
 * lost report, and the reader gets a confirmation as soon as the row is
 * committed rather than after a round-trip to another company's API.
 *
 * ## What bounds abuse without a captcha
 *
 * There is no client IP available to a Convex mutation — no request object
 * exists — so the usual key is unavailable. What is here instead, in order of
 * how much it actually stops:
 *
 *  1. **A per-deployment daily cap.** The only control that holds against a
 *     determined attacker, because it does not depend on the caller
 *     cooperating. Once `DAILY_DEPLOYMENT_CAP` reports exist in 24 hours,
 *     everything is rejected until the window rolls.
 *
 *     ⚠ It only holds if being refused cannot raise it. It did not, once:
 *     every rejection inserted a counted row, so ~200 forged requests closed
 *     the form for a day and each further one wrote another row. See
 *     `CAP_CONSUMING_STATUSES` and the two-branch rejection in `submitReport`
 *     — a control that the caller can inflate is an attack surface wearing a
 *     defence's name.
 *  2. **A per-browser cap**, keyed on a random identifier the client generates
 *     and stores. Resettable by clearing storage, and stated as such — it stops
 *     double-submits and casual repetition, nothing more.
 *  3. **A minimum dwell time.** A report submitted less than
 *     `MIN_DWELL_MS` after the form was opened was not typed by a person.
 *  4. **A honeypot field**, filled only by something that fills every field.
 *  5. **A kill switch** — unset `GITHUB_FEEDBACK_TOKEN` and nothing publishes,
 *     while reports still queue.
 *
 * None of these is a captcha and none pretends to be. The honest summary is in
 * docs/verification/feedback-reporting.md, including what to turn on if the
 * form is ever actually attacked.
 */

// --- limits ---------------------------------------------------------------

/** Reports one browser may file in a rolling day. Generous — a reporter
 * finding several genuine bugs in one session is the *good* case. */
const DAILY_CLIENT_CAP = 5

/**
 * Reports this deployment accepts in a rolling day, from everyone.
 *
 * The backstop that does not depend on the caller cooperating, and therefore
 * the only number here that bounds a determined attacker. Set well above
 * plausible organic volume for a site of this size: reaching it means something
 * is wrong, and the right failure is a closed form rather than a thousand
 * issues in a public repository.
 */
const DAILY_DEPLOYMENT_CAP = 200

/** A form submitted faster than this was not filled in by a human. Two seconds
 * is below any real reporter and above any plausible clock skew. */
const MIN_DWELL_MS = 2000

/**
 * Upload URLs one browser, and the whole deployment, may mint in a rolling day.
 *
 * Higher than the report caps because minting is not filing: the widget mints
 * on submission and a reporter may retake a screenshot or abandon a draft. Low
 * enough that an anonymous caller cannot mint unbounded blob storage, which is
 * what the previous gate — counting *reports*, of which minting creates none —
 * failed to bound at all.
 */
const DAILY_CLIENT_UPLOAD_CAP = 20
const DAILY_DEPLOYMENT_UPLOAD_CAP = 500

/**
 * Outbound GitHub duplicate searches one browser, and the deployment, may spend
 * in a rolling day.
 *
 * The per-client figure is generous: the check fires on every "Continue" press,
 * and a reporter who rewords a title three times must not be refused. The
 * deployment figure is the one that matters — GitHub allows an authenticated
 * token **30 searches a minute**, so 2000 a day is far above any plausible
 * organic volume while still bounding a caller who rotates `clientKey` to
 * defeat the per-client bound. Hitting it degrades duplicate detection, never
 * report filing: `findDuplicates` returns `[]` and the reporter files as usual.
 */
const DAILY_CLIENT_SEARCH_CAP = 30
const DAILY_DEPLOYMENT_SEARCH_CAP = 2000

/** How long a search record is kept. It exists only to be counted inside the
 * rolling 24-hour window, so anything older is bookkeeping nobody reads. Two
 * days rather than one, so a row is never reaped while still inside the window
 * some in-flight call is measuring. */
const SEARCH_RETENTION_MS = 2 * 24 * 60 * 60 * 1000

/**
 * How long an unclaimed upload lives before the sweep reclaims it.
 *
 * An hour is far longer than the seconds between minting a URL and submitting
 * the report it belongs to, so a slow connection is never punished; and short
 * enough that abandoned files are not storage anyone pays for. Claimed rows are
 * untouched by this — their lifetime belongs to the report.
 */
const UPLOAD_ORPHAN_TTL_MS = 60 * 60 * 1000

/** How long a report is kept. Long enough to act on and reply to; short enough
 * that this table is not an accumulating store of strangers' email addresses.
 * Enforced by `sweepExpiredReports`, run daily from convex/crons.ts. */
const RETENTION_DAYS = 90

const DAY_MS = 24 * 60 * 60 * 1000

// --- the rate limiter -----------------------------------------------------

/** Why a submission was refused, or null. Exported for the unit tests, which
 * is the whole reason the decision is a pure function over counts rather than
 * three inline `if`s inside the mutation. */
export type RejectionReason =
  | "too-many-from-client"
  | "too-many-for-deployment"
  | "too-fast"
  | "honeypot"

/**
 * Decides whether a submission is accepted, from facts the caller cannot forge
 * *except* for `dwellMs` and `honeypot`, which it can and which are therefore
 * the two weakest checks here.
 *
 * Pure and exported so convex/feedback.test.ts can pin each rule independently
 * — the same reason `withFollow` is pulled out of `userPreferences.ts`.
 */
export function rejectionFor(input: {
  clientReportsToday: number
  deploymentReportsToday: number
  dwellMs: number
  honeypot: string
}): RejectionReason | null {
  // The honeypot first: it is the cheapest check and the one whose failure says
  // the most about the caller.
  if (input.honeypot.trim().length > 0) return "honeypot"
  if (input.dwellMs < MIN_DWELL_MS) return "too-fast"
  // The deployment cap before the per-client one: when the deployment is at its
  // ceiling the per-client answer is irrelevant, and reporting the more
  // fundamental reason makes an operator's log read correctly.
  if (input.deploymentReportsToday >= DAILY_DEPLOYMENT_CAP) return "too-many-for-deployment"
  if (input.clientReportsToday >= DAILY_CLIENT_CAP) return "too-many-from-client"
  return null
}

/** Reports from one browser inside the rolling window. Counts `rejected` rows
 * too — a limiter that forgets what it refused refuses nothing. */
async function clientReportsSince(
  ctx: QueryCtx,
  clientKey: string,
  since: number,
): Promise<number> {
  const rows = await ctx.db
    .query("feedbackReports")
    .withIndex("by_clientKey_and_createdAt", (q) =>
      q.eq("clientKey", clientKey).gte("createdAt", since),
    )
    // Bounded by the cap plus one: the answer is only ever compared against
    // `DAILY_CLIENT_CAP`, so collecting more rows than that is wasted reads.
    .take(DAILY_CLIENT_CAP + 1)
  return rows.length
}

/**
 * The statuses a row must be in to count against the *deployment* ceiling.
 *
 * Deliberately excludes `rejected`, and that exclusion is a security property
 * rather than an accounting nicety.
 *
 * ⚠ Counting every row by `createdAt` — which this used to do — made the
 * deployment cap the cheapest attack on the feature instead of its strongest
 * control. A rejection is free and unconditional to the caller (`honeypot` and
 * `dwellMs` are checked before the caps and are both caller-supplied), so ~200
 * requests carrying `honeypot: "x"` inserted 200 counted rows and every genuine
 * reporter was then refused `too-many-for-deployment` for a rolling day. Worse,
 * each further request was itself rejected and inserted *another* row: there was
 * a ceiling on acceptance and none at all on writes.
 *
 * The invariant now, stated so a test can assert it: **being refused can never
 * raise the number that causes refusals.**
 */
export const CAP_CONSUMING_STATUSES = ["pending", "published", "failed"] as const

/**
 * Whether a refused submission leaves a row behind.
 *
 * The other half of the same invariant, pulled out as a pure function so
 * convex/feedback.test.ts can pin it without a deployment — the defect it
 * encodes lived in the *caller* of `rejectionFor`, which is precisely the place
 * a pure-function test could not previously reach.
 *
 * `honeypot` and `too-fast` are decided entirely from caller-supplied
 * arguments, so an attacker produces them at will and for free. Writing a row
 * for those made refusal the attack. The cap rejections are different: they are
 * evidence of real quota pressure from a browser that has already been counted,
 * and recording them is what keeps a repeat offender's own limit ticking.
 */
export function persistsRejection(reason: RejectionReason): boolean {
  return reason === "too-many-from-client" || reason === "too-many-for-deployment"
}

/**
 * Whether a stored row counts against the deployment ceiling.
 *
 * Exported for the same reason as `persistsRejection`, and asserted against
 * `CAP_CONSUMING_STATUSES` so the two cannot drift: a `rejected` row that
 * started counting would restore the denial of service in one character.
 */
export function consumesDeploymentQuota(status: string): boolean {
  return (CAP_CONSUMING_STATUSES as readonly string[]).includes(status)
}

/**
 * Reports from everyone inside the rolling window that actually consumed quota.
 *
 * Three index reads rather than one, because `by_createdAt` cannot express
 * "any status but rejected" — Convex indexes have no negation. `take` bounds
 * each read, so the cost is bounded by the cap regardless of how many rows the
 * window holds.
 */
async function deploymentReportsSince(ctx: QueryCtx, since: number): Promise<number> {
  let total = 0
  for (const status of CAP_CONSUMING_STATUSES) {
    const rows = await ctx.db
      .query("feedbackReports")
      .withIndex("by_status_and_createdAt", (q) => q.eq("status", status).gte("createdAt", since))
      .take(DAILY_DEPLOYMENT_CAP + 1)
    total += rows.length
    // Short-circuit: the answer is only ever compared against the cap.
    if (total > DAILY_DEPLOYMENT_CAP) return total
  }
  return total
}

// --- submission -----------------------------------------------------------

/** The wire shape of a report. Mirrors the widget's state, and is re-validated
 * here in full — see the header. */
const submissionArgs = {
  kind: v.string(),
  title: v.string(),
  description: v.string(),
  contact: v.string(),
  pageUrl: v.union(v.null(), v.string()),
  locale: v.string(),
  diagnostics: v.union(v.null(), safeDiagnostics),
  screenshotId: v.union(v.null(), v.id("_storage")),
  /** The mint row `generateScreenshotUploadUrl` returned, so the file can be
   * bound to its record exactly rather than guessed at. Untrusted, like every
   * argument here — see `bindUpload`. */
  uploadId: v.union(v.null(), v.id("feedbackUploads")),
  /** The random per-browser identifier. See the field note in convex/schema.ts
   * for why this is not an IP and what it does and does not stop. */
  clientKey: v.string(),
  /** Milliseconds between the widget opening and the submission. */
  dwellMs: v.number(),
  /** The honeypot. A real reporter never sees this field, so a non-empty value
   * is a bot that filled every input it found. */
  honeypot: v.string(),
  /**
   * Issue numbers the reporter was shown as possible duplicates and filed
   * anyway.
   *
   * Sent by the widget rather than re-derived here, because it records what the
   * reporter actually saw — a second search from the server could return a
   * different set and would be recording something else. Purely a triage
   * signal: it never gates the submission.
   */
  duplicateCandidates: v.array(v.number()),
}

/**
 * Files a report.
 *
 * Returns the row id and whether publication was queued. Deliberately does
 * **not** return the GitHub issue URL: it does not exist yet, and inventing a
 * "your issue is at #N" before the API has answered would be the kind of
 * plausible-wrong-answer this codebase refuses elsewhere. The widget says the
 * report was received, which is what actually happened.
 *
 * A rejected submission returns `{ accepted: false }` rather than throwing. The
 * reader sees a polite message; a thrown error would render the route's error
 * boundary and lose everything they typed.
 */
export const submitReport = mutation({
  args: submissionArgs,
  returns: v.object({
    accepted: v.boolean(),
    reportId: v.union(v.null(), v.id("feedbackReports")),
    reason: v.union(v.null(), v.string()),
  }),
  handler: async (ctx, args) => {
    const now = Date.now()
    const since = now - DAY_MS
    const clientKey = truncate(args.clientKey.trim(), 64) || "unknown"

    const rejection = rejectionFor({
      clientReportsToday: await clientReportsSince(ctx, clientKey, since),
      deploymentReportsToday: await deploymentReportsSince(ctx, since),
      dwellMs: args.dwellMs,
      honeypot: args.honeypot,
    })

    if (rejection) {
      // An uploaded screenshot belonging to a refused report is deleted rather
      // than orphaned in storage — whichever branch below is taken.
      if (args.screenshotId) await ctx.storage.delete(args.screenshotId)

      // ⚠ The two kinds of rejection are recorded differently, and the
      // difference is the fix for a denial-of-service this once had.
      //
      // `honeypot` and `too-fast` are decided entirely from caller-supplied
      // arguments, so an attacker can produce them at will and for free.
      // Writing a row for those made refusal itself the attack: 200 requests
      // carrying `honeypot: "x"` inserted 200 rows, the deployment cap counted
      // them, and every genuine reporter was refused for a rolling day — while
      // each further request inserted another row, unbounded.
      //
      // So a forgeable rejection now leaves **no trace at all**. Nothing is
      // lost by that: the row it used to write was blank, and the per-client
      // limiter it was supposedly feeding is keyed on a value the same
      // attacker chooses.
      if (!persistsRejection(rejection)) {
        return { accepted: false, reportId: null, reason: rejection }
      }

      // A cap rejection is real quota pressure and is recorded, so a repeat
      // offender's own limit keeps counting. It is written as `rejected`, which
      // `CAP_CONSUMING_STATUSES` deliberately excludes from the deployment
      // total — being refused must never raise the number that causes refusals.
      // Text is dropped: storing it would make the table a place to write
      // arbitrary content by being refused.
      await ctx.db.insert("feedbackReports", {
        kind: "other",
        title: "",
        description: "",
        contact: null,
        pageUrl: null,
        locale: null,
        diagnostics: null,
        screenshotId: null,
        status: "rejected",
        githubIssueNumber: null,
        githubIssueUrl: null,
        failureReason: rejection,
        duplicateCandidates: [],
        userId: null,
        clientKey,
        createdAt: now,
        updatedAt: now,
      })
      return { accepted: false, reportId: null, reason: rejection }
    }

    const title = truncate(args.title.trim(), LIMITS.title)
    const description = truncate(args.description.trim(), LIMITS.description)
    const contact = truncate(args.contact.trim(), LIMITS.contact)

    const invalid = validateReport({ title, description, contact })
    if (invalid) {
      if (args.screenshotId) await ctx.storage.delete(args.screenshotId)
      return { accepted: false, reportId: null, reason: invalid }
    }

    const reportId = await ctx.db.insert("feedbackReports", {
      kind: isFeedbackKind(args.kind) ? args.kind : "other",
      title,
      description,
      contact: contact || null,
      // Re-sanitized rather than trusted: the client already did this, and a
      // client that did not is exactly the caller this guards against.
      pageUrl: sanitizeUrl(args.pageUrl),
      locale: args.locale === "de" || args.locale === "en" ? args.locale : null,
      diagnostics: args.diagnostics ? resanitize(args.diagnostics) : null,
      // Not `args.screenshotId` directly: the file is size-checked against
      // `LIMITS.screenshotBytes` server-side and its mint row is claimed, so an
      // oversized upload degrades to no screenshot instead of being stored.
      screenshotId: await claimScreenshot(ctx, args.screenshotId, args.uploadId),
      status: "pending",
      githubIssueNumber: null,
      githubIssueUrl: null,
      failureReason: null,
      // Bounded and coerced like every other wire value: a caller could
      // otherwise post a thousand numbers into a triage field.
      duplicateCandidates: args.duplicateCandidates
        .slice(0, 10)
        .map((n) => Math.trunc(Number(n)))
        .filter((n) => Number.isFinite(n) && n > 0),
      // Read from the session, never accepted as an argument — the rule
      // convex/userPreferences.ts states and for the same reason.
      userId: await getUserId(ctx),
      clientKey,
      createdAt: now,
      updatedAt: now,
    })

    // Published out of band. `runAfter(0)` rather than an inline call because a
    // mutation cannot fetch; see the header.
    await ctx.scheduler.runAfter(0, internal.feedback.publishReport, { reportId })

    return { accepted: true, reportId, reason: null }
  },
})

/**
 * Re-runs every sanitizer over diagnostics that arrived over the wire.
 *
 * The validator has already proved the *shape*; this proves the *values*. A
 * hand-written caller can satisfy `safeDiagnostics` while putting a full URL
 * with a token in `requests[].url`, a keystroke log in `breadcrumbs[].target`,
 * or 40 kB in `errors[].message` — all of them strings, all of them valid
 * against the schema. Running the same functions the browser ran is what closes
 * that gap, and it is cheap.
 */
function resanitize(diagnostics: SafeDiagnostics): SafeDiagnostics {
  return {
    environment: sanitizeEnvironment(diagnostics.environment),
    // `stack` arrives as an array here (it has already been through
    // `sanitizeError` in the browser) while `sanitizeError` takes the raw
    // newline-joined string an `Error` carries. Re-joining is what makes the
    // function idempotent over its own output, which is exactly what running it
    // a second time on the server requires.
    errors: diagnostics.errors
      .slice(0, LIMITS.errors)
      .map((error) => sanitizeError({ ...error, stack: error.stack.join("\n") })),
    requests: diagnostics.requests
      .slice(0, LIMITS.requests)
      .map((request) => sanitizeRequest(request)),
    breadcrumbs: diagnostics.breadcrumbs
      .slice(0, LIMITS.breadcrumbs)
      .map((crumb) => sanitizeBreadcrumb(crumb))
      .filter((crumb): crumb is NonNullable<typeof crumb> => crumb !== null),
  }
}

/**
 * An upload URL for the screenshot, and the row that makes the file reclaimable.
 *
 * A mutation because `generateUploadUrl` is only available on a writer context.
 * Public and unauthenticated, like the submission itself.
 *
 * ## Two things this gets right that it previously did not
 *
 * **The file is now reachable if it is abandoned.** A minted URL used to
 * produce a file with nothing pointing at it, and `sweepExpiredReports` walks
 * `feedbackReports` — so an upload with no report was never deleted, by
 * anything, ever. A `feedbackUploads` row is written here so the orphan sweep
 * has a cursor to find it by.
 *
 * **The gate now counts what it is gating.** It used to check the *report*
 * caps, and minting a URL files no report — so on a quiet deployment the
 * deployment gate read `0 >= 200` permanently and bounded nothing at all. Mint
 * volume is what is capped now, which is the quantity an attacker consumes.
 *
 * ## The returned `uploadId` is how the file gets bound to its record
 *
 * A mint row cannot know its `storageId`: the id does not exist until the
 * client has POSTed to the URL. Returning the row's own id and taking it back
 * at submission is what closes that gap **exactly**, rather than guessing which
 * unclaimed row a file belongs to — see `bindUpload`.
 */
export const generateScreenshotUploadUrl = mutation({
  args: { clientKey: v.string() },
  returns: v.union(v.null(), v.object({ url: v.string(), uploadId: v.id("feedbackUploads") })),
  handler: async (ctx, args) => {
    const now = Date.now()
    const since = now - DAY_MS
    const clientKey = truncate(args.clientKey.trim(), 64) || "unknown"

    const clientMints = await ctx.db
      .query("feedbackUploads")
      .withIndex("by_clientKey_and_createdAt", (q) =>
        q.eq("clientKey", clientKey).gte("createdAt", since),
      )
      .take(DAILY_CLIENT_UPLOAD_CAP + 1)
    if (clientMints.length >= DAILY_CLIENT_UPLOAD_CAP) return null

    const deploymentMints = await ctx.db
      .query("feedbackUploads")
      .withIndex("by_createdAt", (q) => q.gte("createdAt", since))
      .take(DAILY_DEPLOYMENT_UPLOAD_CAP + 1)
    if (deploymentMints.length >= DAILY_DEPLOYMENT_UPLOAD_CAP) return null

    const uploadId = await ctx.db.insert("feedbackUploads", {
      // Null until the client uploads and hands the id back at submission,
      // alongside the `uploadId` returned here. The row exists from *minting*
      // precisely so that gap is accounted for rather than invisible.
      storageId: null,
      clientKey,
      claimed: false,
      createdAt: now,
    })
    return { url: await ctx.storage.generateUploadUrl(), uploadId }
  },
})

/**
 * Adopts an uploaded file into a report, or refuses it.
 *
 * Refuses — by deleting the file and returning null — when it is larger than
 * `LIMITS.screenshotBytes`. That ceiling existed as a constant and was enforced
 * **only in the browser**, against a hardcoded literal, which is no enforcement
 * at all against the hand-written caller this file assumes: the upload URL
 * accepts whatever is POSTed to it. `ctx.db.system.get("_storage", id)` is the
 * server's own view of what actually landed.
 *
 * A refused screenshot degrades the report to one without a picture rather than
 * failing it. The reporter's words are the valuable part.
 */
async function claimScreenshot(
  ctx: MutationCtx,
  storageId: Id<"_storage"> | null,
  uploadId: Id<"feedbackUploads"> | null,
): Promise<Id<"_storage"> | null> {
  if (!storageId) return null

  const metadata = await ctx.db.system.get("_storage", storageId)
  if (!metadata || metadata.size > LIMITS.screenshotBytes) {
    await ctx.storage.delete(storageId).catch(() => {})
    // Bound even on refusal, so the row is claimed rather than left for the
    // orphan sweep to reap an hour later — the file is already gone.
    await bindUpload(ctx, uploadId, storageId)
    return null
  }

  await bindUpload(ctx, uploadId, storageId)
  return storageId
}

/**
 * Binds an uploaded file to the mint row that produced its URL.
 *
 * ## Why the caller names the row
 *
 * A mint row is written before the file exists — `generateUploadUrl` returns a
 * URL, and the `storageId` only comes into being when the client POSTs to it —
 * so at mint time there is nothing to record but `storageId: null`.
 *
 * The first attempt at this looked the row up by `storageId` and, failing that,
 * adopted "the newest unclaimed row". Since no row can ever carry the id on a
 * first claim, **the fallback was the only path that ever ran**: the indexed
 * lookup was dead code and the comment presented the guess as the rare branch.
 * The blast radius was small — under concurrency the wrong row is marked, and a
 * file is never orphaned because the report holds the reference — but it was a
 * guess describing itself as a lookup.
 *
 * `generateScreenshotUploadUrl` now returns the row's own id and the client
 * hands it back at submission, so the binding is exact. The id is
 * caller-supplied and therefore untrusted: a row that does not exist, or one
 * already claimed, is ignored rather than trusted, and a mismatched id costs
 * nothing more than an hour's wait for the orphan sweep.
 *
 * The `by_storageId` lookup is kept as the fallback it always should have been:
 * it is what makes a *re*-submission of the same file idempotent.
 */
async function bindUpload(
  ctx: MutationCtx,
  uploadId: Id<"feedbackUploads"> | null,
  storageId: Id<"_storage">,
): Promise<void> {
  if (uploadId) {
    const row = await ctx.db.get(uploadId)
    // Only an unclaimed row, and only one that has not already been bound to a
    // different file. Both guards exist because `uploadId` came off the wire.
    if (row && !row.claimed && row.storageId === null) {
      await ctx.db.patch(uploadId, { storageId, claimed: true })
      return
    }
  }
  // No usable id: the same file submitted twice, or a caller that skipped the
  // mint step entirely. Claim by file where a row already names it.
  const existing = await ctx.db
    .query("feedbackUploads")
    .withIndex("by_storageId", (q) => q.eq("storageId", storageId))
    .first()
  if (existing && !existing.claimed) {
    await ctx.db.patch(existing._id, { claimed: true })
  }
  // Otherwise nothing is bound, and the orphan sweep reclaims the file on its
  // own schedule. Silently correct: the report row is what keeps a *claimed*
  // file alive, and this file has no row pointing at it.
}

/**
 * Deletes the mint record for a file whose report has expired.
 *
 * The counterpart to `bindUpload`, and the reason a claimed row is not
 * immortal: `sweepOrphanedUploads` reads only the `claimed: false` range, so
 * without this the table grew by one permanent row per screenshot ever
 * uploaded while the schema claimed a claimed row's lifetime belonged to its
 * report.
 */
async function deleteUploadRecord(ctx: MutationCtx, storageId: Id<"_storage">): Promise<void> {
  const row = await ctx.db
    .query("feedbackUploads")
    .withIndex("by_storageId", (q) => q.eq("storageId", storageId))
    .first()
  if (row) await ctx.db.delete(row._id)
}

// --- duplicate detection --------------------------------------------------

/** One candidate duplicate, as the widget renders it. */
const duplicateCandidate = v.object({
  number: v.number(),
  title: v.string(),
  url: v.string(),
  state: v.string(),
})

/**
 * Claims one outbound GitHub search, or refuses.
 *
 * ## Why this writes, and why it is a mutation
 *
 * It counts **searches**, and the only way to count searches is to record them.
 * The previous version counted *reports* and a search files none — so a caller
 * rotating `clientKey` always read zero, and on a quiet deployment the
 * deployment total was permanently below its ceiling. It bounded a persistent
 * client and nothing else, while its comment claimed it bounded volume. That is
 * the same flaw the upload gate had, fixed the same way: record the operation,
 * then count the record.
 *
 * The row is written **before** the caller performs its `fetch`, so the budget
 * cannot be spent without also being consumed. A mutation rather than a query
 * for exactly that reason — a query could observe the budget but never charge
 * against it.
 *
 * Both bounds apply, and they do different work. The per-client one is
 * resettable by rotating the key, like every per-client bound here, and stops
 * an ordinary reporter's repeated "Continue" clicks. The deployment one is not
 * reachable by the caller at all, and it is the one that protects GitHub's
 * 30-per-minute search ceiling — past which `response.ok` goes false and every
 * genuine reporter's duplicate check silently returns nothing.
 */
export const claimSearchBudget = internalMutation({
  args: { clientKey: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const now = Date.now()
    const since = now - DAY_MS
    const clientKey = truncate(args.clientKey.trim(), 64) || "unknown"

    const clientSearches = await ctx.db
      .query("feedbackSearches")
      .withIndex("by_clientKey_and_createdAt", (q) =>
        q.eq("clientKey", clientKey).gte("createdAt", since),
      )
      .take(DAILY_CLIENT_SEARCH_CAP + 1)
    if (clientSearches.length >= DAILY_CLIENT_SEARCH_CAP) return false

    const deploymentSearches = await ctx.db
      .query("feedbackSearches")
      .withIndex("by_createdAt", (q) => q.gte("createdAt", since))
      .take(DAILY_DEPLOYMENT_SEARCH_CAP + 1)
    if (deploymentSearches.length >= DAILY_DEPLOYMENT_SEARCH_CAP) return false

    await ctx.db.insert("feedbackSearches", { clientKey, createdAt: now })
    return true
  },
})

/**
 * Likely duplicates of a report that has not been filed yet.
 *
 * An **action**, called from the widget before submission, because it reaches
 * GitHub. Public and unauthenticated like the submission, and therefore
 * deliberately incapable of doing anything except a read-only search: it takes
 * no repository argument (the repo is a constant), and the search terms are
 * reduced to bare words by `duplicateSearchTerms` so a caller cannot inject
 * GitHub's own search qualifiers and redirect the query.
 *
 * ## Why it is capped on *searches*, and what that took to get right
 *
 * This is a public, unauthenticated function performing an outbound request
 * **on the deployment's own GitHub credential**. GitHub allows an authenticated
 * token 30 searches a minute; exhausting that is trivial, and the failure is
 * silent in the worst direction — `response.ok` goes false and every genuine
 * reporter's duplicate check returns `[]` while looking like it ran.
 *
 * It first carried no cap at all. It then carried one that counted **reports**,
 * which a search does not create: a caller rotating `clientKey` always read
 * zero, a quiet deployment sat permanently below its ceiling, and the gate
 * bounded a persistent client and nothing else while its comment claimed
 * otherwise. `claimSearchBudget` counts searches, by recording each one before
 * the call goes out — the same shape `feedbackUploads` uses for minting, and
 * for the same reason.
 *
 * Refusal returns `[]` rather than throwing, which preserves the "a duplicate
 * check never blocks a report" contract — a refused search and a GitHub outage
 * are the same thing to the widget.
 */
export const findDuplicates = action({
  args: { title: v.string(), description: v.string(), clientKey: v.string() },
  returns: v.array(duplicateCandidate),
  handler: async (ctx, args) => {
    const token = process.env.GITHUB_FEEDBACK_TOKEN
    const repo = process.env.GITHUB_FEEDBACK_REPO
    if (!token || !repo) return []

    // Charged before the outbound call, not merely observed — see
    // `claimSearchBudget` for why counting *reports* could never bound this.
    if (
      !(await ctx.runMutation(internal.feedback.claimSearchBudget, { clientKey: args.clientKey }))
    ) {
      return []
    }

    const terms = duplicateSearchTerms(
      truncate(args.title, LIMITS.title),
      truncate(args.description, LIMITS.description),
    )
    if (terms.length === 0) return []

    // `repo:` is supplied here from an environment variable, never from the
    // caller. The caller's contribution is `terms`, which cannot contain a
    // colon — see `duplicateSearchTerms`.
    const query = `repo:${repo} is:issue ${terms.join(" ")}`
    try {
      const response = await fetch(
        `${githubApiBase()}/search/issues?per_page=5&q=${encodeURIComponent(query)}`,
        { headers: githubHeaders(token) },
      )
      if (!response.ok) return []
      const body = (await response.json()) as {
        items?: { number?: number; title?: string; html_url?: string; state?: string }[]
      }
      return (body.items ?? [])
        .filter((item) => typeof item.number === "number" && typeof item.html_url === "string")
        .map((item) => ({
          number: item.number as number,
          title: truncate(String(item.title ?? ""), 160),
          url: String(item.html_url),
          state: item.state === "closed" ? "closed" : "open",
        }))
    } catch {
      return []
    }
  },
})

// --- publication ----------------------------------------------------------

/**
 * The GitHub API root.
 *
 * Overridable so this integration can be exercised against a stub — the
 * public/private split and the issue payload are the two things most worth
 * verifying end to end, and neither can be verified by pointing at the real
 * API and filing junk issues in a public repository.
 *
 * It doubles as GitHub Enterprise support (`https://ghe.example.com/api/v3`),
 * which is the reason it is a documented operator variable rather than a test
 * seam. Unset, it is `api.github.com` — a deployment that sets nothing talks to
 * GitHub, which is the only safe default.
 */
function githubApiBase(): string {
  return (process.env.GITHUB_API_BASE ?? "https://api.github.com").replace(/\/+$/, "")
}

/** Headers every GitHub call carries. The API version is pinned: an unpinned
 * call silently follows whatever GitHub makes current, and this code parses the
 * response. */
function githubHeaders(token: string): Record<string, string> {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "bundestracker-feedback",
    "Content-Type": "application/json",
  }
}

/**
 * Finds an issue already filed for this report id, if one exists.
 *
 * The idempotency key is the report id printed in every body. `in:body` with a
 * quoted phrase matches it exactly, and the id is a Convex document id —
 * opaque, unique, and not a word that occurs in prose.
 *
 * Returns `null` on any failure, including a rate-limited search. Deliberate:
 * an unavailable search must not block publication, so the caller proceeds to
 * POST exactly as it did before. The cost of the rare wrong answer is the
 * duplicate this usually prevents, never a lost report.
 */
async function findIssueForReport(
  repo: string,
  token: string,
  reportId: string,
): Promise<{ number: number; url: string } | null> {
  try {
    const query = `repo:${repo} is:issue in:body "${reportId}"`
    const response = await fetch(
      `${githubApiBase()}/search/issues?per_page=1&q=${encodeURIComponent(query)}`,
      { headers: githubHeaders(token) },
    )
    if (!response.ok) return null
    const body = (await response.json()) as {
      items?: { number?: number; html_url?: string }[]
    }
    const hit = body.items?.[0]
    if (typeof hit?.number !== "number" || typeof hit.html_url !== "string") return null
    return { number: hit.number, url: hit.html_url }
  } catch {
    return null
  }
}

/**
 * The report as the publisher needs it.
 *
 * The returned shape is spelled out rather than being `v.any()`, and names only
 * the fields `publishReport` actually reads — which pointedly does **not**
 * include `contact`. So the publishing action never holds the reporter's
 * address at all: the public/private split is enforced once more here, one
 * level below the `PublicReport` type, and an action that wanted to leak an
 * address could not even read one.
 *
 * ⚠ A field omitted from a `returns` validator is not merely undocumented — it
 * makes the query fail at runtime with a bare "Server Error" if the handler
 * returns it. So this object must list exactly what the handler selects, which
 * is why the handler selects explicitly instead of returning the row.
 */
export const getReportForPublication = internalQuery({
  args: { reportId: v.id("feedbackReports") },
  returns: v.union(
    v.null(),
    v.object({
      kind: v.union(v.literal("bug"), v.literal("feature"), v.literal("data"), v.literal("other")),
      title: v.string(),
      description: v.string(),
      pageUrl: v.union(v.null(), v.string()),
      locale: preferredLocale,
      diagnostics: v.union(v.null(), safeDiagnostics),
      status: v.string(),
      hasScreenshot: v.boolean(),
      hasContact: v.boolean(),
    }),
  ),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.reportId)
    if (!row) return null
    return {
      kind: row.kind,
      title: row.title,
      description: row.description,
      pageUrl: row.pageUrl,
      locale: row.locale,
      diagnostics: row.diagnostics,
      status: row.status,
      // Reduced to booleans *here*, at the read, rather than in the action.
      hasScreenshot: row.screenshotId !== null,
      hasContact: row.contact !== null,
    }
  },
})

/**
 * Records the outcome of a publication attempt.
 *
 * ⚠ Deliberately does **not** take `duplicateCandidates`. It used to, and every
 * one of its five call sites passed `[]` — so the column the schema documents
 * as a triage signal ("they were shown these three and filed regardless") was
 * overwritten with an empty array the instant a report was published, whatever
 * the reporter had actually been shown. A publication outcome has nothing to
 * say about what the reporter saw before filing; the field is written once, at
 * submission, and left alone here.
 */
export const recordPublication = internalMutation({
  args: {
    reportId: v.id("feedbackReports"),
    status: v.union(v.literal("published"), v.literal("failed")),
    githubIssueNumber: v.union(v.null(), v.number()),
    githubIssueUrl: v.union(v.null(), v.string()),
    failureReason: v.union(v.null(), v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { reportId, ...patch } = args
    await ctx.db.patch(reportId, { ...patch, updatedAt: Date.now() })
    return null
  },
})

/**
 * Turns a stored report into a GitHub issue.
 *
 * ## The one place the public/private split is executed
 *
 * The `PublicReport` built here is what `issueBody` renders, and it is built
 * field by field from the row. `contact` becomes `hasContact: boolean`;
 * `screenshotId` becomes `hasScreenshot: boolean`. Neither value is in scope
 * for the renderer, because neither is a field of the type it accepts. That is
 * the enforcement — a future edit wanting to publish an address would have to
 * change lib/feedback-issue.ts, in a diff that says so.
 *
 * ## Failure is a recorded state, not an exception
 *
 * GitHub being unreachable, the token being unset, the repository being renamed
 * — all of them mark the row `failed` with a reason and return. The reporter has
 * already been told their report was received, which remains true: it is stored.
 * An operator retries with `bunx convex run feedback:republishFailed`.
 */
export const publishReport = internalAction({
  args: { reportId: v.id("feedbackReports") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const report = await ctx.runQuery(internal.feedback.getReportForPublication, {
      reportId: args.reportId,
    })
    if (!report || report.status === "published") return null

    const token = process.env.GITHUB_FEEDBACK_TOKEN
    const repo = process.env.GITHUB_FEEDBACK_REPO
    if (!token || !repo) {
      // The kill switch, and the un-configured state. Both leave the report
      // stored and unpublished, which is the safe direction: nothing is lost,
      // and nothing is posted from a deployment that was never wired up.
      await ctx.runMutation(internal.feedback.recordPublication, {
        reportId: args.reportId,
        status: "failed",
        githubIssueNumber: null,
        githubIssueUrl: null,
        failureReason: "github-not-configured",
      })
      return null
    }

    // ⚠ A retry must not file a second issue for the same report.
    //
    // The `catch` below marks a row `failed` for *any* thrown error, including
    // a network failure that happens **after** GitHub accepted the POST and
    // created the issue. `republishFailed` then re-queues it, and the only
    // guard is `status === "published"`, which is false — so the outcome of one
    // dropped response was two identical public issues.
    //
    // Every body prints its report id (`| Report id |`), so the already-created
    // issue is findable. Searching for it is cheap, runs only on a retry, and
    // fails safe: a search that errors leaves `null` and the POST proceeds,
    // which is the old behaviour rather than a new failure mode.
    if (report.status === "failed") {
      const already = await findIssueForReport(repo, token, args.reportId)
      if (already) {
        await ctx.runMutation(internal.feedback.recordPublication, {
          reportId: args.reportId,
          status: "published",
          githubIssueNumber: already.number,
          githubIssueUrl: already.url,
          failureReason: null,
        })
        return null
      }
    }

    const publicReport: PublicReport = {
      kind: report.kind,
      title: report.title,
      description: report.description,
      pageUrl: report.pageUrl,
      locale: report.locale ?? "de",
      diagnostics: report.diagnostics,
      // Booleans, not values. See the header.
      hasScreenshot: report.hasScreenshot,
      hasContact: report.hasContact,
      reportId: args.reportId,
    }

    try {
      const response = await fetch(`${githubApiBase()}/repos/${repo}/issues`, {
        method: "POST",
        headers: githubHeaders(token),
        body: JSON.stringify({
          title: issueTitle(publicReport),
          body: issueBody(publicReport),
          labels: issueLabels(publicReport),
        }),
      })
      if (!response.ok) {
        await ctx.runMutation(internal.feedback.recordPublication, {
          reportId: args.reportId,
          status: "failed",
          githubIssueNumber: null,
          githubIssueUrl: null,
          // The status only. A GitHub error body can echo the request, and the
          // request contains the reporter's text — storing it would duplicate
          // the report into a field nothing sanitizes.
          failureReason: `github-http-${response.status}`,
        })
        return null
      }
      const created = (await response.json()) as { number?: number; html_url?: string }
      await ctx.runMutation(internal.feedback.recordPublication, {
        reportId: args.reportId,
        status: "published",
        githubIssueNumber: typeof created.number === "number" ? created.number : null,
        githubIssueUrl: typeof created.html_url === "string" ? created.html_url : null,
        failureReason: null,
      })
    } catch (error) {
      await ctx.runMutation(internal.feedback.recordPublication, {
        reportId: args.reportId,
        status: "failed",
        githubIssueNumber: null,
        githubIssueUrl: null,
        failureReason: truncate(error instanceof Error ? error.name : "unknown", 60),
      })
    }
    return null
  },
})

/**
 * Re-queues reports that failed to publish.
 *
 * For an operator after a GitHub outage or after setting the token for the
 * first time: `bunx convex run feedback:republishFailed '{}'`. Bounded, and
 * idempotent — a report already `published` is skipped by `publishReport`
 * itself.
 */
export const republishFailed = internalAction({
  args: { limit: v.optional(v.number()) },
  returns: v.object({ requeued: v.number() }),
  handler: async (ctx, args) => {
    const pending = (await ctx.runQuery(internal.feedback.listFailedReports, {
      limit: Math.max(1, Math.min(100, args.limit ?? 25)),
    })) as Id<"feedbackReports">[]
    for (const reportId of pending) {
      await ctx.scheduler.runAfter(0, internal.feedback.publishReport, { reportId })
    }
    return { requeued: pending.length }
  },
})

export const listFailedReports = internalQuery({
  args: { limit: v.number() },
  returns: v.array(v.id("feedbackReports")),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("feedbackReports")
      .withIndex("by_status_and_createdAt", (q) => q.eq("status", "failed"))
      .take(args.limit)
    return rows.map((row) => row._id)
  },
})

// --- retention ------------------------------------------------------------

/**
 * Deletes reports past their retention window, and their screenshots with them.
 *
 * Run daily from convex/crons.ts. This is the half of "bounded storage" that is
 * easy to forget and is the difference between a support inbox and an
 * accumulating archive of strangers' email addresses: a report older than
 * `RETENTION_DAYS` has either become a GitHub issue — where the *public* half
 * lives on, permanently and appropriately — or was never going to be acted on.
 *
 * The screenshot is deleted first and the row second, so a crash between the
 * two leaves an already-deleted file referenced by a row that the next run
 * deletes, rather than a live file with nothing pointing at it. Orphaned
 * storage is the failure that never gets noticed.
 *
 * Bounded per run and rescheduled while there is more to do, for the reason
 * convex/scoreSweep.ts gives: a delete-everything-older-than transaction over a
 * year of rows would exceed Convex's write limit.
 */
export const sweepExpiredReports = internalMutation({
  args: {},
  returns: v.object({ deleted: v.number(), hasMore: v.boolean() }),
  handler: async (ctx) => {
    const cutoff = Date.now() - RETENTION_DAYS * DAY_MS
    const BATCH = 100
    const expired = await ctx.db
      .query("feedbackReports")
      .withIndex("by_createdAt", (q) => q.lt("createdAt", cutoff))
      .take(BATCH)

    for (const row of expired) {
      if (row.screenshotId) {
        // A file already gone is not an error — a previous partial run may have
        // deleted it — so this must not throw and abort the batch.
        await ctx.storage.delete(row.screenshotId).catch(() => {})
        // …and the mint record with it. `sweepOrphanedUploads` only ever reads
        // the `claimed: false` range, so without this a claimed row outlived
        // every other trace of the report and `feedbackUploads` grew by one
        // permanent row per screenshot ever uploaded. The schema said "a
        // claimed row's lifetime belongs to the report"; this is the code that
        // makes that true.
        await deleteUploadRecord(ctx, row.screenshotId)
      }
      await ctx.db.delete(row._id)
    }

    const hasMore = expired.length === BATCH
    if (hasMore) {
      await ctx.scheduler.runAfter(0, internal.feedback.sweepExpiredReports, {})
    } else {
      // Only once the report backlog is clear, so a long retention run does not
      // also carry the orphan sweep's writes in the same transaction.
      await ctx.scheduler.runAfter(0, internal.feedback.sweepOrphanedUploads, {})
    }
    return { deleted: expired.length, hasMore }
  },
})

/**
 * Deletes uploaded screenshots that no report ever claimed.
 *
 * ## The hole this closes
 *
 * `generateScreenshotUploadUrl` hands out a URL; the browser POSTs a file to it;
 * a report then names the resulting id. If the reporter closes the tab in
 * between, the file exists and **nothing references it**. `sweepExpiredReports`
 * above walks `feedbackReports` and can only delete a `screenshotId` it finds on
 * a row, so an unclaimed file was never deleted by anything, ever — anonymous,
 * unauthenticated, permanent storage growth.
 *
 * The `feedbackUploads` row written at mint time is what makes the file
 * reachable. Rows are selected through `by_claimed_and_createdAt` with
 * `claimed: false` leading, so this reads exactly the unclaimed range rather
 * than scanning past the claimed rows that outnumber it.
 *
 * A row whose `storageId` is still null is a URL that was minted and never
 * uploaded to. There is no file to delete, but the row itself must go or it
 * would accumulate and inflate the mint cap forever.
 */
export const sweepOrphanedUploads = internalMutation({
  args: {},
  returns: v.object({ deleted: v.number(), hasMore: v.boolean() }),
  handler: async (ctx) => {
    const cutoff = Date.now() - UPLOAD_ORPHAN_TTL_MS
    const BATCH = 100
    const orphans = await ctx.db
      .query("feedbackUploads")
      .withIndex("by_claimed_and_createdAt", (q) => q.eq("claimed", false).lt("createdAt", cutoff))
      .take(BATCH)

    for (const row of orphans) {
      if (row.storageId) {
        // File first, row second — the same ordering and the same reason as the
        // report sweep: a crash between the two must not leave a live file with
        // nothing pointing at it.
        await ctx.storage.delete(row.storageId).catch(() => {})
      }
      await ctx.db.delete(row._id)
    }

    const hasMore = orphans.length === BATCH
    if (hasMore) {
      await ctx.scheduler.runAfter(0, internal.feedback.sweepOrphanedUploads, {})
    } else {
      await ctx.scheduler.runAfter(0, internal.feedback.sweepSearchRecords, {})
    }
    return { deleted: orphans.length, hasMore }
  },
})

/**
 * Reaps duplicate-search records past the window they are counted in.
 *
 * `feedbackSearches` rows exist only to be counted by `claimSearchBudget` over
 * a rolling 24 hours, so a row older than `SEARCH_RETENTION_MS` is bookkeeping
 * nobody will ever read again. Without this the table grows by one row per
 * search forever — the same unbounded-growth shape the upload table had, and
 * worth reaping for the same reason even though the rows carry no content.
 *
 * Last in the nightly chain: reports, then orphaned uploads, then these. Each
 * link runs only once the previous one has drained, so no single transaction
 * carries two sweeps' writes.
 */
export const sweepSearchRecords = internalMutation({
  args: {},
  returns: v.object({ deleted: v.number(), hasMore: v.boolean() }),
  handler: async (ctx) => {
    const cutoff = Date.now() - SEARCH_RETENTION_MS
    const BATCH = 200
    const stale = await ctx.db
      .query("feedbackSearches")
      .withIndex("by_createdAt", (q) => q.lt("createdAt", cutoff))
      .take(BATCH)

    for (const row of stale) await ctx.db.delete(row._id)

    const hasMore = stale.length === BATCH
    if (hasMore) {
      await ctx.scheduler.runAfter(0, internal.feedback.sweepSearchRecords, {})
    }
    return { deleted: stale.length, hasMore }
  },
})

// --- operator reads -------------------------------------------------------

/**
 * The private half of one report, for a maintainer holding its id.
 *
 * An **internal** query, reachable only from the Convex dashboard or the CLI —
 * `bunx convex run --prod feedback:getPrivateReport '{"reportId":"…"}'`. It is
 * deliberately not a public query with an auth check: the set of people allowed
 * to read a stranger's email address is "whoever holds deployment credentials",
 * which is not a concept this app's auth models, and a public function guarding
 * it would be one `internal` → `api` typo from reachable.
 *
 * Returns a screenshot URL rather than the bytes; the URL is served by Convex
 * and expires.
 */
export const getPrivateReport = internalQuery({
  args: { reportId: v.id("feedbackReports") },
  returns: v.union(
    v.null(),
    v.object({
      kind: v.string(),
      title: v.string(),
      contact: v.union(v.null(), v.string()),
      status: v.string(),
      githubIssueUrl: v.union(v.null(), v.string()),
      screenshotUrl: v.union(v.null(), v.string()),
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.reportId)
    if (!row) return null
    return {
      kind: row.kind,
      title: row.title,
      contact: row.contact,
      status: row.status,
      githubIssueUrl: row.githubIssueUrl,
      screenshotUrl: row.screenshotId ? await ctx.storage.getUrl(row.screenshotId) : null,
      createdAt: row.createdAt,
    }
  },
})

/**
 * Whether the feedback form should offer itself at all.
 *
 * Public, and the one thing about this feature a browser may ask. It reports
 * only whether publication is configured — never the token, never the repo — so
 * the widget can say "reports are not being accepted right now" instead of
 * accepting one into a deployment that will never publish it.
 */
export const isConfigured = query({
  args: {},
  returns: v.boolean(),
  handler: async () => {
    return Boolean(process.env.GITHUB_FEEDBACK_TOKEN && process.env.GITHUB_FEEDBACK_REPO)
  },
})
