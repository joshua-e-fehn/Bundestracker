"""HTTP clients for the four Bundestag data sources, plus one supplementary.

No single API answers "what did this MP do?" (docs/api-research.md §0). The
answer is assembled from:

- `DIPClient` — `search.dip.bundestag.de/api/v1`: Vorgänge, Drucksachen,
  Aktivitäten, Personen, and protocol metadata.
- `ProtocolClient` — `dserver.bundestag.de/btp/…`: speaker-attributed speeches,
  **and** roll-call name lists.
- `VoteClient` — `bundestag.de/resource/blob/…`: per-MP
  yes/no/abstain/**absent**, the only source with absences.
- `StammdatenClient` — the MdB-Stammdaten ZIP: the MP roster, mandates and
  committees.
- `MPProfileClient` — `bundestag.de/ajax/filterlist/…`: official portraits with
  their photographer credits, and what contact data is published. Supersedes
  §6.5, which predates the listing being reachable.
- `AbgeordnetenwatchClient` — `abgeordnetenwatch.de/api/v2`: mid-period
  successions, and the occupation/education enrichment that joins to the roster
  by Stammdaten id. Its `/polls` endpoint is deliberately unused — see that
  module for the three measurements behind that decision.

All extend `BundestagClient`, which fetches **strictly sequentially** and never
follows redirects — `base` explains why that is load-bearing rather than merely
conservative.

Backfill order matters, because the joins run one way: Stammdaten first (it is
the roster, and the name index everything else resolves against), then DIP
`/person`, then the rest (§11.1).

Convex is written to over its HTTP API and is not a client here — it is the
destination, not a source.
"""

from bundestrack.api.abgeordnetenwatch import (
    AbgeordnetenwatchClient,
    parse_mandates,
    parse_politicians,
    politician_stammdaten_index,
)
from bundestrack.api.base import (
    AuthenticationError,
    BundestagAPIError,
    BundestagClient,
    ConcurrentFetchError,
    NotFound,
    RateLimited,
    paginate_cursor,
)
from bundestrack.api.dip import DIPClient
from bundestrack.api.mp_profiles import (
    MPProfileClient,
    parse_biography,
    parse_listing,
)
from bundestrack.api.protocols import ProtocolClient, protocol_xml_url
from bundestrack.api.stammdaten import StammdatenClient
from bundestrack.api.votes import VoteClient, parse_sheet

__all__ = [
    "AbgeordnetenwatchClient",
    "AuthenticationError",
    "BundestagAPIError",
    "BundestagClient",
    "ConcurrentFetchError",
    "DIPClient",
    "MPProfileClient",
    "NotFound",
    "ProtocolClient",
    "RateLimited",
    "StammdatenClient",
    "VoteClient",
    "paginate_cursor",
    "parse_biography",
    "parse_listing",
    "parse_mandates",
    "parse_politicians",
    "parse_sheet",
    "politician_stammdaten_index",
    "protocol_xml_url",
]
