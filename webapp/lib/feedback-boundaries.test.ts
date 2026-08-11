import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

/**
 * The guarantees that are properties of the *source* rather than of any
 * function's output.
 *
 * This is an unusual kind of test and it is used deliberately and narrowly.
 * Some of what the feedback feature promises is not a value anything returns —
 * "the diagnostics validator contains no `v.any()`", "the publishing query
 * never selects the contact column", "the retention sweep is actually wired to
 * a cron" — and every one of those is a promise whose breach would be both
 * invisible in review and severe: an address published to a public issue
 * tracker, or a table of strangers' emails growing without bound.
 *
 * A source assertion is a blunt instrument. It is used here only where the
 * alternative is no assertion at all, and never where a behavioural test would
 * do — the behavioural half lives in lib/feedback.test.ts and
 * lib/feedback-issue.test.ts, which is where the bulk of the coverage is.
 * `components/sidebar-account.test.ts` reaches for the same technique to pin
 * the hydration contract, for the same reason.
 *
 * ⚠ These tests read files by path. A rename of the modules they name breaks
 * them loudly, which is correct: the guarantee moved, and someone has to say
 * where to.
 */

const root = new URL("../", import.meta.url)
const read = (path: string) => readFileSync(new URL(path, root), "utf8")

/**
 * Source with comments removed.
 *
 * Required, not cosmetic. These modules document what they refuse to read —
 * "`event.key` is never recorded", "never touches `init.headers`" — so a naive
 * scan for a forbidden identifier matches the *prose promising it is absent*
 * and fails on a correct file. Stripping comments first is what makes the
 * assertion about the code rather than about the documentation of the code.
 *
 * A regex is enough here because these files contain no string literal holding
 * `//` or `/*`, which the test for each guarantee would surface anyway by
 * failing.
 */
function code(path: string): string {
  return read(path)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
}

const schemaSource = read("convex/schema.ts")
const feedbackSource = read("convex/feedback.ts")
const diagnosticsCode = code("lib/diagnostics.ts")
const screenshotSource = read("lib/screenshot.ts")

/** The `safeDiagnostics` validator, as source text. */
function safeDiagnosticsBlock(): string {
  const start = schemaSource.indexOf("export const safeDiagnostics")
  expect(start).toBeGreaterThan(-1)
  const end = schemaSource.indexOf("\n})", start)
  return schemaSource.slice(start, end)
}

describe("the diagnostics validator stays closed", () => {
  test("contains no open-ended validator", () => {
    // `v.any()` or `v.record()` anywhere in this shape would re-open every
    // vector the feature exists to close: a client could then attach a cookie
    // jar under a key nobody anticipated, and it would validate.
    const block = safeDiagnosticsBlock()
    expect(block).not.toContain("v.any(")
    expect(block).not.toContain("v.record(")
    expect(block).not.toContain("v.bytes(")
  })

  test("declares no field for anything forbidden", () => {
    const block = safeDiagnosticsBlock().toLowerCase()
    for (const forbidden of [
      "cookie",
      "localstorage",
      "sessionstorage",
      "authorization",
      "requestbody",
      "responsebody",
      "formdata",
      "fieldvalue",
      "password",
    ]) {
      expect(block).not.toContain(forbidden)
    }
  })
})

describe("the collectors never read a forbidden surface", () => {
  test("nothing in the browser collectors touches cookies or storage", () => {
    // The strongest of the protections: a sanitizer can only remove what was
    // collected, so a collector that never reads `document.cookie` has nothing
    // to remove.
    //
    // Scoped to the collectors — everything above the client-key section —
    // rather than to the whole file. `clientKey` lives at the bottom of the
    // module and *writes* `localStorage`, minting an identifier this feature
    // invents for itself. The rule being asserted is about what is read **from
    // the reader's browser**, and a key we generate is not that. Widening the
    // scan to the file would either fail on correct code or force the rule to
    // be dropped, and dropping it is the outcome worth avoiding.
    //
    // Split on the constant rather than the section comment: `code()` strips
    // comments before this sees the source.
    const collectors = diagnosticsCode.slice(0, diagnosticsCode.indexOf("const CLIENT_KEY_STORAGE"))
    expect(collectors.length).toBeGreaterThan(0)
    expect(collectors).not.toContain("document.cookie")
    expect(collectors).not.toContain("localStorage")
    expect(collectors).not.toContain("sessionStorage")
  })

  test("the client key is the only storage writer, and reads nothing else", () => {
    // The complement of the rule above, so moving `clientKey` here did not
    // quietly buy a licence to read storage: it touches exactly its own key.
    const section = diagnosticsCode.slice(diagnosticsCode.indexOf("const CLIENT_KEY_STORAGE"))
    expect(section).toContain("CLIENT_KEY_STORAGE")
    expect(section).not.toContain("document.cookie")
    expect(section).not.toContain("sessionStorage")
    // Only the one key, by name — no enumeration of what else is in storage.
    expect(section).not.toContain("localStorage.key")
    expect(section).not.toContain("Object.keys(window.localStorage")
  })

  test("the fetch wrapper never reads headers or bodies", () => {
    expect(diagnosticsCode).not.toContain("init?.headers")
    expect(diagnosticsCode).not.toContain("init.headers")
    expect(diagnosticsCode).not.toContain("response.text()")
    expect(diagnosticsCode).not.toContain("response.json()")
    expect(diagnosticsCode).not.toContain("response.body")
    expect(diagnosticsCode).not.toContain("response.headers")
    // …while still recording the one field that makes a failure actionable.
    expect(diagnosticsCode).toContain("response.status")
  })

  test("the key listener records that typing happened, never what was typed", () => {
    // `event.key` here would be a keylogger. The breadcrumb records the element
    // shape and nothing else.
    expect(diagnosticsCode).not.toContain("event.key")
    expect(diagnosticsCode).toContain('kind: "keydown"')
  })

  test("no collector reads an element's content or accessible name", () => {
    for (const forbidden of [".value", "textContent", "innerText", "aria-label", "placeholder"]) {
      expect(diagnosticsCode).not.toContain(forbidden)
    }
  })
})

describe("the screenshot redacts before it rasterises", () => {
  test("form controls and account surfaces are redacted unconditionally", () => {
    const start = screenshotSource.indexOf("const ALWAYS_REDACT")
    expect(start).toBeGreaterThan(-1)
    // `\n]` rather than `]`: the array's first entry is itself a bracketed
    // attribute selector, so the first bare `]` is inside element zero.
    const block = screenshotSource.slice(start, screenshotSource.indexOf("\n]", start))
    for (const selector of ["input", "textarea", "select", "data-feedback-account"]) {
      expect(block).toContain(selector)
    }
    // The forward-compatibility marker the requirement asks for.
    expect(block).toContain("REDACT_ATTRIBUTE")
  })

  test("redaction happens before the canvas is drawn", () => {
    // The ordering is the whole guarantee: once pixels exist there is no undo.
    const capture = screenshotSource.slice(
      screenshotSource.indexOf("export async function captureScreenshot"),
    )
    const redact = capture.indexOf("applyRedactions")
    const draw = capture.indexOf("drawImage")
    expect(redact).toBeGreaterThan(-1)
    expect(draw).toBeGreaterThan(redact)
  })

  test("traversal is separated from mutation", () => {
    // The structural half of the P0 fixed in lib/screenshot.test.ts. A live
    // `TreeWalker` advanced while the clone is being mutated desynchronises
    // from the first redaction onward — so the file must not hold one at all.
    // Behavioural coverage is in lib/screenshot.test.ts; this is the guard
    // against the pattern being reintroduced somewhere new in the file.
    const code = screenshotSource.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
    expect(code).not.toContain("createTreeWalker")
    expect(code).toContain("pairTrees")
  })

  test("the screenshot size ceiling is the shared constant, not a copy", () => {
    // A second copy of a bound is a bound that drifts. The literal was
    // `1_500_000` while `LIMITS.screenshotBytes` sat unread beside it.
    expect(screenshotSource).toContain("LIMITS.screenshotBytes")
    expect(screenshotSource).not.toContain("1_500_000")
  })

  test("the report widget itself is dropped from the capture", () => {
    expect(screenshotSource).toContain("data-feedback-widget")
  })
})

describe("the publishing path cannot read the private half", () => {
  test("getReportForPublication does not select the contact column", () => {
    // The narrowest enforcement point: the action that talks to GitHub is
    // handed an object that never had an address in it.
    const start = feedbackSource.indexOf("export const getReportForPublication")
    const end = feedbackSource.indexOf("export const recordPublication")
    expect(start).toBeGreaterThan(-1)
    const block = feedbackSource.slice(start, end)
    expect(block).toContain("hasContact")
    // `contact: row.contact` would be the leak; `row.contact !== null` is the
    // boolean and is expected.
    expect(block).not.toMatch(/contact:\s*row\.contact\b/)
    expect(block).not.toMatch(/screenshotId:\s*row\.screenshotId\b/)
  })

  test("a rejected report stores no reporter text", () => {
    // Otherwise being refused becomes a way to write arbitrary content into
    // the table. The slice runs to the end of the rejection branch, which now
    // has two exits — the forgeable one writes nothing at all, and the cap one
    // writes the blank row asserted here.
    const start = feedbackSource.indexOf("if (rejection) {")
    const end = feedbackSource.indexOf("const title = truncate(", start)
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    const block = feedbackSource.slice(start, end)
    expect(block).toContain('title: ""')
    expect(block).toContain('description: ""')
    expect(block).toContain("contact: null")
  })

  test("the userId is read from the session and never from an argument", () => {
    // The rule convex/userPreferences.ts states: a `userId` argument would let
    // a caller attribute their report to somebody else.
    const argsStart = feedbackSource.indexOf("const submissionArgs = {")
    const argsEnd = feedbackSource.indexOf("honeypot: v.string()", argsStart)
    expect(argsStart).toBeGreaterThan(-1)
    expect(feedbackSource.slice(argsStart, argsEnd)).not.toContain("userId")
    expect(feedbackSource).toContain("userId: await getUserId(ctx)")
  })

  test("the GitHub repository is never taken from the caller", () => {
    // `findDuplicates` interpolates a `repo:` qualifier. It must come from the
    // environment, or a caller could redirect the search.
    expect(feedbackSource).toContain("process.env.GITHUB_FEEDBACK_REPO")
    const dupStart = feedbackSource.indexOf("export const findDuplicates")
    const dupEnd = feedbackSource.indexOf("// --- publication")
    const block = feedbackSource.slice(dupStart, dupEnd)
    // Matched as a pattern rather than as a string literal: the text being
    // asserted about *is* an interpolation, and writing it as a literal trips
    // `noTemplateCurlyInString` on a file that is deliberately quoting source.
    expect(block).toMatch(/`repo:\$\{repo\}/)
    expect(block).not.toMatch(/repo:\$\{args\./)
  })

  test("an upstream error body is never stored", () => {
    // A GitHub error response echoes the request, and the request carries the
    // reporter's text — storing it would duplicate the report into a field
    // nothing sanitizes.
    // A pattern, for the reason given above.
    expect(feedbackSource).toMatch(/github-http-\$\{response\.status\}/)
    expect(feedbackSource).not.toContain("await response.text()")
  })

  test("diagnostics are re-sanitized on the server, not merely validated", () => {
    // The validator proves the shape; only re-running the sanitizers proves the
    // values. A hand-written caller satisfies the schema with a full URL in
    // `requests[].url`.
    expect(feedbackSource).toContain("resanitize(args.diagnostics)")
    expect(feedbackSource).toContain("sanitizeUrl(args.pageUrl)")
  })
})

describe("retention is actually scheduled", () => {
  test("the sweep is registered as a cron", () => {
    // A retention window nothing enforces is a comment. This is the assertion
    // that catches the sweep being written and never wired up.
    expect(read("convex/crons.ts")).toContain("internal.feedback.sweepExpiredReports")
  })

  test("every sweep deletes side-effects before the row", () => {
    // The other order leaves a live file with nothing pointing at it, which is
    // the failure that never gets noticed.
    //
    // Asserted on `sweepBatch`, which is where the ordering now lives for all
    // three sweeps: `onRow` — the per-table work, deleting a file or a mint
    // record — runs, and only then does the row go. Pinning it here rather than
    // once per sweep is the point of having one machine: the guarantee cannot
    // hold in two sweeps and lapse in the third.
    const block = feedbackSource.slice(
      feedbackSource.indexOf("async function sweepBatch"),
      feedbackSource.indexOf("// --- the rate limiter"),
    )
    const onRow = block.indexOf("await options.onRow?.(row)")
    const deleteRow = block.indexOf("await ctx.db.delete(row._id)")
    expect(onRow).toBeGreaterThan(-1)
    expect(deleteRow).toBeGreaterThan(onRow)
  })

  test("the last sweep in the chain does not reschedule itself forever", () => {
    // `next` is absent on the final stage, and that absence has to *end* the
    // chain rather than fall back to `self` — which would be an infinite
    // reschedule, not a no-op.
    const block = feedbackSource.slice(
      feedbackSource.indexOf("async function sweepBatch"),
      feedbackSource.indexOf("// --- the rate limiter"),
    )
    expect(block).toContain("const follow = hasMore ? options.self : options.next")
    expect(block).toContain("if (follow)")
  })
})

describe("an abandoned upload is reclaimable", () => {
  test("minting an upload URL writes a row that can be found later", () => {
    // Without this row the file is unreachable: `sweepExpiredReports` walks
    // `feedbackReports` and can only delete a `screenshotId` it finds on a row,
    // so an upload with no report was never deleted by anything, ever.
    const block = feedbackSource.slice(
      feedbackSource.indexOf("export const generateScreenshotUploadUrl"),
      feedbackSource.indexOf("async function claimScreenshot"),
    )
    expect(block).toContain('ctx.db.insert("feedbackUploads"')
  })

  test("the orphan sweep exists, is scheduled, and deletes the file", () => {
    const block = feedbackSource.slice(
      feedbackSource.indexOf("export const sweepOrphanedUploads"),
      feedbackSource.indexOf("export const sweepSearchRecords"),
    )
    expect(block).toContain("feedbackUploads")
    // The file goes in `onRow`; `sweepBatch` deletes the row after it, which is
    // asserted once for all three sweeps above.
    expect(block).toContain("ctx.storage.delete(row.storageId)")
    // Reached from the retention sweep, so it runs without a second cron.
    expect(feedbackSource).toContain("internal.feedback.sweepOrphanedUploads")
  })

  test("the mint gate counts mints, not reports", () => {
    // The old gate checked the *report* caps, and minting a URL files no
    // report — so on a quiet deployment it read `0 >= 200` permanently.
    const block = feedbackSource.slice(
      feedbackSource.indexOf("export const generateScreenshotUploadUrl"),
      feedbackSource.indexOf("async function claimScreenshot"),
    )
    expect(block).toContain("DAILY_CLIENT_UPLOAD_CAP")
    expect(block).toContain("DAILY_DEPLOYMENT_UPLOAD_CAP")
    expect(block).not.toContain("clientReportsSince")
  })

  test("the screenshot size ceiling is enforced server-side", () => {
    // The client check is a courtesy; the upload URL accepts whatever is
    // POSTed to it, so the only real enforcement is against stored metadata.
    const block = feedbackSource.slice(
      feedbackSource.indexOf("async function claimScreenshot"),
      feedbackSource.indexOf("async function markUploadClaimed"),
    )
    expect(block).toContain('ctx.db.system.get("_storage"')
    expect(block).toContain("LIMITS.screenshotBytes")
    expect(block).toContain("ctx.storage.delete")
  })
})

describe("the duplicate search is capped on searches, not on reports", () => {
  test("findDuplicates charges the budget before reaching GitHub", () => {
    // It is public, unauthenticated, and spends the deployment's own GitHub
    // credential. Uncapped, an attacker exhausts the 30/minute search limit and
    // every genuine reporter's check silently returns [].
    const block = feedbackSource.slice(
      feedbackSource.indexOf("export const findDuplicates"),
      feedbackSource.indexOf("// --- publication"),
    )
    expect(block).toContain("claimSearchBudget")
    // Charged, not merely observed — and before the outbound request, so the
    // budget cannot be spent without being consumed.
    expect(block.indexOf("claimSearchBudget")).toBeLessThan(block.indexOf("await fetch("))
  })

  test("the budget counts searches rather than reports", () => {
    // The defect this replaces: the gate called `clientReportsSince` /
    // `deploymentReportsSince`, and a search files no report — so a caller
    // rotating `clientKey` always read zero and a quiet deployment sat
    // permanently below its ceiling. It bounded a persistent client and nothing
    // else, which is the "counts a quantity this operation does not produce"
    // flaw the upload gate had.
    const block = feedbackSource.slice(
      feedbackSource.indexOf("export const claimSearchBudget"),
      feedbackSource.indexOf("export const findDuplicates"),
    )
    expect(block).toContain('ctx.db.insert("feedbackSearches"')
    expect(block).not.toContain("clientReportsSince")
    expect(block).not.toContain("deploymentReportsSince")
  })

  test("both a client bound and a deployment bound apply", () => {
    // The per-client bound is resettable by rotating the key; only the
    // deployment bound actually protects GitHub's rate limit.
    const block = feedbackSource.slice(
      feedbackSource.indexOf("export const claimSearchBudget"),
      feedbackSource.indexOf("export const findDuplicates"),
    )
    expect(block).toContain("DAILY_CLIENT_SEARCH_CAP")
    expect(block).toContain("DAILY_DEPLOYMENT_SEARCH_CAP")
  })

  test("it is a mutation, because counting a search means recording it", () => {
    // A query could observe the budget but never charge against it.
    expect(feedbackSource).toContain("export const claimSearchBudget = internalMutation")
  })

  test("search records are reaped rather than accumulating forever", () => {
    expect(feedbackSource).toContain("export const sweepSearchRecords")
    expect(feedbackSource).toContain("internal.feedback.sweepSearchRecords")
  })
})

describe("an upload record is bound to its file exactly", () => {
  test("the mint returns its row id so the binding is not a guess", () => {
    // A mint row cannot know its `storageId` — the file does not exist when the
    // URL is issued — so the first version looked up by `storageId` and fell
    // back to "newest unclaimed row". The lookup could never hit on a first
    // claim, so the fallback was the *only* path that ever ran while the
    // comment presented it as the exception.
    const block = feedbackSource.slice(
      feedbackSource.indexOf("export const generateScreenshotUploadUrl"),
      feedbackSource.indexOf("async function claimScreenshot"),
    )
    expect(block).toContain('uploadId: v.id("feedbackUploads")')
    expect(block).toContain("const uploadId = await ctx.db.insert")
  })

  test("binding uses the caller's row id, and distrusts it", () => {
    const block = feedbackSource.slice(
      feedbackSource.indexOf("async function bindUpload"),
      feedbackSource.indexOf("async function deleteUploadRecord"),
    )
    expect(block).toContain("ctx.db.get(uploadId)")
    // `uploadId` arrives over the wire: an already-claimed row, or one already
    // bound to a different file, must not be re-bound.
    expect(block).toContain("!row.claimed")
    expect(block).toContain("row.storageId === null")
    // The by-file lookup survives as the genuine fallback it always should
    // have been — idempotency for a re-submitted file.
    expect(block).toContain("by_storageId")
  })

  test("submission carries the upload id", () => {
    expect(feedbackSource).toContain("claimScreenshot(ctx, args.screenshotId, args.uploadId)")
    expect(read("components/feedback-widget.tsx")).toContain("uploadId,")
  })
})

describe("claimed upload records do not outlive their report", () => {
  test("report retention deletes the upload record too", () => {
    // `sweepOrphanedUploads` reads only the `claimed: false` range, so without
    // this the table grew by one permanent row per screenshot ever uploaded —
    // while the schema claimed a claimed row's lifetime belonged to its report.
    const block = feedbackSource.slice(
      feedbackSource.indexOf("export const sweepExpiredReports"),
      feedbackSource.indexOf("export const sweepOrphanedUploads"),
    )
    expect(block).toContain("deleteUploadRecord(ctx, row.screenshotId)")
    // File first, then the mint record — both inside `onRow`, which `sweepBatch`
    // runs before deleting the report row.
    expect(block.indexOf("ctx.storage.delete")).toBeLessThan(block.indexOf("deleteUploadRecord"))
  })

  test("the deleter finds the row by the file it names", () => {
    const block = feedbackSource.slice(feedbackSource.indexOf("async function deleteUploadRecord"))
    expect(block).toContain("by_storageId")
    expect(block).toContain("ctx.db.delete(row._id)")
  })
})

describe("publishing is idempotent across a retry", () => {
  test("a failed report is checked for an existing issue before re-POSTing", () => {
    // A network failure *after* GitHub created the issue marks the row failed;
    // `republishFailed` then re-queues it and a second identical issue is filed.
    const block = feedbackSource.slice(
      feedbackSource.indexOf("export const publishReport"),
      feedbackSource.indexOf("export const republishFailed"),
    )
    expect(block).toContain("findIssueForReport")
    expect(block.indexOf("findIssueForReport")).toBeLessThan(block.indexOf('method: "POST"'))
  })

  test("the idempotency key is the report id printed in the body", () => {
    expect(feedbackSource).toMatch(/in:body "\$\{reportId\}"/)
    expect(read("lib/feedback-issue.ts")).toContain("Report id")
  })
})

describe("duplicateCandidates is a real signal", () => {
  test("recordPublication cannot overwrite it", () => {
    // Every one of its call sites passed `[]`, so the column was emptied the
    // moment a report was published — the schema documented a triage signal
    // that did not exist.
    const block = feedbackSource.slice(
      feedbackSource.indexOf("export const recordPublication"),
      feedbackSource.indexOf("export const publishReport"),
    )
    expect(block).not.toContain("duplicateCandidates")
  })

  test("the widget sends what the reporter was actually shown", () => {
    const widget = read("components/feedback-widget.tsx")
    expect(widget).toContain("duplicateCandidates: duplicates.map")
    expect(feedbackSource).toContain("duplicateCandidates: args.duplicateCandidates")
  })
})
