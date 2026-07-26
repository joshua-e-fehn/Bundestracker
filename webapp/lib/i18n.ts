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
  "app.name": "Bundestracker",
  "app.tagline": "Objektiver Aktivitäts-Tracker für den Deutschen Bundestag",
  "app.description":
    "Nachvollziehbare, messbare Aktivität der Mitglieder des Deutschen Bundestages — aus offiziellen Daten.",

  "nav.home": "Startseite",
  "nav.members": "Abgeordnete",
  "nav.activity": "Aktivität",
  "nav.about": "Über",
  "nav.language": "Sprache",
  "nav.theme": "Design",
  "nav.rankings": "Rangliste",
  "nav.feed": "Aktivitätsfeed",
  "nav.votes": "Abstimmungen",
  "nav.motions": "Anträge",
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
  "auth.optionalNotice":
    "Anmelden ist optional. Alle Daten sind ohne Konto einsehbar; ein Konto speichert eigene Gewichtungen und gefolgte Abgeordnete.",
  "auth.account": "Konto",

  "common.loading": "Wird geladen …",
  "common.error": "Etwas ist schiefgelaufen.",
  "common.retry": "Erneut versuchen",
  "common.notFound": "Nicht gefunden",
  "common.search": "Suchen",
  "common.all": "Alle",
  "common.none": "Keine",
  "common.reset": "Zurücksetzen",
  "common.showMore": "Mehr anzeigen",
  "common.comingSoon": "Demnächst verfügbar",
  "common.previous": "Zurück",
  "common.next": "Weiter",
  "common.page": "Seite {page} von {pages}",
  "common.noResults": "Keine Treffer.",
  "common.empty": "Keine Einträge gefunden.",
  "common.loadMore": "Mehr laden",
  "common.showingCount": "{shown} von {total}",
  "common.filters": "Filter",
  "common.noData": "Noch keine Daten",
  "common.noDataHint": "Die Datenpipeline hat für diesen Bereich noch nichts geladen.",

  "home.heroLead":
    "Wie ein Beitragsdiagramm für Abgeordnete: Anträge, Reden, Abstimmungen, Anfragen und Ausschussarbeit — jede Zahl belegt durch ein offizielles Dokument des Bundestages.",
  "home.browseAllMPs": "Alle Abgeordneten ansehen",
  "home.viewRankings": "Rangliste ansehen",
  "home.statsTitle": "Der Bundestag in Zahlen",
  "home.statMPs": "Abgeordnete",
  "home.statNamedVotes": "Namentliche Abstimmungen",
  "home.statMotions": "Anträge & Gesetzentwürfe",
  "home.statSpeeches": "Redebeiträge",
  "home.statNamedVotesNote":
    "Nur namentliche Abstimmungen — für alle übrigen Abstimmungen existiert kein Einzelnachweis.",
  "home.topMPsTitle": "Aktivste Abgeordnete",
  "home.topMPsSubtitle": "Nach Aktivitätswert in der laufenden Wahlperiode",
  "home.latestVotesTitle": "Neueste namentliche Abstimmungen",
  "home.feedTitle": "Zuletzt geschehen",
  "home.showAll": "Alle ansehen",

  // --- MP list -------------------------------------------------------------
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

  // --- MP profile ----------------------------------------------------------
  "mp.motions": "Anträge",
  "mp.speeches": "Reden",
  "mp.votes": "Abstimmungen",
  "mp.questions": "Anfragen",
  "mp.committees": "Ausschüsse",
  "mp.party": "Fraktion",
  "mp.constituency": "Wahlkreis",
  "mp.electoralPeriod": "Wahlperiode",
  "mp.activityScore": "Aktivitätswert",
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

  // --- score breakdown -----------------------------------------------------
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
  "score.caveat.namedVotes":
    "Abstimmungsteilnahme umfasst nur namentliche Abstimmungen. Alle übrigen Abstimmungen werden nicht personenbezogen protokolliert.",
  "score.caveat.committees":
    "Ausschussdaten liegen nur für die laufende Wahlperiode vor; für frühere Perioden ist der Wert 0, weil nichts veröffentlicht wurde.",
  "score.caveat.speechWords":
    "Redebeiträge werden nach Wörtern gewichtet, nicht nach Anzahl der Wortmeldungen.",

  // --- weight controls -----------------------------------------------------
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

  // --- activity heatmap ----------------------------------------------------
  "heatmap.title": "Aktivitätsverlauf",
  "heatmap.legendLess": "weniger",
  "heatmap.legendMore": "mehr",
  "heatmap.tooltip": "{count} Aktivitäten am {date}",
  "heatmap.tooltipNone": "Keine Aktivität am {date}",
  "heatmap.empty": "Für diesen Zeitraum sind keine Aktivitäten erfasst.",
  "heatmap.total": "{count} Aktivitäten in den letzten zwölf Monaten",

  // --- rankings ------------------------------------------------------------
  "rankings.title": "Ranglisten",
  "rankings.subtitle": "Wer im Bundestag was tut — gemessen an offiziellen Aufzeichnungen.",
  "rankings.rank": "Rang",
  "rankings.member": "Abgeordnete:r",
  "rankings.metric": "Wert",
  "rankings.score": "Aktivitätswert",
  "rankings.empty": "Für diese Auswahl liegen keine Werte vor.",
  "rankings.board.mostActive": "Aktivste",
  "rankings.board.mostActive.desc":
    "Gesamter Aktivitätswert der Wahlperiode, gewichtet nach den Standardgewichten.",
  "rankings.board.speeches": "Meiste Reden",
  "rankings.board.speeches.desc":
    "Redebeiträge im Plenum. Die Wortzahl steht daneben — sie ist der Wert, den die Bewertung nutzt.",
  "rankings.board.motions": "Meiste Anträge",
  "rankings.board.motions.desc": "Anträge und Entschließungsanträge, gezählt aus DIP-Aktivitäten.",
  "rankings.board.questions": "Meiste Anfragen",
  "rankings.board.questions.desc": "Kleine und Große Anfragen an die Bundesregierung.",
  "rankings.board.voteParticipation": "Höchste Abstimmungsbeteiligung",
  "rankings.board.voteParticipation.desc":
    "Anteil der namentlichen Abstimmungen, an denen abgestimmt wurde. Enthaltung zählt als Teilnahme.",
  "rankings.board.crossParty": "Meiste Abweichung von der Fraktion",
  "rankings.board.crossParty.desc":
    "Namentliche Abstimmungen, in denen anders als die Mehrheit der eigenen Fraktion gestimmt wurde.",
  "rankings.board.committees": "Meiste Ausschussarbeit",
  "rankings.board.committees.desc":
    "Ausschusssitze in der laufenden Wahlperiode. Frühere Perioden sind nicht veröffentlicht.",
  "rankings.board.bills": "Meiste Gesetzentwürfe",
  "rankings.board.bills.desc": "Gesetzentwürfe, die die Abgeordneten mitgezeichnet haben.",
  "rankings.board.rising": "Aufsteiger:innen des Monats",
  "rankings.board.rising.desc":
    "Größter Zuwachs des Aktivitätswerts gegenüber dem Vormonat, in Punkten.",
  "rankings.column.speeches": "Reden",
  "rankings.column.words": "Wörter",
  "rankings.column.motions": "Anträge",
  "rankings.column.questions": "Anfragen",
  "rankings.column.participation": "Beteiligung",
  "rankings.column.ballots": "Abstimmungen",
  "rankings.column.dissent": "Abweichungen",
  "rankings.column.committees": "Ausschüsse",
  "rankings.column.bills": "Gesetzentwürfe",
  "rankings.column.change": "Veränderung",
  "rankings.column.previous": "Vormonat",
  "rankings.filter.fraktion": "Fraktion",
  "rankings.filter.state": "Bundesland",
  "rankings.filter.ageGroup": "Altersgruppe",
  "rankings.filter.allFraktionen": "Alle Fraktionen",
  "rankings.filter.allStates": "Alle Bundesländer",
  "rankings.filter.allAges": "Alle Altersgruppen",
  "rankings.filter.month": "Zeitraum",
  "rankings.filter.wholePeriod": "Gesamte Wahlperiode",
  "rankings.age.u30": "unter 30",
  "rankings.age.30s": "30–39",
  "rankings.age.40s": "40–49",
  "rankings.age.50s": "50–59",
  "rankings.age.60s": "60–69",
  "rankings.age.70plus": "70+",
  "rankings.caveat.namedVotesOnly":
    "Nur namentliche Abstimmungen — rund 1 015 in der Geschichte des Bundestages. Alle übrigen Abstimmungen sind Handzeichen ohne personenbezogene Aufzeichnung.",
  "rankings.caveat.speechCount":
    "Redebeiträge sind Segmente, keine Reden: die Fragestunde zerlegt einen Ministerbeitrag in Dutzende Antworten. Die Bewertung nutzt deshalb die Wortzahl.",
  "rankings.caveat.committeesCurrentOnly":
    "Ausschussdaten liegen nur für die laufende Wahlperiode vor — frühere Perioden sind nirgends maschinenlesbar veröffentlicht.",
  "rankings.caveat.crossParty":
    "Abweichung heißt: anders als die Mehrheit der eigenen Fraktion in derselben Abstimmung. Abwesenheit zählt nicht als Abweichung.",
  "rankings.caveat.rising":
    "Vergleich zweier Kalendermonate. Ein Monat ohne Sitzungswoche fällt niedrig aus, ohne dass jemand weniger gearbeitet hätte.",
  "rankings.noPreviousMonth":
    "Für die gesamte Wahlperiode gibt es keinen Vormonat. Wählen Sie einen Monat.",
  "rankings.scoreExplainer":
    "Der Aktivitätswert ist eine gewichtete Summe messbarer Vorgänge. Die Gewichtung ist eine Setzung, keine Wertung — jede Komponente ist einzeln ausgewiesen.",

  // --- voting explorer -----------------------------------------------------
  "votes.title": "Namentliche Abstimmungen",
  "votes.subtitle":
    "Jede namentliche Abstimmung des Bundestages — mit dem Stimmverhalten jeder und jedes Abgeordneten.",
  "votes.namedOnlyNotice":
    "Nur namentliche Abstimmungen werden personenbezogen protokolliert. Alle übrigen Abstimmungen sind Handzeichen, für die kein Einzelnachweis existiert.",
  "votes.empty": "Für diese Auswahl liegen keine Abstimmungen vor.",
  "votes.emptyAll": "Für diese Wahlperiode sind noch keine Abstimmungen geladen.",
  "votes.searchPlaceholder": "Abstimmungen durchsuchen …",
  "votes.filterResult": "Ergebnis",
  "votes.allResults": "Alle Ergebnisse",
  "votes.filterYear": "Jahr",
  "votes.allYears": "Alle Jahre",
  "votes.count": "{count} von {total} Abstimmungen",
  "votes.columnDate": "Datum",
  "votes.columnTitle": "Vorlage",
  "votes.columnResult": "Ergebnis",
  "votes.columnBreakdown": "Stimmverteilung",
  "votes.sitting": "Sitzung {sitzungnr}, Abstimmung {abstimmnr}",
  "votes.notFound": "Diese Abstimmung wurde nicht gefunden.",
  "votes.backToList": "Zurück zu den Abstimmungen",
  "votes.turnout": "Beteiligung",
  "votes.eligible": "Stimmberechtigt",
  "votes.sourceSheet": "Amtliches Abstimmungsergebnis (XLSX)",
  "votes.tallyMismatch":
    "Die veröffentlichten Zahlen und die geladenen Einzelstimmen stimmen nicht überein — die Daten zu dieser Abstimmung sind unvollständig.",
  "votes.tallyPublished": "Veröffentlicht",
  "votes.tallyCounted": "Geladen",
  "votes.breakdownTitle": "Abstimmung nach Fraktion",
  "votes.breakdownEmpty": "Keine Fraktionsdaten zu dieser Abstimmung.",
  "votes.recordsTitle": "Einzelne Stimmen",
  "votes.recordsEmpty": "Keine Einzelstimmen zu dieser Abstimmung geladen.",
  "votes.searchMembers": "Abgeordnete suchen …",
  "votes.filterVote": "Stimme",
  "votes.allVotes": "Alle Stimmen",
  "votes.filterFraktion": "Fraktion",
  "votes.allFraktionen": "Alle Fraktionen",
  "votes.columnMember": "Abgeordnete:r",
  "votes.columnVote": "Stimme",
  "votes.columnRemark": "Anmerkung",
  "votes.noMembers": "Keine Abgeordneten entsprechen den Filtern.",
  "votes.groupMajority": "Fraktionsmehrheit",
  "votes.groupMajorityNone": "keine Mehrheit",
  "votes.groupShare": "{share} der abgegebenen Stimmen",
  "votes.rebels": "Abweichler:innen",
  "votes.rebel": "Abweichung",
  "votes.rebelTooltip": "Hat anders gestimmt als die Mehrheit der eigenen Fraktion.",
  "votes.rebelsEmpty": "Niemand ist von der eigenen Fraktionsmehrheit abgewichen.",
  "votes.rebelsNote":
    "Abwesenheit zählt nicht als Abweichung, und eine gespaltene Fraktion hat keine Mehrheit, von der abgewichen werden könnte.",
  "votes.rebelCount": "{count} Abweichung(en)",
  "votes.showAllMembers": "Alle {count} Abgeordneten anzeigen",

  "vote.yes": "Ja",
  "vote.no": "Nein",
  "vote.abstain": "Enthaltung",
  "vote.invalid": "Ungültig",
  "vote.absent": "Nicht abgegeben",

  // --- activity feed -------------------------------------------------------
  "feed.title": "Aktivitätsfeed",
  "feed.subtitle": "Was zuletzt im Bundestag passiert ist.",
  "feed.empty": "Keine Aktivitäten für diese Auswahl.",
  "feed.filterByType": "Nach Art filtern",
  "feed.allTypes": "Alle Arten",
  "feed.reference": "Zum Nachweis",
  "feed.end": "Keine weiteren Einträge.",

  "event.motion": "Antrag",
  "event.speech": "Rede",
  "event.vote": "Abstimmung",
  "event.question": "Anfrage",
  "event.bill": "Gesetzentwurf",
  "event.committee": "Ausschuss",
  "event.activity": "Aktivität",

  // --- relative timestamps -------------------------------------------------
  "time.justNow": "gerade eben",
  "time.minuteAgo": "vor einer Minute",
  "time.minutesAgo": "vor {count} Minuten",
  "time.hourAgo": "vor einer Stunde",
  "time.hoursAgo": "vor {count} Stunden",
  "time.yesterday": "gestern",
  "time.daysAgo": "vor {count} Tagen",
  "time.weekAgo": "vor einer Woche",
  "time.weeksAgo": "vor {count} Wochen",
  "time.monthAgo": "vor einem Monat",
  "time.monthsAgo": "vor {count} Monaten",
  "time.yearAgo": "vor einem Jahr",
  "time.yearsAgo": "vor {count} Jahren",

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
  "nav.activity": "Activity",
  "nav.about": "About",
  "nav.language": "Language",
  "nav.theme": "Theme",
  "nav.rankings": "Rankings",
  "nav.feed": "Activity feed",
  "nav.votes": "Votes",
  "nav.motions": "Motions",
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
  "auth.optionalNotice":
    "Signing in is optional. All data is viewable without an account; an account saves your own score weightings and followed members.",
  "auth.account": "Account",

  "common.loading": "Loading …",
  "common.error": "Something went wrong.",
  "common.retry": "Try again",
  "common.notFound": "Not found",
  "common.search": "Search",
  "common.all": "All",
  "common.none": "None",
  "common.reset": "Reset",
  "common.showMore": "Show more",
  "common.comingSoon": "Coming soon",
  "common.previous": "Previous",
  "common.next": "Next",
  "common.page": "Page {page} of {pages}",
  "common.noResults": "No results.",
  "common.empty": "No entries found.",
  "common.loadMore": "Load more",
  "common.showingCount": "{shown} of {total}",
  "common.filters": "Filters",
  "common.noData": "No data yet",
  "common.noDataHint": "The data pipeline has not loaded anything for this section yet.",

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

  // --- MP list -------------------------------------------------------------
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

  // --- MP profile ----------------------------------------------------------
  "mp.motions": "Motions",
  "mp.speeches": "Speeches",
  "mp.votes": "Votes",
  "mp.questions": "Questions",
  "mp.committees": "Committees",
  "mp.party": "Party",
  "mp.constituency": "Constituency",
  "mp.electoralPeriod": "Electoral period",
  "mp.activityScore": "Activity score",
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

  // --- score breakdown -----------------------------------------------------
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

  // --- weight controls -----------------------------------------------------
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

  // --- activity heatmap ----------------------------------------------------
  "heatmap.title": "Activity over time",
  "heatmap.legendLess": "less",
  "heatmap.legendMore": "more",
  "heatmap.tooltip": "{count} activities on {date}",
  "heatmap.tooltipNone": "No activity on {date}",
  "heatmap.empty": "No activity is recorded for this period.",
  "heatmap.total": "{count} activities in the last twelve months",

  // --- rankings ------------------------------------------------------------
  "rankings.title": "Rankings",
  "rankings.subtitle": "Who does what in the Bundestag — measured against official records.",
  "rankings.rank": "Rank",
  "rankings.member": "Member",
  "rankings.metric": "Value",
  "rankings.score": "Activity score",
  "rankings.empty": "No figures available for this selection.",
  "rankings.board.mostActive": "Most active",
  "rankings.board.mostActive.desc":
    "Total activity score for the electoral period, under the default weights.",
  "rankings.board.speeches": "Most speeches",
  "rankings.board.speeches.desc":
    "Plenary speech segments. The word count sits alongside — that is the figure scoring uses.",
  "rankings.board.motions": "Most motions",
  "rankings.board.motions.desc": "Motions and resolutions, counted from DIP activity records.",
  "rankings.board.questions": "Most questions",
  "rankings.board.questions.desc": "Minor and major written questions to the federal government.",
  "rankings.board.voteParticipation": "Highest voting participation",
  "rankings.board.voteParticipation.desc":
    "Share of named ballots in which a vote was cast. An abstention counts as participation.",
  "rankings.board.crossParty": "Most cross-party voting",
  "rankings.board.crossParty.desc":
    "Named ballots voted against the majority of the member's own parliamentary group.",
  "rankings.board.committees": "Most committee work",
  "rankings.board.committees.desc":
    "Committee seats in the current electoral period. Earlier periods are unpublished.",
  "rankings.board.bills": "Most bills introduced",
  "rankings.board.bills.desc": "Bills the member put their name to.",
  "rankings.board.rising": "Rising this month",
  "rankings.board.rising.desc":
    "Largest increase in activity score against the previous month, in points.",
  "rankings.column.speeches": "Speeches",
  "rankings.column.words": "Words",
  "rankings.column.motions": "Motions",
  "rankings.column.questions": "Questions",
  "rankings.column.participation": "Participation",
  "rankings.column.ballots": "Ballots",
  "rankings.column.dissent": "Dissents",
  "rankings.column.committees": "Committees",
  "rankings.column.bills": "Bills",
  "rankings.column.change": "Change",
  "rankings.column.previous": "Previous month",
  "rankings.filter.fraktion": "Parliamentary group",
  "rankings.filter.state": "Federal state",
  "rankings.filter.ageGroup": "Age group",
  "rankings.filter.allFraktionen": "All groups",
  "rankings.filter.allStates": "All states",
  "rankings.filter.allAges": "All ages",
  "rankings.filter.month": "Period",
  "rankings.filter.wholePeriod": "Whole electoral period",
  "rankings.age.u30": "under 30",
  "rankings.age.30s": "30–39",
  "rankings.age.40s": "40–49",
  "rankings.age.50s": "50–59",
  "rankings.age.60s": "60–69",
  "rankings.age.70plus": "70+",
  "rankings.caveat.namedVotesOnly":
    "Named ballots only — roughly 1,015 in the Bundestag's entire history. Every other vote is a show of hands with no per-member record.",
  "rankings.caveat.speechCount":
    "Speech entries are segments, not speeches: question time splits a minister's turn into dozens of replies. Scoring therefore uses the word count.",
  "rankings.caveat.committeesCurrentOnly":
    "Committee data exists for the current electoral period only — earlier periods are published nowhere in machine-readable form.",
  "rankings.caveat.crossParty":
    "Cross-party means voting against the majority of one's own group in the same ballot. An absence is not a dissent.",
  "rankings.caveat.rising":
    "A comparison of two calendar months. A month without a sitting week reads low without anyone having done less.",
  "rankings.noPreviousMonth":
    "The whole electoral period has no previous month. Pick a month instead.",
  "rankings.scoreExplainer":
    "The activity score is a weighted sum of measurable records. The weighting is a choice, not a verdict — every component is shown separately.",

  // --- voting explorer -----------------------------------------------------
  "votes.title": "Named votes",
  "votes.subtitle": "Every named ballot in the Bundestag — with how each member voted.",
  "votes.namedOnlyNotice":
    "Only named ballots are recorded per member. Every other vote is a show of hands, for which no individual record exists.",
  "votes.empty": "No ballots available for this selection.",
  "votes.emptyAll": "No ballots have been loaded for this electoral period yet.",
  "votes.searchPlaceholder": "Search ballots …",
  "votes.filterResult": "Result",
  "votes.allResults": "All results",
  "votes.filterYear": "Year",
  "votes.allYears": "All years",
  "votes.count": "{count} of {total} ballots",
  "votes.columnDate": "Date",
  "votes.columnTitle": "Motion",
  "votes.columnResult": "Result",
  "votes.columnBreakdown": "Vote distribution",
  "votes.sitting": "Sitting {sitzungnr}, ballot {abstimmnr}",
  "votes.notFound": "This ballot could not be found.",
  "votes.backToList": "Back to ballots",
  "votes.turnout": "Turnout",
  "votes.eligible": "Eligible",
  "votes.sourceSheet": "Official result sheet (XLSX)",
  "votes.tallyMismatch":
    "The published counts and the loaded individual votes do not agree — the data for this ballot is incomplete.",
  "votes.tallyPublished": "Published",
  "votes.tallyCounted": "Loaded",
  "votes.breakdownTitle": "Vote by parliamentary group",
  "votes.breakdownEmpty": "No group data for this ballot.",
  "votes.recordsTitle": "Individual votes",
  "votes.recordsEmpty": "No individual votes loaded for this ballot.",
  "votes.searchMembers": "Search members …",
  "votes.filterVote": "Vote",
  "votes.allVotes": "All votes",
  "votes.filterFraktion": "Parliamentary group",
  "votes.allFraktionen": "All groups",
  "votes.columnMember": "Member",
  "votes.columnVote": "Vote",
  "votes.columnRemark": "Remark",
  "votes.noMembers": "No members match the filters.",
  "votes.groupMajority": "Group majority",
  "votes.groupMajorityNone": "no majority",
  "votes.groupShare": "{share} of votes cast",
  "votes.rebels": "Dissenters",
  "votes.rebel": "Dissent",
  "votes.rebelTooltip": "Voted against the majority of their own parliamentary group.",
  "votes.rebelsEmpty": "Nobody voted against their own group's majority.",
  "votes.rebelsNote":
    "An absence is not a dissent, and a split group has no majority to dissent from.",
  "votes.rebelCount": "{count} dissent(s)",
  "votes.showAllMembers": "Show all {count} members",

  "vote.yes": "Yes",
  "vote.no": "No",
  "vote.abstain": "Abstained",
  "vote.invalid": "Invalid",
  "vote.absent": "Did not vote",

  // --- activity feed -------------------------------------------------------
  "feed.title": "Activity feed",
  "feed.subtitle": "What has just happened in the Bundestag.",
  "feed.empty": "No activity for this selection.",
  "feed.filterByType": "Filter by type",
  "feed.allTypes": "All types",
  "feed.reference": "Source record",
  "feed.end": "No further entries.",

  "event.motion": "Motion",
  "event.speech": "Speech",
  "event.vote": "Vote",
  "event.question": "Question",
  "event.bill": "Bill",
  "event.committee": "Committee",
  "event.activity": "Activity",

  // --- relative timestamps -------------------------------------------------
  "time.justNow": "just now",
  "time.minuteAgo": "a minute ago",
  "time.minutesAgo": "{count} minutes ago",
  "time.hourAgo": "an hour ago",
  "time.hoursAgo": "{count} hours ago",
  "time.yesterday": "yesterday",
  "time.daysAgo": "{count} days ago",
  "time.weekAgo": "a week ago",
  "time.weeksAgo": "{count} weeks ago",
  "time.monthAgo": "a month ago",
  "time.monthsAgo": "{count} months ago",
  "time.yearAgo": "a year ago",
  "time.yearsAgo": "{count} years ago",

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
