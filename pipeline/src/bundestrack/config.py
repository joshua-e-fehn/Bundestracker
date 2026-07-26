"""Runtime configuration, read from the environment.

Every setting the pipeline needs to reach the outside world lives here, so a
misconfigured deployment fails once at startup with a readable message rather
than at the first HTTP call with a `None` in the URL.

`.env` is loaded when present — convenient locally, ignored in CI and cron
where the variables are set for real.
"""

from __future__ import annotations

from functools import lru_cache

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# The DIP (Dokumentations- und Informationssystem für Parlamentsmaterialien)
# API. The key below is the public one the Bundestag publishes for anonymous
# access; it is rate-limited but requires no registration, so it is the default
# rather than a required secret.
DEFAULT_API_BASE_URL = "https://search.dip.bundestag.de/api/v1"


class Settings(BaseSettings):
    """Pipeline settings, sourced from environment variables."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    convex_url: str = Field(
        default="",
        validation_alias="CONVEX_URL",
        description=(
            "Convex deployment URL, e.g. https://<deployment>.convex.cloud. "
            "The pipeline POSTs mutations to <convex_url>/api/mutation."
        ),
    )
    bundestag_api_key: str = Field(
        default="",
        validation_alias="BUNDESTAG_API_KEY",
        description="DIP API key. Public keys are published by the Bundestag.",
    )
    bundestag_api_base_url: str = Field(
        default=DEFAULT_API_BASE_URL,
        validation_alias="BUNDESTAG_API_BASE_URL",
        description="Base URL of the Bundestag DIP API.",
    )

    @field_validator("convex_url", "bundestag_api_base_url")
    @classmethod
    def _strip_trailing_slash(cls, value: str) -> str:
        # Every caller builds URLs as f"{base}/path"; normalising here means no
        # caller has to remember whether the base ends in a slash.
        return value.rstrip("/")

    def require_convex_url(self) -> str:
        """The Convex URL, or a readable error when it is unset.

        Read commands (`--dry-run`, schema inspection) work without it, so this
        is a method rather than a required field — only the write path calls it.
        """
        if not self.convex_url:
            raise ConfigError(
                "CONVEX_URL is not set. Point it at the deployment, e.g. "
                "https://<deployment>.convex.cloud"
            )
        return self.convex_url

    def require_api_key(self) -> str:
        """The DIP API key, or a readable error when it is unset."""
        if not self.bundestag_api_key:
            raise ConfigError(
                "BUNDESTAG_API_KEY is not set. The Bundestag publishes a public "
                "key for anonymous access to the DIP API."
            )
        return self.bundestag_api_key


class ConfigError(RuntimeError):
    """A required setting is missing or malformed."""


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """The process-wide settings singleton.

    Cached so the environment is read once: tests that need a different
    configuration call `get_settings.cache_clear()`.
    """
    return Settings()
