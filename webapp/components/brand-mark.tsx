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
      <path d="M28.6 19.2c-7.6-2.1-15.8-2.5-23.2-1l1.3 6.6c6.8-1.2 14.4-.8 21.4 1.3z" />
      <path d="M28 30.2c-6.4-2.7-13.8-4.1-20.6-3.8l1.4 6.5c6-.1 12.6 1.1 18.6 3.3z" />
      <path d="M35.4 19.2c7.6-2.1 15.8-2.5 23.2-1l-1.3 6.6c-6.8-1.2-14.4-.8-21.4 1.3z" />
      <path d="M36 30.2c6.4-2.7 13.8-4.1 20.6-3.8l-1.4 6.5c-6-.1-12.6 1.1-18.6 3.3z" />
      <path d="M27.2 41.4l3.7.8-2.8 13.2-4.3-2.2z" />
      <path d="M32 42h3l.6 14.8h-4.2z" />
      <path d="M39.8 41.4l-3.7.8 2.8 13.2 4.3-2.2z" />
      <path d="M33.4 16.4c5 .7 7.6 5.9 7.2 12.8-.5 6.8-3.8 12.6-7.2 14.4-3.4-1.8-6.7-7.6-7.2-14.4-.4-6.9 2.2-12.1 7.2-12.8z" />
      <path d="M30.2 7.6L17.8 12.2q3.2.9 4.2 4.4l8.2-1.4z" />
      <path
        fillRule="evenodd"
        d="M34.2 4.6a7 7 0 1 1 0 14 7 7 0 0 1 0-14m.5 5a2 2 0 1 0 0 4 2 2 0 0 0 0-4"
      />
    </svg>
  )
}
