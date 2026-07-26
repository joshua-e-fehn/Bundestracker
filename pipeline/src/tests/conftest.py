"""Shared fixtures.

Every fixture under `fixtures/` is **real data**, downloaded from the live
source on 2026-07-26 and trimmed to the rows that carry a documented trap: the
multi-speaker `<rede>`, the chair interrupting mid-speech, the nbsp party
labels, the committee chair listed twice, the name particles. Trimming rather
than hand-writing matters — a hand-written fixture encodes what the author
believed the format was, which is the belief the parser is supposed to be
tested against.

The one exception is `vote_21_42_1_synthetic.xlsx`, named so at the point of
use: no real sheet has an `Enthaltung` or `ungültig` row (§11.4 open question
7), so those columns and the one-hot guard have no natural fixture.

Nothing here touches the network. `MockTransport` stands in for it, so the
suite runs offline and cannot trip the WAF that §2.6 warns about.
"""

from __future__ import annotations

import json
from collections.abc import Callable
from pathlib import Path
from typing import Any

import httpx
import pytest

FIXTURES = Path(__file__).parent / "fixtures"


def fixture_bytes(*parts: str) -> bytes:
    return (FIXTURES.joinpath(*parts)).read_bytes()


def fixture_text(*parts: str) -> str:
    return (FIXTURES.joinpath(*parts)).read_text(encoding="utf-8")


def fixture_json(*parts: str) -> Any:
    return json.loads(fixture_text(*parts))


@pytest.fixture
def dip_page() -> Callable[[str], dict[str, Any]]:
    """Load a recorded DIP list response by name."""

    def load(name: str) -> dict[str, Any]:
        return fixture_json("dip", name)

    return load


def mock_client(handler: Callable[[httpx.Request], httpx.Response]) -> httpx.Client:
    """An httpx client backed by a handler instead of a socket.

    `follow_redirects=False` mirrors the real client, so a test that returns a
    303 exercises the WAF path rather than being silently followed by the
    transport.
    """
    return httpx.Client(transport=httpx.MockTransport(handler), follow_redirects=False)


@pytest.fixture
def no_pacing(monkeypatch: pytest.MonkeyPatch) -> None:
    """Remove the inter-request delay and retry backoff.

    The real client sleeps ~1 s between requests and 20 s+ before a retry, which
    is correct against the WAF and unusable in a test suite. Patched at
    `time.sleep` inside the module rather than by lowering the constants, so the
    production defaults stay under test everywhere else.
    """
    import bundestrack.api.base as base

    monkeypatch.setattr(base.time, "sleep", lambda _seconds: None)
    monkeypatch.setattr(base._SHARED_PACER, "min_interval", 0.0)
