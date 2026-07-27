"use client"

import { motion } from "framer-motion"
import {
  ActivityFeedPreview,
  BottomMPs,
  LatestVotes,
  PartyComparisonPreview,
  TopMPs,
} from "@/components/home-sections"
import { CHAPTERS } from "@/lib/protokoll"
import { REVEAL_OFFSET, REVEAL_TRANSITION, useReveal } from "./use-reveal"

/**
 * Chapters 4 and 5 — the dashboard, inside the narrative.
 *
 * Both are the existing home-page sections, unchanged, wrapped in a reveal.
 * That is the whole design: §7's requirement #4 says no section may lose
 * information to the story, and the cheapest way to guarantee it is to render
 * the same components against the same queries with the same caveats. `TopMPs`
 * still carries its heatmaps, `BottomMPs` still carries `home.bottomMPsCaveat`,
 * `PartyComparisonPreview` still carries `parties.smallGroupCaveat`.
 *
 * ## Why the wrapper is one component per chapter and not one shared one
 *
 * They differ in their grid. Chapter 4 is two boards then the party card;
 * Chapter 5 is the ballots then the feed. A single `<Reveal>` taking children
 * was the first shape and is worse in a specific way — it makes the reveal look
 * like a layout primitive, and the next section to want a fade reaches for it
 * and gets a `<div>` in the middle of a grid it was meant to be a child of.
 *
 * ## Source order is reading order
 *
 * Preserved from app/page.tsx, where it is deliberate: the descending board
 * comes before the ascending one because the ascending one carries a caveat
 * that qualifies it, and a qualification should not arrive before the thing it
 * qualifies. The same holds for a screen reader and a phone, both of which read
 * this column-first. §9 forbids scroll choreography from reordering content
 * visually away from DOM order, and stacking these vertically at narrow widths
 * is exactly what keeps that true.
 */

export function ChapterBoards({ wahlperiode }: { wahlperiode: number | null | undefined }) {
  const { ref, revealed } = useReveal<HTMLDivElement>()

  return (
    <motion.div
      ref={ref}
      className="grid grid-cols-[minmax(0,1fr)] gap-12"
      initial={{ opacity: 0, y: REVEAL_OFFSET }}
      animate={revealed ? { opacity: 1, y: 0 } : { opacity: 0, y: REVEAL_OFFSET }}
      transition={REVEAL_TRANSITION}
    >
      {/* `minmax(0,1fr)` rather than a bare implicit column, for app/page.tsx's
          reason: a grid item's `min-width` is `auto`, so a single-column track
          sizes itself to its widest content instead of to the viewport. */}
      {/* `level={3}` on every board: each chapter's own title is the `h2`, so a
          section inside it is a subsection. Left at the default `h2` the
          outline flattened — "Wer ist aktiv?" and "Aktivste Abgeordnete" came
          out as siblings, which tells a screen reader the board is a peer of
          the chapter rather than a part of it, and makes five chapters
          indistinguishable from eleven sections. See the note in
          components/home-sections.tsx. */}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-12 lg:grid-cols-2 lg:gap-8">
        <TopMPs wahlperiode={wahlperiode} level={3} />
        <BottomMPs wahlperiode={wahlperiode} level={3} />
      </div>
      <PartyComparisonPreview wahlperiode={wahlperiode} level={3} />
    </motion.div>
  )
}

export function ChapterToday({ wahlperiode }: { wahlperiode: number | null | undefined }) {
  const { ref, revealed } = useReveal<HTMLDivElement>()

  return (
    <motion.div
      ref={ref}
      className="grid grid-cols-[minmax(0,1fr)] gap-12"
      initial={{ opacity: 0, y: REVEAL_OFFSET }}
      animate={revealed ? { opacity: 1, y: 0 } : { opacity: 0, y: REVEAL_OFFSET }}
      transition={REVEAL_TRANSITION}
    >
      <LatestVotes wahlperiode={wahlperiode} level={3} />
      <ActivityFeedPreview wahlperiode={wahlperiode} level={3} />
    </motion.div>
  )
}

export const BOARDS_CHAPTER = CHAPTERS[3]
export const TODAY_CHAPTER = CHAPTERS[4]
