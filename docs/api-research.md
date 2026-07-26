# Bundestag Open Data — API Reference Research

> Research document for the Bundestrack data pipeline. Every claim below was
> verified with a live HTTP request or by reading an official schema file on
> **2026-07-26**, unless explicitly marked as unverified. Where something does
> *not* exist, that is stated as a finding rather than left silent.

---

## 0. Executive summary — what a pipeline engineer needs to know first

There is no single API that answers "what did this MP do?". Bundestrack must
combine **four independent sources**, and the hardest problem is not fetching
them — it is **joining them**, because they use three mutually incompatible MP
identifier spaces.

| # | Source | Gives you | Auth | Format |
|---|--------|-----------|------|--------|
| 1 | **DIP API** `search.dip.bundestag.de/api/v1` | Vorgänge, Drucksachen, Aktivitäten, Personen, protocol metadata | API key | JSON / XML |
| 2 | **Plenary protocol XML** `dserver.bundestag.de/btp/...` | Speaker-attributed speeches, **and** roll-call vote name lists | none | XML |
| 3 | **Named-vote XLSX** `bundestag.de/resource/blob/...` | Per-MP yes/no/abstain/**absent** | none | XLSX |
| 4 | **MdB-Stammdaten XML** (ZIP) | MP biography, mandates, Wahlkreis, committees | none | XML |

Optional fifth source: **abgeordnetenwatch.de API v2** (community-run, CC0,
no key) — per-MP votes as clean JSON with stable IDs.

### The five things most likely to bite you

1. **Three ID spaces, no shared key.** DIP `/person` id (`1013`), Stammdaten
   `<MDB><ID>` (`11004011`), and the vote sheets (**no ID column at all**).
   See §7 — this is the central modelling constraint.
2. **A bot-protection WAF (Enodia) IP-blocks concurrent requests.** Fetch
   strictly sequentially. See §2.6.
3. **Seating-position data does not exist** in any official machine-readable
   form. See §9.
4. **`/plenarprotokoll-text` gives a flat text blob, not per-speech records.**
   Structured speeches only come from the protocol XML. See §5.
5. **Committee membership in Stammdaten exists only for the *current*
   Wahlperiode.** Historical committee work is not in the dump. See §6.4.

---

## 1. The DIP API — identity and provisioning

**Base URL:** `https://search.dip.bundestag.de/api/v1`

**Spec version 1.5**, OpenAPI 3.0.1. Title: *"Deutscher Bundestag - DIP"*
(Dokumentations- und Informationssystem für Parlamentsmaterialien).

### 1.1 The spec is public and unauthenticated — use it as ground truth

```bash
curl https://search.dip.bundestag.de/api/v1/openapi.yaml   # 200, ~82 KB, no key needed
```

This is the authoritative schema source. It is worth vendoring a copy into the
repo, because it also solves the key problem below.

### 1.2 API key

Keys are issued by the *Parlamentsdokumentation*
(`parlamentsdokumentation@bundestag.de`), documented at
`https://dip.bundestag.de/über-dip/hilfe/api`.

**A working public key is published inside the spec itself**, in
`components.securitySchemes.ApiKeyHeader.description`. As of 2026-07-26:

```
R2BZaee.DjdCyihKZMf8AOjtScubP2EVydegzjmBIQ
```

Verified working: `GET /person` → `200`, `numFound: 5623`.

Bundestag rotates this published key roughly annually. Older keys that circulate
in blog posts and GitHub repos are **expired** — all of these returned `401`:

| Key | Status |
|-----|--------|
| `I9FKdCn.hbfefNWCY336dL6x62vfwNKpoN2RZ1gp21` | 401 expired |
| `N4cnScSD.uKRlqfCXsBaOKUsdRp2N1Gp8h4kTGx` | 401 expired |
| `rgsMgGSvOuFwzNNJntdGYUpPmmnyNGUdZWO` | 401 expired |

> **Recommendation:** do not hardcode the key. Read it from
> `BUNDESTAG_API_KEY` env var, and on `401` re-fetch `openapi.yaml` and parse
> the current key out of the securityScheme description as a self-healing
> fallback.

### 1.3 Passing the key

Two mechanisms are documented:

```bash
# Query parameter — VERIFIED WORKING
curl "https://search.dip.bundestag.de/api/v1/person?apikey=$KEY&format=json"

# Header — documented in spec, returned 401 in testing
curl -H "Authorization: ApiKey $KEY" "https://search.dip.bundestag.de/api/v1/person"
```

**Use the query parameter.** The header form is specified as
`Authorization: ApiKey <key>` but did not authenticate successfully in testing.

### 1.4 Error taxonomy

| Status | Meaning | Body |
|--------|---------|------|
| `400` | Syntax error in a request parameter | `{"code":400,...}` |
| `401` | Missing/invalid/expired key | `{"code":401,"message":"An API key is required to access this service..."}` |
| `404` | Entity not found | `{"code":404,"message":"ID not found: 11004011"}` |
| `303` | **WAF challenge — not a real redirect.** See §2.6 | empty body, `Location: /.enodia/challenge?redirect=...` |

---

## 2. Transport mechanics

### 2.1 Endpoints

16 endpoints — 8 collections, each with an `/{id}` sibling.

| Path | Operation | Returns |
|------|-----------|---------|
| `/vorgang` · `/vorgang/{id}` | `getVorgangList` · `getVorgang` | Legislative procedures |
| `/vorgangsposition` · `/{id}` | `getVorgangspositionList` | Procedure steps (incl. votes, committee referrals) |
| `/drucksache` · `/{id}` | `getDrucksacheList` | Printed papers (metadata) |
| `/drucksache-text` · `/{id}` | `getDrucksacheTextList` | Printed papers **with full text** |
| `/plenarprotokoll` · `/{id}` | `getPlenarprotokollList` | Plenary protocols (metadata) |
| `/plenarprotokoll-text` · `/{id}` | `getPlenarprotokollTextList` | Plenary protocols **with full text** |
| `/aktivitaet` · `/{id}` | `getAktivitaetList` | **Per-MP activity records** |
| `/person` · `/{id}` | `getPersonList` · `getPerson` | Person master data |

All are `GET` only. There are no write operations.

### 2.2 Pagination — the cursor contract

Every list response is:

```json
{ "numFound": 803, "cursor": "AoJwkJLRxJ8DK1BlcnNvbi04MDc2", "documents": [ ... ] }
```

- **Page size is 100** and is **not configurable** — there is no `limit`/`rows`
  parameter in the spec.
- The cursor is an **opaque base64-ish token**, not an offset. Do not construct
  or decode it.

**Termination rule** (from the spec's own `Cursor` description, and confirmed
empirically): repeat the request with all original parameters plus
`cursor=<cursor from last response>`, and stop **when the cursor stops
changing**. The last page returns the *same* cursor you sent.

> **Critical:** do NOT terminate on `len(documents) == 0`, and do NOT terminate
> on `documents < 100`. The correct and only reliable condition is
> `new_cursor == previous_cursor`.

```python
def paginate(endpoint, params, key):
    cursor = None
    while True:
        p = {**params, "apikey": key, "format": "json"}
        if cursor:
            p["cursor"] = cursor
        r = httpx.get(f"{BASE}/{endpoint}", params=p, timeout=60).json()
        yield from r["documents"]
        if r["cursor"] == cursor:      # cursor stopped changing -> done
            break
        cursor = r["cursor"]
```

### 2.3 Response formats

`format=json` (default) or `format=xml`, per the `Format` parameter enum.
Both serve the identical schema; the XML root element is `<document>` for
single entities. JSON is recommended.

### 2.4 Filter parameters

`f.`-prefixed. Repeating a parameter combines values — **but the boolean
semantics differ per parameter**, which is easy to get wrong:

| Semantics | Parameters |
|-----------|-----------|
| **OR** (repeat = union) | `f.wahlperiode`, `f.vorgangstyp`, `f.beratungsstand`, `f.dokumentnummer`, `f.id`, `f.person`, `f.frage_nummer`, `f.titel`, `f.vorgangstyp_notation` |
| **AND** (repeat = intersection) | `f.urheber`, `f.deskriptor`, `f.sachgebiet`, `f.initiative` |

The spec explicitly notes that an OR-search over multiple `f.urheber` /
`f.deskriptor` / `f.sachgebiet` / `f.initiative` values **is not possible in a
single request** — issue separate requests and union client-side.

#### Endpoint × parameter matrix

| Parameter | vorgang | vorgangsposition | drucksache(-text) | plenarprotokoll(-text) | aktivitaet | person |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| `f.aktualisiert.start/.end` | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| `f.datum.start/.end` | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| `f.wahlperiode` | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| `f.id` | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| `f.zuordnung` | — | ✔ | ✔ | ✔ | ✔ | — |
| `f.person` / `f.person_id` | — | — | — | — | ✔ | ✔ / — |
| `f.dokumentnummer` | ✔ | ✔ | ✔ | ✔ | ✔ | — |
| `f.drucksachetyp` | ✔ | ✔ | ✔ | — | ✔ | — |
| `f.vorgangstyp` | ✔ | ✔ | ✔ | ✔ | ✔ | — |
| `f.urheber` | ✔ | ✔ | ✔ | — | ✔ | — |
| `f.deskriptor` / `f.sachgebiet` | ✔ | — | — | — | ✔ | — |
| `f.beratungsstand` | ✔ | — | — | — | — | — |
| `f.vorgang` | — | ✔ | — | — | — | — |
| `f.vorgangsposition_id` | — | — | — | — | ✔ | — |
| `f.aktivitaet` | — | ✔ | — | — | — | — |

`f.zuordnung` enum: **`BT`** (Bundestag), `BR` (Bundesrat), `BV`
(Bundesversammlung), `EK` (Europakammer).

### 2.5 Incremental sync

`f.aktualisiert.start` / `f.aktualisiert.end` are `date-time` (ISO 8601 with
offset, e.g. `2026-07-01T00:00:00+02:00`), filtering on **last modification**.
`f.datum.start` / `.end` filter on **document date** instead.

For a daily sync, always use `f.aktualisiert.start` — documents get amended
retroactively, and a `datum`-based sync would miss those edits.

### 2.6 Rate limiting and the Enodia WAF — READ THIS

There are no `X-RateLimit-*` headers. Instead, **all `*.bundestag.de` hosts sit
behind an "Enodia" bot-protection layer**:

```
HTTP/2 303
location: /.enodia/challenge?redirect=%2Fapi%2Fv1%2Fdrucksache%3F...
```

Observed during this research: running ~6 concurrent agents against the API
tripped the challenge within minutes and then **IP-blocked every bundestag.de
host at once** — `search.dip`, `dip`, `www`, and `dserver` — including the
unauthenticated `openapi.yaml`. It later escalated from 303s to outright
connection timeouts, and did not clear across repeated backoffs of 20 s → 90 s →
4 min over roughly an hour.

Independently, a *single* sequential worker also tripped it after only a few
dozen requests (including two 6.8 MB `-text` pulls) — **well inside any
published limit**. So this is not purely a concurrency guard; total bytes and
request rate both matter.

Further characteristics: the challenge serves a JavaScript proof-of-work page
(`<title>Enodia Verification</title>`, `sha256.js`). It is **IP-scoped, not
key-scoped** — hosts sharing the `46.243.122.*` prefix blocked together while
`webtv.bundestag.de` (`46.18.247.52`) stayed reachable. A browser `User-Agent`
does not bypass it, and it is unrelated to cursor state.

**Pipeline requirements:**

- Fetch **strictly sequentially**. No thread pools, no `asyncio.gather` fan-out.
- Insert a deliberate delay between requests (~0.5–1 s is polite).
- **Never use `curl -L` / `follow_redirects=True`.** A 303 would silently follow
  into a challenge page and you would parse an HTML error as data.
- Treat `303` + `Location` containing `/.enodia/` as *"backed off"* — pause with
  exponential backoff and retry, do not count it as a failure or a redirect.

```python
r = httpx.get(url, params=p, follow_redirects=False, timeout=60)
if r.status_code == 303 and "/.enodia/" in r.headers.get("location", ""):
    raise RateLimited("Enodia challenge — back off and retry")
```

> **Diagnostic tell:** a client that *does* follow the redirect receives an HTML
> challenge page where it expects JSON, and fails with the confusing
> `JSONDecodeError: Expecting value: line 1 column 1 (char 0)`. If you see that
> error, you are being challenged — not receiving malformed data.

Make the pipeline **resumable**, persist `pdf_hash`/`xml_hash` to avoid
re-fetching unchanged documents, and prefer compact metadata endpoints over the
multi-megabyte `-text` pages.

---

## 3. Vorgänge, Vorgangspositionen & Drucksachen

*(Section populated from the fleet's verified findings — see §12 for the
per-endpoint field reference.)*

### 3.1 The data model

```
Vorgang  (a legislative procedure, e.g. one bill)
  └── Vorgangsposition  (one step in it: 1st reading, committee referral, vote)
        ├── Fundstelle       -> the document (Drucksache or Plenarprotokoll)
        ├── Ueberweisung[]   -> committee referrals (with federfuehrung flag)
        ├── Beschlussfassung[] -> the decision taken (incl. vote type)
        └── Aktivitaet[]     -> per-MP actions attached to this step
```

### 3.2 `Beschlussfassung` — vote metadata, but NOT per-MP votes

```yaml
beschlusstenor:            string   # e.g. "Annahme der Vorlage"
abstimmungsart:            enum     # see below
abstimm_ergebnis_bemerkung: string
mehrheit:                  enum ["Absolute Mehrheit", "Zweidrittelmehrheit"]
grundlage, dokumentnummer, seite: string
```

`abstimmungsart` enum (complete): `Abstimmung durch Aufruf der Länder`,
`Geheime Wahl`, `Hammelsprung`, **`Namentliche Abstimmung`**, `Verhältniswahl`.

> **Negative finding:** `Beschlussfassung` tells you *that* a named vote
> happened and what the outcome was. It contains **no individual MP votes**.
> Filtering `abstimmungsart == "Namentliche Abstimmung"` is the right way to
> *discover* roll-call votes in DIP, but the per-MP data must come from §4.

### 3.3 `Ueberweisung` — the committee-work signal

```yaml
ausschuss:        string   # "Ausschuss für Gesundheit"
ausschuss_kuerzel: string
federfuehrung:    boolean  # true = lead committee
ueberweisungsart: string
```

### 3.4 Drucksache authorship

`autoren_anzeige[]` carries **real DIP person IDs**:

```yaml
autoren_anzeige:
  - id:          "546"                                  # DIP /person id
    title:       "Kai Gehring, MdB, BÜNDNIS 90/DIE GRÜNEN"
    autor_titel: "Kai Gehring"
autoren_anzahl: 4
```

> **Trap:** `autoren_anzeige` has **`maxItems: 4`** — it is only "the first 4
> authors marked for display". `autoren_anzahl` gives the true total. For a
> motion with 40 co-signatories you get 4 IDs and `autoren_anzahl: 40`.
> **Do not compute per-MP authorship counts from `autoren_anzeige` alone** — it
> systematically under-counts. Prefer `/aktivitaet`, which emits one record per
> MP per document (see §3.5).

Same `maxItems: 4` truncation applies to `vorgangsbezug[]` (use
`vorgangsbezug_anzahl`).

### 3.5 `/aktivitaet` — the per-MP activity feed

This is the endpoint Bundestrack's activity score should be built on. One
record per MP per action, and it carries `person_id` directly.

Real record (WP21):

```json
{
  "id": "1793259",
  "aktivitaetsart": "Kleine Anfrage",
  "typ": "Aktivität",
  "person_id": "8004",
  "dokumentart": "Drucksache",
  "wahlperiode": 21,
  "datum": "2026-07-24",
  "aktualisiert": "2026-07-24T12:03:00+02:00",
  "titel": "Jeanne Dillschneider, MdB, BÜNDNIS 90/DIE GRÜNEN",
  "vorgangsbezug_anzahl": 1,
  "vorgangsbezug": [ { "id": "337602", "vorgangstyp": "Kleine Anfrage", "titel": "..." } ],
  "fundstelle": {
    "pdf_url": "https://dserver.bundestag.de/btd/21/073/2107327.pdf",
    "dokumentnummer": "21/7327", "datum": "2026-07-24",
    "dokumentart": "Drucksache", "drucksachetyp": "Kleine Anfrage",
    "herausgeber": "BT", "urheber": ["Fraktion BÜNDNIS 90/DIE GRÜNEN"]
  }
}
```

- `numFound` for `f.wahlperiode=21`: **80 537** (as of 2026-07-24).
- `person_id` is the **DIP** person id — joins to `/person/{id}` directly.
- Query one MP's whole activity: `/aktivitaet?f.person_id=<id>&f.wahlperiode=21`.
- **Note `titel` is the person's name**, not a description of the action — the
  document title is in `vorgangsbezug[].titel`.

---

## 4. Namentliche Abstimmungen (roll-call votes) — the priority area

Per-MP vote data is **not in the DIP API** (§3.2). There are three routes to it,
and they cross-validate exactly.

### 4.1 Route A — official XLSX data sheets (authoritative, the only one with absences)

**Discovery via the paginated AJAX endpoint** backing
`https://www.bundestag.de/parlament/plenum/abstimmung/liste`:

```bash
curl "https://www.bundestag.de/ajax/filterlist/de/parlament/plenum/abstimmung/liste/462112-462112?limit=30&noFilterSet=true&offset=0"
```

Returns an HTML fragment. Params: `limit`, `offset`, `noFilterSet=true`, plus
date filters (`date` start/end fields, default range from `1949-09-01`).

Observed: **~1 015 entries total**; offsets ≥ ~1 015 return a ~1 KB empty
fragment. Each entry links a PDF and (for recent votes) an XLSX:

```
https://www.bundestag.de/resource/blob/1194616/20260710_8-xls.xlsx
https://www.bundestag.de/resource/blob/1194614/20260710_8.pdf
```

The blob ID is opaque — you must scrape the list to discover URLs; they are not
derivable from date/session numbers.

**Coverage boundary (verified by bisection):** machine-readable sheets exist
back to roughly **WP17 (2012/2013)**. Older entries — the tail of the list,
reaching back to **WP16 (2007–2009)** — are **PDF-only**. A backfill earlier
than ~2012 requires PDF parsing or route C.

#### Column schema (verified)

Sheet name encodes the vote: `A_Export_Fraktionen_21_90_8` = WP 21, sitting 90,
vote 8.

| Col | Name | Notes |
|-----|------|-------|
| 0 | `Wahlperiode` | 21 |
| 1 | `Sitzungnr` | 90 |
| 2 | `Abstimmnr` | 8 — `(WP, Sitzungnr, Abstimmnr)` is the natural key |
| 3 | `Fraktion/Gruppe` | short form: `CDU/CSU`, `BÜ90/GR`, `Die Linke`, `Fraktionslos` |
| 4 | `Name` | surname, may include `ORTSZUSATZ`: `Brand (Fulda)` |
| 5 | `Vorname` | |
| 6 | `Titel` | ⚠ **name particles** (`von`, `van`, `de`), *not* academic titles |
| 7–11 | `ja`, `nein`, `Enthaltung`, `ungültig`, `nichtabgegeben` | **one-hot `0`/`1`** |
| 12 | `Bezeichnung` | display name |
| 13 | `Bemerkung` | e.g. `gesetzlicher Mutterschutz` |

**Vote encoding is one-hot across five columns**, verified: every one of 630 rows
had exactly one flag set. `nichtabgegeben` = *did not vote* (absent), which is
distinct from `Enthaltung` = *abstained*.

```python
VOTE_COLS = {"ja": "yes", "nein": "no", "Enthaltung": "abstain",
             "ungültig": "invalid", "nichtabgegeben": "absent"}
```

> **There is no MP ID column.** Joining requires name matching — see §7.

Parsed with `openpyxl` (`pip install openpyxl`); `pandas` is not required.

### 4.2 Route B — vote name lists embedded in the protocol XML

The plenary protocol XML **also contains the full roll-call name lists**, in the
appendix, as a flat `<p klasse="...">` sequence:

```xml
<p klasse="AL_Vorspann_1">Endgültiges Ergebnis</p>
<p klasse="AL_Vorspann_2">Abgegebene Stimmen:	606;</p>
<p klasse="AL_Vorspann_3">ja:	318</p>
<p klasse="AL_Vorspann_3">nein:	284</p>
<p klasse="AL_Vorspann_3">enthalten:	4</p>
<p klasse="AL_Ja-Nein-Enth">Ja</p>
<p klasse="AL_Partei">CDU/CSU</p>
<p klasse="AL_Namen">Knut Abraham</p>
<p klasse="AL_Namen">Anna Aeikens</p>
...
```

Parse as a state machine: `AL_Vorspann_1` starts a new vote block,
`AL_Ja-Nein-Enth` sets the current vote value, `AL_Partei` sets the current
party, and each `AL_Namen` is one MP.

Verified on protocol 21/90: **8 vote blocks, 4 736 name entries**, tallies
matching the header counts exactly.

**Cross-validation against the XLSX for the same vote (WP21 sitting 90, vote 8):**

| | Ja | Nein | Enthalten | nichtabgegeben |
|---|---|---|---|---|
| XLSX | 519 | 43 | 0 | 68 |
| Protocol XML | 519 | 43 | 0 | *(not listed)* |

> **Key limitation:** the XML lists only MPs who **cast** a vote. Absences
> (`nichtabgegeben`) are **not** recoverable from the XML — only the XLSX (or
> route C) has them. Names here are full display names (`Dr. Reza Asghari`),
> not split into surname/given name.
>
> **Parsing trap:** party labels contain **non-breaking spaces** —
> `'BÜNDNIS\xa090/ DIE GRÜNEN'`. Normalise `\xa0` → space before matching.

Route B is valuable because it covers every sitting for which XML exists, with
no scraping of blob URLs.

### 4.3 Route C — abgeordnetenwatch.de API v2 (community, CC0, no key)

```bash
curl "https://www.abgeordnetenwatch.de/api/v2/polls/6606?related_data=votes"
```

Returns all 630 per-MP votes in one JSON response:

```json
{ "id": 665215, "vote": "yes", "reason_no_show": null,
  "mandate": { "id": 68376, "label": "Sanae Abdi (Bundestag 2025 - 2029)" },
  "fraction": { "id": 425, "label": "SPD (Bundestag 2025 - 2029)" } }
```

`vote` values: `yes`, `no`, `abstain`, `no_show`. Plus a structured
`reason_no_show` (e.g. `maternity_protection`).

**Independent cross-validation** of the same vote — matches the official XLSX
exactly, *including* absences and the maternity-protection annotation:

| | yes | no | no_show |
|---|---|---|---|
| abgeordnetenwatch | 519 | 43 | 68 |
| Official XLSX | 519 | 43 | 68 |

- Licence **CC0 1.0**, no API key, API version 2.9.0.
- Bundestag legislature period IDs: **WP21 = 161**, WP20 = 132, WP19 = 111,
  WP18 = 97, WP17 = 83, WP16 = 67 (coverage back to 2005).
- WP21 poll count: **63** — note this is a *curated* set and its scope differs
  from the ~1 015 official named votes; do not assume 1:1.
- Provides **stable numeric IDs** (`politician.id`, `mandate.id`), which the
  official vote sheets lack entirely.

> Being community-run, it should be treated as a convenience/validation source,
> not the system of record. The official XLSX (route A) is authoritative.

### 4.4 Non-named votes

Most Bundestag votes are shows of hands and are recorded only as an aggregate
outcome in `Beschlussfassung.beschlusstenor` / the protocol text. **No per-MP
data exists for these at all** — only ~1 015 votes in the Bundestag's entire
history are recorded by name. Any "voting participation" metric must be scoped
to named votes only, and this should be stated in the UI.

---

## 5. Plenarprotokolle & speech data

### 5.1 What the DIP API gives you

- `/plenarprotokoll` — metadata. WP21 + `f.zuordnung=BT`: **90 documents**.
- `/plenarprotokoll-text` — same plus a `text` field.

> **Negative finding:** `plenarprotokoll-text.text` is a **single flat string of
> the entire sitting** (measured range across 10 WP21 protocols: **445 574 –
> 843 669 characters**, mean ~659 000). It is *not* segmented by speaker. There
> is **no endpoint returning structured, speaker-attributed speeches.** For
> per-MP speech metrics you must parse the XML (§5.2).

#### Quantified: why you must not regex the flat text

Naive speaker-label segmentation of the flat text, compared against the XML
ground truth for the same protocol (21/90):

| | XML ground truth | Flat-text regex |
|---|---|---|
| Speakers found | 108 | 89 (**35 missed**) |
| Total words | 62 097 | 95 358 (**+53.6 % inflated**) |

The inflation is interjections and presidential text wrongly attributed to the
previous speaker. The misses are ministers, whose label reads
`Nina Warken, Bundesministerin für Gesundheit:` with no `(Fraktion)` suffix.

#### ⚠ The `-text` endpoint pages at 10, not 100

Measured: `/plenarprotokoll` returns **100 docs/page** (~137 KB), while
`/plenarprotokoll-text` returns only **10 docs/page** — but at **~6.8 MB per
page**. A full WP21 BT pull via `-text` is 9 pages ≈ **61 MB**. Use the
metadata endpoint plus direct XML fetches instead.

#### Undocumented field: `xml_hash`

Live responses carry **`xml_hash`** (MD5 of the XML) alongside the documented
`pdf_hash`. It is **absent from the OpenAPI spec** but was present on every BT
document sampled (86/86 in one pass). Persist it and skip re-downloading
unchanged XML.

**Filter to the Bundestag:** `/plenarprotokoll?f.wahlperiode=21` returns
`numFound: 105` — **mixing both chambers** (90 BT + 15 BR). Always pass
`f.zuordnung=BT`. Three concrete traps if you don't:

- **BR protocols have no XML at all** (0/14 sampled carry `xml_url`; every BT
  document sampled did), so a BR row silently yields zero speeches.
- **`dokumentnummer` format differs**: BT `21/90` (wp/sitzung) vs BR `1067`
  (bare running number, continuous across decades). Any `.split("/")` misparses.
- **Different URL tree**: BR lives at `brp/1067.pdf`, not `btp/`.

### 5.2 The structured source — plenary protocol XML

The `Fundstelle` schema exposes **`xml_url`** directly (documented as
*"Strukturierte XML-Version des Dokuments (aktuell nur für BT-Plenarprotokolle)"*),
so you can go from a DIP record straight to the XML without guessing URLs.

URL pattern (verified — the formula reproduces `fundstelle.xml_url` for
all **86** WP21 BT protocols checked): `https://dserver.bundestag.de/btp/21/21090.xml`
— i.e. `btp/<wp>/<wp><sitzung:03d>.xml`. Size ~1.2 MB. Prefer reading
`fundstelle.xml_url` from the API over constructing it.

DTD: `https://www.bundestag.de/resource/blob/575720/dbtplenarprotokoll.dtd`
(v1.0.2, Stand 05.09.2023, 9 707 B).

**Coverage boundary:** the spec states `xml_url` is *"aktuell nur für
BT-Plenarprotokolle **ab WP 18** verfügbar"* — so **WP18 (from 22.10.2013)
onward has XML; WP1–17 are PDF-only.** Verified empirically for WP20 and WP21;
the WP17/18 edge itself is **spec-sourced, not live-confirmed** (the WAF blocked
verification). Confirm before backfilling by counting `xml_url` presence in
`/plenarprotokoll?f.wahlperiode=18` vs `=17`.

**Enumerating protocols:** there is **no directory listing or per-WP ZIP** of
protocol XMLs — `dserver.bundestag.de/btp/21/` returns nothing browsable. Use
the DIP API as the index (`/plenarprotokoll?f.wahlperiode=21&f.zuordnung=BT`),
then fetch each `fundstelle.xml_url`, gated on `xml_hash`.

#### Root element carries full sitting metadata

```xml
<dbtplenarprotokoll wahlperiode="21" sitzung-nr="90" sitzung-datum="10.07.2026"
    sitzung-start-uhrzeit="09:00" sitzung-ende-uhrzeit="17:08"
    sitzung-ort="Berlin" herausgeber="Deutscher Bundestag"
    issn="0722-7980" start-seitennr="11107" sitzung-naechste-datum="08.09.2026">
```

#### A speech

```xml
<rede id="ID219000100">
  <p klasse="redner">
    <redner id="11004011">
      <name><vorname>Steffen</vorname><nachname>Bilger</nachname>
            <fraktion>CDU/CSU</fraktion></name>
    </redner>Steffen Bilger (CDU/CSU):</p>
  <p klasse="J_1">Frau Präsidentin! Liebe Kolleginnen und Kollegen! ...</p>
  <kommentar>(Beifall bei der CDU/CSU sowie bei Abgeordneten der SPD)</kommentar>
  <p klasse="O">Mit diesem pragmatischen Ansatz ...</p>
</rede>
```

Government members carry a role:

```xml
<redner id="11004437"><name><vorname>Nina</vorname><nachname>Warken</nachname>
  <rolle><rolle_lang>Bundesministerin für Gesundheit</rolle_lang>
         <rolle_kurz>Bundeministerin BMG</rolle_kurz></rolle></name></redner>
```

#### ⚠ `<redner id>` is a Stammdaten ID, **not** a DIP person ID

Verified: `GET /api/v1/person/11004011` → **`404 ID not found`**, while
`11004011` *is* `<MDB><ID>` for Steffen Bilger in MdB-Stammdaten. The DIP
`/person` id for the same person is `1013`. See §7.

#### `<p klasse="...">` values (observed, protocol 21/90)

| klasse | Count | Meaning |
|---|---|---|
| `AL_Namen` | 4736 | roll-call vote name entry (§4.2) |
| `J` | 1084 | speech body paragraph |
| `O` | 551 | speech body continuation (after an interjection) |
| `J_1` | 340 | **first** paragraph of a speech |
| `redner` | 197 | speaker header — **exclude from speech text** |
| `AL_Partei` / `AL_Ja-Nein-Enth` / `AL_Vorspann_*` | — | vote-block markers |
| `T_fett`, `T_Drs`, `T_NaS`, `T_Ueberweisung` | — | agenda-item headers, Drucksache refs, referral proposals |
| `Z` | 7 | quoted text |
| `K` | 5 | procedural marker ("Dritte Beratung") |

**Speech-text rule:** concatenate `<p>` inside `<rede>` **excluding**
`klasse="redner"`, and **excluding `<kommentar>`** — `<kommentar>` holds
applause and heckling *by other people* (`(Jörn König [AfD]: Und die wählen
uns!)`). Counting them would attribute other MPs' interjections to the speaker.

#### ⚠ 15% of speeches live outside the agenda tree

Protocol 21/90 contains **112 `<rede>` elements**, but only **95** are inside
`<tagesordnungspunkt>`. The other **17** are at
`dbtplenarprotokoll/anlagen/anlage/anlagen-text/rede` — *"zu Protokoll gegebene
Reden"* (written speeches submitted for the record, never delivered aloud);
`anlagen-typ` values include `Zu Protokoll gegebene Reden` and
`Erklärung nach § 31 GO`.

Iterating only `<tagesordnungspunkt>` silently undercounts speeches. There is no
`@redeart` attribute to detect them — you must check ancestry. Decide
deliberately whether written speeches count toward an MP's activity score, and
tag them (`zu_protokoll=True`) either way — `root.iter('rede')` catches both.
(WP20 protocol 20/177 had 0 such speeches, so the share varies by sitting.)

#### DIP-native cross-check: `/aktivitaet?f.plenarprotokoll=<id>`

`/aktivitaet?f.plenarprotokoll=5806` returns **131 records** carrying DIP
`person_id` and page-level `fundstelle` — the best DIP-native speech signal:

```json
{"id":"1791152","aktivitaetsart":"Rede","person_id":"8008","wahlperiode":21,
 "titel":"Dr. Hülya Düber, MdB, CDU/CSU","datum":"2026-07-10",
 "fundstelle":{"seite":"11236D","anfangsseite":11223,"endseite":11238,
   "pdf_url":"https://dserver.bundestag.de/btp/21/21090.pdf#P.11236"}}
```

Observed `aktivitaetsart` (first 100 of 131): `Rede` 76,
`Schriftliche Erklärung gem. § 31 GO BT` 15, `Zwischenfrage` 7,
`Rede (zu Protokoll gegeben)` 2.

It has **no text and no word counts**, but it gives DIP `person_id` directly —
making it both a validation source for XML extraction and a practical way to
build the ID crosswalk (join XML `<rede>` → Aktivität on date + page).

#### ⚠⚠ THE BIGGEST TRAP: one `<rede>` ≠ one speaker

Protocol 21/90 has **112 `<rede>` elements but 197 `klasse="redner"`
paragraphs.** Distribution of speaker-paragraphs per `<rede>`:
`{1: 83, 2: 12, 3: 5, 4: 4, 5: 1, 6: 2, 7: 2, 8: 1, 10: 2}`.

- 21 `<rede>` elements repeat the **same** speaker (president interrupts, then
  the speaker resumes).
- **8 contain multiple *distinct* speakers** — Zwischenfragen and
  Kurzinterventionen.

Example `ID219001100` contains ids `[11004437 ×6, 11005527, 11004773, 11005018]`.
Correct attribution: Warken **1 599 words** plus three interveners at
**48 / 134 / 60**. Taking `rede.find(".//redner")` — the first speaker — would
credit Warken with all four.

**You must re-attribute on every `klasse="redner"` paragraph**, walking direct
children in document order.

#### Extraction recipe (corrected)

```python
import xml.etree.ElementTree as ET

SPEECH = {"J", "J_1", "O", "Z", "J_Abstand"}   # exhaustive inside <rede>

root = ET.parse(path).getroot()
sitting = {"wp": root.get("wahlperiode"), "nr": root.get("sitzung-nr"),
           "date": root.get("sitzung-datum")}          # TT.MM.JJJJ

for rede in root.iter("rede"):              # iter() also catches <anlagen> speeches
    cur, buf = None, []

    def flush():
        if cur and buf:
            yield_segment(rede.get("id"), cur, buf, sitting)

    for ch in rede:                         # DIRECT children, document order
        if ch.tag == "p" and ch.get("klasse") == "redner":
            flush(); buf = []               # emit previous speaker's segment
            rd = ch.find("redner"); n = rd.find("name")
            cur = (rd.get("id"),                        # STAMMDATEN id, see §7
                   n.findtext("vorname"), n.findtext("nachname"),
                   n.findtext("fraktion"),
                   n.findtext("rolle/rolle_lang"))      # None for plain MdBs
        elif ch.tag == "p" and ch.get("klasse") in SPEECH:
            buf.append(" ".join("".join(ch.itertext()).split()))
        # <kommentar>, <name>, <zitat>, <a> deliberately skipped
    flush()
```

Aggregate on `(rede_id, redner_id)` for the "one speech" unit; on `redner_id`
alone for per-MP daily totals.

**Validated output:**

| | 21090.xml (WP21) | 20177.xml (WP20) |
|---|---|---|
| Raw segments | 197 | 247 |
| `(rede_id, redner_id)` units | 125 | — |
| Unique speakers | 108 | 96 |
| Total words | 62 097 | 58 674 |
| *zu Protokoll* segments | 17 | 0 |

Integrity checks passed: 0 `<kommentar>` leaks, 0 presidential leaks, 0 empty
segments, all `redner_id` 8-digit numeric.

#### Presidents self-exclude

Session chairs appear as a bare `<name>` element under `<tagesordnungspunkt>`
(31 in 21/90: `Präsidentin Julia Klöckner:`), **outside any `<rede>` and with no
`<redner id>`**. Walking only `<rede>` excludes them automatically — verified
0/31 leaked.

#### Agenda context

From the enclosing `<tagesordnungspunkt top-id="...">` — real values
`"Tagesordnungspunkt 22"`, `"Zusatzpunkt 18"`, `"Zusatzpunkt 28, 29"` (comma
form = merged debates), `"Zur Geschäftsordnung"`. Note `\xa0` appears inside
these in WP20.

`<top-titel>` is **never populated** (0/17 checked). Titles live in
`<p klasse="T_NaS">` / `<p klasse="T_fett">`, with Drucksache references in
`<p klasse="T_Drs">` (`Drucksachen 21/6130, 21/6559`).

#### Bonus: the table of contents is a free speech index

`<inhaltsverzeichnis>` resolved **112/112** entries to body `<rede id>`, each
carrying `<redner id>`, an agenda block title, and the **printed page number** —
cleaner labels than `@top-id`, plus PDF deep-links
(`.../21090.pdf#P.11109`). It is also an excellent integrity check: TOC entry
count must equal body `<rede>` count.

#### `<rede id>` format is ambiguous — don't parse it

`ID{wp:02d}{sitzung}{seq:05d}` with **sitzung not zero-padded**
(`ID219000100` = WP21/sitting 90; `ID2017700100` = WP20/sitting 177). Always
take `wahlperiode` / `sitzung-nr` from the **root attributes** instead.

---

### 5.3 Agenda (Tagesordnung) and video — what exists

**Agenda:** the best machine-readable source is the protocol XML itself
(§5.2 "Agenda context"), plus `<inhaltsverzeichnis>`'s 25 `<ivz-block>`
entries whose `<ivz-block-titel>` (`"Tagesordnungspunkt 22:"`) are the cleanest
labels available and already link to speeches via
`<xref ref-type="rede" rid= pnr=>`. Cross-reference to subject matter through
the protocol's `vorgangsbezug[]` (75 Vorgänge for 21/90) or by parsing the
Drucksache numbers out of `<p klasse="T_Drs">` and looking them up in `/vorgang`.

> **No standalone Tagesordnung feed** (JSON/XML agenda API for *upcoming*
> sittings) was found. Marked **not fully verified** — `bundestag.de` was
> WAF-blocked during the final probe.

**Video — `video.dip.bundestag.de` does not exist.** DNS resolution:

| Host | Resolves to |
|---|---|
| `video.dip.bundestag.de` | **NXDOMAIN — dead config entry** |
| `content.dip` / `export.dip` / `search.dip` | `46.243.122.86` |
| `dserver.bundestag.de` | `46.243.122.130` |
| `www.bundestag.de` | `46.243.122.50` |
| `webtv.bundestag.de` | `46.18.247.52` (HTTP 302 → `www.bundestag.de`) |

The entry in `dip-config.js` is stale — do not build against it. The XML
contains no video references, timecodes, or media URLs. The only speech→media
link found is page-anchored PDF deep-linking via `/aktivitaet`
(`.../21090.pdf#P.11236`). Treat "no video API" as **likely but unverified** —
the Mediathek player's XHR calls could not be inspected due to the WAF block.

---

## 6. Person data

### 6.1 DIP `/person`

`numFound` unfiltered: **5 623**. For `f.wahlperiode=21`: **803**.

> **803 ≫ 630 actual MdBs.** `/person` is *not* a roster of MPs — it indexes
> every person appearing in parliamentary documents, including federal
> ministers, Bundesrat members, state secretaries and guests. Filter on
> `funktion == "MdB"` if you want members only. **Do not treat `/person` as the
> MP list** — use MdB-Stammdaten (§6.2) for that.

```json
{ "id": "8190", "nachname": "Roth", "vorname": "Claudia",
  "funktion": ["MdB"], "fraktion": ["BÜNDNIS 90/DIE GRÜNEN"],
  "typ": "Person", "wahlperiode": [14,15,16,17,18,19,20,21],
  "aktualisiert": "2025-09-02T14:58:12+02:00",
  "person_roles": [ ... ] }
```

`person_roles[]` holds secondary entries with differing functions or names:
`funktion`, `funktionszusatz`, `fraktion`, `nachname`, `vorname`,
`namenszusatz`, `wahlperiode_nummer[]`, `wahlkreiszusatz`, `ressort_titel`,
`bundesland`. This is how a person who was both an MdB and a minister is
represented, and how mid-mandate name changes are recorded.

`f.person` matches a **whole word** against given or surname; multiple terms are
treated as the phrase `"Nachname Vorname"`. Verified:
`f.person=Bilger Steffen` → 1 result, id `1013`.

### 6.2 MdB-Stammdaten — the authoritative MP roster

```bash
curl -O https://www.bundestag.de/resource/blob/472878/MdB-Stammdaten.zip   # ~950 KB
unzip MdB-Stammdaten.zip
#   MDB_STAMMDATEN.XML   ~15 MB
#   MDB_STAMMDATEN.DTD
```

**4 614 MDB records** — every MP since 1949. Per Wahlperiode:

| WP | MPs | | WP | MPs |
|---|---|---|---|---|
| 16 | 642 | | 19 | 750 |
| 17 | 652 | | 20 | 772 |
| 18 | 658 | | **21** | **635** |

(WP counts exceed nominal seat counts because they include mid-term
replacements.) WP21 mandate split: **276 Direktwahl, 359 Landesliste**.

#### Record structure

```xml
<MDB>
  <ID>11004011</ID>
  <NAMEN>
    <NAME>
      <NACHNAME>Bilger</NACHNAME><VORNAME>Steffen</VORNAME>
      <ORTSZUSATZ/><ADEL/><PRAEFIX/><ANREDE_TITEL/><AKAD_TITEL/>
      <HISTORIE_VON>27.10.2009</HISTORIE_VON><HISTORIE_BIS/>
    </NAME>
  </NAMEN>
  <BIOGRAFISCHE_ANGABEN>
    <GEBURTSDATUM>16.02.1979</GEBURTSDATUM><GEBURTSORT>Schongau</GEBURTSORT>
    <GEBURTSLAND>Deutschland</GEBURTSLAND><STERBEDATUM/>
    <GESCHLECHT>männlich</GESCHLECHT><FAMILIENSTAND>verheiratet, 3 Kinder</FAMILIENSTAND>
    <RELIGION>evangelisch</RELIGION><BERUF>Volljurist</BERUF>
    <PARTEI_KURZ>CDU</PARTEI_KURZ><VITA_KURZ>...</VITA_KURZ>
    <VEROEFFENTLICHUNGSPFLICHTIGES>...</VEROEFFENTLICHUNGSPFLICHTIGES>
  </BIOGRAFISCHE_ANGABEN>
  <WAHLPERIODEN>
    <WAHLPERIODE>
      <WP>17</WP>
      <MDBWP_VON>27.10.2009</MDBWP_VON><MDBWP_BIS>22.10.2013</MDBWP_BIS>
      <WKR_NUMMER>265</WKR_NUMMER><WKR_NAME>Ludwigsburg</WKR_NAME><WKR_LAND>BW</WKR_LAND>
      <LISTE/><MANDATSART>Direktwahl</MANDATSART>
      <INSTITUTIONEN>
        <INSTITUTION>
          <INSART_LANG>Fraktion/Gruppe</INSART_LANG>
          <INS_LANG>Fraktion der Christlich Demokratischen Union/Christlich - Sozialen Union</INS_LANG>
          <MDBINS_VON>27.10.2009</MDBINS_VON><MDBINS_BIS/>
          <FKT_LANG/><FKTINS_VON/><FKTINS_BIS/>
        </INSTITUTION>
      </INSTITUTIONEN>
    </WAHLPERIODE>
  </WAHLPERIODEN>
</MDB>
```

Notes:
- `<NAMEN>` may contain **multiple `<NAME>`** entries — name changes during a
  mandate, with `HISTORIE_VON`/`HISTORIE_BIS` validity. Index all of them (§7).
- `<ORTSZUSATZ>` **already includes its parentheses**: `(Fulda)`.
- All dates are `TT.MM.JJJJ`.
- `<VEROEFFENTLICHUNGSPFLICHTIGES>` holds declared outside interests
  (Nebeneinkünfte) — current WP only.
- The dump has a `<VERSION>` element (observed `1777449783`) usable for
  change detection.

### 6.3 `<INSTITUTIONEN>` — committee membership

Distribution across all 4 614 records:

| INSART_LANG | Entries |
|---|---|
| Fraktion/Gruppe | 13 579 |
| **Ausschuss** | **1 744** |
| Sonstiges Gremium | 907 |
| Unterausschuss | 248 |
| Deutscher Bundestag | 244 |
| Parlamentariergruppen | 150 |
| Ministerium | 51 |
| Enquete-Kommission | 32 |

```xml
<INSTITUTION>
  <INSART_LANG>Ausschuss</INSART_LANG>
  <INS_LANG>Ausschuss für Landwirtschaft, Ernährung und Heimat</INS_LANG>
  <MDBINS_VON>21.05.2025</MDBINS_VON><MDBINS_BIS/>
  <FKT_LANG>Stellvertretendes Mitglied</FKT_LANG>
  <FKTINS_VON>21.05.2025</FKTINS_VON><FKTINS_BIS/>
</INSTITUTION>
```

`FKT_LANG` distinguishes `Ordentliches Mitglied` / `Stellvertretendes Mitglied`
/ `Vorsitzender` etc., with date ranges.

### 6.4 ⚠ Committee data covers the current WP only

Verified: **all 1 744 `Ausschuss` entries belong to WP21.** The DTD confirms
this by design — `<INSTITUTIONEN>` is documented as *"hier: nur Fraktion, außer
aktuelle Wahlperiode"* (only Fraktion, except for the current WP).

**Consequence:** historical committee membership is **not available** from
Stammdaten. A committee-work metric can only be computed for the current WP,
unless you snapshot each dump over time — worth archiving the ZIP per sync so
history accumulates going forward.

`Fraktion/Gruppe` entries *are* present for all WPs, so party affiliation over
time is fully available. In WP21, 6 MPs have more than one Fraktion entry
(switchers/leavers) — model affiliation as date-ranged, not a scalar.

⚠ Fraktion naming differs by source: Stammdaten uses long form (`Fraktion der
Christlich Demokratischen Union/Christlich - Sozialen Union`), vote sheets use
short form (`CDU/CSU`), DIP uses `CDU/CSU`. You need an explicit mapping table.

---

## 7. ⚠ The join problem — three incompatible ID spaces

This is the single most important architectural finding.

| Source | Identifier | Steffen Bilger |
|---|---|---|
| DIP API `/person` | short numeric | **`1013`** |
| MdB-Stammdaten `<MDB><ID>` | 8-digit | **`11004011`** |
| Protocol XML `<redner id>` | 8-digit | **`11004011`** (= Stammdaten) |
| Named-vote XLSX | **none** | — (names only) |
| abgeordnetenwatch | own IDs | `politician.id`, `mandate.id` |

Verified: `GET /api/v1/person/11004011` → **404**.

So:
- **Speeches → Stammdaten:** direct ID join. Easy. ✅
- **Aktivitäten → DIP person:** direct ID join (`person_id`). Easy. ✅
- **DIP person ↔ Stammdaten:** ❌ no shared key — name matching required.
- **Votes → anything:** ❌ no ID at all — name matching required.

### 7.1 Name-matching algorithm (verified 628/630)

A naive `(Name, Vorname)` join against Stammdaten failed on **21 of 630** rows
(3.3%). Two distinct causes, both fixable:

1. **`ORTSZUSATZ` already contains parentheses.** Building `f"{nach} ({orts})"`
   double-wraps it. Concatenate plainly: `f"{nach} {orts}"` → `Brand (Fulda)`.
2. **`PRAEFIX` / particles.** The sheet's `Titel` column holds `von`, `van`,
   `de` — prepend it to the surname as an alternative key.

Also index **all historical `<NAME>` entries**, not just the first.

```python
idx = {}
for mdb in root.findall("MDB"):
    mid = mdb.findtext("ID")
    for n in mdb.findall(".//NAME"):                 # ALL names, incl. historical
        nach = (n.findtext("NACHNAME") or "").strip()
        vor  = (n.findtext("VORNAME")  or "").strip()
        orts = (n.findtext("ORTSZUSATZ") or "").strip()   # already "(Fulda)"
        pre  = (n.findtext("PRAEFIX")  or "").strip()
        for base in {nach, f"{pre} {nach}".strip()}:
            for k in {base, f"{base} {orts}".strip() if orts else base}:
                idx.setdefault((k, vor), mid)

# lookup, trying the sheet's `Titel` column as a name particle
mid = idx.get((name, vorname)) or idx.get((f"{titel} {name}".strip(), vorname))
```

**Result: 628/630 matched.** The 2 residual misses (`Glaser, Stefan`;
`Naser, Christoph`) are **not** algorithm failures — they are MPs absent from
the Stammdaten dump, which lags reality (see §7.2).

No duplicate `(NACHNAME, VORNAME)` pairs exist within WP21, so exact matches are
unambiguous. Across WPs they are not unique — always scope matching to the
Wahlperiode. `ORTSZUSATZ` exists precisely to disambiguate identical names
(`Müller (Braunschweig)`), so preserve it.

### 7.1b Stammdaten ↔ DIP `/person`: add Unicode normalisation

For the **speaker → DIP person** direction, exact `(vorname, nachname)` matching
scored **106/108** on protocol 21/90. Both failures were character-level
mismatches *between the two official sources*:

| Protocol XML | DIP `/person` |
|---|---|
| `Aydan Özoğuz` (Turkish ğ, U+011F) | `Aydan Özoguz` (plain g) — id 1185 |
| `Catarina dos Santos-Wintz` | `Catarina Santos-Wintz` — id 7608 |

Normalising — NFKD → strip combining marks → `ß`→`ss` → lowercase → strip
non-alphabetic → strip leading particles (`von|van|de|dos|der|zu`) — yields
**108/108 matched, 0 ambiguous, 0 unmatched** against the 803 DIP WP21 persons.

Separately verified: **192/192** unique `<redner id>` values across two
protocols resolve in MdB-Stammdaten (IDs range `11000001`–`11005627`, all
prefixed `11` — exactly the `redner id` space). The DIP `/person` record
contains **no external identifier field of any kind**, so the crosswalk must be
name-derived.

### 7.2 Stammdaten staleness

The ZIP is a periodic snapshot and **lags mid-term changes**. Observed:
`Michael Breilmann` appears with WP20 only despite sitting in WP21;
two MPs in a July 2026 vote sheet were missing entirely.

Mitigations: re-download the ZIP on every sync and watch `<VERSION>`; keep
unmatched vote rows in a quarantine table and retry them on later syncs rather
than dropping them; use abgeordnetenwatch's `candidacies-mandates` (which
records successions with `start_date` and an `info` note such as *"ist am
20.07.2026 für Frank Junge in den Deutschen Bundestag nachgerückt"*) to detect
new MPs sooner.

### 7.3 Recommendation

Mint an **internal Bundestrack MP id** and store all external ids against it
(`dip_person_id`, `stammdaten_id`, `aw_politician_id`), resolved once during
ingest. Never join on names at query time.

---

## 8. Document server (`dserver.bundestag.de`) URL patterns

Prefer `fundstelle.pdf_url` / `fundstelle.xml_url` from the API — they are
supplied directly. These rules are for reconstruction/validation only.

| Type | Pattern | Example |
|---|---|---|
| Drucksache PDF | `btd/<wp>/<nr//100:03d>/<wp><nr:05d>.pdf` | `21/7327` → `btd/21/073/2107327.pdf` |
| BT protocol PDF | `btp/<wp>/<wp><sitzung:03d>.pdf` | `21/90` → `btp/21/21090.pdf` |
| BT protocol XML | `btp/<wp>/<wp><sitzung:03d>.xml` | `btp/21/21090.xml` |
| BR protocol PDF | `brp/<nr>.pdf` | `brp/1067.pdf` |

The Drucksache number is zero-padded to **5 digits** and the directory block is
`number // 100`, zero-padded to 3:

```python
def drucksache_pdf(wp: int, nr: int) -> str:
    return f"https://dserver.bundestag.de/btd/{wp}/{nr // 100:03d}/{wp}{nr:05d}.pdf"
```

---

## 9. Seating arrangements — definitive answer

**No official machine-readable seating data exists.**

It is important to separate two different things:

| | Available? |
|---|---|
| **Seat distribution** (how many seats per Fraktion) | ✅ derivable — count `Fraktion/Gruppe` entries in Stammdaten per WP (WP21: CDU/CSU 209, AfD 152, SPD 122, Grüne 88, Linke 67, fraktionslos 3) |
| **Seat assignment** (which physical seat a named MP occupies) | ❌ **not published in any machine-readable form** |

What was checked: the DIP API schemas (no seating field anywhere in the
OpenAPI spec), MdB-Stammdaten (no seat element in the DTD), plenary protocol
XML and its DTD (no seat attribute), bundestag.de plenary/Abgeordnete pages,
and Wikidata (queryable, has Bundestag members, no physical seat assignments).

The Bundestag publishes the plenary seating plan only as a rendered graphic /
PDF for individual sittings. If Bundestrack needs a hemicycle visualisation,
generate seat positions **synthetically** from Fraktion sizes (standard
parliament-arc layout) rather than trying to reflect real seat assignments.

---

## 10. Licensing & terms of use

- **DIP API / Bundestag open data:** governed by the DIP Nutzungsbedingungen
  (`https://dip.bundestag.de/über-dip/nutzungsbedingungen`), linked from the
  spec's `termsOfService`. Parliamentary materials are official works. Attribute
  *"Deutscher Bundestag"* as the source, do not imply endorsement, and do not
  misrepresent the data. The 401 body warns that *"misuse of this service may
  lead to blocking your requests"* — reinforcing §2.6.
- **abgeordnetenwatch API v2:** **CC0 1.0** (public domain dedication) —
  explicitly stated in every response's `meta` block. Attribution appreciated
  but not legally required.

Bundestrack should carry a visible data-source attribution and a note that the
figures are derived from official records but are not an official publication.

---

## 11. Recommended pipeline design

### 11.1 Backfill order (dependencies first)

1. **MdB-Stammdaten ZIP** → MP roster, mandates, committees. Build the internal
   MP id and the name index (§7.1) *first*; everything else joins to it.
2. **DIP `/person`** (`f.wahlperiode=21`, 803 records, 9 pages) → map
   `dip_person_id` onto MPs via name match.
3. **DIP `/aktivitaet`** (`f.wahlperiode=21`, **80 537** records ≈ **806 pages**)
   → the activity backbone; joins by `person_id` with no name matching.
4. **DIP `/vorgang` + `/vorgangsposition`** → legislative context, committee
   referrals, and discovery of `Namentliche Abstimmung` steps.
5. **Plenary protocol XML** (90 documents for WP21, XML from WP18 onward) →
   speeches (§5.2) and vote name lists (§4.2). Joins by `<redner id>` =
   Stammdaten id. Optionally reconcile against
   `/aktivitaet?f.plenarprotokoll=<id>` for DIP-native `person_id`.
6. **Named-vote XLSX** (~1 015 total, back to ~2012) → the only source with
   absences. Joins by name (§7.1).

### 11.2 Daily sync

```
GET /aktivitaet?f.wahlperiode=21&f.aktualisiert.start=<last_run_iso>
GET /vorgang?f.wahlperiode=21&f.aktualisiert.start=<last_run_iso>
GET /drucksache?f.wahlperiode=21&f.aktualisiert.start=<last_run_iso>
GET /plenarprotokoll?f.wahlperiode=21&f.zuordnung=BT&f.aktualisiert.start=<last_run_iso>
```

Then: for each new protocol, fetch `fundstelle.xml_url` and extract speeches +
vote lists; scrape the named-vote AJAX list for new XLSX blobs; re-download the
Stammdaten ZIP and diff `<VERSION>`.

Store `last_run` as the **max `aktualisiert` actually seen**, not wall-clock
time, and overlap the window slightly to tolerate clock skew.

### 11.3 Non-negotiable constraints

- **Sequential fetching only**, ~1 req/s or slower (§2.6). A concurrent pipeline
  will be IP-blocked; even a single fast worker can trip the WAF.
- **`follow_redirects=False`**, and treat `303 → /.enodia/` as backoff.
- Terminate pagination on **unchanged cursor** (§2.2).
- Always pass `f.zuordnung=BT` for protocols (§5.1) — BR rows have no XML and a
  different `dokumentnummer` format.
- Never derive per-MP authorship from `autoren_anzeige` (capped at 4, §3.4).
- **Re-attribute on every `klasse="redner"` paragraph** — one `<rede>` can hold
  several distinct speakers (§5.2).
- Include `<anlagen>` speeches or explicitly exclude them — don't do it by
  accident (§5.2).
- Avoid `/plenarprotokoll-text` entirely: 10 docs/page at ~6.8 MB, and
  regex-parsing it inflates word counts by **+53.6 %**.
- Persist `xml_hash` / `pdf_hash` and skip unchanged documents; make the whole
  run resumable.
- Normalise `\xa0` (non-breaking space) everywhere in XML-derived text, and
  apply Unicode NFKD normalisation before any name matching (§7.1b).

---

## 12. Appendix — schema field reference

### Shared list-response envelope

```yaml
numFound: integer   # total matching entities
cursor:   string    # opaque; unchanged value == last page
documents: [ ... ]  # max 100 per page
```

### `Aktivitaet`

`id`, `aktivitaetsart`, `typ`(=`Aktivität`), `dokumentart`(`Drucksache`|`Plenarprotokoll`),
`wahlperiode`, `datum`, `aktualisiert`, `titel`, **`person_id`**, `fundstelle`,
`vorgangsbezug[]` (max 4), `vorgangsbezug_anzahl`, `deskriptor[]`, `abstract`.

### `Person`

`id`, `nachname`, `vorname`, `namenszusatz`, `typ`, `wahlperiode[]`, `basisdatum`,
`datum`, `aktualisiert`, `titel`, `funktion`, `funktionszusatz`, `fraktion`,
`wahlkreiszusatz`, `ressort`, `bundesland`, `person_roles[]`.

### `Vorgang`

`id`, `typ`, `beratungsstand`, `vorgangstyp`, `wahlperiode`, `initiative[]`,
`datum`, `aktualisiert`, `titel`, `abstract`, `sachgebiet[]`, `deskriptor[]`,
`gesta`, `zustimmungsbeduerftigkeit[]`, `kom`, `ratsdok`, `sek`, `verkuendung[]`,
`inkrafttreten[]`, `archiv`, `mitteilung`, `vorgang_verlinkung[]`.

### `Vorgangsposition`

`id`, `vorgangsposition`, `zuordnung`, `gang`, `fortsetzung`, `nachtrag`,
`vorgangstyp`, `typ`, `titel`, `dokumentart`, **`vorgang_id`**, `datum`,
`aktualisiert`, `fundstelle`, `urheber[]`, **`ueberweisung[]`**,
`aktivitaet_anzeige[]` (max 4), `aktivitaet_anzahl`, `ressort[]`,
**`beschlussfassung[]`**, `ratsdok`, `kom`, `sek`, `mitberaten[]`, `abstract`.

### `Drucksache`

`id`, `typ`, `dokumentart`, `drucksachetyp`, `dokumentnummer`, `wahlperiode`,
`herausgeber`(`BT`|`BR`), `datum`, `aktualisiert`, `titel`,
**`autoren_anzeige[]`** (max 4), `autoren_anzahl`, `fundstelle`, `pdf_hash`(MD5),
`urheber[]`, `vorgangsbezug[]` (max 4), `vorgangsbezug_anzahl`, `ressort[]`,
`anlagen`.

### `Plenarprotokoll`

`id`, `dokumentart`, `typ`, `dokumentnummer`, `wahlperiode`, `herausgeber`,
`datum`, `aktualisiert`, `titel`, `fundstelle`, `pdf_hash`, `vorgangsbezug[]`,
`vorgangsbezug_anzahl`, `sitzungsbemerkung`,
**`xml_hash`** *(undocumented — returned live, absent from the spec)*.
`*-text` variants add `text` (full document text as one string).

### `Fundstelle`

`id`, `dokumentart`, `pdf_url`, **`xml_url`**, `dokumentnummer`, `datum`,
`drucksachetyp`, `herausgeber`, `urheber[]`, `verteildatum`, `seite`,
`anfangsseite`, `endseite`, `anfangsquadrant`/`endquadrant` (`A`–`D`),
`frage_nummer`, `anlagen`, `top`, `top_zusatz`.

### Enums

- `Zuordnung`: `BT`, `BR`, `BV`, `EK`
- `abstimmungsart`: `Abstimmung durch Aufruf der Länder`, `Geheime Wahl`,
  `Hammelsprung`, `Namentliche Abstimmung`, `Verhältniswahl`
- `mehrheit`: `Absolute Mehrheit`, `Zweidrittelmehrheit`
- `Urheber.rolle`: `B`, `U`
- `Quadrant`: `A`, `B`, `C`, `D`
- `Bundesland`: the 16 German states
