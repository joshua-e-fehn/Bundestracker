"""Pydantic models for DIP records and the Convex documents they become.

The DIP shapes are the wire format and are validated on the way in; the Convex
shapes are what the ingestion mutations accept and are validated on the way
out. Keeping both here means a change in either contract has one place to land.
"""
