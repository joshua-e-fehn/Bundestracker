"use client"

import { useQuery } from "convex/react"
import Link from "next/link"
import { BrandMark } from "@/components/brand-mark"
import { LocaleToggle } from "@/components/locale-toggle"
import { NavMobile } from "@/components/nav-mobile"
import { useLocale } from "@/components/providers/locale-provider"
import { SearchBar } from "@/components/search-bar"
import { ThemeToggle } from "@/components/theme-toggle"
import { UserMenu } from "@/components/user-menu"
import { api } from "@/convex/_generated/api"

/**
 * The site header: brand, search, and the reader's own controls.
 *
 * **It is no longer the primary navigation.** Destinations live in the sidebar
 * (`components/nav-sidebar.tsx`) at `lg` and up, and in the drawer this bar's
 * menu button opens below it. What is left here is the set of things that are
 * *global utilities* rather than places — the wordmark, the search box, the
 * period chip, language, theme, and the account menu.
 *
 * ## What this replaced, twice
 *
 * First a flat row of eight links, whose own comments recorded the arithmetic
 * of running out of room: five labels measured 564 px, the row could not appear
 * below `lg`, the search box had to wait for `xl`, and a ninth route lived only
 * in the mobile sheet because the tenth label would not fit.
 *
 * Then — briefly — three hover-opening group menus in the same bar. That
 * grouped the links honestly but kept navigation in a 56 px strip, which was
 * the wrong structure rather than the wrong grouping. The sidebar is the
 * correction; `components/nav-desktop.tsx` and its test are deleted rather than
 * left beside it, because two desktop navigation systems is the failure the
 * `NAV_SHEET_ONLY` set was already an instance of.
 *
 * ## Why the header spans the full width, above the sidebar
 *
 * The rail starts below this bar rather than beside it. Two reasons, both
 * properties of this site rather than preferences:
 *
 *  - The `federal-rule` hairline is the site's top edge and has to reach both
 *    corners. Inset by 256 px it would read as a decoration on a panel.
 *  - The brand, the search box and the three controls keep the position they
 *    have had since the site launched. Putting them inside the content column
 *    would move all five of them 200 px sideways every time a reader collapsed
 *    a rail they were not looking at.
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
 * `sm` rather than the `lg` it briefly waited for. It went to `lg` when eight
 * links and a search box were competing for the same bar and the chip squeezed
 * the box down to its own magnifier glyph. With the destinations gone to the
 * sidebar the bar has room again, so the one fact every page is scoped to comes
 * back at the width it fits.
 */
function CurrentPeriodBadge() {
  const { t } = useLocale()
  const wahlperiode = useQuery(api.mps.getCurrentWahlperiode)

  if (wahlperiode === undefined || wahlperiode === null) return null

  return (
    <span
      title={t("nav.periodLabel", { wahlperiode })}
      className="mr-1 hidden rounded-full border border-border/60 px-2.5 py-1 font-medium text-muted-foreground text-xs tabular-nums sm:inline-block"
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

      {/* Full-bleed rather than the `max-w-6xl` this used to centre. The bar now
          sits above a sidebar and a content column rather than above one
          centred page, so a centred inner box would have floated the brand out
          in the middle of the rail's width instead of over it. `px-4` matches
          the pages' own gutter so the wordmark lines up with the sidebar's
          left edge. */}
      <div className="flex h-14 w-full items-center gap-2 px-4 sm:px-6">
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

        {/* Pushes the controls right and absorbs the slack. The search box sits
            inside it rather than in the control cluster: the slack is exactly
            the space a box wants, and `justify-end` keeps it against the
            controls instead of floating mid-bar. */}
        <div className="flex min-w-0 flex-1 justify-end px-2">
          {/* `md` rather than the `lg` it needed while this bar also carried the
              navigation. The box is the header's main job now, so it appears as
              soon as there is room for it — and below that the drawer carries a
              full-width one, so no width is ever without search. */}
          <SearchBar className="hidden max-w-[16rem] md:flex" />
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

          {/* Paired with the sidebar's own `lg:flex` — the two must flip at the
              same width or the site has no navigation at all between 768 and
              1024 px. */}
          <NavMobile className="ml-1 lg:hidden" />
        </div>
      </div>
    </header>
  )
}
