"use client"

import { SearchIcon, XIcon } from "lucide-react"
import { useRouter } from "next/navigation"
import { useEffect, useId, useRef, useState } from "react"
import { useLocale } from "@/components/providers/locale-provider"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

/**
 * The search box in the header, on every page.
 *
 * A `<form>` that navigates to `/search?q=…`, not a live-querying combobox, and
 * that is the whole design:
 *
 *  - **The result is a page, not a dropdown.** A search here answers with MPs,
 *    each carrying the records that matched and a party breakdown over the
 *    whole set — see convex/search.ts. None of that fits in a popover under a
 *    56 px bar, and truncating it into one would show the reader a different,
 *    worse answer than the page they are one keystroke away from.
 *  - **The URL carries the query.** `?q=` makes a search shareable, linkable
 *    and reachable by the back button, which a component-state search is not.
 *    It is also what lets the /search page render on the server for a reader
 *    arriving from outside.
 *  - **No search-as-you-type.** Each keystroke would be an indexed scan over a
 *    period's whole feed against Convex's 1024-document ceiling (lib/search.ts),
 *    for a query the reader has not finished spelling — and the index has no
 *    typo tolerance, so every prefix of a word they are still typing is a real
 *    query returning real, wrong results.
 *
 * Rendered in two shapes from one component. `variant="inline"` is the header's
 * own box at desktop widths; `variant="page"` is the larger one at the top of
 * /search. One component rather than two so the submit behaviour — trimming,
 * refusing an empty query, where it navigates — is defined once.
 */
export function SearchBar({
  variant = "inline",
  initialQuery = "",
  className,
  autoFocus = false,
}: {
  variant?: "inline" | "page"
  /** What the box starts with. On /search this is the URL's `q`, so the box
   * reflects the results below it rather than sitting empty over them. */
  initialQuery?: string
  className?: string
  autoFocus?: boolean
}) {
  const { t } = useLocale()
  const router = useRouter()
  const [value, setValue] = useState(initialQuery)
  const inputRef = useRef<HTMLInputElement>(null)
  /**
   * Unique per instance, because the header renders two of these at once.
   *
   * Below `xl` the bar's own box is hidden by CSS and the sheet's is shown —
   * but "hidden" is `display: none`, not "absent", so both are in the document
   * and a `variant`-derived id put `id="search-inline"` on both. Two elements
   * with one id is invalid HTML, and the concrete cost is the `<label for>`
   * below: it resolves to the first match, so the sheet's box — the only one a
   * phone reader can use — had no accessible name at all.
   *
   * Found by Playwright refusing to act on an ambiguous selector, which is the
   * same ambiguity a screen reader would have had to resolve.
   */
  const inputId = useId()

  // Follows the URL. Without this, navigating from `?q=klima` to `?q=miet` —
  // through a link, or the back button — leaves the box showing the previous
  // query over the new results.
  useEffect(() => {
    setValue(initialQuery)
  }, [initialQuery])

  function submit(event: React.FormEvent) {
    event.preventDefault()
    const query = value.trim()
    // An empty submit does nothing rather than navigating to a bare /search:
    // the reader pressed enter in a box they had not filled, and sending them
    // to an empty results page answers a question they did not ask.
    if (!query) {
      inputRef.current?.focus()
      return
    }
    router.push(`/search?q=${encodeURIComponent(query)}`)
  }

  const isPage = variant === "page"

  return (
    // `<search>` rather than `<form role="search">`: the element is the
    // semantic one (HTML Living Standard, 2023) and carries the role natively,
    // so the ARIA attribute would be restating what the tag already says. The
    // `<form>` stays inside it — the landmark and the submit target are two
    // different jobs, and Enter has to submit something.
    <search className={cn("flex items-center", isPage ? "w-full" : "w-full max-w-xs", className)}>
      <form onSubmit={submit} className="relative flex w-full items-center">
        {/* The label is visually hidden rather than absent: the placeholder is
          not an accessible name — it disappears the moment anyone types — so
          without this the box announces itself as an unlabelled text field. */}
        <label htmlFor={inputId} className="sr-only">
          {t("common.search")}
        </label>
        <SearchIcon
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute left-3 shrink-0 text-muted-foreground",
            isPage ? "size-5" : "size-4",
          )}
        />
        <Input
          id={inputId}
          ref={inputRef}
          // `type="search"`, so a phone keyboard offers a search key and the
          // browser's own clear affordance appears where it has one.
          type="search"
          name="q"
          value={value}
          // Only ever true on /search, where the box is the page's purpose and
          // the reader arrived to type in it. Never in the header, where
          // stealing focus on every navigation would be hostile — which is why
          // this is a prop rather than a constant.
          autoFocus={autoFocus}
          onChange={(event) => setValue(event.target.value)}
          placeholder={isPage ? t("search.placeholder") : t("search.navPlaceholder")}
          className={cn("pl-9", isPage ? "h-12 pr-24 text-base md:text-base" : "h-9 pr-9")}
        />

        {value ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t("search.clear")}
            onClick={() => {
              setValue("")
              inputRef.current?.focus()
            }}
            className={cn("absolute", isPage ? "right-20" : "right-1")}
          >
            <XIcon />
          </Button>
        ) : null}

        {/* A visible submit only on the page. In the header the box is one of
          five controls in a 56 px bar and Enter already submits; a button there
          would cost width the nav links need. */}
        {isPage ? (
          <Button type="submit" className="absolute right-1.5 h-9">
            {t("search.submit")}
          </Button>
        ) : (
          <button type="submit" className="sr-only">
            {t("search.submit")}
          </button>
        )}
      </form>
    </search>
  )
}
