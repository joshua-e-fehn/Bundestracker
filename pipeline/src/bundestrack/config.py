"""Runtime configuration, read from the environment.

Every setting the pipeline needs to reach the outside world lives here, so a
misconfigured deployment fails once at startup with a readable message rather
than at the first HTTP call with a `None` in the URL.

`.env` is loaded when present — convenient locally, ignored in CI and cron
where the variables are set for real.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from urllib.parse import urlsplit

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# The DIP (Dokumentations- und Informationssystem für Parlamentsmaterialien)
# API. The key below is the public one the Bundestag publishes for anonymous
# access; it is rate-limited but requires no registration, so it is the default
# rather than a required secret.
DEFAULT_API_BASE_URL = "https://search.dip.bundestag.de/api/v1"

#: A Convex deployment answers on two hosts, and the ingestion API is on the
#: *second* one: `convex.cloud` serves the generated client API, while anything
#: registered on the `httpRouter` — which is what `/api/pipeline/*` is
#: (webapp/convex/http.ts) — is served from `convex.site`. Posting to the cloud
#: host returns a 404 that looks exactly like a missing route, so the two
#: spellings are converted here once rather than guessed at each call site.
CONVEX_API_HOST_SUFFIX = ".convex.cloud"
CONVEX_SITE_HOST_SUFFIX = ".convex.site"

#: Where a sync records what it has already seen. Under the pipeline package's
#: working directory rather than a temp path: the daily cron must find the
#: previous run's watermark, and a watermark that vanishes turns every sync
#: into a full backfill against a WAF that IP-blocks (§2.6).
DEFAULT_STATE_PATH = Path(".bundestrack-state.json")


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
    convex_http_url: str = Field(
        default="",
        validation_alias="CONVEX_HTTP_URL",
        description=(
            "Convex HTTP endpoint URL, e.g. https://<deployment>.convex.site. "
            "This is where /api/pipeline/* lives. Derived from CONVEX_URL when "
            "unset, so only a deployment with a custom domain needs to set it."
        ),
    )
    pipeline_api_key: str = Field(
        default="",
        validation_alias="PIPELINE_API_KEY",
        description=(
            "Shared secret presented as `Authorization: Bearer` to the Convex "
            "ingestion API. Must match `PIPELINE_API_KEY` on the deployment."
        ),
    )
    expected_deployment: str = Field(
        default="",
        validation_alias="BUNDESTRACK_EXPECTED_DEPLOYMENT",
        description=(
            "When set, the only Convex deployment this process may write to, e.g. "
            "whimsical-bandicoot-307. Checked against the resolved ingestion URL — "
            "the one every write actually goes to — so no spelling of "
            "CONVEX_HTTP_URL can point a pinned run at another deployment."
        ),
    )
    state_path: Path = Field(
        default=DEFAULT_STATE_PATH,
        validation_alias="BUNDESTRACK_STATE_PATH",
        description="Where the incremental sync stores its watermark and quarantine.",
    )

    @field_validator("convex_url", "convex_http_url", "bundestag_api_base_url")
    @classmethod
    def _strip_trailing_slash(cls, value: str) -> str:
        # Every caller builds URLs as f"{base}/path"; normalising here means no
        # caller has to remember whether the base ends in a slash.
        return value.rstrip("/")

    def require_convex_http_url(self) -> str:
        """The Convex HTTP endpoint, or a readable error when it cannot be found.

        Falls back to `CONVEX_URL` with the host rewritten, because the two are
        the same deployment and asking an operator to set both invites them to
        drift. The explicit variable still wins, for a deployment served from a
        custom domain where the suffix swap does not apply.
        """
        if self.convex_http_url:
            return self._pinned(self.convex_http_url)
        convex_url = self.require_convex_url()
        if convex_url.endswith(CONVEX_API_HOST_SUFFIX):
            return self._pinned(
                convex_url[: -len(CONVEX_API_HOST_SUFFIX)] + CONVEX_SITE_HOST_SUFFIX
            )
        raise ConfigError(
            f"CONVEX_HTTP_URL is not set and {convex_url!r} does not end in "
            f"{CONVEX_API_HOST_SUFFIX}, so the site URL cannot be derived from it. "
            "Set CONVEX_HTTP_URL to the deployment's HTTP endpoint, e.g. "
            "https://<deployment>.convex.site"
        )

    def _pinned(self, ingestion_url: str) -> str:
        """`ingestion_url`, or a refusal when it names the wrong deployment.

        The check sits here — on the URL every write is sent to — rather than
        in the scheduler wrapper, because the wrapper can only guess which of
        `CONVEX_URL`, `CONVEX_HTTP_URL`, the environment, `.env`, or a
        differently-cased key pydantic-settings will settle on. Several
        deployments share credentials on the production host, another app's
        among them, and a wrong-but-valid one answers every write with success.
        """
        if not self.expected_deployment:
            return ingestion_url
        expected = f"{self.expected_deployment}{CONVEX_SITE_HOST_SUFFIX}"
        host = urlsplit(ingestion_url).hostname or ""
        if host != expected:
            raise ConfigError(
                f"The ingestion URL's host is {host!r}, but BUNDESTRACK_EXPECTED_DEPLOYMENT "
                f"pins writes to {expected!r}. Refusing to write to another deployment."
            )
        return ingestion_url

    def require_pipeline_api_key(self) -> str:
        """The ingestion key, or a readable error when it is unset.

        Checked before a run rather than at the first POST: the ingestion API
        denies on an unset key (webapp/convex/http.ts), so the alternative is
        discovering it as a 401 after a full fetch has already been paid for.
        """
        if not self.pipeline_api_key:
            raise ConfigError(
                "PIPELINE_API_KEY is not set. It must match the value set on the "
                'Convex deployment with `bunx convex env set PIPELINE_API_KEY "…"`.'
            )
        return self.pipeline_api_key

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
