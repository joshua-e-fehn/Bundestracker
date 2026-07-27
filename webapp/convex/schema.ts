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
  wahlperiode: v.number(),
  bio: v.union(v.null(), v.string()),
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
   */
  photoUrl: v.union(v.null(), v.string()),
  /** Whose photograph it is, e.g. `Sanae Abdi/SPD-Fraktion`. Written and read
   * as a pair with `photoUrl`: displaying the credit is the licence condition,
   * so a portrait that arrives without one is dropped by the pipeline rather
   * than shown bare. */
  photoCredit: v.union(v.null(), v.string()),
  birthDate: v.union(v.null(), v.string()),
  /** From abgeordnetenwatch (83.4 % of WP21). Stammdaten publishes no
   * education field at all, so this has no official counterpart. */
  education: v.union(v.null(), v.string()),
  /** Stammdaten `BERUF` — the trade practised *before* the mandate (94.3 %). */
  profession: v.union(v.null(), v.string()),
  /** abgeordnetenwatch's `occupation` — what the MP does *now*, which for a
   * sitting member is often `MdB` (88.1 %). Deliberately not merged with
   * `profession`: the two answer different questions and disagree usefully. */
  occupation: v.union(v.null(), v.string()),
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
  contact: v.union(
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
    .index("by_wahlperiode_and_fraktion", ["wahlperiode", "fraktion"]),

  voteSheets: defineTable({ ...voteSheetInput, createdAt: v.number() })
    .index("by_wahlperiode_and_sitzungnr_and_abstimmnr", ["wahlperiode", "sitzungnr", "abstimmnr"])
    // A period's ballots, newest first. Period-scoped in the index: reading by
    // date and filtering the period out afterwards drops ballots past the fetch
    // cutoff, so older periods would just look emptier.
    .index("by_wahlperiode_and_date", ["wahlperiode", "date"])
    // Chamber-wide recency across periods — the home page, not an archive.
    .index("by_date", ["date"]),

  voteRecords: defineTable({ ...voteRecordInput, createdAt: v.number() })
    // One MP votes once per ballot, so this is both the natural key and, by its
    // `voteSheetId` prefix, the "everyone who voted on this" read.
    .index("by_voteSheetId_and_mpInternalId", ["voteSheetId", "mpInternalId"])
    // The other direction: one MP's record, which participation is computed on.
    .index("by_mpInternalId", ["mpInternalId"])
    // "How did this MP's own group vote on this ballot" — see `groupMajority`
    // in convex/votes.ts. Keyed on `partyAtVote` rather than on the roster's
    // current `fraktion` because that is the question: §6.4 records six WP21
    // MPs who changed group mid-period, and a ballot should be read as it was
    // printed. Without this index the tally would read all 630 records of a
    // sheet to look at one group of at most 209 (§9).
    .index("by_voteSheetId_and_partyAtVote", ["voteSheetId", "partyAtVote"]),

  motions: defineTable({ ...motionInput, createdAt: v.number() })
    // Two candidate keys, tried in this order — see the note on `motionInput`.
    .index("by_dipVorgangId", ["dipVorgangId"])
    .index("by_dipDrucksacheId", ["dipDrucksacheId"])
    // Listing, newest first, whole period or a date window inside it.
    .index("by_wahlperiode_and_date", ["wahlperiode", "date"]),

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
    .index("by_mpInternalId_and_protocolDate", ["mpInternalId", "protocolDate"]),

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

  activities: defineTable({ ...activityInput, createdAt: v.number() })
    .index("by_dipAktivitaetId", ["dipAktivitaetId"])
    // The scoring read: one MP's activities inside one period, windowed by
    // date to a month. Prefixes serve the unwindowed and whole-period forms.
    .index("by_mpInternalId_and_wahlperiode_and_date", ["mpInternalId", "wahlperiode", "date"])
    .index("by_wahlperiode_and_date", ["wahlperiode", "date"]),

  activityEvents: defineTable({ ...activityEventInput, createdAt: v.number() })
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
    .index("by_wahlperiode_and_eventType_and_date", ["wahlperiode", "eventType", "date"]),

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
