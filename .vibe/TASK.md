# Task — visual-brand-identity

Wave 7 Agent C: Brand identity and design system for Bundestracker. Do NOT ask questions — proceed autonomously.

Read /opt/data/workspace/Bundestrack-Plan-V2.md (Wave 7 section) and AGENTS.md.

Your task: Create a complete brand identity and design system inspired by German public service design guidelines.

1. RESEARCH: Search the web for German public service design guidelines (Bundesregierung, gov.de, Bundeswehr design systems). Extract color palettes, typography choices, spacing systems.

2. COLOR PALETTE:
   - Light mode (DEFAULT): White/cream background (#FAFAFA or similar), black text (#1A1A1A), gold (#C5A03A or similar warm gold) for highlights and important elements, red (#E1000F or similar) for accents and alerts
   - Dark mode: Deep black (#0A0A0A), white text, gold and red maintained
   - The palette should feel professional, official, slightly luxurious but clean and modern
   - NO yellow — use gold tones instead

3. FAVICON: Create a clean, modern, minimalist Bundesadler (eagle) favicon as an SVG. It should work at 16x16, 32x32, and 180x180 (apple touch icon). Create webapp/app/icon.svg and webapp/app/apple-icon.png (or .svg if supported).

4. TYPOGRAPHY: Choose a professional sans-serif font (Inter, or similar). Update the Tailwind font config.

5. TAILWIND CONFIG: Update webapp/tailwind.config.ts (or globals.css) with:
   - New CSS variables for the color palette (--gold, --red, --background, --foreground)
   - Light mode as default (data-theme='light' or prefers-color-scheme)
   - Dark mode as optional toggle
   - Updated shadcn/ui theme tokens to use the new palette

6. COMPONENT UPDATES: Update the theme tokens in webapp/app/globals.css and any component-level CSS. The shadcn/ui components should inherit the new palette automatically through CSS variables.

7. NAVBAR + FOOTER: Update webapp/components/site-header.tsx and site-footer to use the new brand styling.

8. Deploy the Convex changes if needed (bunx convex deploy --yes with CONVEX_DEPLOYMENT=festive-monitor-280 in .env.local)

Commit and push. Do NOT wait for input.
