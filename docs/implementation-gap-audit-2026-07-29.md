# Bundestracker — implementation-completeness audit

**Date:** 2026-07-29 · **Base commit:** `6c66d0b` · **Branch:** `audit-implementation-gaps`
**Production:** https://www.bundestracker.de · **Convex prod:** `whimsical-bandicoot-307`

This is Wave 1: evidence, not implementation. Every row below cites a file, a
commit, a branch, a live URL or a measured production number. Where a claim
could not be verified, it says so rather than guessing.

> **Status updates are struck through in place rather than deleted.** This
> document is dated evidence, so a row that has since been fixed keeps its
> original finding — the reason the fix was needed is the part worth keeping.
> Rows marked **fixed** were closed on branch `engineering-hygiene-gaps`
> (GAP-013, GAP-014, GAP-023, GAP-024, and the documentation half of GAP-015).
> Everything unmarked is as first measured on 2026-07-29.

---

## 0. The headline

**Joshua's complaint is correct, and its cause is not the one it looks like.**

The contact feature was planned, built, tested, deployed *and populated*. It is
absent from the site today because **a pipeline run blanked it in production
during this audit**, at 11:13:56 UTC on 2026-07-29. Measured directly:

| Time (UTC, 2026-07-29) | WP21 `mps` rows with non-null `contact` |
|---|---|
| 10:58 (start of this audit) | **623 / 635** |
| 11:21 (after a sync completed at 11:11:58) | **0 / 635** |

The same write nulled `photoUrl` (633 → 0), `photoCredit` (633 → 0),
`occupation` (516 → 0) and `education` (487 → 0). `profession` (599) and `bio`
(607) survive, because those come from Stammdaten rather than from the
enrichment stage.

This is **GAP-001**, and it is the single most important finding in this report:
the Kontakt card renders nothing because `contact` is null for every member
(`webapp/components/mp-profile.tsx:286` — `if (!contact) return null`), not
because anyone forgot to build it.

Two further findings are close behind and are *not* explained by the outage:

- **GAP-002** — the contact card sits **1 400–1 500 px down the page**, third in
  a sidebar, below the portrait and the biography. Even fully populated it is
  ~1.6 desktop viewports below the fold. Someone looking for contact details on
  a profile they opened would plausibly conclude there are none.
- **GAP-003** — for 12 of 635 members the card is **absent by design**, and that
  set includes Habeck and Baerbock, two of the most-searched names on the site.

Beyond contact, the audit found the product is **substantially more complete
than the complaint implies** — the specialist features are all real — but that
it carries a distinct class of defect: **work that was built and is invisible**.
19 of 56 public Convex functions have no caller; two electoral periods of data
are live and unreachable; and the site advertises a feature (following members)
that has no UI at all.

---

## 1. Gap matrix

Evidence strength: **A** = measured live or reproduced; **B** = explicit written
plan or code contract; **C** = inferred from commit/doc prose.

Claim strength distinguishes what was actually promised: `explicit_plan` = a
line in `Bundestrack-Plan.md` / `-V2.md` or a `.vibe/TASK.md`; `code_contract` =
the code asserts it; `roadmap_idea` = aspiration, never committed.

| ID | Feature | Status | Ev. | Claim | Root cause | Recommendation | Depends on | Parallel? |
|---|---|---|---|---|---|---|---|---|
| **GAP-001** | MP contact + portrait + occupation data null in prod | **implemented_not_populated** | A | explicit_plan | Enrichment rides the roster upsert; the 30-day contact TTL starves stage 3, so stage 2's re-post publishes nulls | Re-run enrichment with the full flag; then make the TTL non-destructive | none | ✅ first |
| **GAP-002** | Contact card buried ~1 450 px down, third in sidebar | **buried_in_ui** | A | explicit_plan | Sidebar ordering never revisited after the card was added | Promote contact above/beside biography; add an anchor from the header | GAP-001 to verify | ✅ |
| **GAP-003** | 12 members have no contact block at all | **partially_implemented** | A | code_contract | Name-join misses + Stammdaten lag; no retry for contact specifically | Quarantine + retry; render an honest empty state instead of nothing | GAP-001 | ✅ |
| **GAP-004** | MP email + phone | **blocked_by_source** | A | explicit_plan | The Bundestag publishes neither, anywhere | Do **not** implement. Keep the substitute + the explanatory line | — | n/a |
| **GAP-005** | Daily pipeline cron never installed | **planned_but_absent** | A | explicit_plan | `scripts/daily-sync.sh` was written; nobody installed it | Install the cron; add a freshness check | GAP-001 | ✅ |
| **GAP-006** | Follow / watchlist has zero UI | **implemented_not_deployed** | A | explicit_plan | Backend built, page never was; `/settings` never existed | Build the follow button + list, or stop advertising it | GAP-007 | ⚠ i18n |
| **GAP-007** | `/settings` route never existed | **planned_but_absent** | A | explicit_plan | Agent built the plumbing, not the page | Create `/settings` as the home for weights + follows | — | ⚠ i18n |
| **GAP-008** | Site advertises following in DE and EN | **partially_implemented** | A | code_contract | Copy shipped ahead of the feature | Ship GAP-006 or correct the copy | GAP-006 | ⚠ i18n |
| **GAP-009** | WP19 + WP20 live but unreachable | **implemented_not_deployed** | A | explicit_plan | No period selector; every page hardcodes `CURRENT_WAHLPERIODE` | Add a period selector; wire `getMPMandates` | — | ⚠ shared |
| **GAP-010** | Cross-language search returns nothing | **partially_implemented** | A | explicit_plan | Thesaurus exists; `mps.occupation` is not in the search index | Index occupation/profession, or scope the promise | — | ✅ |
| **GAP-011** | Occupation reaches 1 of 4 planned surfaces | **partially_implemented** | A | explicit_plan | Merge loss — `7e48f4a` is not an ancestor of `main` | Cherry-pick the table column; fix the seat tooltip | GAP-001 | ✅ |
| **GAP-012** | 19 of 56 public Convex functions uncalled | **implemented_not_deployed** | A | code_contract | Backend built ahead of UI, repeatedly | Wire or delete; each is a decision | — | ✅ |
| **GAP-013** | No CI: no test/lint/typecheck/deploy gate | ~~planned_but_absent~~ → **fixed** | A | inferred | Never set up | ~~Add a workflow running the existing gates~~ — `.github/workflows/ci.yml` runs the existing pixi tasks | — | ✅ |
| **GAP-014** | Clean checkout cannot typecheck or fully test | ~~partially_implemented~~ → **fixed** | A | code_contract | `convex/_generated` is gitignored and needs credentials | ~~Commit generated types or document the bootstrap~~ — both: committed, with `check-codegen` guarding drift | GAP-013 | ✅ |
| **GAP-015** | README claims GitHub OAuth; it is disabled | ~~partially_implemented~~ → **fixed (doc half)** | A | doc_statement | Credentials never registered | ~~Register the app or correct the README~~ — README corrected; **the app is still unregistered and GitHub sign-in still does not work** | — | ✅ |
| **GAP-016** | README describes the cron in the present tense | **partially_implemented** | A | doc_statement | Doc written ahead of the deployment step | Correct with GAP-005 | GAP-005 | ✅ |
| **GAP-017** | No `/motions` page though the backend is complete | **planned_but_absent** | B | explicit_plan | Route never created | Build it, or drop it from the nav plan | — | ⚠ i18n |
| **GAP-018** | Vote explanations (§31 GO-BT) | ~~planned_but_absent~~ → **source confirmed, ingested** | A | explicit_plan | Plan hedged it ("where available"); nobody had checked whether the source existed | ~~Confirm the source exists before committing~~ — it does: DIP publishes each declaration as an `/aktivitaet` with `person_id`, the procedure, and a page-anchored PDF link (api-research §4.5). Ingested into `voteExplanations`; **no text is generated** | — | ✅ |
| **GAP-019** | Trend suite: 5 of 6 charts | **partially_implemented** | B | explicit_plan | Sixth chart silently dropped | Build it or record the decision | — | ✅ |
| **GAP-020** | Opposition adjustment + productivity metrics | **planned_but_absent** | B | explicit_plan | "Stats polish" tasks skipped | Treat as new scope; both are editorially loaded | GAP-009 | ✅ |
| **GAP-021** | Federal-state filter inert on 2 pages | **partially_implemented** | A | explicit_plan | Pipeline never stores Bundesland | Store `WKR_LAND` at ingest | backfill | ✅ |
| **GAP-022** | `/seating` React #418 hydration error, seen once in 4 loads | **partially_implemented** | C | inferred | Likely SSR/client mismatch; **not reproduced** on 3 further runs | Investigate only if it recurs; low confidence | — | ✅ |
| **GAP-023** | `auth-routes.ts:30` comment says `/sign-in` doesn't exist | ~~stale_plan_superseded~~ → **fixed** | A | code_contract | Comment outlived the fix | ~~Delete the stale sentence~~ — corrected to describe the symptom the route now has | — | ✅ |
| **GAP-024** | `purgeSeed` does not cover `voteSheets` | ~~partially_implemented~~ → **fixed** | A | code_contract | Table omitted from the purge list | ~~Add it~~ — folded into `purgeSeedData`; `done` and `seedDataPresent` now answer for sheets too | — | ✅ |
| **GAP-025** | "Procedural clock" | **stale_plan_superseded** | A | roadmap_idea | Never in any plan, commit or file | **Do not build.** Not committed scope | — | n/a |
| **GAP-026** | Enrichment TTL is keyed by MP id with no Wahlperiode, so a historical backfill starves the current period | **partially_implemented** | A | code_contract | `contact_fetched_at` is `dict[internalId]` (`state.py:100`); the bundestag.de listing is current-roster-only | Key the TTL by `(internalId, wahlperiode)` | GAP-001 | ✅ |
| **GAP-027** | Two MPs are permanently unenrichable; the "quarantine retries these" claim is false | **partially_implemented** | A | code_contract | `normalise_printed_name` drops middle initials; `portrait_enrichment` logs the miss but never calls `Quarantine.add` | Handle middle initials; route misses to the quarantine | GAP-001 | ✅ |
| **GAP-028** | An empty contact fetch is stamped as success, so the 12 null blocks never retry | **partially_implemented** | A | code_contract | `_load_contacts` stamps on any 200, conflating "no office listed" with "no block at all" | Only stamp when a block parsed; else retry | GAP-001 | ✅ |
| **GAP-029** | abgeordnetenwatch poll/mandate endpoints built, tested, never called | ~~planned_but_absent~~ → **resolved: one wired, one retired** | A | code_contract | Second instance of the `ef687e5` class of bug | ~~Wire `get_mandates` to catch mid-period MPs, or delete~~ — `get_mandates` is wired as a **read-only** roster-freshness check (628/630 join by id, 11 successions found); `iter_polls`/`get_poll_votes`/`parse_votes`/`tally` **deleted** — curated, editorial, unconsumed (api-research §4.3) | — | ✅ |
| **GAP-030** | `Ueberweisung` (committee referral) modelled and fetched, never written | ~~planned_but_absent~~ → **stored; the promise it carried is retired** | A | doc_statement | §3.3 named it "the committee-work signal"; no transform read it | ~~Assess as a partial committee substitute for WP14–20~~ — **it is not one and cannot be**: a referral names a committee and a document, never a member. Stored in `committeeReferrals` as motion-level data; §3.3's claim corrected and historical-coverage.md now says the committee gap stands | GAP-009 | ✅ |
| **GAP-031** | `/rankings` top slots are near-uniformly one Fraktion, with no interpretive note | **partially_implemented** | A | doc_statement | Every other editorial surface carries a caveat; this one does not | Add a caveat note, as `/votes` and `/parties` already do | — | ⚠ i18n |

**Counts — 31 gaps.** By status: implemented_not_populated 1 · buried_in_ui 1 ·
implemented_not_deployed 4 · partially_implemented 16 · planned_but_absent 7 ·
blocked_by_source 1 · stale_plan_superseded 2.
By severity: **critical 1** (GAP-001) · **high 8** (002, 003, 005, 006, 009, 013,
026, 028) · medium 15 · low 7.
By evidence: **A (measured) 24** · B (written plan) 5 · C (inferred) 2.

**Wahlperiode enrichment coverage** (measured, and the clearest symptom of
GAP-026):

| Period | rows | `photoUrl` | `contact` |
|---|---|---|---|
| WP21 | 635 | 0 (was 633) | 0 (was 623) |
| WP20 | 700+ | **0** | **0** |
| WP19 | 700+ | 221 | 215 |

WP20 has no portraits and no contact at all; WP19 is partial and still
backfilling. So even once GAP-001 is repaired, the historical periods stay
unenriched until the TTL is period-scoped.

---

## 2. Contact-data forensics — why Joshua cannot see contact details

### 2.1 The feature exists, at every layer

| Layer | Artefact | State |
|---|---|---|
| Source | `pipeline/src/bundestrack/api/mp_profiles.py` `fetch_contact` | ✅ built |
| Transform | `pipeline/.../transform.py` `contact_enrichment` | ✅ built |
| Sync stage | `pipeline/.../sync.py:382` `_load_contacts` (stage 3) | ✅ wired |
| Schema | `webapp/convex/schema.ts:230-247` | ✅ deployed |
| Query | `mps.getMP` returns the full `mpInput` | ✅ live |
| UI | `webapp/components/mp-profile.tsx:279-360` `Contact` | ✅ live |
| i18n | `webapp/lib/i18n.ts:410-420` + `1921-1928` | ✅ DE + EN |

This is not a missing feature. It renders the contact form link, the homepage,
the Berlin office address, the constituency office and every social profile.

### 2.2 It was populated — until 11:13:56 today

Measured against `whimsical-bandicoot-307` at **10:58 UTC**, before any of this
audit's writes:

| Field | Coverage (of 635 WP21 rows) |
|---|---|
| `contact` non-null | **623** (98.1 %) |
| ↳ `formUrl` | 623 |
| ↳ `homepage` | 543 |
| ↳ `constituencyOffice` | 409 |
| ↳ `socials` non-empty | 562 (**1 702 links**, 29 platforms) |
| `photoUrl` / `photoCredit` | 633 / 633 |

Re-measured at **11:21 UTC**: `contact` **0**, `photoUrl` **0**,
`photoCredit` **0**, `occupation` **0**, `education` **0**. All 635 rows carry
`updatedAt` between `11:13:54.327Z` and `11:13:56.853Z` — one batch write.

The transition was captured independently by a second investigator working in
parallel, which fixes the timeline beyond doubt:

| Time (UTC) | Observation |
|---|---|
| 11:06:10 | Kontakt card **photographed rendering correctly** in production for Bernd Baumann — form link, hint line, homepage, Berlin office, 6 socials |
| 11:11:23 | `contact` already 0, `photoCredit` still 633 — the wipe in progress |
| 11:13:56 | last row written; every enrichment column null |
| 11:19–11:21 | `contact` 0, `photoUrl` 0, `photoCredit` 0, `occupation` 0 |

So the feature was demonstrably working on the live site **eight minutes** into
this audit and was gone twelve minutes later.

### 2.3 Root cause

Three facts combine:

1. **Enrichment rides the roster row.** `transform.mp_payload` writes
   `photoUrl`, `photoCredit`, `education`, `occupation` and `contact` inline
   with the roster, and emits **explicit nulls** when the resolver holds no
   enrichment (`transform.py:225`: "None means the enrich stage did not reach
   this MP … the columns go out as null").
2. **Stage 2 re-posts the roster before stage 3 fills it.** `link_dip_persons`
   (`sync.py:307`) calls `upsert_mps(roster_payloads(resolver))` to patch in the
   DIP crosswalk. That write nulls the enrichment columns, on the documented
   assumption that stage 3 will immediately re-post them.
3. **The TTL starved stage 3.** `_load_contacts` only fetches members whose
   stamp is older than `CONTACT_TTL = 30 days` (`state.py:77`). All 635 entries
   in `pipeline/.bundestrack-state.json` → `contact_fetched_at` are stamped
   **2026-07-29 08:31–08:42 UTC**. Every member was "fresh", so stage 3 fetched
   nothing, the resolver stayed empty, and stage 2's nulls stood.

The state file's `last_run` is `2026-07-29T11:11:58Z` — a WP21 sync finished two
minutes before the blanking write. The TTL that exists to avoid re-reading
280 KB per member is exactly what makes the blanking persist.

**Aggravating factor.** A historical backfill (`bundestrack.cli backfill --wp 19`,
pid 146461, started 09:45 UTC) was running against **production** throughout
this audit, from the main worktree. That is the known "concurrent pipeline runs
clobber" hazard, now realised.

### 2.4 So: which kind of gap is it?

| Candidate | Verdict |
|---|---|
| UI omission | ❌ The card is built, bilingual and correct |
| Query omission | ❌ `getMP` returns `contact` |
| Ingest omission | ❌ Stage 3 is wired and had populated 623 rows |
| **Production-data problem** | ✅ **This is it** |
| Source-coverage problem | ⚠ Partly — 12 members genuinely have no block, and **email/phone do not exist at all** |
| Discoverability | ✅ **Also true** — see GAP-002 |

### 2.5 Email and phone: genuinely impossible

> **Superseded in part, 2026-07-31.** The conclusion below — do not implement a
> per-member email or phone field — was re-tested at scale and **stands**: 110
> biography pages (60 consecutive + every 13th of all 639) carry zero addresses
> and zero numbers, and the full 15.3 MB Stammdaten dump contains one `@`.
>
> Two claims in this section were nevertheless **wrong as written**, and are
> corrected in docs/api-research.md §6.6:
>
> 1. *"the Bundestag publishes none"* is too broad. It publishes its own
>    switchboard (`+49 (0)30 227-0`) on its imprint, and **69.8 %** of members'
>    officially linked websites carry an `@bundestag.de` address. The accurate
>    claim is about the **member directory**, not the parliament.
> 2. The German copy quoted approvingly below was therefore factually false and
>    has been rewritten in both locales. The switchboard is now printed on the
>    card as an institutional constant, beside the Berlin address.
>
> The linked member sites are still **not** ingested: their addresses are
> ambiguous between member, constituency office and named staffers, some are
> ROT13-obfuscated against collection, and a sweep also picks up party and
> vendor addresses. See §6.6 for the numbers.

`MDB_STAMMDATEN.DTD` declares no contact elements, and the biography pages
carry zero `mailto:` and zero `tel:` links (established in commit `429ae2d`).
The Bundestag publishes a **contact form** instead, which is what `formUrl`
holds, and `mp-profile.tsx:304` prints a line saying so
(*"Der Bundestag veröffentlicht keine E-Mail-Adressen."*).

The plan asked for "clickable email link, phone (if available)". The honest
answer is that neither is available. The schema comment
(`schema.ts:220-226`) makes the case that an `email` field would "read as one
the pipeline had failed to fill" — that reasoning is sound and should stand.
**Recommendation: do not implement GAP-004.**

**But the explanation does not reach the reader who needs it.** The site states
the fact honestly in two places — `/about` carries *"Private Kontaktdaten sind
nicht enthalten — der Bundestag veröffentlicht keine."*, and the card's own hint
line says the same — yet **both are inside the card or on another page**. On the
12 members with no block (and on all 635 while the wipe stands), the profile is
simply *silent*: `grep "E-Mail-Adressen"` on Habeck's live page returns **0**.
A citizen looking for how to write to their MP gets nothing, and cannot tell an
absent source from a broken pipeline. That is GAP-003's real user impact, and it
is fixable independently of GAP-001.

### 2.6 Discoverability (GAP-002), measured

Playwright, production, full-page:

| Viewport | Page height | "Kontakt" heading offset | Scrolls to reach |
|---|---|---|---|
| Desktop 1440×900 | 4 484 px | **1 492 px** | ~1.66 viewports |
| Mobile 390×844 | 7 254 px | **1 385 px** | ~1.64 viewports |

On mobile the single-column grid stacks the whole sidebar first, so contact sits
below the portrait *and* the biography before the activity data begins. Nothing
in the page header hints it exists.

---

## 3. What is actually fine

Being skeptical cuts both ways. These were checked and are genuinely complete:

- **All specialist features from the brief are real, with tests**: dissent
  (`lib/dissent.ts`, period-wide tallies), quorum (`lib/inquiry.ts`,
  `/inquiry-quorum`), own-resources votes (`lib/own-resources-votes.ts`,
  `/votes/own-resources`), lame-duck (`lib/lame-duck.ts`), term normalisation
  (`lib/tenure.ts`), mandate badges (`components/mandate-badge.tsx`), written
  questions (panel in `mp-recent-records.tsx`), methodology (`/about`, 7
  sections including limits and blind spots).
- **Committee events are no longer zero.** All seven event types return rows in
  production — the defect Wave 6/Wave 8 both name is fixed.
- **i18n is clean**: 781 DE keys, 781 EN keys, **zero** missing either way; no
  component references an undefined key.
- **Tests pass**: 256/256 Python; 551/556 JS (the 5 failures were the
  `_generated` bootstrap issue, GAP-014 — since fixed: a clean checkout now runs
  the whole suite green).
- **Nav is complete** — every route is reachable from the navigation.
- **Locale default is correct**: a `de-DE` browser gets German (`html lang="de"`).
- **All 13 routes return HTTP 200** and render content.
- **Prod runs current `main`** — the post-#39 feed validators answer correctly.
- **No fabricated ballots**: all 68 WP21 sheets carry a real `sourceUrl`.
- **"Procedural clock" is not a gap** — it appears in no plan, commit, or file.
  It is an aspirational idea and should not be built on the strength of this
  audit (GAP-025).

---

## 4. Implementation waves

Independent work only within a wave. **Shared hot files** are flagged: any
branch touching `webapp/lib/i18n.ts`, `webapp/convex/schema.ts` or
`webapp/lib/navigation.ts` must be sequenced, not merged in parallel.

### Wave A — restore the promise (do first, alone)

**A1 · GAP-001 — repopulate enrichment in production** · *critical*
- Confirm no pipeline process is running (`pgrep -f bundestrack`); the WP19
  backfill was live during this audit.
- Re-run enrichment ignoring the TTL (the backfill path does this —
  `sync.py:1059`), or clear `contact_fetched_at` in
  `pipeline/.bundestrack-state.json` first. **Do not simply re-run `sync`** — it
  reproduces the blanking.
- **Verify:** `contact` ≥ 620/635, `photoUrl` ≥ 630/635 via
  `mps:getMPs` against `whimsical-bandicoot-307`; a real profile shows the
  Kontakt card and a portrait.

**A2 · GAP-001 (structural) — stop the roster re-post from blanking enrichment**
- Either omit enrichment keys from the payload when the resolver holds none (so
  the upsert patches rather than clears), or have stage 2 skip the enrichment
  columns entirely.
- **Verify:** a `sync` with every member inside the TTL leaves coverage
  unchanged. Add a regression test — this is the second time this class of bug
  has shipped (cf. `ef687e5`).

**A3 · GAP-005 + GAP-016 — install the cron, correct the README**
- Install `scripts/daily-sync.sh`; correct `README.md:79`.
- **Verify:** `.logs/daily-sync.log` exists and grows; `last_run` advances daily.

### Wave B — contact quality (after A1; B-items parallel)

- **B1 · GAP-002** — promote the Kontakt card (top of sidebar, or its own
  column). *Touches `mp-profile.tsx`.* **Verify:** heading offset < 800 px on
  both viewports.
- **B2 · GAP-003 + GAP-027 + GAP-028** — stop stamping an empty fetch as
  success, route unmatched names to the quarantine, and handle middle initials
  (`Philip M. A. Hoffmann`, `Alexis L. Giersch` are unenrichable today). Render
  an honest empty state where the source really has nothing. **Verify:**
  coverage rises above 623/635, or the card explains the absence.
- **B4 · GAP-026** — key `contact_fetched_at` by `(internalId, wahlperiode)`.
  **Verify:** a WP19 backfill no longer marks WP21 members fresh; WP20 gains
  portraits.
- **B3 · GAP-011** — cherry-pick `7e48f4a`'s occupation column; fix
  `seat-tooltip.tsx:115` to prefer `occupation`. **Verify:** occupation on
  table, tooltip and profile.

### Wave C — make invisible work visible (⚠ sequence i18n)

- **C1 · GAP-007 + GAP-006 + GAP-008** — build `/settings`, the follow button
  and the follow list, wiring the four dead `userPreferences` functions.
  *⚠ i18n + navigation.* **Verify:** a signed-in user follows an MP and sees it
  persist.
- **C2 · GAP-009** — add a Wahlperiode selector; wire `getMPMandates`.
  *⚠ i18n + navigation.* **Verify:** `/mps` and `/rankings` show WP19/WP20 data
  that is already live.
- **C3 · GAP-012** — triage the 19 uncalled functions: wire or delete.
- **C4 · GAP-017** — decide on `/motions`. *⚠ i18n + navigation.*

### Wave D — engineering hygiene (fully parallel) — ✅ **done, except D4**

Landed on branch `engineering-hygiene-gaps`.

- ~~**D1 · GAP-013**~~ — ✅ `.github/workflows/ci.yml`: codegen check, `pixi run
  lint`, `typecheck`, `test`, then a production-equivalent build with
  placeholder Convex URLs and no deploy key. It adds no gate of its own, so CI
  and local cannot drift.
- ~~**D2 · GAP-014**~~ — ✅ `webapp/convex/_generated/` and
  `convex/betterAuth/_generated/` are committed, because `bunx convex codegen`
  cannot rebuild them without a deployment it has access to (Convex's own CLI
  says to commit them). `pixi run check-codegen` guards the one way they drift
  offline. A clean checkout now typechecks and runs 621/621 JS tests.
  - Removed `convex/` at the **repo root** while here: five generated files
    committed by accident in `f19eead`, imported by nothing, and already stale
    against the schema by five modules.
- ~~**D3 · GAP-015**~~ — ⚠ **doc half only.** The README no longer claims GitHub
  OAuth works. **The OAuth app is still unregistered and GitHub sign-in still
  does not work** — no credentials were touched.
- **D4 · GAP-022** — `/seating` hydration error: seen once in four loads and not
  reproduced in three further runs. Watch for recurrence before spending on it.
  *Still open — deliberately not investigated.*
- ~~**D5 · GAP-023 / GAP-024**~~ — ✅ the `/sign-in` comment now describes the
  symptom that route actually has; `voteSheets` is inside `purgeSeedData`, whose
  `done` and whose `seedDataPresent` counterpart now answer for ballots as well
  as mandates. Nine focused tests on `isSyntheticVoteSheet`.
- Fixed in passing, because it blocked D1: `mp-card.tsx:316` carried an
  `aria-label` on a bare `div`, which assistive tech drops — so the score was
  announced unlabelled, the opposite of what the comment beside it claimed.
  Biome had been failing on it, which is why `pixi run lint` was red on `main`
  and no CI gate could have been green on arrival.

### Wave E — scoped features (each needs a decision first)

- **E1 · GAP-010** — index `mps.occupation`/`profession`, or narrow the claim.
  Live proof of the gap: `lawyer` → **0** results, `Rechtsanwalt` → **5**.
- **E2 · GAP-021** — store `WKR_LAND`; needs a roster backfill.
- **E3 · GAP-019** — the sixth trend chart.
- ~~**E4 · GAP-018**~~ — ✅ the source was confirmed before any code, and it
  exists: `Erklärung nach § 31 GO-BT` is published as a DIP `/aktivitaet`
  carrying `person_id`, the procedure, and a page-anchored link into the
  protocol PDF — 100 % on all three across every sitting sampled. Ingested into
  `voteExplanations` with provenance. **The declaration's text is not stored and
  is never generated**: DIP publishes that one exists and where it is printed,
  not the words, and composing them would put reasoning in a named member's
  mouth. Sparse by nature (21/90: 3 of 8 ballots; 21/88: none), so the query
  contract separates "none was filed" from "not ingested".
  Found in passing: the activity kind this repo matched on was **wrong** —
  `§ 31 GO BT` matches nothing; DIP returns `§ 31 Geschäftsordnung BT`.
- **E5 · GAP-020** — opposition adjustment and productivity metrics. Both are
  **editorially loaded** and sit uneasily with the project's "no subjective
  scoring" principle. Recommend an explicit product decision before any code.
- ~~**E6 · GAP-029**~~ — ✅ resolved as two opposite decisions, each on evidence.
  `get_mandates` is **wired**, as a read-only roster-freshness check rather than
  a writer: it resolves 628/630 WP21 mandates to the roster *by id*
  (`politician.id` → `ext_id_bundestagsverwaltung`, no name matching) and
  surfaces the 11 mid-period successions with their published dates and notes.
  It adds nobody and, deliberately, removes nobody — Stammdaten is the roster.
  `iter_polls`, `get_poll_votes`, `parse_votes` and `tally` are **deleted**: 63
  curated polls against ~1 015 official ballots, adding volunteer prose and
  restatements of DIP fields, consumed by nothing.
- ~~**E7 · GAP-030**~~ — ✅ assessed, and the answer is **no**. `Ueberweisung`
  cannot be a committee signal for WP14–20, and not because of coverage: a
  referral names a committee and a *document*, carries no person, and has no
  field from which one could be derived. The coverage doc was right that the
  historical committee metric is impossible; §3.3's "the committee-work signal"
  was the overstatement. Referrals are now stored as motion-level data in their
  own table, with the boundary asserted structurally rather than by comment.
- **E8 · GAP-031** — add a caveat note to `/rankings`, matching `/votes` and
  `/parties`. *⚠ i18n.*

---

## 5. Method and limits

- Production Convex was queried **read-only** (`/api/query` only); no mutation
  was issued and no production data was modified by this audit.
- Live pages were driven with Playwright at 1440×900 and 390×844.
- Counts come from `mps:getMPs`, `feed:getFeed`, `stats:getChamberStats`,
  `activityScores:getRankings` and `search:searchMPs` against
  `whimsical-bandicoot-307`.
- **Limits.** Row counts for tables without a public read query
  (`voteRecords`, `activities`, `motionSponsors`) could not be measured
  directly. WP19 was still being backfilled during the audit, so its numbers are
  a moving target. `bunx convex function-spec --prod` needs credentials this
  worktree does not hold, so "deployed == main" was inferred from live query
  behaviour rather than read from the deployment.
