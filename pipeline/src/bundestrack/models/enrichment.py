"""Models for MP enrichment — portraits, occupation, and contact details.

These fields are what turns a row of initials into a person: a face, what they
did before parliament, and how to reach them. None of it is in DIP, and only
part of it is in Stammdaten, so this is assembled from two further sources
(`api.mp_profiles`, `api.abgeordnetenwatch`).

Three findings shape everything here, all re-verified live on 2026-07-27 and
all correcting docs/api-research.md §6.5, which was written when the portrait
pages could not be reached at all:

- **Portraits exist officially, for everyone.** §6.5 concluded that no bulk
  source existed and settled for Wikimedia Commons at 36.5 % of WP21. The
  Bundestag's own MP listing carries one for **639 of 639** — see
  `api.mp_profiles`.

- **A portrait without its credit is unusable.** §6.5's other warning stands
  and is the reason `credit` is not optional on `MPPortrait`: these are
  photographer-credited works, not open-licensed ones, so the credit travels
  with the URL as one value. Splitting them would make it possible to render a
  face with nobody's name against it.

- **There is no email address and no telephone number.** Not in this model
  because they are not in the sources: `MDB_STAMMDATEN.DTD` declares no contact
  elements at all, and thirteen sampled biography pages carry zero `mailto:`
  and zero `tel:` links. What the Bundestag publishes is a *contact form*, and
  `MPContact.form_url` is that — a URL a reader follows, not an address anything
  can send to. A model with an `email` field would imply the pipeline had simply
  failed to fill it.

⚠ **No MP id is published on either source.** The listing prints
`"Nachname, Vorname"` and nothing else, so joining is by name via §7.1's
algorithm — `normalise_printed_name` here prepares the string, and
`pipeline.join.MPResolver` does the matching.
"""

from __future__ import annotations

import re

from pydantic import BaseModel, ConfigDict

#: Academic titles and post-nominals to drop before matching a printed name.
#:
#: ⚠ **The trailing period is load-bearing.** An alternation of bare words
#: (`Prof|Dr|Ing|Phil|…`) looks equivalent and is not: `\bIng` matches inside
#: `Inge` and `\bPhil` inside `Philipp`, so real forenames get truncated and the
#: MP silently fails to match. Measured: the bare form cost 7 of 639, the
#: period-anchored form costs 0. Every abbreviation the source prints ends in a
#: period (`Prof.`, `Dr.-Ing.`, `habil.`, `M. A.`, `LL.M.`), so requiring one
#: keeps the rule both correct and complete — including the post-nominals, which
#: need no branch of their own: `LL`, `B` and `M` are all within `{1,6}` letters
#: and are matched by the same class as `Prof`.
ACADEMIC_TITLE = re.compile(r"\b[A-Za-zÄÖÜäöüß]{1,6}\.(?:-[A-Za-zÄÖÜäöüß]+\.)?")

#: Name particles the listing prints on the *forename* side of the comma —
#: `Aken, Jan van` — where Stammdaten files them with the surname. Moving them
#: back is what `normalise_printed_name` does; `NameIndex` then indexes the name
#: both ways (models/stammdaten.py), so the particle is passed along rather than
#: guessed at.
NAME_PARTICLES = frozenset(
    {"von", "van", "de", "der", "zu", "den", "dem", "vom", "zur", "le", "du", "da", "di", "dos"}
)

#: Nobiliary particles, which the vote sheets file under a column headed
#: `Titel` that does *not* hold academic titles (§4.1). Treated exactly like
#: `NAME_PARTICLES` because Stammdaten stores them in the same place.
NOBILIARY_PARTICLES = frozenset(
    {
        "freiherr",
        "frhr.",
        "graf",
        "gräfin",
        "baron",
        "freifrau",
        "fürst",
        "ritter",
        "edler",
        "prinz",
    }
)


class PrintedName(BaseModel):
    """A listing's `"Nachname, Vorname"` split into what `NameIndex` needs.

    `particle` is kept separate rather than glued onto either half because
    `NameIndex.resolve` indexes a name under both spellings and takes the
    particle as its own argument (models/stammdaten.py) — pre-joining it here
    would throw away the alternative it needs to try.
    """

    model_config = ConfigDict(frozen=True)

    nachname: str
    vorname: str
    particle: str | None = None


def normalise_printed_name(printed: str) -> PrintedName | None:
    """`"Kaufmann, Prof. Dr.-Ing. habil. Michael"` → the parts that match.

    Two transformations, both undoing a difference between how the Bundestag
    *prints* a name and how Stammdaten *stores* it:

    1. Academic titles are dropped. Stammdaten holds them in `ANREDE_TITEL` and
       `AKAD_TITEL`, separate from the name, so a title left in the forename
       matches nothing.
    2. Trailing particles move off the forename. The listing prints
       `"Aken, Jan van"`; Stammdaten stores `van` in `PRAEFIX` against the
       surname.

    Returns None for a string with no comma, which is how the listing renders
    a non-MP teaser — a caller should skip it rather than match on a guess.

    Measured against the live roster: 635 of 639 resolve, none ambiguously. The
    four that do not are middle initials (`"Hoffmann, Philip M. A."`) and MPs
    missing from the Stammdaten snapshot (§7.3), both of which the quarantine
    already retries.
    """
    if "," not in printed:
        return None
    nachname, _, forename = printed.partition(",")
    nachname = nachname.strip()
    if not nachname:
        return None

    tokens = ACADEMIC_TITLE.sub(" ", forename).split()
    particles: list[str] = []
    while tokens and tokens[-1].casefold() in (NAME_PARTICLES | NOBILIARY_PARTICLES):
        particles.insert(0, tokens.pop())

    return PrintedName(
        nachname=nachname,
        vorname=" ".join(tokens),
        particle=" ".join(particles) or None,
    )


class SocialProfile(BaseModel):
    """One link off an MP's "Profile im Internet" list."""

    model_config = ConfigDict(frozen=True)

    #: As the page labels it — `Homepage`, `Facebook`, `Instagram`, `X`,
    #: `TikTok`, `YouTube`, `Mastodon`. Free text, not an enum: the list is the
    #: Bundestag's and it grows (TikTok and Mastodon are recent additions).
    platform: str
    url: str


class MPContact(BaseModel):
    """How an MP can be reached, as the Bundestag actually publishes it.

    Note what is absent, and why it is absent rather than unfilled: **no email
    address and no telephone number are published anywhere** — see the module
    docstring. `form_url` is the substitute the Bundestag itself offers.
    """

    model_config = ConfigDict(frozen=True)

    #: `/services/formular/contactform?mdbId=1043330`. The `mdbId` is a *fourth*
    #: MP id space — bundestag.de's own CMS id, unrelated to the three in §7 —
    #: so it is carried inside the URL and never used as a join key.
    form_url: str | None = None
    #: The constituency office(s), newline-separated as printed. Absent for
    #: roughly half of MPs, who list no local office.
    #:
    #: The *Berlin* office is deliberately not modelled: it is
    #: `Deutscher Bundestag, Platz der Republik 1, 11011 Berlin` for all 630,
    #: so storing it per row would be 630 copies of a constant.
    constituency_office: str | None = None
    homepage: str | None = None
    socials: tuple[SocialProfile, ...] = ()

    @property
    def is_empty(self) -> bool:
        """Nothing was published — distinct from "not fetched yet"."""
        return not (self.form_url or self.constituency_office or self.homepage or self.socials)


class MPPortrait(BaseModel):
    """An MP's official portrait and the credit that must accompany it.

    `credit` is required, not optional. These images are photographer-credited
    rather than open-licensed (§6.5), so the licence condition is that the
    credit is shown — which makes a portrait without one a thing this pipeline
    must not produce. All 639 sampled carried one.
    """

    model_config = ConfigDict(frozen=True)

    url: str
    #: As printed, e.g. `Sanae Abdi/SPD-Fraktion` or `CDU Elbe-Elster/Andreas
    #: Egeresi`. Rendered verbatim by the UI; the format varies per photographer
    #: and parsing it further would be inventing structure the source has not.
    credit: str


class MPProfileLink(BaseModel):
    """One MP as the listing presents them: a name, a face, and a page.

    The unit the listing yields. `profile_url` is followed separately and only
    when the contact details are missing or stale — it is a ~280 KB page per MP
    against a WAF that counts bytes (§2.6), where the listing gives every
    portrait in ~27 requests.
    """

    model_config = ConfigDict(frozen=True)

    #: `"Abdi, Sanae"`, exactly as printed. Run through
    #: `normalise_printed_name` before matching.
    printed_name: str
    profile_url: str
    portrait: MPPortrait | None = None
    fraktion: str | None = None


class MPEnrichment(BaseModel):
    """Everything known about one MP beyond the roster, keyed by internal id.

    Assembled from up to three sources, each filling what the others leave out:

    | Field | Source | Coverage of WP21 |
    | --- | --- | --- |
    | `portrait` | bundestag.de listing | 100 % published, 99.4 % joined |
    | `occupation` | abgeordnetenwatch | 88.1 % |
    | `education` | abgeordnetenwatch | 83.4 % |
    | `contact` | bundestag.de biography page | ~100 % (form), ~50 % (office) |

    Stammdaten's `BERUF` (94.3 %) is already ingested as `profession` and is
    *not* duplicated here. `occupation` is abgeordnetenwatch's separate
    editorial answer to a related question and the two disagree usefully —
    Stammdaten records a former trade where abgeordnetenwatch often records
    `MdB`.
    """

    model_config = ConfigDict(frozen=True)

    internal_id: str
    portrait: MPPortrait | None = None
    occupation: str | None = None
    education: str | None = None
    contact: MPContact | None = None
