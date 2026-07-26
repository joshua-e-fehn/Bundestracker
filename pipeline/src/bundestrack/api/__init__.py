"""HTTP clients for the outside world.

Two of them land here: the Bundestag DIP API (read) and Convex (write, via
`POST <convex_url>/api/mutation`). Both are `httpx`-based.
"""
