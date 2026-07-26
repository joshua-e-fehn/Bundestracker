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
 * 03:15 UTC — after the Python sync and inside the quiet hours for a German
 * audience. Not on the hour: every cron in the world fires at :00 and nothing
 * here needs to join them.
 *
 * The sweep walks the roster in slices and reschedules itself, because scoring
 * the whole chamber in one transaction would exceed Convex's read limit. It is
 * idempotent — every score is recomputed from stored rows rather than
 * incremented, so a run that dies partway needs no repair, just tomorrow's run.
 * See convex/scoreSweep.ts.
 */
crons.daily(
  "recompute activity scores",
  { hourUTC: 3, minuteUTC: 15 },
  internal.scoreSweep.startNightlySweep,
  {},
)

export default crons
