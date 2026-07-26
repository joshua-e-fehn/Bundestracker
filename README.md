# Bundestrack

Objective activity tracker for members of the German Bundestag. A "GitHub contributions graph for MPs" — transparent, measurable parliamentary activity based on publicly available official data.

## Structure

- `pipeline/` — Python data pipeline (fetches Bundestag API data, writes to Convex)
- `webapp/` — Next.js 16 + Convex + shadcn/ui frontend

## Tech Stack

- **Monorepo:** Pixi
- **Frontend:** Next.js 16, Bun, shadcn/ui, Tailwind CSS, Biome
- **Backend:** Convex
- **Auth:** Better Auth (convex-dev/better-auth), Google + GitHub OAuth
- **Data Pipeline:** Python (httpx, pydantic, Ruff)
- **i18n:** Bilingual DE/EN, German default