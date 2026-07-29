"""abgeordnetenwatch.de API v2 — the supplementary roster source.

Community-run, CC0 1.0, no API key, and clean JSON with stable numeric ids.
**Not the system of record**, and not consulted for anything the Bundestag
publishes itself. It earns its place by answering two questions the official
sources answer late or not at all:

- **Who is sitting *now*.** `candidacies-mandates` records a succession with a
  `start_date` and a published note — *"ist am 20.07.2026 für Frank Junge in den
  Deutschen Bundestag nachgerückt"* — weeks before the MdB-Stammdaten snapshot
  catches up (§7.3). See `get_mandates`, and `MPResolver.reconcile_mandates`,
  which reads it as a **report on roster freshness and never as a writer**.

- **Occupation and education.** `politicians` carries
  `ext_id_bundestagsverwaltung`, the 8-digit MdB-Stammdaten id, which makes this
  the one external source that joins to the roster *by id* rather than by name
  (§7). See `iter_politicians`.

## ⚠ The `/polls` endpoint is deliberately not used

It was built, tested, and never called — and on inspection it should not be.
Three findings, measured 2026-07-29:

1. **It is curated, not complete.** 63 polls for WP21 against ~1 015 official
   named votes in the Bundestag's history (§4.3). Anything keyed on it silently
   omits most ballots.
2. **What it adds beyond the official sheets is editorial, not authoritative.**
   `field_intro` is volunteer-written prose summarising a bill; `field_accepted`
   restates DIP's `beschlusstenor`; `field_committees` restates DIP's
   `Ueberweisung`. Bundestrack takes each of those from the official source
   already.
3. **No product surface consumes it.** Nothing renders a poll, and the outcome
   join that `/votes` does use runs through DIP (see `bundestag-vote-outcomes`).

So `iter_polls`, `get_poll_votes`, `parse_votes` and `tally` are **removed**
rather than left as a wired-looking route nobody calls. The cross-validation
they were written for remains possible from this same client — the endpoint is
public and documented — but it is a one-off verification task, not pipeline
behaviour, and pretending otherwise is what made it dead code twice over.

This host is **not** behind the Enodia WAF — it is not a bundestag.de domain —
but it goes through the same paced client anyway. Being polite to a volunteer
project's servers is not a lesser obligation than being polite to the
Bundestag's, and it is enforced: sustained requests answer **HTTP 429**, with no
`Retry-After` and no rate-limit headers to negotiate against.
"""

from __future__ import annotations

import logging
from collections.abc import Iterable, Iterator
from typing import Any

from bundestrack.api.base import BundestagClient

logger = logging.getLogger(__name__)

BASE_URL = "https://www.abgeordnetenwatch.de/api/v2"

#: Bundestag legislature ids (§4.3). Coverage reaches back to 2005, so WP14 and
#: WP15 have no entry and `_legislature` raises for them — which is the correct
#: outcome, since Bundestrack backfills further back than this source goes.
#: These are abgeordnetenwatch's own ids, unrelated to the Wahlperiode number.
LEGISLATURE_IDS = {21: 161, 20: 132, 19: 111, 18: 97, 17: 83, 16: 67}

#: Rows per request. The API caps `range_end`, and paging politely costs little
#: against the 630 mandates and ~1 890 politicians the pipeline reads.
PAGE_SIZE = 100


class AbgeordnetenwatchClient(BundestagClient):
    """Read access to the abgeordnetenwatch v2 endpoints the pipeline uses."""

    def __init__(self, *, base_url: str = BASE_URL, **kwargs: Any) -> None:
        super().__init__(base_url=base_url, **kwargs)

    def _get(self, path: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        payload = self.get_json(path, params=params)
        if not isinstance(payload, dict):
            raise TypeError(f"Expected a JSON object from {path}, got {type(payload).__name__}")
        return payload

    def _paginate(self, path: str, params: dict[str, Any]) -> Iterator[dict[str, Any]]:
        """Walk an offset-paginated collection.

        Nothing like DIP's opaque cursor (§2.2): this API paginates by
        `range_start`/`range_end` and publishes the total in `meta.result`, so
        the stop condition is arithmetic rather than a repeated token.
        """
        offset = 0
        while True:
            payload = self._get(path, {**params, "range_start": offset, "range_end": PAGE_SIZE})
            rows = payload.get("data") or []
            yield from rows
            offset += len(rows)
            total = int(payload.get("meta", {}).get("result", {}).get("total", 0))
            if not rows or offset >= total:
                return

    @staticmethod
    def _legislature(wahlperiode: int) -> int:
        """Map a Wahlperiode to abgeordnetenwatch's own legislature id (§4.3)."""
        legislature = LEGISLATURE_IDS.get(wahlperiode)
        if legislature is None:
            raise ValueError(
                f"No abgeordnetenwatch legislature id for Wahlperiode {wahlperiode}. "
                f"Known: {sorted(LEGISLATURE_IDS)} (docs/api-research.md §4.3)."
            )
        return legislature

    def get_mandates(self, wahlperiode: int = 21) -> Iterator[dict[str, Any]]:
        """Mandates for a period — the succession feed (§7.3).

        The reason this client exists beyond validation: each record carries a
        `start_date` and an `info` note such as *"ist am 20.07.2026 für Frank
        Junge in den Deutschen Bundestag nachgerückt"*, which identifies an MP
        who has joined mid-period well before the Stammdaten snapshot does.
        Measured 2026-07-29: 630 mandates for WP21, of which 11 carry such a
        note and 2 name a member the Stammdaten dump does not yet hold.

        ⚠ **`type=mandate` is not optional.** The collection is
        *candidacies*-mandates: without it the endpoint also returns candidacies,
        which are people who *stood* rather than people who sit, and treating one
        as the other would report an election's losers as members.

        ⚠ The filter parameter is `parliament_period`, the opposite of
        `iter_polls` above — `field_legislature` answers **500** here, and
        `field_legislature` is what *polls* needs. Verified live on both.
        Unfiltered, this endpoint returns every German parliament it tracks: the
        first page holds Rheinland-Pfalz and Nordrhein-Westfalen rows, so a
        dropped filter does not narrow badly, it silently mixes chambers.

        ⚠ **There is no `updated_since` here.** The `?updated_since=…` filter
        answers HTTP 500 on this endpoint (verified live 2026-07-29:
        *"The following parameter(s) are not valid: updated_since"*). The
        succession feed is small enough (~630 rows for WP21, ~19 requests) that
        an unfiltered fetch on every enrichment run is cheap; adding a kwarg
        that only 500s would be a footgun for a future caller. See N3 in
        `/tmp/review-source-backed-ingestion-gaps.md`.
        """
        params: dict[str, Any] = {
            "parliament_period": self._legislature(wahlperiode),
            "type": "mandate",
        }
        yield from self._paginate("candidacies-mandates", params)

    def iter_politicians(self) -> Iterator[dict[str, Any]]:
        """Every politician carrying a Stammdaten id — the enrichment set.

        The one external source that joins to the roster **by id**: each record
        carries `ext_id_bundestagsverwaltung`, which is the 8-digit MdB-
        Stammdaten `<MDB><ID>` verbatim. No name matching, so none of §7.1's
        failure modes apply here.

        `ext_id_bundestagsverwaltung[ne]=` — "not equal to empty" — is the
        filter that narrows 36 356 politicians to the 1 890 with one, i.e. the
        whole set in ~19 requests. Measured against WP21 on 2026-07-27: 628 of
        630 mandates match, carrying `occupation` for 88.1 % and `education` for
        83.4 %.

        ⚠ Fetched whole rather than per MP, and that is the point. The per-id
        endpoint is one request each — 630 of them tripped the 429 in testing at
        around thirty. Paging the filtered collection is two orders of magnitude
        cheaper and cannot be rate-limited into a partial roster.

        ⚠ `id[in][]=…` looks like the obvious alternative and answers **500**;
        the bracketed-filter syntax works for scalar comparisons only.
        """
        yield from self._paginate("politicians", {"ext_id_bundestagsverwaltung[ne]": ""})


def parse_politicians(rows: Iterable[dict[str, Any]]) -> dict[str, dict[str, str | None]]:
    """Politician records → `{stammdaten_id: {occupation, education}}`.

    Keyed by the Stammdaten id because that is what the roster is keyed by —
    this is the whole reason the source is worth using over a name-matched one.

    A record without one is skipped: the filter in `iter_politicians` should
    prevent it, but a politician with no Bundestag mandate has nothing to
    enrich and no key to enrich it under.

    Empty strings become None. The API writes an unfilled field either way, and
    the Convex schema's convention is that absent is null — an empty string
    would render as a blank labelled row rather than as an omitted one.
    """
    enriched: dict[str, dict[str, str | None]] = {}
    for row in rows:
        stammdaten_id = (row.get("ext_id_bundestagsverwaltung") or "").strip()
        if not stammdaten_id:
            continue
        enriched[stammdaten_id] = {
            # Not folded into Stammdaten's `BERUF`, which the roster already
            # stores as `profession`: the two answer related questions
            # differently and both are worth having. Stammdaten records a
            # former trade where this often records `MdB`.
            "occupation": (row.get("occupation") or "").strip() or None,
            # Stammdaten publishes no education field at all, so this one has
            # no counterpart to disagree with.
            "education": (row.get("education") or "").strip() or None,
        }
    return enriched


def politician_stammdaten_index(rows: Iterable[dict[str, Any]]) -> dict[str, str]:
    """`{politician_id: stammdaten_id}` — the bridge a mandate needs.

    A mandate record names its member only as `politician.id`, which is
    abgeordnetenwatch's own id and joins to nothing in this repo. The
    `politicians` collection carries both that id *and*
    `ext_id_bundestagsverwaltung`, the 8-digit Stammdaten id — so the two
    together give a mandate a **deterministic** route to the roster, with no
    name matching and none of §7.1's failure modes.

    ⚠ Do **not** use a mandate's own `id_external_administration` for this. It
    is populated (629 of 630) and it is numeric, which makes it look like the
    obvious key — but it is a 3-4 digit id from a different space entirely.
    Verified on Steffen Bilger: his mandate carries `1566`, while his Stammdaten
    id is `11004011` and his DIP person id is `1013` (§7). Joining on it would
    match the wrong member rather than fail to match.
    """
    index: dict[str, str] = {}
    for row in rows:
        politician_id = row.get("id")
        stammdaten_id = (row.get("ext_id_bundestagsverwaltung") or "").strip()
        if politician_id is None or not stammdaten_id:
            continue
        index[str(politician_id)] = stammdaten_id
    return index


def parse_mandates(
    rows: Iterable[dict[str, Any]], stammdaten_by_politician: dict[str, str]
) -> list[dict[str, Any]]:
    """Mandate records → the flat rows the roster reconciliation compares.

    `stammdaten_id` is None where the politician carries no
    `ext_id_bundestagsverwaltung` — 2 of 630 on WP21. That is preserved rather
    than guessed at: an unresolvable mandate is a real finding about the
    sources disagreeing, and a name match would turn it into a silent wrong
    answer. `entered_mid_period` is the source's own `mandate_won == "moved_up"`
    or the presence of an `info` note, never inferred from the date.
    """
    parsed: list[dict[str, Any]] = []
    for row in rows:
        politician = row.get("politician") or {}
        electoral = row.get("electoral_data") or {}
        politician_id = politician.get("id")
        parsed.append(
            {
                "mandate_id": row.get("id"),
                "politician_id": str(politician_id) if politician_id is not None else None,
                "stammdaten_id": stammdaten_by_politician.get(str(politician_id))
                if politician_id is not None
                else None,
                # `Katrin Zschau (Bundestag 2025 - 2029)` — the period suffix is
                # stripped for the same reason `parse_votes` strips it.
                "name": str(row.get("label", "")).split(" (")[0].strip(),
                "start_date": row.get("start_date"),
                "end_date": row.get("end_date"),
                # *"ist am 20.07.2026 für Frank Junge in den Deutschen Bundestag
                # nachgerückt"* — the published succession note, verbatim. Kept
                # whole rather than parsed for the predecessor's name: it is
                # free prose, and a regex over it would invent a person.
                "info": row.get("info") or None,
                "mandate_won": electoral.get("mandate_won"),
                "entered_mid_period": electoral.get("mandate_won") == "moved_up"
                or bool(row.get("info")),
            }
        )
    return parsed
