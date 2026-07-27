import { cn } from "@/lib/utils"

/**
 * The Bundesadler, as the site's mark.
 *
 * ## Why this exists beside `app/icon.svg`
 *
 * The favicon is a *file* — Next.js reads it off disk and serves it as an
 * image, so it cannot be rendered inline and cannot know what theme the page is
 * in. It therefore carries its own baked-in colours (a white tile, a gold ring
 * and a gold eagle) which are right for a browser tab, where the mark sits on
 * whatever chrome the OS supplies, and wrong inside the page, where an opaque
 * white tile would punch a hole in a dark header and stack a second border on
 * top of the one the header already draws.
 *
 * So the artwork is duplicated rather than shared, deliberately, and this is
 * the one place that trade-off is made: the two files must be edited together
 * if the eagle ever changes. The alternative — an `<img src="/icon.svg">` —
 * would freeze the tile into the header and is what this avoids.
 *
 * What the two do share is the *geometry*: same `viewBox`, same `d`, same ring
 * radius and stroke. Only the fills differ — the tile is dropped here and both
 * ring and bird are drawn in `currentColor`, so the mark is transparent and
 * takes the theme's ink. Keeping the numbers identical is what lets a reader
 * diff the two files and see at a glance that they have not drifted.
 *
 * ## Why the viewBox is `-10 -10 84 84` and not `0 0 64 64`
 *
 * The eagle's own coordinates are unchanged and still span 0–64; the extra ten
 * units a side are the margin the ring needs. app/icon.svg carries the
 * arithmetic — the short version is that the wing tips sit 32.25 units from the
 * centre, which is already outside a 64-unit tile, so no ring fits without
 * giving the artwork room. Do not "tidy" this back to `0 0 64 64`: it does not
 * crop the ring, it deletes it, and the mark silently becomes a bare eagle
 * again at every call site.
 *
 * ## Why the ink tier and not the identity gold
 *
 * `--gold` rather than `--gold-brand`, against the instinct that a logo should
 * wear the identity colour at full strength. app/globals.css sets out why: the
 * brand gold is 2.4:1 on the light background, which is a fill ratio, not a
 * mark ratio. At 20 px the eagle is mostly hairline strokes — the talons and
 * the wing bars are barely over a pixel — and hairlines at 2.4:1 do not read as
 * gold, they read as a smudge. The ink tier clears 4.5:1 in both themes and is
 * recognisably the same hue, which is exactly the trade the two-tier split
 * exists to make. The federal rule two lines above carries `--gold-brand` at
 * full strength, so the identity colour is still on the page at its proper
 * saturation, as a fill, where it belongs.
 *
 * `aria-hidden` throughout: every call site renders the wordmark as text beside
 * it, so naming the mark too would have a screen reader announce the site twice.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="-10 -10 84 84"
      aria-hidden="true"
      focusable="false"
      // `text-gold` sets `color`, which `fill="currentColor"` below picks up —
      // so a caller can re-tint the mark with a text colour class the same way
      // it would any icon, and the default follows the theme without a second
      // table here.
      className={cn("size-5 shrink-0 text-gold", className)}
      fill="currentColor"
    >
      {/* The ring. `fill="none"` is required, not defensive — the `<svg>` above
          sets `fill="currentColor"` for the eagle, which a `<circle>` inherits,
          and an inherited fill turns this into a solid disc with the bird
          invisible inside it.

          The stroke is in user units, so it scales with the mark: 4.5/84 of the
          rendered width, which is ~1.07 px at the header's 20 px and ~0.86 px
          at the footer's 16 px. Sub-pixel at the small end and therefore
          antialiased to a lighter gold rather than dropped — a stroke below 1 px
          is still painted, at reduced alpha. That is the right failure: the ring
          fades before it breaks up, where a stroke rounded up to a hard pixel
          would read heavier than the hairlines of the eagle it surrounds. */}
      <circle cx="32" cy="32" r="37" fill="none" stroke="currentColor" strokeWidth="4.5" />
      {/* One path, drawn on a 16×16 grid — every edge a multiple of 4, in the
          0–64 range this viewBox insets by ten a side. app/icon.svg explains why
          the eagle is built that way rather than traced from the coat of arms;
          the short version is that the official artwork is mostly hairline
          negative space and closes into a blob when reduced. It matters here
          too: the header renders this at 20 px and the footer at 16 px, the same
          regime as the favicon.

          The ring's margin does cost the bird size — it now draws at 64/84 of
          the box, so the header's mark is a 15 px eagle in a 20 px slot where it
          used to be a 20 px eagle. The call sites are deliberately left alone
          rather than each bumped a step: the *mark* is still the size the layout
          allots it, and the emblem is now the ring plus the bird rather than the
          bird alone. */}
      <path d="M24 4h12v4h-12ZM16 8h20v4h-20ZM28 12h8v8h-8ZM4 16h16v4h-16ZM44 16h16v4h-16ZM4 20h56v8h-56ZM4 28h4v16h-4ZM12 28h4v20h-4ZM24 28h16v20h-16ZM48 28h4v20h-4ZM56 28h4v16h-4ZM12 48h8v4h-8ZM28 48h8v12h-8ZM44 48h8v4h-8ZM12 52h4v4h-4ZM48 52h4v4h-4Z" />
    </svg>
  )
}
