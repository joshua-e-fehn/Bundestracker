/**
 * Rasterises `app/icon.svg` into the two PNG icons beside it.
 *
 * ## Why PNGs exist at all, when the SVG is the real artwork
 *
 * Two consumers cannot read an SVG favicon. Safari on iOS ignores `icon.svg`
 * entirely and reads only `apple-icon.png` for the home-screen tile, and a few
 * feed readers and link-preview crawlers still ask for a raster icon. Next
 * serves whichever files are present in `app/` — see the file conventions in
 * `app/layout.tsx` — so committing the PNGs beside the SVG covers both without
 * a `<link>` tag anywhere.
 *
 * ## Why they are committed rather than generated during the build
 *
 * `sharp` is a native dependency with a per-platform binary, and the Vercel
 * build already skips its postinstall (`ignoreScripts` in package.json). Making
 * the production build depend on it would trade a 3 KB commit for a build-time
 * failure mode on a machine nobody is watching. The PNGs change only when the
 * eagle does, so they are treated as source: run this script, commit the
 * result.
 *
 *   cd webapp && bun run scripts/render-icons.ts
 *
 * `@resvg/resvg-js` is not a dependency of the webapp — it is needed only here.
 * Install it on demand:
 *
 *   bun add --no-save @resvg/resvg-js
 *
 * ## Why resvg rather than sharp
 *
 * sharp would also do this, but its SVG input goes through librsvg, which
 * rounds the background rect's `rx` differently from a browser at favicon size.
 * resvg matches what the tab will actually show, which is the whole point of
 * checking the output at 16 px.
 */

import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { Resvg } from "@resvg/resvg-js"

const appDir = join(dirname(fileURLToPath(import.meta.url)), "..", "app")

/** `icon.png` is the fallback for clients that will not read the SVG; 32 px is
 * the size a browser tab actually asks for on a 2× display. `apple-icon.png` is
 * fixed at 180 px by iOS — Safari scales anything else and the corners blur. */
const TARGETS = [
  { file: "icon.png", size: 32 },
  { file: "apple-icon.png", size: 180 },
] as const

const svg = readFileSync(join(appDir, "icon.svg"))

for (const { file, size } of TARGETS) {
  const png = new Resvg(svg, { fitTo: { mode: "width", value: size } }).render().asPng()
  writeFileSync(join(appDir, file), png)
  console.log(`${file}  ${size}×${size}  ${png.length} bytes`)
}
