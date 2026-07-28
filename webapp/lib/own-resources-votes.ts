/**
 * Ballots in which the Bundestag voted on its own resources.
 *
 * Money and rules that flow to the people casting the vote: members' pay,
 * party financing, the party-aligned political foundations, staff allowances,
 * transitional payments and pensions, and the electoral law that decides who
 * holds a seat at all. The interest here is structural rather than an
 * accusation — a parliament is the only body that can set its own terms, and
 * that is exactly why the record of it deserves to be findable in one place
 * instead of scattered through a corpus of several hundred divisions.
 *
 * ## ⚠ This is a curated editorial list, not a query
 *
 * No Bundestag dataset carries a "self-interest" flag. There is no field in
 * DIP, in the XLSX sheets or in the protocol XML that says a ballot was about
 * the chamber's own resources, so this is a judgement made by a human reading
 * titles — the same class of claim as `RULED_OUT` in lib/inquiry.ts and
 * `GOVERNING_PARTIES` in lib/seating.ts, and it carries the same apparatus:
 * an explicit rationale per entry, a review date the page prints, and a
 * statement of what was deliberately left out.
 *
 * The **ballots themselves are entirely factual** — every one is a real named
 * division, and the tallies shown come from the published sheet, not from here.
 * What this file contributes is only the selection and the reason for it. That
 * separation is the point: a reader who disagrees with the framing can still
 * check every number against bundestag.de.
 *
 * ## Why a module and not a schema field
 *
 * A `selfDealing` boolean on `voteSheets` would put an editorial judgement into
 * the database, where the pipeline would have to preserve it across every
 * re-ingest and where nothing would record *why* a ballot carries it. It would
 * also be invisible to review: a flag flipped in a mutation leaves no diff. As
 * a module the list is version-controlled, reviewable line by line, and each
 * entry states its own grounds — and the schema stays what it is everywhere
 * else, a transcription of what the Bundestag published.
 *
 * Keyed by the natural key `(wahlperiode, sitzungnr, abstimmnr)` rather than by
 * Convex document id, and that is deliberate: §4.1 says the sheet name encodes
 * exactly that triple, so the key survives a re-ingest that rebuilds the table
 * and assigns new `_id`s. A list of `_id`s would silently empty itself the
 * first time the corpus was reloaded.
 *
 * Nothing here imports from `convex/` or from React — it is read by the browser
 * and could be read inside Convex's V8 runtime, the same constraint
 * lib/taxonomy.ts and lib/inquiry.ts carry.
 */

/**
 * What kind of own-resources question a ballot put.
 *
 * Coarse on purpose. A finer taxonomy would invite entries to be added because
 * a category exists rather than because the ballot belongs, which is the
 * failure mode of every curated list.
 */
export const OWN_RESOURCE_TOPICS = [
  /** Members' pay, allowances, transitional payments, pensions. */
  "pay",
  /** State money to the parties themselves (Parteiengesetz). */
  "party-financing",
  /** The party-aligned political foundations. */
  "foundations",
  /** Who gets a seat: electoral law, seat allocation, election scrutiny. */
  "electoral-law",
] as const

export type OwnResourceTopic = (typeof OWN_RESOURCE_TOPICS)[number]

/** One curated ballot: its natural key, why it is here, and what it decided. */
export type OwnResourceVote = {
  wahlperiode: number
  sitzungnr: number
  abstimmnr: number
  topic: OwnResourceTopic
  /**
   * Why this ballot is in the collection, in one sentence, as a translation key
   * pair.
   *
   * A key rather than a German string, because the rationale is the part a
   * reader most needs in their own language — a curated list that explains
   * itself only in German is not a bilingual page, it is a German page with
   * English furniture.
   */
  rationaleKey: OwnResourceRationaleKey
}

/** The rationale keys, spelled out so a typo is a compile error rather than a
 * `{votes.ownResources.…}` printed on the page. lib/i18n.ts holds the strings;
 * this module may not import from it (see the header). */
export type OwnResourceRationaleKey =
  | "votes.ownResources.rationale.parteiengesetz20"
  | "votes.ownResources.rationale.stiftungsfinanzierung20"
  | "votes.ownResources.rationale.wahlrecht20"
  | "votes.ownResources.rationale.wahlrechtBundeswahlgesetz20"
  | "votes.ownResources.rationale.wahlpruefung20"
  | "votes.ownResources.rationale.wahlrecht21"
  | "votes.ownResources.rationale.wahlpruefung21"

/**
 * The curated ballots, newest first.
 *
 * ## What is here
 *
 * Every entry was checked against the ingested corpus by its natural key, and
 * every one is a division the Bundestag actually held. The two clearest cases
 * — the Parteiengesetz amendment and the Stiftungsfinanzierungsgesetz — are
 * literally the chamber legislating money to its own parties and their
 * foundations. The electoral-law entries are here because who holds a seat is
 * the most fundamental of a parliament's own resources: the 2023 Bundeswahl-
 * gesetz reform cut the chamber's own size and abolished the
 * Grundmandatsklausel, and MPs voting on it were voting on whether seats like
 * theirs would continue to exist.
 *
 * ## ⚠ What is *not* here, and why that matters
 *
 * **No ballot on members' pay (Diäten / Abgeordnetenentschädigung) appears in
 * this collection, because none exists in the corpus.** That is not an
 * oversight and it is not evidence of concealment — it is how the pay rule
 * works. Since the 2014 reform (§11 Abgeordnetengesetz) members' pay is
 * **indexed automatically** to the federal nominal-wage index published by the
 * Statistisches Bundesamt, and adjusts each year without a vote. There is
 * therefore usually no division to record. The page states this rather than
 * leaving a reader to conclude from an absent section that the votes were
 * hidden — an empty category is a finding only if you know why it is empty.
 *
 * Also excluded: ballots that merely *mention* a Fraktion in their title
 * ("Antrag der Fraktion der CDU/CSU"). That is a sponsor, not a subject, and a
 * keyword sweep that kept them would fill this collection with ordinary policy
 * votes and destroy the only thing it is for.
 */
export const OWN_RESOURCE_VOTES: readonly OwnResourceVote[] = [
  {
    // "Antrag zur Reform des Wahlrechts", 2026-07-02.
    wahlperiode: 21,
    sitzungnr: 91,
    abstimmnr: 2,
    topic: "electoral-law",
    rationaleKey: "votes.ownResources.rationale.wahlrecht21",
  },
  {
    // "Zurückweisung von Einsprüchen gegen die Bundestagswahl", 2025-12-18.
    wahlperiode: 21,
    sitzungnr: 50,
    abstimmnr: 1,
    topic: "electoral-law",
    rationaleKey: "votes.ownResources.rationale.wahlpruefung21",
  },
  {
    // "01.02.2024: Änderung des Bundeswahlgesetzes".
    wahlperiode: 20,
    sitzungnr: 151,
    abstimmnr: 1,
    topic: "electoral-law",
    rationaleKey: "votes.ownResources.rationale.wahlrechtBundeswahlgesetz20",
  },
  {
    // "Änderung des Parteiengesetzes", 2023-12-15.
    wahlperiode: 20,
    sitzungnr: 145,
    abstimmnr: 4,
    topic: "party-financing",
    rationaleKey: "votes.ownResources.rationale.parteiengesetz20",
  },
  {
    // "10.11.2023: Stiftungsfinanzierungsgesetz".
    wahlperiode: 20,
    sitzungnr: 135,
    abstimmnr: 1,
    topic: "foundations",
    rationaleKey: "votes.ownResources.rationale.stiftungsfinanzierung20",
  },
  {
    // "17.03.2023: Änderung des Bundeswahlgesetzes" — the reform itself.
    wahlperiode: 20,
    sitzungnr: 92,
    abstimmnr: 1,
    topic: "electoral-law",
    rationaleKey: "votes.ownResources.rationale.wahlrecht20",
  },
  {
    // "10.11.2022: Einsprüche anlässlich der Wahl zum 20. Deutschen Bundestag".
    wahlperiode: 20,
    sitzungnr: 66,
    abstimmnr: 9,
    topic: "electoral-law",
    rationaleKey: "votes.ownResources.rationale.wahlpruefung20",
  },
]

/**
 * When this list was last checked against the corpus and the political record.
 *
 * Rendered on the page rather than kept in a comment, for the reason
 * `RULED_OUT_AS_OF` gives in lib/inquiry.ts: a maintained fact with no date is
 * a maintained fact nobody can tell is stale. A reader who finds a ballot from
 * after this date missing knows the list is behind rather than wrong.
 */
export const OWN_RESOURCE_VOTES_AS_OF = "2026-07"

/** The natural key as one string, for matching a sheet against the list. Built
 * by one function so the two sides cannot disagree about the separator. */
export function ballotKey(ballot: {
  wahlperiode: number
  sitzungnr: number
  abstimmnr: number
}): string {
  return `${ballot.wahlperiode}:${ballot.sitzungnr}:${ballot.abstimmnr}`
}

/** The curated entry for a ballot, or null if it is not in the collection. */
export function ownResourceVote(ballot: {
  wahlperiode: number
  sitzungnr: number
  abstimmnr: number
}): OwnResourceVote | null {
  const key = ballotKey(ballot)
  return OWN_RESOURCE_VOTES.find((entry) => ballotKey(entry) === key) ?? null
}

/** Whether a ballot is in the collection. */
export function isOwnResourceVote(ballot: {
  wahlperiode: number
  sitzungnr: number
  abstimmnr: number
}): boolean {
  return ownResourceVote(ballot) !== null
}

/** The periods the collection draws on, newest first — what the page has to
 * fetch. Derived rather than restated so adding an entry from a new period
 * cannot leave the page fetching the wrong ones. */
export function ownResourcePeriods(): number[] {
  return [...new Set(OWN_RESOURCE_VOTES.map((entry) => entry.wahlperiode))].sort((a, b) => b - a)
}

/** The topic labels, as translation keys. A table rather than branches at the
 * render site, and the guard that a topic added above without a string is a
 * compile error rather than a missing label. */
export const OWN_RESOURCE_TOPIC_KEYS = {
  pay: "votes.ownResources.topic.pay",
  "party-financing": "votes.ownResources.topic.partyFinancing",
  foundations: "votes.ownResources.topic.foundations",
  "electoral-law": "votes.ownResources.topic.electoralLaw",
} as const satisfies Record<OwnResourceTopic, string>
