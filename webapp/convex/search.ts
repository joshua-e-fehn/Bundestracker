import { v } from "convex/values"
// Relative, not "@/lib/…": convex/tsconfig.json defines no path aliases.
import { occupationFields, occupationOf } from "../lib/bundestag"
import { foldedTextMatches, indexableText } from "../lib/search"
import { OCCUPATION_REFERENCE } from "../lib/taxonomy"
import type { Doc } from "./_generated/dataModel"
import { internalMutation, type QueryCtx, query } from "./_generated/server"
import { withSearchText } from "./activityEvents"
import { pageLimit } from "./lib/ingest"
import { photoFields } from "./mps"
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
 * ## Two things are searched from the other end
 *
 * A committee seat produces no feed event — the pipeline writes
 * `committeeMemberships` and stops — so `Ausschuss für Umwelt` would find
 * nothing through the index no matter how it were folded. `committeeMatches`
 * below therefore scans that table directly for the period and matches names in
 * memory. It is affordable for the reason convex/committees.ts gives: ~1 744
 * rows for a whole Wahlperiode, and only for the current one.
 *
 * **An MP's trade is the same shape of problem, and was the same bug.** The
 * search box says it finds people "by topic, profession or committee"
 * (`search.placeholder`), and the lexicon's largest section is professions —
 * `lawyer` → `rechtsanwalt` is the example lib/thesaurus.ts opens with. But
 * `mps.occupation` and `mps.profession` sit on the roster row, which carries no
 * search index and produces no event, so *neither* word reached anything: a
 * live check measured `lawyer` at 0 results and `Rechtsanwalt` at 5, and those
 * 5 were motion titles that happen to contain the word rather than the lawyers
 * in the chamber. `occupationMatches` closes it, against the same roster read
 * this query already does for every result's name and group — so the recall
 * costs no extra document reads at all.
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
  ...photoFields,
  constituency: v.union(v.null(), v.string()),
  /** What the MP does, if anything is recorded — `occupationOf`'s answer, so
   * the card shows the same line the profile and the roster table do. Shown
   * because a search for `Rechtsanwalt` should display the word it matched;
   * null is *unknown* and renders as nothing rather than as a dash. */
  occupation: v.union(v.null(), v.string()),
  /** Every matching record of this MP's, not just the ones listed. See
   * `REASONS_PER_MP`. */
  matchCount: v.number(),
  reasons: v.array(matchReason),
})

// --- committee matching ---------------------------------------------------

/**
 * Whether any of `needles` matches `text`, on the search index's own rules.
 *
 * `foldedTextMatches` from lib/search.ts — the same module that built the
 * index, so text matched here and text matched by Convex agree about umlauts,
 * about which term is prefix-matched, and about a query needing all of its
 * words. The two in-memory matchers below both go through this rather than
 * through a substring test, which is what stops a keyword being reachable in a
 * committee name and unreachable in a motion title.
 */
function matchesAny(text: string, needles: readonly string[]): boolean {
  return needles.some((needle) => foldedTextMatches(text, needle))
}

/**
 * MPs whose committee name matches the query, with the committee as evidence.
 *
 * An in-memory scan rather than an index scan: committees have no feed events
 * (see the header), the table is ~1 744 rows for a period, and the names are
 * long enough that a prefix match on the first word would miss
 * `Ausschuss für Umwelt` for a reader who typed `Umwelt` — which is how anyone
 * refers to it.
 *
 * The folding is `indexableText`'s, applied to both sides through the same
 * function that built the index.
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
    if (!matchesAny(text, needles)) continue
    const bucket = hits.get(row.mpInternalId) ?? []
    bucket.push({ committeeName: row.committeeName, role: row.role })
    hits.set(row.mpInternalId, bucket)
  }
  return hits
}

/**
 * The roster rows whose recorded trade matches the query, with the words that
 * matched.
 *
 * ## Both fields, not the one the profile prints
 *
 * `occupationFields` (lib/bundestag.ts) is the same precedence rule the label
 * comes from, read whole rather than headfirst. Matching only `occupationOf`'s
 * answer would make recall depend on which source happened to fill first: an
 * MP whose `occupation` reads `MdB` and whose `profession` reads
 * `Rechtsanwältin` is a lawyer nobody could find, and there are enough of them
 * that "occupation is often literally MdB" is a note the profile card already
 * carries. So the *matching* is over every recorded answer and the *label*
 * stays the precedence's head — one rule, read two ways, which is the whole
 * reason the ordering lives in one function.
 *
 * ## The matched word is the evidence, verbatim
 *
 * The card says why an MP is on the list, and for these the reason is a word on
 * their roster row rather than a record. So the *stored* string is returned —
 * `Rechtsanwältin`, as the source spells it, umlaut and all — never the folded
 * token that matched it and never the reader's English query. A card that
 * answered `lawyer` with the word "lawyer" would be asserting a translation the
 * Bundestag never published; the reader sees the German word and the page's
 * `search.alsoSearched` line tells them why it is there.
 *
 * No extra reads: the roster is already collected by the caller for every
 * result's name and group, and this walks the rows it holds.
 */
function occupationMatches(
  roster: readonly Doc<"mps">[],
  needles: readonly string[],
): Map<string, string[]> {
  const hits = new Map<string, string[]>()
  for (const mp of roster) {
    // Absent, null and empty all mean "no trade recorded" and are all dropped
    // by `occupationFields`. An MP with nothing recorded is unknown, so they
    // match nothing here rather than matching a query for an empty string.
    const matched = occupationFields(mp).filter((value) =>
      matchesAny(indexableText(value), needles),
    )
    if (matched.length > 0) hits.set(mp.internalId, matched)
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

    const byMp = new Map<string, Doc<"activityEvents">[]>()
    for (const event of events.values()) {
      const bucket = byMp.get(event.mpInternalId) ?? []
      bucket.push(event)
      byMp.set(event.mpInternalId, bucket)
    }

    const roster = await ctx.db
      .query("mps")
      .withIndex("by_wahlperiode_and_fraktion", (q) => q.eq("wahlperiode", args.wahlperiode))
      .collect()
    const mps = new Map(roster.map((mp) => [mp.internalId, mp]))

    // The whole roster, once, for the reason the header gives: an MP's trade is
    // on their row and produces no event, so the index cannot reach it. Read
    // here rather than in a matcher of its own because this collect already
    // happens — every result needs its name and group from it.
    const occupations = occupationMatches(roster, terms)

    // An MP matched *only* by their committee or their trade has no events, and
    // would otherwise never enter the loop below — which is the whole point of
    // matching either separately.
    for (const mpInternalId of [...committees.keys(), ...occupations.keys()]) {
      if (!byMp.has(mpInternalId)) byMp.set(mpInternalId, [])
    }

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
      const trades = occupations.get(mpInternalId) ?? []
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

      // The trade, likewise dateless and likewise the only evidence for an MP
      // matched solely by it — which is the case this whole path exists for.
      // The stored spelling, not the query: see `occupationMatches`.
      for (const trade of trades.slice(0, Math.max(0, REASONS_PER_MP - reasons.length))) {
        reasons.push({
          // `activity`, the catch-all kind — being a lawyer is not a thing that
          // happened, and `eventType` is the vocabulary of things that did.
          eventType: "activity" as const,
          date: "",
          title: trade,
          description: null,
          referenceId: null,
          referenceType: OCCUPATION_REFERENCE,
        })
      }

      results.push({
        mpInternalId,
        name: mp.name,
        fraktion: mp.fraktion,
        // `?? null` for the same reason as `occupation` below — `photoUrl` is
        // `v.optional` too (convex/schema.ts:202), because the pipeline omits a
        // portrait it did not resolve rather than nulling a stored one.
        photoUrl: mp.photoUrl ?? null,
        photoCredit: mp.photoCredit ?? null,
        constituency: mp.constituency,
        // Through `occupationOf`, not `mp.occupation` alone — the same
        // precedence `occupationMatches` searches over, so the card cannot
        // match on a word it then declines to print. That was the live bug:
        // this read `mps.occupation` while the profile and the table read the
        // fallback too, so the 28 WP21 members with a `profession` and no
        // `occupation` matched a search and showed a blank line under their
        // name.
        //
        // Null where neither source has anything, and null is *unknown* — the
        // card renders nothing at all rather than a dash that would read as a
        // recorded absence. `occupationOf` returns null for absent, for null
        // and for a whitespace-only string, all three of which occur: the
        // columns are `v.optional` (convex/schema.ts:216) because Wave 8 added
        // them to a populated table, so an unenriched MP has no key. An
        // `undefined` here would fail this query's own returns validator and
        // take the whole search down for exactly the members the pipeline has
        // not reached — the outage convex/mps.ts:photoFields documents.
        occupation: occupationOf(mp),
        // The trade counts once per matched field, like a seat counts once.
        // Without it an MP found *only* by their profession would report "0
        // matches" beside four lines of evidence.
        matchCount: rows.length + seats.length + trades.length,
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
 *
 * ## It no longer answers "which periods exist"
 *
 * It used to, as a `wahlperioden` array built from a second full-table scan,
 * because `/search` was the only page with a period control and this was the
 * only query it asked. Now every page has one, and `mps.listPeriods` is the
 * single query behind all of them — so `/search`'s selector offers the same set
 * as `/rankings`' by construction rather than by two scans agreeing.
 *
 * That also removes the second scan: this query is called once per period
 * change and the period list is not period-scoped, so recomputing it here was
 * work proportional to the whole corpus attached to a per-period question.
 */
export const getSearchFilterOptions = query({
  args: { wahlperiode: v.number() },
  returns: v.object({
    fraktionen: v.array(v.object({ value: v.string(), count: v.number() })),
    committees: v.array(v.string()),
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

    return {
      fraktionen: [...fraktionen]
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value, "de")),
      committees: [...new Set(memberships.map((row) => row.committeeName))].sort((a, b) =>
        a.localeCompare(b, "de"),
      ),
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
