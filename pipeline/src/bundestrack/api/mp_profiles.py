"""bundestag.de MP pages — the official portraits, and what contact data exists.

**This module supersedes docs/api-research.md §6.5.** That section concluded
that "no official Bundestag portrait API or bulk image source was found", noted
that the profile pages "could not be inspected (WAF 303)" so the URL pattern was
"unverified", and settled on Wikimedia Commons via Wikidata at **36.5 %** of
WP21. All three points were re-tested live on 2026-07-27 and the first two no
longer hold:

- The MP listing at `AJAX_LIST_URL` is reachable and answers 200. It is the same
  `/ajax/filterlist/` machinery the vote listing uses (`api.votes`), which is
  presumably why the earlier pass — looking at `/abgeordnete/biografien` itself —
  did not find it.
- It carries a portrait for **639 of 639** WP21 MPs. Every one of the 639 also
  carries a photographer credit.
- `robots.txt` allows both `/ajax/` and `/resource/image/`.

§6.5's *third* point stands and is the constraint this module is built around:
these portraits are **photographer-credited, not open-licensed**, so
`MPPortrait` carries the credit as a required field beside the URL. The images
are hotlinked and never rehosted — verified to serve with no referer check, an
`ETag` and `max-age=3600`.

## Two endpoints, deliberately used at different rates

The listing gives every portrait in ~27 requests. The per-MP biography page
gives contact details and social profiles, and costs one ~280 KB request each —
630 of them, sequentially, against a WAF that counts bytes as well as requests
(§2.6). So `iter_profiles` is cheap enough for every sync and `fetch_contact` is
not; `pipeline.sync` fetches the latter only for MPs whose contact data is
missing or stale.

## What is not here, because it is not published

**No per-member email address and no telephone number is published by the member
directory.** `MDB_STAMMDATEN.DTD` declares `BIOGRAFISCHE_ANGABEN` with no contact
elements at all — the 15.3 MB dump contains one `@` character in total — and an
audit on 2026-07-31 read **110 biography pages** (60 consecutive from `Abdi`,
plus every 13th of all 639 so that every Fraktion is covered): zero addresses and
zero numbers on every one. What the Bundestag offers instead is a web contact
form, which `MPContact.form_url` records.

⚠ **The only `mailto:` on a biography page is not a contact.** Every page carries
`data-share-mail='mailto:?subject=Empfehlung…'` in the page chrome — the
share-this-article control, with an **empty recipient**. It is on all 110 sampled
pages and it is the one thing here that a `mailto:` grep will find, so anyone
re-testing this claim should expect it. `tests/test_mp_profiles.py` pins that the
parser does not read it.

⚠ **The claim is about this source, not about the parliament.** The same audit
followed the *officially linked* member websites — the `Homepage` this parser
collects — and found `@bundestag.de` addresses on 69.8 % of 53 reachable sites
and telephone numbers on 50.9 %; the Bundestag also prints its own switchboard,
`+49 (0)30 227-0`, on its imprint. None of that is ingested, and deliberately so:
20 of those 53 sites list *several* `@bundestag.de` addresses — constituency
office (`.wk`), individual staffers (`.maNN`; one member lists four) — with
nothing marking which belongs to the member, a naive sweep also picks up party
press and vendor addresses, and some members ROT13-obfuscate theirs precisely to
defeat collection. Choosing one would be inventing an answer the source did not
give, against members who signalled they did not want it collected. See
docs/api-research.md §6.6.

⚠ **The listing publishes no MP id.** It prints `"Nachname, Vorname"` and
nothing else, so this joins to the roster by name (§7.1) —
`models.enrichment.normalise_printed_name` prepares the string and
`pipeline.join.MPResolver` matches it. 635 of 639 resolve, none ambiguously.
"""

from __future__ import annotations

import logging
import re
from collections.abc import Iterator
from html.parser import HTMLParser
from typing import Any

from bundestrack.api.base import BundestagClient
from bundestrack.models.enrichment import (
    MPContact,
    MPPortrait,
    MPProfileLink,
    SocialProfile,
)

logger = logging.getLogger(__name__)

BASE_URL = "https://www.bundestag.de"

#: The MP listing. The trailing `1040594-1040594` is the CMS module id, taken
#: from the `data-dataloader-url` attribute on `/abgeordnete/biografien`. It has
#: been stable, but it is a CMS id rather than a documented route, so a 404 here
#: means "look at that attribute again", not "the MPs are gone".
AJAX_LIST_URL = f"{BASE_URL}/ajax/filterlist/de/abgeordnete/biografien/1040594-1040594"

#: MPs per listing request — *requested*. The server does not honour it: it
#: serves 12 and prints `data-limit="12"` whatever is asked for (24, 50 and 100
#: were all tried live on 2026-07-27). Kept as a parameter because it costs
#: nothing and the cap is the CMS's choice rather than a documented contract,
#: but `iter_profiles` strides by what actually came back — see the ⚠ there.
LIST_PAGE_SIZE = 24

#: Stop after this many MPs even if the listing keeps answering. The real
#: listing ends at 639; this is a runaway guard, not the contract.
MAX_LIST_ENTRIES = 2_000

#: The Bundestag's *own* social accounts, which appear in the page footer of
#: every biography page.
#:
#: ⚠ Without this filter every MP inherits the Bundestag's Instagram and
#: Mastodon as if they were their own. `BiographyParser` also scopes link
#: collection to the `<aside>`, so this is the second of two defences: the
#: structural one would survive a footer redesign, this one survives the
#: Bundestag moving its accounts into the sidebar.
SITE_WIDE_SOCIALS = frozenset(
    {
        "https://www.instagram.com/bundestag/",
        "https://www.instagram.com/bundestagspraesidentin/",
        "https://social.bund.de/@bundestag",
        "https://social.bund.de/@hib_Nachrichten",
    }
)

#: The section headings in the biography `<aside>`, as the page spells them.
#: Matched on the heading text rather than on position, because the Fraktion
#: logo block above them carries no heading and would shift every index by one.
OFFICE_HEADING = "abgeordnetenbüro"
CONSTITUENCY_HEADING = "wahlkreisbüro"
PROFILES_HEADING = "profile im internet"

#: How the credit is printed under a portrait: `(© Sanae Abdi/SPD-Fraktion)`.
#: The parentheses and the symbol are chrome; the name inside is the credit.
_CREDIT = re.compile(r"^\(?\s*(?:©|&copy;)\s*(.*?)\s*\)?$", re.S)

#: `data-hits="639"` on the listing's header div — the total, which is what
#: makes the stop condition arithmetic rather than a guess.
_HITS = re.compile(r'data-hits="(\d+)"')


def absolute(url: str | None) -> str | None:
    """A page-relative href → an absolute one.

    The listing prints absolute URLs and the biography pages print relative
    ones, for the same links. Normalising here means nothing downstream has to
    know which page a URL came from.
    """
    if not url:
        return None
    url = url.strip()
    if not url or url.startswith(("http://", "https://")):
        return url or None
    return f"{BASE_URL}/{url.lstrip('/')}"


class MPListParser(HTMLParser):
    """Pulls MP teasers out of the listing fragment.

    `html.parser` rather than BeautifulSoup or lxml, matching `VoteListParser`
    in api/votes.py: the fragment is a flat sequence of teaser `<div>`s and a
    streaming parser reads it without another dependency.

    One entry per `bt-slide-content`. Within a teaser:

    - the anchor's `href` is the biography page and its `title` is the printed
      name in `"Nachname, Vorname"` form;
    - `data-img-md-retina` on the `<img>` is the portrait. That attribute rather
      than `src`, which holds a grey placeholder — the real image is loaded by
      script from the `data-img-*` set, so a parser reading `src` gets 639
      identical placeholders and no error;
    - the credit is the second `<p>` inside `bt-bild-info-dialogue`.
    """

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.entries: list[MPProfileLink] = []
        self.total: int | None = None
        self._teaser: dict[str, Any] | None = None
        self._depth = 0
        self._capture: str | None = None
        self._buffer: list[str] = []
        self._in_credit_block = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attributes = dict(attrs)
        classes = (attributes.get("class") or "").split()

        if "bt-slide-content" in classes:
            self._teaser = {
                "name": None,
                "url": None,
                "image": None,
                "credit": None,
                "fraktion": None,
            }
            self._depth = 0
            self._in_credit_block = False
        if self._teaser is None:
            return

        if tag == "div":
            self._depth += 1
            if "bt-bild-info-dialogue" in classes:
                self._in_credit_block = True
        elif tag == "a" and self._teaser["url"] is None:
            self._teaser["url"] = absolute(attributes.get("href"))
            # The anchor's own `title` is the printed name; the `<h3>` inside
            # carries the same string, but the attribute is available before any
            # nesting and cannot be confused with the Fraktion line below it.
            self._teaser["name"] = (attributes.get("title") or "").strip() or None
        elif tag == "img" and self._teaser["image"] is None:
            self._teaser["image"] = absolute(
                attributes.get("data-img-md-retina") or attributes.get("data-img-md-normal")
            )
        elif tag == "p":
            if self._in_credit_block:
                self._capture = "credit"
                self._buffer = []
            elif "bt-person-fraktion" in classes:
                self._capture = "fraktion"
                self._buffer = []

    def handle_data(self, data: str) -> None:
        if self._capture:
            self._buffer.append(data)

    def handle_endtag(self, tag: str) -> None:
        if self._teaser is None:
            return

        if tag == "p" and self._capture:
            text = " ".join("".join(self._buffer).split())
            if self._capture == "credit":
                # Two `<p>`s share the block: the MP's name, then the credit.
                # The credit is the one carrying the ©.
                if (match := _CREDIT.match(text)) and match.group(1):
                    self._teaser["credit"] = match.group(1)
            elif text and self._teaser["fraktion"] is None:
                self._teaser["fraktion"] = text
            self._capture = None
            self._buffer = []
        elif tag == "div":
            if self._in_credit_block:
                self._in_credit_block = False
            self._depth -= 1
            if self._depth <= 0:
                self._flush()

    def _flush(self) -> None:
        teaser, self._teaser = self._teaser, None
        if teaser is None or not teaser["name"] or not teaser["url"]:
            return
        portrait = None
        if teaser["image"] and teaser["credit"]:
            portrait = MPPortrait(url=teaser["image"], credit=teaser["credit"])
        elif teaser["image"]:
            # Deliberately dropped rather than shown uncredited: §6.5's licensing
            # warning is the whole reason `credit` is required on `MPPortrait`.
            # All 639 sampled had one, so this is a change in the source.
            logger.warning(
                "Portrait for %r has no photographer credit — skipping it. These images are "
                "credited rather than open-licensed (docs/api-research.md §6.5).",
                teaser["name"],
            )
        self.entries.append(
            MPProfileLink(
                printed_name=teaser["name"],
                profile_url=teaser["url"],
                portrait=portrait,
                fraktion=teaser["fraktion"],
            )
        )

    def feed(self, data: str) -> None:  # type: ignore[override]
        if match := _HITS.search(data):
            self.total = int(match.group(1))
        super().feed(data)


class BiographyParser(HTMLParser):
    """Pulls the contact block out of one MP's biography page.

    **Scoped to the `<aside>`.** That is not tidiness: the page footer lists the
    Bundestag's own Instagram and Mastodon accounts in markup identical to the
    MP's, so a parser reading the whole document gives all 630 MPs the
    Bundestag's socials. `SITE_WIDE_SOCIALS` is the belt to this braces.

    Within the aside, sections are identified by their `<h2>` text rather than
    by position — the Fraktion logo block above them has no heading, so any
    index-based rule is off by one.
    """

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.form_url: str | None = None
        self.constituency_office: str | None = None
        self.homepage: str | None = None
        self.socials: list[SocialProfile] = []
        self._in_aside = False
        self._section: str | None = None
        self._capture: str | None = None
        self._buffer: list[str] = []
        self._seen: set[str] = set()

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attributes = dict(attrs)
        if tag == "aside":
            self._in_aside = True
            return
        if not self._in_aside:
            return

        if tag == "h2":
            self._capture = "heading"
            self._buffer = []
        elif tag == "p" and self._section == CONSTITUENCY_HEADING:
            self._capture = "address"
            self._buffer = []
        elif tag == "br" and self._capture == "address":
            # `<br>` separates address lines *and*, doubled, separates two
            # offices. Preserved as newlines so the UI can render either.
            self._buffer.append("\n")
        elif tag == "a":
            self._link(attributes)

    def _link(self, attributes: dict[str, str | None]) -> None:
        href = (attributes.get("href") or "").strip()
        if not href:
            return
        if "/services/formular/contactform" in href:
            self.form_url = absolute(href)
            return
        if self._section != PROFILES_HEADING:
            return
        url = absolute(href)
        # Trailing whitespace inside an href occurs in the source
        # (`https://x.com/B_Treuheit `), so the strip in `absolute` matters here.
        if not url or url in SITE_WIDE_SOCIALS or url in self._seen:
            return
        label = (attributes.get("title") or "").strip()
        if not label:
            return
        self._seen.add(url)
        if label.casefold() == "homepage" and self.homepage is None:
            self.homepage = url
        else:
            self.socials.append(SocialProfile(platform=label, url=url))

    def handle_data(self, data: str) -> None:
        if self._capture:
            self._buffer.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag == "aside":
            self._in_aside = False
            self._section = None
            return
        if not self._in_aside or not self._capture:
            return

        if tag == "h2" and self._capture == "heading":
            self._section = " ".join("".join(self._buffer).split()).casefold() or None
        elif tag == "p" and self._capture == "address":
            # Whitespace is collapsed per line, not across them: the line breaks
            # are the address's structure.
            lines = [" ".join(line.split()) for line in "".join(self._buffer).split("\n")]
            text = "\n".join(line for line in lines if line)
            if text and self.constituency_office is None:
                self.constituency_office = text
        self._capture = None
        self._buffer = []

    def contact(self) -> MPContact:
        return MPContact(
            form_url=self.form_url,
            constituency_office=self.constituency_office,
            homepage=self.homepage,
            socials=tuple(self.socials),
        )


def parse_listing(html: str) -> MPListParser:
    """Parse one page of the MP listing.

    Returns the parser rather than just its entries, because `total` is needed
    for the stop condition and lives on the same object.
    """
    parser = MPListParser()
    parser.feed(html)
    return parser


def parse_biography(html: str) -> MPContact:
    """Parse one MP's biography page into what it publishes about contact."""
    parser = BiographyParser()
    parser.feed(html)
    return parser.contact()


class MPProfileClient(BundestagClient):
    """Reads MP portraits and contact details off bundestag.de.

    Behind the Enodia WAF like every other `bundestag.de` host, so it inherits
    `BundestagClient`'s sequential pacing — see api/base.py for why that is
    load-bearing.
    """

    def __init__(self, *, base_url: str = BASE_URL, **kwargs: Any) -> None:
        super().__init__(base_url=base_url, **kwargs)

    def iter_profiles(
        self, *, limit: int = LIST_PAGE_SIZE, max_entries: int = MAX_LIST_ENTRIES
    ) -> Iterator[MPProfileLink]:
        """Every MP in the listing, with their portrait.

        Stops on `data-hits`, falling back to an empty page. The vote listing
        answers past its end with an empty fragment rather than an error
        (api/votes.py), and this endpoint is the same machinery — but it also
        publishes the total, so the arithmetic runs first and the empty page is
        the safety net.

        ⚠ **The offset advances by what came back, not by what was asked for.**
        The server caps the page at 12 and ignores `limit` entirely — it
        answers `data-limit="12"` to a request for 24, 50 or 100 alike. Striding
        by the requested `limit` therefore skips every page the server did not
        fill: measured live on 2026-07-27, `limit=24` walked offsets 0, 24,
        48 … and returned **324 of 639** MPs, silently, because each response
        was a valid non-empty page and `data-hits` never disagreed. Advancing by
        `len(parser.entries)` makes the stride the server's, whatever it decides
        that is.
        """
        offset = 0
        seen = 0
        total: int | None = None
        while seen < max_entries:
            parser = parse_listing(
                self.get_text(AJAX_LIST_URL, params={"limit": limit, "offset": offset})
            )
            if parser.total is not None:
                total = parser.total
            if not parser.entries:
                return
            for entry in parser.entries:
                yield entry
                seen += 1
            offset += len(parser.entries)
            if total is not None and seen >= total:
                return

    def fetch_contact(self, profile_url: str) -> MPContact:
        """One MP's contact block.

        ⚠ ~280 KB per call, one MP at a time. `pipeline.sync` calls this only
        for MPs whose contact data is missing or stale — fetching all 630 every
        sync is ~12 minutes and ~175 MB through a WAF that counts both (§2.6).
        """
        return parse_biography(self.get_text(profile_url))
