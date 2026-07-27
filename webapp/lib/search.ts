/**
 * Text folding — for the roster's name box, and for the keyword search.
 *
 * Two related jobs live here because they are the same idea applied at two
 * grains: making two spellings of the same thing compare equal. `foldName` does
 * it for a person, the rest of the file does it for the words of a parliamentary
 * record.
 *
 * Nothing here may import from `convex/` or from React. Like lib/taxonomy.ts,
 * this module is loaded on **both** sides — the browser filters the roster with
 * `foldName`, and `convex/activityEvents.ts` builds its indexed text with
 * `indexableText` inside Convex's V8 runtime. A React import would break the
 * second; a `convex/` import would close a cycle through the schema.
 *
 * ## Why the search half exists at all
 *
 * Convex's `searchIndex` was measured before any of this was written, against a
 * throwaway table on a local deployment. What it does and does not do decided
 * the whole design:
 *
 *  - **It prefix-matches the final term only.** `Klima` finds `Klimaschutz`;
 *    `Klimaschutz` does not find `Klima`. So the "Klima matches Klimaschutz"
 *    requirement is the index's own behaviour and needs no help.
 *  - **It folds case and nothing else.** `fur` does not match `für`, `Grosse`
 *    does not match `Große`, `Strauss` does not match `Strauß`. On a German
 *    corpus typed at keyboards that may have neither umlauts nor an `ß`, that
 *    is the difference between a search box and a trick question.
 *  - **It has no typo tolerance.** `Klimq`, `Naturshutz` and `Umwelz` all
 *    return nothing. Nothing here can change that, and the UI should not imply
 *    otherwise.
 *
 * The first point is free. The second is what this file fixes, and the fix has
 * to happen at *index* time rather than at query time, because only one side
 * can be expanded: appending alternatives to a query would put them in final
 * position, where the index's prefix rule makes the *last* term a filter that
 * every result must satisfy — measured, and the reason `Sicher zzzznomatch`
 * returns nothing while `zzzznomatch Sicher` returns matches.
 *
 * So the asymmetry below is deliberate and load-bearing:
 *
 *   the document emits every spelling — `indexableText`
 *   the query emits exactly one    — `foldSearchQuery`
 *
 * `für` is indexed as both `fur` and `fuer`, so a reader typing `für`, `fur` or
 * `fuer` lands on one of them. Doing it the other way round — one token indexed,
 * three queried — is the arrangement the prefix rule breaks.
 */

// --- names ----------------------------------------------------------------

/**
 * Name folding for the roster's search box.
 *
 * The same normalisation the pipeline applies when it joins DIP records to
 * Stammdaten — `fold_name` in pipeline/src/bundestrack/models/stammdaten.py:81
 * — and for the same reason, one step down: German parliamentary names carry
 * diacritics and an `ß`, and a reader typing `Ozoguz` or `Strauss` on a
 * keyboard that has neither should still find `Özoğuz` and `Strauß`.
 *
 * Deliberately a second implementation rather than an import: that one is
 * Python, this is the browser, and neither can call the other. What matters is
 * that they agree on the rule — NFD, drop combining marks, `ß` → `ss`, case-fold
 * — which is why the steps below are in the same order and the reason for that
 * order is repeated here.
 *
 * This is *search* folding, not the matching that assigns records to MPs. It
 * only ever decides what a reader sees while typing; a false positive is a row
 * they scroll past, not a vote attributed to the wrong person.
 */
export function foldName(value: string): string {
  // `ß` → `ss` before decomposition, because `ß` has no combining form: NFD
  // leaves it intact, so `Strauß` and `Strauss` would not fold together if this
  // ran after.
  const folded = value.trim().toLowerCase().replace(/ß/g, "ss")
  return folded.normalize("NFD").replace(/\p{Mn}/gu, "")
}

// --- words ----------------------------------------------------------------

/**
 * How the two sides agree on a single word.
 *
 * `foldName`'s rule, minus the trimming that only makes sense for a whole
 * field: lowercase, `ß` → `ss`, then strip combining marks. `für` → `fur`,
 * `Straße` → `strasse`, `Özoğuz` → `ozoguz`.
 *
 * This is the *canonical* form — the one a query is reduced to, and the one a
 * document always emits. `umlautExpansion` adds the second form documents also
 * emit; see the header for why only documents get one.
 */
function foldWord(word: string): string {
  return word
    .toLowerCase()
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "")
}

/**
 * The `ae`/`oe`/`ue` spelling of a word, or null when it has no umlaut.
 *
 * German has two written forms of the same vowel and both are in the corpus:
 * lib/parties.ts already folds `GRÜNEN` and `GRUENEN` together for exactly this
 * reason, and §5.2's protocol XML spells one group's name two ways within a
 * single document. A reader without an umlaut key types the long form as often
 * as the bare vowel, so a document that indexes only one of the three is
 * findable by roughly a third of the people looking for it.
 *
 * Null rather than the unchanged word when nothing applies, so the caller can
 * skip emitting a duplicate token — an index entry that costs space and
 * distorts the relevance ranking (a term's frequency is part of the score)
 * without matching anything the canonical form does not already match.
 */
function umlautExpansion(word: string): string | null {
  const expanded = word
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    // Any remaining diacritic (a Turkish `ğ`, a Bosnian `ć`) folds the same way
    // it does in `foldWord`, so this differs from the canonical form only where
    // an umlaut actually was.
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "")
  return expanded === foldWord(word) ? null : expanded
}

/**
 * Splits text into words, discarding punctuation.
 *
 * `\p{L}\p{N}` rather than `\w`, because `\w` is ASCII: it would cut `Özoğuz`
 * into three fragments and `Anfrage` away from a hyphen it never had. Digits
 * stay in — a reader searching `21/7327` or `Artikel 13` is searching for the
 * number.
 */
function words(value: string): string[] {
  return value.match(/[\p{L}\p{N}]+/gu) ?? []
}

/**
 * The searchable form of one record's text, for storage in a `searchIndex`.
 *
 * Every argument is concatenated, so a caller passes a title and a description
 * and gets one field. Nulls are skipped rather than stringified — `"null"` is a
 * word, and it would be a word every undescribed record matched.
 *
 * Each word contributes its canonical fold and, where they differ, its umlaut
 * expansion. Duplicates are dropped: the same word twice in a title is one
 * token here, which keeps the index honest about term frequency without
 * changing what matches.
 *
 * ⚠ Whatever this returns is what the index can find. Changing the rule means
 * every stored row's field is stale until `backfillSearchText` in
 * convex/search.ts has re-derived it — the rows do not fail, they simply stop
 * matching things they used to. That sweep exists for this reason as much as
 * for the initial population.
 */
export function indexableText(...parts: Array<string | null | undefined>): string {
  const tokens = new Set<string>()
  for (const part of parts) {
    if (!part) continue
    for (const word of words(part)) {
      const folded = foldWord(word)
      if (!folded) continue
      tokens.add(folded)
      const expanded = umlautExpansion(word)
      if (expanded) tokens.add(expanded)
    }
  }
  return [...tokens].join(" ")
}

/**
 * A reader's query, reduced to the canonical form the index holds.
 *
 * One spelling per word — see the header. Returns `""` for a query with no
 * word characters at all (`"???"`, `"  "`), which callers must treat as "no
 * search" rather than as a search matching nothing: Convex's `.search()` with
 * an empty string is a query with no terms, and what it returns is not a
 * result set anybody asked for.
 */
export function foldSearchQuery(value: string): string {
  return words(value)
    .map(foldWord)
    .filter((word) => word.length > 0)
    .join(" ")
}
