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
  "nav.rankings": "Rangliste",
  "nav.seating": "Sitzverteilung",
  "nav.feed": "Aktivitätsfeed",
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
  // The app-wide 404. Says what happened and offers the one thing that always
  // helps — the way back — rather than listing routes the reader may not want.
  "common.notFoundPage": "Diese Seite gibt es nicht.",
  "common.backHome": "Zur Startseite",
  "common.search": "Suchen",
  "common.all": "Alle",
  "common.none": "Keine",
  "common.empty": "Keine Einträge gefunden.",
  "common.loadMore": "Mehr laden",
  "common.showingCount": "{shown} von {total}",
  "common.previous": "Zurück",
  "common.next": "Weiter",
  "common.page": "Seite {page} von {pages}",
  "common.reset": "Zurücksetzen",
  "common.filters": "Filter",

  "mp.motions": "Anträge",
  "mp.speeches": "Reden",
  "mp.votes": "Abstimmungen",
  "mp.questions": "Anfragen",
  "mp.committees": "Ausschüsse",
  "mp.party": "Fraktion",
  "mp.constituency": "Wahlkreis",
  "mp.electoralPeriod": "Wahlperiode",
  "mp.activityScore": "Aktivitätswert",

  // --- rankings -----------------------------------------------------------

  "rankings.title": "Ranglisten",
  "rankings.subtitle": "Wer im Bundestag was tut — gemessen an offiziellen Aufzeichnungen.",
  "rankings.rank": "Rang",
  "rankings.member": "Abgeordnete:r",
  "rankings.metric": "Wert",
  "rankings.score": "Aktivitätswert",
  "rankings.empty": "Für diese Auswahl liegen keine Werte vor.",

  // Board names. Each is a leaderboard tab; the description sits under the
  // heading and says what the number actually counts.
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

  // Column headers, kept short enough for a table head.
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

  // The caveats. These are structural limits of the sources (docs/api-research.md
  // §4.4, §5.2, §6.4), not provisional gaps, so they are shown beside the number
  // rather than filed under "about".
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

  // --- activity feed ------------------------------------------------------

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

  // Relative timestamps. `{count}` is the number; the caller picks singular or
  // plural by key, because German and English split at different counts.
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

  // --- MP profiles, roster and score panel -------------------------------
  //
  // Restored: these belong to the MP-profile pages (PR #7) and were dropped
  // when PR #8 rewrote the neighbouring region of this file. Their absence
  // broke `pixi run typecheck` on main — `t()` keys off this dictionary, so a
  // missing key is a compile error at every call site, which is exactly the
  // guard this file's header describes working as intended.

  "common.showMore": "Mehr anzeigen",
  "common.comingSoon": "Demnächst verfügbar",
  "common.noResults": "Keine Treffer.",

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
  // --- trend charts ---
  //
  // `mp.trends` and `mp.trendsComingSoon` were here until the charts landed:
  // the first is now `trends.title`, and the second described a placeholder
  // panel that no longer exists. Both are removed rather than left behind —
  // this dictionary is the schema (see the header), so an unused key is a
  // string a future reader would reasonably assume something renders.
  //
  // The five charts on the profile's Entwicklung panel. Each description says
  // what the chart counts, because "Reden pro Monat" and "Redebeiträge pro
  // Monat" are different figures and §5.2 is the reason the distinction matters.
  "trends.title": "Entwicklung",
  "trends.subtitle": "Monatliche Aktivität in der laufenden Wahlperiode.",
  "trends.chart.activity": "Aktivitätswert",
  "trends.chart.activity.desc": "Gesamter Aktivitätswert je Monat, nach den Standardgewichten.",
  "trends.chart.speeches": "Reden",
  "trends.chart.speeches.desc":
    "Redebeiträge je Monat, mit der Wortzahl daneben — sie ist der Wert, den die Bewertung nutzt.",
  "trends.chart.motions": "Anträge",
  "trends.chart.motions.desc": "Anträge und Gesetzentwürfe je Monat, gezählt aus DIP-Aktivitäten.",
  "trends.chart.questions": "Anfragen",
  "trends.chart.questions.desc":
    "Kleine und Große Anfragen, aufsummiert über die Wahlperiode. Die Kurve steigt monoton — ein flacher Abschnitt ist ein Monat ohne Anfrage.",
  "trends.chart.votes": "Abstimmungen",
  "trends.chart.votes.desc":
    "Namentliche Abstimmungen je Monat, nach abgegebener Stimme. „Nicht abgegeben“ ist eigens ausgewiesen und keine Enthaltung.",
  "trends.cumulative": "Kumuliert",
  "trends.month": "Monat",

  // An empty chart and an empty *dataset* look alike — an axis with a line
  // along zero reads as a measured result. Both are named rather than drawn.
  "trends.empty": "Für diese Wahlperiode liegen noch keine Monatswerte vor.",
  "trends.emptyChart": "Für diese Auswahl wurde in dieser Wahlperiode nichts erfasst.",
  // The gap the nightly sweep leaves: it recomputes only the current month, so
  // an earlier month can hold ballots and no score. A zero there is an absence
  // of computation, not of work — see `getMonthlyScoresByMP`.
  "trends.unscoredNotice":
    "{count} Monate sind noch nicht bewertet: Die nächtliche Berechnung erfasst nur den laufenden Monat. Ein Wert von 0 bedeutet dort „noch nicht berechnet“, nicht „keine Aktivität“.",

  "trends.caveat.score":
    "Der Aktivitätswert ist eine gewichtete Summe — die Gewichtung ist eine Setzung, keine Wertung. Ein Monat ohne Sitzungswoche fällt niedrig aus, ohne dass jemand weniger gearbeitet hätte.",
  "trends.caveat.namedVotes":
    "Nur namentliche Abstimmungen. Ein Monat ohne Balken ist fast immer ein Monat ohne namentliche Abstimmung — nicht einer ohne Abstimmungen.",

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

  // --- voting explorer (list, detail, per-MP table) ---
  "votes.title": "Namentliche Abstimmungen",
  "votes.subtitle":
    "Jede namentliche Abstimmung des Bundestages — mit dem Stimmverhalten jedes einzelnen Mandats.",
  // The caveat that governs every figure on both pages. Namentliche
  // Abstimmungen are the exception in the Bundestag, not the rule
  // (docs/api-research.md §4.4): the ordinary vote is by show of hands and
  // leaves no per-MP record at all. A reader counting rows here is counting
  // the recorded minority, so this is said before they start rather than
  // footnoted after.
  "votes.namedOnlyNotice":
    "Nur namentliche Abstimmungen werden pro Abgeordneter erfasst. Die meisten Beschlüsse fallen per Handzeichen und hinterlassen kein individuelles Stimmergebnis — diese Liste ist deshalb kein vollständiges Abstimmungsverhalten.",
  "votes.sitting": "Sitzung {sitzungnr}, Abstimmung {abstimmnr}",
  "votes.searchPlaceholder": "Abstimmung suchen …",
  "votes.filterResult": "Ergebnis",
  "votes.allResults": "Alle Ergebnisse",
  "votes.filterYear": "Jahr",
  "votes.allYears": "Alle Jahre",
  "votes.empty": "Keine Abstimmung passt zu diesen Filtern.",
  "votes.emptyAll": "Es wurden noch keine namentlichen Abstimmungen geladen.",
  "votes.columnDate": "Datum",
  "votes.columnTitle": "Gegenstand",
  "votes.columnResult": "Ergebnis",
  "votes.columnBreakdown": "Stimmverteilung",
  "votes.count": "{count} von {total} Abstimmungen",

  // --- vote detail ---
  "votes.backToList": "Zurück zu den Abstimmungen",
  "votes.notFound": "Diese Abstimmung existiert nicht oder wurde noch nicht geladen.",
  // Shown when the tallies printed on the sheet do not add up to the rows
  // counted from it. Surfaced rather than silently corrected: a mismatch is a
  // fact about the source document, and picking one number over the other
  // would hide it.
  "votes.tallyMismatch":
    "Die veröffentlichten Summen weichen von den gezählten Stimmen ab.",
  "votes.tallyPublished": "veröffentlicht",
  "votes.tallyCounted": "gezählt",
  "votes.turnout": "Beteiligung",
  "votes.eligible": "Stimmberechtigt",
  "votes.rebels": "Abweichler:innen",
  "votes.sourceSheet": "Original-Abstimmungsliste (XLSX)",
  "votes.breakdownTitle": "Nach Fraktion",
  "votes.breakdownEmpty": "Für diese Abstimmung liegt keine Fraktionsauswertung vor.",
  "votes.groupMajority": "Mehrheit",
  "votes.groupMajorityNone": "keine",
  "votes.groupShare": "({share})",
  "votes.rebelsNote":
    "Als Abweichung zählt eine Stimme, die von der Mehrheit der eigenen Fraktion abweicht. Enthaltungen und nicht abgegebene Stimmen bleiben dabei außer Betracht.",
  "votes.recordsTitle": "Einzelstimmen",
  "votes.recordsEmpty": "Für diese Abstimmung sind keine Einzelstimmen erfasst.",

  // --- per-MP vote table ---
  "votes.searchMembers": "Abgeordnete suchen …",
  "votes.filterFraktion": "Fraktion",
  "votes.allFraktionen": "Alle Fraktionen",
  "votes.filterVote": "Stimme",
  "votes.allVotes": "Alle Stimmen",
  "votes.noMembers": "Keine Abgeordneten passen zu diesen Filtern.",
  "votes.columnMember": "Abgeordnete:r",
  "votes.columnVote": "Stimme",
  "votes.columnRemark": "Anmerkung",
  "votes.rebel": "Abweichung",
  "votes.rebelTooltip": "Hat gegen die Mehrheit der eigenen Fraktion gestimmt.",

  // --- site chrome, homepage and footer ---
  "nav.votes": "Abstimmungen",
  "nav.motions": "Anträge",
  "nav.menu": "Menü",
  "nav.openMenu": "Menü öffnen",
  "nav.closeMenu": "Menü schließen",

  "theme.light": "Hell",
  "theme.dark": "Dunkel",
  "theme.system": "System",
  "auth.account": "Konto",
  // Distinct from `common.loading` on purpose: an empty section and a loading
  // one look alike, and only one of them is worth waiting for.
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

  "footer.dataSource": "Datenquelle",
  "footer.dataSourceName": "Deutscher Bundestag — Open Data",
  "footer.sourceCode": "Quellcode",
  "footer.builtBy": "Erstellt von Joshua Fehn",
  "footer.disclaimer":
    "Kein offizielles Angebot des Deutschen Bundestages. Alle Angaben stammen aus öffentlich zugänglichen amtlichen Daten.",

  // --- seating map ---
  "seating.title": "Sitzverteilung",
  "seating.subtitle":
    "Der Plenarsaal nach Fraktionsstärke — jeder Sitz ist ein Mandat der laufenden Wahlperiode.",
  // The disclaimer §9 requires, and the most important string on the page. The
  // seat *distribution* is real, counted from the roster; the seat *assignment*
  // is invented, because no machine-readable seating plan exists anywhere. A
  // reader who takes a dot for an MP's actual chair has been misled by us, so
  // this is stated on the page itself rather than buried in a tooltip.
  "seating.syntheticNotice":
    "Synthetische Darstellung: Die Größe jeder Fraktion ist amtlich belegt, die Position eines einzelnen Sitzes nicht. Für die tatsächliche Sitzordnung des Bundestages existieren keine maschinenlesbaren Daten — die Plätze im Bogen sind daher willkürlich vergeben.",
  "seating.seatCount": "{count} Sitze",
  "seating.empty": "Für diese Wahlperiode wurde noch keine Sitzverteilung erzeugt.",
  "seating.emptyHint":
    "Die Sitzverteilung wird aus dem Abgeordnetenverzeichnis abgeleitet, sobald die Datenpipeline es geladen hat.",

  "seating.colorMode": "Einfärben nach",
  "seating.mode.party": "Fraktion",
  "seating.mode.coalition": "Regierung / Opposition",
  "seating.mode.activity": "Aktivitätswert",
  "seating.mode.attendance": "Abstimmungsteilnahme",
  "seating.mode.committee": "Ausschussarbeit",

  "seating.government": "Regierung",
  "seating.opposition": "Opposition",
  // Not "Opposition": a period whose coalition this codebase does not record
  // must not be coloured as though every group opposed. See GOVERNING_PARTIES.
  "seating.coalitionUnknown": "Nicht erfasst",
  "seating.coalitionCaveat":
    "Die Regierungszugehörigkeit ist in keiner amtlichen Datenquelle enthalten und wird im Quellcode gepflegt.",
  "seating.attendanceCaveat":
    "Abstimmungsteilnahme umfasst nur namentliche Abstimmungen; ein niedriger Wert bedeutet nicht zwangsläufig Abwesenheit.",
  "seating.committeeCaveat":
    "Ausschussdaten liegen nur für die laufende Wahlperiode vor. In früheren Perioden ist jeder Wert 0, weil nichts veröffentlicht wurde — nicht, weil niemand in einem Ausschuss saß.",

  // The gap that must stay visible: an MP the nightly sweep has not scored is
  // not an MP who did nothing.
  "seating.noScore": "Kein Wert berechnet",
  "seating.legendLow": "niedrig",
  "seating.legendHigh": "hoch",
  "seating.committeeSeats": "{count} Ausschüsse",
  "seating.zoomIn": "Vergrößern",
  "seating.zoomOut": "Verkleinern",
  "seating.resetView": "Ansicht zurücksetzen",
  "seating.mapLabel": "Sitzverteilung des Bundestages",
  "seating.seatOf": "Sitz von {name}",
  "seating.openProfile": "Profil ansehen",
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
  "nav.rankings": "Rankings",
  "nav.seating": "Seating map",
  "nav.feed": "Activity feed",
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
  "common.notFoundPage": "This page does not exist.",
  "common.backHome": "Back to the home page",
  "common.search": "Search",
  "common.all": "All",
  "common.none": "None",
  "common.empty": "No entries found.",
  "common.loadMore": "Load more",
  "common.showingCount": "{shown} of {total}",
  "common.previous": "Previous",
  "common.next": "Next",
  "common.page": "Page {page} of {pages}",
  "common.reset": "Reset",
  "common.filters": "Filters",

  "mp.motions": "Motions",
  "mp.speeches": "Speeches",
  "mp.votes": "Votes",
  "mp.questions": "Questions",
  "mp.committees": "Committees",
  "mp.party": "Party",
  "mp.constituency": "Constituency",
  "mp.electoralPeriod": "Electoral period",
  "mp.activityScore": "Activity score",

  // --- rankings -----------------------------------------------------------

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

  // --- activity feed ------------------------------------------------------

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

  // --- MP profiles, roster and score panel -------------------------------
  //
  // Restored: these belong to the MP-profile pages (PR #7) and were dropped
  // when PR #8 rewrote the neighbouring region of this file. Their absence
  // broke `pixi run typecheck` on main — `t()` keys off this dictionary, so a
  // missing key is a compile error at every call site, which is exactly the
  // guard this file's header describes working as intended.

  "common.showMore": "Show more",
  "common.comingSoon": "Coming soon",
  "common.noResults": "No results.",

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
  // --- trend charts ---
  "trends.title": "Trends",
  "trends.subtitle": "Monthly activity across the current electoral period.",
  "trends.chart.activity": "Activity score",
  "trends.chart.activity.desc": "Total activity score per month, under the default weights.",
  "trends.chart.speeches": "Speeches",
  "trends.chart.speeches.desc":
    "Speech segments per month, with the word count alongside — that is the figure scoring uses.",
  "trends.chart.motions": "Motions",
  "trends.chart.motions.desc": "Motions and bills per month, counted from DIP activity records.",
  "trends.chart.questions": "Questions",
  "trends.chart.questions.desc":
    "Minor and major written questions, accumulated across the electoral period. The curve only rises — a flat stretch is a month with no question.",
  "trends.chart.votes": "Votes",
  "trends.chart.votes.desc":
    "Named ballots per month, by the vote cast. “Did not vote” is shown separately and is not an abstention.",
  "trends.cumulative": "Cumulative",
  "trends.month": "Month",

  "trends.empty": "No monthly figures are available for this electoral period yet.",
  "trends.emptyChart": "Nothing was recorded for this selection in this electoral period.",
  "trends.unscoredNotice":
    "{count} months are not scored yet: the nightly computation covers only the current month. A 0 there means “not computed yet”, not “no activity”.",

  "trends.caveat.score":
    "The activity score is a weighted sum — the weighting is a choice, not a verdict. A month without a sitting week reads low without anyone having done less.",
  "trends.caveat.namedVotes":
    "Named ballots only. A month with no bar is almost always a month with no named ballot — not one without votes.",

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

  // --- voting explorer (list, detail, per-MP table) ---
  // "Namentliche Abstimmung" is kept as "recorded vote" rather than "roll-call
  // vote": the Bundestag's own English materials use the former, and the
  // latter suggests names being read aloud, which is not what happens.
  "votes.title": "Recorded votes",
  "votes.subtitle":
    "Every recorded vote in the Bundestag — including how each individual member voted.",
  "votes.namedOnlyNotice":
    "Only recorded votes are captured per member. Most decisions are taken by show of hands and leave no individual result, so this list is not a complete picture of voting behaviour.",
  "votes.sitting": "Sitting {sitzungnr}, vote {abstimmnr}",
  "votes.searchPlaceholder": "Search votes …",
  "votes.filterResult": "Result",
  "votes.allResults": "All results",
  "votes.filterYear": "Year",
  "votes.allYears": "All years",
  "votes.empty": "No vote matches these filters.",
  "votes.emptyAll": "No recorded votes have been loaded yet.",
  "votes.columnDate": "Date",
  "votes.columnTitle": "Subject",
  "votes.columnResult": "Result",
  "votes.columnBreakdown": "Distribution",
  "votes.count": "{count} of {total} votes",

  // --- vote detail ---
  "votes.backToList": "Back to votes",
  "votes.notFound": "This vote does not exist, or has not been loaded yet.",
  "votes.tallyMismatch": "The published totals differ from the counted votes.",
  "votes.tallyPublished": "published",
  "votes.tallyCounted": "counted",
  "votes.turnout": "Turnout",
  "votes.eligible": "Eligible to vote",
  "votes.rebels": "Rebels",
  "votes.sourceSheet": "Original vote sheet (XLSX)",
  "votes.breakdownTitle": "By parliamentary group",
  "votes.breakdownEmpty": "No group breakdown is available for this vote.",
  "votes.groupMajority": "Majority",
  "votes.groupMajorityNone": "none",
  "votes.groupShare": "({share})",
  "votes.rebelsNote":
    "A vote counts as a rebellion when it differs from the majority of the member's own parliamentary group. Abstentions and votes not cast are disregarded.",
  "votes.recordsTitle": "Individual votes",
  "votes.recordsEmpty": "No individual votes are recorded for this ballot.",

  // --- per-MP vote table ---
  "votes.searchMembers": "Search members …",
  "votes.filterFraktion": "Parliamentary group",
  "votes.allFraktionen": "All groups",
  "votes.filterVote": "Vote",
  "votes.allVotes": "All votes",
  "votes.noMembers": "No members match these filters.",
  "votes.columnMember": "Member",
  "votes.columnVote": "Vote",
  "votes.columnRemark": "Remark",
  "votes.rebel": "Rebel vote",
  "votes.rebelTooltip": "Voted against the majority of their own parliamentary group.",

  // --- site chrome, homepage and footer ---
  "nav.votes": "Votes",
  "nav.motions": "Motions",
  "nav.menu": "Menu",
  "nav.openMenu": "Open menu",
  "nav.closeMenu": "Close menu",

  "theme.light": "Light",
  "theme.dark": "Dark",
  "theme.system": "System",
  "auth.account": "Account",
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

  "footer.dataSource": "Data source",
  "footer.dataSourceName": "Deutscher Bundestag — Open Data",
  "footer.sourceCode": "Source code",
  "footer.builtBy": "Built by Joshua Fehn",
  "footer.disclaimer":
    "Not an official service of the German Bundestag. All figures come from publicly available official data.",

  // --- seating map ---
  "seating.title": "Seating map",
  "seating.subtitle":
    "The chamber by parliamentary group — one seat per mandate in the current electoral period.",
  "seating.syntheticNotice":
    "Synthetic diagram: the size of each parliamentary group is backed by official records, the position of any individual seat is not. No machine-readable seating plan for the Bundestag exists, so places on the arc are assigned arbitrarily.",
  "seating.seatCount": "{count} seats",
  "seating.empty": "No seating map has been generated for this electoral period yet.",
  "seating.emptyHint":
    "The seating map is derived from the member roster once the data pipeline has loaded it.",

  "seating.colorMode": "Colour by",
  "seating.mode.party": "Parliamentary group",
  "seating.mode.coalition": "Government / opposition",
  "seating.mode.activity": "Activity score",
  "seating.mode.attendance": "Voting participation",
  "seating.mode.committee": "Committee work",

  "seating.government": "Government",
  "seating.opposition": "Opposition",
  "seating.coalitionUnknown": "Not recorded",
  "seating.coalitionCaveat":
    "Which groups form the government appears in no official dataset; it is maintained in the source code.",
  "seating.attendanceCaveat":
    "Voting participation covers recorded (named) votes only; a low figure does not necessarily mean absence.",
  "seating.committeeCaveat":
    "Committee data exists for the current electoral period only. In earlier periods every figure is 0 because nothing was published — not because nobody sat on a committee.",

  "seating.noScore": "No score computed",
  "seating.legendLow": "low",
  "seating.legendHigh": "high",
  "seating.committeeSeats": "{count} committees",
  "seating.zoomIn": "Zoom in",
  "seating.zoomOut": "Zoom out",
  "seating.resetView": "Reset view",
  "seating.mapLabel": "Seating map of the Bundestag",
  "seating.seatOf": "Seat of {name}",
  "seating.openProfile": "View profile",
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
