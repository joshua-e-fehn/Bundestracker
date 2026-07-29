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
  // `/` is the narrative page and this is the dashboard it used to be: the
  // stats row, both leaderboards, the Fraktionen, the ballots and the feed on
  // one screen with no story around them. Named for what it is rather than
  // "Übersicht", because a reader who wants today's numbers without the
  // argument is looking for exactly this word.
  "nav.dashboard": "Dashboard",
  "nav.members": "Abgeordnete",
  "nav.activity": "Aktivität",
  "nav.rankings": "Rangliste",
  "nav.seating": "Sitzverteilung",
  "nav.feed": "Aktivitätsfeed",
  "nav.about": "Über",
  "nav.language": "Sprache",
  "nav.theme": "Design",
  // The header's period chip. Abbreviated because it sits in a 56 px-tall bar
  // beside three icon buttons; `nav.periodLabel` is what a screen reader and a
  // hovering pointer get, so the abbreviation never has to be guessed at.
  "nav.period": "WP {wahlperiode}",
  "nav.periodLabel": "{wahlperiode}. Wahlperiode — die hier dargestellte",

  "auth.signIn": "Anmelden",
  "auth.signOut": "Abmelden",
  "auth.signInWithGoogle": "Mit Google anmelden",
  "auth.signInWithGitHub": "Mit GitHub anmelden",
  // The sign-in page has to answer "why would I?", because the answer is not
  // "to see the data" — all of it is public without an account.
  "auth.optionalNotice":
    "Anmelden ist optional. Alle Daten sind ohne Konto einsehbar; ein Konto speichert eigene Gewichtungen und gefolgte Abgeordnete.",
  "auth.signInTitle": "Bei Bundestracker anmelden",
  "auth.chooseProvider": "Wählen Sie einen Anbieter.",
  // Says what an account buys, in the two concrete things it buys. Vaguer
  // wording ("personalisierte Funktionen") would be a reason to sign in that
  // names nothing the reader can weigh.
  "auth.benefits":
    "Mit einem Konto speichern Sie eigene Gewichtungen des Aktivitätswerts und folgen einzelnen Abgeordneten.",
  "auth.continueWithoutAccount": "Ohne Konto weiterlesen",
  "auth.signingIn": "Weiterleitung …",
  // The GitHub button is disabled rather than hidden: the provider is
  // configured in convex/betterAuth/auth.ts and is coming, so hiding it would
  // make its arrival look like a new feature rather than one being finished.
  // `common.comingSoon` already carries "Demnächst verfügbar" — reused rather
  // than restated, so the two badges cannot drift apart.
  "auth.githubUnavailable": "Die Anmeldung mit GitHub ist noch nicht freigeschaltet.",
  "auth.signInFailed": "Anmeldung fehlgeschlagen. Bitte erneut versuchen.",
  "auth.alreadySignedIn": "Sie sind bereits angemeldet.",

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
  "rankings.board.normalised": "Aktivität je Monat im Amt",
  "rankings.board.normalised.desc":
    "Aktivitätswert geteilt durch die Zeit im Amt. Wer im Lauf der Wahlperiode nachgerückt ist, wird hier nicht mehr an Kolleginnen und Kollegen mit doppelt so langer Amtszeit gemessen.",
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
  "rankings.column.dissentRate": "Abweichungsquote",
  "rankings.column.committees": "Ausschüsse",
  "rankings.column.bills": "Gesetzentwürfe",
  "rankings.column.change": "Veränderung",
  "rankings.column.previous": "Vormonat",
  "rankings.column.perMonth": "Wert je Monat",
  "rankings.column.tenureDays": "Tage im Amt",

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
  // ⚠ The honest limit on the normalised board. The divisor is elapsed days,
  // not sitting weeks — the Bundestag sits in roughly twenty a year and no
  // dataset publishes that calendar (§9), so "per month in office" is calendar
  // time rather than parliamentary exposure. Over a whole period the two are
  // close; over one month they are not.
  "rankings.caveat.normalised":
    "Geteilt wird durch die Kalenderzeit im Amt, nicht durch Sitzungswochen — der Sitzungskalender ist nirgends maschinenlesbar veröffentlicht. Über eine ganze Wahlperiode liegen beide nah beieinander, für einzelne Monate nicht.",
  "rankings.normalisedUnrankable":
    "{count} Mandat(e) ohne Wertung: keine erfasste Mandatszeit oder weniger als 30 Tage im Amt. Ein zu kurzer Zeitraum ergibt keine belastbare Quote — deshalb erscheinen sie hier nicht statt mit dem Wert null.",
  "rankings.noPreviousMonth":
    "Für die gesamte Wahlperiode gibt es keinen Vormonat. Wählen Sie einen Monat.",

  // Which ballots the cross-party board's numbers are *of*. Not a caveat but a
  // statement of scope: the two scopes of `getCrossPartyRankings` produce the
  // same row shape over very different sets, so the page says which one it got
  // rather than leaving a reader to assume — a dissent count over an unnamed
  // subset is a number without a meaning. The period scope reports no
  // `ballotsExamined` (it examined all of them, which is not a window), which
  // is why one of these takes a count and the other cannot.
  "rankings.crossPartyPeriod": "Gezählt über alle namentlichen Abstimmungen der Wahlperiode.",
  "rankings.crossPartyWindow": "Gezählt über die letzten {count} namentlichen Abstimmungen.",

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
  // A joint act, collapsed into one row. `{count}` is how many further actors
  // the row did not have space to name — never "co-sponsors": DIP publishes no
  // signing order, so every name in a group is equal and calling the ones past
  // the third "co-" would invent a rank the source does not record. See
  // lib/feed-grouping.ts.
  "feed.andOthers": "und {count} weitere",
  "feed.jointCount": "{count} Abgeordnete",
  "feed.showAllActors": "Alle {count} anzeigen",
  "feed.jointNote":
    "Gemeinsam eingebracht. Die Reihenfolge ist die der Datenquelle — eine Erst- oder Mitzeichnung wird vom DIP nicht veröffentlicht.",
  // Collapse as well as expand: a reader who opened forty names has every
  // reason to want them out of the way again. See components/activity-feed-item.tsx.
  "feed.collapseActors": "Weniger anzeigen",

  // --- what an entry contributed to the activity score ---------------------

  // The row's own contribution. `{points}` is already formatted by
  // `formatScore`, so the sign lives in the string rather than in the number —
  // a contribution is always an addition, and "+" says so without implying a
  // change over time the way `formatDelta` would.
  "feed.score.total": "+{points} Punkte",
  // The arithmetic behind the total, so the figure can be checked rather than
  // trusted. Every member of a group scores the same — the grouping key
  // contains both fields the score reads — which is what makes this a
  // multiplication rather than a sum. See lib/feed-scoring.ts.
  "feed.score.perMember": "{count} × {points}",
  "feed.score.label": "Beitrag zum Aktivitätswert",
  // Shown instead of a figure. Naming the limit rather than printing a dash:
  // each is a case where the score exists but cannot be apportioned to one
  // record, which is a different claim from "scored zero".
  "feed.score.unscorable": "Kein Einzelwert",
  "feed.score.reason.rate":
    "Die Abstimmungsteilnahme ist eine Quote über alle namentlichen Abstimmungen, kein Wert je Abstimmung — ein einzelner Eintrag trägt keinen eigenen Betrag.",
  "feed.score.reason.perWord":
    "Reden werden nach Wortzahl gewichtet, nicht je Beitrag. Die Wortzahl steht am Redebeitrag selbst, nicht an diesem Eintrag.",
  "feed.score.reason.standing":
    "Ausschussarbeit zählt als Sitz, nicht als datiertes Ereignis — es gibt keinen Wert je Eintrag.",
  "feed.score.reason.unrecognised":
    "Diese Aktivitätsart ist in der Gewichtung noch nicht erfasst. Sie wird gezählt und ausgewiesen, statt still mit null zu gewichten.",

  // --- sorting and filtering the feed --------------------------------------

  "feed.sort.label": "Sortieren",
  "feed.sort.chronological": "Neueste zuerst",
  "feed.sort.score": "Höchster Wert zuerst",
  // The honest boundary of a client-side sort over a cursor-paginated feed:
  // it orders what has been loaded, not the period. Stated rather than implied,
  // because a sorted list looks complete.
  "feed.sort.loadedOnly":
    "Sortiert und filtert die bereits geladenen Einträge — nicht die gesamte Wahlperiode. „Mehr laden“ holt weitere.",
  "feed.filter.minScore": "Mindestwert",
  // Rows without an apportionable value are kept when the threshold is zero and
  // dropped above it — they cannot be compared against a number. Said out loud,
  // since silently hiding votes and speeches would look like missing data.
  "feed.filter.minScoreNote": "Einträge ohne Einzelwert werden ab einem Mindestwert ausgeblendet.",
  "feed.filter.hidden": "{count} ausgeblendet",

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
  "mps.allStates": "Alle Bundesländer",
  "mps.filterCommittee": "Ausschuss",
  "mps.allCommittees": "Alle Ausschüsse",
  "mps.filterElectionMethod": "Mandatsart",
  "mps.allElectionMethods": "Alle Mandatsarten",
  // Stammdaten's `MANDATSART` values, in the words a reader uses for them:
  // a direct mandate is won in a Wahlkreis, a list mandate off a Landesliste.
  "mps.electionDirect": "Direktmandat",
  "mps.electionList": "Listenmandat",
  "mps.sortBy": "Sortieren nach",
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
  // abgeordnetenwatch's `occupation` — what the MP does *now*, as against
  // `mp.profession`, which is Stammdaten's `BERUF` and is what they did before
  // the mandate. Two labels because the sources answer two questions; see
  // `occupationOf` in lib/bundestag.ts for which one wins where both exist.
  "mp.occupation": "Tätigkeit",
  "mp.electionMethod": "Mandatsart",
  "mp.datesInOffice": "Mandatszeit",
  "mp.stillServing": "im Amt",
  "mp.noBiography": "Für diese Wahlperiode liegen keine biografischen Angaben vor.",
  // The licence condition on every portrait, not a courtesy — see the header of
  // components/mp-photo.tsx and convex/schema.ts:207. "Foto:" rather than
  // "Bildnachweis:" because it sits under a picture where the shorter form is
  // the German convention and the longer one is a form label.
  "mp.photoCredit": "Foto: {credit}",

  // --- contact ---
  //
  // ⚠ There is deliberately no email and no phone key. Neither is published
  // anywhere — `MDB_STAMMDATEN.DTD` declares no contact elements and the
  // biography pages carry no `mailto:` or `tel:` links — so `mp.contactForm` is
  // the Bundestag's own substitute. A label for an address the app never has
  // would read as a value the pipeline failed to fetch.
  "mp.contact": "Kontakt",
  "mp.contactForm": "Kontaktformular",
  "mp.contactFormHint": "Der Bundestag veröffentlicht keine E-Mail-Adressen.",
  "mp.constituencyOffice": "Wahlkreisbüro",
  "mp.homepage": "Webseite",
  "mp.socials": "Soziale Netzwerke",
  // The Berlin office is the same for all 630 members, so it belongs in the UI
  // as a constant rather than in 630 rows — see the note on `contact` in
  // convex/schema.ts.
  "mp.berlinOffice": "Bundestagsbüro",
  "mp.berlinAddress": "Platz der Republik 1\n11011 Berlin",
  "mp.noContact": "Für diese Abgeordnete oder diesen Abgeordneten sind keine Kontaktdaten erfasst.",
  // The empty state, spelled out. `mp.noContact` above says *that* nothing is
  // recorded; these two say *what that means* — which is the whole difference
  // between a sparse record and a broken page. The card used to render nothing
  // at all in this state, so a reader could not tell an absent source from a
  // failed fetch (GAP-003 of docs/implementation-gap-audit-2026-07-29.md).
  //
  // The second line is the same fact `mp.contactFormHint` states beside the
  // form link, said where there is no form link to attach it to — and it is
  // stated as the Bundestag's practice rather than as this site's shortfall,
  // because that is what it is.
  "mp.noContactExplain":
    "Der Bundestag veröffentlicht weder E-Mail-Adressen noch Telefonnummern von Abgeordneten — auch nicht dort, wo Kontaktdaten vorliegen. Für diese Abgeordnete oder diesen Abgeordneten ist zudem kein Kontaktformular, keine Webseite und kein Wahlkreisbüro hinterlegt.",
  /** The substitute that always exists: the postal address of the Bundestag
   * itself, which reaches every member. Says what the address is *for* — the
   * `mp.berlinOffice` label directly above already names it, so repeating the
   * name here would print "Bundestagsbüro" twice in three lines. Under a
   * heading that has just said nothing is recorded, an unlabelled address reads
   * as a contradiction; this is the sentence that resolves it. */
  "mp.postalSubstitute": "Schriftlich erreichbar unter der Anschrift des Bundestages:",
  /** The directory, as the last resort that is always true: the Bundestag's own
   * MP listing. Not a per-MP URL — the pipeline stores none for a member it
   * could not match — so it points at the roster rather than guessing a page. */
  "mp.officialDirectory": "Abgeordnetenverzeichnis des Bundestages",
  /** The header's jump to the card below. A skip link within the profile, in
   * the same spirit as `protokoll.skipToData` on `/`. */
  "mp.jumpToContact": "Kontakt",
  "mp.committeeRole": "Funktion",
  "mp.committeePeriod": "Zeitraum",
  "mp.noCommittees": "Keine Ausschussmitgliedschaften erfasst.",
  "mp.latestSpeeches": "Neueste Reden",
  "mp.latestMotions": "Neueste Anträge",
  "mp.latestQuestions": "Neueste Anfragen",
  "mp.latestVotes": "Neueste namentliche Abstimmungen",
  "mp.noQuestions": "Für diese Wahlperiode sind keine Anfragen erfasst.",
  // The two instruments, named as the Bundestag names them. Not translated into
  // a description ("schriftliche Anfrage") because these are the terms on the
  // Drucksache and the ones a reader will search for.
  "mp.questionMajor": "Große Anfrage",
  "mp.questionMinor": "Kleine Anfrage",
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

  // --- dissent over a whole electoral period ---
  //
  // The period figure, as opposed to `mp.partyLineAgainst`, which labels a
  // single ballot. The distinction is the one components/dissent-badge.tsx
  // draws at length between itself and `RebelVoteBadge`: one vote against the
  // group is an event, a rate across a period is a pattern, and the second is
  // the larger claim.
  //
  // `mp.dissentNotComputed` and `mp.dissentNone` are deliberately different
  // strings. A member the backfill has not reached and a member who never broke
  // with their group are opposite statements, and `getDissentTally` returns
  // null for the first precisely so the page need not conflate them — see the
  // header of lib/dissent.ts.
  "mp.dissent": "Abweichung von der Fraktionslinie",
  "mp.dissentBadge": "Abweichler:in",
  // `{rate}` and `{ballots}` come from `DISSENT_BADGE_RATE` and
  // `DISSENT_MIN_BALLOTS`, never from this string — see components/dissent-badge.tsx.
  "mp.dissentBadgeTooltip":
    "Weicht in mindestens {rate} der abgegebenen Stimmen von der eigenen Fraktion ab, bei mindestens {ballots} abgegebenen Stimmen.",
  "mp.dissentNotComputed": "Für diese Wahlperiode ist noch keine Abweichung berechnet.",
  "mp.dissentNoBallots":
    "In dieser Wahlperiode wurde in keiner namentlichen Abstimmung eine Stimme abgegeben.",
  // `{cast}` is the denominator, and it is named in both branches: "keine
  // Abweichung" without the number of votes behind it is a claim over an
  // unnamed set.
  "mp.dissentNone": "Keine Abweichung bei {cast} abgegebenen Stimmen.",
  "mp.dissentCount": "{count} Abweichungen bei {cast} abgegebenen Stimmen.",
  "mp.dissentRate": "Abweichungsquote {rate}",
  // The period's ballots, not the member's — context for the denominator above
  // rather than part of it. See `ballotsInPeriod` in convex/votes.ts.
  "mp.dissentOfBallots": "{ballots} namentliche Abstimmungen in der Wahlperiode",
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

  // --- published ballot outcomes ---
  //
  // The German values here are the Bundestag's own `beschlusstenor` wording,
  // **byte for byte**. That is load-bearing rather than stylistic: the /votes
  // result filter groups on the stored string (convex/votes.ts) and matches the
  // reader's selection against it exactly, so a "tidied" value here would make
  // the badge disagree with the dropdown that selects it. lib/vote-outcomes.ts
  // pins the identity with a round-trip test.
  //
  // Only the tenors seen in the corpus are listed, and the map is exact-match:
  // `beschlusstenor` is free text (§3.2), so an unrecognised outcome keeps its
  // own German words rather than being rounded to the nearest translation.
  "votes.outcome.pending": "Ausstehend",
  "votes.outcome.annahme": "Annahme",
  "votes.outcome.ablehnung": "Ablehnung",
  "votes.outcome.annahmeDerVorlage": "Annahme der Vorlage",
  "votes.outcome.ablehnungDerVorlage": "Ablehnung der Vorlage",
  "votes.outcome.annahmeInAusschussfassung": "Annahme in Ausschussfassung",
  "votes.outcome.ueberweisung": "Überweisung",
  "votes.outcome.erledigt": "Erledigt",
  "votes.outcome.zurueckgezogen": "Zurückgezogen",

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

  // --- votes on the Bundestag's own resources ---
  // ⚠ The only curated list of ballots on this site. The strings here carry
  // three things a query-driven page never has to say: that the selection is
  // editorial, when it was last reviewed, and — crucially — the counterweight.
  // The page must not publish one side of a live dispute, so `audited` is not
  // optional trimming: it is the reason the page is publishable at all.
  "votes.ownResources.title": "Abstimmungen über eigene Angelegenheiten",
  "votes.ownResources.subtitle":
    "Namentliche Abstimmungen, in denen der Bundestag über seine eigenen Ressourcen entschieden hat: Parteienfinanzierung, politische Stiftungen und das Wahlrecht, das über die Mandate selbst bestimmt.",
  "votes.ownResources.curatedNotice":
    "Diese Sammlung ist redaktionell zusammengestellt. Die Abstimmungen und alle Zahlen stammen unverändert aus den amtlichen Abstimmungslisten des Bundestages — die Auswahl, welche Abstimmung hierher gehört, ist dagegen eine Einordnung dieser Redaktion und kein Merkmal der Quelldaten.",
  "votes.ownResources.asOf": "Stand: {month}.",
  /** Der Hinweis neben dem Link auf /votes — sagt, dass die Sammlung eine
   * Auswahl ist, damit der Link nicht wie ein weiterer Filter aussieht. */
  "votes.ownResources.linkHint": "— eine redaktionelle Auswahl aus diesen Abstimmungen.",
  // The counterweight. Fraktion finances ARE audited — stating the scrutiny
  // question without the existing scrutiny would be an argument, not a record.
  "votes.ownResources.audited":
    "Gegenposition, die dazugehört: Die Mittel der Fraktionen unterliegen der Prüfung durch den Bundesrechnungshof (§ 53 Abgeordnetengesetz), und die Parteien legen jährliche Rechenschaftsberichte vor, die vom Bundestagspräsidenten geprüft werden. Dass ein Parlament über eigene Ressourcen entscheidet, heißt nicht, dass diese Mittel unkontrolliert bleiben.",
  // Why there is no Diäten section. An absent category is a finding only if the
  // reader knows why it is absent.
  "votes.ownResources.payNotice":
    "Zu den Abgeordnetenentschädigungen („Diäten“) findet sich hier keine Abstimmung, weil es keine gibt: Seit der Reform von 2014 wird die Entschädigung nach § 11 Abgeordnetengesetz jährlich automatisch an den Nominallohnindex des Statistischen Bundesamtes angepasst — ohne Beschluss des Bundestages und damit ohne namentliche Abstimmung.",
  "votes.ownResources.empty":
    "Die Abstimmungen dieser Sammlung sind noch nicht in die Datenbank geladen.",
  "votes.ownResources.topic.pay": "Entschädigung",
  "votes.ownResources.topic.partyFinancing": "Parteienfinanzierung",
  "votes.ownResources.topic.foundations": "Politische Stiftungen",
  "votes.ownResources.topic.electoralLaw": "Wahlrecht",
  // One rationale per curated ballot — the sentence that says why *this* vote
  // belongs in the collection. Kept per-ballot rather than per-topic: a generic
  // reason would be a category label repeated, and the grounds are the part a
  // reader should be able to disagree with specifically.
  "votes.ownResources.rationale.parteiengesetz20":
    "Änderung des Parteiengesetzes: Der Bundestag beschließt über die staatliche Finanzierung genau der Parteien, denen seine Mitglieder angehören.",
  "votes.ownResources.rationale.stiftungsfinanzierung20":
    "Das Stiftungsfinanzierungsgesetz regelt erstmals gesetzlich die Mittel für die parteinahen politischen Stiftungen — und damit Gelder, die den im Bundestag vertretenen Parteien nahestehen.",
  "votes.ownResources.rationale.wahlrecht20":
    "Die Wahlrechtsreform 2023 verkleinerte den Bundestag und strich die Grundmandatsklausel: Die Abgeordneten stimmten darüber ab, wie viele Mandate es künftig gibt und unter welchen Bedingungen Fraktionen einziehen.",
  "votes.ownResources.rationale.wahlrechtBundeswahlgesetz20":
    "Erneute Änderung des Bundeswahlgesetzes — eine Entscheidung darüber, nach welchen Regeln die Mandate vergeben werden, getroffen von den Inhaberinnen und Inhabern dieser Mandate.",
  "votes.ownResources.rationale.wahlpruefung20":
    "Wahlprüfung: Der Bundestag entscheidet über Einsprüche gegen die Gültigkeit der Wahl, aus der er selbst hervorgegangen ist.",
  "votes.ownResources.rationale.wahlpruefung21":
    "Zurückweisung von Einsprüchen gegen die Bundestagswahl — der Bundestag befindet über die Rechtmäßigkeit seiner eigenen Zusammensetzung.",

  // --- vote detail ---
  "votes.backToList": "Zurück zu den Abstimmungen",
  "votes.notFound": "Diese Abstimmung existiert nicht oder wurde noch nicht geladen.",
  // Shown when the tallies printed on the sheet do not add up to the rows
  // counted from it. Surfaced rather than silently corrected: a mismatch is a
  // fact about the source document, and picking one number over the other
  // would hide it.
  "votes.tallyMismatch": "Die veröffentlichten Summen weichen von den gezählten Stimmen ab.",
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

  // --- lame-duck ballots ---
  // A ballot taken after an election and before the new Bundestag convened.
  // "Geschäftsführend" is the word German uses for an authority that continues
  // in office after its mandate has run out — the same word applied to a
  // caretaker government — and it is the one a German reader recognises.
  "votes.lameDuck": "Geschäftsführend",
  "votes.lameDuckTooltip":
    "Abgestimmt nach der Bundestagswahl, aber vor der konstituierenden Sitzung des neuen Bundestages: Der alte Bundestag war zu diesem Zeitpunkt bereits abgewählt, aber noch voll handlungsfähig.",
  // The badge is two words; this is what they mean. Deliberately states that the
  // vote was lawful — the flag marks a fact about the calendar, not a verdict on
  // the ballot, and a notice that left that out would read as an accusation.
  "votes.lameDuckNotice":
    "Diese Abstimmung fand zwischen der Bundestagswahl und der konstituierenden Sitzung des neuen Bundestages statt. Nach Art. 39 Abs. 1 GG endet die Wahlperiode erst mit dem Zusammentritt des neuen Bundestages — der alte Bundestag war also rechtmäßig und mit allen Befugnissen im Amt, obwohl die Wählerinnen und Wähler ihn bereits ersetzt hatten.",
  "votes.lameDuckMaintained":
    "Wahl- und Konstituierungstermine werden von Bundestracker gepflegt, sie stehen in keinem Bundestags-Datensatz. Stand: {date}.",
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

  // The three groups of the navigation (lib/navigation.ts). Each names the
  // *question* its entries answer rather than the kind of data behind them —
  // "Wer" would be terser but reads as a fragment in a menu heading, so each is
  // the noun the question is about. `nav.groupContext` is "Einordnung" rather
  // than "Kontext": the feed and the methodology are what let a reader place a
  // figure, and Einordnung is the German word for exactly that.
  "nav.groupPeople": "Abgeordnete & Fraktionen",
  "nav.groupDecisions": "Entscheidungen",
  "nav.groupContext": "Einordnung",

  // One-line glosses under the labels in the group menus and the drawer. Where
  // a page already has a subtitle that does this job, lib/navigation.ts points
  // at that key instead of adding a second wording — these are only the entries
  // whose own subtitle is too long for a menu row or interpolates a value the
  // chrome does not have.
  "nav.dashboardHint": "Alle Kennzahlen auf einen Blick.",
  "nav.membersHint": "Alle Mitglieder des Bundestages, filterbar nach Fraktion und Land.",
  "nav.partiesHint": "Fraktionen im Vergleich — Größe, Aktivität, Geschlossenheit.",
  "nav.seatingHint": "Der Plenarsaal, ein Punkt je Mandat.",
  "nav.votesHint": "Namentliche Abstimmungen und wie jede Fraktion gestimmt hat.",
  "nav.ownResourcesHint": "Wenn der Bundestag über eigene Mittel und das Wahlrecht entscheidet.",
  "nav.inquiryHint": "Wer das Viertel nach Art. 44 GG erreicht — und wer nicht.",
  "nav.searchHint": "Abgeordnete und Dokumente im Volltext durchsuchen.",

  // The desktop sidebar's landmark name. `nav.expandGroup` and `nav.overview`
  // were here too and are gone: the overview row reuses `nav.dashboard` rather
  // than saying "Übersicht" in one place and "Dashboard" in every other, and
  // the groups are headings over visible rows rather than controls that expand.
  "nav.primary": "Hauptnavigation",

  // The sidebar's collapse control. Two strings rather than one toggled label,
  // because the button announces what it will *do* and those are two different
  // actions — a single "Seitenleiste umschalten" would leave a screen-reader
  // user unable to tell which state they are in without moving focus into the
  // rail and counting what is there.
  "nav.collapseSidebar": "Seitenleiste einklappen",
  "nav.expandSidebar": "Seitenleiste ausklappen",

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

  // The hero's seating card. "Sitzverteilung ansehen" rather than "Mehr": the
  // arc is a link and a link should say where it goes, especially one whose
  // label is otherwise carried by a picture.
  "home.seatingPreviewLink": "Sitzverteilung des Bundestages ansehen",
  "home.seatingPreviewCta": "Sitzverteilung ansehen",

  "home.topMPsTitle": "Aktivste Abgeordnete",
  "home.topMPsSubtitle": "Nach Aktivitätswert in der laufenden Wahlperiode",
  "home.bottomMPsTitle": "Wenigste erfasste Aktivität",
  "home.bottomMPsSubtitle": "Niedrigster Aktivitätswert der laufenden Wahlperiode",
  // The caveat this section cannot be shown without. The top of a leaderboard
  // needs no defence; the bottom is an accusation unless it says what the
  // number does and does not measure. Three things are true at once: much
  // parliamentary work leaves no machine-readable trace, an office (Präsidium,
  // a ministry) changes what a member does rather than how much, and an MP the
  // nightly sweep has not reached scores 0 without having been idle.
  // The fourth distortion, added with the normalised board: this is a ranking of
  // *totals*, and a member sworn in mid-Wahlperiode had less time to accumulate
  // one. `datesInOffice` was stored per mandate all along and nothing divided by
  // it, so the bottom board was comparing four years against eighteen months
  // without saying so. The sentence names the board that does divide, because a
  // caveat a reader can act on beats one they can only note.
  "home.bottomMPsCaveat":
    "Ein niedriger Wert heißt „wenig erfasst“, nicht „wenig gearbeitet“: Ausschussberatungen, Wahlkreisarbeit und Regierungsämter hinterlassen in den offenen Daten kaum Spuren. Verglichen werden außerdem Gesamtwerte — wer erst im Lauf der Wahlperiode nachgerückt ist, hatte weniger Zeit, einen zu sammeln; die Rangliste „Aktivität je Monat im Amt“ rechnet das heraus. Nur bewertete Mandate erscheinen hier.",
  "home.latestVotesTitle": "Neueste namentliche Abstimmungen",
  "home.feedTitle": "Zuletzt geschehen",
  "home.showAll": "Alle ansehen",

  // --- the home page --------------------------------------------------------
  //
  // The one place on this site where the copy makes an argument rather than
  // labelling a figure, so it is written rather than assembled: five chapters,
  // each a question a first-time reader actually has, answered in a sentence
  // above the data that backs it.
  //
  // Three rules govern every string below and all three are load-bearing.
  //
  // **The subject is Bundestracker, not the Protokoll.** These strings opened
  // as a page *about* the Bundestag's published record — the title was "Das
  // Protokoll" and the lead promised "fünf Kapitel über ein Parlament". That is
  // an essay's framing, and it left the reader on the home page of a site whose
  // own purpose was never stated. What this project is for is the argument the
  // front page has to make: parliamentary work is public, public is not the
  // same as *accessible*, and closing that gap is what the site does. The
  // chapters below now answer that in order — what the chamber is, why
  // transparency needs more than publication, how the measure works, who it
  // ranks, and what happened today.
  //
  // **The narrative may not out-claim the data.** The page's premise is that
  // every figure comes from a Bundestag record (AGENTS.md), so a sentence that
  // says more than the record does costs more here than a dull one. Chapter 3
  // therefore states the score's three structural limits as part of the story
  // instead of leaving them to the caveat boxes — a story that omits the limits
  // of its own measure would be both a worse dashboard and a worse story. That
  // rule binds the new vision copy hardest: "Transparenz" is the one word on
  // this page that could be used to claim anything, so every sentence carrying
  // it names something the site actually does.
  //
  // **German is written first and translated second.** These are not label
  // strings where a literal rendering serves; "Öffentlich ist nicht dasselbe
  // wie zugänglich" is a sentence with a rhythm, and the English is a sibling
  // rather than a gloss.
  //
  // The keys keep their `protokoll.` prefix. Renaming them to `home.*` would
  // collide with the dashboard's own `home.*` block a few lines above — the two
  // pages both exist now, at `/` and `/dashboard`, and one namespace holding
  // both would be a rename that made the file harder to read rather than
  // easier.
  "protokoll.title": "Transparenz durch Daten",
  // The subtitle under the wordmark, before Chapter 1 opens. Says what the site
  // is for, so a reader who wants none of the story can take the skip link
  // beside it knowing what they are skipping.
  "protokoll.lead":
    "Der Bundestag veröffentlicht seine Arbeit — in Tausenden Drucksachen, Protokollen und Abstimmungslisten. Bundestracker macht daraus etwas Nachvollziehbares: jede Rede, jeder Antrag, jede namentliche Abstimmung, jeder Abgeordnete, nachlesbar an einem Ort.",
  // §7's requirement #1, and the one this redesign is most likely to lose: a
  // returning reader who wants today's Abstimmungen must not have to scroll
  // through a story they have read. A quiet link, not a modal and not a stored
  // preference.
  "protokoll.skipToData": "Direkt zu den Daten",
  "protokoll.readTheRecord": "Das Protokoll lesen",
  // The rail down the left gutter. Decorative to the eye, but it is also the
  // chapter navigation, so it is named for a screen reader.
  "protokoll.progressLabel": "Fortschritt auf dieser Seite",
  "protokoll.chapterLabel": "Kapitel {index}: {title}",

  "protokoll.chapter1Number": "Kapitel eins",
  "protokoll.chapter1Title": "Ein Parlament, 630 Sitze",
  "protokoll.chapter1Standfirst":
    "Der 21. Deutsche Bundestag hat 630 Sitze — jeder davon ein Mandat, jedes Mandat eine Person, die im Namen von rund 60 Millionen Wahlberechtigten abstimmt. Das ist der Gegenstand dieser Seite.",
  // Under the arc, and both figures are needed at once: how many seats are
  // drawn so far, and how many there are. One interpolated string rather than a
  // figure beside a label, because the label *also* contained a count and the
  // two rendered as "635635 Sitze" — see `SeatCount` in
  // components/home-protokoll/chapter-chamber.tsx for the measurement.
  "protokoll.chapter1SeatsDrawn": "{drawn} von {total} Sitzen",
  // Scrolls into view as the arc completes. The one sentence that says what the
  // picture is *not*, because a picture of a parliament is read as a picture of
  // *that* parliament — the same warning components/seating-notice.tsx carries.
  "protokoll.chapter1Note":
    "Die Fraktionsgrößen sind amtlich belegt; die Position eines einzelnen Sitzes im Bogen ist es nicht — eine maschinenlesbare Sitzordnung veröffentlicht der Bundestag nicht.",
  // Why the arc can say more than 630 while the Kapitelüberschrift says 630.
  // Both Zahlen sind richtig und meinen Verschiedenes: 630 sind die
  // gleichzeitig besetzten Sitze, der Bogen zählt Mandate, und ein Sitz kann in
  // einer Wahlperiode zwei davon tragen. Ohne diesen Satz stehen zwei Zahlen
  // nebeneinander, von denen eine falsch aussieht — genau die Sorte plausibler
  // Fehlzahl, die diese Codebasis sonst überall vermeidet.
  "protokoll.chapter1MandateNote":
    "Der Bogen zählt Mandate, nicht gleichzeitig besetzte Sitze: Scheidet jemand aus und rückt jemand nach, trägt ein Sitz in einer Wahlperiode zwei Mandate. Deshalb liegt die Summe der Fraktionen über den 630 Sitzen des Bundestages.",

  "protokoll.chapter2Number": "Kapitel zwei",
  "protokoll.chapter2Title": "Warum Transparenz zählt",
  // The chapter that carries the site's reason to exist, so it is the one that
  // must not overclaim. The distinction it turns on — published is not the same
  // as accessible — is a statement about the sources rather than about
  // politics: the data *is* all public, and it arrives as thousands of separate
  // documents that no one reads end to end. That gap is what a tracker closes,
  // and it is the honest version of "empowering citizens".
  "protokoll.chapter2Standfirst":
    "Öffentlich ist nicht dasselbe wie zugänglich. Jeder Antrag, jede Rede, jede namentliche Abstimmung wird veröffentlicht — verteilt auf Zehntausende Dokumente, die niemand vollständig liest. Bundestracker zählt sie zusammen und macht sie vergleichbar. Hinzugerechnet wird nichts.",

  "protokoll.chapter3Number": "Kapitel drei",
  "protokoll.chapter3Title": "Wie wir messen",
  "protokoll.chapter3Standfirst":
    "Sieben Größen, jede mit einem Gewicht, aufsummiert zu einer Zahl. Die Gewichtung ist eine Setzung — deshalb steht sie hier offen, statt hinter dem Ergebnis zu verschwinden.",
  // The thesis of the whole page, and currently invisible on the home page: the
  // seven components collapse into one number, and the number can be taken back
  // apart. That is what makes the measure inspectable rather than a verdict.
  "protokoll.chapter3Collapse":
    "Sieben Komponenten, eine Zahl — und jederzeit wieder in ihre Bestandteile zerlegbar.",
  "protokoll.chapter3Example": "Beispielrechnung mit den Standardgewichtungen",
  // The three structural limits from lib/scoring.ts, stated as part of the
  // argument rather than as a footnote under it. No weighting fixes any of
  // them, which is exactly why they belong in the chapter that explains the
  // weighting.
  "protokoll.chapter3Limits":
    "Drei Grenzen bleiben, unabhängig von jeder Gewichtung: Abstimmungsteilnahme umfasst nur namentliche Abstimmungen, Ausschussdaten liegen nur für die laufende Wahlperiode vor, und Redebeiträge werden nach Wörtern gezählt, nicht nach Wortmeldungen. Ein niedriger Wert heißt „wenig erfasst“, nie „wenig gearbeitet“.",

  "protokoll.chapter4Number": "Kapitel vier",
  "protokoll.chapter4Title": "Wer ist aktiv?",
  "protokoll.chapter4Standfirst":
    "Beide Enden derselben Rangliste, nebeneinander. Ein Tracker, der nur die Spitze veröffentlicht, veröffentlicht eine Bestenliste — und keine überprüfbare Messung.",

  "protokoll.chapter5Number": "Kapitel fünf",
  "protokoll.chapter5Title": "Der aktuelle Stand",
  "protokoll.chapter5Standfirst":
    "Der laufende Betrieb: die zuletzt namentlich abgestimmten Vorlagen und die jüngsten Einträge im Protokoll. Diese Seite aktualisiert sich, sobald die nächtliche Auswertung neue Daten geladen hat.",

  // The closing block, after the last chapter. Ends on what the reader can *do*
  // — which is the point of the whole page, and was previously a statement
  // about the data's provenance ("Das ganze Protokoll") that read as a second
  // conclusion rather than as an invitation. The traceability claim it made is
  // kept, because it is what makes the invitation credible, but it now supports
  // the call rather than being it.
  "protokoll.outroTitle": "Sehen Sie selbst nach",
  "protokoll.outroLead":
    "Suchen Sie Ihren Wahlkreisabgeordneten, vergleichen Sie Fraktionen, lesen Sie nach, wer wie abgestimmt hat. Jede Zahl auf dieser Seite lässt sich bis zu dem Dokument zurückverfolgen, aus dem sie stammt.",

  // --- the opening animation ("630 Sitze") ----------------------------------
  //
  // Everything visible in the splash is decorative and `aria-hidden`; these are
  // the strings that are not. §6: it runs once per session, never blocks the
  // data fetch underneath it, is skipped entirely under reduced motion or
  // Datensparmodus, and can be dismissed by any key, click or scroll.
  "protokoll.splashLabel": "Eröffnungssequenz",
  "protokoll.splashSkip": "Überspringen",
  "protokoll.splashCounting": "630 Sitze",

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

  // --- party comparison ---------------------------------------------------
  //
  // Every figure on `/parties` is a **Durchschnitt je bewertetem Mandat**,
  // never a Fraktionssumme, and the strings say so repeatedly rather than once
  // in a footnote. convex/stats.ts explains why a per-MP count may not be
  // summed (§3.4 emits one record per MP per document, so a Kleine Anfrage with
  // forty signatories is forty rows) — and the error would grow with the
  // Fraktion, which is exactly the axis this page compares on. A reader who
  // takes a bar for a party total has been misled by us.

  "nav.parties": "Fraktionen",

  "parties.title": "Fraktionsvergleich",
  "parties.subtitle":
    "Die Fraktionen des Bundestages nebeneinander — je Kennzahl der Durchschnitt eines Mandats, nicht die Summe der Fraktion.",

  // The notice above the charts. The most important string on the page, for
  // the reason `seating.syntheticNotice` is the most important one on its own:
  // it names what the numbers are before any of them is read.
  "parties.meansNotice":
    "Alle Werte sind Mittelwerte je bewertetem Mandat. Fraktionssummen werden bewusst nicht ausgewiesen: Das DIP erfasst einen Datensatz je Abgeordneter und Dokument, sodass eine gemeinsam eingebrachte Anfrage so oft zählt, wie sie unterzeichnet wurde — eine Summe würde große Fraktionen um genau diesen Faktor überschätzen.",
  "parties.coverage": "{scored} von {mandates} Mandaten sind bewertet.",
  // Shown when the two diverge: a mean over an incomplete sweep is a real
  // figure about an incomplete set, which the reader has to be able to see.
  //
  // Two keys rather than one with a `{missing}` placeholder doing double duty,
  // following lib/relative-time.ts: the singular/plural choice is made *by key*
  // so each language can split where it actually splits, and neither ends up
  // printing "1 Mandate". German and English happen to agree at one here, which
  // is not a reason to assume the next language will.
  "parties.coverageGapOne":
    "Die nächtliche Berechnung hat ein Mandat noch nicht erfasst. Es fehlt in jedem Mittelwert auf dieser Seite — es zählt nicht als Null.",
  "parties.coverageGap":
    "Die nächtliche Berechnung hat {missing} Mandate noch nicht erfasst. Sie fehlen in jedem Mittelwert auf dieser Seite — sie zählen nicht als Null.",
  "parties.empty": "Für diese Wahlperiode liegen noch keine Fraktionsdaten vor.",

  "parties.table.title": "Aktivitätswert je Fraktion",
  "parties.table.subtitle": "Durchschnittlicher Aktivitätswert eines Mandats, absteigend.",
  "parties.column.party": "Fraktion",
  "parties.column.seats": "Mandate",
  "parties.column.scored": "bewertet",
  "parties.column.meanScore": "Ø Aktivitätswert",
  // Beside the mean rather than instead of it: the two disagree exactly where
  // it matters, because one sehr aktives Mandat hebt den Mittelwert und lässt
  // den Median unberührt. In einer Dreier-Gruppe ist das der Unterschied
  // zwischen Befund und Artefakt.
  "parties.column.medianScore": "Median",
  "parties.medianNote":
    "Der Median steht neben dem Mittelwert, weil beide dort auseinanderfallen, wo es darauf ankommt: Ein einzelnes sehr aktives Mandat hebt den Mittelwert und lässt den Median unberührt.",

  "parties.radar.title": "Alle Kennzahlen im Vergleich",
  "parties.radar.subtitle":
    "Sechs Kennzahlen, je Achse auf die führende Fraktion normiert. Die Fläche zeigt die relative Stellung, nicht die absolute Menge.",
  // The caveat the radar cannot be shown without. Six axes in six different
  // units on one radius is only readable if each is scaled — and a scaled axis
  // says "relative to the leader", which is a different claim from the number
  // it was built from. See lib/party-comparison.ts.
  "parties.radarCaveat":
    "Jede Achse ist auf die jeweils führende Fraktion normiert (100 %), weil die sechs Kennzahlen in sechs verschiedenen Einheiten gemessen werden — Wortzahlen erreichen fünf Stellen, Ausschusssitze einstellige Werte. Ein größeres Sechseck bedeutet daher „im Vergleich weiter vorn“, nicht „mehr“. Der gemessene Durchschnitt steht im Tooltip.",
  "parties.radarLegend": "Fraktion ein- oder ausblenden",
  "parties.radarTooltipShare": "{share} der führenden Fraktion",

  "parties.metrics.title": "Einzelne Kennzahlen",
  "parties.metrics.subtitle": "Fraktionen nach einer Kennzahl, absteigend sortiert.",

  "parties.metric.score": "Aktivitätswert",
  "parties.metric.score.short": "Wert",
  "parties.metric.score.desc":
    "Gewichtete Summe aller messbaren Vorgänge, im Durchschnitt je bewertetem Mandat.",
  "parties.metric.motions": "Anträge",
  "parties.metric.motions.short": "Anträge",
  "parties.metric.motions.desc":
    "Anträge und Entschließungsanträge je Mandat, gezählt aus DIP-Aktivitäten.",
  "parties.metric.speechWords": "Redeumfang (Wörter)",
  "parties.metric.speechWords.short": "Wörter",
  "parties.metric.speechWords.desc":
    "Im Plenum gesprochene Wörter je Mandat. Dies ist der Wert, den die Bewertung nutzt — und die Achse, die im Netzdiagramm für „Reden“ steht.",
  "parties.metric.speeches": "Redebeiträge",
  "parties.metric.speeches.short": "Reden",
  "parties.metric.speeches.desc":
    "Wortmeldungen je Mandat. Nicht im Netzdiagramm: Die Fragestunde zerlegt einen Ministerbeitrag in Dutzende Antworten, sodass eine Achse hierauf vor allem Regierungsämter abbilden würde.",
  "parties.metric.questions": "Anfragen",
  "parties.metric.questions.short": "Anfragen",
  "parties.metric.questions.desc": "Kleine und Große Anfragen je Mandat.",
  "parties.metric.votes": "Abstimmungsbeteiligung",
  "parties.metric.votes.short": "Beteiligung",
  "parties.metric.votes.desc":
    "Anteil der namentlichen Abstimmungen, an denen abgestimmt wurde. Enthaltung zählt als Teilnahme.",
  "parties.metric.committees": "Ausschusssitze",
  "parties.metric.committees.short": "Ausschüsse",
  "parties.metric.committees.desc": "Ausschussmitgliedschaften je Mandat.",
  "parties.metric.bills": "Gesetzentwürfe",
  "parties.metric.bills.short": "Gesetze",
  "parties.metric.bills.desc": "Mitgezeichnete Gesetzentwürfe je Mandat.",
  "parties.metric.reports": "Berichte",
  "parties.metric.reports.short": "Berichte",
  "parties.metric.reports.desc": "Berichte je Mandat — die dünnste der neun Kennzahlen.",

  "parties.caveat.score":
    "Der Aktivitätswert ist eine gewichtete Summe; die Gewichtung ist eine Setzung, keine Wertung. Ein Fraktionsdurchschnitt erbt diese Setzung.",
  // §9 puts fraktionslos at 3 seats against CDU/CSU's 209. One busy independent
  // moves that mean by a third. Shown anyway — an MP with no group holds a
  // seat, the same call SEATING_ORDER makes — with the warning beside it.
  "parties.smallGroupCaveat":
    "Bei kleinen Gruppen ist ein Mittelwert instabil: Bei drei Mandaten verschiebt ein einzelnes sehr aktives Mitglied den Durchschnitt um ein Drittel. Die Mandatszahl steht deshalb in jeder Tabelle daneben.",

  // --- mandate composition ---
  // The one section on this page whose figures are counts rather than means,
  // which is why `countNotice` exists: the notice at the top of the page tells
  // the reader everything is a mean, and this is where that stops.
  "parties.mandates.title": "Mandatsarten",
  "parties.mandates.subtitle":
    "Wie die Mitglieder jeder Fraktion in den Bundestag gekommen sind: über ein Direktmandat im Wahlkreis oder über eine Landesliste.",
  // "Mandate", nicht "Sitze": Der Datensatz zählt Mandate der Wahlperiode, und
  // die sind wegen Nachrückerinnen und Nachrückern zahlreicher als die 630
  // gleichzeitigen Sitze. Siehe `chamberMandateSplit`.
  "parties.mandates.headline": "{direct} von {total} Mandaten sind Direktmandate",
  "parties.mandates.headlineShare": "({share} der zugeordneten Mandate)",
  "parties.mandates.rowCounts": "{direct} direkt · {list} Liste",
  "parties.mandates.countNotice":
    "Anders als die übrigen Zahlen auf dieser Seite sind dies vollständige Auszählungen, keine Mittelwerte: Die Mandatsart steht im Stammdatensatz jedes Mandats und hängt nicht davon ab, ob die Aktivität bereits bewertet wurde. Mandate ohne hinterlegte Mandatsart bleiben ungezählt und erscheinen weder als Direkt- noch als Listenmandat.",

  // --- coalition vs opposition ---
  "parties.coalition.title": "Regierung und Opposition",
  "parties.coalition.subtitle":
    "Dieselben Kennzahlen, zu zwei Blöcken zusammengefasst — gewichtet nach bewerteten Mandaten, nicht nach Fraktionen.",
  "parties.coalition.parties": "Fraktionen",
  "parties.coalition.seats": "{count} Mandate",
  // Not "die Opposition arbeitet mehr": the government answers questions rather
  // than asking them, so the two blocs are measured on instruments they use for
  // different purposes. That is a real asymmetry of the institution and not a
  // finding about anyone's diligence.
  "parties.coalition.caveat":
    "Regierung und Opposition nutzen unterschiedliche parlamentarische Instrumente: Anfragen sind ein Mittel der Opposition, Gesetzentwürfe kommen überwiegend aus den Regierungsfraktionen. Ein Unterschied zwischen den Blöcken beschreibt daher vor allem diese Rollenverteilung.",
  "parties.coalition.unavailable":
    "Für diese Wahlperiode ist keine Regierungszugehörigkeit hinterlegt, deshalb ist kein Vergleich möglich.",
  "parties.coalition.difference": "Unterschied",

  // --- party discipline ---
  "parties.discipline.title": "Fraktionsdisziplin",
  "parties.discipline.subtitle":
    "Anteil der Stimmen, die mit der Mehrheit der eigenen Fraktion abgegeben wurden.",
  "parties.discipline.column.rate": "Zustimmung zur Fraktionslinie",
  "parties.discipline.column.withLine": "auf Linie",
  "parties.discipline.column.against": "abweichend",
  "parties.discipline.column.ballots": "Abstimmungen",
  "parties.discipline.window": "Ausgewertet wurden die letzten {count} namentlichen Abstimmungen.",
  "parties.discipline.empty":
    "Für diese Wahlperiode sind keine namentlichen Abstimmungen erfasst, aus denen sich eine Fraktionslinie ergäbe.",
  // Two things at once: the window is bounded (a rate over an unnamed subset of
  // ballots means nothing), and the level is uninformative while the
  // differences are not — nearly every named ballot is whipped.
  "parties.disciplineCaveat":
    "Nahezu alle namentlichen Abstimmungen verlaufen innerhalb der Fraktionen einstimmig; aussagekräftig ist deshalb der Abstand zwischen 97 % und 99 %, nicht die Höhe an sich. Nicht abgegebene Stimmen bleiben außer Betracht — Abwesenheit ist keine Abweichung. Abstimmungen, in denen eine Fraktion exakt gespalten war, haben keine Linie und zählen nicht.",

  // --- one party's members ---
  "parties.members.title": "Abgeordnete der Fraktion {party}",
  "parties.members.subtitle": "Nach Aktivitätswert in der laufenden Wahlperiode.",
  "parties.members.count": "{scored} von {total} Mandaten bewertet",
  "parties.members.empty": "Für diese Fraktion sind in dieser Wahlperiode keine Mandate erfasst.",
  // Rank 0 in `getPartyMembers` — a member the nightly sweep has not reached.
  // Listed rather than dropped, so the list agrees with the seat count above
  // it, but unranked: they have no measured activity to be placed by.
  "parties.members.unscored": "noch nicht bewertet",
  "parties.backToParties": "Zurück zum Fraktionsvergleich",
  "parties.notFound": "Diese Fraktion gibt es nicht.",
  "parties.viewMembers": "Abgeordnete ansehen",

  // --- homepage card ---
  "home.partiesTitle": "Fraktionen im Vergleich",
  "home.partiesSubtitle": "Durchschnittlicher Aktivitätswert je Mandat",
  "home.partiesCta": "Fraktionsvergleich ansehen",

  // --- keyword search -----------------------------------------------------
  //
  // The search answers with **people**, not documents (convex/search.ts), and
  // the strings say so from the first line: `search.title` is the label of the
  // nav entry as well as the page's own heading (components/site-header.tsx),
  // so it has to name the feature rather than describe the box.
  //
  // Two of these carry the limits of the index, and they are stated *above* the
  // results rather than under them. lib/search.ts measured them: the final query
  // term is prefix-matched, and nothing else is — no typo tolerance at all. A
  // reader who does not know that reads an empty result as a fact about the
  // Bundestag rather than as a spelling they got wrong, which is the one way
  // this feature can mislead about the source data.

  "search.title": "Suche",
  "search.subtitle":
    "Stichwortsuche über Anträge, Reden, Anfragen und Ausschüsse — die Antwort sind Abgeordnete, jeweils mit den Vorgängen, die den Treffer ausgelöst haben.",

  // The box. Two placeholders because the header's is a third of the width of
  // the page's and has to say the same thing in a quarter of the words.
  "search.placeholder": "Nach Thema, Beruf oder Ausschuss suchen …",
  "search.navPlaceholder": "Suchen …",
  "search.submit": "Suchen",
  "search.clear": "Eingabe löschen",

  // The two limits of the index — see the note above. Both name what *does*
  // work alongside what does not, so neither reads as an apology.
  "search.noFuzzyNotice":
    "Die Suche findet Wortanfänge: „Klima“ trifft „Klimaschutzgesetz“. Tippfehler werden nicht korrigiert — „Klimq“ findet nichts.",
  "search.bilingualNotice":
    "Deutsch und Englisch: „lawyer“ findet „Rechtsanwalt“. Umlaute sind gleichwertig — „fur“, „für“ und „fuer“ finden dasselbe.",

  "search.filterFraktion": "Fraktion",
  "search.allFraktionen": "Alle Fraktionen",
  "search.filterCommittee": "Ausschuss",
  "search.allCommittees": "Alle Ausschüsse",
  "search.filterType": "Art des Vorgangs",
  "search.allTypes": "Alle Arten",
  "search.filterPeriod": "Wahlperiode",
  // Both the option and the "all" label of the period control, so the two
  // cannot drift apart — see components/search-page.tsx.
  "search.period": "{wahlperiode}. Wahlperiode",
  // §6.4: committee membership is published for the current period only, so a
  // filtered search is scoped to what that table can answer.
  "search.committeeScopeNotice":
    "Ausschussmitgliedschaften sind nur für die laufende Wahlperiode veröffentlicht. Mit gesetztem Ausschussfilter werden deshalb nur Mandate dieser Periode gefunden.",

  // Before the first keystroke. Not "keine Treffer": nothing was searched.
  "search.prompt": "Geben Sie ein Stichwort ein, um Abgeordnete zu finden.",
  "search.empty": "Keine Abgeordneten zu dieser Suche gefunden.",
  "search.emptyHint":
    "Versuchen Sie einen kürzeren Wortanfang — „miet“ statt „Mietpreisbremse“ — oder eine andere Schreibweise. Tippfehler werden nicht korrigiert.",

  // Singular and plural by key, following lib/relative-time.ts: each language
  // splits where it actually splits, and neither ends up printing "1 Treffer
  // gefunden" with a plural verb.
  "search.resultCountOne": "1 Abgeordnete:r gefunden",
  "search.resultCount": "{count} Abgeordnete gefunden",
  "search.matchCountOne": "1 Treffer",
  "search.matchCount": "{count} Treffer",
  // Named rather than silent: a card matching „Rechtsanwalt“ for a query of
  // „lawyer“ is otherwise inexplicable on the page.
  "search.alsoSearched": "Ebenfalls gesucht: {terms}",
  "search.breakdown": "Fraktionen",
  "search.matchedBecause": "Gefunden wegen",
  "search.moreMatches": "und {count} weitere Treffer",
  // A capped count that reads as exact understates how much work an MP has
  // done — so the cap is named. See `PER_TERM_LIMIT` in convex/search.ts.
  "search.truncatedNotice":
    "Sehr viele Treffer: Die Zahlen sind Untergrenzen, nicht Gesamtzahlen. Grenzen Sie die Suche ein, um vollständig zu zählen.",

  // --- /about — was gemessen wird und was nicht ---------------------------
  //
  // Die Vorbehalte dieses Codes stehen bewusst *neben* der Zahl, die sie
  // qualifizieren (components/caveat-note.tsx). Das bleibt so. Diese Seite ist
  // die andere Hälfte davon: ein Ort, an dem sie zusammenhängend gelesen werden
  // können, weil ein Vorbehalt neben einem Balken beantwortet, was diese Zahl
  // nicht sagt — und nicht, was das Projekt insgesamt behauptet.
  //
  // Kein Schlüssel hier ersetzt einen bestehenden. Die Seite verweist auf die
  // vorhandenen Strings (`score.caveat.*`, `parties.disciplineCaveat`,
  // `home.bottomMPsCaveat`, `votes.namedOnlyNotice`, `seating.syntheticNotice`)
  // und ergänzt nur, was nirgends sonst gesagt wird — sonst gäbe es zwei
  // Formulierungen desselben Vorbehalts, die auseinanderlaufen.

  "about.title": "Methodik",
  "about.subtitle": "Was Bundestracker misst, was es nicht misst und woher jede Zahl stammt.",
  // Der Einstieg, und die These der Seite in zwei Sätzen: die Zahlen sind
  // belegt, und sie sind nicht die Arbeit. Beides gilt gleichzeitig.
  "about.lead":
    "Bundestracker zählt, was der Bundestag selbst veröffentlicht: Anträge, Reden, Anfragen, namentliche Abstimmungen, Ausschusssitze. Jede Zahl auf dieser Seite lässt sich auf ein Dokument zurückführen. Was sich nicht zählen lässt, wird auch nicht geschätzt — es fehlt, und diese Seite sagt, was fehlt.",

  // Sprungmarken. Die Seite ist lang; ohne Inhaltsverzeichnis liest niemand
  // den Abschnitt, den er eigentlich sucht.
  "about.contents": "Auf dieser Seite",

  // --- 1. Was gezählt wird ---
  "about.tracks.title": "Was gezählt wird",
  "about.tracks.body":
    "Der Aktivitätswert ist eine gewichtete Summe aus sieben Komponenten. Die Gewichtung ist eine Setzung, keine Wertung: Die sieben Größen werden in verschiedenen Einheiten gemessen — Wörter, Dokumente, Sitze, eine Quote — und die Gewichte sind die Umrechnungsfaktoren, die sie auf eine Skala bringen. Sie sind einstellbar; angemeldete Leser:innen speichern eigene.",
  "about.tracks.column.component": "Komponente",
  "about.tracks.column.measures": "Gemessen wird",
  "about.tracks.column.weight": "Standardgewicht",
  "about.tracks.measures.motions":
    "Anträge und Entschließungsanträge, aus den DIP-Aktivitäten der Abgeordneten.",
  "about.tracks.measures.speeches":
    "Im Plenum gesprochene Wörter, aus dem Protokoll-XML — nicht die Anzahl der Wortmeldungen.",
  "about.tracks.measures.questions": "Kleine und Große Anfragen an die Bundesregierung.",
  "about.tracks.measures.reports":
    "Berichte, aus denselben DIP-Aktivitäten. Die dünnste der sieben Komponenten.",
  "about.tracks.measures.voteParticipation":
    "Anteil der namentlichen Abstimmungen, an denen abgestimmt wurde. Enthaltung zählt als Teilnahme.",
  "about.tracks.measures.committees": "Ausschussmitgliedschaften der laufenden Wahlperiode.",
  "about.tracks.measures.billSponsorships": "Mitgezeichnete Gesetzentwürfe.",
  // Der Grund, warum die Gewichte überhaupt sichtbar sind.
  "about.tracks.weightsNote":
    "Die Gewichte sind der einzige nicht aus den Daten abgeleitete Teil der Berechnung. Sie stehen deshalb hier, auf jedem Profil neben ihrer Komponente, und lassen sich verändern. Ein Gesamtwert ohne seine Bestandteile wäre ein Urteil; mit ihnen ist er eine Rechnung.",
  "about.tracks.viewRankings": "Zur Rangliste",

  // --- 2. Was der Wert nicht erfasst ---
  //
  // Der wichtigste Abschnitt der Seite. Der Einwand stammt von amtierenden
  // Abgeordneten und ist zutreffend: Ausschussberatungen sind nicht öffentlich
  // protokolliert, also existieren sie in keiner offenen Datenquelle. Ein
  // Tracker, der das nicht sagt, misst Sichtbarkeit und nennt sie Arbeit.
  "about.limits.title": "Was der Wert nicht erfasst",
  "about.limits.lead":
    "Ein niedriger Wert heißt „wenig erfasst“, nicht „wenig gearbeitet“. Vier große Bereiche parlamentarischer Arbeit hinterlassen in den offenen Daten keine oder kaum Spuren — sie fehlen nicht versehentlich, sondern weil über sie nichts maschinenlesbar veröffentlicht wird.",
  "about.limits.committees.title": "Ausschussberatungen",
  "about.limits.committees.body":
    "Die inhaltliche Arbeit an einem Gesetz findet in den Ausschüssen statt, und deren Sitzungen sind in der Regel nicht öffentlich. Veröffentlicht wird, wer in einem Ausschuss sitzt — nicht, was dort gesagt, verhandelt oder durchgesetzt wurde. Bundestracker zählt deshalb Sitze und kann über die Beratung selbst nichts sagen.",
  "about.limits.constituency.title": "Wahlkreisarbeit",
  "about.limits.constituency.body":
    "Bürgersprechstunden, Termine im Wahlkreis, Briefe, Vermittlung gegenüber Behörden: Nichts davon wird zentral erfasst. Ein Mandat, das den Schwerpunkt hier setzt, erscheint in diesen Daten als still.",
  "about.limits.office.title": "Regierungs- und Parlamentsämter",
  "about.limits.office.body":
    "Ein Ministeramt oder ein Sitz im Präsidium verändert, was jemand tut, nicht wie viel: Regierungsmitglieder antworten auf Anfragen, statt sie zu stellen, und eine Sitzungsleitung ist keine Rede. Der Wert misst das als weniger, obwohl es nur anderes ist.",
  "about.limits.party.title": "Fraktions- und Parteiarbeit",
  "about.limits.party.body":
    "Arbeitsgruppen, Fraktionssitzungen, Verhandlungen zwischen den Fraktionen und die Abstimmung von Positionen finden vor dem statt, was am Ende als Dokument erscheint — und sind an keinem Dokument ablesbar.",
  // Die Konsequenz, ausgesprochen. Ohne diesen Satz liest sich die Liste als
  // Bescheidenheitsformel; mit ihm ist sie eine Einschränkung der Gültigkeit.
  "about.limits.conclusion":
    "Der Aktivitätswert misst deshalb die *dokumentierte* parlamentarische Tätigkeit eines Mandats. Er ist kein Maß für Fleiß, Einfluss oder Qualität, und die Rangfolge zweier Abgeordneter mit ähnlichen Werten sagt nichts über den Unterschied zwischen ihnen.",

  // --- 3. Datenquellen ---
  "about.sources.title": "Datenquellen",
  "about.sources.body":
    "Drei Quellen, alle öffentlich zugänglich. Die ersten beiden stammen vom Bundestag selbst, die dritte ist eine gemeinnützige Datenbank und steht unter CC0.",
  "about.sources.column.source": "Quelle",
  "about.sources.column.provides": "Liefert",
  "about.sources.dip.name": "DIP — Dokumentations- und Informationssystem",
  "about.sources.dip.provides":
    "Anträge, Gesetzentwürfe, Anfragen, Berichte und die Zuordnung jedes Vorgangs zu den beteiligten Abgeordneten.",
  "about.sources.protocols.name": "Plenarprotokolle (XML)",
  "about.sources.protocols.provides":
    "Jede Rede im Wortlaut, mit Redner:in und Wortzahl. Grundlage der Reden-Komponente.",
  "about.sources.votes.name": "Namentliche Abstimmungen (XLSX)",
  "about.sources.votes.provides":
    "Das Stimmverhalten jedes einzelnen Mandats, einschließlich der nicht abgegebenen Stimmen.",
  "about.sources.stammdaten.name": "MdB-Stammdaten",
  "about.sources.stammdaten.provides":
    "Das amtliche Abgeordnetenverzeichnis seit 1949: Mandate, Fraktionen, Wahlkreise — und die Ausschussmitgliedschaften der laufenden Wahlperiode.",
  "about.sources.aw.name": "abgeordnetenwatch.de",
  "about.sources.aw.provides":
    "Ergänzende Angaben zu Person und Tätigkeit sowie eine zweite Fassung der Abstimmungsdaten zum Abgleich. CC0.",
  "about.sources.openDataLink": "Open-Data-Portal des Bundestages",
  "about.sources.dipLink": "DIP-Schnittstelle",
  "about.sources.awLink": "abgeordnetenwatch-API",
  // Die Lizenz- und Zurechnungsfrage, kurz. §10 der Recherche verlangt beides:
  // Quelle nennen, keine Billigung suggerieren.
  "about.sources.attribution":
    "Quelle aller amtlichen Angaben ist der Deutsche Bundestag. Bundestracker ist kein Angebot des Bundestages und wird von ihm weder betrieben noch geprüft.",

  // --- 4. Historische Abdeckung ---
  //
  // docs/historical-coverage.md, auf das Wesentliche gekürzt: eine Null kann
  // „gemessen“ oder „nie veröffentlicht“ heißen, und die beiden sehen in einer
  // Datenbank gleich aus.
  "about.coverage.title": "Zeitliche Abdeckung",
  "about.coverage.body":
    "Die Quellen reichen unterschiedlich weit zurück. Das ist keine Lücke im Abruf, sondern eine Grenze der Veröffentlichung — und sie entscheidet darüber, ob eine Null „gemessen“ oder „nie veröffentlicht“ bedeutet.",
  "about.coverage.column.data": "Daten",
  "about.coverage.column.since": "Verfügbar ab",
  "about.coverage.column.why": "Grund",
  "about.coverage.records.name": "Anträge, Anfragen, Gesetzentwürfe, Berichte",
  "about.coverage.records.since": "WP14 (1998)",
  "about.coverage.records.why": "Das DIP erfasst alle hier dargestellten Wahlperioden vollständig.",
  "about.coverage.speeches.name": "Reden und Wortzahlen",
  "about.coverage.speeches.since": "WP18 (2013)",
  "about.coverage.speeches.why":
    "Frühere Sitzungen erscheinen nur als PDF; ohne Protokoll-XML gibt es keine maschinenlesbare Rede.",
  "about.coverage.votes.name": "Namentliche Abstimmungen je Mandat",
  "about.coverage.votes.since": "September 2019",
  "about.coverage.votes.why":
    "Vor diesem Datum veröffentlicht der Bundestag die Abstimmungslisten nur als PDF, ohne auswertbare Tabelle.",
  "about.coverage.committees.name": "Ausschussmitgliedschaften",
  "about.coverage.committees.since": "nur laufende Wahlperiode",
  "about.coverage.committees.why":
    "Die Stammdaten sind die einzige maschinenlesbare Quelle und führen Ausschüsse ausschließlich für die aktuelle Periode.",
  "about.coverage.roster.name": "Abgeordnetenverzeichnis",
  "about.coverage.roster.since": "1949",
  "about.coverage.roster.why":
    "Der Stammdaten-Datensatz enthält jedes Mandat seit dem 1. Bundestag.",
  // Die Folge, die niemand aus der Tabelle allein zieht.
  "about.coverage.conclusion":
    "Werte verschiedener Wahlperioden sind deshalb nicht vergleichbar: Ein Mandat der 16. Wahlperiode hat null Reden und null Abstimmungen, weil dazu nichts veröffentlicht ist — nicht, weil es geschwiegen und gefehlt hätte.",

  // --- 5. Abweichung von der Fraktionslinie ---
  "about.dissent.title": "Abweichung von der Fraktionslinie",
  "about.dissent.body":
    "In den namentlichen Abstimmungen ist erkennbar, wer anders gestimmt hat als die Mehrheit der eigenen Fraktion. Das ist eine der wenigen Stellen, an denen die Daten etwas über das Verhalten einer Person sagen — und deshalb die Stelle, an der die Grenzen des Aussagbaren am engsten gezogen sind.",
  "about.dissent.measuresLabel": "Erfasst wird",
  "about.dissent.measures":
    "Eine abgegebene Stimme, die von der Mehrheitsposition der eigenen Fraktion in derselben Abstimmung abweicht.",
  "about.dissent.notLabel": "Nicht erfasst wird",
  "about.dissent.not.whip":
    "Fraktionszwang oder -disziplin: Ob es zu einer Abstimmung überhaupt eine Vorgabe gab, wird nirgends veröffentlicht. Eine Abweichung ist eine abweichende Stimme, kein Ungehorsam.",
  "about.dissent.not.absence":
    "Abwesenheit: Eine nicht abgegebene Stimme widerspricht nichts und zählt nicht als Abweichung.",
  "about.dissent.not.tie":
    "Eine exakt gespaltene Fraktion: Ohne Mehrheit gibt es keine Linie, von der abgewichen werden könnte — solche Abstimmungen bleiben außer Betracht.",
  "about.dissent.not.unaffiliated":
    "Fraktionslose Abgeordnete: Ohne Fraktion fehlt der Vergleichsmaßstab.",
  "about.dissent.viewVotes": "Zu den Abstimmungen",

  // --- 6. Grundsätze ---
  "about.principles.title": "Grundsätze",
  "about.principles.record.title": "Jede Zahl hat einen Beleg",
  "about.principles.record.body":
    "Zu jedem Eintrag führt ein Link auf die Drucksache, das Protokoll oder die Abstimmungsliste, aus der er stammt. Nichts auf dieser Seite ist geschätzt, interpoliert oder fortgeschrieben.",
  "about.principles.approximate.title": "Ungenaue Zahlen sind als solche gekennzeichnet",
  "about.principles.approximate.body":
    "Zwei der Kennzahlen auf der Startseite lassen sich nicht exakt zählen, ohne das Leselimit einer Abfrage zu sprengen. Sie tragen deshalb ein „+“: „5.000+“ heißt „mindestens 5.000“. Eine Untergrenze, die als Gesamtzahl gelesen wird, wäre die unehrlichere Darstellung.",
  "about.principles.noRank.title": "Das untere Ende der Rangliste trägt keine Platzziffern",
  "about.principles.noRank.body":
    "Die Startseite zeigt beide Enden der Rangliste — ein Tracker, der nur die Spitze veröffentlicht, veröffentlicht eine Auswahl. Das untere Ende erscheint aber ohne Rangnummern: „Platz 1“ läse sich dort als „inaktivstes Mandat des Bundestages“, und diese Behauptung stützt eine Auswahl von fünf Zeilen nicht.",
  "about.principles.gaps.title": "Lücken werden ausgewiesen, nicht gefüllt",
  "about.principles.gaps.body":
    "Ein noch nicht berechnetes Mandat erscheint als „nicht bewertet“ und nicht als Null. Eine unbekannte Aktivitätsart wird gezählt und angezeigt, statt still mit null gewichtet zu werden. Eine synthetische Darstellung — etwa die Sitzverteilung — sagt auf der Seite selbst, welcher Teil erfunden ist.",
  "about.principles.open.title": "Der Quellcode ist offen",
  "about.principles.open.body":
    "Berechnung, Datenpipeline und Oberfläche sind öffentlich einsehbar. Wer eine Zahl anzweifelt, kann nachlesen, wie sie entsteht.",

  // --- 7. Datenschutz ---
  "about.privacy.title": "Datenschutz",
  "about.privacy.noTracking.title": "Keine Statistik, keine Werbung, keine Weitergabe",
  "about.privacy.noTracking.body":
    "Bundestracker bindet keine Analyse-, Werbe- oder Trackingdienste ein. Es gibt keine Zählpixel und keine Profilbildung, und es werden keine Daten an Dritte übermittelt.",
  "about.privacy.cookies.title": "Nur ein Cookie, und nur nach Anmeldung",
  "about.privacy.cookies.body":
    "Ohne Konto setzt die Seite kein Cookie. Sprache und Design werden lokal im Browser gespeichert (localStorage) und verlassen das Gerät nicht. Wer sich anmeldet, erhält ein Sitzungscookie — mehr nicht.",
  "about.privacy.account.title": "Ein Konto ist freiwillig",
  "about.privacy.account.body":
    "Alle Daten sind ohne Anmeldung vollständig einsehbar. Ein Konto speichert zwei Dinge: eigene Gewichtungen des Aktivitätswerts und die Liste der gefolgten Abgeordneten.",
  "about.privacy.mpData.title": "Zu den Abgeordneten selbst",
  "about.privacy.mpData.body":
    "Über Abgeordnete werden ausschließlich Angaben angezeigt, die der Bundestag oder abgeordnetenwatch selbst veröffentlichen und die ihr Mandat betreffen. Private Kontaktdaten sind nicht enthalten — der Bundestag veröffentlicht keine.",

  // --- Schluss ---
  "about.questions.title": "Etwas fehlt oder ist falsch?",
  "about.questions.body":
    "Fehler in den Daten und Einwände gegen die Methodik gehören ins öffentliche Repository. Beides ist willkommen: Eine Kennzahl, die niemand prüfen kann, ist keine.",
  "about.questions.cta": "Zum Quellcode",

  "homeC.claimIntro":
    "Jede Zahl auf dieser Seite steht für ein Dokument des Deutschen Bundestages. Was nicht dokumentiert ist, steht hier nicht.",
  // Chapter 2 — the four summary figures. Names the honest limit of two of them
  // in the sentence itself: `getChamberStats` reports a floor where it cannot
  // count exactly, and the `+` on the card is meaningless unless the reader has
  // been told what it means.
  "homeC.claimStats":
    "Vier Zahlen für eine Wahlperiode. Zwei davon sind Untergrenzen — wo ein „+“ steht, hat die Zählung ihre Grenze erreicht, nicht der Bundestag.",
  // Chapter 3 — both leaderboards. The claim is about the *measure*, because
  // that is what the two boards together put on trial.
  "homeC.claimActivity":
    "Der Aktivitätswert misst erfasste Tätigkeit: Anträge, Reden, Abstimmungen, Anfragen, Ausschusssitze. Er misst nicht Einfluss, nicht Qualität und nicht Anwesenheit.",
  // Chapter 4 — parties and votes. Two sections under one claim because they
  // make the same move: both aggregate individuals into a group, and both are
  // read as statements about the group.
  "homeC.claimParties":
    "Fraktionen erscheinen hier als Mittelwerte je Mandat, Abstimmungen als namentliche Einzelnachweise. Beides sind Ausschnitte, keine Bilanzen.",
  // Chapter 5 — the feed. The only chapter without a caveat, because it makes
  // no measurement: it reports what was published, and says so.
  "homeC.claimFeed":
    "Zuletzt geschehen — in der Reihenfolge, in der die offenen Daten es veröffentlicht haben.",

  // The skip link, and §7's first defence: a returning reader who wants today's
  // votes should not have to scroll through a story they have read. Named for
  // where it goes rather than for what it skips.
  "homeC.skipToData": "Direkt zu den Daten",
  // The pledge under the hero. Short enough to be read, specific enough to be
  // checked — it names the two things the site will not do rather than
  // promising that it is trustworthy.
  "homeC.heroPledge":
    "Keine Bewertung, keine Gewichtung nach Meinung. Nur was im Amtsblatt, im Protokoll und in der Abstimmungsliste steht.",

  // --- Untersuchungsausschuss: das Quorum ---------------------------------
  //
  // Die eine Seite dieser Website, auf der eine gezählte Zahl und eine
  // gepflegte politische Aussage nebeneinander stehen. Die Trennung ist keine
  // Formalie: Sitzzahlen sind amtlich belegt (§9 — die Verteilung ist
  // ableitbar), die Ausschlusserklärungen sind es nicht. Jeder String unten
  // gehört sichtbar zu genau einer der beiden Hälften, und die Strings der
  // gepflegten Hälfte sagen das selbst — nicht erst die Fußnote.

  "nav.inquiry": "Untersuchungsausschuss",

  "inquiry.title": "Untersuchungsausschuss — das Viertel",
  "inquiry.subtitle":
    "Ein Viertel der Mitglieder des Bundestages kann einen Untersuchungsausschuss erzwingen. Welche Fraktionen zusammen dieses Viertel erreichen — und welche Kombinationen öffentlich ausgeschlossen wurden.",

  // Die Kernaussage, ganz oben und in voller Deutlichkeit. Zwei Sätze: der
  // erste ist Arithmetik, der zweite nennt die gepflegte Hälfte beim Namen.
  "inquiry.lead":
    "Ein Untersuchungsausschuss ist ein Minderheitenrecht — er richtet sich gegen die Regierung. Die Regierungsfraktionen erreichen das Viertel mühelos; auf sie kommt es nicht an. Entscheidend ist, ob die Opposition es erreicht. Sie erreicht es nur zusammen mit der AfD, deren Zusammenarbeit alle anderen ausgeschlossen haben.",

  // --- der Maßstab ---
  "inquiry.threshold.title": "Die Schwelle",
  "inquiry.threshold.seats": "Sitze im Bundestag",
  "inquiry.threshold.needed": "Unterschriften nötig",
  "inquiry.threshold.rule": "Ein Viertel der Mitglieder",
  "inquiry.threshold.explainer":
    "{threshold} von {total} Mandaten. Art. 44 Abs. 1 GG spricht von „einem Viertel seiner Mitglieder“ — bei einer ungeraden Viertelzahl wird aufgerundet, denn {below} Abgeordnete sind weniger als ein Viertel.",

  // --- die Fraktionen ---
  "inquiry.groups.title": "Die Fraktionen und ihre Sitze",
  "inquiry.groups.subtitle":
    "Gezählt aus dem Abgeordnetenverzeichnis der laufenden Wahlperiode — die einzige Sitzangabe, die amtlich ableitbar ist.",
  "inquiry.groups.column.group": "Fraktion",
  "inquiry.groups.column.seats": "Sitze",
  "inquiry.groups.column.share": "Anteil",
  "inquiry.groups.column.toThreshold": "Bis zum Viertel",
  "inquiry.groups.column.role": "Rolle",
  "inquiry.groups.column.ruledOut": "Ausschluss erklärt gegenüber",
  // Was in der Spalte steht, wenn eine Fraktion die Schwelle allein verfehlt:
  // die Zahl, die ihr fehlt. Eine Fraktion, die sie erreicht, braucht niemanden.
  "inquiry.groups.short": "−{count}",
  "inquiry.groups.reachesAlone": "erreicht allein",
  "inquiry.groups.noneDeclared": "keine",
  // Fraktionslose zählen zur Gesamtzahl — das Viertel bemisst sich an allen
  // Mitgliedern —, aber sie sind kein Block und können nichts gemeinsam
  // unterzeichnen. Das steht in der Tabelle, nicht nur im Quellcode.
  "inquiry.groups.notABloc": "kein Block",
  "inquiry.groups.notABlocNote":
    "Fraktionslose Abgeordnete zählen zur Gesamtzahl der Mitglieder, aus der sich das Viertel berechnet. In den Kombinationen unten erscheinen sie nicht: „die Fraktionslosen“ sind eine Restkategorie einzelner Abgeordneter, kein Block, der gemeinsam einen Antrag stellt.",

  // --- die Kombinationen ---
  "inquiry.combos.title": "Welche Kombinationen das Viertel erreichen",
  "inquiry.combos.subtitle":
    "Alle Zusammenschlüsse aus einer, zwei oder drei Fraktionen. Die Sitzsummen sind gezählt; ob eine Zusammenarbeit ausgeschlossen wurde, ist eine gepflegte Angabe.",
  "inquiry.combos.column.combination": "Kombination",
  "inquiry.combos.column.seats": "Sitze",
  "inquiry.combos.column.share": "Anteil",
  "inquiry.combos.column.status": "Status",
  "inquiry.combos.showAll": "Auch Kombinationen unterhalb der Schwelle zeigen",
  "inquiry.combos.showReaching": "Nur Kombinationen ab der Schwelle zeigen",
  "inquiry.combos.empty": "Keine Kombination in dieser Auswahl.",
  "inquiry.combos.countReaching": "{count} von {total} Kombinationen erreichen das Viertel.",

  // Die drei Zustände einer Zeile. „Möglich“ ist arithmetisch *und*
  // politisch offen; „ausgeschlossen“ ist arithmetisch möglich und politisch
  // erklärt beendet; „zu klein“ ist reine Arithmetik.
  "inquiry.status.viable": "möglich",
  "inquiry.status.blocked": "ausgeschlossen",
  "inquiry.status.short": "zu klein",
  "inquiry.status.shortBy": "{count} Sitze fehlen",
  "inquiry.status.blockedBy": "{a} hat Zusammenarbeit mit {b} ausgeschlossen",
  "inquiry.status.viableLabel": "Erreicht das Viertel, keine Ausschlusserklärung",

  // --- die zwei Betrachtungen ---
  //
  // Der Unterschied, an dem diese Seite hängt. Über die ganze Kammer gerechnet
  // ist das Viertel leicht zu erreichen — die Union allein hält 208 von 630.
  // Das ist wahr und nutzlos: Art. 44 GG ist ein Minderheitenrecht gegen die
  // Regierung, und eine Regierung setzt keinen Untersuchungsausschuss gegen
  // sich selbst ein. Die Frage lautet, ob die *Opposition* das Viertel
  // erreicht.
  "inquiry.scope.chamber": "Ganze Kammer",
  "inquiry.scope.chamberNote":
    "Alle Fraktionen zusammengerechnet. Hier ist das Viertel mehrfach erreichbar — die Regierungsfraktionen allein überschreiten es deutlich. Diese Betrachtung beantwortet nicht die Frage, um die es geht.",
  "inquiry.scope.opposition": "Nur Opposition",
  "inquiry.scope.oppositionNote":
    "Nur die Fraktionen, die nicht der Regierung angehören. Ein Untersuchungsausschuss richtet sich gegen die Regierung, deshalb ist dies die Betrachtung, in der die Zahl etwas bedeutet.",
  "inquiry.scope.oppositionSeats": "Sitze der Opposition",
  // Wenn die Regierungszugehörigkeit für eine Periode nicht hinterlegt ist,
  // wird die Oppositionsbetrachtung nicht geraten, sondern weggelassen.
  "inquiry.scope.unavailable":
    "Für diese Wahlperiode ist nicht hinterlegt, welche Fraktionen die Regierung stellten. Die Oppositionsbetrachtung entfällt deshalb — geraten wird sie nicht.",
  // Der Satz, der die eigentliche Sperre benennt, mit beiden Zahlen.
  "inquiry.scope.lock":
    "Die Opposition hält {oppositionSeats} von {total} Sitzen — deutlich mehr als das Viertel. Ohne die AfD bleiben {withoutAfd} Sitze, {gap} unter der Schwelle. Die AfD allein kommt auf {afd} und verfehlt sie um {afdGap}.",

  // --- das Ergebnis ---
  "inquiry.result.title": "Das Ergebnis",
  "inquiry.result.none":
    "Keine der {reaching} Oppositionskombinationen, die das Viertel erreichen, ist frei von einer erklärten Ausschließung. Der größte Zusammenschluss ohne Ausschluss bleibt {shortfall} Sitze unter der Schwelle.",
  "inquiry.result.some":
    "{count} Oppositionskombination(en) erreichen das Viertel, ohne dass eine der beteiligten Fraktionen die Zusammenarbeit ausgeschlossen hätte.",
  // Der Schluss, den die Seite zieht und den sie belegen kann: Die Sperre ist
  // keine Mehrheitsentscheidung. Sie entsteht daraus, dass ein
  // Minderheitenrecht eine Zusammenarbeit voraussetzt, die es nicht gibt.
  "inquiry.result.conclusion":
    "Das Untersuchungsrecht ist ein Minderheitenrecht: Ein Viertel kann eine Untersuchung erzwingen, ohne die Mehrheit zu fragen. Es setzt aber voraus, dass sich ein Viertel findet, das sie will. Die Regierungsfraktionen erreichen das Viertel — sie werden es gegen sich selbst nicht nutzen. Die Opposition will es und erreicht es nicht ohne die AfD. So läuft ein Recht leer, ohne dass darüber je abgestimmt wurde.",

  // --- die Matrix ---
  "inquiry.matrix.title": "Wer mit wem nicht",
  "inquiry.matrix.subtitle":
    "Erklärte Ausschlüsse zwischen den Fraktionen. Eine gepflegte politische Angabe — kein Bundestagsdatensatz.",
  "inquiry.matrix.legendRuledOut": "Zusammenarbeit ausgeschlossen",
  "inquiry.matrix.legendOpen": "nicht ausgeschlossen",
  "inquiry.matrix.legendSelf": "dieselbe Fraktion",
  "inquiry.matrix.cellRuledOut": "{a} und {b}: Zusammenarbeit ausgeschlossen",
  "inquiry.matrix.cellOpen": "{a} und {b}: kein erklärter Ausschluss",

  // Der wichtigste String der Seite, und der einzige, der die Prämisse der
  // Website einschränkt: Sitzzahlen sind belegt, diese Tabelle ist es nicht.
  // Deshalb steht er über der Matrix, nicht darunter, und in voller Stärke.
  "inquiry.maintainedNotice":
    "Von Bundestracker gepflegt, nicht aus amtlichen Daten: Welche Fraktion eine Zusammenarbeit mit welcher ausgeschlossen hat, steht in keinem Datensatz des Bundestages. Diese Tabelle beruht auf öffentlichen Erklärungen — Parteitagsbeschlüssen und wiederholten Festlegungen — und kann sich ändern. Die Sitzzahlen auf dieser Seite sind amtlich belegt; die Ausschlüsse sind es nicht.",
  "inquiry.maintainedAsOf": "Stand: {date}",
  // Was bewusst *nicht* in der Tabelle steht. Eine gepflegte Angabe ist nur
  // dann etwas wert, wenn sie auch schweigt, wo der Beleg dünn ist.
  "inquiry.maintainedOmissions":
    "Nicht als Ausschluss geführt: das Verhältnis von SPD und Linke. Ein förmlicher Unvereinbarkeitsbeschluss besteht auf Bundesebene nicht mehr, und es gibt Koalitionen in den Ländern — was bleibt, ist Zurückhaltung, keine erklärte Sperre. Das BSW ist nicht aufgeführt, weil es diesem Bundestag nicht angehört und damit keine Sitze einbringen kann.",

  // --- der Erklärtext ---
  "inquiry.explainer.title": "Was ist ein Untersuchungsausschuss?",
  "inquiry.explainer.what":
    "Ein Untersuchungsausschuss ist das schärfste Aufklärungsinstrument des Bundestages. Er untersucht einen konkreten Vorgang — ein Regierungshandeln, eine Affäre, eine Beschaffung — und legt am Ende einen Bericht vor.",
  "inquiry.explainer.quarterTitle": "Warum ein Viertel",
  "inquiry.explainer.quarter":
    "Art. 44 Abs. 1 GG verpflichtet den Bundestag, auf Antrag eines Viertels seiner Mitglieder einen Untersuchungsausschuss einzusetzen. „Verpflichtet“ ist das entscheidende Wort: Die Mehrheit kann die Einsetzung nicht verhindern. Deshalb ist das Viertel die einzige Zahl, auf die es ankommt — und deshalb ist es ein Recht der Opposition, nicht ein Verfahren der Mehrheit.",
  "inquiry.explainer.powersTitle": "Welche Befugnisse er hat",
  "inquiry.explainer.powers":
    "Er kann Zeuginnen und Zeugen laden und unter Wahrheitspflicht vernehmen, die Vorlage von Akten der Bundesregierung verlangen und Sachverständige beauftragen. Die Beweiserhebung folgt sinngemäß der Strafprozessordnung; ein Viertel der Ausschussmitglieder kann Beweiserhebungen auch gegen die Ausschussmehrheit durchsetzen.",
  "inquiry.explainer.limitsTitle": "Wo seine Grenzen liegen",
  "inquiry.explainer.limits":
    "Er spricht kein Urteil und verhängt keine Strafe. Sein Ergebnis ist ein Bericht — die Wirkung liegt in der Öffentlichkeit der Beweisaufnahme und im Zugang zu Unterlagen, die sonst niemand sähe. Die Mehrheit kann die Einsetzung nicht verhindern, den Bericht aber mit eigener Bewertung versehen.",
  "inquiry.explainer.mattersTitle": "Warum das hier steht",
  "inquiry.explainer.matters":
    "Ein Minderheitenrecht wird nicht abgeschafft, indem man dagegen stimmt. Es läuft leer, wenn sich die nötige Minderheit nicht bilden kann. Diese Seite rechnet nur nach, ob sie sich bilden könnte — die Sitzzahlen sind amtlich, die erklärten Ausschlüsse sind gepflegt, und beide stehen getrennt.",

  // Verweise. Der Bogen zeigt dieselben Sitze in derselben Reihenfolge, die
  // Methodenseite erklärt, was auf dieser Website gepflegt und was gezählt ist.
  "inquiry.seeSeating": "Sitzverteilung ansehen",
  "inquiry.seeAbout": "Methodik",
  // Der Einstieg von der Startseite: eine Frage, die die Seite beantwortet.
  "inquiry.home.title": "Kann dieser Bundestag einen Untersuchungsausschuss einsetzen?",
  "inquiry.home.body":
    "Ein Viertel der Mitglieder genügt — {threshold} von {total} Sitzen. Die Regierungsfraktionen erreichen es mühelos, aber sie untersuchen sich nicht selbst. Die Opposition erreicht es nur mit der AfD, deren Zusammenarbeit alle anderen ausgeschlossen haben.",
  "inquiry.home.cta": "Das Viertel nachrechnen",
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
  "nav.dashboard": "Dashboard",
  "nav.members": "Members",
  "nav.activity": "Activity",
  "nav.rankings": "Rankings",
  "nav.seating": "Seating map",
  "nav.feed": "Activity feed",
  "nav.about": "About",
  "nav.language": "Language",
  "nav.theme": "Theme",
  "nav.period": "EP {wahlperiode}",
  "nav.periodLabel": "Electoral period {wahlperiode} — the one shown here",

  "auth.signIn": "Sign in",
  "auth.signOut": "Sign out",
  "auth.signInWithGoogle": "Sign in with Google",
  "auth.signInWithGitHub": "Sign in with GitHub",
  "auth.optionalNotice":
    "Signing in is optional. All data is viewable without an account; an account saves your own score weightings and followed members.",
  "auth.signInTitle": "Sign in to Bundestracker",
  "auth.chooseProvider": "Choose a provider.",
  "auth.benefits":
    "An account saves your own activity-score weightings and lets you follow individual members.",
  "auth.continueWithoutAccount": "Continue without an account",
  "auth.signingIn": "Redirecting …",
  "auth.githubUnavailable": "Signing in with GitHub is not enabled yet.",
  "auth.signInFailed": "Sign-in failed. Please try again.",
  "auth.alreadySignedIn": "You are already signed in.",

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
  "rankings.board.normalised": "Activity per month in office",
  "rankings.board.normalised.desc":
    "Activity score divided by time in office. A member who took their seat part-way through the electoral period is no longer measured against colleagues with twice the exposure.",
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
  "rankings.column.dissentRate": "Dissent rate",
  "rankings.column.committees": "Committees",
  "rankings.column.bills": "Bills",
  "rankings.column.change": "Change",
  "rankings.column.previous": "Previous month",
  "rankings.column.perMonth": "Score per month",
  "rankings.column.tenureDays": "Days in office",

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
  "rankings.caveat.normalised":
    "The divisor is calendar time in office, not sitting weeks — the sitting calendar is published nowhere in machine-readable form. Across a whole electoral period the two are close; for a single month they are not.",
  "rankings.normalisedUnrankable":
    "{count} mandate(s) not ranked: no recorded time in office, or less than 30 days served. Too short a span yields no dependable rate — so they are absent here rather than shown as zero.",
  "rankings.noPreviousMonth":
    "The whole electoral period has no previous month. Pick a month instead.",

  "rankings.crossPartyPeriod": "Counted across every named ballot of the electoral period.",
  "rankings.crossPartyWindow": "Counted across the {count} most recent named ballots.",

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
  "feed.andOthers": "and {count} more",
  "feed.jointCount": "{count} members",
  "feed.showAllActors": "Show all {count}",
  "feed.jointNote":
    "Tabled jointly. The order is the data source's — DIP publishes no distinction between first and co-signatory.",
  "feed.collapseActors": "Show fewer",

  "feed.score.total": "+{points} points",
  "feed.score.perMember": "{count} × {points}",
  "feed.score.label": "Contribution to the activity score",
  "feed.score.unscorable": "No per-entry value",
  "feed.score.reason.rate":
    "Vote participation is a rate across all named ballots, not a value per ballot — a single entry carries no amount of its own.",
  "feed.score.reason.perWord":
    "Speeches are weighted by word count, not per contribution. The word count belongs to the speech record, not to this entry.",
  "feed.score.reason.standing":
    "Committee work counts as a seat held, not as a dated event — there is no value per entry.",
  "feed.score.reason.unrecognised":
    "This activity kind is not yet covered by the weighting. It is counted and surfaced rather than silently weighted as zero.",

  "feed.sort.label": "Sort",
  "feed.sort.chronological": "Newest first",
  "feed.sort.score": "Highest value first",
  "feed.sort.loadedOnly":
    "Sorts and filters the entries loaded so far — not the whole electoral period. “Load more” fetches further ones.",
  "feed.filter.minScore": "Minimum value",
  "feed.filter.minScoreNote": "Entries with no per-entry value are hidden above a minimum.",
  "feed.filter.hidden": "{count} hidden",

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
  "mps.allStates": "All federal states",
  "mps.filterCommittee": "Committee",
  "mps.allCommittees": "All committees",
  "mps.filterElectionMethod": "Mandate type",
  "mps.allElectionMethods": "All mandate types",
  "mps.electionDirect": "Direct mandate",
  "mps.electionList": "List mandate",
  "mps.sortBy": "Sort by",
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
  /** What the member does now, as against `mp.profession` — the trade practised
   * before the mandate. See the German entry. */
  "mp.occupation": "Current occupation",
  "mp.electionMethod": "Elected via",
  "mp.datesInOffice": "Time in office",
  "mp.stillServing": "in office",
  "mp.noBiography": "No biographical details are recorded for this electoral period.",
  "mp.photoCredit": "Photo: {credit}",

  // --- contact ---
  //
  // ⚠ No email or phone key, deliberately — neither is published anywhere. See
  // the German entries.
  "mp.contact": "Contact",
  "mp.contactForm": "Contact form",
  "mp.contactFormHint": "The Bundestag publishes no email addresses.",
  "mp.constituencyOffice": "Constituency office",
  "mp.homepage": "Website",
  "mp.socials": "Social media",
  "mp.berlinOffice": "Bundestag office",
  "mp.berlinAddress": "Platz der Republik 1\n11011 Berlin",
  "mp.noContact": "No contact details are recorded for this member.",
  /** The empty state, spelled out. See the German entries: the point is that a
   * reader can tell an absent source from a failed fetch. */
  "mp.noContactExplain":
    "The Bundestag publishes neither email addresses nor telephone numbers for members — not even where contact details are available. For this member it also lists no contact form, no website and no constituency office.",
  "mp.postalSubstitute": "Reachable in writing at the Bundestag's address:",
  "mp.officialDirectory": "The Bundestag's own directory of members",
  "mp.jumpToContact": "Contact",
  "mp.committeeRole": "Role",
  "mp.committeePeriod": "Period",
  "mp.noCommittees": "No committee memberships recorded.",
  "mp.latestSpeeches": "Latest speeches",
  "mp.latestMotions": "Latest motions",
  "mp.latestQuestions": "Latest written questions",
  "mp.latestVotes": "Latest recorded votes",
  "mp.noQuestions": "No written questions recorded for this electoral period.",
  // The German terms are kept: these are the names printed on the Drucksache,
  // and "major/minor interpellation" is a translation no reader would search
  // for. The gloss carries the distinction that matters — one is debated in the
  // chamber, the other answered in writing.
  "mp.questionMajor": "Große Anfrage (debated)",
  "mp.questionMinor": "Kleine Anfrage (written reply)",
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

  // --- dissent over a whole electoral period ---
  "mp.dissent": "Dissent from the group line",
  "mp.dissentBadge": "Frequent dissenter",
  "mp.dissentBadgeTooltip":
    "Votes against their own group in at least {rate} of votes cast, over at least {ballots} votes cast.",
  "mp.dissentNotComputed": "No dissent figure has been computed for this electoral period yet.",
  "mp.dissentNoBallots": "No vote was cast in any named ballot in this electoral period.",
  "mp.dissentNone": "No dissent across {cast} votes cast.",
  "mp.dissentCount": "{count} dissents across {cast} votes cast.",
  "mp.dissentRate": "Dissent rate {rate}",
  "mp.dissentOfBallots": "{ballots} named ballots in the electoral period",
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

  // --- published ballot outcomes ---
  //
  // Translated only where the German tenor is an exact, known one — see the
  // note on the German block, and lib/vote-outcomes.ts. "Vorlage" is rendered
  // "motion" rather than "bill": it covers Anträge and Entschließungsanträge as
  // well as Gesetzentwürfe, and "bill" would claim a legislative status most of
  // them do not have. "Annahme in Ausschussfassung" keeps its qualifier for the
  // same reason — the chamber adopted the committee's text, not the original.
  "votes.outcome.pending": "Pending",
  "votes.outcome.annahme": "Adopted",
  "votes.outcome.ablehnung": "Rejected",
  "votes.outcome.annahmeDerVorlage": "Motion adopted",
  "votes.outcome.ablehnungDerVorlage": "Motion rejected",
  "votes.outcome.annahmeInAusschussfassung": "Adopted as amended in committee",
  "votes.outcome.ueberweisung": "Referred to committee",
  "votes.outcome.erledigt": "Concluded",
  "votes.outcome.zurueckgezogen": "Withdrawn",

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

  // --- votes on the Bundestag's own resources ---
  /** ⚠ The only curated ballot list on the site. `audited` is the counterweight
   * and is not optional — see the German entries. */
  "votes.ownResources.title": "Votes on the Bundestag's own resources",
  "votes.ownResources.subtitle":
    "Recorded votes in which the Bundestag decided on its own resources: party financing, the political foundations, and the electoral law that governs the mandates themselves.",
  "votes.ownResources.curatedNotice":
    "This collection is editorially assembled. The ballots and every figure come unchanged from the Bundestag's official voting records — but the selection of which ballot belongs here is a judgement made by this site, not a property of the source data.",
  "votes.ownResources.asOf": "Last reviewed: {month}.",
  /** Beside the link on /votes, so it does not read as another filter. */
  "votes.ownResources.linkHint": "— an editorial selection from these ballots.",
  "votes.ownResources.audited":
    "The counterweight that belongs with this: the Fraktionen's funds are audited by the Bundesrechnungshof (Federal Court of Audit) under § 53 of the Members of the Bundestag Act, and parties file annual financial statements examined by the President of the Bundestag. That a parliament decides on its own resources does not mean those funds go unscrutinised.",
  "votes.ownResources.payNotice":
    "You will find no ballot on members' pay (\"Diäten\") here, because none exists: since the 2014 reform, § 11 of the Members of the Bundestag Act indexes the allowance automatically each year to the Federal Statistical Office's nominal wage index — without a decision of the Bundestag, and therefore without a recorded vote.",
  "votes.ownResources.empty": "The ballots in this collection have not been loaded yet.",
  "votes.ownResources.topic.pay": "Members' pay",
  "votes.ownResources.topic.partyFinancing": "Party financing",
  "votes.ownResources.topic.foundations": "Political foundations",
  "votes.ownResources.topic.electoralLaw": "Electoral law",
  /** One rationale per ballot, not per topic — the grounds are the part a
   * reader should be able to disagree with specifically. */
  "votes.ownResources.rationale.parteiengesetz20":
    "Amendment to the Political Parties Act: the Bundestag deciding on state funding for precisely the parties its members belong to.",
  "votes.ownResources.rationale.stiftungsfinanzierung20":
    "The Foundation Financing Act put the funding of the party-aligned political foundations on a statutory basis for the first time — money flowing to bodies close to the parties represented in the chamber.",
  "votes.ownResources.rationale.wahlrecht20":
    "The 2023 electoral reform shrank the Bundestag and abolished the basic-mandate clause: members voted on how many seats there would be, and on the terms under which groups enter parliament at all.",
  "votes.ownResources.rationale.wahlrechtBundeswahlgesetz20":
    "A further amendment to the Federal Elections Act — a decision on the rules by which mandates are allocated, taken by the holders of those mandates.",
  "votes.ownResources.rationale.wahlpruefung20":
    "Election scrutiny: the Bundestag ruling on objections to the validity of the election that produced it.",
  "votes.ownResources.rationale.wahlpruefung21":
    "Rejection of objections to the federal election — the Bundestag ruling on the lawfulness of its own composition.",

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

  // --- lame-duck ballots ---
  // "Lame-duck session" rather than a literal rendering of "geschäftsführend":
  // it is the established English term for exactly this situation, where
  // "caretaker" in English usually describes a government rather than a chamber.
  "votes.lameDuck": "Lame-duck session",
  "votes.lameDuckTooltip":
    "Voted after the federal election but before the new Bundestag's constitutive sitting: the outgoing Bundestag had already been replaced at the ballot box while retaining its full powers.",
  "votes.lameDuckNotice":
    "This ballot was taken between the federal election and the constitutive sitting of the new Bundestag. Under Art. 39(1) of the Basic Law the electoral term ends only when the new Bundestag convenes — so the outgoing chamber was lawfully in office with all of its powers, although the electorate had already replaced it.",
  "votes.lameDuckMaintained":
    "Election and constitutive-sitting dates are maintained by Bundestracker; they appear in no Bundestag dataset. As of: {date}.",
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

  // "Members & groups", not "parties": Fraktion is the parliamentary group, and
  // the site keeps that distinction everywhere else (`parties.title` is "Group
  // comparison"). A menu heading that said "parties" would be the one place the
  // English translation flattened it.
  "nav.groupPeople": "Members & groups",
  "nav.groupDecisions": "Decisions",
  "nav.groupContext": "Context",

  "nav.dashboardHint": "Every figure on one screen.",
  "nav.membersHint": "Every member of the Bundestag, filterable by group and state.",
  "nav.partiesHint": "Parliamentary groups compared — size, activity, cohesion.",
  "nav.seatingHint": "The chamber floor, one dot per mandate.",
  "nav.votesHint": "Recorded ballots and how each group voted.",
  "nav.ownResourcesHint": "When the Bundestag decides on its own funding and electoral law.",
  "nav.inquiryHint": "Who reaches the quarter under Art. 44 GG — and who does not.",
  "nav.searchHint": "Full-text search across members and documents.",

  "nav.primary": "Main navigation",
  "nav.collapseSidebar": "Collapse sidebar",
  "nav.expandSidebar": "Expand sidebar",

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

  "home.seatingPreviewLink": "View the Bundestag seating map",
  "home.seatingPreviewCta": "View seating map",

  "home.topMPsTitle": "Most active members",
  "home.topMPsSubtitle": "By activity score in the current electoral period",
  "home.bottomMPsTitle": "Least recorded activity",
  "home.bottomMPsSubtitle": "Lowest activity score in the current electoral period",
  "home.bottomMPsCaveat":
    "A low figure means “little recorded”, not “little done”: committee deliberation, constituency work and government office leave next to no trace in the open data. These are also totals — a member who took their seat part-way through the electoral period had less time to accumulate one, which the “activity per month in office” board corrects for. Only scored mandates appear here.",
  "home.latestVotesTitle": "Latest named votes",
  "home.feedTitle": "Latest activity",
  "home.showAll": "Show all",

  // --- the home page --------------------------------------------------------
  //
  // The German is the original here rather than the translation; see the note
  // on the German block for what these strings argue and why they were
  // rewritten away from naming the Protokoll.
  //
  // The title no longer keeps a German word untranslated. It used to — the page
  // was named after the Bundestag's own Protokoll, and that word was the thing
  // being named — but the page is now about what this site does with the
  // record rather than about the record itself, and "Transparency through data"
  // is a claim that has to be legible to make.
  "protokoll.title": "Transparency through data",
  "protokoll.lead":
    "The Bundestag publishes its work — across thousands of papers, transcripts and division lists. Bundestracker turns that into something you can follow: every speech, every motion, every named vote, every member, in one place.",
  "protokoll.skipToData": "Straight to the data",
  "protokoll.readTheRecord": "Read the record",
  "protokoll.progressLabel": "Progress through this page",
  "protokoll.chapterLabel": "Chapter {index}: {title}",

  "protokoll.chapter1Number": "Chapter one",
  "protokoll.chapter1Title": "One parliament, 630 seats",
  "protokoll.chapter1Standfirst":
    "The 21st German Bundestag holds 630 seats — each one a mandate, each mandate a person voting on behalf of some 60 million eligible voters. That is what this site is about.",
  "protokoll.chapter1SeatsDrawn": "{drawn} of {total} seats",
  "protokoll.chapter1Note":
    "The size of each parliamentary group is backed by official records; the position of any single seat on the arc is not — the Bundestag publishes no machine-readable seating plan.",
  "protokoll.chapter1MandateNote":
    "The arc counts mandates, not seats occupied at one time: when a member leaves and a replacement arrives, one seat carries two mandates within an electoral period. That is why the groups sum to more than the Bundestag's 630 seats.",

  "protokoll.chapter2Number": "Chapter two",
  "protokoll.chapter2Title": "Why transparency matters",
  "protokoll.chapter2Standfirst":
    "Public is not the same as accessible. Every motion, every speech, every named vote is published — spread across tens of thousands of documents nobody reads in full. Bundestracker counts them up and makes them comparable. Nothing is added.",

  "protokoll.chapter3Number": "Chapter three",
  "protokoll.chapter3Title": "How we measure",
  "protokoll.chapter3Standfirst":
    "Seven quantities, each with a weight, summed into one number. The weighting is a choice — so it is stated here rather than disappearing behind the result.",
  "protokoll.chapter3Collapse":
    "Seven components, one number — and it can be taken apart again at any time.",
  "protokoll.chapter3Example": "Worked example, using the default weightings",
  "protokoll.chapter3Limits":
    "Three limits remain whatever the weighting: voting participation covers named ballots only, committee data exists for the current electoral period only, and speeches are counted by words rather than by turns. A low figure means “little recorded”, never “little done”.",

  "protokoll.chapter4Number": "Chapter four",
  "protokoll.chapter4Title": "Who is active?",
  "protokoll.chapter4Standfirst":
    "Both ends of the same ranking, side by side. A tracker that publishes only the top is publishing a highlight reel — not a measurement anyone can check.",

  "protokoll.chapter5Number": "Chapter five",
  "protokoll.chapter5Title": "Where things stand",
  "protokoll.chapter5Standfirst":
    "The chamber in motion: the most recent named ballots and the latest entries in the record. This page updates itself as the nightly sweep loads new data.",

  "protokoll.outroTitle": "See for yourself",
  "protokoll.outroLead":
    "Look up your constituency member, compare parliamentary groups, read who voted which way. Every figure on this page can be traced back to the document it came from.",

  // --- the opening animation ("630 Sitze") ----------------------------------
  "protokoll.splashLabel": "Opening sequence",
  "protokoll.splashSkip": "Skip",
  "protokoll.splashCounting": "630 seats",

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

  // --- party comparison ---------------------------------------------------
  //
  // "Parliamentary group" rather than "party" in the prose, matching
  // `rankings.filter.fraktion`: CDU and CSU are two parties sitting as one
  // Fraktion, so the two words are not interchangeable in a German context. The
  // page title keeps "parliamentary groups" for the same reason.

  "nav.parties": "Groups",

  "parties.title": "Group comparison",
  "parties.subtitle":
    "The Bundestag's parliamentary groups side by side — each figure the average for one mandate, not the group's total.",

  "parties.meansNotice":
    "Every figure is a mean per scored mandate. Group totals are deliberately not shown: DIP records one entry per member per document, so a jointly tabled question counts once for every signatory — a total would overstate large groups by exactly that factor.",
  "parties.coverage": "{scored} of {mandates} mandates are scored.",
  "parties.coverageGapOne":
    "The nightly computation has not yet reached one mandate. It is missing from every mean on this page — it does not count as zero.",
  "parties.coverageGap":
    "The nightly computation has not yet reached {missing} mandates. They are missing from every mean on this page — they do not count as zero.",
  "parties.empty": "No group figures are available for this electoral period yet.",

  "parties.table.title": "Activity score by group",
  "parties.table.subtitle": "Mean activity score for one mandate, highest first.",
  "parties.column.party": "Group",
  "parties.column.seats": "Mandates",
  "parties.column.scored": "scored",
  "parties.column.meanScore": "Mean score",
  "parties.column.medianScore": "Median",
  "parties.medianNote":
    "The median sits beside the mean because the two diverge exactly where it matters: one very active member lifts a mean and leaves a median untouched.",

  "parties.radar.title": "All metrics compared",
  "parties.radar.subtitle":
    "Six metrics, each axis normalised to the leading group. The area shows relative standing, not absolute quantity.",
  "parties.radarCaveat":
    "Each axis is normalised to the leading group on it (100 %), because the six metrics are measured in six different units — word counts reach five digits, committee seats a single digit. A larger hexagon therefore means “further ahead in comparison”, not “more”. The measured average is in the tooltip.",
  "parties.radarLegend": "Show or hide a group",
  "parties.radarTooltipShare": "{share} of the leading group",

  "parties.metrics.title": "Individual metrics",
  "parties.metrics.subtitle": "Groups ranked by one metric, highest first.",

  "parties.metric.score": "Activity score",
  "parties.metric.score.short": "Score",
  "parties.metric.score.desc":
    "Weighted sum of all measurable records, averaged over scored mandates.",
  "parties.metric.motions": "Motions",
  "parties.metric.motions.short": "Motions",
  "parties.metric.motions.desc":
    "Motions and resolutions per mandate, counted from DIP activity records.",
  "parties.metric.speechWords": "Speech volume (words)",
  "parties.metric.speechWords.short": "Words",
  "parties.metric.speechWords.desc":
    "Words spoken in plenary per mandate. This is the figure scoring uses — and the axis that stands for “speeches” on the radar.",
  "parties.metric.speeches": "Speech contributions",
  "parties.metric.speeches.short": "Speeches",
  "parties.metric.speeches.desc":
    "Turns at the floor per mandate. Not on the radar: question time splits a minister's turn into dozens of replies, so an axis on this would largely map who holds government office.",
  "parties.metric.questions": "Questions",
  "parties.metric.questions.short": "Questions",
  "parties.metric.questions.desc": "Minor and major written questions per mandate.",
  "parties.metric.votes": "Voting participation",
  "parties.metric.votes.short": "Participation",
  "parties.metric.votes.desc":
    "Share of named ballots in which a vote was cast. An abstention counts as participation.",
  "parties.metric.committees": "Committee seats",
  "parties.metric.committees.short": "Committees",
  "parties.metric.committees.desc": "Committee memberships per mandate.",
  "parties.metric.bills": "Bills",
  "parties.metric.bills.short": "Bills",
  "parties.metric.bills.desc": "Bills co-signed per mandate.",
  "parties.metric.reports": "Reports",
  "parties.metric.reports.short": "Reports",
  "parties.metric.reports.desc": "Reports per mandate — the thinnest of the nine metrics.",

  "parties.caveat.score":
    "The activity score is a weighted sum; the weighting is a choice, not a verdict. A group average inherits that choice.",
  "parties.smallGroupCaveat":
    "A mean over a small group is volatile: with three mandates, one very active member shifts the average by a third. The mandate count therefore sits beside every figure.",

  // --- mandate composition ---
  /** Counts, not means — see the German entries and `countNotice`, which is the
   * exception to the notice at the top of the page. */
  "parties.mandates.title": "Mandate by type",
  "parties.mandates.subtitle":
    "How each group's members entered the Bundestag: by winning a constituency outright, or from a state list.",
  /** "Mandates", not "seats": the roster counts mandates held during the
   * electoral period, which replacements make more numerous than the 630
   * concurrent seats. See `chamberMandateSplit`. */
  "parties.mandates.headline": "{direct} of {total} mandates were won in a constituency",
  "parties.mandates.headlineShare": "({share} of mandates with a recorded type)",
  "parties.mandates.rowCounts": "{direct} constituency · {list} list",
  "parties.mandates.countNotice":
    "Unlike the other figures on this page these are complete counts rather than means: the mandate type is recorded against every mandate in the roster and does not depend on whether activity has been scored yet. Mandates with no recorded type are left uncounted and appear as neither constituency nor list.",

  // --- coalition vs opposition ---
  "parties.coalition.title": "Government and opposition",
  "parties.coalition.subtitle":
    "The same metrics collapsed into two blocs — weighted by scored mandates, not by group.",
  "parties.coalition.parties": "Groups",
  "parties.coalition.seats": "{count} mandates",
  "parties.coalition.caveat":
    "Government and opposition use different parliamentary instruments: questions are an opposition tool, while bills come predominantly from the governing groups. A difference between the blocs therefore mostly describes that division of roles.",
  "parties.coalition.unavailable":
    "No governing coalition is recorded for this electoral period, so no comparison is possible.",
  "parties.coalition.difference": "Difference",

  // --- party discipline ---
  "parties.discipline.title": "Group discipline",
  "parties.discipline.subtitle":
    "Share of votes cast with the majority of the member's own parliamentary group.",
  "parties.discipline.column.rate": "Voted with the group",
  "parties.discipline.column.withLine": "with the line",
  "parties.discipline.column.against": "against",
  "parties.discipline.column.ballots": "Ballots",
  "parties.discipline.window": "Computed over the {count} most recent named ballots.",
  "parties.discipline.empty":
    "No named ballots are recorded for this electoral period from which a group line could be derived.",
  "parties.disciplineCaveat":
    "Almost every named ballot is unanimous within each group, so what is informative is the gap between 97 % and 99 %, not the level itself. Votes not cast are disregarded — an absence is not a dissent. Ballots on which a group split exactly have no line and do not count.",

  // --- one party's members ---
  "parties.members.title": "Members of the {party} group",
  "parties.members.subtitle": "By activity score in the current electoral period.",
  "parties.members.count": "{scored} of {total} mandates scored",
  "parties.members.empty": "No mandates are recorded for this group in this electoral period.",
  "parties.members.unscored": "not scored yet",
  "parties.backToParties": "Back to the group comparison",
  "parties.notFound": "This parliamentary group does not exist.",
  "parties.viewMembers": "View members",

  // --- homepage card ---
  "home.partiesTitle": "Groups compared",
  "home.partiesSubtitle": "Mean activity score per mandate",
  "home.partiesCta": "View the group comparison",

  // --- keyword search -----------------------------------------------------

  "search.title": "Search",
  "search.subtitle":
    "Keyword search across motions, speeches, questions and committees — the answer is members, each with the records that matched.",

  "search.placeholder": "Search by topic, profession or committee …",
  "search.navPlaceholder": "Search …",
  "search.submit": "Search",
  "search.clear": "Clear the query",

  // The examples are deliberately the German ones: the corpus is German, so
  // "Klima" finding "Klimaschutzgesetz" is what an English reader actually
  // needs to understand about a box they will type English into.
  "search.noFuzzyNotice":
    "The search matches word beginnings: “Klima” finds “Klimaschutzgesetz”. Typos are not corrected — “Klimq” finds nothing.",
  "search.bilingualNotice":
    "German and English: “lawyer” finds “Rechtsanwalt”. Umlauts are equivalent — “fur”, “für” and “fuer” all find the same records.",

  "search.filterFraktion": "Parliamentary group",
  "search.allFraktionen": "All groups",
  "search.filterCommittee": "Committee",
  "search.allCommittees": "All committees",
  "search.filterType": "Type of record",
  "search.allTypes": "All types",
  "search.filterPeriod": "Electoral period",
  "search.period": "Electoral period {wahlperiode}",
  "search.committeeScopeNotice":
    "Committee memberships are published for the current electoral period only. With a committee filter set, the search therefore reaches mandates of that period alone.",

  "search.prompt": "Enter a keyword to find members.",
  "search.empty": "No members found for this search.",
  "search.emptyHint":
    "Try a shorter word beginning — “miet” rather than “Mietpreisbremse” — or a different spelling. Typos are not corrected.",

  "search.resultCountOne": "1 member found",
  "search.resultCount": "{count} members found",
  "search.matchCountOne": "1 match",
  "search.matchCount": "{count} matches",
  "search.alsoSearched": "Also searched: {terms}",
  "search.breakdown": "Groups",
  "search.matchedBecause": "Matched because of",
  "search.moreMatches": "and {count} more matches",
  "search.truncatedNotice":
    "Very many matches: the counts are floors, not totals. Narrow the search to count in full.",

  // --- /about — what is measured and what is not --------------------------
  //
  // See the note on the German block: this page collects the caveats rather
  // than replacing them. Each one still renders beside the figure it qualifies.

  "about.title": "Methodology",
  "about.subtitle":
    "What Bundestracker measures, what it does not, and where every figure comes from.",
  "about.lead":
    "Bundestracker counts what the Bundestag itself publishes: motions, speeches, questions, named ballots, committee seats. Every figure on this site traces back to a document. What cannot be counted is not estimated either — it is missing, and this page says what is missing.",

  "about.contents": "On this page",

  // --- 1. What is counted ---
  "about.tracks.title": "What is counted",
  "about.tracks.body":
    "The activity score is a weighted sum of seven components. The weighting is a choice, not a judgement: the seven are measured in different units — words, documents, seats, a rate — and the weights are the conversion factors that put them on one scale. They are adjustable, and a signed-in reader can save their own.",
  "about.tracks.column.component": "Component",
  "about.tracks.column.measures": "What is measured",
  "about.tracks.column.weight": "Default weight",
  "about.tracks.measures.motions":
    "Motions and resolutions, from each member's DIP activity records.",
  "about.tracks.measures.speeches":
    "Words spoken in the chamber, from the protocol XML — not the number of times someone took the floor.",
  "about.tracks.measures.questions": "Minor and major written questions to the federal government.",
  "about.tracks.measures.reports":
    "Reports, from the same DIP activity records. The thinnest of the seven.",
  "about.tracks.measures.voteParticipation":
    "Share of named ballots in which a vote was cast. An abstention counts as participation.",
  "about.tracks.measures.committees": "Committee memberships in the current electoral period.",
  "about.tracks.measures.billSponsorships": "Bills the member put their name to.",
  "about.tracks.weightsNote":
    "The weights are the one part of the calculation not derived from the sources. That is why they are shown here, shown beside their component on every profile, and open to change. A total without its parts would be a verdict; with them it is arithmetic.",
  "about.tracks.viewRankings": "View the rankings",

  // --- 2. What the score does not capture ---
  "about.limits.title": "What the score does not capture",
  "about.limits.lead":
    "A low score means “little recorded”, not “little done”. Four large areas of parliamentary work leave no trace, or almost none, in the open data — not by oversight, but because nothing machine-readable is published about them.",
  "about.limits.committees.title": "Committee deliberation",
  "about.limits.committees.body":
    "The substantive work on a bill happens in committee, and those sittings are generally not public. What is published is who sits on a committee — not what was said, negotiated or won there. Bundestracker therefore counts seats and can say nothing about the deliberation itself.",
  "about.limits.constituency.title": "Constituency work",
  "about.limits.constituency.body":
    "Surgeries, appointments in the constituency, correspondence, intervening with authorities: none of it is centrally recorded. A member who puts their weight here reads as quiet in this data.",
  "about.limits.office.title": "Government and parliamentary office",
  "about.limits.office.body":
    "A ministry or a seat on the presidium changes what someone does, not how much: ministers answer questions rather than asking them, and chairing a sitting is not a speech. The score reads that as less, when it is only different.",
  "about.limits.party.title": "Group and party work",
  "about.limits.party.body":
    "Working groups, group meetings, negotiations between groups and the settling of a position all happen upstream of whatever finally appears as a document — and are legible in no document.",
  "about.limits.conclusion":
    "The activity score therefore measures a mandate's *documented* parliamentary activity. It is not a measure of diligence, influence or quality, and the ordering of two members with similar scores says nothing about the difference between them.",

  // --- 3. Data sources ---
  "about.sources.title": "Data sources",
  "about.sources.body":
    "Three sources, all publicly accessible. The first two are the Bundestag's own; the third is a non-profit database published under CC0.",
  "about.sources.column.source": "Source",
  "about.sources.column.provides": "Provides",
  "about.sources.dip.name": "DIP — the parliamentary documentation system",
  "about.sources.dip.provides":
    "Motions, bills, questions, reports, and the attribution of each record to the members involved.",
  "about.sources.protocols.name": "Plenary protocols (XML)",
  "about.sources.protocols.provides":
    "Every speech verbatim, with its speaker and word count. The basis of the speech component.",
  "about.sources.votes.name": "Named ballots (XLSX)",
  "about.sources.votes.provides": "How each individual mandate voted, including votes not cast.",
  "about.sources.stammdaten.name": "MdB-Stammdaten",
  "about.sources.stammdaten.provides":
    "The official register of members since 1949: mandates, groups, constituencies — and committee memberships for the current electoral period.",
  "about.sources.aw.name": "abgeordnetenwatch.de",
  "about.sources.aw.provides":
    "Supplementary biographical and occupational detail, plus a second copy of the voting data for cross-checking. CC0.",
  "about.sources.openDataLink": "The Bundestag's open data portal",
  "about.sources.dipLink": "The DIP API",
  "about.sources.awLink": "The abgeordnetenwatch API",
  "about.sources.attribution":
    "The source of all official figures is the German Bundestag. Bundestracker is not a Bundestag service and is neither operated nor reviewed by it.",

  // --- 4. Historical coverage ---
  "about.coverage.title": "Coverage over time",
  "about.coverage.body":
    "The sources reach back to different dates. That is a limit of publication rather than a gap in the fetch — and it decides whether a zero means “measured” or “never published”.",
  "about.coverage.column.data": "Data",
  "about.coverage.column.since": "Available from",
  "about.coverage.column.why": "Why",
  "about.coverage.records.name": "Motions, questions, bills, reports",
  "about.coverage.records.since": "EP 14 (1998)",
  "about.coverage.records.why": "DIP covers every electoral period shown here in full.",
  "about.coverage.speeches.name": "Speeches and word counts",
  "about.coverage.speeches.since": "EP 18 (2013)",
  "about.coverage.speeches.why":
    "Earlier sittings are published as PDF only; without protocol XML there is no machine-readable speech.",
  "about.coverage.votes.name": "Named ballots per mandate",
  "about.coverage.votes.since": "September 2019",
  "about.coverage.votes.why":
    "Before that date the Bundestag published its ballot lists as PDF only, with no analysable table.",
  "about.coverage.committees.name": "Committee memberships",
  "about.coverage.committees.since": "current period only",
  "about.coverage.committees.why":
    "Stammdaten is the only machine-readable source, and it lists committees for the current period alone.",
  "about.coverage.roster.name": "Register of members",
  "about.coverage.roster.since": "1949",
  "about.coverage.roster.why": "The Stammdaten dump holds every mandate since the first Bundestag.",
  "about.coverage.conclusion":
    "Scores from different electoral periods are therefore not comparable: a mandate from the 16th period has no speeches and no ballots because none were published — not because it stayed silent and stayed away.",

  // --- 5. Dissent from the group line ---
  "about.dissent.title": "Dissent from the group line",
  "about.dissent.body":
    "The named ballots show who voted differently from the majority of their own parliamentary group. It is one of the few places where the data says something about a person's conduct — and therefore the place where the limits of what may be claimed are drawn tightest.",
  "about.dissent.measuresLabel": "What is recorded",
  "about.dissent.measures":
    "A vote cast that differs from the majority position of the member's own group in the same ballot.",
  "about.dissent.notLabel": "What is not recorded",
  "about.dissent.not.whip":
    "Whipping or group discipline: whether there was any instruction on a ballot is published nowhere. A dissent is a differing vote, not disobedience.",
  "about.dissent.not.absence":
    "Absence: a vote not cast contradicts nothing and does not count as dissent.",
  "about.dissent.not.tie":
    "A group split exactly in half: with no majority there is no line to break, so those ballots are disregarded.",
  "about.dissent.not.unaffiliated":
    "Members with no group: there is nothing to measure them against.",
  "about.dissent.viewVotes": "View the ballots",

  // --- 6. Principles ---
  "about.principles.title": "Principles",
  "about.principles.record.title": "Every figure has a record behind it",
  "about.principles.record.body":
    "Each entry links to the paper, protocol or ballot list it came from. Nothing here is estimated, interpolated or projected forward.",
  "about.principles.approximate.title": "Inexact counts are marked as inexact",
  "about.principles.approximate.body":
    "Two of the home page's figures cannot be counted exactly without exceeding a query's read budget. They carry a “+”: “5,000+” means “at least 5,000”. A floor read as a total would be the less honest rendering.",
  "about.principles.noRank.title": "The bottom of the leaderboard carries no rank numbers",
  "about.principles.noRank.body":
    "The home page shows both ends of the ranking — a tracker that publishes only the top publishes a selection. The bottom end appears without rank numbers, though: a “1” there would read as “the least active member of the Bundestag”, and five rows do not support that claim.",
  "about.principles.gaps.title": "Gaps are surfaced, not filled in",
  "about.principles.gaps.body":
    "A mandate the nightly sweep has not reached shows as “not scored”, not as a zero. An unrecognised activity kind is counted and surfaced rather than silently weighted at nothing. A synthetic rendering — the seating map, for instance — says on the page itself which half is invented.",
  "about.principles.open.title": "The source code is open",
  "about.principles.open.body":
    "The scoring, the data pipeline and this interface are all public. Anyone who doubts a figure can read how it is produced.",

  // --- 7. Privacy ---
  "about.privacy.title": "Privacy",
  "about.privacy.noTracking.title": "No analytics, no advertising, no sharing",
  "about.privacy.noTracking.body":
    "Bundestracker embeds no analytics, advertising or tracking services. There are no counting pixels and no profiling, and no data is passed to third parties.",
  "about.privacy.cookies.title": "One cookie, and only once you sign in",
  "about.privacy.cookies.body":
    "Without an account the site sets no cookie. Language and theme are stored locally in the browser (localStorage) and never leave the device. Signing in adds a session cookie — and nothing else.",
  "about.privacy.account.title": "An account is optional",
  "about.privacy.account.body":
    "All the data is fully viewable without signing in. An account stores two things: your own activity-score weightings and the list of members you follow.",
  "about.privacy.mpData.title": "About the members themselves",
  "about.privacy.mpData.body":
    "Only information the Bundestag or abgeordnetenwatch publish themselves, and that concerns the mandate, is shown about a member. No private contact details are included — the Bundestag publishes none.",

  // --- closing ---
  "about.questions.title": "Something missing or wrong?",
  "about.questions.body":
    "Errors in the data and objections to the methodology belong in the public repository. Both are welcome: a measure nobody can check is not one.",
  "about.questions.cta": "View the source code",

  "homeC.claimIntro":
    "Every figure on this page stands for a document of the German Bundestag. What is not on the record is not here.",
  "homeC.claimStats":
    "Four figures for one electoral period. Two of them are floors — where a “+” appears, the count reached its limit, not the Bundestag.",
  "homeC.claimActivity":
    "The activity score measures recorded work: motions, speeches, votes, questions, committee seats. It does not measure influence, quality or attendance.",
  "homeC.claimParties":
    "Groups appear here as means per mandate, votes as named per-member records. Both are excerpts, not balance sheets.",
  "homeC.claimFeed": "What has just happened — in the order the open data published it.",

  "homeC.skipToData": "Straight to the data",
  "homeC.heroPledge":
    "No rating, no weighting by opinion. Only what stands in the official record, the protocol and the ballot list.",

  // --- committee of inquiry: the quorum ------------------------------------
  //
  // "Untersuchungsausschuss" is kept as the German term in the nav and
  // explained in the body, rather than translated to "committee of inquiry"
  // and left to stand alone. It is the name of a specific constitutional
  // instrument under Art. 44 GG, and a reader who meets the English phrase
  // here and the German one everywhere else in the coverage has to work out
  // that they are the same thing. The subtitle gives the English gloss.

  "nav.inquiry": "Inquiry quorum",

  "inquiry.title": "Committee of inquiry — the quarter",
  "inquiry.subtitle":
    "A quarter of the Bundestag's members can compel a committee of inquiry (Untersuchungsausschuss). Which parliamentary groups together reach that quarter — and which combinations have been publicly ruled out.",

  "inquiry.lead":
    "A committee of inquiry is a minority right — it is aimed at the government. The governing groups clear the quarter easily; they are not the question. What matters is whether the opposition reaches it. It does so only together with the AfD, whose cooperation every other group has ruled out.",

  "inquiry.threshold.title": "The threshold",
  "inquiry.threshold.seats": "Seats in the Bundestag",
  "inquiry.threshold.needed": "Signatures required",
  "inquiry.threshold.rule": "A quarter of the members",
  "inquiry.threshold.explainer":
    "{threshold} of {total} mandates. Art. 44(1) of the Basic Law says “a quarter of its members” — where a quarter falls between two whole numbers it rounds up, because {below} members are fewer than a quarter.",

  "inquiry.groups.title": "The groups and their seats",
  "inquiry.groups.subtitle":
    "Counted from the roster of the current electoral period — the only seating figure that is officially derivable.",
  "inquiry.groups.column.group": "Group",
  "inquiry.groups.column.seats": "Seats",
  "inquiry.groups.column.share": "Share",
  "inquiry.groups.column.toThreshold": "To the quarter",
  "inquiry.groups.column.role": "Role",
  "inquiry.groups.column.ruledOut": "Cooperation ruled out with",
  "inquiry.groups.short": "−{count}",
  "inquiry.groups.reachesAlone": "reaches it alone",
  "inquiry.groups.noneDeclared": "none",
  "inquiry.groups.notABloc": "not a bloc",
  "inquiry.groups.notABlocNote":
    "Unaffiliated members count toward the total from which the quarter is calculated. They do not appear in the combinations below: “the unaffiliated” is a residual category of individual members, not a bloc that files a joint motion.",

  "inquiry.combos.title": "Which combinations reach the quarter",
  "inquiry.combos.subtitle":
    "Every grouping of one, two or three parliamentary groups. The seat totals are counted; whether a form of cooperation has been ruled out is a maintained figure.",
  "inquiry.combos.column.combination": "Combination",
  "inquiry.combos.column.seats": "Seats",
  "inquiry.combos.column.share": "Share",
  "inquiry.combos.column.status": "Status",
  "inquiry.combos.showAll": "Also show combinations below the threshold",
  "inquiry.combos.showReaching": "Show only combinations at or above the threshold",
  "inquiry.combos.empty": "No combination in this selection.",
  "inquiry.combos.countReaching": "{count} of {total} combinations reach the quarter.",

  "inquiry.status.viable": "possible",
  "inquiry.status.blocked": "ruled out",
  "inquiry.status.short": "too small",
  "inquiry.status.shortBy": "{count} seats short",
  "inquiry.status.blockedBy": "{a} has ruled out cooperation with {b}",
  "inquiry.status.viableLabel": "Reaches the quarter, no declared exclusion",

  // --- the two scopes ---
  "inquiry.scope.chamber": "Whole chamber",
  "inquiry.scope.chamberNote":
    "All groups counted together. Here the quarter is reachable several ways — the governing groups alone clear it comfortably. This scope does not answer the question that matters.",
  "inquiry.scope.opposition": "Opposition only",
  "inquiry.scope.oppositionNote":
    "Only the groups outside the government. A committee of inquiry is aimed at the government, so this is the scope in which the number means something.",
  "inquiry.scope.oppositionSeats": "Opposition seats",
  "inquiry.scope.unavailable":
    "Which groups formed the government in this electoral period is not recorded. The opposition scope is therefore omitted rather than guessed.",
  "inquiry.scope.lock":
    "The opposition holds {oppositionSeats} of {total} seats — well above the quarter. Without the AfD, {withoutAfd} seats remain, {gap} below the threshold. The AfD alone reaches {afd} and misses it by {afdGap}.",

  "inquiry.result.title": "The result",
  "inquiry.result.none":
    "None of the {reaching} opposition combinations that reach the quarter is free of a declared exclusion. The largest grouping without one stays {shortfall} seats below the threshold.",
  "inquiry.result.some":
    "{count} opposition combination(s) reach the quarter without any of the groups involved having ruled out the cooperation.",
  "inquiry.result.conclusion":
    "The power of inquiry is a minority right: a quarter can compel an investigation without asking the majority. It does, however, require that a quarter which wants one can be assembled. The governing groups reach the quarter — and will not use it against themselves. The opposition wants it and cannot reach it without the AfD. That is how a right runs empty without anyone ever having voted it down.",

  "inquiry.matrix.title": "Who will not work with whom",
  "inquiry.matrix.subtitle":
    "Declared exclusions between the groups. A maintained political figure — not a Bundestag dataset.",
  "inquiry.matrix.legendRuledOut": "cooperation ruled out",
  "inquiry.matrix.legendOpen": "not ruled out",
  "inquiry.matrix.legendSelf": "same group",
  "inquiry.matrix.cellRuledOut": "{a} and {b}: cooperation ruled out",
  "inquiry.matrix.cellOpen": "{a} and {b}: no declared exclusion",

  "inquiry.maintainedNotice":
    "Maintained by Bundestracker, not sourced from official data: which group has ruled out cooperation with which appears in no Bundestag dataset. This table rests on public declarations — party congress resolutions and repeated commitments — and can change. The seat counts on this page are officially backed; the exclusions are not.",
  "inquiry.maintainedAsOf": "As of: {date}",
  "inquiry.maintainedOmissions":
    "Deliberately not recorded as an exclusion: the relationship between the SPD and Die Linke. The federal incompatibility resolution no longer stands, and state-level coalitions exist — what remains is reluctance, not a declared bar. The BSW is absent because it holds no seats in this Bundestag and so has none to contribute.",

  "inquiry.explainer.title": "What is an Untersuchungsausschuss?",
  "inquiry.explainer.what":
    "A committee of inquiry is the Bundestag's sharpest instrument of scrutiny. It investigates one specific matter — an act of government, an affair, a procurement — and ends by publishing a report.",
  "inquiry.explainer.quarterTitle": "Why a quarter",
  "inquiry.explainer.quarter":
    "Art. 44(1) of the Basic Law obliges the Bundestag to set up a committee of inquiry on the motion of a quarter of its members. “Obliges” is the decisive word: the majority cannot prevent it. That is why the quarter is the only number that matters — and why this is an opposition right rather than a majority procedure.",
  "inquiry.explainer.powersTitle": "What powers it carries",
  "inquiry.explainer.powers":
    "It can summon witnesses and examine them under a duty of truthfulness, require the federal government to produce files, and commission expert evidence. Evidence is taken by analogy to criminal procedure; a quarter of the committee's own members can force evidence to be taken even against the committee majority.",
  "inquiry.explainer.limitsTitle": "Where its limits are",
  "inquiry.explainer.limits":
    "It passes no judgment and imposes no penalty. Its output is a report — the effect lies in the public taking of evidence and in access to documents nobody else would see. The majority cannot prevent the committee, but it can attach its own assessment to the report.",
  "inquiry.explainer.mattersTitle": "Why this page exists",
  "inquiry.explainer.matters":
    "A minority right is not abolished by voting against it. It runs empty when the necessary minority cannot form. This page only does the arithmetic on whether it could — the seat counts are official, the declared exclusions are maintained, and the two are kept apart.",

  "inquiry.seeSeating": "View the seating map",
  "inquiry.seeAbout": "Methodology",
  "inquiry.home.title": "Can this Bundestag establish a committee of inquiry?",
  "inquiry.home.body":
    "A quarter of the members is enough — {threshold} of {total} seats. The governing groups clear it easily, but they do not investigate themselves. The opposition reaches it only with the AfD, whose cooperation every other group has ruled out.",
  "inquiry.home.cta": "Check the arithmetic",
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

/**
 * Picks the best supported locale from the browser's own language list.
 *
 * The client-side counterpart to `localeFromAcceptLanguage`, and the reason
 * both exist: the two sources do not always agree. `Accept-Language` is what
 * the browser was *configured* to send and can be stripped by a proxy, absent
 * on a prefetch, or normalised to a single tag by a CDN; `navigator.languages`
 * is what the browser actually knows about its reader. Where the header is
 * missing or unsupported and the browser says German — or English — the
 * browser is the better witness, so `LocaleProvider` consults this after
 * hydration.
 *
 * Takes the tag list rather than reading `navigator` itself, so it is pure and
 * testable and does not have to guess whether it is running in a browser.
 * `navigator.languages` is ordered most-preferred first and carries no quality
 * values, which is the whole difference from the header form above — order *is*
 * the preference, so the first supported tag wins.
 *
 * German is the fallback for the reason `DEFAULT_LOCALE` is German: the
 * audience is German and the subject is the Bundestag. A browser set to
 * French gets German, not English.
 */
export function localeFromNavigator(tags: readonly string[] | undefined | null): Locale {
  if (!tags) return DEFAULT_LOCALE
  for (const tag of tags) {
    // "de-DE", "de-AT" and "de" all select German — same normalisation the
    // header form does, because they are the same tag space (BCP 47).
    const base = tag.trim().toLowerCase().split("-")[0]
    if (isLocale(base)) return base
  }
  return DEFAULT_LOCALE
}
