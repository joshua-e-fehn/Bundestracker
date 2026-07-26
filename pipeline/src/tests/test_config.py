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
