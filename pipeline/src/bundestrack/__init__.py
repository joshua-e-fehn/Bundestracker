"""Bundestrack data pipeline.

Fetches parliamentary activity from the Bundestag Open Data API (DIP),
normalises it, and writes it into Convex via the HTTP mutation endpoint.
"""

__version__ = "0.1.0"

__all__ = ["__version__"]
