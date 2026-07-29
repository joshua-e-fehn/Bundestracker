"use client"

import { useQuery } from "convex/react"
import Link from "next/link"
import { BrandMark } from "@/components/brand-mark"
import { LocaleToggle } from "@/components/locale-toggle"
import { NavDesktop } from "@/components/nav-desktop"
import { NavMobile } from "@/components/nav-mobile"
import { useLocale } from "@/components/providers/locale-provider"
import { SearchBar } from "@/components/search-bar"
import { ThemeToggle } from "@/components/theme-toggle"
import { UserMenu } from "@/components/user-menu"
import { api } from "@/convex/_generated/api"

/**
 * The site header: brand, navigation, search, and the reader's own controls.
 *
 * The navigation itself lives in two components — `NavDesktop` (grouped menus,
 * `lg` and up) and `NavMobile` (a drawer, below `lg`) — over one tree in
 * `lib/navigation.ts`. This file is the bar they sit in.
 *
 * ## Why the list moved out
 *
 * It used to be here: a flat `NAV_LINKS` array of eight entries, an
 * `INLINE_NAV_LINKS` filter over it, and a hand-written `NAV_SHEET_ONLY` set
 * naming the one label too wide for the row. That arrangement had run out — the
 * bar was a width budget with eight peers in it, a ninth route
 * (`/votes/own-resources`) had no entry at all, and the next feature would have
 * had nowhere to go. lib/navigation.ts now holds the tree and the rule for
 * where a new page belongs; both renderings read it, so neither can drift from
 * the other the way two hand-written lists did.
 *
 * ## The bar's width budget, revisited
 *
 * The old comments recorded the measurements that forced the old layout: five
 * labels came to 564 px, which is why the inline row waited for `lg`, and the
 * search box waited for `xl` because five links plus a 208 px box exceeded a
 * `max-w-6xl` container at 1024 px. Grouping changes those numbers. The bar now
 * carries four items — "Dashboard" plus three group names — measuring roughly
 * 340 px in German, which is what buys the search box its place at `lg` instead
 * of `xl`: the case the old code called out as impossible is the one grouping
 * bought back. The nav still waits for `lg` because below it the drawer is the
 * better pattern regardless of whether the labels would fit.
 */

/**
 * Which Bundestag the site is showing, as a chip in the header.
 *
 * Renders nothing while the query is in flight, and nothing when the roster is
 * empty — the two states a fresh deployment passes through. A skeleton here
 * would be a shimmer in the chrome on every page load for a fact that is
 * decoration; and `null` for an unloaded roster keeps the header from asserting
 * a period that has no data behind it.
 *
 * Now `lg` rather than `sm`. It used to appear at 640 px, where it sat between
 * the search box and the three controls and squeezed the box to about the width
 * of its own magnifier glyph — visible in the before/after screenshots as a bare
 * `Q` against the chip. It is the least important thing in the bar, so it is the
 * thing that waits for room.
 */
function CurrentPeriodBadge() {
  const { t } = useLocale()
  const wahlperiode = useQuery(api.mps.getCurrentWahlperiode)

  if (wahlperiode === undefined || wahlperiode === null) return null

  return (
    <span
      title={t("nav.periodLabel", { wahlperiode })}
      className="mr-1 hidden rounded-full border border-border/60 px-2.5 py-1 font-medium text-muted-foreground text-xs tabular-nums lg:inline-block"
    >
      {t("nav.period", { wahlperiode })}
    </span>
  )
}

export function SiteHeader() {
  const { t } = useLocale()

  return (
    <header className="sticky top-0 z-50 w-full border-border/60 border-b bg-background/80 backdrop-blur-md supports-[backdrop-filter]:bg-background/60">
      {/* The flag, as a hairline along the very top of the page. `federal-rule`
          is defined in app/globals.css, which explains at length why the flag
          is confined to 3 px rather than used as UI colour — in short, the page
          already carries meaning-bearing colour in six party hues and a
          red-gold interface underneath them would leave nothing readable as an
          accent.

          It goes on the *header* rather than on `<body>` so it scrolls with
          nothing: the header is sticky, so the rule stays pinned to the top
          edge of the viewport and reads as the site's own edge rather than as a
          decoration that slides away. `aria-hidden` because it is a graphic
          with no accessible content — the wordmark below already names the
          site. */}
      <div aria-hidden className="federal-rule h-[3px] w-full" />

      <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-2 px-4 sm:px-6">
        {/* Truncates rather than `shrink-0`. At 320 px the brand's 112 px plus
            the four controls' 187 px came to 307 px inside a 288 px content
            box, so the header — and with it every page, since the document
            scrolls as one — was 19 px wider than the viewport on every route.
            A wordmark that clips is better than a site that scrolls sideways.

            The mark is `shrink-0` inside that truncating box so the eagle
            survives at 320 px and only the word clips — a wordmark reduced to
            "Bundestra…" beside its mark still reads as the brand; a mark
            squeezed to 4 px reads as a rendering fault.

            It is also the route to `/`, the narrative home page, which is
            therefore not an entry in the navigation: a wordmark that goes home
            is the one convention every site on the web shares. */}
        <Link
          href="/"
          className="mr-2 flex min-w-0 items-center gap-2 rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <BrandMark />
          <span className="min-w-0 truncate font-semibold text-base tracking-tight">
            {t("app.name")}
          </span>
        </Link>

        {/* Four items rather than the old five links — see the width note in the
            header comment. Below `lg` the drawer carries the whole tree. */}
        <NavDesktop className="hidden lg:flex" />

        {/* Pushes the controls right and absorbs the slack, so the nav stays
            left-aligned next to the brand at every width. The search box sits
            inside it rather than in the control cluster: the slack is exactly
            the space a box wants, and `justify-end` keeps it against the
            controls instead of floating mid-bar. */}
        <div className="flex min-w-0 flex-1 justify-end px-2">
          {/* `lg`, matching the nav rather than waiting a step past it as it
              used to. Grouping the eight links into four items freed the width
              that forced the box to `xl`; `max-w-[13rem]` keeps it from
              crowding the group labels at exactly 1024 px, where the container
              is tightest. Below this the drawer carries a full-width box. */}
          <SearchBar className="hidden max-w-[13rem] lg:flex" />
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {/* The one fact every page on this site is implicitly scoped to and
              none of them states in the chrome: which Bundestag you are looking
              at. Read from the data rather than from `CURRENT_WAHLPERIODE`, for
              the reason `newestWahlperiode` gives — a constant keeps naming the
              previous Bundestag for months after the next is sworn in. */}
          <CurrentPeriodBadge />

          <LocaleToggle />
          <ThemeToggle />
          <UserMenu className="ml-1" />

          {/* Paired with `NavDesktop`'s `lg:flex` above — the two must flip at
              the same width or the site has no navigation at all between 768
              and 1024 px. */}
          <NavMobile className="ml-1 lg:hidden" />
        </div>
      </div>
    </header>
  )
}
