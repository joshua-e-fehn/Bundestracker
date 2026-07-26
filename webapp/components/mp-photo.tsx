import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { initials } from "@/lib/bundestag"
import { cn } from "@/lib/utils"

/**
 * An MP's portrait, or their initials.
 *
 * The fallback is the common case, not the exception: §6.5 of
 * docs/api-research.md measured Wikimedia Commons coverage at **36.5 %** of
 * WP21 and warns in as many words to "design the UI with a graceful
 * initials/placeholder fallback". Roughly two rows in three render as letters.
 *
 * Deliberately not `next/image`. The sources are Wikimedia Commons URLs the
 * pipeline resolves per MP, so the host list is not known at build time, and
 * every unconfigured host is a hard render error rather than a broken image —
 * a wrong trade for a picture that is optional to begin with. `<img>` inside
 * Radix's Avatar degrades to the fallback on error, which is the behaviour this
 * data needs.
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
