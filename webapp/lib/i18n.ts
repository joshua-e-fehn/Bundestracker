/**
 * Bilingual strings: German by default, English on request.
 *
 * Hand-rolled rather than next-intl, because the requirement here is narrower
 * than a routing library. Bundestrack has no per-locale URLs — one page serves
 * both languages and the toggle in the nav swaps them client-side — so the
 * middleware, the `[locale]` segment and the message-loading machinery a full
 * i18n framework brings would all be dead weight. What is left is a dictionary
 * and a lookup, which is this file.
 *
 * The type system does the work a framework usually does:
 *
 *  - `Dictionary` is inferred from the German dictionary, so a key that does
 *    not exist is a compile error at the call site.
 *  - `en` is annotated `Dictionary`, so adding a German string without its
 *    English counterpart fails the typecheck. Translations cannot silently
 *    drift out of sync; `pixi run typecheck` is the gate.
 *
 * Usage:
 *
 *   import { t, DEFAULT_LOCALE } from "@/lib/i18n"
 *   t("nav.members")                 // "Abgeordnete"  (German default)
 *   t("nav.members", "en")           // "Members"
 *   t("mp.activityCount", "de", { count: 42 })
 *
 * German is the default because the audience is German and the subject is the
 * Bundestag. `DEFAULT_LOCALE` is exported rather than inlined so that is one
 * decision rather than one per call site.
 */

export const LOCALES = ["de", "en"] as const

export type Locale = (typeof LOCALES)[number]

/** German. The default — see the note above. */
export const DEFAULT_LOCALE: Locale = "de"

export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value)
}

/**
 * Locale names in their own language, for the toggle.
 * "Deutsch", not "German" — a language picker that names languages in a
 * language you may not read is not much of a picker.
 */
export const LOCALE_LABELS: Record<Locale, string> = {
  de: "Deutsch",
  en: "English",
}

// --- dictionaries ---------------------------------------------------------

/**
 * Flat dot-separated keys rather than nested objects.
 *
 * Nesting reads better in the source but makes the lookup a recursive walk and
 * the key type a recursive conditional. A flat map keeps both trivial, and the
 * dots still group things for a human scanning the file.
 */
const de = {
  // "Bundestracker", not "Bundestrack": the rename in 26b564a updated the
  // README and AGENTS.md but missed this dictionary, which is what the UI
  // actually renders. The package name stays `bundestrack`.
  "app.name": "Bundestracker",
  "app.tagline": "Objektiver Aktivitäts-Tracker für den Deutschen Bundestag",
  "app.description":
    "Nachvollziehbare, messbare Aktivität der Mitglieder des Deutschen Bundestages — aus offiziellen Daten.",

  "nav.home": "Startseite",
  "nav.members": "Abgeordnete",
  "nav.votes": "Abstimmungen",
  "nav.motions": "Anträge",
  "nav.rankings": "Rangliste",
  "nav.activity": "Aktivität",
  "nav.about": "Über",
  "nav.language": "Sprache",
  "nav.theme": "Design",
  "nav.menu": "Menü",
  "nav.openMenu": "Menü öffnen",
  "nav.closeMenu": "Menü schließen",

  "theme.light": "Hell",
  "theme.dark": "Dunkel",
  "theme.system": "System",

  "auth.signIn": "Anmelden",
  "auth.signOut": "Abmelden",
  "auth.signInWithGoogle": "Mit Google anmelden",
  "auth.signInWithGitHub": "Mit GitHub anmelden",
  "auth.account": "Konto",
  // The sign-in page has to answer "why would I?", because the answer is not
  // "to see the data" — all of it is public without an account.
  "auth.optionalNotice":
    "Anmelden ist optional. Alle Daten sind ohne Konto einsehbar; ein Konto speichert eigene Gewichtungen und gefolgte Abgeordnete.",

  "common.loading": "Wird geladen …",
  "common.error": "Etwas ist schiefgelaufen.",
  "common.retry": "Erneut versuchen",
  "common.notFound": "Nicht gefunden",
  "common.search": "Suchen",
  // Distinct from `common.loading` on purpose: an empty section and a loading
  // one look alike, and only one of them is worth waiting for.
  "common.noData": "Noch keine Daten",
  "common.noDataHint": "Die Datenpipeline hat für diesen Bereich noch nichts geladen.",

  "mp.motions": "Anträge",
  "mp.speeches": "Reden",
  "mp.votes": "Abstimmungen",
  "mp.questions": "Anfragen",
  "mp.committees": "Ausschüsse",
  "mp.party": "Fraktion",
  "mp.constituency": "Wahlkreis",
  "mp.electoralPeriod": "Wahlperiode",
  "mp.activityScore": "Aktivitätswert",

  "home.heroLead":
    "Wie ein Beitragsdiagramm für Abgeordnete: Anträge, Reden, Abstimmungen, Anfragen und Ausschussarbeit — jede Zahl belegt durch ein offizielles Dokument des Bundestages.",
  "home.browseAllMPs": "Alle Abgeordneten ansehen",
  "home.viewRankings": "Rangliste ansehen",

  "home.statsTitle": "Der Bundestag in Zahlen",
  "home.statMPs": "Abgeordnete",
  "home.statNamedVotes": "Namentliche Abstimmungen",
  "home.statMotions": "Anträge & Gesetzentwürfe",
  // "Redebeiträge", not "Reden": a row is one speaker's turn, and §5.2 counts
  // 197 speaker paragraphs against 112 `<rede>` elements in one sitting. A card
  // headed "Reden" would read about 75 % high.
  "home.statSpeeches": "Redebeiträge",
  // The one caveat that belongs on the front page rather than buried: a named
  // ballot is the exception in the Bundestag, not the rule, so this figure is
  // not "how often they voted".
  "home.statNamedVotesNote":
    "Nur namentliche Abstimmungen — für alle übrigen Abstimmungen existiert kein Einzelnachweis.",

  "home.topMPsTitle": "Aktivste Abgeordnete",
  "home.topMPsSubtitle": "Nach Aktivitätswert in der laufenden Wahlperiode",
  "home.latestVotesTitle": "Neueste namentliche Abstimmungen",
  "home.feedTitle": "Zuletzt geschehen",
  "home.showAll": "Alle ansehen",

  "vote.yes": "Ja",
  "vote.no": "Nein",
  "vote.abstain": "Enthaltung",
  "vote.invalid": "Ungültig",
  "vote.absent": "Nicht abgegeben",

  "event.motion": "Antrag",
  "event.speech": "Rede",
  "event.vote": "Abstimmung",
  "event.question": "Anfrage",
  "event.bill": "Gesetzentwurf",
  "event.committee": "Ausschuss",
  "event.activity": "Aktivität",

  "footer.dataSource": "Datenquelle",
  "footer.dataSourceName": "Deutscher Bundestag — Open Data",
  "footer.sourceCode": "Quellcode",
  "footer.builtBy": "Erstellt von Joshua Fehn",
  "footer.disclaimer":
    "Kein offizielles Angebot des Deutschen Bundestages. Alle Angaben stammen aus öffentlich zugänglichen amtlichen Daten.",
} as const

/**
 * The shape every locale must satisfy.
 * Derived from `de`, which makes German the schema as well as the default.
 */
export type Dictionary = Record<keyof typeof de, string>

/** Translation key. Misspell one and the typecheck fails. */
export type TranslationKey = keyof typeof de

const en: Dictionary = {
  "app.name": "Bundestracker",
  "app.tagline": "Objective Activity Tracker for the German Bundestag",
  "app.description":
    "Transparent, measurable activity of the members of the German Bundestag — from official records.",

  "nav.home": "Home",
  "nav.members": "Members",
  "nav.votes": "Votes",
  "nav.motions": "Motions",
  "nav.rankings": "Rankings",
  "nav.activity": "Activity",
  "nav.about": "About",
  "nav.language": "Language",
  "nav.theme": "Theme",
  "nav.menu": "Menu",
  "nav.openMenu": "Open menu",
  "nav.closeMenu": "Close menu",

  "theme.light": "Light",
  "theme.dark": "Dark",
  "theme.system": "System",

  "auth.signIn": "Sign in",
  "auth.signOut": "Sign out",
  "auth.signInWithGoogle": "Sign in with Google",
  "auth.signInWithGitHub": "Sign in with GitHub",
  "auth.account": "Account",
  "auth.optionalNotice":
    "Signing in is optional. All data is viewable without an account; an account saves your own score weightings and followed members.",

  "common.loading": "Loading …",
  "common.error": "Something went wrong.",
  "common.retry": "Try again",
  "common.notFound": "Not found",
  "common.search": "Search",
  "common.noData": "No data yet",
  "common.noDataHint": "The data pipeline has not loaded anything for this section yet.",

  "mp.motions": "Motions",
  "mp.speeches": "Speeches",
  "mp.votes": "Votes",
  "mp.questions": "Questions",
  "mp.committees": "Committees",
  "mp.party": "Party",
  "mp.constituency": "Constituency",
  "mp.electoralPeriod": "Electoral period",
  "mp.activityScore": "Activity score",

  "home.heroLead":
    "A contributions graph for members of parliament: motions, speeches, votes, questions and committee work — every figure backed by an official Bundestag record.",
  "home.browseAllMPs": "Browse all MPs",
  "home.viewRankings": "View rankings",

  "home.statsTitle": "The Bundestag in numbers",
  "home.statMPs": "Members",
  "home.statNamedVotes": "Named votes",
  "home.statMotions": "Motions & bills",
  "home.statSpeeches": "Speech contributions",
  "home.statNamedVotesNote":
    "Named ballots only — for every other vote, no per-member record exists.",

  "home.topMPsTitle": "Most active members",
  "home.topMPsSubtitle": "By activity score in the current electoral period",
  "home.latestVotesTitle": "Latest named votes",
  "home.feedTitle": "Latest activity",
  "home.showAll": "Show all",

  "vote.yes": "Yes",
  "vote.no": "No",
  "vote.abstain": "Abstained",
  "vote.invalid": "Invalid",
  "vote.absent": "Did not vote",

  "event.motion": "Motion",
  "event.speech": "Speech",
  "event.vote": "Vote",
  "event.question": "Question",
  "event.bill": "Bill",
  "event.committee": "Committee",
  "event.activity": "Activity",

  "footer.dataSource": "Data source",
  "footer.dataSourceName": "Deutscher Bundestag — Open Data",
  "footer.sourceCode": "Source code",
  "footer.builtBy": "Built by Joshua Fehn",
  "footer.disclaimer":
    "Not an official service of the German Bundestag. All figures come from publicly available official data.",
}

export const dictionaries: Record<Locale, Dictionary> = { de, en }

// --- lookup ---------------------------------------------------------------

/** Values substitutable into a string via `{name}` placeholders. */
export type TranslationValues = Record<string, string | number>

/**
 * Look up `key` in `locale`, substituting any `{placeholder}` values.
 *
 * Falls back to German rather than to the key itself: a missing English string
 * should show the German one, which a reader can at least act on, instead of
 * leaking `mp.activityScore` into the page. The fallback is unreachable while
 * the typecheck passes — `en` is typed as a complete `Dictionary` — so it only
 * covers a dictionary built at runtime.
 */
export function t(
  key: TranslationKey,
  locale: Locale = DEFAULT_LOCALE,
  values?: TranslationValues,
): string {
  const template = dictionaries[locale]?.[key] ?? dictionaries[DEFAULT_LOCALE][key] ?? key
  return values ? interpolate(template, values) : template
}

/**
 * A `t` bound to one locale, for components that translate more than once.
 *
 *   const tr = getTranslator(locale)
 *   tr("nav.members")
 */
export function getTranslator(locale: Locale = DEFAULT_LOCALE) {
  return (key: TranslationKey, values?: TranslationValues) => t(key, locale, values)
}

/**
 * Replaces `{name}` with `values.name`.
 *
 * An unmatched placeholder is left as-is rather than blanked, so a missing
 * value shows up as `{count}` on the page — visible in review, where an empty
 * string reads as intentional.
 */
function interpolate(template: string, values: TranslationValues): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in values ? String(values[name]) : match,
  )
}

/**
 * Picks the best supported locale from an `Accept-Language` header.
 *
 * Server components have no access to the client-side toggle, so this is how
 * the first render guesses. Quality values are honoured; anything unsupported
 * falls through to German.
 */
export function localeFromAcceptLanguage(header: string | null | undefined): Locale {
  if (!header) return DEFAULT_LOCALE

  const ranked = header
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";")
      const q = params.find((p) => p.trim().startsWith("q="))
      return {
        // "de-DE" and "de" both select German.
        base: tag.trim().toLowerCase().split("-")[0],
        quality: q ? Number.parseFloat(q.split("=")[1]) || 0 : 1,
      }
    })
    .sort((a, b) => b.quality - a.quality)

  return (ranked.find((entry) => isLocale(entry.base))?.base as Locale) ?? DEFAULT_LOCALE
}
