"""Orchestration: the order, the watermark, and what a failed stage costs.

The sources are stubbed — every client is injected, so nothing here fetches
anything. What is under test is the wiring between them, which is where the
two operational findings live:

- **The order is a dependency graph** (§11.1). Convex rejects a record naming
  an MP who is not on the roster, so a stage running early fails as a 400.
- **The watermark is the max `aktualisiert` seen, not wall-clock time**
  (§11.2). A clock-based watermark drops any record whose timestamp fell
  between the query and the run finishing, and it never comes back.
"""

from __future__ import annotations

import datetime as dt
from datetime import datetime

from bundestrack.api.base import BundestagAPIError
from bundestrack.api.stammdaten import StammdatenClient
from bundestrack.config import Settings
from bundestrack.models.dip import Aktivitaet
from bundestrack.models.enrichment import MPContact, MPPortrait, MPProfileLink, SocialProfile
from bundestrack.models.stammdaten import parse_german_date
from bundestrack.models.votes import VoteSheetLink
from bundestrack.pipeline.join import QuarantinedName
from bundestrack.pipeline.load import ConvexLoader
from bundestrack.pipeline.state import (
    OVERLAP,
    STREAM_ACTIVITIES,
    STREAM_MOTIONS,
    STREAM_PROTOCOLS,
    SyncState,
    load_state,
    save_state,
)
from bundestrack.pipeline.sync import (
    Pipeline,
    RunReport,
    backfill,
    months_in,
    recompute_scores,
    sync,
)
from tests.conftest import fixture_bytes, fixture_json


class StubClient:
    """A source client that answers from fixtures and records nothing."""

    def close(self) -> None:
        pass


class StubStammdaten(StubClient):
    def __init__(self, data: bytes | None = None) -> None:
        self._data = (
            data if data is not None else fixture_bytes("stammdaten", "MdB-Stammdaten-excerpt.zip")
        )

    def fetch(self):
        return StammdatenClient.parse_zip(self._data)


class StubDIP(StubClient):
    """DIP, answering with recorded pages and remembering its filters."""

    def __init__(self, *, aktivitaeten: list[Aktivitaet] | None = None) -> None:
        self.aktivitaeten = aktivitaeten or []
        self.since: list[str | None] = []

    def iter_personen(self, wahlperiode=None, *, updated_since=None, **extra):
        return iter(())

    def iter_aktivitaeten(self, wahlperiode=None, *, updated_since=None, **extra):
        self.since.append(updated_since)
        return iter(self.aktivitaeten)

    def iter_vorgaenge(self, wahlperiode=None, *, updated_since=None, **extra):
        self.since.append(updated_since)
        return iter(())

    def iter_drucksachen(self, wahlperiode=None, *, updated_since=None, **extra):
        return iter(())

    def iter_plenarprotokolle(self, wahlperiode=None, *, updated_since=None, **extra):
        return iter(())


class StubVotes(StubClient):
    """The ballot listing, remembering which sheets were actually downloaded.

    `fetched` is the assertion surface for the period filter: the listing is
    every ballot since 1949 and the sheets are ~200 KB each, so what matters is
    not only which ballots are ingested but which ones were paid for.
    """

    def __init__(self, links: list[VoteSheetLink] | None = None) -> None:
        self.links = links or []
        self.fetched: list[str] = []

    def iter_vote_links(self, **kwargs):
        return iter(self.links)

    def fetch_sheet(self, link: VoteSheetLink):
        self.fetched.append(link.title)
        raise BundestagAPIError(f"stub: no sheet bytes for {link.title!r}")


class StubProfiles(StubClient):
    """The MP listing and the biography pages, from memory.

    Empty by default and *never* reaching the network: the enrich stage is on
    the default path for every run, so a stub that fell through to the real
    client would put all 639 biography pages behind `pytest`.
    """

    def __init__(self, profiles: list[MPProfileLink] | None = None) -> None:
        self.profiles = profiles or []
        #: Every URL `fetch_contact` was asked for — which is what the
        #: staleness gate is asserted on.
        self.fetched: list[str] = []
        self.contacts: dict[str, MPContact] = {}

    def iter_profiles(self, **kwargs):
        return iter(self.profiles)

    def fetch_contact(self, profile_url: str) -> MPContact:
        self.fetched.append(profile_url)
        return self.contacts.get(profile_url, MPContact())


class StubAbgeordnetenwatch(StubClient):
    def __init__(self, politicians: list[dict] | None = None) -> None:
        self.politicians = politicians or []

    def iter_politicians(self):
        return iter(self.politicians)


class RecordingLoader(ConvexLoader):
    """A loader that records the routes it was asked for, in order."""

    def __init__(self) -> None:
        super().__init__("https://example.convex.site", "test-key", dry_run=True)
        self.paths: list[str] = []
        self.payloads: list[tuple[str, dict]] = []

    def post(self, path: str, payload: dict) -> dict:
        self.paths.append(path)
        self.payloads.append((path, payload))
        return super().post(path, payload)

    def posted(self, path: str) -> list[dict]:
        """Every payload sent to one route, in order.

        The roster is posted more than once per run on purpose — the crosswalk
        and the enrichment each re-post it — so the assertions that matter are
        usually about the *last* one.
        """
        return [payload for sent, payload in self.payloads if sent == path]


def build(
    *,
    dip: StubDIP | None = None,
    votes: StubVotes | None = None,
    state: SyncState | None = None,
    tmp_path=None,
    profiles: StubProfiles | None = None,
    abgeordnetenwatch: StubAbgeordnetenwatch | None = None,
) -> tuple[Pipeline, RecordingLoader]:
    loader = RecordingLoader()
    settings = Settings(
        _env_file=None,
        BUNDESTAG_API_KEY="test-key",
        CONVEX_URL="https://example.convex.cloud",
        PIPELINE_API_KEY="test-key",
        **({"BUNDESTRACK_STATE_PATH": str(tmp_path / "state.json")} if tmp_path else {}),
    )
    pipeline = Pipeline(
        21,
        settings=settings,
        dry_run=True,
        dip=dip or StubDIP(),
        stammdaten=StubStammdaten(),
        protocols=StubClient(),
        votes=votes or StubVotes(),
        profiles=profiles or StubProfiles(),
        abgeordnetenwatch=abgeordnetenwatch or StubAbgeordnetenwatch(),
        loader=loader,
        state=state if state is not None else SyncState(),
    )
    return pipeline, loader


def aktivitaet(aktualisiert: str, person_id: str = "1013") -> Aktivitaet:
    document = dict(fixture_json("dip", "aktivitaet_page.json")["documents"][0])
    document["aktualisiert"] = aktualisiert
    document["person_id"] = person_id
    return Aktivitaet.model_validate(document)


# --- order ----------------------------------------------------------------


def test_the_roster_is_written_before_anything_that_references_it(tmp_path) -> None:
    """§11.1, and Convex enforces it: every ingestion mutation calls
    `requireMandate` and rejects a record naming an MP who is not on the
    roster, so a batch posted early fails as a 400 rather than as an orphan."""
    pipeline, loader = build(tmp_path=tmp_path)

    backfill(21, pipeline=pipeline)

    assert loader.paths[0] == "mps"
    for path in ("committee-memberships", "activities", "speeches", "vote-records"):
        if path in loader.paths:
            assert loader.paths.index("mps") < loader.paths.index(path), path


def test_a_run_with_no_roster_skips_every_dependent_stage() -> None:
    """Nothing else can be written without it, so the stages are not attempted.

    Posting them would be several hundred 400s naming an MP that does not
    exist, which buries the actual problem.
    """
    pipeline, loader = build()
    # WP8 exists in the dump but the resolver is built for 21, so a period the
    # excerpt has no mandates for stands in for an empty roster.
    pipeline.wahlperiode = 99
    pipeline.resolver = None

    report = backfill(99, pipeline=pipeline)

    assert loader.paths == []
    assert report.stages[0].name == "roster"


def test_a_roster_fetch_failure_is_reported_rather_than_raised(tmp_path) -> None:
    """The cron reads the report; a traceback out of `sync()` is not one.

    The dependent stages are still skipped — without a roster they would be
    several hundred 400s naming an MP that does not exist.
    """

    class ExplodingStammdaten(StubStammdaten):
        def fetch(self):
            raise RuntimeError("the Stammdaten ZIP is a 503 today")

    pipeline, loader = build(tmp_path=tmp_path)
    pipeline.stammdaten = ExplodingStammdaten()

    report = backfill(21, pipeline=pipeline)

    assert not report.ok
    assert report.stages[0].name == "roster"
    assert "503" in report.stages[0].error
    assert loader.paths == []


def test_one_stage_failing_does_not_end_the_run(tmp_path) -> None:
    """The stages after the roster are independent of each other, so a source
    being down should not cost the rest of the run."""

    class ExplodingDIP(StubDIP):
        def iter_aktivitaeten(self, *args, **kwargs):
            raise RuntimeError("the WAF is blocking us")

    pipeline, _loader = build(dip=ExplodingDIP(), tmp_path=tmp_path)

    report = backfill(21, pipeline=pipeline)

    assert not report.ok
    (failed,) = [stage for stage in report.stages if not stage.ok]
    assert failed.name == "activities"
    assert "WAF" in failed.error
    # …and the stages after it still ran.
    assert [stage.name for stage in report.stages][-1] == "seating"


# --- enrichment -----------------------------------------------------------


def profile(
    printed_name: str,
    url: str = "https://www.bundestag.de/abgeordnete/biografien/B/bilger-1",
    *,
    credit: str | None = "Foto/Fraktion",
) -> MPProfileLink:
    return MPProfileLink(
        printed_name=printed_name,
        profile_url=url,
        portrait=(
            MPPortrait(url="https://www.bundestag.de/resource/image/1.jpg", credit=credit)
            if credit
            else None
        ),
    )


def test_the_portrait_reaches_the_roster_upsert_rather_than_a_write_of_its_own() -> None:
    """The `mps` upsert is the only write that carries `photoUrl`.

    A portrait posted by a mutation of its own would survive until the next
    roster write and no longer — and `link_dip_persons` re-posts the roster
    within the very same run.
    """
    profiles = StubProfiles([profile("Bilger, Steffen")])
    pipeline, loader = build(profiles=profiles)
    report = RunReport(21, "sync")
    pipeline.load_roster(report)

    pipeline.load_enrichment(report)

    rows = [row for call in loader.posted("mps") for row in call["mps"]]
    bilger = [row for row in rows if row["internalId"] == "bt-11004011"][-1]
    assert bilger["photoUrl"] == "https://www.bundestag.de/resource/image/1.jpg"
    assert bilger["photoCredit"] == "Foto/Fraktion"


def test_occupation_joins_by_stammdaten_id_rather_than_by_name() -> None:
    """abgeordnetenwatch carries the Stammdaten id verbatim, so §7.1 does not
    apply to this source — the join is exact and needs no name at all."""
    politicians = StubAbgeordnetenwatch(
        [
            {
                "ext_id_bundestagsverwaltung": "11004011",
                "occupation": "Diplom-Verwaltungswirt",
                "education": "Jura",
            }
        ]
    )
    pipeline, loader = build(abgeordnetenwatch=politicians)
    report = RunReport(21, "sync")
    pipeline.load_roster(report)

    pipeline.load_enrichment(report)

    rows = [row for call in loader.posted("mps") for row in call["mps"]]
    bilger = [row for row in rows if row["internalId"] == "bt-11004011"][-1]
    assert bilger["occupation"] == "Diplom-Verwaltungswirt"
    assert bilger["education"] == "Jura"


def test_a_fresh_contact_block_is_not_re_fetched() -> None:
    """~280 KB per MP against a WAF that counts bytes (§2.6). A daily sync must
    re-read the pages that have aged, not all 639 of them."""
    url = "https://www.bundestag.de/abgeordnete/biografien/B/bilger-1"
    profiles = StubProfiles([profile("Bilger, Steffen", url)])
    state = SyncState()
    state.record_contact_fetch("bt-11004011")
    pipeline, _ = build(profiles=profiles, state=state)
    report = RunReport(21, "sync")
    pipeline.load_roster(report)

    pipeline.load_enrichment(report)

    assert profiles.fetched == []


def test_a_backfill_re_reads_every_contact_page_however_fresh() -> None:
    """`full` is what separates the two modes: a backfill is the run that is
    allowed to spend the whole ~175 MB."""
    url = "https://www.bundestag.de/abgeordnete/biografien/B/bilger-1"
    profiles = StubProfiles([profile("Bilger, Steffen", url)])
    state = SyncState()
    state.record_contact_fetch("bt-11004011")
    pipeline, _ = build(profiles=profiles, state=state)
    report = RunReport(21, "sync")
    pipeline.load_roster(report)

    pipeline.load_enrichment(report, full=True)

    assert profiles.fetched == [url]


def test_a_page_that_published_nothing_is_still_stamped() -> None:
    """About half of MPs list no constituency office. Stamping only non-empty
    responses would re-read those pages forever to rediscover the same
    absence."""
    url = "https://www.bundestag.de/abgeordnete/biografien/B/bilger-1"
    profiles = StubProfiles([profile("Bilger, Steffen", url)])
    pipeline, _ = build(profiles=profiles)
    report = RunReport(21, "sync")
    pipeline.load_roster(report)

    pipeline.load_enrichment(report)

    assert profiles.fetched == [url]
    assert not pipeline.state.contact_is_stale("bt-11004011")


def test_the_contact_block_reaches_the_roster_row() -> None:
    url = "https://www.bundestag.de/abgeordnete/biografien/B/bilger-1"
    profiles = StubProfiles([profile("Bilger, Steffen", url)])
    profiles.contacts[url] = MPContact(
        form_url="https://www.bundestag.de/services/formular/contactform?mdbId=1",
        constituency_office="Wahlkreisbüro\nLudwigsburg",
        homepage="https://example.de",
        socials=(SocialProfile(platform="X", url="https://x.com/example"),),
    )
    pipeline, loader = build(profiles=profiles)
    report = RunReport(21, "sync")
    pipeline.load_roster(report)

    pipeline.load_enrichment(report)

    rows = [row for call in loader.posted("mps") for row in call["mps"]]
    contact = [row for row in rows if row["internalId"] == "bt-11004011"][-1]["contact"]
    assert contact["formUrl"].endswith("mdbId=1")
    assert contact["constituencyOffice"] == "Wahlkreisbüro\nLudwigsburg"
    assert contact["socials"] == [{"platform": "X", "url": "https://x.com/example"}]


def test_an_unmatched_name_is_not_counted_as_a_fresh_contact_block() -> None:
    """ "Fresh" means "fetched recently". A name the roster has never heard of
    has no contact block at all, so counting it as up to date would report a
    §7.3 staleness gap as work already done."""
    profiles = StubProfiles(
        [
            profile("Bilger, Steffen"),
            profile("Nichtexistent, Erika", "https://www.bundestag.de/x"),
        ]
    )
    pipeline, _ = build(profiles=profiles)
    report = RunReport(21, "sync")
    pipeline.load_roster(report)

    pipeline.load_enrichment(report)

    (contact_note,) = [n for n in report.stages[-1].notes if n.startswith("contact:")]
    assert "still fresh" not in contact_note


def test_a_listed_name_matching_no_roster_mp_is_reported_not_fatal() -> None:
    """The listing is the Bundestag's own roster, so a name that resolves to
    nobody means the Stammdaten snapshot is behind (§7.3) — which the
    quarantine already retries. It must not fail the stage."""
    profiles = StubProfiles([profile("Nichtexistent, Erika")])
    pipeline, _ = build(profiles=profiles)
    report = RunReport(21, "sync")
    pipeline.load_roster(report)

    pipeline.load_enrichment(report)

    stage = report.stages[-1]
    assert stage.ok
    assert any("match no roster MP" in note for note in stage.notes)


def test_one_unreadable_biography_page_does_not_end_the_stage() -> None:
    """The same rule `load_speeches` applies to an unreadable protocol: note
    it, step over it, and leave it unstamped so the next sync retries."""
    url = "https://www.bundestag.de/abgeordnete/biografien/B/bilger-1"

    class BlockedProfiles(StubProfiles):
        def fetch_contact(self, profile_url: str) -> MPContact:
            raise BundestagAPIError("the WAF answered a 303 challenge")

    profiles = BlockedProfiles([profile("Bilger, Steffen", url)])
    pipeline, _ = build(profiles=profiles)
    report = RunReport(21, "sync")
    pipeline.load_roster(report)

    pipeline.load_enrichment(report)

    stage = report.stages[-1]
    assert stage.ok
    assert pipeline.state.contact_is_stale("bt-11004011")
    assert any("retry next sync" in note for note in stage.notes)


def test_an_uncredited_portrait_never_reaches_the_row() -> None:
    """§6.5: these are photographer-credited works, not open-licensed ones, so
    showing the credit is the licence condition. A portrait without one is
    dropped rather than rendered bare."""
    profiles = StubProfiles([profile("Bilger, Steffen", credit=None)])
    pipeline, loader = build(profiles=profiles)
    report = RunReport(21, "sync")
    pipeline.load_roster(report)

    pipeline.load_enrichment(report)

    rows = [row for call in loader.posted("mps") for row in call["mps"]]
    bilger = [row for row in rows if row["internalId"] == "bt-11004011"][-1]
    assert bilger["photoUrl"] is None
    assert bilger["photoCredit"] is None


def test_enrichment_runs_after_the_crosswalk_so_the_roster_carries_both() -> None:
    """Both stages re-post the roster. Enrichment going second is what makes
    this run's *last* roster write the one carrying the portrait — a run that
    enriched first would have `link_dip_persons` blank it again."""
    profiles = StubProfiles([profile("Bilger, Steffen")])
    pipeline, loader = build(profiles=profiles)

    report = sync(21, pipeline=pipeline)

    names = [stage.name for stage in report.stages]
    assert names.index("enrichment") > names.index("dip-persons")
    rows = [row for call in loader.posted("mps") for row in call["mps"]]
    bilger = [row for row in rows if row["internalId"] == "bt-11004011"][-1]
    assert bilger["photoUrl"] is not None


# --- the watermark --------------------------------------------------------


def test_the_watermark_is_a_timestamp_actually_seen(tmp_path) -> None:
    """§11.2 asks for the max `aktualisiert` seen, not wall-clock time.

    A clock-based watermark drops any record whose timestamp fell between the
    query and the run finishing, and the next window starts after it — so the
    record never comes back.
    """
    dip = StubDIP(
        aktivitaeten=[
            aktivitaet("2026-07-24T12:03:00+02:00"),
            aktivitaet("2026-07-25T09:00:00+02:00"),
        ]
    )
    pipeline, _ = build(dip=dip, tmp_path=tmp_path)

    sync(21, pipeline=pipeline)

    assert pipeline.state.watermark(21, STREAM_ACTIVITIES) == "2026-07-25T09:00:00+02:00"


def test_the_next_sync_re_reads_an_overlapping_window(tmp_path) -> None:
    """§11.2: "overlap the window slightly to tolerate clock skew".

    Re-reading an hour costs a handful of pages; missing an hour costs records
    that never return.
    """
    state = SyncState(watermarks={f"21:{STREAM_ACTIVITIES}": "2026-07-25T09:00:00+02:00"})
    dip = StubDIP()
    pipeline, _ = build(dip=dip, state=state, tmp_path=tmp_path)

    sync(21, pipeline=pipeline)

    expected = (datetime.fromisoformat("2026-07-25T09:00:00+02:00") - OVERLAP).isoformat()
    assert dip.since[0] == expected


def test_the_watermark_never_moves_backwards(tmp_path) -> None:
    # A re-read of the overlap window, or a backfill of an older period, must
    # not rewind it — the next sync would re-read everything since.
    state = SyncState(watermarks={f"21:{STREAM_ACTIVITIES}": "2026-07-25T09:00:00+02:00"})
    dip = StubDIP(aktivitaeten=[aktivitaet("2026-07-01T00:00:00+02:00")])
    pipeline, _ = build(dip=dip, state=state, tmp_path=tmp_path)

    sync(21, pipeline=pipeline)

    assert pipeline.state.watermark(21, STREAM_ACTIVITIES) == "2026-07-25T09:00:00+02:00"


def test_a_failed_stage_does_not_lose_its_window_to_a_successful_one(
    tmp_path,
) -> None:
    """The watermark is per *stream*, and this is why.

    The stages fail independently — that is the point of isolating them — so a
    single shared mark would let a stage that succeeded advance past the window
    a stage that *failed* still needs. A run where activities land and
    protocols are blocked by the WAF would move the mark to today, and
    tomorrow's sync would never ask for those protocols again: the sitting is
    lost, silently and permanently.
    """

    class BlockedProtocols(StubDIP):
        def iter_plenarprotokolle(self, *args, **kwargs):
            raise RuntimeError("the WAF is blocking us")

    dip = BlockedProtocols(aktivitaeten=[aktivitaet("2026-07-25T09:00:00+02:00")])
    state = SyncState(
        watermarks={
            f"21:{STREAM_ACTIVITIES}": "2026-07-01T00:00:00+02:00",
            f"21:{STREAM_PROTOCOLS}": "2026-07-01T00:00:00+02:00",
        }
    )
    pipeline, _loader = build(dip=dip, state=state, tmp_path=tmp_path)

    report = sync(21, pipeline=pipeline)

    assert not report.ok
    # Activities advanced on evidence they actually saw…
    assert pipeline.state.watermark(21, STREAM_ACTIVITIES) == "2026-07-25T09:00:00+02:00"
    # …and the blocked stream kept its window, so tomorrow re-reads it.
    assert pipeline.state.watermark(21, STREAM_PROTOCOLS) == "2026-07-01T00:00:00+02:00"


def test_each_stream_asks_for_its_own_window(tmp_path) -> None:
    # A stream that is behind must not be dragged forward by one that is ahead.
    state = SyncState(
        watermarks={
            f"21:{STREAM_ACTIVITIES}": "2026-07-25T09:00:00+02:00",
            f"21:{STREAM_MOTIONS}": "2026-07-01T00:00:00+02:00",
        }
    )
    dip = StubDIP()
    pipeline, _loader = build(dip=dip, state=state, tmp_path=tmp_path)

    sync(21, pipeline=pipeline)

    # `StubDIP` records activities then Vorgänge, in stage order.
    activities_window, motions_window = dip.since[0], dip.since[1]
    assert activities_window.startswith("2026-07-25")
    assert motions_window.startswith("2026-06-30"), "an hour of overlap before 07-01"


def test_an_explicit_since_overrides_every_stream(tmp_path) -> None:
    # The hand re-read after an incident: one window, applied to everything.
    state = SyncState(watermarks={f"21:{STREAM_ACTIVITIES}": "2026-07-25T09:00:00+02:00"})
    dip = StubDIP()
    pipeline, _loader = build(dip=dip, state=state, tmp_path=tmp_path)

    sync(21, since="2026-01-01T00:00:00+01:00", pipeline=pipeline)

    assert set(dip.since) == {"2026-01-01T00:00:00+01:00"}


def test_a_backfill_ignores_a_watermark_left_by_an_earlier_attempt(tmp_path) -> None:
    """A backfill means the whole period, not the part a dead run missed.

    The failure this guards is silent and unrecoverable by any later run: a
    backfill blocked by the WAF leaves a watermark at whatever it *had* read,
    and `aktualisiert` order is not `datum` order — so resuming from that mark
    fetches the records amended since, never the ones not yet seen.
    """
    # WP21 because the Stammdaten excerpt only has mandates for that period —
    # a period with no roster skips every dependent stage, so the assertion
    # below would hold vacuously.
    state = SyncState(
        watermarks={
            f"21:{STREAM_ACTIVITIES}": "2026-07-25T09:00:00+02:00",
            f"21:{STREAM_MOTIONS}": "2026-07-25T09:00:00+02:00",
            f"21:{STREAM_PROTOCOLS}": "2026-07-25T09:00:00+02:00",
        }
    )
    dip = StubDIP()
    pipeline, _ = build(dip=dip, state=state, tmp_path=tmp_path)

    backfill(21, pipeline=pipeline)

    assert dip.since, "the fetching stages must have run at all"
    assert all(window is None for window in dip.since), (
        "every stream must re-fetch the period whole, not resume from a partial run"
    )


def test_a_backfill_still_honours_an_explicit_since(tmp_path) -> None:
    # `full` overrides the *stored* mark, not a human naming a window.
    state = SyncState(watermarks={f"21:{STREAM_ACTIVITIES}": "2026-07-25T09:00:00+02:00"})
    dip = StubDIP()
    pipeline, _ = build(dip=dip, state=state, tmp_path=tmp_path)
    pipeline.full = True

    assert pipeline._window(STREAM_ACTIVITIES, "2026-01-01T00:00:00+01:00") == (
        "2026-01-01T00:00:00+01:00"
    )


def test_a_sync_still_resumes_from_its_watermark(tmp_path) -> None:
    """The counterpart of the two above: `full` is a backfill's property alone.

    A daily sync that started fetching from scratch would re-read the whole
    period against a WAF that IP-blocks on volume (§2.6).
    """
    state = SyncState(watermarks={f"21:{STREAM_ACTIVITIES}": "2026-07-25T09:00:00+02:00"})
    dip = StubDIP()
    pipeline, _ = build(dip=dip, state=state, tmp_path=tmp_path)

    sync(21, pipeline=pipeline)

    assert dip.since, "the fetching stages must have run at all"
    assert dip.since[0] is not None


def test_a_host_with_no_watermark_does_a_full_fetch(tmp_path) -> None:
    """Rather than starting from now, which would leave the deployment
    permanently missing whatever happened before it was first run."""
    dip = StubDIP()
    pipeline, _ = build(dip=dip, tmp_path=tmp_path)

    sync(21, pipeline=pipeline)

    assert dip.since[0] is None


def test_an_unparseable_watermark_widens_the_window_rather_than_failing(
    tmp_path,
) -> None:
    state = SyncState(watermarks={f"21:{STREAM_ACTIVITIES}": "not a timestamp"})

    assert state.since(21, STREAM_ACTIVITIES) is None


# --- state persistence ----------------------------------------------------


def test_state_survives_a_round_trip(tmp_path) -> None:
    path = tmp_path / "state.json"
    state = SyncState(stammdaten_version="1777449783")
    state.advance(21, STREAM_ACTIVITIES, datetime.fromisoformat("2026-07-25T09:00:00+02:00"))
    state.record_protocol_hash("5806", "ba467dc286934a3ad18328e6b9c3f65c")
    state.record_ballot(21, "21/90/8")
    state.quarantine.add(
        QuarantinedName(source="vote-sheet", nachname="Glaser", vorname="Stefan", wahlperiode=21)
    )
    save_state(path, state)

    loaded = load_state(path)

    assert loaded.watermark(21, STREAM_ACTIVITIES) == "2026-07-25T09:00:00+02:00"
    assert loaded.protocol_hash("5806") == "ba467dc286934a3ad18328e6b9c3f65c"
    assert loaded.ingested_ballots(21) == ["21/90/8"]
    assert len(loaded.quarantine) == 1


def test_a_corrupt_state_file_costs_a_wider_window_not_the_run(tmp_path) -> None:
    """Refusing to run until an operator repairs a cache file would take the
    pipeline down for something that repairs itself."""
    path = tmp_path / "state.json"
    path.write_text("{ this is not json", encoding="utf-8")

    state = load_state(path)

    assert state.watermark(21, STREAM_ACTIVITIES) is None


def test_a_missing_state_file_is_the_normal_first_run(tmp_path) -> None:
    assert load_state(tmp_path / "absent.json").watermark(21, STREAM_ACTIVITIES) is None


def test_a_dry_run_writes_no_state(tmp_path) -> None:
    # A dry run must not move the watermark: the records it "wrote" are not in
    # the deployment, so a real sync afterwards has to fetch them again.
    path = tmp_path / "state.json"
    pipeline, _ = build(
        dip=StubDIP(aktivitaeten=[aktivitaet("2026-07-25T09:00:00+02:00")]),
        tmp_path=tmp_path,
    )

    sync(21, pipeline=pipeline)

    assert not path.exists()


# --- reporting ------------------------------------------------------------


def test_the_report_names_a_failed_stage_rather_than_omitting_it() -> None:
    report = RunReport(21, "sync")
    report.stage("roster").error = None
    report.stage("votes").error = "the listing timed out"

    assert not report.ok
    assert "votes: FAILED" in report.summary()


def test_the_quarantine_count_reaches_the_summary(tmp_path) -> None:
    # §7.3's staleness, made visible: a growing count is the signal that the
    # Stammdaten snapshot is behind reality.
    state = SyncState()
    state.quarantine.add(
        QuarantinedName(source="vote-sheet", nachname="Glaser", vorname="Stefan", wahlperiode=21)
    )
    pipeline, _ = build(state=state, tmp_path=tmp_path)

    report = backfill(21, pipeline=pipeline)

    assert report.quarantined >= 1
    assert "quarantine" in report.summary()


# --- period-specific gaps -------------------------------------------------


def test_a_period_before_the_xml_boundary_reports_why_it_has_no_speeches(
    tmp_path,
) -> None:
    """§5.2: XML exists from WP18 onward; earlier periods are PDF-only.

    Saying so beats an empty stage, which reads as a sitting-free parliament.
    """
    pipeline, _ = build(tmp_path=tmp_path)
    pipeline.wahlperiode = 17
    report = RunReport(17, "backfill")
    pipeline.load_roster(report)
    pipeline.load_speeches(report, since=None)

    (stage,) = [s for s in report.stages if s.name == "speeches"]
    assert any("WP18" in note for note in stage.notes)


def test_an_older_period_says_committee_data_was_never_published(tmp_path) -> None:
    """§6.4: absent data, not an idle chamber — and the difference has to reach
    the reader or every past MP looks like they sat on nothing."""
    pipeline, _ = build(tmp_path=tmp_path)
    pipeline.wahlperiode = 8
    report = RunReport(8, "backfill")
    pipeline.load_roster(report)
    pipeline.load_committees(report)

    (stage,) = [s for s in report.stages if s.name == "committees"]
    assert any("§6.4" in note for note in stage.notes)


# --- the ballot listing ----------------------------------------------------


def _link(title: str, when: str | None) -> VoteSheetLink:
    return VoteSheetLink(
        title=title,
        pdf_url=f"https://example.invalid/{title}.pdf",
        xlsx_url=f"https://example.invalid/{title}.xlsx",
        date=parse_german_date(when),
    )


def test_a_ballot_dated_outside_the_period_is_not_downloaded(tmp_path) -> None:
    """The listing is every ballot since 1949 and carries no period filter.

    Without a date check each backfill downloads the whole listing — hundreds
    of ~200 KB sheets — to keep the handful that match, against a WAF that
    counts bytes as well as requests (§2.6).
    """
    votes = StubVotes(
        [
            _link("during-wp21", "01.06.2026"),
            _link("before-wp21", "01.06.2019"),
        ]
    )
    pipeline, _ = build(votes=votes, tmp_path=tmp_path)
    report = RunReport(21, "backfill")
    pipeline.load_roster(report)
    pipeline.load_votes(report, incremental=False)

    assert votes.fetched == ["during-wp21"]
    (stage,) = [s for s in report.stages if s.name == "votes"]
    assert any("outside WP21" in note for note in stage.notes)


def test_an_undated_ballot_is_downloaded_rather_than_assumed_out_of_period(
    tmp_path,
) -> None:
    """The pre-2012 tail of the listing prints no date at all (§4.1).

    Excluding those would discard ballots on a missing field, and the sheets
    are the only source that records absences (§4.2) — so an unknown date must
    cost a download, not a row. The sheet's own `Wahlperiode` column decides.
    """
    votes = StubVotes([_link("undated", None)])
    pipeline, _ = build(votes=votes, tmp_path=tmp_path)
    report = RunReport(21, "backfill")
    pipeline.load_roster(report)
    pipeline.load_votes(report, incremental=False)

    assert votes.fetched == ["undated"]


def test_an_open_period_does_not_exclude_a_recent_ballot(tmp_path) -> None:
    # WP21 has not ended, so its window has no upper bound — a ballot dated
    # after the dump was published is still this period's.
    votes = StubVotes([_link("tomorrow", "31.12.2028")])
    pipeline, _ = build(votes=votes, tmp_path=tmp_path)
    report = RunReport(21, "backfill")
    pipeline.load_roster(report)
    pipeline.load_votes(report, incremental=False)

    assert votes.fetched == ["tomorrow"]


# --- scoring a backfilled period -------------------------------------------


def test_every_month_of_a_closed_period_is_enumerated() -> None:
    """A backfilled period's months are all historical, so the nightly sweep —
    which recomputes the current month only — never reaches any of them."""
    months = months_in(dt.date(2021, 10, 26), dt.date(2025, 3, 25))

    assert months[0] == "2021-10"
    assert months[-1] == "2025-03"
    assert len(months) == 42
    assert "2022-01" in months, "the year boundary is not a gap"


def test_months_are_zero_padded() -> None:
    """`activityScores.monthWindow` rejects anything else, and is right to:
    `"2021-6"` builds bounds that sort above every real date in the year, so
    the month scores zero and nothing anywhere errors."""
    assert months_in(dt.date(2021, 6, 1), dt.date(2021, 6, 30)) == ["2021-06"]


def test_an_open_period_enumerates_no_months() -> None:
    # The current period's end is unknown, and guessing one would write score
    # rows for months that have not happened.
    assert months_in(dt.date(2025, 3, 25), None) == []
    assert months_in(None, None) == []


def test_scoring_a_period_walks_each_month_and_the_total() -> None:
    """`recomputeScores` writes the period total on every call, so a per-month
    pass keeps the total consistent with the months it just rewrote."""

    class CountingLoader:
        def __init__(self) -> None:
            self.months: list[str | None] = []

        def recompute_scores(self, wahlperiode, *, month=None, **kwargs):
            self.months.append(month)
            return 1

        def close(self) -> None:
            pass

    loader = CountingLoader()
    recompute_scores(20, months=["2021-10", "2021-11"], loader=loader)

    assert loader.months == ["2021-10", "2021-11"]


def test_scoring_with_no_months_still_recomputes_the_total() -> None:
    # The existing behaviour, unchanged: `scores --wp N` with no month.
    class CountingLoader:
        def __init__(self) -> None:
            self.months: list[str | None] = []

        def recompute_scores(self, wahlperiode, *, month=None, **kwargs):
            self.months.append(month)
            return 1

        def close(self) -> None:
            pass

    loader = CountingLoader()
    recompute_scores(21, loader=loader)

    assert loader.months == [None]
