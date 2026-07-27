"""abgeordnetenwatch.de API v2 — the supplementary vote source.

Community-run, CC0 1.0, no API key, and clean JSON with stable numeric ids —
which is exactly what the official vote sheets lack (docs/api-research.md §4.3).
One request returns all 630 per-MP votes for a ballot, and it cross-validates
against the official XLSX exactly, including absences and the
maternity-protection annotation.

**Not the system of record.** Two reasons, both structural rather than about
quality: it is community-run, and its poll set is *curated* — WP21 has 63 polls
against ~1 015 official named votes across the Bundestag's history, so the two
are not in 1:1 correspondence and a sync keyed on it would silently miss most
ballots (§4.3). Use it to validate an XLSX parse, and to fill the gap §7.3
describes: its `candidacies-mandates` records successions with a start date and
a note naming who an MP replaced, which detects a new MP weeks before the
Stammdaten snapshot catches up.

It is also the **occupation and education source**. `politicians` carries
`ext_id_bundestagsverwaltung` — the 8-digit MdB-Stammdaten id — which makes this
the one external source that joins to the roster *by id* rather than by name
(§7). See `iter_politicians`.

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
from bundestrack.models.votes import Vote, tally_votes

logger = logging.getLogger(__name__)

BASE_URL = "https://www.abgeordnetenwatch.de/api/v2"

#: Bundestag legislature ids (§4.3). Coverage reaches back to 2005.
#: These are abgeordnetenwatch's own ids, unrelated to the Wahlperiode number.
LEGISLATURE_IDS = {21: 161, 20: 132, 19: 111, 18: 97, 17: 83, 16: 67}

#: `vote` values → the shared vocabulary. `no_show` is an absence, and maps to
#: `ABSENT` rather than `ABSTAIN` — the same distinction the XLSX sheets draw
#: between `nichtabgegeben` and `Enthaltung` (§4.1).
VOTE_VALUES = {
    "yes": Vote.YES,
    "no": Vote.NO,
    "abstain": Vote.ABSTAIN,
    "no_show": Vote.ABSENT,
}

#: Rows per request. The API caps `range_end`, and paging politely costs little
#: against a poll set of 63.
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

    def iter_polls(self, wahlperiode: int = 21) -> Iterator[dict[str, Any]]:
        """Every recorded ballot for a Wahlperiode.

        ⚠ Curated, not complete — see the module docstring. The filter is
        `field_legislature`, not `legislature`: the latter is accepted by the
        router and answers 500.
        """
        yield from self._paginate("polls", {"field_legislature": self._legislature(wahlperiode)})

    def get_poll_votes(self, poll_id: int | str) -> list[dict[str, Any]]:
        """All per-MP votes for one ballot, in a single request.

        `related_data=votes` inlines them, which is the whole appeal: 630
        records, each with a stable `mandate.id`, for one round trip.
        """
        payload = self._get(f"polls/{poll_id}", {"related_data": "votes"})
        return payload.get("data", {}).get("related_data", {}).get("votes", []) or []

    def get_mandates(
        self, wahlperiode: int = 21, *, updated_since: str | None = None
    ) -> Iterator[dict[str, Any]]:
        """Mandates for a period — the succession feed (§7.3).

        The reason this client exists beyond validation: each record carries a
        `start_date` and an `info` note such as *"ist am 20.07.2026 für Frank
        Junge in den Deutschen Bundestag nachgerückt"*, which identifies an MP
        who has joined mid-period well before the Stammdaten snapshot does.
        """
        params: dict[str, Any] = {"parliament_period": self._legislature(wahlperiode)}
        if updated_since:
            params["updated_since"] = updated_since
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


def parse_votes(votes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Flatten the API's vote objects into comparable rows.

    Shaped for cross-validation against a parsed XLSX sheet: the MP's display
    name, the mapped vote, and the structured absence reason the official sheets
    record only as free text in `Bemerkung`.

    An unrecognised `vote` value is skipped with a warning rather than dropped
    silently or mapped to a guess — the vocabulary is the API's, and it can
    grow.
    """
    rows: list[dict[str, Any]] = []
    for entry in votes:
        raw = entry.get("vote")
        vote = VOTE_VALUES.get(raw)
        if vote is None:
            logger.warning("Unknown abgeordnetenwatch vote value %r — skipping", raw)
            continue
        mandate = entry.get("mandate") or {}
        fraction = entry.get("fraction") or {}
        rows.append(
            {
                "vote_id": entry.get("id"),
                "mandate_id": mandate.get("id"),
                # `Sanae Abdi (Bundestag 2025 - 2029)` — the period suffix is
                # stripped so the name is comparable with a sheet's.
                "name": str(mandate.get("label", "")).split(" (")[0].strip(),
                "fraktion": str(fraction.get("label", "")).split(" (")[0].strip() or None,
                "vote": vote,
                "reason_no_show": entry.get("reason_no_show"),
            }
        )
    return rows


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


def tally(rows: list[dict[str, Any]]) -> dict[Vote, int]:
    """Count each vote value — see `models.votes.tally_votes`.

    Deliberately the same function the XLSX route counts with, so the two can
    be compared directly. They agreed exactly on the ballot checked live:
    519 yes / 43 no / 68 absent from each.
    """
    return tally_votes(row["vote"] for row in rows)
