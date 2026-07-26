"use client"

<<<<<<< HEAD
import type * as React from "react"
=======
import * as React from "react"
>>>>>>> 750938d (feat: site layout, bilingual chrome, and the homepage (#6))

import { cn } from "@/lib/utils"

function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
<<<<<<< HEAD
    <div data-slot="table-container" className="relative w-full overflow-x-auto">
=======
    <div
      data-slot="table-container"
      className="relative w-full overflow-x-auto"
    >
>>>>>>> 750938d (feat: site layout, bilingual chrome, and the homepage (#6))
      <table
        data-slot="table"
        className={cn("w-full caption-bottom text-sm", className)}
        {...props}
      />
    </div>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
<<<<<<< HEAD
  return <thead data-slot="table-header" className={cn("[&_tr]:border-b", className)} {...props} />
=======
  return (
    <thead
      data-slot="table-header"
      className={cn("[&_tr]:border-b", className)}
      {...props}
    />
  )
>>>>>>> 750938d (feat: site layout, bilingual chrome, and the homepage (#6))
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  )
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
<<<<<<< HEAD
      className={cn("border-t bg-muted/50 font-medium [&>tr]:last:border-b-0", className)}
=======
      className={cn(
        "border-t bg-muted/50 font-medium [&>tr]:last:border-b-0",
        className
      )}
>>>>>>> 750938d (feat: site layout, bilingual chrome, and the homepage (#6))
      {...props}
    />
  )
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "border-b transition-colors hover:bg-muted/50 has-aria-expanded:bg-muted/50 data-[state=selected]:bg-muted",
<<<<<<< HEAD
        className,
=======
        className
>>>>>>> 750938d (feat: site layout, bilingual chrome, and the homepage (#6))
      )}
      {...props}
    />
  )
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "h-10 px-2 text-left align-middle font-medium whitespace-nowrap text-foreground [&:has([role=checkbox])]:pr-0",
<<<<<<< HEAD
        className,
=======
        className
>>>>>>> 750938d (feat: site layout, bilingual chrome, and the homepage (#6))
      )}
      {...props}
    />
  )
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
<<<<<<< HEAD
      className={cn("p-2 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0", className)}
=======
      className={cn(
        "p-2 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0",
        className
      )}
>>>>>>> 750938d (feat: site layout, bilingual chrome, and the homepage (#6))
      {...props}
    />
  )
}

<<<<<<< HEAD
function TableCaption({ className, ...props }: React.ComponentProps<"caption">) {
=======
function TableCaption({
  className,
  ...props
}: React.ComponentProps<"caption">) {
>>>>>>> 750938d (feat: site layout, bilingual chrome, and the homepage (#6))
  return (
    <caption
      data-slot="table-caption"
      className={cn("mt-4 text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

<<<<<<< HEAD
export { Table, TableHeader, TableBody, TableFooter, TableHead, TableRow, TableCell, TableCaption }
=======
export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}
>>>>>>> 750938d (feat: site layout, bilingual chrome, and the homepage (#6))
