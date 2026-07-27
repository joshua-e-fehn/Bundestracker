/**
 * The Untersuchungsausschuss quorum: the arithmetic, and the one political fact
 * it needs that no Bundestag dataset carries.
 *
 * ## The two halves of this page, and why they must stay visibly apart
 *
 * Article 44(1) of the Grundgesetz obliges the Bundestag to set up a committee
 * of inquiry **on the motion of a quarter of its members**. That makes the whole
 * question arithmetic over seat counts — and seat counts are the one seating
 * fact §9 of docs/api-research.md says *is* derivable, by counting the roster
 * (`mps.getFractionSizes`). Everything in `quorumThreshold`, `combinations` and
 * `reaches` is therefore backed by a Bundestag record, exactly like the rest of
 * this site.
 *
 * `RULED_OUT` is not. Who refuses to work with whom is a political fact stated
 * in speeches and party congress resolutions, and it appears in no dataset the
 * pipeline ingests. It is here for the same reason `GOVERNING_PARTIES` is in
 * lib/seating.ts — the page is unreadable without it — and under the same
 * discipline: a hand-maintained constant, dated, with a caveat the reader sees
 * rather than a footnote they might not.
 *
 * The separation is load-bearing rather than tidy. The site's premise is that
 * every figure is checkable against an official record; a page that mixed a
 * counted seat total with an editorial claim about intentions, and presented
 * both in one colour, would spend that premise on a page that did not need to.
 * So `QuorumCombination` carries `reaches` (counted) and `blocked` (maintained)
 * as separate fields all the way to the renderer, and the renderer marks them
 * differently. Nothing in this module collapses the two into one verdict.
 *
 * ## ⚠ The finding is about the *opposition*, not about the chamber
 *
 * The obvious version of this page — "which combinations reach a quarter" — has
 * a misleading answer, and the arithmetic is worth stating because a first draft
 * of it shipped the wrong claim and a test caught it.
 *
 * In WP21 the CDU/CSU holds 208 of 630 seats. That is **above** the 158-seat
 * quarter on its own, and the governing coalition (CDU/CSU + SPD, 328) clears it
 * twice over. So "can a quarter be assembled?" answers *yes*, several ways, and
 * a page that stopped there would report that this Bundestag can freely
 * establish committees of inquiry.
 *
 * That answer is true and useless. Art. 44(1) is a **minority** right: its point
 * is that a quarter can investigate *the government* without the government's
 * consent, and a majority that already controls the chamber has no need of it. A
 * governing group is not going to compel an inquiry into itself, so its seats
 * cannot substitute for the opposition's.
 *
 * The real question is therefore whether the **opposition** can reach a quarter,
 * and there the numbers bind hard:
 *
 *     AfD 152 + Grüne 85 + Linke 64 = 301  — clears 158, but every other group
 *                                            has ruled out the AfD
 *     Grüne 85 + Linke 64           = 149  — nine seats short of 158
 *
 * Nine seats. That is the whole finding, and it is invisible on a page that
 * averages over the chamber. So `quorumSummary` computes both scopes and the
 * page leads with the opposition one — `oppositionShortfall` is the number the
 * argument turns on.
 *
 * Which groups govern is itself a maintained fact (`GOVERNING_PARTIES` in
 * lib/seating.ts), so the scope split inherits that caveat rather than
 * introducing a second one. Where a period's coalition is unrecorded the role is
 * `unknown` and the opposition scope is reported as unavailable rather than
 * guessed — the same refusal `coalitionRole` already makes.
 *
 * ## Why this is a lib module and not just a Convex query
 *
 * Same reason lib/seating.ts holds the arc: this is the part that can be wrong
 * without looking wrong. A threshold off by one, a combination list that quietly
 * skips a pair, an exclusion matrix that is asymmetric because one direction was
 * entered and the other forgotten — each renders as a perfectly plausible table.
 * A test catches those; an eye does not. `convex/inquiry.ts` reads the roster and
 * calls in here, so the numbers on the page and the numbers under test are
 * computed by the same code.
 */

import { type FractionSize, foldFractionSizes, type PartyKey, partyFor } from "./parties"
import { type CoalitionRole, coalitionRole, seatingRank } from "./seating"

// --- the constitutional rule ----------------------------------------------

/**
 * The share of members whose motion compels an inquiry: a quarter.
 *
 * Art. 44(1) GG: *"Der Bundestag hat das Recht und auf Antrag eines Viertels
 * seiner Mitglieder die Pflicht, einen Untersuchungsausschuss einzusetzen."*
 * The obligation is the point — a quarter cannot be outvoted on whether the
 * inquiry happens, which is what makes this a minority right rather than a
 * majority procedure, and why the exact threshold is worth computing rather
 * than approximating.
 */
export const QUORUM_SHARE = 1 / 4

/**
 * The number of members whose signatures meet the quarter.
 *
 * `ceil`, and this is the one line on the page where the rounding direction is
 * a legal question rather than a display choice. "A quarter of its members" is a
 * floor on the *signatories*: a quarter of 630 is exactly 158 (157.5 rounded
 * up), and 157 members are fewer than a quarter however the number is written.
 * `floor` would publish a threshold that does not in fact compel anything, which
 * is the failure mode this function exists to avoid — a chamber of 631 would
 * report 157 when 158 are needed.
 *
 * Exact quarters are unaffected: `Math.ceil(632 / 4)` is 158, not 159, because
 * 158 already *is* a quarter. Only a fractional quarter rounds up, which is the
 * behaviour the rule describes.
 *
 * Returns 0 for an empty chamber rather than 1: no members means no motion, and
 * a threshold of one signature on a chamber with nobody in it would be a claim
 * about a parliament that does not exist. The page renders the empty roster as
 * empty instead.
 */
export function quorumThreshold(totalSeats: number): number {
  if (!Number.isFinite(totalSeats) || totalSeats <= 0) return 0
  return Math.ceil(totalSeats * QUORUM_SHARE)
}

// --- ⚠ the maintained political fact ---------------------------------------

/**
 * Declared refusals to cooperate, as of **July 2026**.
 *
 * ⚠ **Not from any Bundestag dataset.** This is the only editorial claim on the
 * page. §9 of docs/api-research.md lists what the sources carry — motions,
 * speeches, ballots, committee seats, the roster — and a party's stated refusal
 * to work with another is not among them, any more than a coalition is (see
 * `GOVERNING_PARTIES` in lib/seating.ts, which this deliberately mirrors).
 *
 * The claims recorded here, and what each rests on:
 *
 *  - **Every group has ruled out cooperation with the AfD.** The most firmly
 *    established entry: the CDU's 2018 Hamburg party-congress resolution and its
 *    repeated reaffirmations, and equivalent standing positions from the SPD,
 *    the Grüne and Die Linke.
 *  - **The CDU/CSU has ruled out cooperation with Die Linke**, under the same
 *    resolution, which names both.
 *  - **Die Linke has ruled out cooperation with the CDU/CSU**, recorded as the
 *    matching entry rather than assumed: the refusal is mutual and stated on
 *    both sides, and inferring one direction from the other is precisely the
 *    kind of shortcut this table must not take.
 *
 * ## What is deliberately *not* recorded
 *
 * The SPD's relationship with Die Linke is contested rather than settled — the
 * federal "Unvereinbarkeitsbeschluss" was lifted long ago, state-level
 * coalitions exist, and what remains is reluctance rather than a declared bar.
 * Recording it as a refusal would state something firmer than the record
 * supports, and this table's whole value is that a reader can trust it not to.
 * The BSW is absent for a simpler reason, and the one the page turns on: it
 * holds no seats in this Bundestag, so it has no seats to contribute to any
 * quorum and no row to appear in.
 *
 * ## Shape
 *
 * Stored as declared, one entry per direction, and read through `hasRuledOut`,
 * which checks **both** directions. That is not redundancy: a refusal is
 * politically one-sided (a party can refuse another that has said nothing), but
 * its *effect on a joint motion* is symmetric — a motion needs both signatures,
 * so either refusal alone is enough to block it. Storing declarations as made
 * and symmetrising at the point of use keeps the record honest and the
 * arithmetic right; symmetrising the data instead would put words in a party's
 * mouth.
 */
export const RULED_OUT: Readonly<Record<PartyKey, readonly PartyKey[]>> = {
  "cdu-csu": ["afd", "linke"],
  spd: ["afd"],
  gruene: ["afd"],
  linke: ["afd", "cdu-csu"],
  fdp: ["afd"],
  afd: [],
  // Not a party and not a bloc: `fraktionslos` is the set of members who belong
  // to no group. They cannot collectively rule anything out, and — see
  // `eligibleGroups` — they cannot collectively sign anything either.
  fraktionslos: [],
  unknown: [],
}

/** When the table above was last checked against the political record. Rendered
 * on the page rather than kept in a comment: a maintained fact with no date is a
 * maintained fact nobody can tell is stale. */
export const RULED_OUT_AS_OF = "2026-07"

/**
 * Whether a joint motion by these two groups is blocked by a declared refusal.
 *
 * Symmetric by construction — see the note on `RULED_OUT`. A group is not
 * blocked with itself: a single Fraktion large enough to reach the quarter needs
 * nobody's agreement, and reporting it as self-blocked would be nonsense the
 * combination table would then render.
 */
export function hasRuledOut(a: PartyKey, b: PartyKey): boolean {
  if (a === b) return false
  return RULED_OUT[a].includes(b) || RULED_OUT[b].includes(a)
}

/** Every declared refusal involving `party`, in `SEATING_ORDER`. Both directions
 * are folded in, so the page's per-group summary matches the matrix beside it
 * rather than listing only what that group itself declared. */
export function refusalsOf(party: PartyKey): PartyKey[] {
  const stated = RULED_OUT[party]
  const received = (Object.keys(RULED_OUT) as PartyKey[]).filter((other) =>
    RULED_OUT[other].includes(party),
  )
  return [...new Set([...stated, ...received])].sort(
    (a, b) => partyOrderRank(a) - partyOrderRank(b),
  )
}

/** A party key's place on the left-right axis, via the arc's own ordering, so
 * the tables here read in the same order as the chamber on /seating. Takes a key
 * where `seatingRank` takes a Fraktion string — `partyFor` is idempotent on the
 * canonical labels, but routing a key through a string round trip would be the
 * round trip `partyKeyColor` exists to avoid. */
function partyOrderRank(key: PartyKey): number {
  return seatingRank(key === "cdu-csu" ? "CDU/CSU" : key)
}

// --- the chamber, as this page counts it -----------------------------------

/** One group's standing in the chamber: its seats, and what share of the whole
 * they are. `share` is derived rather than left to the renderer so the table and
 * the combination list cannot round it differently. */
export type QuorumGroup = {
  party: PartyKey
  /** The Fraktion string as stored, for a label and a colour — `partyLabel`
   * renders an unrecognised group as itself rather than as a dash. */
  fraktion: string
  seats: number
  /** `seats / totalSeats`, 0…1. */
  share: number
  /** Whether this group alone meets the quarter. True for the CDU/CSU in WP21 —
   * which is exactly why the page cannot stop at the chamber-wide scope. See
   * the module header. */
  reachesAlone: boolean
  /** Whether these seats can be part of a motion at all — see `eligibleGroups`. */
  eligible: boolean
  /** ⚠ Government or opposition, from `GOVERNING_PARTIES` — a maintained fact,
   * like the exclusions. `unknown` for a period whose coalition this codebase
   * does not record, which propagates to an unavailable opposition scope rather
   * than to a guess. */
  role: CoalitionRole
}

/**
 * The roster's groups, folded, ordered left to right, with shares.
 *
 * Folded through `foldFractionSizes` because `getFractionSizes` groups by the
 * stored spelling and production really does return `Fraktionslos` and
 * `fraktionslos` as two rows (§6.4, §5.2). Unfolded, a group's seats would be
 * split across two rows and *neither half* would be tested against the
 * threshold — the one arithmetic error on this page that would understate a
 * bloc rather than merely look untidy.
 *
 * Ordered by `seatingRank` rather than by size, so this table and the hemicycle
 * on /seating present the chamber in the same order. A reader moving between the
 * two is looking at one parliament.
 */
export function quorumGroups(
  sizes: ReadonlyArray<FractionSize>,
  wahlperiode: number,
): QuorumGroup[] {
  const folded = foldFractionSizes(sizes)
  const totalSeats = folded.reduce((sum, entry) => sum + entry.count, 0)
  const threshold = quorumThreshold(totalSeats)

  return folded
    .map((entry) => {
      const party = partyFor(entry.fraktion).key
      return {
        party,
        fraktion: entry.fraktion,
        seats: entry.count,
        share: totalSeats === 0 ? 0 : entry.count / totalSeats,
        reachesAlone: threshold > 0 && entry.count >= threshold,
        eligible: isEligible(party),
        // Through `coalitionRole` rather than a local list, so this page and the
        // hemicycle's coalition mode read one table — and inherit its refusal to
        // colour an unrecorded period as opposition.
        role: coalitionRole(entry.fraktion, wahlperiode),
      }
    })
    .sort((a, b) => seatingRank(a.fraktion) - seatingRank(b.fraktion))
}

/**
 * Whether a group's seats can count toward a *joint* motion.
 *
 * `fraktionslos` and `unknown` cannot, and the reason is not that their members
 * lack the right — every member of the Bundestag may sign a motion under
 * Art. 44(1), and unaffiliated members demonstrably do. It is that they are not
 * a bloc: "the fraktionslose members" is a residual category of individuals who
 * agree on nothing in particular, so a row saying they *combine* with the SPD to
 * reach a quarter asserts a coordination that does not exist. `unknown` is
 * excluded for the plainer reason that this codebase does not know what it is.
 *
 * They stay in the seat table, and in `totalSeats` — their holders are members
 * of the chamber and the threshold is a quarter of *all* members, so dropping
 * them would lower the bar for everyone else. Excluded from the combinations
 * only, which the page states.
 */
function isEligible(party: PartyKey): boolean {
  return party !== "fraktionslos" && party !== "unknown"
}

/** The groups that can appear in a combination, in arc order. */
export function eligibleGroups(groups: ReadonlyArray<QuorumGroup>): QuorumGroup[] {
  return groups.filter((group) => group.eligible)
}

// --- combinations -----------------------------------------------------------

/**
 * One set of groups considered as joint signatories.
 *
 * The three flags are deliberately three rather than one verdict, and the split
 * is the module header's whole subject: `reaches` is counted from the roster,
 * `blocked` is read from a maintained table, and `viable` is their conjunction.
 * A renderer that wants to say "this would work" uses `viable`; one that wants
 * to say *why not* has both halves and can attribute each to its source.
 */
export type QuorumCombination = {
  parties: PartyKey[]
  seats: number
  share: number
  /** Seats at or above the threshold — arithmetic over official counts. */
  reaches: boolean
  /** ⚠ At least one declared refusal inside the set — from `RULED_OUT`, which
   * is maintained by Bundestrack and not sourced from any record. */
  blocked: boolean
  /** The pairs that block it, for a page that names them rather than merely
   * colouring the row. Empty when `blocked` is false. */
  blockedBy: Array<[PartyKey, PartyKey]>
  /** `reaches && !blocked`. */
  viable: boolean
}

/**
 * Every combination of `minSize`…`maxSize` eligible groups, evaluated.
 *
 * Enumerated exhaustively rather than only the ones that reach: a table showing
 * *only* the successful combinations answers "who can" while silently discarding
 * the near misses, and the near misses are the finding — a reader looking for
 * why no inquiry can be established needs to see the combinations that fail and
 * by how much. The caller filters for display; this returns the full picture,
 * which is also what makes it testable.
 *
 * Sorted by seats descending, so the strongest combinations lead and the reader
 * meets the ones nearest the line first. Ties break on the group ordering, so
 * the list is stable between renders.
 *
 * The size bound is what keeps this finite and honest. With six groups the
 * 1–3-member subsets are 41 rows; allowing every subset would be 63 and would
 * include four- and five-party motions that are arithmetically true and
 * politically meaningless. The default upper bound of 3 is the task's, and it is
 * also where the interesting cases live: in a 630-seat chamber with a 158-seat
 * bar, no combination of four groups is needed by anyone who could not already
 * do it with two.
 */
export function quorumCombinations(
  groups: ReadonlyArray<QuorumGroup>,
  totalSeats: number,
  { minSize = 1, maxSize = 3 }: { minSize?: number; maxSize?: number } = {},
): QuorumCombination[] {
  const eligible = eligibleGroups(groups)
  const threshold = quorumThreshold(totalSeats)
  const combinations: QuorumCombination[] = []

  const lowerBound = Math.max(1, Math.floor(minSize))
  const upperBound = Math.min(eligible.length, Math.floor(maxSize))

  for (let size = lowerBound; size <= upperBound; size++) {
    for (const subset of subsetsOfSize(eligible, size)) {
      const seats = subset.reduce((sum, group) => sum + group.seats, 0)
      const parties = subset.map((group) => group.party)
      const blockedBy = blockingPairs(parties)
      const reaches = threshold > 0 && seats >= threshold
      combinations.push({
        parties,
        seats,
        share: totalSeats === 0 ? 0 : seats / totalSeats,
        reaches,
        blocked: blockedBy.length > 0,
        blockedBy,
        viable: reaches && blockedBy.length === 0,
      })
    }
  }

  return combinations.sort(
    (a, b) =>
      b.seats - a.seats ||
      a.parties.length - b.parties.length ||
      a.parties.join().localeCompare(b.parties.join()),
  )
}

/** Every declared refusal *inside* a set, as ordered pairs. Returned rather than
 * counted so the page can name the two groups that block a row — "reaches the
 * quarter, but X has ruled out Y" is a sentence a reader can check, where a red
 * cell is one they must take on trust. */
function blockingPairs(parties: readonly PartyKey[]): Array<[PartyKey, PartyKey]> {
  const pairs: Array<[PartyKey, PartyKey]> = []
  for (let i = 0; i < parties.length; i++) {
    for (let j = i + 1; j < parties.length; j++) {
      if (hasRuledOut(parties[i], parties[j])) pairs.push([parties[i], parties[j]])
    }
  }
  return pairs
}

/** Subsets of exactly `size`, in input order — so a combination's parties come
 * out left to right along the political axis, matching the seat table above it.
 * Iterative rather than recursive for no reason beyond keeping the index
 * arithmetic visible. */
function* subsetsOfSize<T>(items: readonly T[], size: number): Generator<T[]> {
  if (size <= 0 || size > items.length) return
  const indices = Array.from({ length: size }, (_, i) => i)
  for (;;) {
    yield indices.map((index) => items[index])
    // Advance the rightmost index that has room, then repack everything after it
    // — the standard odometer over combinations.
    let position = size - 1
    while (position >= 0 && indices[position] === items.length - size + position) position--
    if (position < 0) return
    indices[position]++
    for (let next = position + 1; next < size; next++) indices[next] = indices[next - 1] + 1
  }
}

// --- the page's summary ----------------------------------------------------

/**
 * What the whole page adds up to, computed once.
 *
 * A single object rather than four independent derivations in the component,
 * because the four questions the page answers are one question asked four ways
 * and they must not be able to disagree: how many combinations reach the bar,
 * how many of those are blocked, whether *any* survives, and how far the nearest
 * unblocked one falls short.
 *
 * `shortfall` is the number that turns the finding from a colour into a
 * quantity. Null when an unblocked combination reaches — there is no shortfall
 * to state — and otherwise the seats the best unblocked combination lacks. That
 * distinction is the same one `seatingLevel` draws between null and zero: "no
 * shortfall" and "short by zero" are different claims, and a 0 in that field
 * would render as "0 seats short", which reads as success.
 */
export type QuorumSummary = {
  totalSeats: number
  threshold: number
  groups: QuorumGroup[]
  combinations: QuorumCombination[]
  /** Combinations at or above the threshold, blocked or not. */
  reaching: QuorumCombination[]
  /** Reaching combinations with no declared refusal inside them. */
  viable: QuorumCombination[]
  /** Reaching combinations that a declared refusal blocks. */
  blocked: QuorumCombination[]
  /** Seats the largest *unblocked* combination still lacks, or null if one
   * reaches. See the note above on why this is not 0. */
  shortfall: number | null
  /**
   * ⚠ The same question asked of the **opposition groups only** — the scope in
   * which the answer is a finding rather than a triviality. See the module
   * header: the governing groups clear the quarter on their own, and a
   * government does not compel an inquiry into itself.
   *
   * Null when the period's coalition is unrecorded (`GOVERNING_PARTIES` has no
   * entry), rather than an opposition computed by treating every group as
   * opposition — the refusal `coalitionRole` already makes, carried through.
   */
  opposition: OppositionScope | null
}

/** The quorum question restricted to the groups that do not govern. Same shape
 * as the chamber-wide answer, over a subset of the groups and against the *same*
 * threshold — the quarter is a quarter of all members, so restricting who may
 * sign does not lower the bar. */
export type OppositionScope = {
  groups: QuorumGroup[]
  /** Opposition seats in total. Below the threshold in WP21 once the AfD is
   * excluded, which is the page's actual finding. */
  seats: number
  combinations: QuorumCombination[]
  reaching: QuorumCombination[]
  viable: QuorumCombination[]
  blocked: QuorumCombination[]
  /** Seats the largest unblocked opposition combination still lacks. Nine, in
   * WP21. Null when one reaches — see `shortfall`. */
  shortfall: number | null
}

/**
 * The whole page's arithmetic, from a period's group sizes.
 *
 * One function so the Convex query, the page and the tests all compute the same
 * numbers from the same input. The seat counts come from
 * `mps.getFractionSizes`; everything else here is derived, except `blocked`,
 * which reads `RULED_OUT` and is marked as maintained everywhere it surfaces.
 */
export function quorumSummary(
  sizes: ReadonlyArray<FractionSize>,
  wahlperiode: number,
  options: { maxSize?: number } = {},
): QuorumSummary {
  const groups = quorumGroups(sizes, wahlperiode)
  const totalSeats = groups.reduce((sum, group) => sum + group.seats, 0)
  const threshold = quorumThreshold(totalSeats)
  const combinations = quorumCombinations(groups, totalSeats, { maxSize: options.maxSize })

  const { reaching, viable, blocked, shortfall } = tally(combinations, threshold)

  return {
    totalSeats,
    threshold,
    groups,
    combinations,
    reaching,
    viable,
    blocked,
    shortfall,
    opposition: oppositionScope(groups, totalSeats, threshold, options.maxSize),
  }
}

/**
 * The same tally over any set of combinations — chamber-wide or opposition-only.
 *
 * Shared rather than written twice, because the two scopes must not be able to
 * disagree about what "viable" or "short by" means. The scope difference is
 * *which groups may sign*; the rules applied to them are identical, and this is
 * where that identity is enforced.
 */
function tally(
  combinations: readonly QuorumCombination[],
  threshold: number,
): {
  reaching: QuorumCombination[]
  viable: QuorumCombination[]
  blocked: QuorumCombination[]
  shortfall: number | null
} {
  const reaching = combinations.filter((entry) => entry.reaches)
  const viable = reaching.filter((entry) => !entry.blocked)
  const blocked = reaching.filter((entry) => entry.blocked)

  // The best unblocked combination at any size, which is the one a shortfall is
  // meaningfully measured against. `combinations` is sorted by seats descending,
  // so the first unblocked entry is the largest.
  const bestUnblocked = combinations.find((entry) => !entry.blocked)
  const shortfall =
    viable.length > 0 || bestUnblocked === undefined
      ? null
      : Math.max(0, threshold - bestUnblocked.seats)

  return { reaching, viable, blocked, shortfall }
}

/**
 * The quorum question restricted to the groups that do not govern.
 *
 * ⚠ Measured against the **chamber's** threshold, not a quarter of the
 * opposition's own seats. The quarter in Art. 44(1) is a quarter of the
 * Bundestag's members; restricting who is willing to sign does not lower the
 * bar, and computing a quarter of the opposition would produce a much smaller
 * number that means nothing. `totalSeats` is passed through for the same reason
 * — the shares stay shares of the chamber.
 *
 * Returns null where any group's role is `unknown`, which is how an unrecorded
 * coalition reaches the page as "not available for this period" rather than as
 * an opposition that silently includes the government. `GOVERNING_PARTIES` has
 * entries for WP20 and WP21 only, so `backfill --wp 19` takes this path.
 */
function oppositionScope(
  groups: readonly QuorumGroup[],
  totalSeats: number,
  threshold: number,
  maxSize: number | undefined,
): OppositionScope | null {
  if (groups.length === 0) return null
  if (groups.some((group) => group.role === "unknown")) return null

  const opposition = groups.filter((group) => group.role === "opposition")
  if (opposition.length === 0) return null

  const combinations = quorumCombinations(opposition, totalSeats, { maxSize })
  return {
    groups: opposition,
    // Every opposition seat, eligible to combine or not — `fraktionslos` members
    // hold seats and may sign individually even though they are not a bloc, so
    // omitting them here would understate the opposition's actual size.
    seats: opposition.reduce((sum, group) => sum + group.seats, 0),
    combinations,
    ...tally(combinations, threshold),
  }
}
