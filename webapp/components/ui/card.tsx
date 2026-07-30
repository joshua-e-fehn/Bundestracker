import type * as React from "react"

import { cn } from "@/lib/utils"

function Card({
  className,
  size = "default",
  ...props
}: React.ComponentProps<"div"> & { size?: "default" | "sm" }) {
  return (
    <div
      data-slot="card"
      data-size={size}
      className={cn(
        "group/card flex flex-col gap-(--card-spacing) overflow-hidden rounded-xl bg-card py-(--card-spacing) text-sm text-card-foreground ring-1 ring-foreground/10 [--card-spacing:--spacing(4)] has-data-[slot=card-footer]:pb-0 has-[>img:first-child]:pt-0 data-[size=sm]:[--card-spacing:--spacing(3)] data-[size=sm]:has-data-[slot=card-footer]:pb-0 *:[img:first-child]:rounded-t-xl *:[img:last-child]:rounded-b-xl",
        className,
      )}
      {...props}
    />
  )
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        "group/card-header @container/card-header grid auto-rows-min items-start gap-1 rounded-t-xl px-(--card-spacing) has-data-[slot=card-action]:grid-cols-[1fr_auto] has-data-[slot=card-description]:grid-rows-[auto_auto] [.border-b]:pb-(--card-spacing)",
        className,
      )}
      {...props}
    />
  )
}

/**
 * Card title.
 *
 * ## Why this accepts an `as` element
 *
 * The card was originally a chrome-only primitive: the caller placed a title
 * inside, and the surrounding page owned heading order. In practice most
 * cards on `/mps/[id]` and `/feed` render a title that IS the primary label
 * of a landmark region — the "Latest speeches" panel, the biography panel,
 * the ballot list — and a `<div>` there leaves screen-reader landmark
 * navigation with only the page's `<h1>` to jump to. F-05 of the review
 * (2026-07-30) flagged this on the MP profile: five panel titles, none of
 * them announced as headings.
 *
 * `as` accepts any of `h2` through `h6` (or `div`, the default). Callers
 * inside a page whose top heading is the `<h1>` should pass `as="h2"`; the
 * default stays `div` for the many existing call sites where the surrounding
 * page owns heading order or the card is a leaf (a tooltip preview, a nested
 * card inside a section already headed by an `h2`).
 *
 * ## Why not always `h2`
 *
 * A default of `h2` would silently promote every existing CardTitle on the
 * site and, in several places, would land two `h2`s inside one `<section>`
 * already headed by an `h2`. The opt-in shape puts the decision at the call
 * site — the same argument `CardTitle` originally made for keeping heading
 * order out of the primitive.
 */
type CardTitleAs = "h2" | "h3" | "h4" | "h5" | "h6" | "div"
function CardTitle({
  className,
  as: As = "div",
  ...props
}: React.ComponentProps<"div"> & { as?: CardTitleAs }) {
  return (
    <As
      data-slot="card-title"
      className={cn(
        "font-heading text-base leading-snug font-medium group-data-[size=sm]/card:text-sm",
        className,
      )}
      {...(props as React.ComponentProps<typeof As>)}
    />
  )
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-action"
      className={cn("col-start-2 row-span-2 row-start-1 self-start justify-self-end", className)}
      {...props}
    />
  )
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="card-content" className={cn("px-(--card-spacing)", className)} {...props} />
  )
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn(
        "flex items-center rounded-b-xl border-t bg-muted/50 p-(--card-spacing)",
        className,
      )}
      {...props}
    />
  )
}

export { Card, CardHeader, CardFooter, CardTitle, CardAction, CardDescription, CardContent }
