"use client"

import { useQuery } from "convex/react"
import { useEffect, useState } from "react"
import { useLocale } from "@/components/providers/locale-provider"
import { api } from "@/convex/_generated/api"
import { relativeTime } from "@/lib/relative-time"

/**
 * "Daten Stand: vor 2 Stunden" — the site's freshness surface.
 *
 * ## Why the footer needs it
 *
 * Bundestrack presents official parliamentary data under its own name and
 * scores it (AGENTS.md, lib/scoring.ts). A reader is entitled to know on
 * every page how recent the picture is, and until now they had to infer it
 * from the newest date on the feed — which is a claim about the *Bundestag*
 * (when did the chamber last sit), not about ingestion (when did the site
 * last pick up the row). The disclaimer beside this widget already tells
 * them the first half; this is the second.
 *
 * ## What the timestamp actually is
 *
 * The `_creationTime` of the newest `activityEvents` row — see
 * `convex/activityEvents.ts:getLatestIngestTime` for why that is the
 * site-wide freshness signal rather than a bespoke `lastSyncAt` table. Every
 * ingest stage that writes a user-visible record writes into this table too,
 * so a stalled pipeline surfaces here.
 *
 * ## The three states, and the honest empty one
 *
 *  - **Loading.** `useQuery(...)` returns `undefined` until Convex answers.
 *    We render nothing rather than a spinner: the footer is chrome, and a
 *    row that grows on hydration would shove the disclaimer down.
 *  - **A number.** Rendered as a relative phrase ("vor 2 Stunden") with the
 *    absolute UTC timestamp in the `title` tooltip and inside the `<time>`
 *    element's `dateTime` attribute — so a screen reader, a Selenium check,
 *    a browser's built-in "reveal date" gesture and a human hovering all see
 *    the same exact moment. `relativeTime` is the same helper the feed uses,
 *    which pairs the widget with the rest of the site's time vocabulary.
 *  - **`null`.** The pipeline has never run against this deployment. Neither
 *    "Data as of: 1970" nor a hidden widget is honest: the first fabricates
 *    a timestamp, the second lets a broken pipeline stay invisible. We
 *    render "Daten Stand: unbekannt" instead, so a fresh deployment that
 *    forgot its cron gets called out by the widget on every page.
 *
 * ## No cron status inference
 *
 * A "sync finished at X" widget would tell the reader whether a cron
 * *reported* success, not whether the resulting data reached the tables. This
 * one reads the tables directly — the failure mode of a cron that runs
 * nightly and finds nothing new (unheard-of but possible) is a truthful
 * "Daten Stand: yesterday", not a falsely-recent "sync finished 2 minutes ago".
 * The audit named the second explicitly as the wrong signal.
 *
 * ## Not server-rendered
 *
 * A `useQuery` hook in a client component, not `fetchQuery` in a server one:
 * a Convex round-trip in the layout would block the document on an uncached
 * read for every page, and the layout is what runs before anything. The
 * widget flickers in on hydration, and the empty pre-hydration state is
 * what its absence would look like anyway. The freshness answer is not
 * SEO-visible content; the "one page in both languages" rule (lib/i18n.ts)
 * meant client-hydrated text is the site-wide pattern.
 */
export function DataAsOf() {
  const { locale, t } = useLocale()
  const latest = useQuery(api.activityEvents.getLatestIngestTime)
  // `now` refreshes on mount and every minute so the relative phrase stays
  // honest on a long-lived tab. Reading Date.now() during render would
  // desync SSR/hydration; a state initialised in a mount effect leaves the
  // first paint blank (which is the loading branch anyway).
  const [now, setNow] = useState<number | null>(null)
  useEffect(() => {
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])

  // Loading: `useQuery` returns undefined before the first response.
  if (latest === undefined || now === null) return null

  if (latest === null) {
    // The honest "unavailable" state — see the header. Plain `<span>`
    // rather than `<time>` because there is no timestamp; the label the
    // string itself carries is what a screen reader picks up.
    return <span className="text-muted-foreground text-xs">{t("footer.dataAsOfUnknown")}</span>
  }

  const isoUtc = new Date(latest).toISOString()
  const phrase = relativeTime(latest, now, locale)
  // Two different consumers, two different formats:
  //
  //  - `dateTime={isoUtc}` is what a machine reads — a screen reader that
  //    announces dates from `<time>` on request, a Selenium check, or the
  //    browser's built-in "reveal date" gesture. The ISO string is the
  //    unambiguous serialisation, so this stays as-is.
  //
  //  - `title={humanAbsolute}` is what a mouse reader hovers over. A raw
  //    ISO with milliseconds ("2026-07-30T14:23:45.123Z") is technically
  //    correct and practically unreadable — an ordinary reader sees an
  //    error string rather than a date. `Intl.DateTimeFormat` in the
  //    reader's own locale, spelled out with `dateStyle: "long"` and
  //    `timeStyle: "short"`, renders as "30. Juli 2026 um 14:23" /
  //    "July 30, 2026 at 2:23 PM" — the same information, in the shape
  //    the tooltip's audience expects to read.
  //
  //  The locale-formatted string is time-zone-aware (uses the reader's
  //  own zone), so a German visitor in Berlin sees Berlin time and an
  //  American visitor sees Eastern; the ISO in `dateTime` stays UTC so
  //  the two are reconcilable. `absoluteDateTime` is the same shape
  //  `lib/relative-time.ts:absoluteDate` uses for feed tooltips, kept
  //  local to this component because that helper is date-only and this
  //  needs the time-of-day.
  const humanAbsolute = new Intl.DateTimeFormat(locale, {
    dateStyle: "long",
    timeStyle: "short",
  }).format(new Date(latest))
  return (
    <time dateTime={isoUtc} title={humanAbsolute} className="text-muted-foreground text-xs">
      {t("footer.dataAsOf", { when: phrase })}
    </time>
  )
}
