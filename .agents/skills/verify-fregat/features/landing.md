# Landing page and product assets

The Astro site in `apps/site` publishes at `https://shaullavo.github.io/fregat/` through `.github/workflows/site.yml`. Its hero embeds the real app with a browser-only simulated workspace. The product screenshot is used only for social previews. The real app stays visible while it loads, with no screenshot handoff.

## Drive the interactive demo

```bash
bun run --cwd apps/site site:build
bun run agent:browser scenario demo-workspace --headed --url http://localhost:5173/fregat/demo/index.html
bun run agent:browser scenario demo-agent-git --headed --url http://localhost:5173/fregat/demo/index.html
bun run agent:browser scenario demo-reset --headed --url http://localhost:5173/fregat/ --width 1440 --height 1200
```

The existing Vite server serves the built files. Use the production build for interaction checks because a development reload resets the in-memory workspace. The first scenario proves an editor save appears in search and terminal output. The second stages and commits a change, then submits an agent prompt. The third edits through the iframe and uses the page's reset control to restore the seed.

Read the screenshots and `inspection.json`. Every backend response should come from the demo origin, with no unhandled request and no native backend WebSocket. Client log batches retain caught React errors, which may not appear as page errors. Keep unsupported operations explicit; a successful response without the corresponding state change is a broken simulation.

## Capture the editor

```bash
bun run agent:browser scenario editor-product --headed \
  --url https://omarchy.mesh.shaulavo.dev/platform/ \
  --file plugins.ts --width 1360 --height 840 --scale 2 \
  --product-wallpaper apps/site/src/assets/eyes-wide.jpg
```

The scenario opens code-panel.tsx, syntax-highlighting.ts, save-service.ts and plugins.ts, frames the core plugin setup, and runs `bun run --filter web typecheck`. Inspect both step screenshots for a completed command and readable code. `product-terminals.json` records the capture-owned terminal IDs and cleanup results. A command failure is real output to investigate, never text to replace in an image.

The current demo copies the owner's local appearance: Rosé Pine syntax, Graphite, compact density, and the Omarchy `1-eyes-wide.jpg` wallpaper, stored as `apps/site/src/assets/eyes-wide.jpg`. The old garden wallpaper and social screenshot remain historical assets. `product-wallpaper.json` records the source and browser-only appearance overrides. The tool emulates Windows so Linux compositor wallpaper policy does not suppress the app's wallpaper layer.

`product-composition.json` records the shared scene: 1600×1000 with a 1360×840 editor frame at (120, 80). The site mirrors that frame at left 7.5%, top 8%, width 85%, height 84%. Both image layers use the same centered cover crop. Keep these dimensions together when changing the composition.

Copy the final screenshot into `apps/site/src/assets/workbench.webp` using lossless format conversion. Preserve the original screenshot in its evidence directory. At scale 2 the asset is 2720×1680. Keep the social image lossless; the full-size link opens the interactive app.

## Verify the page

```bash
bun run --cwd apps/site site:build
bun run agent:browser look --site --headed --url http://localhost:5173/fregat/ --width 1440 --height 1200
bun run agent:browser look --site --headed --url http://localhost:5173/fregat/ --width 390 --height 844
```

Read desktop and mobile screenshots. Check `layout.json`: images loaded, the iframe is ready, document width equals viewport width, and the product appears above the fold. Inspect the wallpaper continuity at all four frame edges. Follow the full-size demo and page navigation links.

After publishing, run `bun run agent:browser look --site --url https://shaullavo.github.io/fregat/`. This checks document readiness and image loading on the live site without expecting workbench API routes.

For product assets, use `--headed`. `browser-renderer.json` records the actual browser and GPU through CDP, independent of the appearance-only user-agent override. On this machine the headless shell uses SwiftShader software rendering; the headed browser uses the NVIDIA GPU. Do not infer the rendering engine from the spoofed platform string.

Run `scenario demo-startup --headed --url http://localhost:5173/fregat/` for startup changes. It captures the initial iframe and the ready app, and fails if the iframe starts hidden or a screenshot preview is present.

Run `scenario demo-theme-startup --headed --url http://localhost:5173/fregat/ --width 1440 --height 1200` for pre-paint theme changes. It emulates a light OS, delays the demo entry module, and captures theme/class/background transitions from the first animation frame through readiness. Read both screenshots and `inspection.json`; a ready-only screenshot cannot prove the absence of a startup flash.

The HTML entries share inline `boot.css` through the Vite boot-appearance plugin. The demo starts dark and seeds its isolated settings mirror before importing the real app. It must remain visible during loading.

Theme startup evidence (2026-09-14): before `/work/tmp/fregat-evidence/20260914T170954Z-scenario-demo-theme-startup/` recorded unresolved → light → dark; after `/work/tmp/fregat-evidence/20260914T171539Z-scenario-demo-theme-startup/` recorded only dark, with no browser problems. Both ready screenshots were inspected; the after capture also shows the local appearance experiment.

Run `scenario demo-wallpaper-startup --headed --url http://localhost:5173/fregat/ --width 1440 --height 1200` for wallpaper startup changes. It records the bounds of every visible wallpaper geometry from first load through readiness. Every sample must already match the shared scene, within one CSS pixel. Read `01-first-wallpaper.png`, `02-ready.png`, and `inspection.json`.

The embedded crop lives in `apps/web/src/demo-wallpaper.css`, loaded before the app renders. Viewport units and `--bar-height` keep the crop aligned without measuring after readiness. The standalone demo keeps normal wallpaper sizing.

Crop evidence (2026-09-14): before `/work/tmp/fregat-evidence/20260914T172317Z-scenario-demo-wallpaper-startup/` changed from 1360×804 at (0, 36) to 1600×1000 at (−120, −80); after `/work/tmp/fregat-evidence/20260914T172551Z-scenario-demo-wallpaper-startup/` stayed at the final crop from the first sample. Both runs had no browser problems and both screenshots were inspected. Standalone check `/work/tmp/fregat-evidence/20260914T172551Z-look-fregat-demo-index-html-1360x840/` passed and its screenshot was inspected.
