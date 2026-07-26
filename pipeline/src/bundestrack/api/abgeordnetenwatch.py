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

This host is **not** behind the Enodia WAF — it is not a bundestag.de domain —
but it goes through the same paced client anyway. Being polite to a volunteer
project's servers is not a lesser obligation than being polite to the
Bundestag's.
"""

from __future__ import annotations

import logging
from collections.abc import Iterator
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


def tally(rows: list[dict[str, Any]]) -> dict[Vote, int]:
    """Count each vote value — see `models.votes.tally_votes`.

    Deliberately the same function the XLSX route counts with, so the two can
    be compared directly. They agreed exactly on the ballot checked live:
    519 yes / 43 no / 68 absent from each.
    """
    return tally_votes(row["vote"] for row in rows)
