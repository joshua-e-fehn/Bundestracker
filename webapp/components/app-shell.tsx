"use client"

import { useSidebar } from "@/components/providers/sidebar-provider"
import { cn } from "@/lib/utils"

/**
 * The page shell: the column everything below the header lives in.
 *
 * This is the piece that makes the sidebar an *app shell* rather than an
 * overlay. The rail is `position: fixed`, so it takes no space in flow; this
 * wrapper is what gives the space back by padding the content column by exactly
 * the rail's width. Content reflows around the sidebar instead of being covered
 * by it, which is the structural requirement the whole correction is about.
 *
 * ## What is inside it and what is not
 *
 * Inside: the routed page and the footer. Both are full-bleed elements that
 * would otherwise run underneath a rail fixed to the left edge — the footer
 * most visibly, since it is the thing a reader scrolls to and it would have had
 * its first 256 px covered.
 *
 * Outside: the header. The rail starts *below* it (`top-[calc(3.5rem+3px)]` in
 * components/nav-sidebar.tsx), so the header spans the full width above both
 * the sidebar and this column. That is deliberate rather than incidental — the
 * federal-rule hairline is the site's top edge and must reach both corners, and
 * the brand, search and controls keep the position they have had all along
 * rather than jumping right by 256 px the first time someone collapses a rail
 * they are not looking at.
 *
 * ## Why padding on a wrapper and not a margin on `<main>`
 *
 * Because "everything else" is not only `<main>`. The footer is its own
 * component, and the home page paints two viewport-`fixed` decorations. All of
 * them have to shift, and they are in three different files rendered at three
 * different depths. One padded wrapper moves the lot; a margin per page would
 * be nine files to keep in step and a tenth the day someone adds a route.
 *
 * ## Why the offset is published as a CSS variable
 *
 * `--shell-inset` is set here so the two `fixed` elements on the home page can
 * read it. `components/home-protokoll/protokoll-backdrop.tsx` anchors its
 * progress rail at `calc(50vw - 40rem)` — a *viewport* centre, which stops
 * being the content column's centre the moment a rail sits beside it, so the
 * indicator drifted left over the text. A variable is the only thing a `fixed`
 * element can consult for this, since it inherits through the cascade while
 * padding does not affect a fixed descendant's containing block.
 *
 * The transition duration matches the sidebar's own, so the rail and the column
 * it makes room for move as one thing rather than one chasing the other.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const { expanded } = useSidebar()

  return (
    <div
      style={
        {
          // The *desktop* width only. It is deliberately not `--shell-inset`
          // itself: a media query cannot live in an inline style, so the
          // breakpoint has to be expressed in a class, and a class cannot
          // override an inline declaration of the same custom property. Naming
          // the two separately is what lets the class below choose between
          // "no sidebar here" and "this much sidebar".
          "--shell-inset-lg": expanded ? "16rem" : "3.5rem",
        } as React.CSSProperties
      }
      className={cn(
        // `flex-1` with the body's `flex min-h-svh flex-col` is what keeps the
        // footer's `mt-auto` working — this wrapper is now the flex child that
        // absorbs the slack, so it has to be a column that grows.
        "flex min-w-0 flex-1 flex-col",
        // Zero by default, restored at `lg`. Without the default a narrow
        // viewport would inherit whatever a desktop reader last left in the
        // cookie and every page would sit in a 256 px-narrower column with
        // nothing beside it — the sidebar being `hidden` below `lg` does not
        // un-set a variable.
        "[--shell-inset:0px] lg:[--shell-inset:var(--shell-inset-lg)]",
        "pl-(--shell-inset) transition-[padding-left] duration-200 ease-out motion-reduce:transition-none",
      )}
    >
      {children}
    </div>
  )
}
