"""Models for named-vote (namentliche Abstimmung) data.

Per-MP votes are **not in the DIP API** (docs/api-research.md §3.2). Three
independent routes carry them, and they cross-validate exactly:

- **A — the official XLSX sheets.** Authoritative, and the only route that
  records *absences*. Modelled by `VoteSheet` / `VoteRecord` below.
- **B — the protocol XML appendix.** Every sitting with XML, no blob-URL
  scraping, but it lists only MPs who *cast* a vote — absences are
  unrecoverable (§4.2). Modelled by `api.protocols.BallotBlock`.
- **C — abgeordnetenwatch.** Clean JSON with stable ids, CC0 (§4.3).

The distinction that runs through all of this is `ABSENT` vs `ABSTAIN`. The
sheet's `nichtabgegeben` means *did not vote*; `Enthaltung` means *voted to
abstain*. They are different acts, and collapsing them flatters everyone who
stayed away — which is why `Vote` keeps them apart and the Convex schema does
too.

⚠ There is **no MP id column** on the sheets. Joining is by name, via the
algorithm in §7.1 that `models.stammdaten.NameIndex` implements.
"""

from __future__ import annotations

# `datetime.date` is imported qualified because `VoteSheet` has a field *named*
# `date`, which would otherwise shadow the type in its own annotation namespace.
import datetime as dt
from collections.abc import Iterable
from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field


class Vote(StrEnum):
    """How one MP voted, in the vocabulary the Convex schema uses.

    Five values because the sheet is one-hot across five columns and every one
    of the 630 rows in the sampled ballot had exactly one flag set (§4.1,
    re-verified here).
    """

    YES = "yes"
    NO = "no"
    ABSTAIN = "abstain"
    INVALID = "invalid"
    ABSENT = "absent"


#: The sheet's five one-hot columns, in sheet order, mapped to `Vote` (§4.1).
#: German keys because they are literal column headers, matched verbatim.
VOTE_COLUMNS: dict[str, Vote] = {
    "ja": Vote.YES,
    "nein": Vote.NO,
    "Enthaltung": Vote.ABSTAIN,
    "ungültig": Vote.INVALID,
    "nichtabgegeben": Vote.ABSENT,
}


#: Every column the sheet publishes, in order (§4.1, verified against a live
#: 2026 sheet). Used to locate columns by name rather than by position, so a
#: reordered export is a mismatch the parser reports instead of silently
#: reading `Vorname` as a surname.
SHEET_COLUMNS = (
    "Wahlperiode",
    "Sitzungnr",
    "Abstimmnr",
    "Fraktion/Gruppe",
    "Name",
    "Vorname",
    "Titel",
    *VOTE_COLUMNS,
    "Bezeichnung",
    "Bemerkung",
)


def blank_to_none(value: object) -> str | None:
    """Trim a source value, treating blank as absent rather than empty.

    Every source here says "no value" with something falsy but not missing: the
    Stammdaten XML always emits the element and leaves it empty (§6.2), the vote
    sheets leave a cell blank, and the DIP JSON sends `""`. All three must reach
    a model as `None` — an empty string still joins, matches and renders
    differently from a missing one, and the name index would build a key for it.
    """
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def tally_votes(votes: Iterable[Vote]) -> dict[Vote, int]:
    """Count votes, with every value present including the zeros.

    Zeros are the point, and the reason this is not a `Counter`: `Enthaltung: 0`
    is a fact about a ballot, and a dict that omitted it would make "nobody
    abstained" indistinguishable from "the column was not parsed".

    Shared by all three vote routes (§4.1–4.3) so their counts are directly
    comparable — cross-validating an XLSX parse against abgeordnetenwatch is
    only meaningful if both sides count the same way.
    """
    counts = dict.fromkeys(Vote, 0)
    for vote in votes:
        counts[vote] += 1
    return counts


class VoteRecord(BaseModel):
    """One MP's vote in one ballot.

    Deliberately carries no MP id: the sheet has none (§4.1). `name`, `vorname`,
    `titel` and `fraktion` are what the name join in §7.1 consumes, and they are
    kept exactly as printed so a later re-match can use them again.
    """

    model_config = ConfigDict(frozen=True)

    wahlperiode: int
    sitzungnr: int
    abstimmnr: int
    fraktion: str | None = None
    #: Surname. ⚠ May carry an Ortszusatz — `Brand (Fulda)` — which is part of
    #: the name and disambiguates identical ones. Do not strip it.
    name: str
    vorname: str
    #: ⚠ **Name particles** (`von`, `van`, `de`, `Frhr. von`), *not* academic
    #: titles, despite the column heading (§4.1). Prepended to the surname as an
    #: alternative join key.
    titel: str | None = None
    vote: Vote
    #: The sheet's display name (`Christian Frhr. von Stetten`).
    bezeichnung: str | None = None
    #: The published reason an absence was excused, e.g. `gesetzlicher
    #: Mutterschutz`.
    bemerkung: str | None = None

    @property
    def ballot_key(self) -> tuple[int, int, int]:
        """`(Wahlperiode, Sitzungnr, Abstimmnr)` — the ballot's natural key."""
        return (self.wahlperiode, self.sitzungnr, self.abstimmnr)


class VoteSheet(BaseModel):
    """One named ballot and all its per-MP records.

    Tallies are counted from the records here rather than read off a header —
    the sheet publishes no totals row — but the Convex schema stores the
    *published* tallies where they exist, so that a partial ingest shows up as a
    disagreement instead of quietly restating the result of a vote.
    """

    wahlperiode: int
    sitzungnr: int
    abstimmnr: int
    #: From the AJAX listing's link text, e.g. `Sportfördergesetz`. Not in the
    #: sheet itself, so it is None for a sheet parsed from bytes alone.
    title: str | None = None
    date: dt.date | None = None
    source_url: str | None = None
    records: list[VoteRecord] = Field(default_factory=list)

    @property
    def key(self) -> tuple[int, int, int]:
        return (self.wahlperiode, self.sitzungnr, self.abstimmnr)

    def tally(self) -> dict[Vote, int]:
        """Count each vote value — see `tally_votes`."""
        return tally_votes(r.vote for r in self.records)

    @property
    def total_eligible(self) -> int:
        """Everyone listed on the sheet — voters and absentees alike.

        This is the denominator a participation rate needs, and it is the reason
        route A is authoritative: the protocol XML (route B) lists only MPs who
        cast a vote, so its equivalent number is silently smaller (§4.2).
        """
        return len(self.records)


class VoteSheetLink(BaseModel):
    """One entry in the named-vote listing — a ballot's downloadable files.

    Discovered by scraping the AJAX endpoint behind
    `bundestag.de/parlament/plenum/abstimmung/liste`, because the blob ids are
    opaque and not derivable from date or sitting number (§4.1).

    `xlsx_url` is None for older ballots: machine-readable sheets go back to
    roughly WP17 (2012/13), and the tail of the listing — verified live at
    offset 1000, reaching 2008–2009 — is **PDF-only** (§4.1). Those entries are
    skipped rather than treated as a parse failure.
    """

    title: str
    pdf_url: str | None = None
    xlsx_url: str | None = None
    date: dt.date | None = None

    @property
    def has_data_sheet(self) -> bool:
        return self.xlsx_url is not None
