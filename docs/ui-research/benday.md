# benday

<https://benday.kacemmathlouthi.dev/> · repo <https://github.com/KacemMathlouthi/benday> · clone `references/benday` (04e05f3)

## What it is

A single canvas component that samples a logo into a Ben-Day (halftone) dot grid and animates the dots while something is busy. When the work finishes it springs back into the crisp mark. It is meant as a branded "thinking" indicator for agent UIs.

- `state` is the whole control surface: `thinking` runs a preset. `idle` and `done` settle the dots into the crisp mark through a spring.
- 21 presets in 5 families: Signature (contour, shimmer, ripple, breathe), Sweep (scan, cascade, weave, rain), Orbit (swirl, orbit, comet, radar, pinwheel, beacon), Field (flicker, wave, equalizer, resolve) and Transform (scatter, magnetic, glitch). A preset is a per-dot function `(dot, t, out) => void` that writes into a reused object, so a frame allocates nothing.
- The bake (`bake.ts`) turns SVG/PNG/Blob input into a `DotMap` JSON through a canvas. It can run at build time, and then the client does no bake work.
- Small sizes are tuned on purpose. Below 32px it adds optical weight, damps motion, snaps to the device pixel grid and merges sub-2px cells. 16–24px is the target case.
- Colour is `currentColor`, resolved from the canvas and re-resolved on theme change. It follows `prefers-reduced-motion` and stops painting off-screen or in a hidden tab (`dom.ts: watchPaintability`).

## License, stack, deps

- MIT.
- 7 files, about 2.1k lines: `benday.tsx` (199) plus `bake.ts`, `renderer.ts`, `presets.ts`, `dom.ts`, `types.ts`, `use-dot-map.ts`. React is the only import.
- `renderer.ts` is framework-free: `createRenderer(canvas, opts)` returns `{update, destroy}`. The React wrapper only owns the element.
- The wrapper already says it is React Compiler-aware ("writing a ref during render is what React Compiler rules out"). One mount effect creates the renderer and one effect pushes prop changes through `update()`.
- Tests (bun test) cover bake, presets and renderer.

## Catalog

| Piece                              | Link                                                                                    |
| ---------------------------------- | --------------------------------------------------------------------------------------- |
| Component + API                    | <https://benday.kacemmathlouthi.dev/usage.md>                                           |
| Playground (drop a logo, copy JSX) | <https://benday.kacemmathlouthi.dev/playground>                                         |
| Registry                           | <https://benday.kacemmathlouthi.dev/r/registry.json> (`bunx shadcn add @benday/benday`) |
| Launch video (Remotion)            | `references/benday/apps/launch-video`                                                   |

## Candidate uses

Our mark suits this well. The fregat logo is six rings, the stage's six tanks (`apps/site/public/favicon.svg`, inlined in `apps/site/src/pages/index.astro` header). The `orbit`, `pinwheel` and `beacon` presets would animate it as the tanks, not as a generic spinner. The web app has no brand mark today: `apps/web/index.html` uses `vscode-icons/code.svg` as its favicon.

Ranked:

1. **Boot screen.** `apps/web/src/components/application-bootstrap.tsx` uses `RingLoader` for the whole-surface wait. Replace it with the fregat mark in `thinking`, then `done` as the workbench mounts. This is where a user sees the app's name first. _Port the code._
2. **Landing page while the demo loads.** `apps/site/src/pages/index.astro` shows the text "loading demo…" (`#demo-status`) and `aria-busy` on `#demo-frame`. The site is Astro with no React, so call `createRenderer()` from a plain `<script>` with a build-time `DotMap`. Also animate the header wordmark on hover. _Copy the code (renderer only)._
3. **Agent "working" mark per provider.** Candidates: `features/chat/components/composer-activity-status.tsx`, `live-activity-row.tsx` and `chat-mode/components/stage-body.tsx` ("Opening session"). A Claude or Codex mark dot-animates while that provider's turn runs, which tells you who is working, not only that something is. _Port the idea._ Needs provider marks we do not ship yet, and a trademark check.
4. **Tab favicon while an agent works.** `features/chat-mode/state/notification-host.ts` already repaints the one `link[rel=icon]` for notification counts (`drawNotificationBadge`). Paint a few benday frames of the mark into it while a background session runs, and settle it to crisp on completion. Low frequency (about 4 fps) because browsers throttle background tabs. _Port the idea._
5. **Desktop splash** (`apps/desktop`, Electrobun) and the TUI agent view (`apps/tui`). A `DotMap` is a plain grid, so the TUI can render it as braille cells (2×4 dots per cell) for a branded spinner in OpenTUI. _Port the idea (data format)._
6. **Empty and first-run states.** `EmptyState` on the welcome or "no folder open" surface: the mark in `idle`, crisp, with `breathe` on hover. _Port the idea._
7. **Launch video and OG image.** benday ships a Remotion `apps/launch-video`, which is a template for a fregat launch clip. _Port the idea._
8. **Halftone wallpaper thumbnails** (wallpaper picker). Possible, but it misuses the tool, which draws one mark. _Skip._

Rule to avoid: the session rail's `session-attention-indicator.tsx` (12px, one per row). The rail has a zero-render contract, and one rAF canvas per row is the cost the rail is built to avoid.

## Cost / risk

- **Design rule conflict.** AGENTS.md says there are exactly four loaders. benday would be a fifth primitive (`BrandLoader` in `packages/ui/src/components/`) with a stated "where": boot, first paint and brand moments. It must not spread into ordinary controls, where OrbitLoader stays.
- Canvas plus rAF per instance. That is fine for 1–3 on screen and wrong for lists.
- Bake at build time (a Vite plugin or a checked-in JSON) so the app never loads the logo through a canvas at runtime.
- `renderer.ts` throws `new Error`. The copy must use our `createStructuredError`. Run `compiler:census` on the copied wrapper.

## Open questions

- Is the six-ring mark the app's brand too, not only the site's? Today the app favicon is VS Code's.
- Is a fifth loader acceptable if it is limited to brand moments (boot, landing, desktop splash)?
- Should agent indicators show provider marks (Claude/Codex logos), or always our mark?
