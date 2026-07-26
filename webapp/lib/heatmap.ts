/**
 * The contribution grid's calendar arithmetic.
 *
 * Separated from the component that draws it because it is the part that can be
 * wrong without looking wrong: an off-by-one in the week alignment shifts every
 * cell by a day, and the result is still a plausible-looking grid. A test can
 * catch that; an eye cannot.
 *
 * Everything here is UTC. The stored dates are calendar days with no time (see
 * the header of convex/schema.ts), so a local-time `Date` would put a reader in
 * Berlin and a reader in Los Angeles on different cells for the same event —
 * and only for some readers, which is the hardest kind of bug to hear about.
 */

/** A day's cell: the date it stands for, and how many events fell on it. */
export type HeatmapDay = { date: string; count: number }

/** A column of the grid — one week, Monday first. Short at the edges: the first
 * and last weeks are partial unless the window happens to align. */
export type HeatmapWeek = { days: HeatmapDay[] }

/**
 * How many shades the grid uses, excluding "nothing happened".
 *
 * Four, like GitHub's, because the eye stops reading a sequential ramp as
 * ordered past about five steps — and because the counts here are small
 * integers, so more levels would mostly distinguish 3 from 4.
 */
export const HEATMAP_LEVELS = 4

/**
 * Buckets a day's count into `0…HEATMAP_LEVELS`.
 *
 * Relative to the busiest day in the window rather than to a fixed scale. An
 * absolute scale would be comparable between MPs, which sounds better than it
 * is: a backbencher's whole year would render as one flat shade against a
 * minister's, and the graph would stop being readable for exactly the MPs whose
 * activity is hardest to see elsewhere. The tooltip carries the real number,
 * which is the comparable thing.
 *
 * Any non-zero count gets at least level 1. A day with one event must not be
 * indistinguishable from a day with none — that is the distinction the whole
 * grid exists to draw.
 */
export function heatmapLevel(count: number, max: number): number {
  if (count <= 0) return 0
  if (max <= 0) return 0
  return Math.max(1, Math.ceil((count / max) * HEATMAP_LEVELS))
}

/** An ISO `YYYY-MM-DD` for a UTC date. */
export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/** `Date.UTC` from an ISO day, or null if the string does not name one. Shared
 * by both directions of the window so a malformed bound cannot produce a grid
 * that silently starts somewhere else. */
function fromIso(iso: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!match) return null
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  return Number.isNaN(date.getTime()) ? null : date
}

/**
 * The twelve-month window ending on `today`, as ISO bounds.
 *
 * Starts on the first of the month twelve months back rather than exactly a
 * year ago to the day, so the month labels along the top line up with whole
 * columns instead of starting mid-month. That makes the window 12–13 months
 * wide depending on where in the month "today" falls, which is the trade the
 * labels are worth.
 */
export function twelveMonthWindow(today: Date): { from: string; to: string } {
  const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 11, 1))
  return { from: isoDate(start), to: isoDate(today) }
}

/**
 * Lays the window out as weeks, Monday first.
 *
 * Monday rather than GitHub's Sunday: the grid is read by a German audience,
 * ISO 8601 starts the week on Monday, and a sitting week is a Monday-to-Friday
 * object in this domain — a Sunday-first grid splits every sitting week across
 * two columns.
 *
 * Days outside the window are omitted rather than emitted as zeroes, so the
 * first and last columns are short. A padded cell is indistinguishable from a
 * real day with no activity, and "the MP did nothing that day" is a claim about
 * a day that is not in the window at all.
 *
 * `counts` is the sparse `{date, count}` list Convex's `getActivityCalendar`
 * returns — days with no events are simply absent from it, and become zeroes
 * here. Dates outside the window are ignored rather than trusted, because the
 * window is this function's argument and not the query's.
 */
export function buildHeatmapWeeks(
  counts: ReadonlyArray<HeatmapDay>,
  from: string,
  to: string,
): HeatmapWeek[] {
  const start = fromIso(from)
  const end = fromIso(to)
  if (!start || !end || start > end) return []

  const byDate = new Map(counts.map((entry) => [entry.date, entry.count]))

  // Back up to the Monday on or before the window's start, so the first column
  // is a real week. `getUTCDay()` is 0 for Sunday, which is six days into an
  // ISO week, not zero.
  const cursor = new Date(start)
  const weekday = (cursor.getUTCDay() + 6) % 7
  cursor.setUTCDate(cursor.getUTCDate() - weekday)

  const weeks: HeatmapWeek[] = []
  let current: HeatmapDay[] = []
  while (cursor <= end) {
    const iso = isoDate(cursor)
    // The pre-Monday padding and any day past `to` are skipped, not zeroed.
    if (iso >= from) {
      current.push({ date: iso, count: byDate.get(iso) ?? 0 })
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1)
    // A completed week is one that has just wrapped past Sunday.
    if ((cursor.getUTCDay() + 6) % 7 === 0 && current.length > 0) {
      weeks.push({ days: current })
      current = []
    }
  }
  if (current.length > 0) weeks.push({ days: current })
  return weeks
}

/**
 * Where each month's label goes: the index of the first week containing one of
 * its days, and the `YYYY-MM` it names.
 *
 * Derived from the laid-out weeks rather than from the window, so a label
 * cannot point at a column that is not there. A month whose first days share a
 * column with the previous month's last days is labelled on that shared column;
 * the alternative is two labels on one column, which reads as neither.
 */
export function monthLabels(weeks: ReadonlyArray<HeatmapWeek>): Array<{
  weekIndex: number
  month: string
}> {
  const labels: Array<{ weekIndex: number; month: string }> = []
  let seen: string | null = null
  for (const [weekIndex, week] of weeks.entries()) {
    for (const day of week.days) {
      const month = day.date.slice(0, 7)
      if (month !== seen) {
        seen = month
        labels.push({ weekIndex, month })
        break
      }
    }
  }
  return labels
}
