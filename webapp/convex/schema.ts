import { defineSchema, defineTable } from "convex/server"
import { type Validator, v } from "convex/values"
// Relative, not "@/lib/...": convex/tsconfig.json defines no path aliases.
import type { Locale } from "../lib/i18n"
import type { ScoreComponent } from "../lib/scoring"
import { EVENT_TYPES, type EventType } from "../lib/taxonomy"
import { literalUnion } from "./lib/validators"

/**
 * The application schema.
 *
 * Shaped by docs/api-research.md, which should be read before changing
 * anything here. Four conventions run through the whole file:
 *
 *  - **MPs are referenced by `mpInternalId`, a string, not `v.id("mps")`.**
 *    §7 is the reason: the Bundestag publishes an MP under three incompatible
 *    identifiers — a DIP person id, an 8-digit Stammdaten id, and on the vote
 *    sheets none at all — so Bundestrack mints its own and resolves the others
 *    onto it during ingest (§7.4). The pipeline mints it, so it can build a
 *    batch offline and post it in one request; `v.id("mps")` would make every
 *    row wait on a round-trip for a Convex id it has no other use for.
 *
 *  - **Absent values are `null`, never a missing key.** The pipeline serialises
 *    pydantic models, so every field is present in the JSON, and a required
 *    nullable key means a field it forgot fails the validator rather than being
 *    written as null and quietly meaning something. (`v.optional` still appears
 *    where a *row* legitimately predates a field.)
 *
 *  - **Dates are ISO `YYYY-MM-DD` strings**, so lexicographic order is
 *    chronological and an index range needs no parsing. The sources use
 *    `TT.MM.JJJJ` (§6.2), so converting is the pipeline's job, at the edge.
 *
 *  - **Better Auth's tables are not here.** They live in the component's own
 *    schema, at `convex/betterAuth/schema.ts`. A row belonging to a user
 *    references them by `v.string()` — the Better Auth user id — never by
 *    `v.id("user")`, because there is no local `user` table to name.
 *
 * Every table the pipeline writes carries a natural key with an index over it,
 * so a sync that dies halfway re-runs without duplicating rows. Where that key
 * is not a single external id, the comment on its index says what it is.
 */

// --- shared value types ---------------------------------------------------

/**
 * How one MP voted in one named ballot.
 *
 * These five are the XLSX sheet's one-hot columns (§4.1), exactly one of which
 * was set on every one of the 630 sampled rows. `absent` and `abstain` are
 * deliberately distinct — `nichtabgegeben` is "did not vote", `Enthaltung` is
 * "voted to abstain", and collapsing them would flatter everyone who stayed
 * away. Named ballots only; see convex/votes.ts for what that excludes.
 */
export const vote = v.union(
  v.literal("yes"),
  v.literal("no"),
  v.literal("abstain"),
  v.literal("invalid"),
  v.literal("absent"),
)

/**
 * What kind of parliamentary record an entry in the unified feed came from.
 *
 * Built from `EVENT_TYPES` in lib/taxonomy.ts rather than restated, in the same
 * spirit as `scoreWeights` below being constrained by `SCORE_COMPONENTS`: the
 * feed's filter chips render that list, so a kind the database accepts is a
 * kind the filter can select. Restating it here is how you get an event type
 * that exists in the data and cannot be filtered to.
 *
 * The annotation is what makes that a compile error rather than a convention —
 * a literal dropped from either side stops satisfying `Validator<EventType>`.
 */
export const eventType: Validator<EventType> = literalUnion(EVENT_TYPES)

/**
 * Große Anfrage (`major`) vs Kleine Anfrage (`minor`).
 *
 * A closed union here, unlike `activities.aktivitaetsart` below, because this
 * distinction is constitutional rather than editorial: the two instruments
 * differ in who must answer and how, and there is no third kind.
 */
export const questionType = v.union(v.literal("major"), v.literal("minor"))

/**
 * The reader's language, mirroring `Locale` in lib/i18n.ts.
 *
 * The annotation is the guard, in the same spirit as the `en` dictionary being
 * annotated `Dictionary` there: a locale added to lib/i18n.ts without being
 * added here stops satisfying `Validator<Locale | null>` and fails
 * `pixi run typecheck` at this line, rather than becoming a value the database
 * silently rejects at runtime.
 */
export const preferredLocale: Validator<Locale | null> = v.union(
  v.null(),
  v.literal("de"),
  v.literal("en"),
)

/**
 * The seven inputs to an activity score, each weighted independently.
 *
 * Constrained by `SCORE_COMPONENTS` in lib/scoring.ts rather than restated, so
 * schema, maths and the UI's weight sliders cannot drift: a component added
 * there is a type error here until it is added to both objects below.
 */
export const scoreWeights = v.object({
  motions: v.number(),
  speeches: v.number(),
  questions: v.number(),
  reports: v.number(),
  voteParticipation: v.number(),
  committees: v.number(),
  billSponsorships: v.number(),
} satisfies Record<ScoreComponent, Validator<number>>)

/** One component's contribution: what was measured, what it was multiplied by,
 * and the product. Stored rather than recomputed so a score displayed today can
 * be explained even after the default weights change. */
const scoreComponentBreakdown = v.object({
  raw: v.number(),
  weight: v.number(),
  weighted: v.number(),
})

export const scoreBreakdown = v.object({
  motions: scoreComponentBreakdown,
  speeches: scoreComponentBreakdown,
  questions: scoreComponentBreakdown,
  reports: scoreComponentBreakdown,
  voteParticipation: scoreComponentBreakdown,
  committees: scoreComponentBreakdown,
  billSponsorships: scoreComponentBreakdown,
} satisfies Record<ScoreComponent, typeof scoreComponentBreakdown>)

// --- table field definitions ----------------------------------------------
//
// Plain objects rather than inlined into `defineTable`, so each module builds
// its argument and return validators from the same source and a new field
// reaches the ingestion API without a second edit. Timestamps are excluded: the
// mutation stamps those, so a caller cannot backdate a row or forge
// `updatedAt`.

/**
 * Master MP data — one row per **mandate**, i.e. per (MP, Wahlperiode).
 *
 * Not one row per human, deliberately: `party`, `fraktion`, `constituency`,
 * `electionMethod` and `datesInOffice` all change between periods, and §6.4
 * records six WP21 MPs who changed Fraktion mid-period. `internalId` identifies
 * the human across periods; `(internalId, wahlperiode)` is this table's natural
 * key and identifies the mandate.
 *
 * The split matters for name matching too: zero ambiguous `(surname, forename)`
 * keys *within* WP21 but fifteen across the corpus (§7.2), so scope every join.
 */
export const mpInput = {
  /** The Bundestrack id, minted by the pipeline. Stable across Wahlperioden;
   * every other table references it as `mpInternalId`. See the header note. */
  internalId: v.string(),
  /** 8-digit MdB-Stammdaten `<MDB><ID>`, e.g. `11004011`. Also the protocol
   * XML's `<redner id>` (§5.2), which is what makes speeches joinable. */
  stammdatenId: v.string(),
  /** Short numeric DIP `/person` id, e.g. `1013` — a *different* id for the
   * same person (`GET /person/11004011` is a 404, §7). Null until the name
   * match resolves it, which leaves the MP's DIP activities unattached; that
   * is a visible gap rather than a silent one, so it stays nullable. */
  dipPersonId: v.union(v.null(), v.string()),
  /** Display name, as rendered in the UI. */
  name: v.string(),
  vorname: v.string(),
  nachname: v.string(),
  /** Disambiguator for identical names — `(Fulda)` in `Brand (Fulda)`. Note
   * Stammdaten already includes the parentheses and DIP's `wahlkreiszusatz`
   * does not (§6.2); stored as Stammdaten spells it. */
  ortsZusatz: v.union(v.null(), v.string()),
  /** Name particle: `von`, `van`, `de`. The vote sheets file these under a
   * column headed `Titel`, which does *not* hold academic titles (§4.1). */
  praefix: v.union(v.null(), v.string()),
  /** Party (`CDU`), as distinct from parliamentary group below. */
  party: v.string(),
  /** Parliamentary group, in the short form the vote sheets and DIP use
   * (`CDU/CSU`). Stammdaten spells it out in full; §6.4 warns the two forms
   * need an explicit mapping, which the pipeline applies before writing. */
  fraktion: v.string(),
  /** Wahlkreis name. Null for list MPs, who have no constituency. */
  constituency: v.union(v.null(), v.string()),
  /**
   * The federal state this mandate was won in — Stammdaten's `WKR_LAND`, as
   * published.
   *
   * ## It is not derived from the constituency, and could not be
   *
   * This column replaces a regex that read a trailing `(BW)` off
   * `constituency`. Measured against the real dump (4 614 MDBs, 13 046 mandate
   * rows): **0** `WKR_NAME` values end in a parenthetical, so that rule
   * returned null for every MP who has ever sat, and every "by federal state"
   * filter on the site was inert rather than sparse. Nothing else in the
   * corpus carries the answer — the party does not (every group stands in
   * every Land), and neither does the mandate type.
   *
   * ## Nullable, because the source leaves it empty for a real reason
   *
   * `WKR_LAND` is set on 100 % of `Direktwahl` rows and on most `Landesliste`
   * ones, but 21 of WP21's 635 mandates leave it empty — members who entered
   * on a state list and hold no constituency block at all (no `WKR_NUMMER`,
   * no `WKR_NAME`, no `WKR_LAND`). Those rows carry the Land in `LISTE`
   * instead, and `LISTE` is **not** merged in here: where both are present the
   * two disagree on 2 of 2 583 rows (a member elected on one Land's list for a
   * seat counted in another), so folding them would silently publish a
   * different claim than the one the field name makes. Null means "the source
   * does not state it for this mandate", which the UI renders as absent rather
   * than guessing.
   *
   * ## ⚠ The codes are period-scoped, not a stable enum
   *
   * 35 distinct values across the corpus, because WP1–17 use `BWG`/`NDS`/
   * `NRW`/`THÜ` and WP18–21 the ISO-style `BW`/`NI`/`NW`/`TH` (§6.2). Stored
   * verbatim rather than normalised: mapping them would require a per-period
   * table, and the historical codes name entities that no longer exist as
   * such (`WBB` is Württemberg-Baden). Every filter here is period-scoped
   * already, and builds its options from the data, so a period offers exactly
   * the codes its own members hold.
   *
   * ## Optional in storage, like the enrichment columns above
   *
   * `v.optional` because rows written before this field existed have no key at
   * all, and a required column would fail the deploy against a populated
   * table. Unlike those columns this one *is* re-read in full every run, so
   * the pipeline sends it as an explicit null rather than omitting it — see
   * `mp_payload`. Absent therefore means "written by an older pipeline" and
   * null means "the source is empty here"; both read as unknown, and a roster
   * re-post converts the first into the second.
   */
  federalState: v.optional(v.union(v.null(), v.string())),
  wahlperiode: v.number(),
  bio: v.optional(v.union(v.null(), v.string())),
  /**
   * The MP's official portrait on `bundestag.de`, hotlinked.
   *
   * §6.5 concluded no official bulk source existed and settled for Wikimedia
   * Commons at 36.5 % of WP21; the Bundestag's own MP listing turned out to
   * publish one for **all 639**, of which 635 join to this roster
   * (pipeline `api/mp_profiles.py`). So the initials fallback is now the
   * exception rather than the rule — but it still has to exist, because the
   * four that do not join are real rows.
   *
   * ⚠ Never rehost these. §6.5's licensing warning is the one part of it that
   * still holds: they are photographer-credited works, not open-licensed ones.
   *
   * ⚠ Optional because the upsert is a patch over the keys present, so an
   * ingest that omits this leaves the stored portrait alone where one sent as
   * null would erase it. The pipeline relies on that: it omits every
   * enrichment column it did not resolve this run, rather than reporting an
   * unfetched source as an MP with no photograph. See the ⚠ in
   * `pipeline/.../transform.py:mp_payload`, and `lib/ingest.ts:upsertRow` for
   * the patch semantics this rests on.
   */
  photoUrl: v.optional(v.union(v.null(), v.string())),
  /** Whose photograph it is, e.g. `Sanae Abdi/SPD-Fraktion`. Written and read
   * as a pair with `photoUrl`: displaying the credit is the licence condition,
   * so a portrait that arrives without one is dropped by the pipeline rather
   * than shown bare. */
  photoCredit: v.optional(v.union(v.null(), v.string())),
  birthDate: v.union(v.null(), v.string()),
  /** From abgeordnetenwatch (83.4 % of WP21). Stammdaten publishes no
   * education field at all, so this has no official counterpart. */
  education: v.optional(v.union(v.null(), v.string())),
  profession: v.optional(v.union(v.null(), v.string())),
  /** abgeordnetenwatch's `occupation` — what the MP does *now*, which for a
   * sitting MP is usually a past tense (`Rechtsanwalt`, `Lehrerin`). Distinct
   * from `profession`: the two answer different questions and disagree usefully. */
  occupation: v.optional(v.union(v.null(), v.string())),
  /**
   * How to reach the MP, as the Bundestag actually publishes it.
   *
   * ⚠ **There is no email address and no phone number**, and that is a fact
   * about the sources rather than a gap in the pipeline: `MDB_STAMMDATEN.DTD`
   * declares no contact elements at all, and the biography pages carry no
   * `mailto:` or `tel:` links. `formUrl` is the Bundestag's own substitute — a
   * web form, not an address. An `email` field here would read as one the
   * pipeline had failed to fill.
   *
   * The Berlin office is not stored: it is `Platz der Republik 1` for all 630,
   * so it belongs in the UI as a constant, not in 630 rows.
   */
  contact: v.optional(
    v.union(
      v.null(),
      v.object({
        /** `bundestag.de/services/formular/contactform?mdbId=…`. The `mdbId` is a
         * *fourth* MP id space — bundestag.de's own CMS id — so it stays inside
         * the URL and is never used as a join key. */
        formUrl: v.union(v.null(), v.string()),
        /** Constituency office(s), newline-separated as printed. Roughly half of
         * MPs list none. */
        constituencyOffice: v.union(v.null(), v.string()),
        homepage: v.union(v.null(), v.string()),
        /** `platform` is free text (`Facebook`, `X`, `TikTok`, `Mastodon`…), not
         * an enum: the list is the Bundestag's and it grows. */
        socials: v.array(v.object({ platform: v.string(), url: v.string() })),
      }),
    ),
  ),
  /** `Direktwahl` or `Landesliste` (Stammdaten `MANDATSART`). */
  electionMethod: v.union(v.null(), v.string()),
  /** Mandate span within this Wahlperiode, from `MDBWP_VON`/`MDBWP_BIS`. An
   * open `end` means still serving — that is how §6.2 reconciles 635 rows to
   * the 630 statutory seats, so it must stay distinguishable from a date. */
  datesInOffice: v.union(
    v.null(),
    v.object({ start: v.string(), end: v.union(v.null(), v.string()) }),
  ),
}

/**
 * One named ballot. `(wahlperiode, sitzungnr, abstimmnr)` is the natural key —
 * it is what the XLSX sheet name encodes (§4.1).
 *
 * The tallies are stored as published rather than counted from `voteRecords`,
 * so a partial or failed record ingest shows up as a disagreement instead of
 * silently restating the result of a vote.
 */
export const voteSheetInput = {
  wahlperiode: v.number(),
  sitzungnr: v.number(),
  abstimmnr: v.number(),
  title: v.string(),
  date: v.string(),
  /** Published outcome, e.g. `Annahme der Vorlage`. Free text: DIP's
   * `beschlusstenor` is a string, not an enum (§3.2). */
  result: v.string(),
  yesCount: v.number(),
  noCount: v.number(),
  abstainCount: v.number(),
  invalidCount: v.number(),
  /** `nichtabgegeben` — recoverable only from the XLSX. The protocol XML lists
   * just the MPs who cast a vote (§4.2), so a sheet ingested from XML alone
   * would report every absence as if it never happened. */
  absentCount: v.number(),
  totalEligible: v.number(),
  /** The `bundestag.de/resource/blob/...` XLSX. Null when the ballot was
   * reconstructed from the protocol XML instead, which is also the case where
   * `absentCount` cannot be trusted. */
  sourceUrl: v.union(v.null(), v.string()),
  /**
   * The DIP procedure this ballot decided — the only route from a ballot to
   * anything else DIP publishes about it.
   *
   * The XLSX sheet carries no id of any kind (§4.1, §7): its identity is
   * `(wahlperiode, sitzungnr, abstimmnr)` and nothing more. So a ballot cannot
   * reach the §31 declarations filed on it, because those name a *Vorgang*.
   * This column is that link, resolved at ingest by whatever discovered the
   * ballot rather than joined at query time.
   *
   * `v.optional` because it was added to a populated table, where a required
   * field fails the whole deploy (`bundestrack-convex-schema-deploys`) — and
   * because the three states are genuinely distinct:
   *
   * | value | meaning |
   * |---|---|
   * | a string | this ballot's procedure is known |
   * | `null` | the ballot was ingested and no procedure resolved |
   * | absent | the ballot predates this column |
   *
   * The last two both mean "cannot reach declarations", and neither may be
   * rendered as "none were filed" — see `getExplanationCoverage`, which is what
   * tells an unlinked ballot from an unexplained one.
   */
  dipVorgangId: v.optional(v.union(v.null(), v.string())),
}

export const voteRecordInput = {
  mpInternalId: v.string(),
  voteSheetId: v.id("voteSheets"),
  vote,
  /** Fraktion as printed on the ballot, which is not always the MP's current
   * one — six WP21 MPs changed group mid-period (§6.4). Kept so a historical
   * ballot renders as it was, not as things later became. */
  partyAtVote: v.union(v.null(), v.string()),
  /** The sheet's `Bemerkung`, e.g. `gesetzlicher Mutterschutz` — the published
   * reason an absence was excused. */
  remark: v.union(v.null(), v.string()),
}

/**
 * The ballot's period and date, copied onto the record — the one denormalisation
 * in this schema, and the fix for its single largest read cost.
 *
 * ## Why a copy rather than a join
 *
 * A `voteRecords` row carried neither, so *every* per-MP question about votes
 * had to recover them from the sheet: `.withIndex("by_mpInternalId")` — an index
 * with no period column — collected the member's records across **all**
 * Wahlperioden, then resolved each one through `ctx.db.get(record.voteSheetId)`
 * to find out which period and month it belonged to, and discarded most of them.
 *
 * That is an unbounded scan and an N+1 on top of it, and the deployment measured
 * both: the sweep of 2026-07-27 read 10 270 `voteRecords` **and** 10 245
 * `voteSheets` for 25 members — a 1:1 ratio, which is one `db.get` per record
 * made visible, and 64 % of the whole transaction. `internalId` is stable across
 * periods by construction (see `mpInput`), so this is not a corner case: the
 * cost is the member's whole career every time anyone asks about one month of it.
 *
 * With these two columns the same question is one index range —
 * `by_mpInternalId_and_wahlperiode_and_date` — bounded by exactly the period and
 * window asked for, and the sheet is never fetched. Measured against a real
 * Convex backend on a 250-record fixture: **500 documents read → 100.**
 *
 * ## Why it cannot go stale
 *
 * The pair is *derived at write time* from the sheet the record is being
 * attached to, and `upsertVoteRecords` already holds that sheet — it looks it up
 * by natural key to get the `voteSheetId` in the first place, so this costs no
 * additional read. A record cannot be written without its sheet (the mutation
 * throws), and a sheet's `wahlperiode`/`sitzungnr`/`abstimmnr` are its natural
 * key, so the period cannot change under an existing record without becoming a
 * different ballot. The date can be corrected by a re-ingest, and a re-ingest
 * rewrites the records too, through the same code path.
 *
 * Deliberately **not** part of `voteRecordInput`: the pipeline must not be able
 * to assert that a vote happened in a period other than its ballot's. Same
 * construction, and the same reasoning, as `dissentFields` below and
 * `searchText` on `activityEvents`.
 *
 * ## ⚠ `v.optional`, and the deploy ordering that depends on it
 *
 * Required fields on a populated table fail the whole deploy
 * (`bundestrack-convex-schema-deploys`). Absent means "written before this
 * branch", which is exactly what `backfillVoteRecordScope` selects on: an index
 * range with `.eq("wahlperiode", undefined)` matches the un-migrated rows and
 * nothing else — verified against a real backend, and it is why the migration
 * needs no cursor over the whole table.
 *
 * Until that backfill has run, an un-migrated row is **missing** from every
 * period-scoped read rather than mis-attributed. `voteScopeCoverage` reports the
 * remaining count so the gap is measured rather than assumed.
 */
const voteRecordScopeFields = {
  /** The ballot's `wahlperiode`. See the note above: derived, never posted. */
  wahlperiode: v.optional(v.number()),
  /** The ballot's ISO `YYYY-MM-DD` date, so a month window is an index range
   * rather than a fetch of every sheet the member ever voted in. */
  date: v.optional(v.string()),
}

/**
 * Whether this record went against its group's line — decided at ingest, stored
 * on the row.
 *
 * ## Why this is stored rather than derived on read
 *
 * Dissent is a property of a *ballot*, not of a record: it exists only relative
 * to how the other ~209 members of the group voted in the same division. So
 * answering it on read costs a group-scoped scan per record, which is why
 * `getVotesByMP` caps itself at 25 rows and why `getCrossPartyRankings` could
 * only ever report the last 20 ballots — ~630 records each against Convex's
 * ~16 000-document read limit. A period-wide figure is not a bigger version of
 * that query; it is the same answer computed once, when the ballot lands, by the
 * one caller that already holds all 630 of its records.
 *
 * **Derived, never posted.** `refreshBallotDissent` in convex/votes.ts writes
 * these from `tallyByGroup`/`isRebel`, the same functions the ballot page and the
 * profile page apply — so the stored flag cannot disagree with the rendered one.
 * They are deliberately absent from `voteRecordInput` for that reason: a payload
 * carrying `dissent: true` would let the pipeline assert a claim about a named
 * person's conduct that no group tally supports. Same construction, and same
 * reasoning, as `searchText` on `activityEvents`.
 *
 * These flags are the **only** thing a ballot refresh writes, and that is the
 * whole of the write-partitioning fix: a ballot's records are disjoint from
 * every other ballot's, so two refreshes running at once cannot conflict. The
 * period roll-up is derived from these flags afterwards, keyed by member — see
 * `dissentTallyInput`.
 *
 * `v.optional` because they were added to a populated table — a required field
 * there fails the whole deploy (`bundestrack-convex-schema-deploys`). Absent
 * means "not yet computed", which is distinct from `false`: `backfillDissent`
 * fills them in slices, and until it has run those ballots are missing from the
 * tally rather than counted as loyal votes.
 */
const dissentFields = {
  /** True where the MP cast a vote that was not their group's line. Never true
   * for an absence, for a group with no line, or for a record with no group —
   * see `isRebel`, which is where all three exclusions live. */
  dissent: v.optional(v.boolean()),
  /**
   * Whether this record is in the *denominator*: a vote cast, in a group that
   * had a line to keep.
   *
   * Not the same as `dissent === false`, and conflating them is the mistake this
   * field exists to prevent. An absence and a vote in an evenly-split group are
   * both `dissent: false`, and neither belongs in "ballots on which this member
   * could have dissented" — counting them would inflate the denominator with
   * ballots that had no line, quietly deflating every rate on the site.
   */
  dissentCounted: v.optional(v.boolean()),
}

/**
 * One member's dissent across a whole electoral period — the roll-up
 * `getCrossPartyRankings` reads instead of re-tallying every ballot.
 *
 * One row per `(mpInternalId, wahlperiode)`, maintained by
 * `recomputeDissentTallies` in convex/votes.ts from that member's own
 * `voteRecords` — a per-MP scan bounded by the corpus (§4.4: ~1 015 named
 * ballots in the Bundestag's entire history), not by the chamber. That is the
 * asymmetry the whole table turns on: reading *one* member's record set is
 * cheap and reading *every* member's is not, so the leaderboard becomes a
 * 630-row index scan.
 *
 * ## ⚠ Recomputed from the flags, never incremented — and one member per
 * transaction
 *
 * A tally that added `+1` per dissent would double-count every re-ingest, and
 * the pipeline re-ingests by design (a daily sync re-reads anything whose
 * `aktualisiert` moved, §2.5). So each row is *derived*: read this member's
 * flagged records for the period, count them, write the answer. Re-running is a
 * no-op rather than a corruption, and a retry after a conflict cannot
 * double-apply, because there is nothing to apply — only a value to arrive at.
 *
 * That is also what removes the contention. The delta form had to be applied by
 * whoever computed it, which meant the *ballot* refresh wrote here: one
 * transaction reading and patching up to 630 rows, so two ballots refreshed
 * concurrently overlapped on every member in the chamber and every one of them
 * overlapped with the leaderboard's 630-row read. Deriving instead means the
 * writer is keyed by member: `recomputeDissentTallies` takes a slice of MPs and
 * writes only those rows, so two concurrent slices touch **disjoint** documents
 * by construction. `dissentWriteKeys` in convex/votes.ts is that invariant,
 * asserted in convex/votes.test.ts rather than left to hold by inspection.
 */
export const dissentTallyInput = {
  mpInternalId: v.string(),
  wahlperiode: v.number(),
  /** Ballots in this period voted against the own group's line. */
  dissents: v.number(),
  /** Cast votes in a group that had a line — the denominator. Below the member's
   * participation count, because a ballot where their group split exactly has no
   * line to break. See `dissentCounted`. */
  ballotsCast: v.number(),
  /** `dissents / ballotsCast`, or 0 when nothing was cast. Stored so the
   * leaderboard can sort on it without recomputing 630 divisions, and so the
   * index below can carry it. ⚠ A stored 0 here is ambiguous where
   * `dissentRate` in lib/dissent.ts returns null — read `ballotsCast` to tell
   * "never dissented" from "never voted". */
  dissentRate: v.number(),
}

/**
 * Motions and bills.
 *
 * Both DIP ids are nullable because a record reaches Bundestrack by either
 * route — a Vorgang (the procedure) or a Drucksache (the paper) — and rarely
 * both. At least one must be present or the row has no identity and every sync
 * would insert it again; `motions.ts` enforces that rather than the schema,
 * which cannot express "one of these two".
 */
export const motionInput = {
  dipVorgangId: v.union(v.null(), v.string()),
  dipDrucksacheId: v.union(v.null(), v.string()),
  /** Printed paper number, `21/7327`. Bundestag-issued papers only — §5.1
   * warns Bundesrat numbering is a bare running number that any `split("/")`
   * misparses, which is why the pipeline passes `f.zuordnung=BT`. */
  drucksacheNr: v.union(v.null(), v.string()),
  title: v.string(),
  /** `drucksachetyp`, e.g. `Kleine Anfrage`, `Gesetzentwurf`. */
  type: v.union(v.null(), v.string()),
  date: v.string(),
  wahlperiode: v.number(),
  vorgangstyp: v.union(v.null(), v.string()),
}

/**
 * Who put their name to a motion — a table, not an array on `motions`, because
 * DIP truncates `autoren_anzeige` at four entries (§3.4) so sponsors arrive one
 * at a time from `/aktivitaet`. See convex/motions.ts.
 */
export const motionSponsorInput = {
  motionId: v.id("motions"),
  mpInternalId: v.string(),
  /** e.g. `Erstunterzeichner`, `Mitunterzeichner`. Free text. */
  role: v.union(v.null(), v.string()),
}

/**
 * One speech segment: the words one MP said in one sitting, in one turn.
 *
 * A segment, **not** a `<rede>` element — one `<rede>` can hold several
 * distinct speakers, and `wordCount` rather than the row count is what scoring
 * uses. Both are §5.2 findings with consequences; convex/speeches.ts explains
 * them where the parsing contract lives.
 */
export const speechInput = {
  mpInternalId: v.string(),
  /** DIP `/plenarprotokoll` id. Null when the speech was parsed from a
   * protocol XML that has not been matched to its DIP record. */
  protocolId: v.union(v.null(), v.string()),
  protocolDate: v.string(),
  wahlperiode: v.number(),
  sitzungnr: v.number(),
  /** Position of this segment within the sitting, in document order. Part of
   * the natural key — see the index note on the table. */
  speechIndex: v.union(v.null(), v.number()),
  /** Words attributed to this speaker in this segment. Excludes `<kommentar>`
   * (applause and heckling *by other people*) and the `klasse="redner"` header
   * paragraph, per the extraction rule in §5.2. */
  wordCount: v.union(v.null(), v.number()),
  /** Agenda context, e.g. `Tagesordnungspunkt 22`. */
  topic: v.union(v.null(), v.string()),
}

export const questionInput = {
  mpInternalId: v.string(),
  subject: v.string(),
  date: v.string(),
  wahlperiode: v.number(),
  type: questionType,
}

/**
 * Committee seats — one row per (MP, Wahlperiode, committee), which is what
 * stops a chair (listed twice in Stammdaten, §6.3) counting as two seats.
 *
 * ⚠ Current Wahlperiode only: historical committee membership is published
 * nowhere (§6.4). See convex/committees.ts, which carries what that means for
 * any metric built on it.
 */
export const committeeMembershipInput = {
  mpInternalId: v.string(),
  committeeName: v.string(),
  /** `Ordentliches Mitglied`, `Stellvertretendes Mitglied`, `Vorsitzender`,
   * `Obmann`… Full members and substitutes are cleanly separated in the source,
   * which is what lets scoring avoid over-crediting a substitute seat. */
  role: v.union(v.null(), v.string()),
  wahlperiode: v.number(),
  /** `MDBINS_VON`/`MDBINS_BIS`, day-level. An open `endDate` means serving. */
  startDate: v.union(v.null(), v.string()),
  endDate: v.union(v.null(), v.string()),
}

/**
 * A committee referral — DIP `Ueberweisung`, attached to a procedure step
 * (§3.3).
 *
 * ## ⚠ What this is not
 *
 * A referral names a **committee and a document**. It carries no person, and
 * there is no field on it, anywhere, from which one could be derived. So it is
 * **not** committee membership and **not** an individual MP's committee work —
 * `committeeMemberships` above is the only source for either, and §6.4 records
 * that it publishes the current period alone.
 *
 * That distinction is the entire reason this table is separate rather than
 * more rows in `committeeMemberships`. api-research.md §3.3 calls `Ueberweisung`
 * "the committee-work signal", which overstates it: it is a signal about which
 * committees a *bill* was sent to, which is a fact about the procedure. Storing
 * the two in one table would make a historical period look as though its
 * committee membership had been recovered, when what was recovered is a
 * different claim about different subjects.
 *
 * ## Coverage, measured
 *
 * Present on WP18–21 plenary steps at 4.8 %–9.7 % of positions (2026-07-29,
 * date-windowed samples of 300–600 positions per period). It does **not** rescue
 * the historical committee gap: it starts where DIP's own coverage does, and it
 * answers a question about bills either way.
 *
 * One row per `(dipVorgangspositionId, committeeName)` — a step refers a bill to
 * three or four committees at once, exactly one of them leading.
 */
export const committeeReferralInput = {
  /** DIP `/vorgangsposition` id — the step that made the referral, and the
   * natural key's first half. */
  dipVorgangspositionId: v.string(),
  /** The procedure the step belongs to, so a referral can be shown beside the
   * motion it concerns. Null where DIP omitted it. */
  dipVorgangId: v.union(v.null(), v.string()),
  /** `Ausschuss für Gesundheit`. Verbatim, never folded onto
   * `committeeMemberships.committeeName`: committee names are re-cut between
   * periods, and matching them would assert a continuity the source does not. */
  committeeName: v.string(),
  /** `AfG`. Present on every referral sampled, but nullable — it is the
   * source's abbreviation, not a key. */
  committeeAbbreviation: v.union(v.null(), v.string()),
  /** `federfuehrung` — the lead committee, as opposed to the co-advising ones.
   * Exactly one per step in every sample. Null is preserved rather than
   * defaulted to `false`: "not stated" and "not the lead" are different claims
   * and only the source may make either. */
  leadCommittee: v.union(v.null(), v.boolean()),
  /**
   * `ueberweisungsart`.
   *
   * ⚠ **Always null in practice.** Measured across every period sampled on
   * 2026-07-29: 0 of 754 referrals carried a value. The column exists because
   * the field exists in the DIP schema and a value appearing later should land
   * somewhere rather than be dropped — not because anything can be read off it
   * today.
   */
  referralType: v.union(v.null(), v.string()),
  /** The step's own kind — `Beratung`, `1. Beratung`, `Ausschussüberweisung`,
   * `Überweisung gemäß § 93 Geschäftsordnung BT`. What distinguishes a plenary
   * referral from the EU-document route. */
  positionKind: v.union(v.null(), v.string()),
  /** The bill or paper referred, as printed — `21/220`. */
  documentNumber: v.union(v.null(), v.string()),
  title: v.string(),
  date: v.string(),
  wahlperiode: v.number(),
}

/**
 * An MP's own declared reason for how they voted — `Erklärung nach § 31 GO-BT`.
 *
 * ## Why this exists at all, and what it is not
 *
 * A named ballot's *subject* is its title, and Bundestrack already stores that
 * on `voteSheets`. A **reason** is a different thing, and the Geschäftsordnung
 * provides for exactly one: under §31 a member may put on the record why they
 * voted as they did. DIP publishes each one as an `/aktivitaet` whose
 * `aktivitaetsart` is `Schriftliche Erklärung gem. § 31 Geschäftsordnung BT`,
 * carrying the member's `person_id` and a `vorgangsbezug` naming the procedure
 * — which is what makes it linkable to the ballot rather than merely adjacent
 * to it.
 *
 * **The text is not stored, and no text is generated.** DIP publishes the
 * declaration's *existence*, its author, and a page-anchored PDF link into the
 * protocol; it does not publish the prose as a field. So a row here says "this
 * member filed a declaration on this ballot, and here is the official page it
 * is printed on". Anything more would be Bundestrack asserting a reason on a
 * named person's behalf, which is the one thing this feature must never do.
 *
 * ## Coverage, measured 2026-07-29
 *
 * Per protocol: 21/90 → 20 declarations against 8 named ballots, 3 of which
 * carry one; 21/89 → 3 / 1 of 1; 20/214 → 48 / 2 of 2; 19/239 → 78 / 1 of 1.
 * `person_id` was present on 100 % in every sample. So this is sparse by nature
 * — most ballots have none — and the UI must read an absent declaration as
 * "none was filed", never as "not yet ingested".
 *
 * One row per `(dipAktivitaetId)`: DIP emits one record per member per
 * declaration, which is already the grain.
 */
export const voteExplanationInput = {
  /** DIP activity id — the natural key, and what makes re-ingest an upsert. */
  dipAktivitaetId: v.string(),
  mpInternalId: v.string(),
  /** The procedure the declaration is about, from `vorgangsbezug[0].id`. This is
   * the join to the ballot: a `voteSheets` row reached through the same Vorgang
   * is the ballot being explained. */
  dipVorgangId: v.union(v.null(), v.string()),
  /** The referenced procedure's title — what was voted on, as DIP prints it.
   * Not a reason, and the query contract keeps the two apart. */
  subject: v.union(v.null(), v.string()),
  /** `Schriftliche Erklärung gem. § 31 Geschäftsordnung BT`, verbatim. Stored
   * rather than assumed because the string has already drifted once: this repo
   * and api-research.md both recorded it as `§ 31 GO BT`, which matches nothing
   * the API returns. */
  aktivitaetsart: v.string(),
  /** The protocol page the declaration is printed on, as a deep link —
   * `…/21090.pdf#P.11246`. The provenance a reader can check, and the only
   * route to the actual words. */
  sourceUrl: v.union(v.null(), v.string()),
  /** Protocol reference, `21/90`. */
  protocolNumber: v.union(v.null(), v.string()),
  date: v.string(),
  wahlperiode: v.number(),
}

/**
 * The per-MP activity backbone, from DIP `/aktivitaet` — one record per MP per
 * action, carrying `person_id` directly, so it needs no name matching (§3.5).
 */
export const activityInput = {
  /** DIP activity id. The natural key, and the reason this table is the
   * cheapest of all to re-sync. */
  dipAktivitaetId: v.string(),
  mpInternalId: v.string(),
  /**
   * ⚠ An open string, **not** an enum, and deliberately so.
   *
   * §3.5: the spec types it as a bare `string` with no enum and no catalogue
   * endpoint, and the values seen in research are a sample of 80 537 records.
   * A closed union would reject unknown kinds at the door; a closed mapping
   * downstream would score them at zero, which is worse. See the header of
   * convex/activities.ts and `bucketFor` in lib/scoring.ts.
   */
  aktivitaetsart: v.string(),
  vorgangId: v.union(v.null(), v.string()),
  date: v.string(),
  wahlperiode: v.number(),
  description: v.union(v.null(), v.string()),
}

/**
 * The unified feed — every kind of parliamentary record, in one timeline.
 *
 * Denormalised on purpose: rendering an MP's page should be one indexed range
 * scan, not seven. `referenceType`/`referenceId` point back at the row this was
 * derived from, which is also what makes re-deriving the feed idempotent.
 */
export const activityEventInput = {
  mpInternalId: v.string(),
  eventType,
  date: v.string(),
  title: v.string(),
  description: v.union(v.null(), v.string()),
  /** Identifier of the source row, in whatever id space `referenceType` names —
   * a Convex id for a motion, a DIP id for an activity. Null for an event with
   * no source row, which is also an event that cannot be de-duplicated; see
   * `addActivityEvent`. */
  referenceId: v.union(v.null(), v.string()),
  /** Which table or id space `referenceId` belongs to. */
  referenceType: v.union(v.null(), v.string()),
  wahlperiode: v.number(),
}

/**
 * `title` and `description`, folded for the keyword search.
 *
 * Derived, never posted: `addOne` in convex/activityEvents.ts computes it with
 * `indexableText` from lib/search.ts on every write, so it cannot disagree with
 * the fields it is derived from and the pipeline needs no change to populate
 * it. It is deliberately **not** part of `activityEventInput` for that reason —
 * an ingestion payload carrying it would let a caller store text that finds
 * records not matching what they say.
 *
 * `v.optional` rather than required, and this is the one place in the schema
 * where that is not about a row predating a field in the ordinary sense: rows
 * written before this branch have no value, and the backfill in
 * convex/search.ts fills them in slices. Until it has run they are absent from
 * search results while remaining correct everywhere else, which is the failure
 * mode to want — the alternative, a required field, would reject every existing
 * row on its next upsert.
 *
 * Why the folding is needed at all, rather than indexing `title` directly:
 * Convex's search index folds case and nothing else — measured, not assumed —
 * so `fur` does not match `für` and `Strauss` does not match `Strauß`. On a
 * German corpus that is most of the misses. lib/search.ts carries the
 * measurement and the reasoning.
 */
export const searchText = v.optional(v.string())

/**
 * Computed scores, one row per (MP, Wahlperiode, month).
 *
 * `month` is `YYYY-MM`, or **null for the whole Wahlperiode**: the monthly rows
 * are the contribution-graph cells, the null row is the period total the
 * rankings sort on. Both are recomputed together, so neither is ever a stale
 * sum of the other.
 *
 * Every count here is a *recorded* count, not an activity count — the three
 * limits that makes structural are set out in lib/scoring.ts and belong in the
 * UI, not only in a comment.
 */
export const activityScoreInput = {
  mpInternalId: v.string(),
  wahlperiode: v.number(),
  month: v.union(v.null(), v.string()),
  motionCount: v.number(),
  speechCount: v.number(),
  /**
   * Words spoken — the input the speech score actually uses.
   *
   * Not in addition to `speechCount` for completeness: `speechCount` is
   * displayable but unrankable (§5.2), so the score needs a measure that a
   * minister answering thirty question-time queries cannot inflate. Both are
   * stored, only this one is weighted.
   */
  speechWordCount: v.number(),
  questionCount: v.number(),
  reportCount: v.number(),
  /** Share of named ballots in scope where the MP cast any vote — `yes`, `no`,
   * `abstain` or `invalid`, but not `absent`. 0…1, and 0 when no ballot fell in
   * the window, which the UI must render as "no votes" rather than "never
   * turned up". */
  voteParticipationRate: v.number(),
  committeeCount: v.number(),
  billSponsorshipCount: v.number(),
  totalScore: v.number(),
  scoreBreakdown,
}

/**
 * Synthetic hemicycle seating.
 *
 * ⚠ **No machine-readable seat assignment exists anywhere** (§9), so these rows
 * are generated from Fraktion sizes on a standard parliament arc: a
 * visualisation, not a record of where anyone sits. The table name says
 * `Assignments`, which is exactly why convex/seating.ts spells out what it does
 * not mean.
 */
export const seatingAssignmentInput = {
  mpInternalId: v.string(),
  wahlperiode: v.number(),
  seatLabel: v.string(),
  faction: v.string(),
  row: v.union(v.null(), v.number()),
  column: v.union(v.null(), v.number()),
}

// --- schema ---------------------------------------------------------------

const schema = defineSchema({
  mps: defineTable({ ...mpInput, createdAt: v.number(), updatedAt: v.number() })
    // The natural key. Its `internalId` prefix also answers "every mandate this
    // person has held", which is the one cross-period question worth asking.
    .index("by_internalId_and_wahlperiode", ["internalId", "wahlperiode"])
    // Resolving a protocol XML `<redner id>` to a mandate (§5.2). Scoped by
    // period because a Stammdaten id spans all of them.
    .index("by_stammdatenId_and_wahlperiode", ["stammdatenId", "wahlperiode"])
    // Resolving a DIP `/aktivitaet.person_id` the same way. Its null arm lists
    // the mandates the name match has not resolved, which §7.3 says to retry.
    .index("by_dipPersonId_and_wahlperiode", ["dipPersonId", "wahlperiode"])
    // The roster, whole or by group. No separate `by_fraktion`: group names
    // repeat across periods, so a Fraktion only means something inside one.
    .index("by_wahlperiode_and_fraktion", ["wahlperiode", "fraktion"])
    /**
     * The roster in a **stable, seekable order** — what a sweep walks.
     *
     * `recomputeScores` slices the roster by offset, and an offset must be
     * scanned to: `.take(cursor + batchSize + 1)` re-reads every member already
     * scored, so the reads a whole sweep spends on paging grow with the square
     * of the roster. Measured against a real backend on 600 rows: a slice of 8
     * at offset 0 costs 9 documents and the same slice at offset 500 costs
     * **509**. Across a 635-member sweep at 8 per slice that is ~25 000 `mps`
     * rows read to page through 635.
     *
     * Keyed on `internalId` because the seek needs a column that is unique
     * within the period and totally ordered, which `fraktion` is neither —
     * `.gt("fraktion", x)` would skip every remaining member of a group
     * mid-slice. With this index a slice is `.gt("internalId", last)` and costs
     * `batchSize + 1` documents wherever it starts.
     *
     * `internalId` is also what a caller can *compute*: `scripts/score-period.py`
     * shards a period across workers, and it can only do that if slice
     * boundaries are derivable from the roster it already reads rather than
     * discovered one response at a time. That is why the sweep's cursor is a
     * member id and not an opaque `.paginate()` token, which is O(page) too but
     * cannot be synthesised.
     */
    .index("by_wahlperiode_and_internalId", ["wahlperiode", "internalId"]),

  voteSheets: defineTable({ ...voteSheetInput, createdAt: v.number() })
    .index("by_wahlperiode_and_sitzungnr_and_abstimmnr", ["wahlperiode", "sitzungnr", "abstimmnr"])
    // A period's ballots, newest first. Period-scoped in the index: reading by
    // date and filtering the period out afterwards drops ballots past the fetch
    // cutoff, so older periods would just look emptier.
    .index("by_wahlperiode_and_date", ["wahlperiode", "date"])
    // Chamber-wide recency across periods — the home page, not an archive.
    .index("by_date", ["date"]),

  voteRecords: defineTable({
    ...voteRecordInput,
    ...voteRecordScopeFields,
    ...dissentFields,
    createdAt: v.number(),
  })
    // One MP votes once per ballot, so this is both the natural key and, by its
    // `voteSheetId` prefix, the "everyone who voted on this" read.
    .index("by_voteSheetId_and_mpInternalId", ["voteSheetId", "mpInternalId"])
    /**
     * One MP's votes **inside one period, inside one date window** — the read
     * every scoring and profile query actually wants, and the one this table
     * could not previously express.
     *
     * The three columns are the three questions asked together: whose vote, in
     * which Bundestag, when. Its `(mpInternalId, wahlperiode)` prefix answers
     * the period-total form and its `(mpInternalId)` prefix the career form, so
     * this one index replaces `by_mpInternalId` for every caller rather than
     * sitting beside it — see `voteRecordScopeFields` for why the columns exist
     * and what a missing one means.
     *
     * ⚠ The un-migrated rows sort **first**, not last: Convex orders `undefined`
     * below every other value (`values/compare.ts` ranks it 0, beneath `null`).
     * So a range with `.eq("wahlperiode", N)` excludes them cleanly, and a range
     * with `.eq("wahlperiode", undefined)` selects exactly them — which is what
     * makes the backfill a bounded index read rather than a table scan.
     */
    .index("by_mpInternalId_and_wahlperiode_and_date", ["mpInternalId", "wahlperiode", "date"])
    // The other direction: one MP's whole record across every period. Kept for
    // `purgeSeedData`, which deletes a synthetic member's rows and must see the
    // ones the backfill has not reached — an un-migrated row is invisible to a
    // period-scoped range by design, and a purge that missed it would leave a
    // vote behind while reporting the member gone.
    .index("by_mpInternalId", ["mpInternalId"])
    /**
     * The migration's own cursor, and the only reason it needs no cursor.
     *
     * `wahlperiode` leads, so `.eq("wahlperiode", undefined)` is a range over
     * *exactly* the rows the scope backfill has not reached — Convex sorts a
     * missing field below every value, so they are a contiguous prefix — and a
     * migrated row leaves the range by being written. `backfillVoteRecordScope`
     * therefore just asks for the next slice until there is none, and a crashed
     * run resumes by being run again. `voteScopeCoverage` reads the same range
     * to report what remains.
     *
     * The MP-keyed index above cannot serve this: an index range must fix its
     * fields in order, so selecting on `wahlperiode` there would mean naming a
     * member first — one query per member rather than one for the table.
     *
     * ⚠ Not an alternative to `voteSheets.by_wahlperiode_and_date`. This one is
     * over *records*, which is ~630 rows per ballot; nothing reads a period's
     * records in bulk through it, and nothing should.
     */
    .index("by_wahlperiode_and_date", ["wahlperiode", "date"])
    // "How did this MP's own group vote on this ballot" — see `groupMajority`
    // in convex/votes.ts. Keyed on `partyAtVote` rather than on the roster's
    // current `fraktion` because that is the question: §6.4 records six WP21
    // MPs who changed group mid-period, and a ballot should be read as it was
    // printed. Without this index the tally would read all 630 records of a
    // sheet to look at one group of at most 209 (§9).
    .index("by_voteSheetId_and_partyAtVote", ["voteSheetId", "partyAtVote"]),

  dissentTallies: defineTable({
    ...dissentTallyInput,
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    // The natural key, and the profile page's read: one member, one period.
    .index("by_mpInternalId_and_wahlperiode", ["mpInternalId", "wahlperiode"])
    // The leaderboard, off the index already sorted — the whole reason this
    // table exists. `dissents` rather than `dissentRate` is the trailing column
    // because the board ranks on the count (see `getCrossPartyRankings`); the
    // rate rides along on the row rather than being a second index, since 630
    // rows re-sort in memory for free once they have been read.
    .index("by_wahlperiode_and_dissents", ["wahlperiode", "dissents"]),

  motions: defineTable({ ...motionInput, createdAt: v.number() })
    // Two candidate keys, tried in this order — see the note on `motionInput`.
    .index("by_dipVorgangId", ["dipVorgangId"])
    .index("by_dipDrucksacheId", ["dipDrucksacheId"])
    // Listing, newest first, whole period or a date window inside it.
    .index("by_wahlperiode_and_date", ["wahlperiode", "date"])
    /**
     * The same listing narrowed to one procedure kind — what `/motions`' filter
     * pages over.
     *
     * Two indexes and not one, for the reason `by_wahlperiode_and_eventType_and_date`
     * exists on `activityEvents`: a page taken from the mixed list and then
     * filtered by kind comes back short, and a short page is indistinguishable
     * from "there are no more". This table makes that failure worse than the
     * feed does. `Schriftliche Frage` is 44 % of a WP21 sample and 71 % of a
     * WP20 one, so a reader filtering to `Antrag` after the fact would page
     * through hundreds of empty results before the first match — and conclude
     * the Bundestag tabled none.
     *
     * `vorgangstyp` is nullable, and a null sorts below every value rather than
     * being excluded, so the null rows occupy their own contiguous range here.
     * `getMotionFilterOptions` deliberately does not offer them as a filter
     * value: an unrecorded kind is not a kind. They remain reachable through
     * the unfiltered index above, which is where an unfiltered read belongs.
     */
    .index("by_wahlperiode_and_vorgangstyp_and_date", ["wahlperiode", "vorgangstyp", "date"]),

  motionSponsors: defineTable({ ...motionSponsorInput, createdAt: v.number() })
    .index("by_motionId_and_mpInternalId", ["motionId", "mpInternalId"])
    .index("by_mpInternalId", ["mpInternalId"]),

  speeches: defineTable({ ...speechInput, createdAt: v.number() })
    // The natural key; its `(wahlperiode, sitzungnr)` prefix is the sitting-wide
    // scan that re-ingesting a parsed protocol runs.
    .index("by_wahlperiode_and_sitzungnr_and_mpInternalId_and_speechIndex", [
      "wahlperiode",
      "sitzungnr",
      "mpInternalId",
      "speechIndex",
    ])
    // One MP's speeches over time — the profile page.
    .index("by_mpInternalId_and_protocolDate", ["mpInternalId", "protocolDate"])
    /**
     * The same read, scoped to one Bundestag — what `speechVolume` needs.
     *
     * `wahlperiode` is a *required* column on this table, so unlike
     * `voteRecords` above this index needs no migration: every existing row
     * already carries the value, and Convex backfills the index itself on
     * deploy.
     *
     * The index above cannot answer this. It is keyed by date alone after the
     * MP, so scoring had to collect the member's speeches and drop the wrong
     * period in JS (`speechVolume`) — which is bounded by a date window for a
     * *month* and by nothing at all for a period total, whose window is
     * `1949-01-01…2999-12-31`. That read is the member's entire career, and it
     * is the one scoring input that keeps growing: WP18 alone adds 245
     * protocols against WP21's 90.
     *
     * Both indexes stay. This one serves scoring; `by_mpInternalId_and_protocolDate`
     * serves `getSpeechesByMP`, which wants the newest page across periods and
     * explains at its call site why filtering after the take is safe there.
     */
    .index("by_mpInternalId_and_wahlperiode_and_protocolDate", [
      "mpInternalId",
      "wahlperiode",
      "protocolDate",
    ]),

  questions: defineTable({ ...questionInput, createdAt: v.number() })
    // No external id exists for a question, so the key is behavioural: this
    // narrows to one MP's questions that day, and `subject` picks one out.
    .index("by_mpInternalId_and_wahlperiode_and_date", ["mpInternalId", "wahlperiode", "date"])
    .index("by_wahlperiode_and_date", ["wahlperiode", "date"]),

  committeeMemberships: defineTable({ ...committeeMembershipInput, createdAt: v.number() })
    // The natural key; its `(mpInternalId, wahlperiode)` prefix is "this MP's
    // committees", which is what `committeeCount` counts.
    .index("by_mpInternalId_and_wahlperiode_and_committeeName", [
      "mpInternalId",
      "wahlperiode",
      "committeeName",
    ])
    // The other direction: the membership of one committee.
    .index("by_wahlperiode_and_committeeName", ["wahlperiode", "committeeName"]),

  committeeReferrals: defineTable({ ...committeeReferralInput, createdAt: v.number() })
    // The natural key. A step refers a bill to three or four committees at
    // once, so the step id alone is not unique — see the note on the input.
    .index("by_dipVorgangspositionId_and_committeeName", ["dipVorgangspositionId", "committeeName"])
    // "Which committees was this bill sent to" — the motion-side read, and the
    // only one a motion page needs.
    .index("by_dipVorgangId", ["dipVorgangId"])
    // A period's referrals, and one committee's within it. Period-scoped in the
    // index rather than filtered afterwards, for the reason `voteSheets` gives:
    // taking N by date and dropping the wrong period returns short pages that
    // read as a quieter parliament.
    .index("by_wahlperiode_and_committeeName_and_date", ["wahlperiode", "committeeName", "date"]),

  voteExplanations: defineTable({ ...voteExplanationInput, createdAt: v.number() })
    // The natural key — DIP already emits one record per member per
    // declaration.
    .index("by_dipAktivitaetId", ["dipAktivitaetId"])
    // The ballot-page read: every declaration filed on this procedure. Scoped
    // by period because a Vorgang id is unique but the query that reaches it
    // knows the ballot's period and should not read outside it.
    .index("by_wahlperiode_and_dipVorgangId", ["wahlperiode", "dipVorgangId"])
    // One member's declarations — the profile side.
    .index("by_mpInternalId_and_wahlperiode_and_date", ["mpInternalId", "wahlperiode", "date"]),

  activities: defineTable({ ...activityInput, createdAt: v.number() })
    .index("by_dipAktivitaetId", ["dipAktivitaetId"])
    // The scoring read: one MP's activities inside one period, windowed by
    // date to a month. Prefixes serve the unwindowed and whole-period forms.
    .index("by_mpInternalId_and_wahlperiode_and_date", ["mpInternalId", "wahlperiode", "date"])
    .index("by_wahlperiode_and_date", ["wahlperiode", "date"]),

  activityEvents: defineTable({ ...activityEventInput, searchText, createdAt: v.number() })
    // The profile feed, and its type-filtered form. Two indexes rather than one
    // filtered in memory: `.take(n)` then filtering drops matching rows past
    // the cutoff instead of erroring, so a busy MP's "speeches only" tab would
    // quietly go empty rather than paginate.
    .index("by_mpInternalId_and_date", ["mpInternalId", "date"])
    .index("by_mpInternalId_and_eventType_and_date", ["mpInternalId", "eventType", "date"])
    // De-duplication. Keyed on the source row rather than on the MP, because
    // one motion produces one event per sponsor: the match set is bounded by a
    // motion's signatory count, and `addActivityEvent` picks its own MP out of
    // it.
    .index("by_eventType_and_referenceId", ["eventType", "referenceId"])
    // Triple-key lookup so addOne can find an existing row in O(1) instead of
    // scanning all events for a referenceId (which can be 600+ for a vote).
    .index("by_eventType_and_referenceId_and_mpInternalId", [
      "eventType",
      "referenceId",
      "mpInternalId",
    ])
    // The chamber-wide feed.
    .index("by_wahlperiode_and_date", ["wahlperiode", "date"])
    // Its type-filtered form, for the same reason the per-MP pair above is two
    // indexes and not one: a page taken from the mixed feed and then filtered
    // by kind comes back short, and a short page is indistinguishable from
    // "there are no more". Chamber-wide the effect is worse than per-MP —
    // Kleine Anfragen dominate the feed (§3.5), so filtering to a rarer kind
    // would empty the first page and read as "no committee work happened".
    // convex/feed.ts is the consumer.
    .index("by_wahlperiode_and_eventType_and_date", ["wahlperiode", "eventType", "date"])
    /**
     * The keyword search — motion titles, speech topics, question subjects and
     * committee names, all of which are already denormalised onto this table.
     *
     * On `activityEvents` rather than on the five source tables, and that is
     * the central decision of convex/search.ts: the product's answer is an
     * **MP**, not a document, so a search over `motions` would still have to
     * join `motionSponsors` to say who — while this table already carries
     * `mpInternalId` on every row. One index instead of five, one relevance
     * ordering instead of five merged, and the row that matched is the row that
     * says why.
     *
     * `filterFields` are the two the /search page filters on that the index can
     * apply *before* its document cap. That cap is the reason they are here:
     * a search index errors at 1024 scanned documents rather than truncating
     * (measured — see lib/search.ts), so a common word against a period's whole
     * feed has to be narrowed by the index, not afterwards. `wahlperiode`
     * carries the period filter; `eventType` carries "motions only".
     *
     * ⚠ Fraktion and committee are **not** filter fields and cannot be: neither
     * belongs to an event. The group belongs to the MP and changes mid-period
     * (§6.4), and a committee seat is a row in another table entirely. Both are
     * applied after the fact, in convex/search.ts, which is the same split
     * convex/feed.ts documents for the same reason.
     */
    .searchIndex("search_text", {
      searchField: "searchText",
      filterFields: ["wahlperiode", "eventType"],
    }),

  activityScores: defineTable({
    ...activityScoreInput,
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_mpInternalId_and_wahlperiode_and_month", ["mpInternalId", "wahlperiode", "month"])
    // Rankings come off the index already sorted: fix the period and the month,
    // read `totalScore` descending. Sorting in memory would mean collecting all
    // 630 MPs to return the top ten.
    .index("by_wahlperiode_and_month_and_totalScore", ["wahlperiode", "month", "totalScore"]),

  seatingAssignments: defineTable({ ...seatingAssignmentInput, createdAt: v.number() })
    .index("by_mpInternalId_and_wahlperiode", ["mpInternalId", "wahlperiode"])
    // Rendering the arc, whole chamber or one bloc.
    .index("by_wahlperiode_and_faction", ["wahlperiode", "faction"]),

  /**
   * What a signed-in user has chosen. The only table here a browser writes to,
   * and the only one carrying personal data.
   *
   * `userId` is the Better Auth user id as `v.string()` — see the header note.
   * It is never accepted as an argument; `userPreferences.ts` reads it from the
   * session, because an argument would let any signed-in user rewrite anyone's
   * preferences by supplying their id.
   */
  userPreferences: defineTable({
    userId: v.string(),
    /** Per-component weights overriding the defaults in lib/scoring.ts. Null
     * means "use the defaults" — distinct from a saved set that happens to
     * match them, which must survive a change to those defaults. */
    customWeights: v.union(v.null(), scoreWeights),
    /** Followed MPs, as `mps.internalId` values. */
    followedMpIds: v.array(v.string()),
    preferredLocale,
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_userId", ["userId"]),
})

export default schema
