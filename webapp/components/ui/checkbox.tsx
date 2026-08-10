"use client"

import { CheckIcon } from "lucide-react"
import { Checkbox as CheckboxPrimitive } from "radix-ui"
import type * as React from "react"

import { cn } from "@/lib/utils"

/**
 * A checkbox, on Radix's primitive for the same reason `Label` and `Sheet` are:
 * the keyboard and screen-reader behaviour of a custom control is the part that
 * is easy to get subtly wrong and hard to notice.
 *
 * The focus ring matches `Input` and `Button` exactly — `focus-visible:ring-3
 * ring-ring/50` — because a control that focuses differently from its
 * neighbours reads as a control from somewhere else.
 */
function Checkbox({ className, ...props }: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "peer size-4 shrink-0 rounded-[4px] border border-input bg-transparent shadow-none outline-none transition-shadow focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground dark:bg-input/30 dark:data-[state=checked]:bg-primary",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="flex items-center justify-center text-current transition-none"
      >
        <CheckIcon className="size-3.5" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
