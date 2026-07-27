/**
 * A hand-written German↔English lexicon for the keyword search.
 *
 * The requirement is that an English reader typing `lawyer` finds an MP whose
 * record says `Rechtsanwalt`, and that a German reader typing `Klima` finds one
 * that says `climate`. There is no translation service in this project and no
 * LLM — Wave 9 rules both out explicitly — so the crossing has to be a table,
 * and a table is only as good as its entries are honest.
 *
 * Nothing here may import from `convex/` or from React: like lib/search.ts,
 * this is loaded both in the browser and inside Convex's V8 runtime.
 *
 * ## Why a lexicon and not a stemmer
 *
 * German compounds where English uses a phrase. `Klimaschutzgesetz` is one word
 * for "climate protection act", and no stemmer reduces it to anything an
 * English query would produce. What *does* work is the index's own prefix rule
 * (see lib/search.ts): a query for `klima` already matches
 * `klimaschutzgesetz`, because the final query term is prefix-matched. So the
 * lexicon's job is narrower than translation — it only has to get the reader to
 * the German *stem*, and German morphology does the rest.
 *
 * That is why the German side of most entries below is a bare root
 * (`klima`, `miet`, `steuer`) rather than a citation form: `miet` reaches
 * `Mietrecht`, `Mieterschutz` and `Mietpreisbremse`, where `Miete` reaches only
 * a document that happens to use the noun alone.
 *
 * ## The rule for adding an entry
 *
 * **A term goes in only if a wrong hit would be obvious to the reader rather
 * than invisible.** This search returns MPs, and every result says which record
 * matched (`components/search-results.tsx`), so a spurious match is a card the
 * reader dismisses — not a claim about an MP they cannot check. That is what
 * makes an approximate lexicon acceptable here and would not make it acceptable
 * in, say, the vote attribution.
 *
 * Deliberately *not* included:
 *
 *  - **Politically loaded pairings.** `migration`/`asyl` are near-synonyms in
 *    the corpus and are kept apart: which word a motion uses is itself a
 *    political choice, and collapsing them would make the search assert an
 *    equivalence the Bundestag's own drafters were careful not to make.
 *  - **Short roots that collide.** `art` (English) would prefix-match
 *    `Artikel`, `Artenschutz` and `Artillerie`. A three-letter English word
 *    against a German compound corpus is noise, not recall.
 *  - **Anything needing inflection.** There is no `-s`/`-en` stripping here on
 *    purpose. The index's prefix rule handles the common direction (a query
 *    shorter than the document's word), and the other direction — a reader
 *    typing `Klimas` for a document saying `Klima` — is rare enough that the
 *    machinery would cost more than it returns.
 */

/**
 * Synonym groups. Every term in a group expands to every other term.
 *
 * Symmetric by construction rather than by two mirrored tables: `SYNONYMS`
 * below is built by walking these groups in both directions, so a pair cannot
 * be listed one way and forgotten the other. That failure is otherwise
 * invisible — the search simply works in German and not in English.
 *
 * All terms are written in the folded form `lib/search.ts` produces: lowercase,
 * no diacritics, `ß` as `ss`. `foldSearchQuery` folds the reader's query the
 * same way before it is looked up here, so `Klima`, `KLIMA` and `klima` all
 * find this table. A term with an umlaut written here in its raw form would
 * simply never be looked up — `assertFolded` in lib/thesaurus.test.ts is what
 * stops that shipping.
 */
const GROUPS: ReadonlyArray<readonly string[]> = [
  // --- professions, from `mps.profession` and `mps.occupation` -------------
  //
  // These are the entries Wave 9 names explicitly ("lawyer" → "Rechtsanwalt"),
  // and the ones with the best data behind them: Stammdaten's `BERUF` covers
  // 94.3 % of the roster (convex/schema.ts).
  ["rechtsanwalt", "rechtsanwaltin", "anwalt", "jurist", "lawyer", "attorney", "solicitor"],
  ["arzt", "arztin", "mediziner", "doctor", "physician"],
  ["lehrer", "lehrerin", "padagoge", "teacher"],
  ["ingenieur", "ingenieurin", "engineer"],
  ["landwirt", "bauer", "farmer", "agriculture", "agricultural"],
  ["unternehmer", "kaufmann", "kauffrau", "entrepreneur", "businessman", "merchant"],
  ["wissenschaftler", "forscher", "scientist", "researcher"],
  ["journalist", "journalistin", "reporter"],
  ["soldat", "soldatin", "soldier"],
  ["polizist", "polizistin", "police", "policeman"],
  ["pflege", "krankenpfleger", "nurse", "nursing", "care"],
  ["handwerker", "craftsman", "tradesman"],
  ["beamter", "beamtin", "civil servant", "official"],
  ["okonom", "volkswirt", "economist"],
  ["informatiker", "programmierer", "computer scientist", "software developer"],
  ["architekt", "architektin", "architect"],
  ["apotheker", "pharmacist"],
  ["theologe", "pfarrer", "theologian", "priest", "pastor"],

  // --- policy fields, from motion titles and question subjects -------------
  //
  // The German side is a root, not a word — see the header on compounds.
  ["klima", "climate"],
  ["umwelt", "environment", "environmental"],
  ["energie", "energy"],
  ["erneuerbar", "renewable"],
  ["atom", "nuklear", "nuclear"],
  ["kohle", "coal"],
  ["wasserstoff", "hydrogen"],
  ["verkehr", "transport", "traffic", "mobility"],
  ["bahn", "eisenbahn", "railway", "rail"],
  ["gesundheit", "health", "healthcare"],
  ["krankenhaus", "klinik", "hospital"],
  ["bildung", "education"],
  ["schule", "school"],
  ["hochschule", "universitat", "university", "higher education"],
  ["forschung", "research"],
  ["digital", "digitalisierung", "digitalisation", "digitization"],
  ["kunstliche intelligenz", "artificial intelligence"],
  ["datenschutz", "data protection", "privacy"],
  ["wohnung", "wohnen", "housing"],
  ["miet", "rent", "rental", "tenancy"],
  ["bau", "construction", "building"],
  ["arbeit", "labour", "labor", "employment", "work"],
  ["arbeitslos", "unemployment", "unemployed"],
  ["rente", "pension", "retirement"],
  ["steuer", "tax", "taxation"],
  ["haushalt", "budget"],
  ["schulden", "debt"],
  ["wirtschaft", "economy", "economic"],
  ["mittelstand", "small business"],
  ["landwirtschaft", "agriculture", "farming"],
  ["tierschutz", "animal welfare", "animal protection"],
  ["verbraucherschutz", "consumer protection"],
  ["migration", "immigration"],
  ["asyl", "asylum", "refugee"],
  ["integration"],
  ["sicherheit", "security", "safety"],
  ["verteidigung", "defence", "defense"],
  ["bundeswehr", "armed forces", "military"],
  ["waffen", "rustung", "weapons", "armament", "arms"],
  ["frieden", "peace"],
  ["ukraine"],
  ["russland", "russia"],
  ["china"],
  ["europa", "eu", "european"],
  ["nato"],
  ["aussenpolitik", "foreign policy"],
  ["entwicklungshilfe", "development aid"],
  ["menschenrechte", "human rights"],
  ["justiz", "recht", "justice", "law", "legal"],
  ["polizei", "policing"],
  ["kriminalitat", "crime"],
  ["terrorismus", "terrorism"],
  ["korruption", "corruption"],
  ["familie", "family"],
  ["kinder", "children", "child"],
  ["jugend", "youth"],
  ["frauen", "women"],
  ["gleichstellung", "equality", "gender equality"],
  ["behinderung", "inklusion", "disability", "inclusion"],
  ["armut", "poverty"],
  ["sozial", "social", "welfare"],
  ["burgergeld", "citizens income", "basic income"],
  ["mindestlohn", "minimum wage"],
  ["kultur", "culture", "cultural"],
  ["medien", "media"],
  ["sport", "sports"],
  ["kirche", "religion", "church"],
  ["wahl", "election", "electoral"],
  ["demokratie", "democracy", "democratic"],
  ["verfassung", "grundgesetz", "constitution", "constitutional"],
  ["foderalismus", "federalism"],
  ["kommune", "municipality", "local government"],
  ["burokratie", "bureaucracy", "red tape"],
  ["corona", "pandemie", "covid", "pandemic"],
  ["impfung", "vaccination", "vaccine"],
  ["drogen", "cannabis", "drugs"],

  // --- the vocabulary of the records themselves ---------------------------
  //
  // A reader searching in English does not know the German name of the
  // instrument, and these are the words every title is built from.
  ["antrag", "motion", "proposal"],
  ["gesetzentwurf", "gesetz", "bill", "act", "legislation"],
  ["anfrage", "question", "inquiry"],
  ["kleine anfrage", "minor interpellation"],
  ["grosse anfrage", "major interpellation"],
  ["rede", "speech", "address"],
  ["abstimmung", "vote", "ballot", "division"],
  ["ausschuss", "committee"],
  ["anderung", "amendment", "change"],
  ["bericht", "report"],
  ["entschliessung", "resolution"],
  ["drucksache", "paper", "document"],
  ["bundesregierung", "federal government"],
  ["bundestag", "parliament"],
  ["fraktion", "parliamentary group", "caucus"],
  ["opposition"],
  ["koalition", "coalition"],
]

/**
 * Folded term → the terms it also matches.
 *
 * Built once at module load, symmetric by construction — see the note on
 * `GROUPS`. A term appearing in two groups accumulates both groups' terms
 * rather than the second silently replacing the first, which is what lets
 * `recht` sit in the professions group and the policy group at once.
 */
const SYNONYMS: ReadonlyMap<string, readonly string[]> = (() => {
  const map = new Map<string, Set<string>>()
  for (const group of GROUPS) {
    for (const term of group) {
      const bucket = map.get(term) ?? new Set<string>()
      for (const other of group) {
        if (other !== term) bucket.add(other)
      }
      map.set(term, bucket)
    }
  }
  return new Map([...map].map(([term, set]) => [term, [...set]]))
})()

/** Every term the lexicon knows, for the tests and for nothing else. */
export function thesaurusTerms(): string[] {
  return [...SYNONYMS.keys()].sort()
}

/**
 * What else a folded query means.
 *
 * Returns the *alternatives only*, never the query itself, because the caller
 * runs the original query too and adding it here would make it a duplicate
 * term in one of the searches. An unknown term yields an empty array, which is
 * the normal case: the lexicon covers the vocabulary a reader is likely to
 * cross a language boundary with, not the corpus.
 *
 * Multi-word queries are looked up whole *and* per word, so `kleine anfrage`
 * finds its own entry while `klima gesetz` still expands both halves. The whole
 * -query lookup is tried first and, when it hits, the per-word pass is skipped:
 * the phrase entry is the more specific answer, and running both would dilute
 * it with the generic senses of its parts.
 */
export function expandQuery(foldedQuery: string): string[] {
  const query = foldedQuery.trim()
  if (!query) return []

  const whole = SYNONYMS.get(query)
  if (whole) return [...whole]

  const out = new Set<string>()
  for (const word of query.split(/\s+/)) {
    for (const synonym of SYNONYMS.get(word) ?? []) out.add(synonym)
  }
  // A word that expands to itself as part of a longer phrase would re-run the
  // reader's own query; drop it rather than search twice for the same thing.
  out.delete(query)
  return [...out]
}
