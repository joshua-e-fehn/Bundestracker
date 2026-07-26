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
  "app.name": "Bundestrack",
  "app.tagline": "Parlamentarische Aktivität, objektiv gemessen.",
  "app.description":
    "Nachvollziehbare, messbare Aktivität der Mitglieder des Deutschen Bundestages — aus offiziellen Daten.",

  "nav.home": "Startseite",
  "nav.members": "Abgeordnete",
  "nav.activity": "Aktivität",
  "nav.about": "Über",
  "nav.language": "Sprache",
  "nav.theme": "Design",

  "auth.signIn": "Anmelden",
  "auth.signOut": "Abmelden",
  "auth.signInWithGoogle": "Mit Google anmelden",
  "auth.signInWithGitHub": "Mit GitHub anmelden",
  // The sign-in page has to answer "why would I?", because the answer is not
  // "to see the data" — all of it is public without an account.
  "auth.optionalNotice":
    "Anmelden ist optional. Alle Daten sind ohne Konto einsehbar; ein Konto speichert eigene Gewichtungen und gefolgte Abgeordnete.",

  "common.loading": "Wird geladen …",
  "common.error": "Etwas ist schiefgelaufen.",
  "common.retry": "Erneut versuchen",
  "common.notFound": "Nicht gefunden",
  "common.search": "Suchen",
  "common.all": "Alle",
  "common.none": "Keine Angabe",
  "common.reset": "Zurücksetzen",
  "common.showMore": "Mehr anzeigen",
  "common.comingSoon": "Demnächst verfügbar",
  "common.previous": "Zurück",
  "common.next": "Weiter",
  "common.page": "Seite {page} von {total}",
  "common.noResults": "Keine Treffer.",

  "mp.motions": "Anträge",
  "mp.speeches": "Reden",
  "mp.votes": "Abstimmungen",
  "mp.questions": "Anfragen",
  "mp.committees": "Ausschüsse",
  "mp.party": "Fraktion",
  "mp.constituency": "Wahlkreis",
  "mp.electoralPeriod": "Wahlperiode",
  "mp.activityScore": "Aktivitätswert",

  // --- MP list ---
  "mps.title": "Abgeordnete",
  "mps.subtitle": "Alle Mitglieder des Deutschen Bundestages der {wahlperiode}. Wahlperiode.",
  "mps.searchPlaceholder": "Nach Name oder Wahlkreis suchen …",
  "mps.filterFraktion": "Fraktion",
  "mps.filterState": "Bundesland",
  "mps.filterScore": "Mindest-Aktivitätswert",
  "mps.count": "{count} von {total} Abgeordneten",
  "mps.empty": "Keine Abgeordneten entsprechen den Filtern.",
  "mps.emptyRoster": "Für diese Wahlperiode sind noch keine Abgeordneten geladen.",
  "mps.columnName": "Name",
  "mps.columnConstituency": "Wahlkreis",
  "mps.columnScore": "Aktivitätswert",
  "mps.columnParticipation": "Abstimmungsteilnahme",
  "mps.listMandate": "Landesliste",

  // --- MP profile ---
  "mp.backToList": "Zurück zur Übersicht",
  "mp.notFound": "Diese Abgeordnete oder dieser Abgeordnete wurde nicht gefunden.",
  "mp.biography": "Biografie",
  "mp.birthDate": "Geboren",
  "mp.education": "Ausbildung",
  "mp.profession": "Beruf",
  "mp.electionMethod": "Mandatsart",
  "mp.datesInOffice": "Mandatszeit",
  "mp.stillServing": "im Amt",
  "mp.noBiography": "Für diese Wahlperiode liegen keine biografischen Angaben vor.",
  "mp.committeeRole": "Funktion",
  "mp.committeePeriod": "Zeitraum",
  "mp.noCommittees": "Keine Ausschussmitgliedschaften erfasst.",
  "mp.latestSpeeches": "Neueste Reden",
  "mp.latestMotions": "Neueste Anträge",
  "mp.latestVotes": "Neueste namentliche Abstimmungen",
  "mp.noSpeeches": "Keine Reden erfasst.",
  "mp.noMotions": "Keine Anträge erfasst.",
  "mp.noVotes": "Keine namentlichen Abstimmungen erfasst.",
  "mp.wordCount": "{count} Wörter",
  "mp.sitting": "Sitzung {number}",
  "mp.openProtocol": "Protokoll öffnen",
  "mp.openDrucksache": "Drucksache öffnen",
  "mp.role": "Rolle",
  "mp.partyLine": "Fraktionslinie",
  "mp.partyLineWith": "auf Fraktionslinie",
  "mp.partyLineAgainst": "gegen die Fraktionsmehrheit",
  "mp.partyLineUnknown": "Fraktionsmehrheit unbekannt",
  "mp.trends": "Entwicklung",
  "mp.trendsComingSoon": "Verlaufsgrafiken folgen in einer späteren Ausbaustufe.",

  // --- score breakdown ---
  "score.total": "Gesamtwert",
  "score.breakdown": "Zusammensetzung",
  "score.component": "Komponente",
  "score.raw": "Gemessen",
  "score.weight": "Gewicht",
  "score.weighted": "Punkte",
  "score.none": "Für diese Wahlperiode wurde noch kein Aktivitätswert berechnet.",
  "score.customised": "Mit eigenen Gewichtungen berechnet.",
  "score.defaultWeights": "Mit den Standardgewichtungen berechnet.",
  "score.component.motions": "Anträge",
  "score.component.speeches": "Redebeiträge (Wörter)",
  "score.component.questions": "Anfragen",
  "score.component.reports": "Berichte",
  "score.component.voteParticipation": "Abstimmungsteilnahme",
  "score.component.committees": "Ausschüsse",
  "score.component.billSponsorships": "Gesetzentwürfe",

  // The three structural limits from lib/scoring.ts. They belong in the UI
  // rather than only in a comment: each one is a case where a low number means
  // "not published" rather than "did not happen".
  "score.caveat.namedVotes":
    "Abstimmungsteilnahme umfasst nur namentliche Abstimmungen. Alle übrigen Abstimmungen werden nicht personenbezogen protokolliert.",
  "score.caveat.committees":
    "Ausschussdaten liegen nur für die laufende Wahlperiode vor; für frühere Perioden ist der Wert 0, weil nichts veröffentlicht wurde.",
  "score.caveat.speechWords":
    "Redebeiträge werden nach Wörtern gewichtet, nicht nach Anzahl der Wortmeldungen.",

  // --- weight controls ---
  "weights.title": "Eigene Gewichtungen",
  "weights.description":
    "Passen Sie die Gewichtung jeder Komponente an. Der Wert wird sofort neu berechnet.",
  "weights.signInCta": "Anmelden, um eigene Gewichtungen zu speichern",
  "weights.signInHint":
    "Sie können die Regler auch ohne Konto ausprobieren — gespeichert werden sie nur mit Anmeldung.",
  "weights.save": "Gewichtungen speichern",
  "weights.saving": "Wird gespeichert …",
  "weights.saved": "Gespeichert.",
  "weights.saveFailed": "Speichern fehlgeschlagen.",
  "weights.resetToDefault": "Standardwerte",

  // --- activity heatmap ---
  "heatmap.title": "Aktivitätsverlauf",
  "heatmap.legendLess": "weniger",
  "heatmap.legendMore": "mehr",
  "heatmap.tooltip": "{count} Aktivitäten am {date}",
  "heatmap.tooltipNone": "Keine Aktivität am {date}",
  "heatmap.empty": "Für diesen Zeitraum sind keine Aktivitäten erfasst.",
  "heatmap.total": "{count} Aktivitäten in den letzten zwölf Monaten",

  // --- votes ---
  "vote.yes": "Ja",
  "vote.no": "Nein",
  "vote.abstain": "Enthaltung",
  "vote.invalid": "Ungültig",
  "vote.absent": "Nicht abgegeben",

  // --- event types ---
  "event.motion": "Antrag",
  "event.speech": "Rede",
  "event.vote": "Abstimmung",
  "event.question": "Anfrage",
  "event.bill": "Gesetzentwurf",
  "event.committee": "Ausschuss",
  "event.activity": "Aktivität",
} as const

/**
 * The shape every locale must satisfy.
 * Derived from `de`, which makes German the schema as well as the default.
 */
export type Dictionary = Record<keyof typeof de, string>

/** Translation key. Misspell one and the typecheck fails. */
export type TranslationKey = keyof typeof de

const en: Dictionary = {
  "app.name": "Bundestrack",
  "app.tagline": "Parliamentary activity, objectively measured.",
  "app.description":
    "Transparent, measurable activity of the members of the German Bundestag — from official records.",

  "nav.home": "Home",
  "nav.members": "Members",
  "nav.activity": "Activity",
  "nav.about": "About",
  "nav.language": "Language",
  "nav.theme": "Theme",

  "auth.signIn": "Sign in",
  "auth.signOut": "Sign out",
  "auth.signInWithGoogle": "Sign in with Google",
  "auth.signInWithGitHub": "Sign in with GitHub",
  "auth.optionalNotice":
    "Signing in is optional. All data is viewable without an account; an account saves your own score weightings and followed members.",

  "common.loading": "Loading …",
  "common.error": "Something went wrong.",
  "common.retry": "Try again",
  "common.notFound": "Not found",
  "common.search": "Search",
  "common.all": "All",
  "common.none": "Not recorded",
  "common.reset": "Reset",
  "common.showMore": "Show more",
  "common.comingSoon": "Coming soon",
  "common.previous": "Previous",
  "common.next": "Next",
  "common.page": "Page {page} of {total}",
  "common.noResults": "No results.",

  "mp.motions": "Motions",
  "mp.speeches": "Speeches",
  "mp.votes": "Votes",
  "mp.questions": "Questions",
  "mp.committees": "Committees",
  "mp.party": "Party",
  "mp.constituency": "Constituency",
  "mp.electoralPeriod": "Electoral period",
  "mp.activityScore": "Activity score",

  // --- MP list ---
  "mps.title": "Members",
  "mps.subtitle": "All members of the German Bundestag in electoral period {wahlperiode}.",
  "mps.searchPlaceholder": "Search by name or constituency …",
  "mps.filterFraktion": "Parliamentary group",
  "mps.filterState": "Federal state",
  "mps.filterScore": "Minimum activity score",
  "mps.count": "{count} of {total} members",
  "mps.empty": "No members match these filters.",
  "mps.emptyRoster": "No members have been loaded for this electoral period yet.",
  "mps.columnName": "Name",
  "mps.columnConstituency": "Constituency",
  "mps.columnScore": "Activity score",
  "mps.columnParticipation": "Voting participation",
  "mps.listMandate": "Party list",

  // --- MP profile ---
  "mp.backToList": "Back to all members",
  "mp.notFound": "This member could not be found.",
  "mp.biography": "Biography",
  "mp.birthDate": "Born",
  "mp.education": "Education",
  "mp.profession": "Profession",
  "mp.electionMethod": "Elected via",
  "mp.datesInOffice": "Time in office",
  "mp.stillServing": "in office",
  "mp.noBiography": "No biographical details are recorded for this electoral period.",
  "mp.committeeRole": "Role",
  "mp.committeePeriod": "Period",
  "mp.noCommittees": "No committee memberships recorded.",
  "mp.latestSpeeches": "Latest speeches",
  "mp.latestMotions": "Latest motions",
  "mp.latestVotes": "Latest recorded votes",
  "mp.noSpeeches": "No speeches recorded.",
  "mp.noMotions": "No motions recorded.",
  "mp.noVotes": "No recorded votes.",
  "mp.wordCount": "{count} words",
  "mp.sitting": "Sitting {number}",
  "mp.openProtocol": "Open protocol",
  "mp.openDrucksache": "Open paper",
  "mp.role": "Role",
  "mp.partyLine": "Group majority",
  "mp.partyLineWith": "with the group majority",
  "mp.partyLineAgainst": "against the group majority",
  "mp.partyLineUnknown": "group majority unknown",
  "mp.trends": "Trends",
  "mp.trendsComingSoon": "Trend charts are planned for a later release.",

  // --- score breakdown ---
  "score.total": "Total score",
  "score.breakdown": "Breakdown",
  "score.component": "Component",
  "score.raw": "Measured",
  "score.weight": "Weight",
  "score.weighted": "Points",
  "score.none": "No activity score has been computed for this electoral period yet.",
  "score.customised": "Computed with your own weightings.",
  "score.defaultWeights": "Computed with the default weightings.",
  "score.component.motions": "Motions",
  "score.component.speeches": "Speeches (words)",
  "score.component.questions": "Questions",
  "score.component.reports": "Reports",
  "score.component.voteParticipation": "Voting participation",
  "score.component.committees": "Committees",
  "score.component.billSponsorships": "Bill sponsorships",

  "score.caveat.namedVotes":
    "Voting participation covers recorded (named) votes only. Every other ballot is a show of hands with no per-member record.",
  "score.caveat.committees":
    "Committee data exists for the current electoral period only; for earlier periods the count is 0 because nothing was published.",
  "score.caveat.speechWords":
    "Speeches are weighted by words spoken, not by the number of times a member took the floor.",

  // --- weight controls ---
  "weights.title": "Custom weightings",
  "weights.description": "Adjust how much each component counts. The score updates immediately.",
  "weights.signInCta": "Sign in to save custom weightings",
  "weights.signInHint":
    "You can try the sliders without an account — signing in is what saves them.",
  "weights.save": "Save weightings",
  "weights.saving": "Saving …",
  "weights.saved": "Saved.",
  "weights.saveFailed": "Could not save.",
  "weights.resetToDefault": "Defaults",

  // --- activity heatmap ---
  "heatmap.title": "Activity over time",
  "heatmap.legendLess": "less",
  "heatmap.legendMore": "more",
  "heatmap.tooltip": "{count} activities on {date}",
  "heatmap.tooltipNone": "No activity on {date}",
  "heatmap.empty": "No activity is recorded for this period.",
  "heatmap.total": "{count} activities in the last twelve months",

  // --- votes ---
  "vote.yes": "Yes",
  "vote.no": "No",
  "vote.abstain": "Abstained",
  "vote.invalid": "Invalid",
  "vote.absent": "Did not vote",

  // --- event types ---
  "event.motion": "Motion",
  "event.speech": "Speech",
  "event.vote": "Vote",
  "event.question": "Question",
  "event.bill": "Bill",
  "event.committee": "Committee",
  "event.activity": "Activity",
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
