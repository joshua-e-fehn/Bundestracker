"""Settings load from the environment and fail readably when they are absent."""

from __future__ import annotations

import pytest

from bundestrack.config import DEFAULT_API_BASE_URL, ConfigError, Settings


def test_defaults_to_the_public_dip_endpoint() -> None:
    settings = Settings(_env_file=None)

    assert settings.bundestag_api_base_url == DEFAULT_API_BASE_URL


def test_reads_values_from_the_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CONVEX_URL", "https://example.convex.cloud")
    monkeypatch.setenv("BUNDESTAG_API_KEY", "test-key")
    monkeypatch.setenv("BUNDESTAG_API_BASE_URL", "https://example.test/api/v1")

    settings = Settings(_env_file=None)

    assert settings.convex_url == "https://example.convex.cloud"
    assert settings.bundestag_api_key == "test-key"
    assert settings.bundestag_api_base_url == "https://example.test/api/v1"


def test_strips_trailing_slashes_so_callers_can_concatenate(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Every caller builds URLs as f"{base}/path"; a trailing slash there would
    # produce a double slash, which some gateways 404 rather than normalise.
    monkeypatch.setenv("CONVEX_URL", "https://example.convex.cloud/")
    monkeypatch.setenv("BUNDESTAG_API_BASE_URL", "https://example.test/api/v1/")

    settings = Settings(_env_file=None)

    assert settings.convex_url == "https://example.convex.cloud"
    assert settings.bundestag_api_base_url == "https://example.test/api/v1"


def test_require_convex_url_names_the_missing_variable() -> None:
    settings = Settings(_env_file=None, CONVEX_URL="")

    with pytest.raises(ConfigError, match="CONVEX_URL"):
        settings.require_convex_url()


def test_require_api_key_names_the_missing_variable() -> None:
    settings = Settings(_env_file=None, BUNDESTAG_API_KEY="")

    with pytest.raises(ConfigError, match="BUNDESTAG_API_KEY"):
        settings.require_api_key()


def test_require_accessors_return_the_value_when_set() -> None:
    settings = Settings(
        _env_file=None,
        CONVEX_URL="https://example.convex.cloud",
        BUNDESTAG_API_KEY="test-key",
    )

    assert settings.require_convex_url() == "https://example.convex.cloud"
    assert settings.require_api_key() == "test-key"


def test_the_ingestion_url_is_the_site_host_not_the_api_host() -> None:
    """A Convex deployment answers on two hosts and `/api/pipeline/*` is on one.

    Anything registered on the `httpRouter` — which is every ingestion route in
    webapp/convex/http.ts — is served from `convex.site`, while `convex.cloud`
    serves the generated client API. Posting to the wrong one returns a 404
    that looks exactly like a missing route, so the conversion is made once
    here rather than guessed at each call site.
    """
    settings = Settings(_env_file=None, CONVEX_URL="https://example.convex.cloud")

    assert settings.require_convex_http_url() == "https://example.convex.site"


def test_an_explicit_ingestion_url_wins_over_the_derived_one() -> None:
    # For a deployment served from a custom domain, where the suffix swap does
    # not apply.
    settings = Settings(
        _env_file=None,
        CONVEX_URL="https://example.convex.cloud",
        CONVEX_HTTP_URL="https://ingest.example.org/",
    )

    assert settings.require_convex_http_url() == "https://ingest.example.org"


def test_an_underivable_ingestion_url_says_so_rather_than_guessing() -> None:
    settings = Settings(_env_file=None, CONVEX_URL="https://example.org")

    with pytest.raises(ConfigError, match="CONVEX_HTTP_URL"):
        settings.require_convex_http_url()


def test_require_pipeline_api_key_names_the_missing_variable() -> None:
    # The ingestion API denies on an unset key rather than allowing
    # (webapp/convex/http.ts), so this must fail before a fetch that costs
    # hours — not as a 401 at the first write.
    settings = Settings(_env_file=None, PIPELINE_API_KEY="")

    with pytest.raises(ConfigError, match="PIPELINE_API_KEY"):
        settings.require_pipeline_api_key()
