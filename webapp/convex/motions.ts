import { paginationOptsValidator } from "convex/server"
import { type ObjectType, v } from "convex/values"
import { foldedTextMatches, foldSearchQuery, indexableText } from "../lib/search"
import type { Doc } from "./_generated/dataModel"
import { internalMutation, type MutationCtx, query } from "./_generated/server"
import {
  assertBatchSize,
  emptyBatchResult,
  pageLimit,
  recordBatch,
  upsertRow,
  withId,
} from "./lib/ingest"
import { mpLabel, requireMandate } from "./mps"
import { motionInput } from "./schema"

/**
 * Motions, bills and the MPs who put their names to them.
 *
 * ## Why sponsors are a table and not an array
 *
 * The obvious modelling — `sponsors: v.array(...)` — cannot be populated
 * correctly from the source. DIP's `autoren_anzeige` is capped at **four**
 * entries with the real total in `autoren_anzahl` (§3.4), so a motion with
 * forty co-signatories arrives as four names and a number. Per-MP authorship
 * has to come from `/aktivitaet`, one record per MP per document — so one row
 * here per sponsor, arriving over time rather than at once.
 *
 * §3.4 states the consequence plainly: authorship computed from
 * `autoren_anzeige` systematically under-counts. So `getMotionSponsors` returns
 * the sponsors *known so far*, which is a growing subset of the published
 * `autoren_anzahl` and must not be presented as the signatory count.
 */

// --- read models ----------------------------------------------------------

const motionDoc = v.object({ id: v.id("motions"), ...motionInput, createdAt: v.number() })

const toMotionDoc = withId<"motions">

// --- lookup ---------------------------------------------------------------

/**
 * The row this record is about, by whichever DIP id it carries.
 *
 * A motion reaches Bundestrack as a Vorgang (the procedure) or a Drucksache
 * (the paper), rarely both, so there are two candidate keys and neither is
 * always present. Tried in that order because a Vorgang is the more stable of
 * the two: one procedure spans several papers.
 */
async function findMotion(
  ctx: MutationCtx,
  dipVorgangId: string | null,
  dipDrucksacheId: string | null,
): Promise<Doc<"motions"> | null> {
  if (dipVorgangId !== null) {
    const byVorgang = await ctx.db
      .query("motions")
      .withIndex("by_dipVorgangId", (q) => q.eq("dipVorgangId", dipVorgangId))
      .first()
    if (byVorgang) return byVorgang
  }
  if (dipDrucksacheId !== null) {
    return await ctx.db
      .query("motions")
      .withIndex("by_dipDrucksacheId", (q) => q.eq("dipDrucksacheId", dipDrucksacheId))
      .first()
  }
  return null
}

// --- ingestion ------------------------------------------------------------

async function upsertOne(ctx: MutationCtx, input: ObjectType<typeof motionInput>, now: number) {
  // The schema can express "both may be null" but not "not both", so the check
  // lives here. Without an id the row has no identity, and every sync would
  // insert the motion again — a slow-growing duplicate rather than a loud error.
  if (input.dipVorgangId === null && input.dipDrucksacheId === null) {
    throw new Error(
      `Motion "${input.title}" has neither dipVorgangId nor dipDrucksacheId; ` +
        "one is required as the upsert key.",
    )
  }
  const existing = await findMotion(ctx, input.dipVorgangId, input.dipDrucksacheId)
  return await upsertRow(ctx, "motions", existing, input, now)
}

// The one-motion form used to sit here (`upsertMotion`) beside the batch
// form below. The pipeline HTTP route (`/api/pipeline/motions`) always
// batches, so the singular never had a caller. Removed; `upsertOne` is still
// the shared upsert path that both the batch mutation and any future single
// caller would go through.

export const upsertMotions = internalMutation({
  args: { motions: v.array(v.object(motionInput)) },
  returns: v.object({ inserted: v.number(), updated: v.number() }),
  handler: async (ctx, args) => {
    assertBatchSize(args.motions.length, "motions")
    const now = Date.now()
    const result = emptyBatchResult()
    for (const motion of args.motions) {
      const { created } = await upsertOne(ctx, motion, now)
      recordBatch(result, created)
    }
    return result
  },
})

/**
 * Attaches sponsors to a motion, identified by its DIP id rather than its
 * Convex id — same reason as `upsertVoteRecords`: the pipeline holds DIP ids
 * and would otherwise round-trip for a Convex id it never uses again.
 */
export const upsertMotionSponsors = internalMutation({
  args: {
    dipVorgangId: v.union(v.null(), v.string()),
    dipDrucksacheId: v.union(v.null(), v.string()),
    wahlperiode: v.number(),
    sponsors: v.array(v.object({ mpInternalId: v.string(), role: v.union(v.null(), v.string()) })),
  },
  returns: v.object({ inserted: v.number(), updated: v.number() }),
  handler: async (ctx, args) => {
    assertBatchSize(args.sponsors.length, "sponsors")
    const motion = await findMotion(ctx, args.dipVorgangId, args.dipDrucksacheId)
    if (!motion) {
      throw new Error(
        `Motion not found: Vorgang ${args.dipVorgangId ?? "—"}, ` +
          `Drucksache ${args.dipDrucksacheId ?? "—"}. Ingest the motion before its sponsors.`,
      )
    }
    const now = Date.now()
    const result = emptyBatchResult()
    for (const sponsor of args.sponsors) {
      await requireMandate(ctx, sponsor.mpInternalId, args.wahlperiode)
      const existing = await ctx.db
        .query("motionSponsors")
        .withIndex("by_motionId_and_mpInternalId", (q) =>
          q.eq("motionId", motion._id).eq("mpInternalId", sponsor.mpInternalId),
        )
        .unique()
      const { created } = await upsertRow(
        ctx,
        "motionSponsors",
        existing,
        { motionId: motion._id, mpInternalId: sponsor.mpInternalId, role: sponsor.role },
        now,
      )
      recordBatch(result, created)
    }
    return result
  },
})

// --- public queries -------------------------------------------------------

// A period-wide `getMotions` used to sit here, capping at 50 rows with no
// cursor. `getMotionsPage` below serves the /motions list with real pagination
// and there was no other caller — the untruncated variant was a footgun
// waiting to render half a period.

/**
 * The motions one MP put their name to, newest first.
 *
 * Reads sponsorships and resolves each to its motion, rather than the reverse.
 * The sponsorship index is keyed by MP, so this is one indexed scan plus a
 * point lookup per hit; going the other way would mean scanning every motion in
 * the period.
 */
export const getMotionsByMP = query({
  args: { mpInternalId: v.string(), wahlperiode: v.number(), limit: v.optional(v.number()) },
  returns: v.array(v.object({ role: v.union(v.null(), v.string()), motion: motionDoc })),
  handler: async (ctx, args) => {
    const sponsorships = await ctx.db
      .query("motionSponsors")
      .withIndex("by_mpInternalId", (q) => q.eq("mpInternalId", args.mpInternalId))
      .collect()

    const joined = []
    for (const sponsorship of sponsorships) {
      const motion = await ctx.db.get(sponsorship.motionId)
      // Period-scoped through the motion: a sponsorship carries no period of
      // its own, and an MP's mandates span several.
      if (!motion || motion.wahlperiode !== args.wahlperiode) continue
      joined.push({ role: sponsorship.role, motion: toMotionDoc(motion) })
    }
    joined.sort((a, b) => b.motion.date.localeCompare(a.motion.date))
    return joined.slice(0, pageLimit(args.limit, 50))
  },
})

/**
 * A page of a period's motions, newest first — the `/motions` list.
 *
 * ## Why this is a cursor and `/votes` is a slice
 *
 * `getVoteSheetsPage` collects a period's ballots and slices them, and says why
 * it can: §4.4 puts named ballots at ~1 015 in the Bundestag's *entire history*,
 * so one period is a few hundred rows. This table is three orders of magnitude
 * larger — the WP19 backfill logged **37 726** motions for one period — so the
 * same shape here would read the whole table on every keystroke and blow through
 * Convex's ~16 000-document transaction budget on page one.
 *
 * So this pages with a cursor, the way convex/feed.ts does over the equally
 * large `activityEvents`. The consequence a caller must respect is the one that
 * module states: there is **no `total`**, because a total is a count of the
 * filtered set and counting it is the read this exists to avoid. The UI shows
 * "load more" rather than "page 3 of 1 509", which is also the honest control —
 * a page number over a set nobody has counted is a number invented for the
 * chrome.
 *
 * ## Two filters, two mechanisms — the same split as the feed
 *
 * `vorgangstyp` is the procedure kind (`Kleine Anfrage`, `Gesetzgebung`) and is
 * the one a reader actually filters by; it gets its own index,
 * `by_wahlperiode_and_vorgangstyp_and_date`, for the reason
 * `by_wahlperiode_and_eventType_and_date` exists on the feed: taking a page of
 * the mixed list and dropping non-matches afterwards returns a short page, and a
 * short page is indistinguishable from "there are no more". Here it would be
 * worse than on the feed — `Schriftliche Frage` is 44 % of WP21's sample and
 * 71 % of WP20's, so filtering to `Antrag` post-hoc empties the first several
 * pages and reads as a parliament that tabled none.
 *
 * `search` cannot have an index and is applied to the page after it is read.
 * A title is free text, `motions` carries no search index, and adding one is a
 * schema-plus-backfill change over 37 000 rows per period — out of proportion to
 * a substring box. Filtering *after* `.paginate()` rather than chaining
 * `.filter()` into it is what keeps that bounded; see the note at the call.
 *
 * The cost lands on the reader as short pages, exactly as the group filter does
 * on the feed, and `isDone` is passed through **untouched** for the same reason
 * — it says whether more motions exist in the source, not whether more matched.
 * Verified by walking the cursor against a real backend: a search matching
 * nothing returns three empty pages and then `isDone`, so "load more" terminates
 * rather than being offered forever.
 */
export const getMotionsPage = query({
  args: {
    wahlperiode: v.number(),
    /** Procedure kind, matched exactly against the values `getMotionFilterOptions`
     * offers. Free text on the record (`vorgangstyp` is an open string), so this
     * is a selection from what is there rather than an enum. */
    vorgangstyp: v.optional(v.string()),
    /** Words in the title. Folded through lib/search.ts by this handler rather
     * than by the caller, unlike `search.searchMPs` — there the browser folds so
     * the page can show what it searched for, and here there is nothing to show. */
    search: v.optional(v.string()),
    /** Calendar year as `YYYY`. A year rather than a month, for the reason
     * `getVoteSheetsPage` gives: a period spans four of them. Applied through
     * the index's date bound, so it narrows the scan rather than the page. */
    year: v.optional(v.string()),
    paginationOpts: paginationOptsValidator,
  },
  returns: v.object({
    page: v.array(motionDoc),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    // Bound to a local before the branch so the narrowing survives into the
    // index callback, where `args.vorgangstyp` is optional again — the shape
    // convex/feed.ts uses, for the same reason.
    const kind = args.vorgangstyp
    /**
     * The caller's intent, before folding turns intent into a needle.
     *
     * Kept separate from the folded `needle` because the two answer different
     * questions. `askedToSearch` says "did the reader type something in the
     * box"; `needle` says "did that survive folding into a matchable term".
     * A reader who typed `???` gets `needle === ""` — which used to be
     * indistinguishable from "no search was set", and therefore returned the
     * whole period. lib/motions.test.ts pinned exactly that trap on
     * `foldedTextMatches`; the server side had the same trap and this is the
     * fix. An intentional empty search means "no matches" rather than "all
     * matches" — that is what the box asked for.
     */
    const askedToSearch = args.search !== undefined && args.search.trim() !== ""
    const needle = askedToSearch ? foldSearchQuery(args.search ?? "") : ""

    /**
     * The year as a date range on whichever index is in play.
     *
     * `date` is ISO `YYYY-MM-DD` (the schema header), so a year is a prefix and
     * `gte`/`lt` over the two boundary strings selects it exactly — lexicographic
     * order on a fixed-width date is chronological order. Applied *inside* the
     * index rather than as a `.filter()` because a filter would read the whole
     * period to return one year of it.
     *
     * Only well-formed years reach the bound. lib/motions.ts normalises the
     * URL before it reaches this argument; the check here is defence in depth
     * — an old bookmark or a script hitting the raw endpoint must not turn a
     * malformed year into "no match" for a period that has matches, because
     * `abc-01-01` sits lexicographically above every stored date.
     */
    const year = args.year !== undefined && /^\d{4}$/.test(args.year) ? args.year : undefined
    const from = year === undefined ? null : `${year}-01-01`
    const to = year === undefined ? null : `${year}-12-31`

    const rows =
      kind === undefined
        ? ctx.db
            .query("motions")
            .withIndex("by_wahlperiode_and_date", (q) => {
              const scoped = q.eq("wahlperiode", args.wahlperiode)
              return from === null || to === null
                ? scoped
                : scoped.gte("date", from).lte("date", to)
            })
            .order("desc")
        : ctx.db
            .query("motions")
            .withIndex("by_wahlperiode_and_vorgangstyp_and_date", (q) => {
              const scoped = q.eq("wahlperiode", args.wahlperiode).eq("vorgangstyp", kind)
              return from === null || to === null
                ? scoped
                : scoped.gte("date", from).lte("date", to)
            })
            .order("desc")

    const result = await rows.paginate(args.paginationOpts)

    /**
     * The title filter, applied to the page **after** it is read.
     *
     * That placement is what bounds the cost, and it is worth being exact about
     * because the obvious alternative looks cheaper and is not. Chaining
     * `.filter()` into the query pipeline *before* `.paginate()` would make
     * Convex keep scanning until it had `numItems` matches — so a word matching
     * nothing would walk the period's 37 726 rows looking for a 25th hit, and
     * `maximumRowsRead` would then be needed to stop it.
     *
     * Filtering here instead means the read is exactly `numItems` rows whatever
     * the search is. Measured against a real backend: a 25-row page costs 25
     * documents unfiltered and 25 documents for a search matching nothing; a
     * 100-row page over a 60-row table costs 60. `maximumRowsRead` is therefore
     * not set — it would be dead configuration, since it can only bind below
     * `numItems`, which is already the bound.
     *
     * The cost lands on the reader as short pages rather than as a slow query,
     * which is the trade convex/feed.ts makes for its group filter and states in
     * the same terms. `isDone` below is what keeps that honest.
     *
     * `foldedTextMatches` from lib/search.ts, not `includes`: that module is the
     * one place that decides what "matches" means on this site. Verified against
     * this backend — `massnahmen` and `fuer` find `Maßnahmen` and `für`, which a
     * substring test would not.
     */
    /**
     * Three cases, and they diverge deliberately at the second one.
     *
     *  - No search set at all → the page as-read, no post-filter.
     *  - Search set but folded away to nothing (`?q=???`) → empty page,
     *    because that is what the reader asked for. Returning the whole
     *    period here is the trap lib/motions.test.ts warns against on the
     *    matcher side, and it is exactly as wrong on the query side.
     *  - Search set with a needle → the page filtered against the folded
     *    title, `foldedTextMatches`' rules (umlaut folding, prefix on the
     *    final term, AND-of-terms).
     */
    const punctuationOnly = askedToSearch && needle === ""
    const page = !askedToSearch
      ? result.page
      : punctuationOnly
        ? []
        : result.page.filter((row) => foldedTextMatches(indexableText(row.title), needle))

    return {
      page: page.map(toMotionDoc),
      // Untouched for the normal search — see the header. A page of 25 that
      // yields 2 after the title filter still reports `isDone: false`, so
      // "load more" stays offered and reaches the rest.
      //
      // Overridden to `true` for a punctuation-only search: every subsequent
      // page would also filter to zero (the punctuation didn't match once,
      // it will not match on page 2 or page 378 either), and offering
      // "load more" against a search that cannot ever match — cheap per
      // page but ~378 pages over WP19's 37 726 rows — is a treadmill,
      // not an action. `continueCursor` is left as Convex returned it;
      // paginators use it only when `isDone` is false, so its value in
      // this state is inert.
      isDone: result.isDone || punctuationOnly,
      continueCursor: result.continueCursor,
    }
  },
})

/**
 * Rows scanned per counted filter option.
 *
 * The same decision `getFeedFilterOptions` makes and for the same reason: a
 * count on a filter option does not need to be exact, but it must not be
 * silently wrong, so a kind at the cap is reported with `atLeast: true`.
 * Counting WP19's 37 726 motions exactly on every page load is the read this
 * whole module is arranged to avoid.
 */
const OPTION_COUNT_CEILING = 500

/**
 * How many kinds this query is allowed to count in one call.
 *
 * `getFeedFilterOptions` (convex/feed.ts) can iterate a fixed 7-value enum
 * because DIP publishes a closed vocabulary for its own event types. This
 * query cannot: `vorgangstyp` is an open string, so `discovered` grows as
 * DIP publishes new procedure kinds. Left unbounded, worst-case reads are
 * `DISCOVERY_SCAN + 1 (oldest_row) + 1 (end_row) + N * OPTION_COUNT_CEILING`
 * — at measured WP21 (N = 23) this is 11 902, three quarters of Convex's
 * 16 384-doc per-query cap, and at N = 32 the whole page fails to load
 * because the dropdown query throws. The failure is silent from code
 * review: it only appears the day DIP publishes the 32nd kind.
 *
 * So the fanout is bounded and, when it caps, reported as `partial: true`
 * for the same reason the sampled discovery is: the page must not present
 * a truncated dropdown as the period's complete vocabulary.
 *
 * ## The specific number
 *
 * **26** is one above the highest N measured in production (WP21's 23) plus
 * two spare slots for the *next* two DIP kinds we haven't observed yet. The
 * resulting worst-case reads land at `400 + 2 + 26 × 500 = 13 402` — about
 * 3 000 documents of headroom under the 16 384-doc transaction cap. That
 * headroom is deliberate rather than "spend the whole budget": this query
 * runs alongside caller-side reads in the same page-load transaction, and
 * the `motions.test.ts` test that pins this constant enforces the worst
 * case at strictly less than 14 000 so a later edit cannot creep the cap
 * back up without also revising the arithmetic here.
 *
 * A raise to something like 32 would still fit, but it would trade the
 * headroom for coverage this query does not need — every period past the
 * cap is already reported as `partial: true` and the reader is told to
 * fall back on the full-text search for kinds the dropdown omitted.
 */
const KIND_FANOUT_LIMIT = 26

/**
 * The filter values this period can actually offer.
 *
 * Built from the data rather than from a constant, which is the rule
 * components/rankings-filters.tsx states and convex/search.ts repeats: a control
 * offering values nothing matches reads as broken data. It matters more here
 * than anywhere else on the site, because `vorgangstyp` is an **open string** —
 * DIP publishes no value list — and the vocabulary genuinely differs between
 * periods: WP21's sample carries 23 distinct kinds, WP20's and WP19's 16 each,
 * and `Antrag` appears in one and not the others.
 *
 * ## Why the kinds are discovered from a sample and the years are not
 *
 * A distinct-value scan over 37 000 rows is the read this module exists to
 * avoid, so the kinds come from the period's most recent `DISCOVERY_SCAN` rows
 * and each is then counted through its own index. That is a real limitation and
 * it is reported rather than hidden: `partial` says the vocabulary was drawn
 * from a sample, so a kind last used four years ago may be missing from the
 * dropdown. It is the honest trade — the alternative is either a full scan or a
 * hardcoded list that goes stale silently.
 *
 * Years need no sample at all. The index is `(wahlperiode, date)`, so the oldest
 * and newest motions are its first and last rows — two reads — and every year
 * between them exists by construction in a period that sat continuously.
 */
export const getMotionFilterOptions = query({
  args: { wahlperiode: v.number() },
  returns: v.object({
    kinds: v.array(v.object({ value: v.string(), count: v.number(), atLeast: v.boolean() })),
    years: v.array(v.string()),
    /** True when the kinds were drawn from a sample rather than the whole
     * period — see the header. The UI says so rather than presenting a possibly
     * short list as the period's complete vocabulary. */
    partial: v.boolean(),
    /** Whether this period holds any motion at all. Distinguishes "no motions
     * ingested" from "no motion matches your filters", which are the two empty
     * states the page must never conflate. */
    empty: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const recent = await ctx.db
      .query("motions")
      .withIndex("by_wahlperiode_and_date", (q) => q.eq("wahlperiode", args.wahlperiode))
      .order("desc")
      .take(DISCOVERY_SCAN + 1)

    const oldest = await ctx.db
      .query("motions")
      .withIndex("by_wahlperiode_and_date", (q) => q.eq("wahlperiode", args.wahlperiode))
      .order("asc")
      .first()

    // A period with no motions: no kinds, no years, and `empty` so the page can
    // say "not backfilled" rather than "no match".
    if (recent.length === 0 || oldest === null) {
      return { kinds: [], years: [], partial: false, empty: true }
    }

    // Null `vorgangstyp` is a real state — a Drucksache with no procedure
    // reference — and it is not a filterable value: the empty string is what
    // Radix reserves and a "kind: none" option would select rows whose kind is
    // merely unrecorded. Dropped from the vocabulary rather than offered.
    const allDiscovered = [
      ...new Set(recent.map((row) => row.vorgangstyp).filter((k) => k !== null)),
    ]
    // Sample-order so a period with more than `KIND_FANOUT_LIMIT` kinds still
    // shows the ones that appeared most recently in the sample first — a rare
    // kind used four years ago and one dropped for size are indistinguishable
    // to the reader, but the recent-first ordering matches the sample scan and
    // is the least surprising rule to state. `partial` below tells the reader
    // when this happened, so the truncation is visible rather than hidden.
    const discovered = allDiscovered.slice(0, KIND_FANOUT_LIMIT)
    const fanoutCapped = allDiscovered.length > KIND_FANOUT_LIMIT

    const kinds = []
    for (const value of discovered) {
      const counted = await ctx.db
        .query("motions")
        .withIndex("by_wahlperiode_and_vorgangstyp_and_date", (q) =>
          q.eq("wahlperiode", args.wahlperiode).eq("vorgangstyp", value),
        )
        .take(OPTION_COUNT_CEILING)
      kinds.push({
        value,
        count: counted.length,
        atLeast: counted.length === OPTION_COUNT_CEILING,
      })
    }

    // Both ends of the index, expanded. Every year between the oldest and the
    // newest motion is a year the period sat in, so this needs no scan — and it
    // is newest-first to match the rows themselves.
    const years: string[] = []
    const first = Number(oldest.date.slice(0, 4))
    const last = Number(recent[0].date.slice(0, 4))
    if (Number.isFinite(first) && Number.isFinite(last)) {
      for (let year = last; year >= first; year--) years.push(String(year))
    }

    return {
      kinds: kinds.sort((a, b) => b.count - a.count || a.value.localeCompare(b.value, "de")),
      years,
      // Two orthogonal reasons the vocabulary can be incomplete: the discovery
      // scan hit its cap (so a rarely-used kind may not have been seen), and
      // the fanout cap trimmed the seen set (so a kind was seen but not
      // counted). Either way, `partial: true` is the honest report — the
      // dropdown is a subset of the period's kinds, and the reader deserves
      // to know a filter that returns nothing may still be spelled correctly.
      partial: recent.length > DISCOVERY_SCAN || fanoutCapped,
      empty: false,
    }
  },
})

/** Rows sampled to discover a period's procedure kinds — see
 * `getMotionFilterOptions`. Large enough to reach past a single busy sitting
 * week, small enough to stay a cheap read beside the counted ranges it feeds. */
const DISCOVERY_SCAN = 400

/**
 * Everyone known to have sponsored one motion.
 *
 * "Known" is the operative word — see the header note on `autoren_anzeige`'s
 * cap of four. The count returned here grows as `/aktivitaet` records arrive,
 * and is not the published `autoren_anzahl`.
 */
export const getMotionSponsors = query({
  args: { motionId: v.id("motions") },
  returns: v.array(
    v.object({
      mpInternalId: v.string(),
      name: v.string(),
      fraktion: v.string(),
      role: v.union(v.null(), v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    const motion = await ctx.db.get(args.motionId)
    if (!motion) return []
    const sponsorships = await ctx.db
      .query("motionSponsors")
      .withIndex("by_motionId_and_mpInternalId", (q) => q.eq("motionId", args.motionId))
      .collect()

    const joined = []
    for (const sponsorship of sponsorships) {
      const mp = await mpLabel(ctx, sponsorship.mpInternalId, motion.wahlperiode)
      joined.push({
        mpInternalId: sponsorship.mpInternalId,
        name: mp.name,
        fraktion: mp.fraktion,
        role: sponsorship.role,
      })
    }
    return joined.sort((a, b) => a.name.localeCompare(b.name, "de"))
  },
})
