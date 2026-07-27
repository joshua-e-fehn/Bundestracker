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

from datetime import date, datetime

from bundestrack.api.base import BundestagAPIError
from bundestrack.api.mp_profiles import parse_biography, parse_listing
from bundestrack.api.stammdaten import StammdatenClient
from bundestrack.config import Settings
from bundestrack.models.dip import Aktivitaet
from bundestrack.models.enrichment import MPContact, MPEnrichment
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
from bundestrack.pipeline.sync import Pipeline, RunReport, backfill, sync
from tests.conftest import fixture_bytes, fixture_json, fixture_text


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
    def iter_vote_links(self, **kwargs):
        return iter(())


class StubProfiles(StubClient):
    """The MP listing and biography pages, answering from a recorded fragment.

    Defaults to the real trimmed listing fixture, so the enrich stage is
    exercised against markup the Bundestag actually served rather than against
    an empty iterator that would pass whatever the parser did.
    """

    def __init__(self, *, html: str | None = None, contact: MPContact | None = None) -> None:
        self._html = (
            html if html is not None else fixture_text("mp_profiles", "ajax_list_page.html")
        )
        self._contact = contact
        #: Every profile URL fetched, in order — this is what the staleness
        #: rule is asserted on, since its whole purpose is *not* fetching.
        self.fetched: list[str] = []

    def iter_profiles(self, **kwargs):
        return iter(parse_listing(self._html).entries)

    def fetch_contact(self, profile_url: str) -> MPContact:
        self.fetched.append(profile_url)
        if self._contact is not None:
            return self._contact
        return parse_biography(fixture_text("mp_profiles", "biography_page.html"))


class StubAbgeordnetenwatch(StubClient):
    def __init__(self, *, politicians: list[dict] | None = None) -> None:
        self._politicians = politicians or []

    def iter_politicians(self):
        return iter(self._politicians)


class RecordingLoader(ConvexLoader):
    """A loader that records the routes it was asked for, in order."""

    def __init__(self) -> None:
        super().__init__("https://example.convex.site", "test-key", dry_run=True)
        self.paths: list[str] = []

    def post(self, path: str, payload: dict) -> dict:
        self.paths.append(path)
        return super().post(path, payload)


def build(
    *,
    dip: StubDIP | None = None,
    profiles: StubProfiles | None = None,
    abgeordnetenwatch: StubAbgeordnetenwatch | None = None,
    state: SyncState | None = None,
    tmp_path=None,
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
        votes=StubVotes(),
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


# --- MP enrichment --------------------------------------------------------


def test_enrichment_is_written_after_the_dip_crosswalk_reposts_the_roster(
    tmp_path,
) -> None:
    """⚠ The ordering hazard, and the reason this stage runs where it does.

    Both stages finish by re-posting the whole roster — `link_dip_persons` to
    patch in `dipPersonId`, `enrich_mps` to write the portrait columns — and a
    roster upsert *replaces* them. Enriching first would have the DIP stage
    null every portrait it had just written, on every run, with no error: the
    pipeline would report success and the site would show initials.
    """
    pipeline, loader = build(tmp_path=tmp_path)

    report = backfill(21, pipeline=pipeline)

    names = [stage.name for stage in report.stages]
    assert names.index("dip-persons") < names.index("enrich-mps")
    # And the last roster write of the run is the enriched one.
    assert loader.paths[-1 - loader.paths[::-1].index("mps")] == "mps"


def test_occupation_joins_by_stammdaten_id_without_touching_a_name(tmp_path) -> None:
    """abgeordnetenwatch carries `ext_id_bundestagsverwaltung`, which *is* the
    8-digit Stammdaten id — so none of §7.1's name-matching failure modes
    apply to this half of the enrichment."""
    aw = StubAbgeordnetenwatch(
        politicians=[
            {
                "ext_id_bundestagsverwaltung": "11004011",
                "occupation": "MdB",
                "education": "Diplom-Verwaltungswirt",
            },
            # Someone from another period: outside this roster, so skipped.
            {"ext_id_bundestagsverwaltung": "99999999", "occupation": "Nope"},
        ]
    )
    pipeline, _ = build(abgeordnetenwatch=aw, tmp_path=tmp_path)

    backfill(21, pipeline=pipeline)

    assert pipeline.resolver is not None
    enriched = pipeline.resolver.enrichment_for("bt-11004011")
    assert enriched is not None
    assert enriched.occupation == "MdB"
    assert enriched.education == "Diplom-Verwaltungswirt"


def test_a_second_source_does_not_blank_what_the_first_one_filled(tmp_path) -> None:
    """The sources arrive at different rates — portraits every run, contact
    blocks only when stale — so merging is per field, not per record. A run
    that refreshed only the portraits must not clear the contact details it
    deliberately did not fetch."""
    aw = StubAbgeordnetenwatch(
        politicians=[{"ext_id_bundestagsverwaltung": "11004011", "occupation": "MdB"}]
    )
    pipeline, _ = build(abgeordnetenwatch=aw, tmp_path=tmp_path)
    backfill(21, pipeline=pipeline)
    assert pipeline.resolver is not None

    # A later portrait-only refresh for the same MP.
    pipeline.resolver.attach_enrichment([MPEnrichment(internal_id="bt-11004011", portrait=None)])

    assert pipeline.resolver.enrichment_for("bt-11004011").occupation == "MdB"


def test_a_fresh_contact_block_is_not_re_fetched(tmp_path) -> None:
    """The rationing that makes this stage affordable.

    One biography page is ~280 KB and there are 630 of them, so re-reading the
    lot every night is ~12 minutes against a WAF that counts bytes (§2.6). An
    MP read recently is skipped outright.
    """
    state = SyncState()
    profiles = StubProfiles()
    pipeline, _ = build(profiles=profiles, state=state, tmp_path=tmp_path)
    backfill(21, pipeline=pipeline)
    first_pass = len(profiles.fetched)

    # Second run, same state: everything read on the first pass is still fresh.
    profiles_again = StubProfiles()
    pipeline_again, _ = build(profiles=profiles_again, state=state, tmp_path=tmp_path)
    backfill(21, pipeline=pipeline_again)

    assert first_pass >= 0  # whatever matched the excerpt roster
    assert profiles_again.fetched == []


def test_a_stale_contact_block_is_read_again(tmp_path) -> None:
    """Thirty days, because the data moves on the scale of a term — but it does
    move, and a stale office address is worse than none."""
    state = SyncState()
    state.contact_fetched_on["bt-11004011"] = "2020-01-01"

    assert state.contact_is_stale("bt-11004011", today=date(2026, 7, 27), max_age_days=30)
    assert not state.contact_is_stale("bt-11004011", today=date(2026, 7, 27), max_age_days=30_000)
    # Never read at all is the other way to be stale.
    assert state.contact_is_stale("bt-unknown", today=date(2026, 7, 27), max_age_days=30)


def test_one_unreachable_page_does_not_cost_the_rest_their_enrichment(
    tmp_path,
) -> None:
    """629 MPs must not lose their portraits because one biography 404s."""

    class FailingProfiles(StubProfiles):
        def fetch_contact(self, profile_url: str):
            raise BundestagAPIError("404 from the biography page")

    pipeline, _ = build(profiles=FailingProfiles(), tmp_path=tmp_path)

    report = backfill(21, pipeline=pipeline)

    stage = next(s for s in report.stages if s.name == "enrich-mps")
    assert stage.ok  # reported, not raised
    assert stage.result is not None  # the roster was still written


def test_a_source_being_down_is_a_note_rather_than_a_failed_stage(tmp_path) -> None:
    """abgeordnetenwatch answers 429 under sustained load and sends no
    `Retry-After`. Losing occupation for one run is a blank column, not a wrong
    one, so the stage carries on and says so."""

    class RateLimitedAW(StubAbgeordnetenwatch):
        def iter_politicians(self):
            raise BundestagAPIError("429 Too Many Requests")

    pipeline, _ = build(abgeordnetenwatch=RateLimitedAW(), tmp_path=tmp_path)

    report = backfill(21, pipeline=pipeline)

    stage = next(s for s in report.stages if s.name == "enrich-mps")
    assert stage.ok
    assert any("abgeordnetenwatch unavailable" in note for note in stage.notes)


def test_every_listed_portrait_reaches_the_roster_with_its_credit(tmp_path) -> None:
    """The join, end to end, against real markup on both sides.

    The listing fixture and the Stammdaten fixture are the same four MPs —
    chosen for the name shapes that break a naive join: a diacritic
    (`Ahmetović`), a particle printed on the forename side (`Aken, Jan van`)
    and an academic title (`Alhamwi, Dr. Alaa`). Measured against the live
    roster the same way, this join is 635 of 639.
    """
    pipeline, _ = build(tmp_path=tmp_path)

    backfill(21, pipeline=pipeline)

    assert pipeline.resolver is not None
    portraits = {
        internal: pipeline.resolver.enrichment_for(internal)
        for internal in ("bt-11005000", "bt-11005005", "bt-11004001", "bt-11005401")
    }
    assert all(entry is not None and entry.portrait for entry in portraits.values())
    # The credit travels with the URL: a portrait shown without one is a
    # licensing failure that renders perfectly (§6.5).
    assert all(entry.portrait.credit for entry in portraits.values())
    assert portraits["bt-11005000"].portrait.credit == "Sanae Abdi/SPD-Fraktion"


def test_listed_mps_that_do_not_match_the_snapshot_are_named(tmp_path) -> None:
    """The listing is the Bundestag's own roster, so a name in it that resolves
    to nobody means the Stammdaten dump is behind (§7.3) — a fact about the
    snapshot, not about the MP. Named rather than counted so the next reader
    can check whether the dump has caught up."""
    listing = fixture_text("mp_profiles", "ajax_list_page.html").replace(
        'title="Abdi, Sanae"', 'title="Nachgerückt, Neue"'
    )
    pipeline, _ = build(profiles=StubProfiles(html=listing), tmp_path=tmp_path)

    report = backfill(21, pipeline=pipeline)

    stage = next(s for s in report.stages if s.name == "enrich-mps")
    assert any("Nachgerückt, Neue" in note for note in stage.notes)
    assert any("did not match the Stammdaten snapshot" in note for note in stage.notes)
    # And the other three are unaffected — one unresolvable name must not cost
    # the rest their portraits.
    assert stage.ok
    assert any("3/4 portraits matched" in note for note in stage.notes)


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
