# Handoff — data-mp-enrichment

## Done

Wave 8 Agent H, complete and pushed. MPs now have official portraits, an
occupation, education and contact details, end to end.

**Sources (all measured live on 2026-07-27, not assumed):**

- `pipeline/src/bundestrack/api/mp_profiles.py` — the Bundestag's own AJAX MP
  listing. **639/639 WP21 portraits, each photographer-credited**, of which
  **635 join to the roster** through the existing `MPResolver`, none
  ambiguously. Plus per-MP biography pages for contact details.
- `pipeline/src/bundestrack/api/abgeordnetenwatch.py` — `iter_politicians()`,
  joined by `ext_id_bundestagsverwaltung`, which **is** the 8-digit Stammdaten
  id. 628/630 match; occupation 88.1 %, education 83.4 %.

**Pipeline:** `models/enrichment.py`, `transform.resolve_profiles` /
`portrait_enrichment` / `politician_enrichment` / `contact_payload`,
`MPResolver.attach_enrichment`, and the `enrich-mps` stage in `sync.py`
registered **after `dip-persons`** (see Blockers-that-were for why that ordering
is load-bearing).

**Convex:** `mps` gains `photoCredit`, `occupation` and a nested `contact`
object — all `v.optional` (see below). `occupationOf` in `lib/bundestag.ts` is
the single definition of "what this MP does".

**Frontend:** portraits everywhere, occupation after party in the member table
(sortable), under the name on the profile, on the seating tooltip; a Contact
card with the form link, constituency office and socials.

**Verified in a real browser against a live deployment**, not only in tests:
member table, enriched profile, unenriched profile (initials fallback + "no
contact details recorded"), and the seating tooltip reading
`Aylin Brandt / Wahlkreis 42 (BY) / AfD / MdB`.

**Three task premises were wrong and are documented rather than silently
dropped** — see `.vibe/TASK.md` and `docs/api-research.md` §6.5a:

1. §6.5's 36.5 % Wikimedia ceiling is superseded: portraits are 100 %.
2. **No MP email or phone is published in any Bundestag source.** The DTD
   declares no contact elements; 13 sampled pages have zero `mailto:`/`tel:`.
   The Contact card says so in words.
3. Activity-feed occupation is deliberately omitted — `activity-feed-item.tsx:235`
   records that the row already wraps at three names plus badges (a Wave 6 fix).

## In Progress

Nothing.

**Structure pass: complete. 17 findings raised across four lenses, 16 refuted
under adversarial verification, 2 acted on.**

- `93fb9c8` — a dead `occupation` field on the rankings query. I had added it
  assuming the member table read from `rankings`; it reads from
  `mps.getMPsWithScores`, and no rankings consumer renders the field. It was
  payload on 630 rows per request, and a second way to resolve an occupation.
- `02e48be` — three unreachable branches in `ACADEMIC_TITLE`. `LL`, `B` and `M`
  are each within `{1,6}` letters, so the first character class already matched
  them; they read as load-bearing only because the comment above cites `M. A.`
  and `LL.M.` by name.

Both are refactor-only and were re-verified against the live 639-name corpus:
still 635/639, same four misses.

## Next

1. **Run the pipeline against production** — `pixi run pipeline sync`. The
   enrichment has only ever run against fixtures and a dev deployment. The first
   run backfills contact blocks over ~6 nights (`CONTACT_FETCH_LIMIT = 120/run`);
   portraits all land on run one.
2. **Watch the enrich-mps stage notes** on that first run. Expect
   `635/639 portraits matched`; a materially lower number means the Stammdaten
   snapshot moved or the listing markup changed.
3. **PR size**: 27 non-fixture files against the protocol's ≤20. Under the
   4000-line budget (2448). `vibe ship` will refuse it as-is — either split
   (pipeline / Convex+frontend is the natural seam) or waive deliberately.

## Blockers

None outstanding. Two were hit and resolved:

- **The schema could not deploy.** Convex validates every existing row at deploy
  time, so three new required fields on a 630-row `mps` table rejected the whole
  deploy. Found only by deploying — typecheck and both suites passed throughout.
  Fixed in `24d39e7` by making them `v.optional`, which the schema header already
  prescribes for "a *row* that legitimately predates a field".
- **The Enodia WAF blocked this host** partway through research (§2.6), which is
  why the listing fixture is built from cached markup rather than a fresh fetch.
  Confirmed the pipeline degrades correctly: a block becomes a stage *note*, the
  run stays green, and every other stage still runs.

⚠ Also note: this worktree was deleted externally mid-session and recreated from
`origin`. Uncommitted work was lost and redone; `webapp/convex/_generated/` and
`node_modules/` are untracked, so a fresh worktree needs `bun install` **and**
`bunx convex codegen` before `bun run typecheck` says anything meaningful.

## Exact State

- Last commit: `02e48be` — `refactor: drop three unreachable branches from ACADEMIC_TITLE`
- Tests: **passing** — 256 Python (`pytest`), 276 JS (`bun test`), `tsc --noEmit` clean, `ruff check` clean.
- Lint: one pre-existing Biome a11y error in `components/mp-card.tsx:239`, on `main` before this branch and untouched by it.
- Uncommitted changes: none.
