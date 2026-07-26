"""MdB-Stammdaten — the authoritative MP roster.

A ~950 KB ZIP containing a ~15 MB XML of every MP since 1949 (4 614 records),
downloadable without authentication from
`bundestag.de/resource/blob/472878/MdB-Stammdaten.zip`.

This is the roster, and DIP `/person` is not: `/person` returns 803 records for
WP21 against 630 seats, and `funktion == "MdB"` both over- and under-counts
(docs/api-research.md §6.1). Stammdaten's 635 WP21 mandate rows reconcile to
exactly 630 once departures and late replacements are handled through
`MDBWP_VON`/`MDBWP_BIS` — see `StammdatenDump.roster_on`.

It is also the only machine-readable committee source in existence (§6.3), with
day-level membership dates that DIP's Wahlperiode-granularity roles cannot
match. ⚠ Committee data covers the **current** Wahlperiode only, by design:
WP1–20 carry `Fraktion/Gruppe` entries and nothing else (§6.4). Archiving each
dump per sync is the only way history accumulates.

⚠ The dump lags reality (§7.3). Research saw an MP recorded with WP20 only
despite sitting in WP21, and two MPs in a July 2026 ballot missing entirely. So
`version` — a Unix timestamp — is worth persisting to detect refreshes, and
unmatched vote rows belong in a quarantine to retry rather than dropped.

Parsed with `iterparse`, clearing each `<MDB>` as it completes: the whole tree
is ~15 MB of XML and a `parse()` holds all of it plus the model objects at once.
"""

from __future__ import annotations

import io
import logging
import xml.etree.ElementTree as ET
import zipfile
from collections.abc import Iterator

from bundestrack.api.base import BundestagAPIError, BundestagClient
from bundestrack.models.stammdaten import (
    MP,
    CommitteeMembership,
    Mandate,
    MPName,
    StammdatenDump,
    parse_german_date,
)
from bundestrack.models.votes import blank_to_none

logger = logging.getLogger(__name__)

STAMMDATEN_URL = "https://www.bundestag.de/resource/blob/472878/MdB-Stammdaten.zip"

#: The XML inside the ZIP. The archive also carries the DTD, and a `__MACOSX`
#: resource-fork directory that a naive "first entry" read would pick up.
STAMMDATEN_XML_NAME = "MDB_STAMMDATEN.XML"


class StammdatenClient(BundestagClient):
    """Downloads and parses the MdB-Stammdaten dump.

    Parsing is a pure function of the bytes, so `parse_zip` and `parse_xml` are
    static and testable without the network.
    """

    def fetch(self) -> StammdatenDump:
        """Download the ZIP and parse it (~950 KB over the wire)."""
        return self.parse_zip(self.get_bytes(STAMMDATEN_URL))

    def fetch_version(self) -> str | None:
        """The dump's `<VERSION>` — a Unix timestamp — without a full parse.

        Still downloads the ZIP, since the server offers no metadata endpoint,
        but stops at the first element rather than building 4 614 models.
        """
        data = _read_xml(self.get_bytes(STAMMDATEN_URL))
        for _, element in ET.iterparse(io.BytesIO(data), events=("end",)):
            if element.tag == "VERSION":
                return (element.text or "").strip() or None
            if element.tag == "MDB":
                return None  # VERSION precedes MDB; absent if we got this far
        return None

    @staticmethod
    def parse_zip(data: bytes) -> StammdatenDump:
        return StammdatenClient.parse_xml(_read_xml(data))

    @staticmethod
    def parse_xml(data: bytes) -> StammdatenDump:
        """Parse the roster XML, streaming one `<MDB>` at a time."""
        version: str | None = None
        mps: list[MP] = []
        for element in _iter_top_level(data):
            if element.tag == "VERSION":
                version = (element.text or "").strip() or None
            elif element.tag == "MDB":
                mps.append(_parse_mdb(element))
        return StammdatenDump(version=version, mps=mps)

    @staticmethod
    def iter_mps(data: bytes) -> Iterator[MP]:
        """Stream MPs without holding the whole roster in memory.

        For a pipeline stage that transforms and posts each MP as it goes; use
        `parse_xml` when the name index needs the whole dump anyway.
        """
        for element in _iter_top_level(data):
            if element.tag == "MDB":
                yield _parse_mdb(element)


def _read_xml(data: bytes) -> bytes:
    """Pull `MDB_STAMMDATEN.XML` out of the ZIP.

    Named explicitly rather than taking the first entry: the archive also holds
    the DTD and a `__MACOSX/._MDB_STAMMDATEN.DTD` resource fork, so "first
    entry" is not stable.
    """
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        names = [n for n in archive.namelist() if n.upper().endswith(STAMMDATEN_XML_NAME)]
        if not names:
            raise BundestagAPIError(
                f"{STAMMDATEN_XML_NAME} not found in the Stammdaten ZIP "
                f"(contains {archive.namelist()})"
            )
        return archive.read(names[0])


def _iter_top_level(data: bytes) -> Iterator[ET.Element]:
    """Yield each direct child of `<DOCUMENT>`, freeing it afterwards.

    `iterparse` builds the tree as it goes, so without the `clear()` this would
    cost the same memory as `parse()` — 15 MB of XML plus every model built from
    it. Clearing after each `<MDB>` keeps the parse flat.
    """
    for _, element in ET.iterparse(io.BytesIO(data), events=("end",)):
        if element.tag in ("MDB", "VERSION"):
            yield element
            element.clear()


def _text(element: ET.Element | None, path: str) -> str | None:
    """Child text, with empty meaning absent.

    Every Stammdaten element is always emitted, empty when unset — absence is
    `<TAG/>`, never a missing node (§6.2) — so `""` is this source's normal way
    of saying "no value" and must not become an empty string in the model.
    """
    if element is None:
        return None
    return blank_to_none(element.findtext(path))


def _parse_mdb(element: ET.Element) -> MP:
    bio = element.find("BIOGRAFISCHE_ANGABEN")
    return MP(
        id=_text(element, "ID") or "",
        names=[_parse_name(n) for n in element.findall("NAMEN/NAME")],
        mandates=[_parse_mandate(w) for w in element.findall("WAHLPERIODEN/WAHLPERIODE")],
        geburtsdatum=parse_german_date(_text(bio, "GEBURTSDATUM")),
        geburtsort=_text(bio, "GEBURTSORT"),
        # ⚠ Empty means Germany for historical records — 15.7 % populated
        # overall but 99.7 % for WP21 (§6.2), so a null here is not a gap in
        # the recent data.
        geburtsland=_text(bio, "GEBURTSLAND"),
        sterbedatum=parse_german_date(_text(bio, "STERBEDATUM")),
        geschlecht=_text(bio, "GESCHLECHT"),
        familienstand=_text(bio, "FAMILIENSTAND"),
        religion=_text(bio, "RELIGION"),
        beruf=_text(bio, "BERUF"),
        partei_kurz=_text(bio, "PARTEI_KURZ"),
        vita_kurz=_text(bio, "VITA_KURZ"),
    )


def _parse_name(element: ET.Element) -> MPName:
    return MPName(
        nachname=_text(element, "NACHNAME") or "",
        vorname=_text(element, "VORNAME") or "",
        # Kept exactly as published — it already includes its parentheses, and
        # re-wrapping it is one of the two causes of the naive join's failures
        # (§7.1).
        ortszusatz=_text(element, "ORTSZUSATZ"),
        adel=_text(element, "ADEL"),
        praefix=_text(element, "PRAEFIX"),
        anrede_titel=_text(element, "ANREDE_TITEL"),
        akad_titel=_text(element, "AKAD_TITEL"),
        historie_von=parse_german_date(_text(element, "HISTORIE_VON")),
        historie_bis=parse_german_date(_text(element, "HISTORIE_BIS")),
    )


def _parse_mandate(element: ET.Element) -> Mandate:
    wkr_nummer = _text(element, "WKR_NUMMER")
    return Mandate(
        wahlperiode=int(_text(element, "WP") or 0),
        start_date=parse_german_date(_text(element, "MDBWP_VON")),
        end_date=parse_german_date(_text(element, "MDBWP_BIS")),
        wkr_nummer=int(wkr_nummer) if wkr_nummer and wkr_nummer.isdigit() else None,
        wkr_name=_text(element, "WKR_NAME"),
        wkr_land=_text(element, "WKR_LAND"),
        liste=_text(element, "LISTE"),
        mandatsart=_text(element, "MANDATSART"),
        institutions=[_parse_institution(i) for i in element.findall("INSTITUTIONEN/INSTITUTION")],
    )


def _parse_institution(element: ET.Element) -> CommitteeMembership:
    return CommitteeMembership(
        kind=_text(element, "INSART_LANG") or "",
        name=_text(element, "INS_LANG") or "",
        role=_text(element, "FKT_LANG"),
        start_date=parse_german_date(_text(element, "MDBINS_VON")),
        end_date=parse_german_date(_text(element, "MDBINS_BIS")),
        role_start_date=parse_german_date(_text(element, "FKTINS_VON")),
        role_end_date=parse_german_date(_text(element, "FKTINS_BIS")),
    )
