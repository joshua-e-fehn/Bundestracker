"""Pydantic models for the four sources' wire formats.

One module per source, because they agree on almost nothing: DIP speaks JSON
with two documented-but-wrong field types, Stammdaten and the plenary protocols
speak two unrelated XML dialects, and the vote sheets are a spreadsheet with no
identifier column at all.

What they *do* share is the vocabulary the Convex schema uses at the far end —
notably `votes.Vote`, whose five values keep `absent` and `abstain` distinct
because the sources do (docs/api-research.md §4.1).

`stammdaten.NameIndex` is the bridge. Two of the four sources carry no usable MP
id, so joining them to the roster is name matching, and §7 makes that the
central modelling constraint rather than an implementation detail.
"""

from bundestrack.models.dip import (
    Aktivitaet,
    Beschlussfassung,
    Drucksache,
    DrucksacheText,
    Fundstelle,
    ListResponse,
    Person,
    PersonRole,
    Plenarprotokoll,
    PlenarprotokollText,
    Ueberweisung,
    Vorgang,
    Vorgangsposition,
)
from bundestrack.models.enrichment import (
    MPContact,
    MPEnrichment,
    MPPortrait,
    MPProfileLink,
    PrintedName,
    SocialProfile,
    normalise_printed_name,
)
from bundestrack.models.speeches import (
    BallotBlock,
    BallotName,
    Protocol,
    Speaker,
    Speech,
)
from bundestrack.models.stammdaten import (
    MP,
    CommitteeMembership,
    Mandate,
    MPName,
    NameIndex,
    NameMatch,
    StammdatenDump,
    fold_name,
    parse_german_date,
)
from bundestrack.models.votes import Vote, VoteRecord, VoteSheet, VoteSheetLink

__all__ = [
    "MP",
    "Aktivitaet",
    "BallotBlock",
    "BallotName",
    "Beschlussfassung",
    "CommitteeMembership",
    "Drucksache",
    "DrucksacheText",
    "Fundstelle",
    "ListResponse",
    "MPContact",
    "MPEnrichment",
    "MPName",
    "MPPortrait",
    "MPProfileLink",
    "Mandate",
    "NameIndex",
    "NameMatch",
    "Person",
    "PersonRole",
    "Plenarprotokoll",
    "PlenarprotokollText",
    "PrintedName",
    "Protocol",
    "SocialProfile",
    "Speaker",
    "Speech",
    "StammdatenDump",
    "Ueberweisung",
    "Vorgang",
    "Vorgangsposition",
    "Vote",
    "VoteRecord",
    "VoteSheet",
    "VoteSheetLink",
    "fold_name",
    "normalise_printed_name",
    "parse_german_date",
]
