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
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- Static asset, no
    // need for the Image component's optimisation pipeline at these sizes.
    <img
      src="/logo-256.webp"
      alt=""
      aria-hidden="true"
      className={cn("size-5 shrink-0", className)}
    />
  )
}