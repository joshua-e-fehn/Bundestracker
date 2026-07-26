"""Client for the DIP API — `search.dip.bundestag.de/api/v1`.

Sixteen endpoints: eight collections, each with an `/{id}` sibling. All GET;
there are no write operations.

Three behaviours are not obvious from the spec and are handled here:

- **Cursor pagination terminates when the cursor stops changing** — not on an
  empty page and not on a short one (docs/api-research.md §2.2). The rule lives
  in `base.paginate_cursor`; this module just supplies pages to it.

- **The key can be healed.** The Bundestag publishes a working API key inside
  its own OpenAPI spec, which is served unauthenticated, and rotates it roughly
  annually (§1.2). So a 401 is recoverable: re-fetch `openapi.yaml`, parse the
  current key out of the securityScheme description, retry once. Keys found in
  circulating blog posts are expired, and a pipeline that dies overnight on a
  rotation would be down until someone noticed.

- **`f.zuordnung=BT` is passed by default** wherever the endpoint accepts it
  (§5.1). Unfiltered queries mix in Bundesrat documents, which have no XML, use
  an incompatible `dokumentnummer` format that any `.split("/")` misparses, and
  live under a different URL tree.

The key goes in the `Authorization` header rather than the `apikey` query
parameter. Both work, but a key in a query string leaks into access logs, proxy
logs and any error report that echoes the URL (§1.3).
"""

from __future__ import annotations

import logging
import re
from collections.abc import Iterator, Mapping
from typing import Any

import httpx

from bundestrack.api.base import AuthenticationError, BundestagClient, paginate_cursor
from bundestrack.models.dip import (
    Aktivitaet,
    Drucksache,
    DrucksacheText,
    ListResponse,
    Person,
    Plenarprotokoll,
    PlenarprotokollText,
    Vorgang,
    Vorgangsposition,
)

logger = logging.getLogger(__name__)

DEFAULT_BASE_URL = "https://search.dip.bundestag.de/api/v1"

#: Served unauthenticated, and the source of a working key — see `_heal_api_key`.
OPENAPI_URL = f"{DEFAULT_BASE_URL}/openapi.yaml"

#: The key the Bundestag published as of 2026-07-26, verified live. A fallback
#: only: the pipeline reads `BUNDESTAG_API_KEY` first and re-parses the spec
#: when a key stops working, so this being stale costs one extra request rather
#: than an outage.
PUBLISHED_API_KEY = "R2BZaee.DjdCyihKZMf8AOjtScubP2EVydegzjmBIQ"

#: Matches the key inside the securityScheme description, which reads
#: `Beispiel: *ApiKey R2BZaee.DjdCyihKZMf8AOjtScubP2EVydegzjmBIQ*`. Keys are
#: `<prefix>.<secret>`; the optional `ApiKey ` covers both the header and the
#: query scheme's phrasing of the same example.
API_KEY_PATTERN = re.compile(r"(?:ApiKey\s+)?([A-Za-z0-9]{5,}\.[A-Za-z0-9]{20,})")

#: `f.zuordnung` values (§2.4). `BT` is the Bundestag; the pipeline wants no
#: other.
ZUORDNUNG_BT = "BT"

#: Endpoints accepting `f.zuordnung` (§2.4). `/vorgang` and `/person` do not —
#: passing it there is silently ignored rather than rejected, but sending a
#: parameter an endpoint does not document is how a filter comes to look applied
#: when it is not.
ZUORDNUNG_ENDPOINTS = frozenset(
    {
        "vorgangsposition",
        "drucksache",
        "drucksache-text",
        "plenarprotokoll",
        "plenarprotokoll-text",
        "aktivitaet",
    }
)

#: Documents per page, from `maxItems` on each `*ListResponse` schema (§2.2).
#: Not configurable — there is no `limit` parameter — and the `-text` endpoints
#: page at a tenth of the rest, which matters when estimating a backfill:
#: a full WP21 `-text` pull is 9 pages of ~6.8 MB each.
PAGE_SIZE = 100
TEXT_PAGE_SIZE = 10
TEXT_ENDPOINTS = frozenset({"drucksache-text", "plenarprotokoll-text"})


class DIPClient(BundestagClient):
    """Read access to every DIP endpoint.

    Sequential by construction — see `api.base`. Each `iter_*` method walks a
    collection to exhaustion; each `get_*` fetches one entity by id.
    """

    def __init__(
        self,
        api_key: str | None = None,
        *,
        base_url: str = DEFAULT_BASE_URL,
        self_heal_key: bool = True,
        client: httpx.Client | None = None,
        **kwargs: Any,
    ) -> None:
        super().__init__(base_url=base_url, client=client, **kwargs)
        self.api_key = api_key or PUBLISHED_API_KEY
        self.self_heal_key = self_heal_key
        self._healed = False

    # -- transport ---------------------------------------------------------

    def _auth_headers(self) -> dict[str, str]:
        # The literal "ApiKey " prefix is required (§1.3).
        return {"Authorization": f"ApiKey {self.api_key}", "Accept": "application/json"}

    def _get(self, path: str, params: Mapping[str, Any] | None = None) -> Any:
        """One authenticated GET, healing the key once on 401.

        The retry is bounded to a single attempt per client: if the freshly
        published key is also rejected, the problem is not rotation and looping
        on it would just walk into the WAF (§2.6).
        """
        try:
            return self.get_json(path, params=params, headers=self._auth_headers())
        except AuthenticationError:
            if not (self.self_heal_key and not self._healed):
                raise
            self._healed = True
            healed = self._heal_api_key()
            if healed == self.api_key:
                # Same key back means the published one is what we already sent,
                # so this is not a rotation — re-raise rather than retry.
                raise
            self.api_key = healed
            logger.info("DIP API key was rotated; continuing with the published key")
            return self.get_json(path, params=params, headers=self._auth_headers())

    def _heal_api_key(self) -> str:
        """Re-read the current published key from the OpenAPI spec (§1.2).

        The spec is served without authentication, which is exactly what makes
        this possible: a 401 does not block the route to fixing itself. Parsed
        with a regex rather than a YAML load because the key sits in free prose
        inside a description string, so the structure buys nothing.
        """
        logger.warning("DIP API rejected the key — re-reading %s", OPENAPI_URL)
        spec = self.get_text(OPENAPI_URL)
        match = API_KEY_PATTERN.search(spec[spec.find("securitySchemes") :] or spec)
        if not match:
            raise AuthenticationError(
                "The DIP API rejected the key and no key could be parsed out of "
                f"{OPENAPI_URL}. Set BUNDESTAG_API_KEY, or request one from "
                "parlamentsdokumentation@bundestag.de (docs/api-research.md §1.2)."
            )
        return match.group(1)

    # -- pagination --------------------------------------------------------

    def _iter_documents(
        self,
        endpoint: str,
        params: Mapping[str, Any] | None = None,
        *,
        max_pages: int | None = None,
    ) -> Iterator[dict[str, Any]]:
        base_params = self._with_defaults(endpoint, params)

        def fetch_page(cursor: str | None) -> dict[str, Any]:
            page = dict(base_params)
            if cursor:
                page["cursor"] = cursor
            payload = self._get(endpoint, page)
            response = ListResponse.model_validate(payload)
            logger.debug(
                "%s: %d documents of %d total", endpoint, len(response.documents), response.numFound
            )
            return {"documents": response.documents, "cursor": response.cursor}

        return paginate_cursor(fetch_page, max_pages=max_pages)

    def _with_defaults(self, endpoint: str, params: Mapping[str, Any] | None) -> dict[str, Any]:
        merged: dict[str, Any] = {"format": "json"}
        merged.update(params or {})
        # Bundestag-only, unless the caller asked for something else. See the
        # module docstring for the three concrete traps this avoids.
        if endpoint in ZUORDNUNG_ENDPOINTS:
            merged.setdefault("f.zuordnung", ZUORDNUNG_BT)
        return {k: v for k, v in merged.items() if v is not None}

    def count(self, endpoint: str, params: Mapping[str, Any] | None = None) -> int:
        """`numFound` for a query, without paging through it.

        Worth calling before a backfill: `/aktivitaet?f.wahlperiode=21` is
        80 537 records ≈ 806 pages, which at the pacing in §2.6 is a decision
        rather than a detail.
        """
        payload = self._get(endpoint, self._with_defaults(endpoint, params))
        return ListResponse.model_validate(payload).numFound

    @staticmethod
    def page_size(endpoint: str) -> int:
        """Documents per page for an endpoint — 100, or 10 for `-text` (§2.2)."""
        return TEXT_PAGE_SIZE if endpoint in TEXT_ENDPOINTS else PAGE_SIZE

    # -- filters -----------------------------------------------------------

    @staticmethod
    def _filters(
        wahlperiode: int | None = None,
        *,
        updated_since: str | None = None,
        date_from: str | None = None,
        date_to: str | None = None,
        **extra: Any,
    ) -> dict[str, Any]:
        """Build the common `f.`-prefixed filter set.

        `updated_since` maps to `f.aktualisiert.start`, which is what a daily
        sync must filter on: documents get amended retroactively, and a
        `datum`-based sync silently misses those edits (§2.5). It is an ISO 8601
        datetime *with offset* — `2026-07-01T00:00:00+02:00`.
        """
        params: dict[str, Any] = {
            "f.wahlperiode": wahlperiode,
            "f.aktualisiert.start": updated_since,
            "f.datum.start": date_from,
            "f.datum.end": date_to,
        }
        params.update(extra)
        return {k: v for k, v in params.items() if v is not None}

    # -- /person -----------------------------------------------------------

    def iter_personen(
        self, wahlperiode: int | None = None, *, updated_since: str | None = None, **extra: Any
    ) -> Iterator[Person]:
        """Every matching person record.

        ⚠ Not a roster — 803 records for a 630-seat chamber (§6.1). Use this to
        obtain the DIP id that `/aktivitaet` joins on; the roster is Stammdaten.

        The whole corpus is 5 623 records / 57 pages, so it is cheap to fetch
        once and cache, then sync deltas with `updated_since` (§6.1).
        """
        params = self._filters(wahlperiode, updated_since=updated_since, **extra)
        for doc in self._iter_documents("person", params):
            yield Person.model_validate(doc)

    def get_person(self, person_id: str) -> Person:
        """One person by DIP id.

        ⚠ Takes a **DIP** id (`1013`), not a Stammdaten id (`11004011`) —
        the latter 404s here (§7). `api.protocols` yields the Stammdaten kind.
        """
        return Person.model_validate(self._get(f"person/{person_id}", {"format": "json"}))

    def find_person(self, query: str) -> list[Person]:
        """Search by name via `f.person`.

        Whole-token matching: one token matches given *or* surname, several are
        a phrase in **`"Nachname Vorname"`** order — `find_person("Bilger
        Steffen")`, not `"Steffen Bilger"` (§6.1).

        ⚠ Umlaut hazard: DIP normalises inconsistently, holding `Özoguz` where
        Stammdaten has `Özoğuz`. Fold diacritics before comparing results
        (`models.stammdaten.fold_name`).
        """
        return list(self.iter_personen(**{"f.person": query}))

    # -- /aktivitaet -------------------------------------------------------

    def iter_aktivitaeten(
        self,
        wahlperiode: int | None = None,
        *,
        person_id: str | None = None,
        plenarprotokoll_id: str | None = None,
        updated_since: str | None = None,
        **extra: Any,
    ) -> Iterator[Aktivitaet]:
        """The per-MP activity feed — the activity score's backbone (§3.5).

        One record per MP per action, carrying `person_id` directly, so this is
        the only DIP source that needs no name matching. `plenarprotokoll_id`
        narrows to one sitting, which is how XML-extracted speeches get
        reconciled against DIP person ids (§5.2).
        """
        params = self._filters(
            wahlperiode,
            updated_since=updated_since,
            **{"f.person_id": person_id, "f.plenarprotokoll": plenarprotokoll_id},
            **extra,
        )
        for doc in self._iter_documents("aktivitaet", params):
            yield Aktivitaet.model_validate(doc)

    def get_aktivitaet(self, aktivitaet_id: str) -> Aktivitaet:
        return Aktivitaet.model_validate(
            self._get(f"aktivitaet/{aktivitaet_id}", {"format": "json"})
        )

    # -- /vorgang ----------------------------------------------------------

    def iter_vorgaenge(
        self, wahlperiode: int | None = None, *, updated_since: str | None = None, **extra: Any
    ) -> Iterator[Vorgang]:
        params = self._filters(wahlperiode, updated_since=updated_since, **extra)
        for doc in self._iter_documents("vorgang", params):
            yield Vorgang.model_validate(doc)

    def get_vorgang(self, vorgang_id: str) -> Vorgang:
        return Vorgang.model_validate(self._get(f"vorgang/{vorgang_id}", {"format": "json"}))

    # -- /vorgangsposition -------------------------------------------------

    def iter_vorgangspositionen(
        self,
        wahlperiode: int | None = None,
        *,
        vorgang_id: str | None = None,
        updated_since: str | None = None,
        **extra: Any,
    ) -> Iterator[Vorgangsposition]:
        """Procedure steps — committee referrals and decisions (§3.3, §3.2)."""
        params = self._filters(
            wahlperiode, updated_since=updated_since, **{"f.vorgang": vorgang_id}, **extra
        )
        for doc in self._iter_documents("vorgangsposition", params):
            yield Vorgangsposition.model_validate(doc)

    def get_vorgangsposition(self, position_id: str) -> Vorgangsposition:
        return Vorgangsposition.model_validate(
            self._get(f"vorgangsposition/{position_id}", {"format": "json"})
        )

    def iter_namentliche_abstimmungen(
        self, wahlperiode: int | None = None, **extra: Any
    ) -> Iterator[Vorgangsposition]:
        """Procedure steps that recorded a roll-call vote.

        How the pipeline *discovers* which ballots exist. The per-MP votes are
        not here — `Beschlussfassung` carries the outcome and nothing else
        (§3.2) — so each hit points at work for `api.votes` or `api.protocols`.

        Filtered client-side because `abstimmungsart` is a field of a nested
        `beschlussfassung[]` object and no `f.` parameter reaches into it.
        """
        for position in self.iter_vorgangspositionen(wahlperiode, **extra):
            if position.is_namentliche_abstimmung:
                yield position

    # -- /drucksache -------------------------------------------------------

    def iter_drucksachen(
        self, wahlperiode: int | None = None, *, updated_since: str | None = None, **extra: Any
    ) -> Iterator[Drucksache]:
        params = self._filters(wahlperiode, updated_since=updated_since, **extra)
        for doc in self._iter_documents("drucksache", params):
            yield Drucksache.model_validate(doc)

    def get_drucksache(self, drucksache_id: str) -> Drucksache:
        return Drucksache.model_validate(
            self._get(f"drucksache/{drucksache_id}", {"format": "json"})
        )

    def iter_drucksachen_text(
        self, wahlperiode: int | None = None, **extra: Any
    ) -> Iterator[DrucksacheText]:
        """Printed papers with full text.

        ⚠ Pages at **10**, not 100 (§2.2), and the pages are megabytes. The WAF
        counts bytes as well as requests (§2.6), so prefer the metadata endpoint
        and fetch the PDFs you actually need.
        """
        params = self._filters(wahlperiode, **extra)
        for doc in self._iter_documents("drucksache-text", params):
            yield DrucksacheText.model_validate(doc)

    def get_drucksache_text(self, drucksache_id: str) -> DrucksacheText:
        return DrucksacheText.model_validate(
            self._get(f"drucksache-text/{drucksache_id}", {"format": "json"})
        )

    # -- /plenarprotokoll --------------------------------------------------

    def iter_plenarprotokolle(
        self, wahlperiode: int | None = None, *, updated_since: str | None = None, **extra: Any
    ) -> Iterator[Plenarprotokoll]:
        """Protocol metadata — the index of sittings to fetch XML for.

        There is no directory listing of protocol XMLs on the document server,
        so this endpoint *is* the index (§5.2). Each record carries
        `fundstelle.xml_url` and an undocumented `xml_hash` to gate re-downloads.
        """
        params = self._filters(wahlperiode, updated_since=updated_since, **extra)
        for doc in self._iter_documents("plenarprotokoll", params):
            yield Plenarprotokoll.model_validate(doc)

    def get_plenarprotokoll(self, protokoll_id: str) -> Plenarprotokoll:
        return Plenarprotokoll.model_validate(
            self._get(f"plenarprotokoll/{protokoll_id}", {"format": "json"})
        )

    def iter_plenarprotokolle_text(
        self, wahlperiode: int | None = None, **extra: Any
    ) -> Iterator[PlenarprotokollText]:
        """Protocols with full text.

        ⚠ **Not the way to get speeches.** The `text` field is one flat string
        per sitting; regex-segmenting it inflates word counts by +53.6 % and
        misses 35 speakers (§5.1). A full WP21 pull here is 9 pages ≈ 61 MB.
        Use `api.protocols` on `fundstelle.xml_url` instead. Kept for
        completeness of the endpoint surface.
        """
        params = self._filters(wahlperiode, **extra)
        for doc in self._iter_documents("plenarprotokoll-text", params):
            yield PlenarprotokollText.model_validate(doc)

    def get_plenarprotokoll_text(self, protokoll_id: str) -> PlenarprotokollText:
        return PlenarprotokollText.model_validate(
            self._get(f"plenarprotokoll-text/{protokoll_id}", {"format": "json"})
        )
