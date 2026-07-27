"""MP portraits and contact details: the parsers, and the three silent traps.

The parsing is unremarkable. What is worth testing on its own is that each of
three failure modes here produces *plausible wrong data* rather than an error,
so nothing downstream would notice:

- **A portrait with no credit.** These images are photographer-credited rather
  than open-licensed (docs/api-research.md §6.5), so shipping one without its
  credit is a licensing failure that renders perfectly.
- **The Bundestag's own social accounts.** They sit in the page footer of every
  biography page in markup identical to the MP's own, so a parser that reads the
  whole document gives all 630 MPs the Bundestag's Instagram — a fact about
  every row, which is exactly the kind that stops looking like a bug.
- **A title regex that eats forenames.** `\bIng` matches inside `Inge`. The MP
  then fails to resolve and is reported as a §7.3 snapshot lag, which is a real
  thing that really happens — so the wrong explanation is already sitting there
  waiting to be believed.

Every fixture is real markup, downloaded 2026-07-27 and trimmed to the teasers
and sections that carry a trap.
"""

from __future__ import annotations

import httpx

from bundestrack.api.mp_profiles import (
    SITE_WIDE_SOCIALS,
    MPProfileClient,
    parse_biography,
    parse_listing,
)
from bundestrack.models.enrichment import normalise_printed_name
from tests.conftest import fixture_text, mock_client


def listing() -> str:
    return fixture_text("mp_profiles", "ajax_list_page.html")


def biography() -> str:
    return fixture_text("mp_profiles", "biography_page.html")


# --- the listing ----------------------------------------------------------


def test_the_listing_yields_a_portrait_and_a_page_for_every_teaser() -> None:
    parsed = parse_listing(listing())

    assert [entry.printed_name for entry in parsed.entries] == [
        "Abdi, Sanae",
        "Ahmetović, Adis",
        "Aken, Jan van",
        "Alhamwi, Dr. Alaa",
    ]
    assert all(entry.portrait for entry in parsed.entries)
    assert all(
        entry.profile_url.startswith("https://www.bundestag.de/") for entry in parsed.entries
    )


def test_the_portrait_url_comes_from_the_data_attribute_not_from_src() -> None:
    """`src` is a grey placeholder; the real image is in `data-img-md-retina`.

    A parser reading `src` gets 639 identical placeholder PNGs and no error at
    all — every MP renders, every MP renders the same grey box.
    """
    portrait = parse_listing(listing()).entries[0].portrait
    assert portrait is not None

    assert "/resource/image/" in portrait.url
    assert portrait.url.endswith("abdi_sanae.jpg")
    assert "Image3x4" not in portrait.url


def test_every_portrait_carries_its_photographer_credit() -> None:
    """§6.5: credited, not open-licensed. The credit is the licence condition."""
    credits = [
        entry.portrait.credit for entry in parse_listing(listing()).entries if entry.portrait
    ]

    # Verbatim, and the four shapes are the point: a subject-supplied photo, a
    # subject-and-photographer pair, a bare photographer, and a party press
    # office crediting its own staffer. There is no structure to parse out of
    # that — the credit is displayed as printed.
    assert credits == [
        "Sanae Abdi/SPD-Fraktion",
        "Adis Ahmetović/ Benush Martinez",
        "Martin Heinlein",
        "Bündnis 90/Die Grünen Bundestagsfraktion / Stefan Kaminski",
    ]
    # The parenthesised © wrapper is chrome around the credit, not part of it.
    assert not any("©" in credit or credit.startswith("(") for credit in credits)


def test_a_portrait_without_a_credit_is_dropped_rather_than_shown_bare() -> None:
    """Unusable rather than merely unattributed — so it must not reach the UI.

    All 639 sampled carried one, so reaching this means the source changed. The
    entry survives without its portrait: the profile URL is still what the
    contact fetch needs.
    """
    without_credit = listing().replace("Sanae Abdi/SPD-Fraktion", "")

    entries = parse_listing(without_credit).entries

    assert entries[0].printed_name == "Abdi, Sanae"
    assert entries[0].portrait is None
    assert entries[0].profile_url  # still fetchable for its contact block
    assert entries[1].portrait is not None  # the others are unaffected


def test_the_listing_publishes_its_total() -> None:
    """`data-hits` is what makes the stop condition arithmetic, not a guess."""
    assert parse_listing(listing()).total == 639


# --- pagination -----------------------------------------------------------


def test_pagination_advances_by_rows_received_not_by_the_requested_limit(
    no_pacing: None,
) -> None:
    """⚠ The endpoint ignores `limit` and serves 12 whatever is asked for.

    Verified live against `limit=12`, `24` and `60`. So advancing the offset by
    the *requested* size skips the difference — a `limit=24` run would read
    every other page and enrich half the chamber, with no error anywhere,
    because each page it did read parsed perfectly.
    """
    offsets: list[str | None] = []
    pages = iter([listing(), fixture_text("mp_profiles", "ajax_list_empty.html")])

    def handler(request: httpx.Request) -> httpx.Response:
        offsets.append(request.url.params.get("offset"))
        return httpx.Response(200, text=next(pages, ""))

    client = MPProfileClient(client=mock_client(handler))
    entries = list(client.iter_profiles(limit=24))

    assert len(entries) == 4
    # Four rows were served, so the second request asks for offset 4 — not 24.
    assert offsets == ["0", "4"]


def test_pagination_stops_when_the_total_is_reached(no_pacing: None) -> None:
    """One request, not two, when the first page already covers `data-hits`."""
    requests = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal requests
        requests += 1
        # `data-hits` lowered to the fixture's own length: the real listing says
        # 639, which is why the unmodified fixture pages on.
        return httpx.Response(200, text=listing().replace('data-hits="639"', 'data-hits="4"'))

    client = MPProfileClient(client=mock_client(handler))

    assert len(list(client.iter_profiles())) == 4
    assert requests == 1


def test_pagination_stops_on_an_empty_fragment(no_pacing: None) -> None:
    """The safety net for a listing whose total is absent or wrong."""
    pages = iter([listing(), fixture_text("mp_profiles", "ajax_list_empty.html")])
    client = MPProfileClient(
        client=mock_client(lambda _: httpx.Response(200, text=next(pages, "")))
    )

    assert len(list(client.iter_profiles())) == 4


# --- the biography page ---------------------------------------------------


def test_the_contact_block_is_what_the_bundestag_actually_publishes() -> None:
    contact = parse_biography(biography())

    assert contact.form_url == (
        "https://www.bundestag.de/services/formular/contactform?mdbId=1043330"
    )
    assert contact.homepage == "https://www.sanaeabdi.de"
    assert not contact.is_empty


def test_there_is_no_email_address_and_no_phone_number_to_parse() -> None:
    """Not a gap in the parser — nothing publishes them.

    `MDB_STAMMDATEN.DTD` declares no contact elements at all and the biography
    pages carry zero `mailto:` and zero `tel:` links (13 sampled). This asserts
    the *source* still looks that way, so the day one appears, the model that
    has nowhere to put it fails here rather than silently discarding it.
    """
    page = biography()

    assert "mailto:" not in page
    assert "tel:" not in page
    # What is offered instead is a form — a URL a reader follows.
    assert "/services/formular/contactform" in page


def test_both_constituency_offices_survive_with_their_line_breaks() -> None:
    """`<br>` is the address's structure, and doubled it separates two offices.

    Collapsing all whitespace would run two offices into one unreadable line.
    """
    office = parse_biography(biography()).constituency_office

    assert office is not None
    assert "Wahlkreisbüro Köln-Innenstadt" in office
    assert "Wahlkreisbüro Kalk" in office
    assert "Magnusstraße 18 b" in office
    assert office.splitlines()[0] == "Wahlkreisbüro Köln-Innenstadt"


def test_the_berlin_office_is_not_collected() -> None:
    """It is `Platz der Republik 1` for all 630, so it is a UI constant.

    The fixture contains it; the parser must read past it to the constituency
    office below rather than stopping at the first address it sees.
    """
    office = parse_biography(biography()).constituency_office

    assert "Platz der Republik" in biography()
    assert office is not None
    assert "Platz der Republik" not in office


def test_the_mps_own_social_profiles_are_collected() -> None:
    contact = parse_biography(biography())

    assert [(profile.platform, profile.url) for profile in contact.socials] == [
        ("Facebook", "https://www.facebook.com/sanaeabdispd"),
        ("Instagram", "https://www.instagram.com/sanae_ccaa/"),
        ("TikTok", "https://www.tiktok.com/discover/sanae-abdi"),
        ("X", "https://twitter.com/_sanaeabdi"),
    ]
    # `Homepage` is lifted out of the list rather than left among the socials.
    assert contact.homepage == "https://www.sanaeabdi.de"


def test_the_bundestags_own_accounts_are_not_given_to_the_mp() -> None:
    """⚠ The failure this guards is invisible by being universal.

    The page footer lists the Bundestag's Instagram and Mastodon in markup
    identical to the MP's own. Without the `<aside>` scope and
    `SITE_WIDE_SOCIALS`, every one of the 630 MPs gets them — and a field that
    is wrong for everybody reads as a design decision, not a bug.
    """
    page = biography()
    urls = {profile.url for profile in parse_biography(page).socials}

    # The fixture keeps the footer precisely so this is a real exclusion.
    assert all(site_wide in page for site_wide in SITE_WIDE_SOCIALS)
    assert not (urls & SITE_WIDE_SOCIALS)


def test_a_page_with_no_contact_block_is_empty_rather_than_wrong() -> None:
    contact = parse_biography("<html><body><p>Nothing here</p></body></html>")

    assert contact.is_empty
    assert contact.form_url is None
    assert contact.socials == ()


# --- the name join --------------------------------------------------------


def test_academic_titles_are_stripped_from_the_printed_name() -> None:
    """Stammdaten holds titles in their own fields, apart from the name."""
    name = normalise_printed_name("Kaufmann, Prof. Dr.-Ing. habil. Michael")

    assert name is not None
    assert (name.nachname, name.vorname) == ("Kaufmann", "Michael")


def test_stripping_titles_does_not_eat_a_forename_that_starts_like_one() -> None:
    """⚠ The trap, and the reason `ACADEMIC_TITLE` requires a trailing period.

    A bare alternation (`Prof|Dr|Ing|Phil|…`) reads as equivalent and is not:
    `\\bIng` matches inside `Inge`, `\\bPhil` inside `Philipp`. The MP then
    fails to resolve and gets reported as a §7.3 snapshot lag — a real
    phenomenon, which is what makes the wrong diagnosis so easy to accept.
    Measured: the bare form cost 7 of 639.
    """
    for printed, expected in [
        ("Amthor, Philipp", "Philipp"),
        ("Gräßle, Dr. Inge", "Inge"),
        ("Hahn, Prof. Dr. Ingo", "Ingo"),
        ("Pawlik, Natalie", "Natalie"),
        ("Vogel, Ingo", "Ingo"),
    ]:
        name = normalise_printed_name(printed)
        assert name is not None, printed
        assert name.vorname == expected, printed


def test_a_particle_printed_on_the_forename_moves_to_the_surname() -> None:
    """The listing prints `Aken, Jan van`; Stammdaten files `van` as PRAEFIX.

    Returned separately rather than glued on, because `NameIndex.resolve`
    indexes the surname both ways and takes the particle as its own argument —
    pre-joining it would throw away the alternative it needs to try.
    """
    assert normalise_printed_name("Aken, Jan van") == normalise_printed_name("Aken, Jan van")

    name = normalise_printed_name("Aken, Jan van")
    assert name is not None
    assert (name.nachname, name.vorname, name.particle) == ("Aken", "Jan", "van")

    noble = normalise_printed_name("Stetten, Christian Freiherr von")
    assert noble is not None
    assert (noble.nachname, noble.vorname, noble.particle) == (
        "Stetten",
        "Christian",
        "Freiherr von",
    )


def test_an_ortszusatz_stays_attached_to_the_surname() -> None:
    """Stammdaten stores the parentheses, so re-wrapping would double them —
    one of the two causes of §7.1's 21/630 naive-join failures."""
    name = normalise_printed_name("Brand (Fulda), Michael")

    assert name is not None
    assert name.nachname == "Brand (Fulda)"


def test_a_name_with_no_comma_is_skipped_rather_than_guessed_at() -> None:
    """How the listing renders a non-MP teaser. Matching on half a name would
    resolve to whoever happened to share it."""
    assert normalise_printed_name("Fraktionsvorsitz") is None
    assert normalise_printed_name("") is None
