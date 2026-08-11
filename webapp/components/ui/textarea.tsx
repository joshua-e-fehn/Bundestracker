import type * as React from "react"

import { cn } from "@/lib/utils"

/**
 * A multi-line text field, styled as the sibling of `Input`.
 *
 * Every class here is `Input`'s, minus the ones that only make sense on a
 * single-line control (`h-8`, `file:*`) and plus `field-sizing-content`, which
 * lets the box grow with what is typed instead of forcing a scroll inside a
 * three-line window. `min-h` keeps it from starting as a one-liner that gives
 * no signal that a long answer is welcome.
 */
function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "field-sizing-content min-h-20 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        className,
      )}
      {...props}
    />
  )
}

export { Textarea }
