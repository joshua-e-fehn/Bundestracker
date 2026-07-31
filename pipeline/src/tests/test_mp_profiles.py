"""Tests for `api.mp_profiles` — the listing and biography parsers.

The module had fixtures under `fixtures/mp_profiles/` and no test file at all,
which is a gap worth naming: it is the only parser in the pipeline that reads a
*page designed for humans* rather than a documented feed, so it is the one whose
assumptions decay silently when the CMS is restyled.

## The claim these tests exist to hold

The site publishes **no per-member email address and no per-member telephone
number**, and the whole contact contract — the schema, the card, the copy in
both locales — rests on that. It was re-measured on 2026-07-31 across 110
biography pages (60 consecutive from `Abdi`, plus every 13th of all 639 so that
every Fraktion is represented): zero addresses, zero numbers, on every one.

That is a *negative* claim, and a negative claim is exactly what a parser can
break without failing. If a future edit widened link collection past the
`<aside>`, nothing here would throw — the pipeline would simply start attaching
something to members. So the trap is pinned directly:

- Every biography page carries `data-share-mail='mailto:?subject=…'`, the
  share-this-article link in the page chrome. It is a `mailto:` with an **empty
  recipient**, and it is on all 110 sampled pages. It is the single most likely
  thing to be mistaken for a published address by anyone who greps for
  `mailto:`, and the trimmed fixture does not contain it — so
  `test_the_site_wide_share_link_is_not_a_contact` builds it explicitly.
- The `Abgeordnetenbüro` block links the contact form under a visually hidden
  label that reads literally `(E-Mail)`. It is a *form*, not an address; the
  fixture has it, and `test_the_form_link_is_a_form_not_an_address` says so.
"""

from __future__ import annotations

from bundestrack.api.mp_profiles import (
    SITE_WIDE_SOCIALS,
    BiographyParser,
    absolute,
    parse_biography,
    parse_listing,
)
from tests.conftest import fixture_text


def biography() -> str:
    return fixture_text("mp_profiles", "biography_page.html")


# --- the listing ----------------------------------------------------------


def test_the_listing_yields_a_named_portrait_with_its_credit() -> None:
    """The unit the listing exists to give: a name, a face, and the credit that
    makes the face usable. `credit` is required on `MPPortrait` because these
    images are photographer-credited rather than open-licensed (§6.5)."""
    parser = parse_listing(fixture_text("mp_profiles", "ajax_list_page.html"))

    assert parser.entries
    abdi = parser.entries[0]
    assert abdi.printed_name == "Abdi, Sanae"
    assert abdi.profile_url.endswith("/abgeordnete/biografien/A/abdi_sanae-1043330")
    assert abdi.portrait is not None
    assert abdi.portrait.credit == "Sanae Abdi/SPD-Fraktion"
    # `data-img-md-retina`, never `src` — `src` holds a grey placeholder, so a
    # parser reading it gets 639 identical images and no error to notice.
    assert abdi.portrait.url.endswith("/abdi_sanae.jpg")
    assert "Image3x4_small.png" not in abdi.portrait.url


def test_the_listing_publishes_its_own_total() -> None:
    """`data-hits` is what makes `iter_profiles`' stop condition arithmetic
    rather than a guess about when an empty page means the end."""
    assert parse_listing(fixture_text("mp_profiles", "ajax_list_page.html")).total == 639


def test_an_exhausted_listing_yields_nothing_rather_than_raising() -> None:
    """Past the end the endpoint answers a valid, empty fragment. That is the
    safety net behind the `data-hits` arithmetic, so it must parse cleanly."""
    parser = parse_listing(fixture_text("mp_profiles", "ajax_list_empty.html"))
    assert parser.entries == []


# --- the biography page ---------------------------------------------------


def test_the_biography_page_publishes_no_email_and_no_phone() -> None:
    """The claim the whole contact contract rests on, pinned on real markup.

    `MPContact` has no field for either, so this asserts against the parser's
    own state rather than a stored column: whatever the page carries, nothing
    that looks like an address or a number is picked up and carried forward.
    """
    contact = parse_biography(biography())

    values = [contact.form_url, contact.constituency_office, contact.homepage]
    values += [social.url for social in contact.socials]
    for value in values:
        assert value is None or "mailto:" not in value
        assert value is None or "tel:" not in value
    # No field holds a bare address either — the form URL is the only thing on
    # the page that is *about* mail, and it is a URL to a form.
    assert not any(value and "@" in value for value in values if value != contact.homepage)


def test_the_form_link_is_a_form_not_an_address() -> None:
    """The `Abgeordnetenbüro` block labels the contact form `(E-Mail)` in a
    visually hidden span. It is the closest thing on the page to a published
    address and it is still a web form — which is precisely why the UI prints a
    line saying so instead of labelling it "E-Mail"."""
    contact = parse_biography(biography())

    assert contact.form_url is not None
    assert "/services/formular/contactform?mdbId=1043330" in contact.form_url
    assert contact.form_url.startswith("https://www.bundestag.de/")
    assert not contact.form_url.startswith("mailto:")


def test_the_site_wide_share_link_is_not_a_contact() -> None:
    """The one realistic false positive, and it is on every page.

    Every biography page carries `data-share-mail='mailto:?subject=Empfehlung…'`
    — the "email this article" control, with **no recipient**. A `mailto:` grep
    finds it on all 110 pages sampled on 2026-07-31 and on nothing else. The
    trimmed fixture drops the chrome that holds it, so it is reconstructed here:
    a test that only ran against the fixture would pass while a parser that
    scraped it shipped an empty address for all 630 members.
    """
    page = biography().replace(
        '<div class="bt-footer">',
        '<div id="globalConfigSettings" '
        "data-share-mail='mailto:?subject=Empfehlung%20aus%20dem%20Internetauftritt'>"
        "</div>"
        '<a href="mailto:?subject=Empfehlung">Seite empfehlen</a>'
        '<div class="bt-footer">',
        1,
    )

    contact = parse_biography(page)

    assert contact.form_url is not None, "the real form link must survive the injection"
    assert "mailto:" not in contact.form_url
    assert all("mailto:" not in social.url for social in contact.socials)
    assert contact.homepage is None or "mailto:" not in contact.homepage


def test_a_tel_link_in_the_aside_is_not_collected() -> None:
    """No sampled page carries one — but "the source does not do this today" is
    not a parser guarantee. If the Bundestag ever adds a `tel:`, it must arrive
    as a deliberate schema change rather than silently as a social profile
    labelled "Telefon", which is what an unfiltered link collector would do.
    """
    page = biography().replace(
        '<a title="Homepage"',
        '<a title="Telefon" href="tel:+493022770000" class="a-link">'
        '<span>Telefon</span></a>\n<a title="Homepage"',
        1,
    )

    contact = parse_biography(page)

    assert all(not social.url.startswith("tel:") for social in contact.socials)
    assert contact.homepage is not None and not contact.homepage.startswith("tel:")


def test_the_constituency_office_keeps_the_line_breaks_it_was_printed_with() -> None:
    """Two offices in one `<p>`, separated by a doubled `<br>`. The whitespace
    is the address's structure — collapsing it merges two addresses into one
    that reaches neither."""
    contact = parse_biography(biography())

    assert contact.constituency_office is not None
    lines = contact.constituency_office.split("\n")
    assert lines[0] == "Wahlkreisbüro Köln-Innenstadt"
    assert "Magnusstraße 18 b" in lines
    assert "Wahlkreisbüro Kalk" in lines


def test_the_berlin_office_is_not_stored_as_a_constituency_office() -> None:
    """`Platz der Republik 1` is the same for all 630 and is printed by the UI
    from the dictionary. Capturing it here would put a constant in 630 rows and
    make every member look like they had a local office."""
    contact = parse_biography(biography())

    assert contact.constituency_office is not None
    assert "Platz der Republik" not in contact.constituency_office


def test_the_members_own_profiles_are_collected_and_the_bundestags_are_not() -> None:
    """The footer lists the Bundestag's own accounts in markup identical to the
    member's. Without both defences — the `<aside>` scope and `SITE_WIDE_SOCIALS`
    — every member inherits the Bundestag's Instagram as if it were their own."""
    contact = parse_biography(biography())

    platforms = {social.platform for social in contact.socials}
    assert {"Facebook", "Instagram", "TikTok", "X"} <= platforms
    assert contact.homepage == "https://www.sanaeabdi.de"
    # The homepage is lifted out of `socials` rather than duplicated in it.
    assert "Homepage" not in platforms

    urls = {social.url for social in contact.socials}
    assert not (urls & SITE_WIDE_SOCIALS)
    assert not any("instagram.com/bundestag/" in url for url in urls)


def test_a_page_with_no_aside_yields_an_empty_contact_rather_than_raising() -> None:
    """ "Published nothing" is a real state — about 12 of 635 in WP21 — and it is
    distinct from "not fetched". `is_empty` is what the sync stage tests to
    decide whether to stamp the page as read."""
    contact = parse_biography("<html><body><h1>Someone</h1></body></html>")

    assert contact.is_empty
    assert contact.form_url is None
    assert contact.socials == ()


def test_the_duplicated_marginal_column_is_read_once() -> None:
    """A real page carries the `Marginalspalte` aside **twice** — once for the
    mobile layout and once for the desktop one, with identical content. Both are
    parsed, so the dedup in `_link` is what keeps one office from becoming two
    and one profile list from being printed twice.

    This is why the parser deliberately does *not* stop after the first
    `</aside>`: the fixture is trimmed to one, but production markup is not, and
    a parser that closed for good would still pass every fixture-only test.
    """
    doubled = biography().replace("</aside>", "</aside>" + biography(), 1)

    once = parse_biography(biography())
    twice = parse_biography(doubled)

    assert [social.url for social in twice.socials] == [social.url for social in once.socials]
    assert twice.constituency_office == once.constituency_office
    assert twice.homepage == once.homepage


# --- URL normalisation ----------------------------------------------------


def test_absolute_leaves_absolute_urls_alone_and_expands_relative_ones() -> None:
    """The listing prints absolute URLs and the biography pages relative ones,
    for the same links — so nothing downstream should have to know which page a
    URL came from."""
    assert absolute("/services/formular/contactform") == (
        "https://www.bundestag.de/services/formular/contactform"
    )
    assert absolute("https://example.org/x") == "https://example.org/x"
    assert absolute(None) is None
    assert absolute("") is None
    assert absolute("   ") is None


def test_a_trailing_space_inside_an_href_is_trimmed() -> None:
    """Real markup carries `href="https://x.com/B_Treuheit "`. Untrimmed it is a
    URL that renders as a link and resolves to nothing."""
    parser = BiographyParser()
    parser.feed(
        "<aside><h2>Profile im Internet</h2>"
        '<a title="X" href="https://x.com/B_Treuheit "></a></aside>'
    )
    contact = parser.contact()

    assert [social.url for social in contact.socials] == ["https://x.com/B_Treuheit"]
