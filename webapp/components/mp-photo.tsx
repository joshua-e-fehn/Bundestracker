import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { initials } from "@/lib/bundestag"
import { cn } from "@/lib/utils"

/**
 * An MP's portrait, or their initials.
 *
 * The fallback is now the exception rather than the rule, but it is still
 * load-bearing. §6.5 measured Wikimedia Commons coverage at 36.5 % of WP21 and
 * concluded the UI would mostly render letters; the Bundestag's own MP listing
 * turned out to publish a portrait for **all 639**, of which 635 join to the
 * roster (pipeline `api/mp_profiles.py`). So most rows are faces — and the
 * handful that are not are real rows, not a temporary gap.
 *
 * ⚠ **These are photographer-credited works, not open-licensed ones** — the one
 * part of §6.5 that still holds. `mps.photoCredit` therefore travels with
 * `mps.photoUrl`, the pipeline drops a portrait that arrives without one, and
 * the images are hotlinked rather than rehosted.
 *
 * The credit is rendered by the *caller*, not here, and only where there is
 * room for it: the profile page prints it under the 112 px portrait. The 32 px
 * avatars in the roster table, the seating tooltip and the feed do not — a
 * credit line under a thumbnail would be longer than the thumbnail. That is the
 * same treatment a newspaper gives a contact-sheet thumbnail, and the full
 * attribution is one click away on the profile. If that judgement is ever
 * revisited, the field is already on every row that carries a portrait, so it
 * is a rendering change and not a data one.
 *
 * Deliberately not `next/image`. The URLs are on `bundestag.de` today and were
 * on Wikimedia Commons in the previous design, so the host list is a property
 * of the data rather than of the build — and every unconfigured host in
 * `next/image` is a hard render error rather than a broken image, which is the
 * wrong trade for a picture that is optional to begin with. `<img>` inside
 * Radix's Avatar degrades to the fallback on error, which is what this data
 * needs. (`next.config.ts` accordingly configures no `remotePatterns`.)
 */
export function MPPhoto({
  name,
  photoUrl,
  className,
}: {
  name: string
  photoUrl: string | null
  className?: string
}) {
  return (
    <Avatar className={cn("size-10", className)}>
      {photoUrl ? <AvatarImage src={photoUrl} alt={name} /> : null}
      <AvatarFallback className="font-medium text-xs">{initials(name)}</AvatarFallback>
    </Avatar>
  )
}
