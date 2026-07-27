# Task — favicon-white-bg

Edit webapp/app/icon.svg: change background from #131311 to white #ffffff, add a thin gold circle (#c59f3a) around the eagle inside the SVG. Then edit webapp/components/brand-mark.tsx: add a circle outline (stroke=currentColor, fill=none) to the SVG so the emblem shows eagle+circle everywhere. Then check webapp/components/hero-animation.tsx: remove any CSS circle that would now double up. Then check webapp/components/providers/theme-provider.tsx defaults to light mode. Run bun run typecheck. Commit and push to main.
