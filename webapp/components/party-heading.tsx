"use client"

import Link from "next/link"
import { useLocale } from "@/components/providers/locale-provider"
import { partyByKey, type PartyKey } from "@/lib/parties"

/**
 * A Fraktion page's title, standfirst and way back.
 *
 * `PageHeading` is the neighbouring component for exactly this and cannot serve
 * here: it takes translation *keys* with no values, and this title interpolates
 * a party label. Passing the finished string to it instead would be worse than a
 * second component — a server page resolving the text would freeze it at the
 * server's negotiated locale, so the heading would stay German while the table
 * under it switched to English, which is the precise failure `PageHeading`'s own
 * header warns about.
 *
 * So the *key* still crosses the boundary and the interpolation happens on the
 * client. The party key travels rather than the label, for the same reason the
 * route uses one: `partyByKey` is where a group's canonical spelling lives, and
 * a label passed as a prop would be a second one.
 */
export function PartyHeading({ party }: { party: PartyKey }) {
  const { t } = useLocale()

  return (
    <header className="flex flex-col gap-2">
      <Link
        href="/parties"
        className="w-fit rounded-md text-muted-foreground text-sm underline underline-offset-4 outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        ← {t("parties.backToParties")}
      </Link>
      <h1 className="font-semibold text-3xl tracking-tight">
        {t("parties.members.title", { party: partyByKey(party).label })}
      </h1>
      <p className="text-muted-foreground">{t("parties.members.subtitle")}</p>
    </header>
  )
}
