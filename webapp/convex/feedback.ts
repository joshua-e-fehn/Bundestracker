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

/** Reports from everyone inside the rolling window. */
async function deploymentReportsSince(ctx: QueryCtx, since: number): Promise<number> {
  const rows = await ctx.db
    .query("feedbackReports")
    .withIndex("by_createdAt", (q) => q.gte("createdAt", since))
    .take(DAILY_DEPLOYMENT_CAP + 1)
  return rows.length
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
  /** The random per-browser identifier. See the field note in convex/schema.ts
   * for why this is not an IP and what it does and does not stop. */
  clientKey: v.string(),
  /** Milliseconds between the widget opening and the submission. */
  dwellMs: v.number(),
  /** The honeypot. A real reporter never sees this field, so a non-empty value
   * is a bot that filled every input it found. */
  honeypot: v.string(),
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

    // A rejected report is stored — with its text dropped — so the limiter can
    // see it next time. Storing the text would make the table a place to write
    // arbitrary content by being refused, which is the opposite of the point.
    if (rejection) {
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
      // An uploaded screenshot belonging to a refused report is deleted rather
      // than orphaned in storage.
      if (args.screenshotId) await ctx.storage.delete(args.screenshotId)
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
      screenshotId: args.screenshotId,
      status: "pending",
      githubIssueNumber: null,
      githubIssueUrl: null,
      failureReason: null,
      duplicateCandidates: [],
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
 * An upload URL for the screenshot.
 *
 * A mutation because `generateUploadUrl` is only available on a writer context.
 * Public and unauthenticated, like the submission itself — and bounded by the
 * same daily caps, which are checked here too so a caller cannot mint unlimited
 * upload URLs without ever filing a report.
 *
 * An orphaned upload (a URL minted, a file stored, no report filed) is swept by
 * `sweepExpiredReports` below.
 */
export const generateScreenshotUploadUrl = mutation({
  args: { clientKey: v.string() },
  returns: v.union(v.null(), v.string()),
  handler: async (ctx, args) => {
    const since = Date.now() - DAY_MS
    const clientKey = truncate(args.clientKey.trim(), 64) || "unknown"
    if ((await clientReportsSince(ctx, clientKey, since)) >= DAILY_CLIENT_CAP) return null
    if ((await deploymentReportsSince(ctx, since)) >= DAILY_DEPLOYMENT_CAP) return null
    return await ctx.storage.generateUploadUrl()
  },
})

// --- duplicate detection --------------------------------------------------

/** One candidate duplicate, as the widget renders it. */
const duplicateCandidate = v.object({
  number: v.number(),
  title: v.string(),
  url: v.string(),
  state: v.string(),
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
 * Returns an empty list on any failure. A duplicate check is an assist, and a
 * GitHub outage must not block a bug report — which is precisely when people
 * are most likely to be reporting one.
 */
export const findDuplicates = action({
  args: { title: v.string(), description: v.string() },
  returns: v.array(duplicateCandidate),
  handler: async (_ctx, args) => {
    const token = process.env.GITHUB_FEEDBACK_TOKEN
    const repo = process.env.GITHUB_FEEDBACK_REPO
    if (!token || !repo) return []

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

/** Records the outcome of a publication attempt. */
export const recordPublication = internalMutation({
  args: {
    reportId: v.id("feedbackReports"),
    status: v.union(v.literal("published"), v.literal("failed")),
    githubIssueNumber: v.union(v.null(), v.number()),
    githubIssueUrl: v.union(v.null(), v.string()),
    failureReason: v.union(v.null(), v.string()),
    duplicateCandidates: v.array(v.number()),
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
        duplicateCandidates: [],
      })
      return null
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
          duplicateCandidates: [],
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
        duplicateCandidates: [],
      })
    } catch (error) {
      await ctx.runMutation(internal.feedback.recordPublication, {
        reportId: args.reportId,
        status: "failed",
        githubIssueNumber: null,
        githubIssueUrl: null,
        failureReason: truncate(error instanceof Error ? error.name : "unknown", 60),
        duplicateCandidates: [],
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
      }
      await ctx.db.delete(row._id)
    }

    const hasMore = expired.length === BATCH
    if (hasMore) {
      await ctx.scheduler.runAfter(0, internal.feedback.sweepExpiredReports, {})
    }
    return { deleted: expired.length, hasMore }
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
