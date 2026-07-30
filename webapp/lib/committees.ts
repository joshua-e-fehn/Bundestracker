/**
 * Turning committee names into stable URL segments, and back.
 *
 * A committee's identity in Bundestrack is its **name as Stammdaten publishes
 * it** — `Auswärtiger Ausschuss`, `Haushaltsausschuss`, `Ausschuss für
 * Digitales`. That is the same value the Convex query
 * `api.committees.getCommitteeMembers` takes verbatim as `committeeName`, and
 * convex/schema.ts notes explicitly (lines 678–682): committee names are
 * "never folded onto membership names" — they are recut between electoral
 * periods, and matching them across sources would assert a continuity the
 * source itself does not.
 *
 * ## Why the URL segment is not a slug
 *
 * A slug is a lossy projection — `Ausschuss für Digitales` and
 * `Ausschuss fur Digitales` collapse the same way `foldName` does, and the
 * inverse map from slug → committee has to live somewhere. That "somewhere"
 * is a lookup table that has to stay in sync with the source, and a second
 * name for one thing is exactly the class of drift `lib/parties.ts` opens
 * with. Two Stammdaten committees that slugged the same way would be one URL
 * that opened one page arbitrarily.
 *
 * `encodeURIComponent` is the inverse of `decodeURIComponent` by definition,
 * so the round-trip is exact: any UTF-8 committee name maps to a unique URL
 * segment and back to itself. Next.js parses `%2F` inside a `[slug]` segment
 * as a single segment (it does *not* split on the encoded slash), so even a
 * hypothetical `Ausschuss X/Y` survives.
 *
 * ## Why this file exists
 *
 * So the encoding decision lives once. A component that builds
 * `/committees/${encodeURIComponent(name)}` inline is a component that will
 * be missed the day the encoding rule needs to change — the same failure
 * mode `useMPHref` prevents for MP profile links.
 */

/**
 * The `/committees/[id]` URL for one committee, unscoped to a period.
 *
 * The caller composes this with `usePeriodHref` when it needs the `?wp=`
 * parameter carried across the link — the split matches `useMPHref` in
 * components/providers/period-provider.tsx, where the period ride-along is
 * decided by the surrounding provider, not by the string builder.
 */
export function committeeHref(committeeName: string): string {
  return `/committees/${encodeURIComponent(committeeName)}`
}

/**
 * The committee name from a route param, decoded and normalised.
 *
 * ⚠ `params.id` in the Next.js App Router is **not** decoded for the caller —
 * both `params` in a server `page.tsx` and `useParams()` in a client one hand
 * over the raw URL segment. `app/mps/[id]/page.tsx` (`decodeURIComponent(id)`
 * on both metadata and body sides) is the precedent, and this function does
 * the same thing so callers do not have to remember to. Before this landed,
 * the metadata block ran the ID through a template literal that coerced the
 * decoded value and the page body handed the raw segment straight to the
 * client heading — so the `<title>` said "Ausschuss für Digitales…" while
 * the `<h1>` rendered `Ausschuss%20f%C3%BCr%20Digitales%2E…`, one page.
 *
 * `decodeURIComponent` on malformed input (`%zz`) throws — the try/catch
 * folds that into `null`, matching the empty-segment and control-char cases.
 *
 * Returns `null` when the segment cannot name a committee — the caller decides
 * whether that is a 404 or an unavailable state. It is not a 404 today: an
 * unknown-but-well-formed name renders an "unknown committee" empty state,
 * because a name may have been recut mid-period and the URL is still a
 * shareable address for a page.
 */
export function parseCommitteeParam(raw: string | undefined | null): string | null {
  if (typeof raw !== "string") return null
  const trimmed = raw.trim()
  if (trimmed.length === 0) return null
  let decoded: string
  try {
    decoded = decodeURIComponent(trimmed)
  } catch {
    // A malformed escape (`%zz`, a stray `%` at the end). Not a name.
    return null
  }
  // Rejects a segment made entirely of ASCII control characters. Real
  // committee names have at least one printable character; a segment that has
  // none is a stray escape rather than a name. Checked on the *decoded* value
  // so a real name that happened to include a printable `%` character (none
  // do today, but the check should be about content, not encoding shape) is
  // not filtered out.
  // biome-ignore lint/suspicious/noControlCharactersInRegex: this is the check
  if (!/[^\x00-\x1f\x7f]/.test(decoded)) return null
  return decoded
}

/**
 * Fold a set of `{ committeeName }` rows into `{ committeeName, seats }`
 * entries, sorted by German collation.
 *
 * Extracted from `convex/committees.ts`'s `getCommittees` handler so the
 * reduction — the actual logic — can be unit-tested without spinning up
 * Convex. The handler still owns the read from the index; this is what it
 * does with the rows.
 *
 * "Seats" rather than "members", matching the language convex/committees.ts
 * uses in its header: a chair is one seat on a committee, not two. The upsert
 * key `(mpInternalId, wahlperiode, committeeName)` already collapses the
 * duplicate row Stammdaten emits for `Vorsitzender` + `Ordentliches
 * Mitglied`, so a `.length` on this side does not double-count.
 */
export function summarizeCommittees(
  rows: ReadonlyArray<{ committeeName: string }>,
): Array<{ committeeName: string; memberCount: number }> {
  const counts = new Map<string, number>()
  for (const row of rows) {
    counts.set(row.committeeName, (counts.get(row.committeeName) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([committeeName, memberCount]) => ({ committeeName, memberCount }))
    .sort((a, b) => a.committeeName.localeCompare(b.committeeName, "de"))
}
