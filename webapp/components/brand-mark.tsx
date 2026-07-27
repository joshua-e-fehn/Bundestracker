import { cn } from "@/lib/utils"

/**
 * The Bundesadler, as the site's mark.
 *
 * ## Why this exists beside `app/icon.svg`
 *
 * The favicon is a *file* — Next.js reads it off disk and serves it as an
 * image, so it cannot be rendered inline and cannot know what theme the page is
 * in. It therefore carries its own baked-in colours (a near-black tile with a
 * gold eagle) which are right for a browser tab, where the mark sits on
 * whatever chrome the OS supplies, and wrong inside the page, where a black
 * tile on a warm-white header would be the heaviest element on the page.
 *
 * So the artwork is duplicated rather than shared, deliberately, and this is
 * the one place that trade-off is made: the two files must be edited together
 * if the eagle ever changes. The alternative — an `<img src="/icon.svg">` —
 * would freeze the tile into the header and is what this avoids.
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
      viewBox="0 0 64 64"
      aria-hidden="true"
      focusable="false"
      // `text-gold` sets `color`, which `fill="currentColor"` below picks up —
      // so a caller can re-tint the mark with a text colour class the same way
      // it would any icon, and the default follows the theme without a second
      // table here.
      className={cn("size-5 shrink-0 text-gold", className)}
      fill="currentColor"
    >
      {/* One path, drawn on a 16×16 grid — every edge a multiple of 4 in this
          64-unit viewBox. app/icon.svg explains why the eagle is built that way
          rather than traced from the coat of arms; the short version is that
          the official artwork is mostly hairline negative space and closes into
          a blob when reduced. It matters here too: the header renders this at
          20 px and the footer at 16 px, the same regime as the favicon. */}
      <path d="M24 4h12v4h-12ZM16 8h20v4h-20ZM28 12h8v8h-8ZM4 16h16v4h-16ZM44 16h16v4h-16ZM4 20h56v8h-56ZM4 28h4v16h-4ZM12 28h4v20h-4ZM24 28h16v20h-16ZM48 28h4v20h-4ZM56 28h4v16h-4ZM12 48h8v4h-8ZM28 48h8v12h-8ZM44 48h8v4h-8ZM12 52h4v4h-4ZM48 52h4v4h-4Z" />
    </svg>
  )
}
