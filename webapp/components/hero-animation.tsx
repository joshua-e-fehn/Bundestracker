"use client"

import { useSearchParams } from "next/navigation"
import { BrandMark } from "@/components/brand-mark"
import { cn } from "@/lib/utils"

/**
 * The hero's crest: one decorative mark above the headline, in three variants.
 *
 * ## Why three, and why they are switched by the URL
 *
 * The three are a real choice not yet made — an eagle, a coin and a flag are
 * three different claims about what this site is (an official record, a score,
 * a national dashboard) and the way to decide is to look at them on the page
 * rather than in a spec. `?hero=coin` swaps one in.
 *
 * The URL is the switch for the reason components/search-page.tsx gives at
 * length about its filters: a parameter is shareable, linkable and reachable by
 * the back button, where component state and localStorage are none of those. A
 * variant you cannot send to someone is not much use for deciding between three.
 * There is deliberately no visible picker — this is a decision the site makes,
 * not one it asks a reader to make, and a control for choosing decoration would
 * be the loudest thing in the hero.
 *
 * An unknown or absent `?hero=` falls back to `DEFAULT_HERO_VARIANT` rather than
 * rendering nothing, so a typo shows the house crest instead of a hole.
 *
 * ## Why every variant sits in a fixed-height box
 *
 * `HERO_SLOT` is the same height for all three, and the Suspense fallback in
 * app/page.tsx is that same box. The variants are genuinely different sizes — a
 * 128 px seal, a 56 px coin, a 96 px flag — and letting each size its own slot
 * would move the headline, the tagline and both buttons down the page the moment
 * the parameter resolved. One box, centred content, no layout shift, whichever
 * variant wins.
 *
 * ## Reduced motion is the *resting* state, not a disabled one
 *
 * Every animation below is declared inside `@media (prefers-reduced-motion:
 * no-preference)` in app/globals.css, and the base CSS is the *finished* state:
 * the ring fully drawn, the eagle at full opacity, the coin obverse forward. So
 * a reader who has asked their OS for less motion gets the same picture, still,
 * rather than the half-drawn first frame an animation-only definition would
 * freeze them on. That ordering is the whole reason the keyframes carry `from`
 * rather than `to`.
 *
 * ## Everything here is `aria-hidden`
 *
 * For components/brand-mark.tsx's reason: the headline beside this crest already
 * says "Bundestracker", and the eagle *is* that mark. Naming it too would have a
 * screen reader announce the site twice. None of the three carries information
 * the `<h1>` and the tagline under it do not, which is what makes them
 * decoration rather than content — and the honest way to mark decoration up is
 * to hide it. There are no strings here to translate for the same reason.
 */

export const HERO_VARIANTS = ["eagle", "coin", "flag"] as const

export type HeroVariant = (typeof HERO_VARIANTS)[number]

/**
 * The eagle, unless asked otherwise.
 *
 * It is the site's own mark (components/brand-mark.tsx, app/icon.svg), so the
 * crest and the header agree by default and the other two variants read as
 * alternatives to a house style rather than as three equal strangers.
 */
export const DEFAULT_HERO_VARIANT: HeroVariant = "eagle"

/** The query parameter that picks a variant. Named once so the reader of the
 * URL and the reader of this file cannot drift apart. */
export const HERO_PARAM = "hero"

/** Mirrors `isLocale` and `isSeatingColorMode` — a guard, so a `string` from the
 * URL becomes a `HeroVariant` by being checked rather than by being cast. */
export function isHeroVariant(value: string): value is HeroVariant {
  return (HERO_VARIANTS as readonly string[]).includes(value)
}

/**
 * What `?hero=` asked for, or the default.
 *
 * A named function rather than a ternary at the one call site, because this is
 * the whole contract of the URL switch and it is worth being able to state it in
 * a test: absent, empty and unrecognised all mean "the house crest". The
 * alternative — rendering nothing for an unknown value — turns a typo into a
 * hole in the hero, and a hole is indistinguishable from a bug.
 *
 * Case-sensitive, deliberately, matching `isLocale` and `isSeatingColorMode`:
 * the values are lowercase everywhere they are written, and lowercasing here
 * would be this codebase's only parameter that quietly accepts a second
 * spelling.
 */
export function heroVariantFromParam(value: string | null): HeroVariant {
  return value !== null && isHeroVariant(value) ? value : DEFAULT_HERO_VARIANT
}

/**
 * The shared box. Fixed height for the reason given above; `w-fit` so the
 * decoration claims only the width it draws and the headline below keeps its own
 * `max-w-2xl` measure.
 */
const HERO_SLOT = "flex h-32 w-fit items-center"

/**
 * Which component draws which variant.
 *
 * A `Record` keyed by the union rather than a chain of ternaries, so the
 * typecheck fails on a variant added to `HERO_VARIANTS` without a component to
 * draw it. A ternary chain cannot notice that — the last `else` silently
 * absorbs the new value and renders the flag for it, which is the failure the
 * `SEATING_MODES` table in lib/seating.ts is built the same way to avoid.
 */
const HERO_VARIANT_COMPONENTS: Record<HeroVariant, () => React.ReactElement> = {
  eagle: EagleSeal,
  coin: ActivityCoin,
  flag: FederalFlag,
}

/**
 * The crest, for a known variant.
 *
 * Deliberately hook-free so it can be rendered from a Suspense fallback, from a
 * test, or from a future settings panel without dragging `useSearchParams` — and
 * so the URL reading has exactly one home, in `HeroAnimationSlot` below.
 */
export function HeroAnimation({
  variant,
  className,
}: {
  variant: HeroVariant
  className?: string
}) {
  const Crest = HERO_VARIANT_COMPONENTS[variant]

  return (
    <div aria-hidden className={cn(HERO_SLOT, "pointer-events-none", className)}>
      <Crest />
    </div>
  )
}

/**
 * The empty slot, for the moment before the URL is known.
 *
 * Exported rather than spelled out in app/page.tsx so the height lives in one
 * place: a fallback a few pixels off the real thing reintroduces exactly the
 * layout shift the fixed box exists to prevent.
 */
export function HeroAnimationFallback({ className }: { className?: string }) {
  return <div aria-hidden className={cn(HERO_SLOT, "w-32", className)} />
}

/**
 * The crest the URL asked for.
 *
 * ⚠ Must be rendered inside a `<Suspense>` boundary. `useSearchParams` opts its
 * subtree out of static prerendering, and Next.js fails the *build* — not the
 * request — for a component that reads it without one. app/search/page.tsx
 * carries the same note for the same reason.
 */
export function HeroAnimationSlot({ className }: { className?: string }) {
  const params = useSearchParams()

  return (
    <HeroAnimation variant={heroVariantFromParam(params.get(HERO_PARAM))} className={className} />
  )
}

// --- the three variants -----------------------------------------------------

/**
 * The Bundesadler inside a ring that draws itself: a federal seal.
 *
 * ## The eagle is `BrandMark`, not a third copy of the artwork
 *
 * components/brand-mark.tsx says the paths are duplicated into app/icon.svg
 * "deliberately, and this is the one place that trade-off is made". A third copy
 * here — which a `stroke-dashoffset` draw-on of the eagle itself would require,
 * since dashing needs `pathLength` on paths this file would then own — is
 * exactly the drift that note forbids. So the draw-on is moved onto geometry
 * this component *does* own: the ring. `pathLength="1"` normalises the circle's
 * circumference, so the dash arithmetic is `1 → 0` rather than a magic number
 * that breaks the moment the radius changes.
 *
 * `text-gold-brand`, against `BrandMark`'s own `text-gold` default and for the
 * reason that default exists: the ink tier is for hairlines at 20 px, where the
 * identity gold's 2.4:1 reads as a smudge. At 80 px this is a fill, judged as a
 * fill, and the brand colour belongs at full strength — the same call
 * app/globals.css makes for the federal rule. Re-tinting through `className` is
 * what `BrandMark` documents as supported.
 *
 * The ring is rotated a quarter turn so the stroke starts at twelve o'clock;
 * unrotated, an SVG circle begins at three, and a seal that draws itself from
 * the right-hand edge looks like a loading spinner.
 */
function EagleSeal() {
  return (
    <span className="relative grid size-32 shrink-0 place-items-center text-gold-brand">
      <svg
        viewBox="0 0 100 100"
        aria-hidden="true"
        focusable="false"
        className="-rotate-90 absolute inset-0 size-full opacity-70"
      >
        <circle
          className="hero-ring"
          cx="50"
          cy="50"
          r="47"
          pathLength="1"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.25"
          strokeLinecap="round"
        />
      </svg>
      <BrandMark className="hero-mark size-20 text-gold-brand" />
    </span>
  )
}

/**
 * A struck coin turning on its vertical axis: the activity score, as an object.
 *
 * ## Why two faces rather than a spinning image
 *
 * `preserve-3d` with a back face at `rotateY(180deg)` and `backface-visibility:
 * hidden` is what makes the turn read as a *solid* — the coin goes edge-on and
 * genuinely disappears for a frame at 90°, which a rotating flat image never
 * does. Both faces are painted in CSS gradients rather than as artwork, so the
 * whole variant costs one extra element and no request.
 *
 * The obverse carries the eagle in `--gold-foreground` on `--gold-brand`: the
 * brand pair app/globals.css guarantees is "legible by construction", used here
 * as it is meant to be — dark mark on a gold fill, not gold as ink.
 *
 * The spin holds on each face for a beat rather than turning at a constant rate
 * (see `hero-coin-spin`): a coin at uniform angular speed spends most of its
 * cycle unreadable and reads as a wobble. The bob is a separate animation on a
 * separate element on purpose — one element cannot carry two `transform`
 * animations, and nesting them is cheaper than interleaving translate and rotate
 * into a single set of keyframes that would then have to stay in phase.
 */
function ActivityCoin() {
  return (
    <span className="hero-coin-float grid size-32 shrink-0 place-items-center">
      {/* The perspective lives on the parent of the rotating element, not on it:
          a perspective set on the element itself is applied per-transform and
          the coin turns flat. */}
      <span className="grid size-14 place-items-center [perspective:520px]">
        <span className="hero-coin relative size-full">
          <span className="hero-coin-face hero-coin-obverse absolute inset-0 grid place-items-center">
            <BrandMark className="size-7 text-gold-foreground" />
          </span>
          <span className="hero-coin-face hero-coin-reverse absolute inset-0" />
        </span>
      </span>
    </span>
  )
}

/**
 * Black, red and gold on a staff, moving like cloth.
 *
 * ## The wave is light, not geometry
 *
 * The obvious build — three stripes, each skewed on its own phase — opens
 * hairline gaps between them the moment the skew exceeds the overlap, and the
 * flag comes apart into three bars. So the *shape* gets one gentle skew as a
 * whole (pivoting at the staff, which is where a real flag pivots) and the
 * *wave* is a band of light travelling across it. That is also what the eye
 * actually reads as cloth, it cannot tear, and it costs one compositable
 * `background-position` animation rather than three transforms.
 *
 * The three colours come from `federal-flag` in app/globals.css — the vertical
 * twin of the `federal-rule` hairline the header and footer already carry, built
 * from the same three tokens, so the flag in the hero and the rule at the top of
 * the page cannot end up different reds.
 */
function FederalFlag() {
  return (
    <span className="flex h-16 w-24 shrink-0 items-stretch gap-1.5">
      {/* The staff. Without it three horizontal bands are the federal rule at an
          odd size rather than a flag, and the skew below has no visible pivot. */}
      <span className="w-[3px] shrink-0 rounded-full bg-gradient-to-b from-muted-foreground/70 to-muted-foreground/20" />
      {/* The hairline ring is not decoration. `federal-flag` holds the black
          band at a true near-black in *both* themes — the flag is fixed by
          Art. 22 GG, not by the reader's theme — so on a dark page the top
          third has no edge of its own and the cloth appears to start at the red.
          A ring in the border token gives it one without lightening the band,
          which is the trade app/globals.css sets out at the utility. */}
      <span className="hero-flag federal-flag relative flex-1 overflow-hidden rounded-[2px] shadow-sm ring-1 ring-border">
        <span className="hero-flag-sheen absolute inset-0" />
      </span>
    </span>
  )
}
