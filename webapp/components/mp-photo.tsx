"use client"

import { useLocale } from "@/components/providers/locale-provider"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { initials } from "@/lib/bundestag"
import { cn } from "@/lib/utils"

/**
 * An MP's portrait, or their initials.
 *
 * ## The credit is not optional, and that is why it lives here
 *
 * `convex/schema.ts:207` states the licence condition plainly: these are
 * photographer-credited works, not open-licensed ones, and displaying the credit
 * is the condition of displaying the photograph. The pipeline honours that on
 * the way in — a portrait arriving without a credit is dropped rather than
 * stored bare — and 633 of the 635 WP21 rows carry one.
 *
 * The frontend did not honour it. `photoCredit` appeared nowhere in
 * `components/` or `app/`, so every portrait the site rendered was rendered
 * uncredited. That is a licensing exposure rather than a cosmetic gap, and it
 * was already live: four profiles served real photographs during one browser
 * test window with credits such as `Natalie Pawlik/ Photothek Media Lab`
 * nowhere in the page.
 *
 * So the credit is enforced by *this component* rather than left to each caller
 * to remember. `credit` is a required prop — a caller that has not thought about
 * it gets a type error rather than an uncredited photograph — and a `photoUrl`
 * with no credit falls back to initials, which is the same rule the pipeline
 * applies at the other end. A surface that cannot supply the credit therefore
 * cannot display the photo, which is the only arrangement that makes the licence
 * condition structural instead of a convention six components have to keep.
 *
 * ## How it is shown
 *
 * `title` on the image, so a reader can hover any portrait anywhere and see whose
 * work it is, plus a visually-hidden line for assistive technology. That is the
 * whole treatment at avatar sizes — a 24 px dot in a table row cannot carry
 * visible attribution without becoming unreadable. Where a portrait is the
 * subject of the page rather than a label on a row, the credit is printed:
 * `MPPhotoCredit` below does that, and components/mp-profile.tsx uses it under
 * the 112 px portrait.
 *
 * Deliberately not `next/image`. The sources are `bundestag.de` URLs the
 * pipeline resolves per MP, so the host list is not known at build time, and
 * every unconfigured host is a hard render error rather than a broken image.
 * `<img>` inside Radix's Avatar degrades to the fallback on error, which is what
 * this data needs — §6.5's WAF rate-limits portraits by IP, so the fallback is
 * a live path and not a theoretical one.
 */
export function MPPhoto({
  name,
  photoUrl,
  /** Whose photograph it is, e.g. `Sanae Abdi/SPD-Fraktion`. Required, not
   * optional: see the note above on why a caller must supply it or show
   * initials. Null is the honest answer for the four rows that have no credit,
   * and it suppresses the photo rather than the attribution. */
  credit,
  className,
}: {
  name: string
  photoUrl: string | null | undefined
  credit: string | null | undefined
  className?: string
}) {
  const { t } = useLocale()
  // Both, or neither. The licence condition, as a single expression.
  const showPhoto = Boolean(photoUrl && credit)
  const attribution = credit ? t("mp.photoCredit", { credit }) : null

  return (
    <Avatar className={cn("size-10", className)}>
      {showPhoto && photoUrl ? (
        <AvatarImage src={photoUrl} alt={name} title={attribution ?? undefined} />
      ) : null}
      <AvatarFallback className="font-medium text-xs">{initials(name)}</AvatarFallback>
      {showPhoto && attribution ? <span className="sr-only">{attribution}</span> : null}
    </Avatar>
  )
}

/**
 * The printed credit line under a portrait.
 *
 * Separate from `MPPhoto` because it is a different claim on the layout: the
 * avatar is a label on a row and this is a caption under a picture, so only the
 * surface where the portrait *is* the content — the profile page — has room for
 * it. Rendering nothing when there is no visible photograph keeps a stray
 * attribution from appearing under a set of initials.
 */
export function MPPhotoCredit({
  photoUrl,
  credit,
  className,
}: {
  photoUrl: string | null | undefined
  credit: string | null | undefined
  className?: string
}) {
  const { t } = useLocale()
  if (!photoUrl || !credit) return null
  return (
    <p className={cn("text-[0.7rem] text-muted-foreground leading-snug", className)}>
      {t("mp.photoCredit", { credit })}
    </p>
  )
}
