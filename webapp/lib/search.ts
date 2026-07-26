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
