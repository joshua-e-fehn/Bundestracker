/**
 * The narrative spine of the "Sitzungswoche" home page — as a table.
 *
 * A sitting week, read as the chamber fills: the members arrive, a bill is
 * tabled, the ballot resolves, the record is written, and the period's activity
 * accumulates. The reader scrolls through parliamentary *time* rather than
 * through topics, and the hemicycle beside the text re-colours to answer each
 * chapter's question.
 *
 * ## Why this is data and not five components
 *
 * Same reason `SEATING_MODES` in lib/seating.ts and `LEADERBOARDS` in
 * lib/leaderboards.ts are tables: the chapters differ in four things — their
 * copy, which colour mode the chamber wears, what data sits under the prose, and
 * which caveat they owe — and are otherwise identical. Five components is how
 * the caveat ends up on four of them, and how the fifth chapter quietly stops
 * re-colouring the chamber because someone forgot the prop.
 *
 * It also makes the one genuinely fragile property testable without a browser.
 * The chapters drive a `position: sticky` chamber, so the arc is only pinned for
 * as long as this list is long; and every mode named here must be a mode
 * `seatColor` can actually paint, which a string would not guarantee.
 *
 * ## The caveats are part of the story, not under it
 *
 * Three chapters carry one, and they are the three where the picture could be
 * read as a finding the sources do not support — the same rule
 * `SEATING_MODES` applies to its own five modes, and the reason `CaveatNote`
 * exists as a shared component at all:
 *
 *  - **arrival** repeats the seating page's §9 warning, because this chapter
 *    draws a chamber filling seat by seat and that is precisely the moment a
 *    reader takes a dot for a named member's actual chair.
 *  - **ballot** carries the named-vote caveat (§4.4): a named ballot is the
 *    exception in the Bundestag, so a chapter built around one must not imply
 *    the chamber's whole voting record is on screen.
 *  - **record** carries the "recorded, not worked" caveat, for the reason
 *    `home.bottomMPsCaveat` exists — this is the chapter where activity becomes
 *    a number, and a number without that sentence is an accusation.
 *
 * `arrival`'s and `ballot`'s reuse existing keys rather than restating them:
 * `seating.syntheticNotice` and `home.statNamedVotesNote` are the same claims
 * this page is making, and a second wording of a caveat is how the two come to
 * disagree about what the data does not say.
 */

import type { TranslationKey } from "./i18n"
import type { SeatingColorMode } from "./seating"

/**
 * The five chapters, in reading order.
 *
 * Ordered as a sitting week runs, which is also DOM order and therefore what a
 * screen reader and a phone get. Nothing about the scroll choreography may
 * reorder them visually — see the note on `SitzungswocheChapter.dataSection`.
 */
export const SITZUNGSWOCHE_CHAPTERS = [
  {
    id: "arrival",
    titleKey: "homeB.arrivalTitle",
    leadKey: "homeB.arrivalLead",
    bodyKey: "homeB.arrivalBody",
    // The chamber's opening state and the only mode with no caveat of its own —
    // party colours are the one view that needs neither a ramp nor a defence
    // (see `DEFAULT_SEATING_MODE`). The §9 warning below is about the *seats*,
    // not about the colouring.
    mode: "party",
    caveatKey: "seating.syntheticNotice",
    dataSection: "seats",
  },
  {
    id: "tabled",
    titleKey: "homeB.tabledTitle",
    leadKey: "homeB.tabledLead",
    bodyKey: "homeB.tabledBody",
    // Government and opposition: the division a tabled bill is read against.
    // Its caveat is the mode's own — who governs is in no Bundestag dataset
    // (`GOVERNING_PARTIES`) — so it is read off `SEATING_MODES` rather than
    // repeated here. See `chapterCaveatKeys`.
    mode: "coalition",
    caveatKey: undefined,
    dataSection: "stats",
  },
  {
    id: "ballot",
    titleKey: "homeB.ballotTitle",
    leadKey: "homeB.ballotLead",
    bodyKey: "homeB.ballotBody",
    // Attendance rather than a per-ballot recolouring of the arc. The chamber
    // beside this chapter is drawn from `getFractionSizes` — bloc sizes, not
    // seat rows — so it cannot know how a *named* member voted, and painting it
    // as though it did would be the one claim §9 forbids outright. What it can
    // honestly show is participation, which is the same ballot fact at the
    // level the data supports. The vote bars beside it carry the individual
    // result.
    mode: "attendance",
    caveatKey: "home.statNamedVotesNote",
    dataSection: "votes",
  },
  {
    id: "record",
    titleKey: "homeB.recordTitle",
    leadKey: "homeB.recordLead",
    bodyKey: "homeB.recordBody",
    mode: "activity",
    caveatKey: "home.bottomMPsCaveat",
    dataSection: "feed",
  },
  {
    id: "period",
    titleKey: "homeB.periodTitle",
    leadKey: "homeB.periodLead",
    bodyKey: "homeB.periodBody",
    // Committee work closes the week: the part of a member's job that leaves
    // the least trace, which is the note the story should end on rather than on
    // a leaderboard. Its caveat is the mode's own (§6.4).
    mode: "committee",
    caveatKey: undefined,
    dataSection: "boards",
  },
] as const satisfies ReadonlyArray<{
  id: string
  titleKey: TranslationKey
  leadKey: TranslationKey
  bodyKey: TranslationKey
  mode: SeatingColorMode
  /** A caveat this *chapter* owes, beyond whatever its colour mode already
   * carries. `undefined` rather than an empty string so a forgotten one is
   * visibly absent — the same choice `SeatingMode.caveatKey` makes. */
  caveatKey: TranslationKey | undefined
  /** Which of the existing home-page sections this chapter is the prose for.
   *
   * The narrative adds sentences *around* the dashboard; it never replaces a
   * section with a paragraph. Naming the section here rather than in the
   * component is what keeps that promise checkable: a chapter with no data
   * under it is a chapter that turned a table into an anecdote. */
  dataSection: string
}>

export type SitzungswocheChapter = (typeof SITZUNGSWOCHE_CHAPTERS)[number]

export type ChapterId = SitzungswocheChapter["id"]

/**
 * Every caveat a chapter owes, in the order they should be read.
 *
 * Two sources, deliberately merged here rather than at the call site: the
 * chapter's own (`caveatKey`) and whichever its colour mode already carries
 * (`SEATING_MODES`). A chapter that colours the chamber by committee work
 * inherits §6.4's warning without restating it, and one that colours by party
 * inherits nothing — which is right, and is why this cannot simply be a field.
 *
 * Deduplicated, because the two can name the same key: nothing does today, and
 * the day one does, showing the same box twice would read as a rendering fault
 * rather than as emphasis.
 *
 * Takes the mode's caveat as an argument rather than importing `SEATING_MODES`
 * and looking it up, so this stays a pure function over the two facts and the
 * component keeps one place where the mode table is read.
 */
export function chapterCaveatKeys(
  chapter: SitzungswocheChapter,
  modeCaveatKey: TranslationKey | undefined,
): TranslationKey[] {
  const keys: TranslationKey[] = []
  if (chapter.caveatKey !== undefined) keys.push(chapter.caveatKey)
  if (modeCaveatKey !== undefined && !keys.includes(modeCaveatKey)) keys.push(modeCaveatKey)
  return keys
}

/**
 * The anchor a chapter's section carries, and the target of the skip link.
 *
 * One function so the `id` written into the DOM and the `href` that jumps to it
 * cannot drift — a skip affordance that points at an anchor nobody rendered
 * fails silently, and it fails for exactly the reader it exists for.
 */
export function chapterAnchor(id: ChapterId): string {
  return `kapitel-${id}`
}

/**
 * Where "skip the story" goes.
 *
 * The first chapter that carries real data rather than the top of the page: a
 * returning reader who skips the narrative wants today's figures, and landing
 * them on chapter one's prose would be a link that appears to do nothing. This
 * is `tabled`, the summary statistics.
 *
 * §7 of the design research calls this the requirement most likely to be
 * quietly lost, which is why it is a named export with a test rather than an
 * `href` typed into the header.
 */
export const SKIP_TO_DATA_CHAPTER: ChapterId = "tabled"
