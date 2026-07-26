"""Named-vote data sheets — the authoritative per-MP vote source.

Per-MP votes are not in the DIP API (docs/api-research.md §3.2). The Bundestag
publishes them as XLSX sheets, and this is the **only** route that records
absences: the protocol XML lists just the MPs who cast a vote (§4.2), and
abgeordnetenwatch is community-run and curated (§4.3).

Two mechanics make this more than a download:

- **The URLs must be scraped.** Blob ids like `1194616` are opaque and not
  derivable from date or sitting number, so the listing behind
  `bundestag.de/parlament/plenum/abstimmung/liste` is the index (§4.1). It is an
  AJAX endpoint returning an HTML fragment, paginated by `limit`/`offset`.

- **Older ballots have no sheet.** Machine-readable sheets reach back to roughly
  WP17 (2012/13); before that the listing carries a PDF and nothing else.
  Verified live: offset 1000 returns 2008–2009 ballots with a PDF link, no
  XLSX, and an empty date cell; the listing runs out at ~1 015 entries, where
  the endpoint starts returning a ~1 KB empty fragment. (This settles §11.4's
  open question 5, where two research passes disagreed.) Those rows are yielded
  with `xlsx_url=None` rather than dropped, so a caller can see what exists
  without a data sheet instead of inferring it from a gap.

The sheet itself is one-hot across five columns and every one of the 630 rows in
the ballot sampled here had exactly one flag set (§4.1). `parse_sheet` treats a
violation as an error rather than picking whichever column it read first — with
five mutually exclusive columns, a row with two flags is a sheet whose meaning
this code does not know.
"""

from __future__ import annotations

import datetime as dt
import io
import logging
import re
from collections.abc import Iterator
from html.parser import HTMLParser

import openpyxl

from bundestrack.api.base import BundestagAPIError, BundestagClient
from bundestrack.models.votes import (
    SHEET_COLUMNS,
    VOTE_COLUMNS,
    VoteRecord,
    VoteSheet,
    VoteSheetLink,
    blank_to_none,
)

logger = logging.getLogger(__name__)

#: The AJAX endpoint backing the named-vote listing. The `462112-462112` segment
#: is the CMS's id for that page's list widget; it is part of the path, not a
#: parameter, and changes if the Bundestag rebuilds the page.
VOTE_LIST_URL = (
    "https://www.bundestag.de/ajax/filterlist/de/parlament/plenum/abstimmung/liste/462112-462112"
)

#: Rows per request. The endpoint accepts more, but each row carries an inline
#: SVG icon, so a page of 30 is already ~190 KB and the WAF counts bytes (§2.6).
LIST_PAGE_SIZE = 30

#: Stop after this many entries even if the listing keeps answering. The real
#: listing ends at ~1 015 (verified); this is a runaway guard, not the contract.
MAX_LIST_ENTRIES = 2_000

#: Sheet names encode the ballot: `A_Export_Fraktionen_21_90_8` = WP21,
#: sitting 90, ballot 8 (§4.1). Used only as a fallback — the columns carry the
#: same three numbers on every row and are preferred.
SHEET_NAME_PATTERN = re.compile(r"(\d+)_(\d+)_(\d+)\s*$")

_GERMAN_MONTHS = {
    "januar": 1,
    "februar": 2,
    "märz": 3,
    "april": 4,
    "mai": 5,
    "juni": 6,
    "juli": 7,
    "august": 8,
    "september": 9,
    "oktober": 10,
    "november": 11,
    "dezember": 12,
}
_GERMAN_DATE = re.compile(r"(\d{1,2})\.\s*([A-Za-zä]+)\s*(\d{4})")
_NUMERIC_DATE = re.compile(r"(\d{1,2})\.(\d{1,2})\.(\d{4})")


class VoteListParser(HTMLParser):
    """Pulls ballot entries out of the listing's HTML fragment.

    `html.parser` rather than BeautifulSoup or lxml: the fragment is a flat
    `<tr>` sequence with the PDF as the primary link and the XLSX as an
    additional one, so a streaming parser reads it without another dependency.

    One entry per `<tr>`. Within a row the first `<span>` inside the PDF anchor
    is the ballot title; the date is the first `<td>`, which is empty for the
    pre-2012 rows.
    """

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.entries: list[VoteSheetLink] = []
        self._row: dict[str, object] | None = None
        self._cell_index = -1
        self._capture: str | None = None
        self._buffer: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attributes = dict(attrs)
        if tag == "tr":
            self._row = {"title": None, "pdf": None, "xlsx": None, "date": None}
            self._cell_index = -1
        elif tag == "td" and self._row is not None:
            self._cell_index += 1
            # The date lives in the first cell, and is blank for older ballots.
            self._capture = "date" if self._cell_index == 0 else None
            self._buffer = []
        elif tag == "a" and self._row is not None:
            href = attributes.get("href") or ""
            if href.endswith(".xlsx"):
                self._row["xlsx"] = href
            elif href.endswith(".pdf") and not self._row["pdf"]:
                self._row["pdf"] = href
        elif tag == "span" and self._row is not None and self._row["title"] is None:
            # The title span is the one *without* a role: the sibling
            # `role="img"` span holds the download icon's label.
            if not attributes.get("role"):
                self._capture = "title"
                self._buffer = []

    def handle_data(self, data: str) -> None:
        if self._capture:
            self._buffer.append(data)

    def handle_endtag(self, tag: str) -> None:
        if self._row is None:
            return
        if tag in ("span", "td") and self._capture:
            text = " ".join("".join(self._buffer).split())
            if text:
                if self._capture == "title" and self._row["title"] is None:
                    self._row["title"] = text
                elif self._capture == "date":
                    self._row["date"] = parse_listing_date(text)
            self._capture = None
            self._buffer = []
        elif tag == "tr":
            row, self._row = self._row, None
            if row["pdf"] or row["xlsx"]:
                self.entries.append(
                    VoteSheetLink(
                        title=str(row["title"] or "").strip() or "(untitled ballot)",
                        pdf_url=row["pdf"],  # type: ignore[arg-type]
                        xlsx_url=row["xlsx"],  # type: ignore[arg-type]
                        date=row["date"],  # type: ignore[arg-type]
                    )
                )


def parse_listing_date(text: str) -> dt.date | None:
    """`10. Juli 2026` or `10.07.2026` → a date. Blank cells give None.

    Both spellings occur, and the pre-2012 rows have no date at all — those must
    return None rather than raise, since a whole era of the listing is like that.
    """
    if match := _NUMERIC_DATE.search(text):
        day, month, year = match.groups()
        return dt.date(int(year), int(month), int(day))
    if match := _GERMAN_DATE.search(text):
        day, month_name, year = match.groups()
        month = _GERMAN_MONTHS.get(month_name.casefold())
        if month:
            return dt.date(int(year), month, int(day))
    return None


class VoteClient(BundestagClient):
    """Discovers and downloads the official named-vote data sheets."""

    def iter_vote_links(
        self, *, limit: int = LIST_PAGE_SIZE, max_entries: int = MAX_LIST_ENTRIES
    ) -> Iterator[VoteSheetLink]:
        """Walk the listing, newest ballot first.

        Terminates when a page yields no entries — the endpoint answers past the
        end with a ~1 KB empty fragment rather than an error (verified at offset
        1020).

        ⚠ The listing ignores every GET-style date parameter tried in research
        (`dateFrom`/`dateTo`, `startDate`/`endDate`, `date`, and the widget's
        own `-start`/`-end`), returning the newest rows regardless (§11.4). So
        an incremental sync cannot ask the server for "ballots since X" — page
        from the top and stop on the first ballot already stored.
        """
        offset = 0
        seen = 0
        while seen < max_entries:
            parser = VoteListParser()
            parser.feed(
                self.get_text(
                    VOTE_LIST_URL,
                    params={
                        "limit": limit,
                        "noFilterSet": "true",
                        "offset": offset,
                    },
                )
            )
            if not parser.entries:
                return
            for entry in parser.entries:
                yield entry
                seen += 1
            offset += limit

    def fetch_sheet(self, link: VoteSheetLink) -> VoteSheet:
        """Download and parse one ballot's data sheet."""
        if not link.xlsx_url:
            raise ValueError(
                f"{link.title!r} has no XLSX — ballots before ~2012 are PDF-only "
                "(docs/api-research.md §4.1). Check `has_data_sheet` first."
            )
        return parse_sheet(
            self.get_bytes(link.xlsx_url),
            source_url=link.xlsx_url,
            title=link.title,
            sheet_date=link.date,
        )

    def iter_sheets(self, *, max_entries: int = MAX_LIST_ENTRIES) -> Iterator[VoteSheet]:
        """Every ballot that has a machine-readable sheet, newest first.

        PDF-only entries are logged and skipped: they are a coverage boundary,
        not a failure, and a silent skip would make the boundary invisible.
        """
        for link in self.iter_vote_links(max_entries=max_entries):
            if not link.has_data_sheet:
                logger.info("No data sheet for %r (%s) — PDF only", link.title, link.date)
                continue
            yield self.fetch_sheet(link)


def parse_sheet(
    data: bytes,
    *,
    source_url: str | None = None,
    title: str | None = None,
    sheet_date: dt.date | None = None,
) -> VoteSheet:
    """Parse one XLSX data sheet into a `VoteSheet`.

    Columns are located **by header name**, not by position: a reordered export
    would otherwise be read silently, with `Vorname` landing in `name`. A
    missing column is an error naming what was missing.
    """
    workbook = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    try:
        worksheet = workbook[workbook.sheetnames[0]]
        rows = worksheet.iter_rows(values_only=True)
        try:
            header = [str(c).strip() if c is not None else "" for c in next(rows)]
        except StopIteration:
            raise BundestagAPIError(f"Empty vote sheet ({source_url or 'no URL'})") from None

        missing = [c for c in SHEET_COLUMNS if c not in header]
        if missing:
            raise BundestagAPIError(
                f"Vote sheet {source_url or ''} is missing columns {missing}. "
                f"Got {header}. The published schema is in docs/api-research.md §4.1."
            )
        column = {name: header.index(name) for name in SHEET_COLUMNS}
        records = [
            record for row in rows if (record := _parse_row(row, column, source_url)) is not None
        ]
    finally:
        # read_only mode keeps the zip handle open until closed explicitly.
        workbook.close()

    if not records:
        raise BundestagAPIError(f"Vote sheet {source_url or ''} contained no vote rows")

    first = records[0]
    return VoteSheet(
        wahlperiode=first.wahlperiode,
        sitzungnr=first.sitzungnr,
        abstimmnr=first.abstimmnr,
        title=title,
        date=sheet_date,
        source_url=source_url,
        records=records,
    )


def _parse_row(
    row: tuple[object, ...], column: dict[str, int], source_url: str | None
) -> VoteRecord | None:
    """One sheet row → one `VoteRecord`. Blank padding rows give None."""
    surname = blank_to_none(row[column["Name"]])
    if not surname:
        return None  # trailing blank row

    flags = [vote for header, vote in VOTE_COLUMNS.items() if _is_set(row[column[header]])]
    if len(flags) != 1:
        # One-hot across five columns, verified on every one of 630 rows (§4.1).
        # Guessing here would silently invent a vote that was never cast.
        raise BundestagAPIError(
            f"Vote row for {surname!r} in {source_url or 'sheet'} has "
            f"{len(flags)} vote flags set ({[f.value for f in flags]}), expected exactly 1. "
            "The sheet encodes votes one-hot across ja/nein/Enthaltung/ungültig/"
            "nichtabgegeben (docs/api-research.md §4.1)."
        )

    return VoteRecord(
        wahlperiode=int(row[column["Wahlperiode"]]),  # type: ignore[arg-type]
        sitzungnr=int(row[column["Sitzungnr"]]),  # type: ignore[arg-type]
        abstimmnr=int(row[column["Abstimmnr"]]),  # type: ignore[arg-type]
        fraktion=blank_to_none(row[column["Fraktion/Gruppe"]]),
        name=surname,
        vorname=blank_to_none(row[column["Vorname"]]) or "",
        titel=blank_to_none(row[column["Titel"]]),
        vote=flags[0],
        bezeichnung=blank_to_none(row[column["Bezeichnung"]]),
        bemerkung=blank_to_none(row[column["Bemerkung"]]),
    )


def _is_set(value: object) -> bool:
    """Whether a one-hot flag column is set.

    Accepts `1`, `"1"` and `1.0`: the sheets are exported by hand and openpyxl
    types a cell from whatever the exporter wrote, so the same column can come
    back as int or str across sittings.
    """
    if value is None:
        return False
    if isinstance(value, bool):
        return value
    if isinstance(value, int | float):
        return value == 1
    return str(value).strip() in {"1", "1.0"}
