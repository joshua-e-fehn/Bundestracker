<<<<<<< HEAD
# Task — pipeline-orchestration

Build the pipeline orchestration for the Bundestracker data pipeline. The API clients are already implemented in pipeline/src/bundestrack/api/ (base.py, dip.py, votes.py, stammdaten.py, protocols.py, abgeordnetenwatch.py). Read those files to understand the interfaces.

Your task: implement pipeline/src/bundestrack/pipeline/ — the fetch → transform → load pipeline that orchestrates the API clients and writes to Convex via HTTP.

Read docs/api-research.md for the critical architectural findings, especially:
- §7: The join problem (three incompatible ID spaces) — mint an internal Bundestrack MP ID
- §7.1: Name-matching algorithm (verified 628/630)
- §7.4: Recommendation to mint internal ID and store all external IDs against it
- §11: Recommended pipeline design

Implement these files:

1. pipeline/src/bundestrack/pipeline/join.py — The MP identity resolution layer:
   - Mint internal Bundestrack MP IDs
   - Cross-reference DIP person ID ↔ Stammdaten ID via name matching (diacritic folding, ORTSZUSATZ disambiguation)
   - Match vote sheet names to Stammdaten IDs (the 628/630 algorithm from §7.1)
   - Store all external IDs against the internal ID
   - Quarantine unmatched names for retry on later syncs

2. pipeline/src/bundestrack/pipeline/transform.py — Transform raw API responses to Convex schema shapes:
   - Transform DIP person → mp shape
   - Transform Stammdaten XML → mp shape (merge with DIP data)
   - Transform vote XLSX → voteSheet + voteRecords (with name matching)
   - Transform protocol XML → speeches (multi-speaker re-attribution)
   - Transform DIP aktivitaet → activities + activityEvents
   - Transform DIP vorgang/drucksache → motions + motionSponsors
   - Transform Stammdaten committees → committeeMemberships

3. pipeline/src/bundestrack/pipeline/load.py — Load transformed data to Convex via HTTP API:
   - POST to Convex HTTP mutation endpoints (defined in webapp/convex/http.ts)
   - Idempotent upserts by external ID
   - Batch writes (chunk large payloads)
   - Error handling, retry on failure
   - Progress tracking

4. pipeline/src/bundestrack/pipeline/sync.py — Orchestration:
   - init() — Full backfill of current Wahlperiode (21): fetch all MPs, all votes, all protocols, all activities, all motions → transform → load
   - sync() — Daily incremental: fetch only new/updated data since last sync → transform → load
   - backfill(wahlperiode) — Backfill a specific electoral period
   - recompute_scores() — Trigger Convex cron to recompute activity scores

5. pipeline/src/bundestrack/pipeline/__init__.py — Re-exports

6. Update pipeline/src/bundestrack/cli.py to wire the pipeline commands:
   - bundestracker init — calls sync.init() for the current WP
   - bundestracker sync — calls sync.sync() for daily incremental
   - bundestracker backfill --wp <N> — calls sync.backfill(N)
   - bundestracker scores — calls sync.recompute_scores()

7. pipeline/src/bundestrack/config.py should already have CONVEX_URL, BUNDESTAG_API_KEY, BUNDESTAG_API_BASE_URL. Add CONVEX_HTTP_URL (the Convex deployment HTTP endpoint URL).

Write tests for the transform and join logic.
=======
# Task — frontend-layout-homepage

Build the core frontend layout, i18n, and homepage for Bundestracker. The webapp is already scaffolded with Next.js 16, shadcn/ui, Tailwind, Biome, and i18n foundation (lib/i18n.ts). Read AGENTS.md and the existing code first.

Your task: build the layout and homepage.

1. Navigation bar (sticky, responsive):
   - Logo/brand: 'Bundestracker'
   - Nav links: MPs, Votes, Motions, Rankings, Activity Feed
   - Language toggle (DE/EN) — use the existing i18n setup in lib/i18n.ts
   - Theme toggle (dark/light) — next-themes is already installed
   - Sign In button (shows user avatar if logged in)
   - Mobile responsive (hamburger menu)

2. Footer:
   - Data source attribution: 'Deutscher Bundestag — Open Data'
   - Link to GitHub repo
   - Language toggle
   - 'Built by Joshua Fehn'

3. Homepage (/):
   - Hero section: 'Bundestracker' title + tagline (bilingual: 'Objektiver Aktivitäts-Tracker für den Deutschen Bundestag' / 'Objective Activity Tracker for the German Bundestag')
   - Summary stats cards: Total MPs (630+), Total Named Votes, Total Motions, Total Speeches — use Convex queries
   - Top 5 Most Active MPs (by default activity score) — clickable cards linking to profile
   - Latest Named Votes — list of 5 most recent votes with result badges
   - Activity Feed Preview — 10 most recent activity events
   - 'Browse All MPs' CTA button

4. Layout structure (app/layout.tsx):
   - Wrap with ThemeProvider, LocaleProvider, AuthProvider, QueryProvider (all already exist in components/providers/)
   - Inter or system font
   - shadcn Toast provider
   - Meta tags for SEO

5. Set up shadcn components you need: Button, Card, Badge, Avatar, Dropdown, Sheet (for mobile menu), Skeleton (for loading), Table, Tabs.

6. Dark mode as default (the aesthetic from SOUL.md — dark interfaces, stellar cartography vibes). Use a dark theme with subtle accent colors per party (CDU black, SPD red, Grüne green, FDP yellow, AfD blue, Linke purple/magenta, fraktionslos gray).

7. Create a shared MP card component (components/mp-card.tsx) — shows photo, name, party badge, activity score, mini contribution heatmap.

8. Create a shared party badge component (components/party-badge.tsx) — colored badge per Fraktion.

All text must be bilingual (DE/EN) using the existing i18n system. German is the default.
>>>>>>> 750938d (feat: site layout, bilingual chrome, and the homepage (#6))

Commit and push when done.
