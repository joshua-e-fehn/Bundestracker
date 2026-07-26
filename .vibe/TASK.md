# Task — python-api-client

Build the Python API client for the Bundestracker data pipeline. Read docs/api-research.md FIRST — it contains the complete API research with all endpoints, pagination rules, WAF bot-protection handling, and authentication details.

Your task: implement pipeline/src/bundestrack/api/ — a typed API client for all Bundestag data sources described in the research.

Key findings from the research you MUST handle:

1. DIP API (search.dip.bundestag.de/api/v1):
   - 16 endpoints: /vorgang, /vorgangsposition, /drucksache, /drucksache-text, /plenarprotokoll, /plenarprotokoll-text, /aktivitaet, /person (each with /{id} sibling)
   - API key in Authorization header: 'ApiKey <key>'
   - A working key is published in the OpenAPI spec: R2BZaee.DjdCyihKZMf8AOjtScubP2EVydegzjmBIQ
   - Self-healing: on 401, re-fetch openapi.yaml and parse the current key
   - Pagination: opaque cursor, NOT offset. Page size is 100 for most endpoints, 10 for -text endpoints. Repeat with cursor=<last cursor>, stop when cursor stops changing.
   - WAF bot protection (Enodia): returns 303 redirect to /.enodia/ challenge. NEVER follow redirects. Fetch strictly sequentially — no async gather, no thread pools.
   - Always pass f.zuordnung=BT to filter out Bundesrat documents.
   - OpenAPI spec bugs: 5 Person fields typed as string come back as arrays; PersonRole.funktion is declared required but never appears.

2. Named vote XLSX sheets (bundestag.de/resource/blob/...):
   - Discover URLs by scraping the AJAX endpoint: https://www.bundestag.de/ajax/filterlist/de/parlament/plenum/abstimmung/liste/462112-462112?limit=30&noFilterSet=true&offset=0
   - Parse with openpyxl. Columns: Wahlperiode, Sitzungnr, Abstimmnr, Fraktion/Gruppe, Name, Vorname, Titel, ja, nein, Enthaltung, ungültig, nichtabgegeben, Bezeichnung, Bemerkung
   - Vote encoding is one-hot across 5 columns. Titel column holds name particles (von, van, de), NOT academic titles.
   - No MP ID column — names only.

3. MdB-Stammdaten XML (ZIP download):
   - Contains MP biographies, mandates, Wahlkreis, committees.
   - Parse all <NAME> entries (including historical), NACHNAME, VORNAME, ORTSZUSATZ, PRAEFIX.
   - Current-WP-only for committee memberships.

4. Plenary protocol XML (dserver.bundestag.de/btp/...):
   - Speech data: <rede> elements with <redner id> = Stammdaten ID.
   - ONE <rede> can contain multiple speakers (Zwischenfragen) — re-attribute on every klasse='redner' paragraph.
   - Protocol XML also contains roll-call vote name lists (AL_Namen, AL_Ja-Nein-Enth, AL_Partei).
   - Party labels contain non-breaking spaces (\xa0) — normalize before matching.

5. abgeordnetenwatch.de API v2 (supplementary, CC0, no key):
   - https://www.abgeordnetenwatch.de/api/v2/
   - Clean JSON with stable IDs. Use for validation, not as system of record.

Implement these files:
- pipeline/src/bundestrack/api/dip.py — DIP API client (all 16 endpoints, cursor pagination, API key self-healing, WAF handling)
- pipeline/src/bundestrack/api/votes.py — Vote XLSX client (AJAX scraping, openpyxl parsing)
- pipeline/src/bundestrack/api/stammdaten.py — MdB-Stammdaten XML client
- pipeline/src/bundestrack/api/protocols.py — Plenary protocol XML client (speech parsing, vote name lists)
- pipeline/src/bundestrack/api/abgeordnetenwatch.py — abgeordnetenwatch API v2 client
- pipeline/src/bundestrack/api/base.py — Shared base: WAF-safe HTTP session, retry logic, sequential fetch enforcement
- pipeline/src/bundestrack/models/dip.py — Pydantic models for DIP entities (Person, Vorgang, Drucksache, Aktivitaet, Plenarprotokoll)
- pipeline/src/bundestrack/models/votes.py — Pydantic models for vote data (VoteSheet, VoteRecord)
- pipeline/src/bundestrack/models/stammdaten.py — Pydantic models for MdB-Stammdaten (MP, CommitteeMembership)
- pipeline/src/bundestrack/models/speeches.py — Pydantic models for speech data (Speech, Protocol)
- pipeline/src/bundestrack/api/__init__.py — Re-exports

Use httpx for HTTP (sync client, NOT async — WAF requires sequential fetching). Use openpyxl for XLSX parsing. Use xml.etree.ElementTree or lxml for XML parsing. Use pydantic v2 for models.

Write tests in pipeline/src/tests/ with recorded fixtures (small XML/XLSX samples saved as test data).

Commit and push when done.
