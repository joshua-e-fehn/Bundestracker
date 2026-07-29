import { cn } from "@/lib/utils"

/**
 * The Bundestracker eagle, as the site's mark.
 *
 * ## What changed
 *
 * The mark was a pixel-grid SVG reconstruction of the Bundesadler — a 16×16
 * grid deliberately simplified because the official artwork's hairline
 * negative space closes into a blob at favicon size. It has been replaced
 * with a high-resolution raster emblem: a modern, 3D-metallic eagle inside
 * a gold ring, with the German flag colours (black, red, gold) encoded in
 * the wing feathers.
 *
 * The new mark is a WebP image with transparent background, so it sits on
 * any theme without a tile or border. It carries its own baked-in colours
 * (gold ring, gold eagle, black/red feather bands) rather than inheriting
 * `currentColor` — the flag colours are intrinsic to the design and cannot
 * be theme-tinted.
 *
 * `app/icon.png` and `app/apple-icon.png` are downscaled copies of the same
 * artwork, so the favicon and the in-page mark agree by construction rather
 * than by duplication.
 *
 * `aria-hidden` throughout: every call site renders the wordmark as text beside
 * it, so naming the mark too would have a screen reader announce the site twice.
 *
 * ## Why there is a `srcSet` and not just a `src`
 *
 * The largest call site is the home page's frontispiece, which now runs to 144
 * px (app/page.tsx). On a 2× display that asks for 288 device pixels from a 256
 * px source — an upscale, and precisely on the emblem whose fine detail (the
 * ring, the hairline feather bands) is the reason for rendering it large at
 * all. `logo-512.webp` already exists beside it for the same artwork, so the
 * fix is to describe both and let the browser choose by density rather than to
 * pick one file here and be wrong on half the screens.
 *
 * Density descriptors rather than `w` + `sizes`: this is a square mark laid out
 * by `size-*`, so its CSS width is fixed by class and not by the viewport, and
 * `sizes` would be restating what the class already says. The cost of the 512
 * is paid only where a device actually resolves it — a 1× phone still fetches
 * the 256, which is the file every call site used before.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- Static asset, no
    // need for the Image component's optimisation pipeline at these sizes.
    <img
      src="/logo-256.webp"
      srcSet="/logo-256.webp 1x, /logo-512.webp 2x"
      alt=""
      aria-hidden="true"
      className={cn("size-5 shrink-0", className)}
    />
  )
}
