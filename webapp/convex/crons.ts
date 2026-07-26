import { cronJobs } from "convex/server"
import { internal } from "./_generated/api"

/**
 * Scheduled work inside Convex.
 *
 * The division of labour is deliberate and set out in AGENTS.md: the Bundestag
 * API fetch happens in **Python**, run by a system cron calling
 * `pixi run pipeline sync`, because the sources need sequential fetching behind
 * a WAF that IP-blocks on concurrency (§2.6 of docs/api-research.md), XLSX
 * parsing, and XML parsing. Convex's crons handle only in-Convex aggregation
 * over data that has already landed.
 *
 * So there is exactly one job here: recomputing activity scores.
 */

const crons = cronJobs()

/**
 * Rescores the current electoral period, nightly.
 *
 * 03:15 UTC — after the Python sync, which runs on the host's own schedule, and
 * inside the quiet hours for a German audience either way. Not on the hour:
 * every cron in the world fires at :00, and there is nothing here that needs
 * to join them.
 *
 * `sweepScores` walks the roster in slices rather than scoring 630 MPs in one
 * transaction, because each MP's score reads their activities, speeches, votes
 * and committees — the whole chamber at once would exceed Convex's
 * per-transaction read limit. It reschedules itself until the roster is
 * exhausted; see convex/scoreSweep.ts.
 *
 * The job is idempotent: every score is a pure function of rows already stored,
 * recomputed from scratch rather than incremented. A run that dies partway
 * leaves correct scores for the MPs it reached and yesterday's for the rest,
 * and tomorrow's run fixes those — no double-counting, no repair step.
 */
crons.daily(
  "recompute activity scores",
  { hourUTC: 3, minuteUTC: 15 },
  internal.scoreSweep.startNightlySweep,
  {},
)

export default crons
