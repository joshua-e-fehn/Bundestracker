import { v } from "convex/values"
import type { Doc } from "./_generated/dataModel"
import { internalMutation, type QueryCtx, query } from "./_generated/server"
import { withSearchText } from "./activityEvents"
import { pageLimit } from "./lib/ingest"
import { eventType } from "./schema"

/**
 * Keyword search over parliamentary records, answering with **MPs**.
 *
 * ## The result is a person, and that decides everything else
 *
 * A reader searching `Klima` is not asking which documents mention the climate;
 * they are asking who in the Bundestag works on it. So the unit of the result
 * is an MP, ranked by how much matching work they have, and each result carries
 * the records that matched as its evidence. A list of motion titles would be a
 * different product — and one the reader could not act on, because the site's
 * pages are about people.
 *
 * That is why the index is on `activityEvents` (see convex/schema.ts) rather
 * than on `motions`, `speeches`, `questions` and the rest. Those five tables
 * hold the same text, but only the feed carries `mpInternalId` on the row
 * itself: searching them would mean five searches, five relevance orderings to
 * merge, and a join through `motionSponsors` to answer "who". Searching the
 * feed is one index, one ordering, and the row that matched already names the
 * person it belongs to.
 *
 * ## Committee names are searched from the other end
 *
 * A committee seat produces no feed event — the pipeline writes
 * `committeeMemberships` and stops — so `Ausschuss für Umwelt` would find
 * nothing through the index no matter how it were folded. `committeeMatches`
 * below therefore scans that table directly for the period and matches names in
 * memory. It is affordable for the reason convex/committees.ts gives: ~1 744
 * rows for a whole Wahlperiode, and only for the current one.
 *
 * ## What this search does and does not do
 *
 * Convex's `searchIndex` was measured on a local deployment before this file
 * was written; lib/search.ts records the results and the reasoning. Three of
 * them shape the code here:
 *
 *  - **`Klima` finds `Klimaschutz` for free.** The final query term is
 *    prefix-matched, so German compounding works in the reader's favour and
 *    needs no stemmer.
 *  - **Umlauts do not fold.** Fixed at index time by storing a folded copy —
 *    `searchText` — with both spellings of every umlauted word. The query is
 *    folded to one spelling to match it.
 *  - **Typos are not tolerated, at all.** `Klimq` finds nothing and nothing
 *    here can change that. The UI says so rather than leaving the reader to
 *    conclude the Bundestag has never discussed the climate.
 *
 * Cross-language matching (`lawyer` → `Rechtsanwalt`) is a hand-written
 * lexicon, lib/thesaurus.ts, run as additional searches whose hits are merged.
 * No translation service and no LLM — both are ruled out for this wave, and a
 * table is auditable in a way neither is.
 */

// --- limits ---------------------------------------------------------------

/**
 * Documents pulled from the search index per term.
 *
 * Below Convex's hard ceiling, which is **1024 scanned documents and an error
 * rather than a truncation** — `.take(1025)` throws
 * "Search query scanned too many documents". A common word like `Gesetz`
 * against a Wahlperiode's feed would reach that ceiling instantly, so the limit
 * is not a nicety: without it the search fails on exactly the queries most
 * likely to be typed.
 *
 * 400 leaves room for the synonym searches to run alongside it inside one
 * query's budget — `MAX_TERMS` of them, each its own scan — while still being
 * far more matches than the ranking needs: an MP's position depends on how many
 * of *their* records matched, and no MP has 400 records about one topic.
 */
const PER_TERM_LIMIT = 400

/**
 * How many searches one request runs: the reader's own, plus synonyms.
 *
 * Each is a separate index scan against the same 1024-document budget, so this
 * is what stops a query like `Klima` — which expands to `climate` — from
 * becoming a dozen scans when a future lexicon entry grows. The reader's own
 * query always runs first, so the terms that are dropped are the least direct.
 */
const MAX_TERMS = 6

/** Matching records kept per MP, as the evidence on their card. Enough to show
 * a pattern rather than a single hit; the count of *all* their matches is
 * reported separately, so a truncated list never reads as the whole of
 * someone's work on a subject. */
const REASONS_PER_MP = 4

/** MPs returned. Above any plausible reading of a result list, and bounded
 * because the caller renders every one of them. */
const MAX_RESULTS = 60

// --- read models ----------------------------------------------------------

/**
 * One record that matched, as shown under an MP's name.
 *
 * This is the "why did this person match" the whole feature turns on. It
 * carries the source record's own words — `title` — rather than a summary,
 * because a reader has to be able to judge the hit: a motion whose title
 * mentions the climate in passing is a different answer from one about it, and
 * only the title lets them tell.
 */
const matchReason = v.object({
  eventType,
  date: v.string(),
  title: v.string(),
  description: v.union(v.null(), v.string()),
  referenceId: v.union(v.null(), v.string()),
  referenceType: v.union(v.null(), v.string()),
})

const searchResult = v.object({
  mpInternalId: v.string(),
  name: v.string(),
  fraktion: v.string(),
  photoUrl: v.union(v.null(), v.string()),
  constituency: v.union(v.null(), v.string()),
  /** What the MP does now, if known — the field Wave 8 added. Shown on the card
   * because a search for `Rechtsanwalt` should display the word it matched. */
  occupation: v.union(v.null(), v.string()),
  /** Every matching record of this MP's, not just the ones listed. See
   * `REASONS_PER_MP`. */
  matchCount: v.number(),
  reasons: v.array(matchReason),
})

// --- committee matching ---------------------------------------------------

/**
 * MPs whose committee name contains the query, with the committee as evidence.
 *
 * A substring test on the folded name rather than an index scan: committees
 * have no feed events (see the header), the table is ~1 744 rows for a period,
 * and the names are long enough that a prefix match on the first word would
 * miss `Ausschuss für Umwelt` for a reader who typed `Umwelt` — which is how
 * anyone refers to it.
 *
 * The folding is `indexableText`'s, applied to both sides through the same
 * function that built the index, so a committee name matches on the same rules
 * a motion title does. `includes` on the joined token string can match across a
 * token boundary — `tumwelt` would find `naturschutz umwelt` — but every needle
 * that reaches here is itself a folded word sequence, so a false positive needs
 * a query that is already a substring spanning two words. That is a card the
 * reader dismisses, not a wrong claim about an MP.
 */
async function committeeMatches(
  ctx: QueryCtx,
  wahlperiode: number,
  needles: readonly string[],
): Promise<Map<string, { committeeName: string; role: string | null }[]>> {
  const rows = await ctx.db
    .query("committeeMemberships")
    .withIndex("by_wahlperiode_and_committeeName", (q) => q.eq("wahlperiode", wahlperiode))
    .collect()

  const hits = new Map<string, { committeeName: string; role: string | null }[]>()
  // Folded once per distinct committee name rather than once per row: the same
  // name repeats across every member of it, up to 98 times (convex/committees.ts).
  const folded = new Map<string, string>()
  for (const row of rows) {
    let text = folded.get(row.committeeName)
    if (text === undefined) {
      text = withSearchText({
        mpInternalId: "",
        eventType: "committee",
        date: "",
        title: row.committeeName,
        description: null,
        referenceId: null,
        referenceType: null,
        wahlperiode,
      }).searchText
      folded.set(row.committeeName, text)
    }
    if (!needles.some((needle) => text.includes(needle))) continue
    const bucket = hits.get(row.mpInternalId) ?? []
    bucket.push({ committeeName: row.committeeName, role: row.role })
    hits.set(row.mpInternalId, bucket)
  }
  return hits
}

// --- the search -----------------------------------------------------------

/**
 * Everyone whose parliamentary record matches `query`, most matches first.
 *
 * `query` arrives already folded — the caller runs `foldSearchQuery` from
 * lib/search.ts, so the browser and the index agree on one spelling without
 * this module importing anything React-adjacent. An empty query returns an
 * empty result rather than the whole chamber: `.search("")` is a query with no
 * terms, and what it returns is not an answer to anything.
 *
 * The filters split three ways, and the split is forced by where each fact
 * lives:
 *
 *  - `wahlperiode` and `eventType` are **index filters**, applied inside the
 *    search before its document cap. That is what keeps a common word from
 *    hitting the 1024 ceiling.
 *  - `fraktion` is applied to the **roster**, after the search, because an
 *    event carries no group — the same constraint convex/feed.ts documents, for
 *    the same reason (§6.4: six WP21 MPs changed group mid-period, and
 *    denormalising it would mean rewriting their whole history).
 *  - `committee` is applied to `committeeMemberships`, because a seat is a row
 *    in another table.
 *
 * ⚠ The result is ordered by **match count**, not by Convex's relevance score.
 * Both were available and match count is the honest one here: relevance ranks
 * *documents*, and this returns people, so the top result under relevance would
 * be whoever happens to own the single best-scoring title rather than whoever
 * works on the subject. Ties break on the roster's own order so the list is
 * stable between renders rather than shuffling on every keystroke.
 */
export const searchMPs = query({
  args: {
    wahlperiode: v.number(),
    /** Folded by the caller — see above. */
    query: v.string(),
    /** Extra folded terms to search alongside `query`. The caller passes the
     * lexicon's expansion; passing it in rather than expanding here keeps this
     * module free of the language table and lets the UI show what it searched
     * for. Capped at `MAX_TERMS` including `query` itself. */
    alsoSearch: v.optional(v.array(v.string())),
    fraktion: v.optional(v.string()),
    committee: v.optional(v.string()),
    eventType: v.optional(eventType),
    limit: v.optional(v.number()),
  },
  returns: v.object({
    results: v.array(searchResult),
    /** Party breakdown of the results — `[{fraktion: "CDU/CSU", count: 3}, …]`,
     * biggest first. Computed here rather than in the browser because it must
     * describe the *whole* result set, and the browser only receives the page. */
    breakdown: v.array(v.object({ fraktion: v.string(), count: v.number() })),
    /** Distinct MPs matched, before `limit`. The list may be shorter. */
    total: v.number(),
    /** True when a term hit `PER_TERM_LIMIT` and the match counts are floors
     * rather than totals. The UI says so: a capped count that reads as exact is
     * a number that quietly understates how much work an MP has done. */
    truncated: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const primary = args.query.trim()
    if (!primary) {
      return { results: [], breakdown: [], total: 0, truncated: false }
    }

    // The reader's own query first, so a lexicon that grows never displaces it.
    const terms = [primary, ...(args.alsoSearch ?? []).filter((term) => term.trim())].slice(
      0,
      MAX_TERMS,
    )

    const kind = args.eventType
    const events = new Map<string, Doc<"activityEvents">>()
    let truncated = false

    for (const term of terms) {
      const rows = await ctx.db
        .query("activityEvents")
        .withSearchIndex("search_text", (s) => {
          const scoped = s.search("searchText", term).eq("wahlperiode", args.wahlperiode)
          return kind === undefined ? scoped : scoped.eq("eventType", kind)
        })
        .take(PER_TERM_LIMIT)
      if (rows.length === PER_TERM_LIMIT) truncated = true
      // Keyed by document id, so a record matching both `Klima` and `climate`
      // counts once. Without this an MP's rank would depend on how many
      // synonyms their titles happen to satisfy rather than on their work.
      for (const row of rows) events.set(row._id, row)
    }

    const committees =
      args.committee === undefined
        ? await committeeMatches(ctx, args.wahlperiode, terms)
        : // A committee filter is already a committee answer: the reader has
          // named one, so every result must sit on it, and the name itself is
          // not what they searched for. Matching names here too would add MPs
          // whose committee merely resembles the query while the filter says
          // they are on a different one.
          new Map<string, { committeeName: string; role: string | null }[]>()

    // Grouped before the roster is read, so the roster lookup is one indexed
    // point read per *matched MP* rather than per matched event.
    const byMp = new Map<string, Doc<"activityEvents">[]>()
    for (const event of events.values()) {
      const bucket = byMp.get(event.mpInternalId) ?? []
      bucket.push(event)
      byMp.set(event.mpInternalId, bucket)
    }
    // An MP matched *only* by their committee has no events, and would
    // otherwise never enter the loop below — which is the whole point of
    // searching committee names separately.
    for (const mpInternalId of committees.keys()) {
      if (!byMp.has(mpInternalId)) byMp.set(mpInternalId, [])
    }

    const roster = await ctx.db
      .query("mps")
      .withIndex("by_wahlperiode_and_fraktion", (q) => q.eq("wahlperiode", args.wahlperiode))
      .collect()
    const mps = new Map(roster.map((mp) => [mp.internalId, mp]))

    const results = []
    for (const [mpInternalId, rows] of byMp) {
      const mp = mps.get(mpInternalId)
      // Dropped rather than shown under its id — the opposite of what
      // convex/feed.ts does with the same case, and deliberately. A feed is a
      // record of things that happened and must not lose an event because its
      // actor is unresolved; this is a list *of people*, and a row with no
      // person is not one of them. §7.3's Stammdaten lag makes it reachable.
      if (!mp) continue
      if (args.fraktion !== undefined && mp.fraktion !== args.fraktion) continue

      const seats = committees.get(mpInternalId) ?? []
      if (args.committee !== undefined) {
        const onCommittee = await ctx.db
          .query("committeeMemberships")
          .withIndex("by_mpInternalId_and_wahlperiode_and_committeeName", (q) =>
            q
              .eq("mpInternalId", mpInternalId)
              .eq("wahlperiode", args.wahlperiode)
              .eq("committeeName", args.committee as string),
          )
          .unique()
        if (!onCommittee) continue
      }

      // Newest first: a reader scanning evidence wants what the MP did lately,
      // and the search has no other date ordering to offer.
      const sorted = [...rows].sort((a, b) => b.date.localeCompare(a.date))
      const reasons = sorted.slice(0, REASONS_PER_MP).map((row) => ({
        eventType: row.eventType,
        date: row.date,
        title: row.title,
        description: row.description,
        referenceId: row.referenceId,
        referenceType: row.referenceType,
      }))

      // A committee seat is evidence too, and it is the only evidence for an MP
      // matched solely that way. Appended after the records rather than mixed
      // in by date: it has no date of its own worth sorting on — the seat is
      // held across the period, not taken on a day.
      for (const seat of seats.slice(0, Math.max(0, REASONS_PER_MP - reasons.length))) {
        reasons.push({
          eventType: "committee" as const,
          date: "",
          title: seat.committeeName,
          description: seat.role,
          referenceId: null,
          referenceType: "committeeMembership",
        })
      }

      results.push({
        mpInternalId,
        name: mp.name,
        fraktion: mp.fraktion,
        photoUrl: mp.photoUrl,
        constituency: mp.constituency,
        occupation: mp.occupation,
        matchCount: rows.length + seats.length,
        reasons,
      })
    }

    results.sort(
      (a, b) =>
        b.matchCount - a.matchCount ||
        // Stable, and in the roster's own order — see the note on the header.
        a.name.localeCompare(b.name, "de"),
    )

    // Over every match, not over the returned page: "3 CDU, 2 SPD" describes
    // the answer, and an answer cut to a page would describe the page.
    const breakdown = new Map<string, number>()
    for (const result of results) {
      breakdown.set(result.fraktion, (breakdown.get(result.fraktion) ?? 0) + 1)
    }

    return {
      results: results.slice(0, pageLimit(args.limit, MAX_RESULTS)),
      breakdown: [...breakdown]
        .map(([fraktion, count]) => ({ fraktion, count }))
        .sort((a, b) => b.count - a.count || a.fraktion.localeCompare(b.fraktion, "de")),
      total: results.length,
      truncated,
    }
  },
})

/**
 * The filter options the /search page can actually offer, for one period.
 *
 * Built from the data rather than from a constant list, which is the rule
 * components/mp-table.tsx and components/rankings-filters.tsx already state: a
 * control offering values nothing matches reads as broken data rather than as
 * an absent field.
 *
 * ⚠ `committees` is empty for every historical Wahlperiode, and that is "not
 * published" rather than "no committees" — §6.4, and the warning
 * convex/committees.ts carries. The UI hides the control rather than showing a
 * chamber that sat on nothing.
 */
export const getSearchFilterOptions = query({
  args: { wahlperiode: v.number() },
  returns: v.object({
    fraktionen: v.array(v.object({ value: v.string(), count: v.number() })),
    committees: v.array(v.string()),
    /** Periods with any roster at all, newest first — the period filter. */
    wahlperioden: v.array(v.number()),
  }),
  handler: async (ctx, args) => {
    const roster = await ctx.db
      .query("mps")
      .withIndex("by_wahlperiode_and_fraktion", (q) => q.eq("wahlperiode", args.wahlperiode))
      .collect()

    const fraktionen = new Map<string, number>()
    for (const mp of roster) {
      fraktionen.set(mp.fraktion, (fraktionen.get(mp.fraktion) ?? 0) + 1)
    }

    const memberships = await ctx.db
      .query("committeeMemberships")
      .withIndex("by_wahlperiode_and_committeeName", (q) => q.eq("wahlperiode", args.wahlperiode))
      .collect()

    // Every period on the roster. Bounded by the number of Wahlperioden, so a
    // full scan is safe here in a way it is not on any other table — the same
    // reasoning `getMPMandates` uses in convex/mps.ts.
    const all = await ctx.db.query("mps").withIndex("by_wahlperiode_and_fraktion").collect()

    return {
      fraktionen: [...fraktionen]
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value, "de")),
      committees: [...new Set(memberships.map((row) => row.committeeName))].sort((a, b) =>
        a.localeCompare(b, "de"),
      ),
      wahlperioden: [...new Set(all.map((mp) => mp.wahlperiode))].sort((a, b) => b - a),
    }
  },
})

// --- backfill -------------------------------------------------------------

/** Rows per backfill slice. Each is one read and one write, so this sits well
 * inside a transaction's budget while keeping the number of round-trips low —
 * the same shape convex/scoreSweep.ts uses, and for the same reason. */
const BACKFILL_BATCH = 200

/**
 * Fills `searchText` on events written before the field existed.
 *
 * Every event written from now on derives it (convex/activityEvents.ts), so
 * this is for the rows already in the deployment — which is all of them, on the
 * day this ships. Until a row has been swept it is absent from search results
 * while remaining correct everywhere else; the schema note explains why that is
 * the failure mode to want.
 *
 * Sliced and resumable rather than one pass: a Wahlperiode's feed is tens of
 * thousands of rows and Convex's write limit is ~8 000 per transaction. The
 * caller loops on `cursor` until `done`. Idempotent — the text is recomputed
 * from the row's own fields, so re-running a slice writes the same value.
 *
 * Exposed over HTTP as `POST /api/pipeline/search/backfill` (convex/http.ts)
 * rather than run from a cron: it is a migration, not routine work, and it
 * needs running once per deployment plus once after any change to the folding
 * rule in lib/search.ts.
 */
export const backfillSearchText = internalMutation({
  args: { cursor: v.optional(v.union(v.null(), v.string())), batch: v.optional(v.number()) },
  returns: v.object({
    updated: v.number(),
    scanned: v.number(),
    done: v.boolean(),
    cursor: v.union(v.null(), v.string()),
  }),
  handler: async (ctx, args) => {
    const page = await ctx.db.query("activityEvents").paginate({
      cursor: args.cursor ?? null,
      numItems: pageLimit(args.batch, BACKFILL_BATCH),
    })

    let updated = 0
    for (const row of page.page) {
      const searchText = withSearchText(row).searchText
      // Skipped when unchanged. Convex would elide the write anyway, but the
      // count is what tells an operator whether a re-run did anything — a
      // second pass reporting thousands of updates would mean the derivation
      // is not deterministic.
      if (row.searchText === searchText) continue
      await ctx.db.patch(row._id, { searchText })
      updated++
    }

    return {
      updated,
      scanned: page.page.length,
      done: page.isDone,
      cursor: page.isDone ? null : page.continueCursor,
    }
  },
})
