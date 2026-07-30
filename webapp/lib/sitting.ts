/**
 * The `(wahlperiode, sitzungnr)` pair that names a plenary sitting — parsed off
 * a URL, or null when it is not one.
 *
 * A sitting has no row of its own in Convex (see the header of
 * `app/sittings/[wahlperiode]/[sittingNumber]/page.tsx`), so nothing else in
 * the codebase parses this pair yet. It lives here rather than inline in the
 * route because both server and client call it — the route validates before
 * rendering, and `SittingDetail`'s tests would otherwise reimplement the
 * validator to reason about invalid pairs.
 *
 * ## The Wahlperiode bound is the tracked one, not the parseable one
 *
 * `EARLIEST_TRACKED_WAHLPERIODE` is 14 — every period below is a URL the
 * codebase has never held rows for. Rejecting them is the same rule
 * `parsePeriodParam` (lib/period.ts) applies to `?wp=`, and for the same
 * reason: an unparseable value should not be a 404 in the abstract, but a
 * value the site has *no source for* should not render an empty page either.
 * The upper bound is `LATEST_PARSEABLE_WAHLPERIODE` mirror (99): a sanity
 * ceiling well above whichever Bundestag is current on any given day.
 *
 * ## The sitting bound is 999
 *
 * §5.1's protocol URL format zero-pads sitting numbers to three digits —
 * `btp/21/21090.pdf` — which is the whole width the source uses. A Bundestag
 * sits ~245 times per period (WP18), so 999 is a headroom cap, not a real
 * boundary; it just says a four-digit sitting number is a typo, not a request.
 *
 * ## `1` rather than `0`
 *
 * The Bundestag numbers its sittings from 1 (the constitutive sitting).
 * `sitzungnr = 0` is not a real address and would render as "Sitzung 0", which
 * looks like a placeholder.
 */

const EARLIEST_TRACKED_WAHLPERIODE = 14
const LATEST_PARSEABLE_WAHLPERIODE = 99
const MAX_SITTING_NUMBER = 999

export type SittingKey = { wahlperiode: number; sitzungnr: number }

/** Parses the pair, or returns null when either side is not a valid natural
 * number in range. Rejects non-digit strings, leading zeros (`021`), signs,
 * decimals and scientific notation — everything `Number()` accepts loosely and
 * the source itself never emits. */
export function parseSittingParams(
  wahlperiodeRaw: string,
  sitzungnrRaw: string,
): SittingKey | null {
  const wahlperiode = parsePositiveInt(wahlperiodeRaw, 2)
  const sitzungnr = parsePositiveInt(sitzungnrRaw, 3)
  if (wahlperiode === null || sitzungnr === null) return null
  if (wahlperiode < EARLIEST_TRACKED_WAHLPERIODE) return null
  if (wahlperiode > LATEST_PARSEABLE_WAHLPERIODE) return null
  if (sitzungnr < 1) return null
  if (sitzungnr > MAX_SITTING_NUMBER) return null
  return { wahlperiode, sitzungnr }
}

/** Digit-string check first — `Number()` on its own would accept "", " ",
 * "1e2", "0x15", "-3", "1.5", none of which is a number that names a period or
 * a sitting. The pattern rules them all out at once. Also rejects a leading
 * zero on a multi-digit number (`021`) because the source never emits that
 * form; a reader tolerated it would silently make two URLs render the same
 * page. */
function parsePositiveInt(value: string, maxDigits: number): number | null {
  const pattern = new RegExp(`^(?:0|[1-9]\\d{0,${maxDigits - 1}})$`)
  if (!pattern.test(value)) return null
  return Number(value)
}
