# Landing page and product assets

The Astro site in `apps/site` publishes at https://shaulavo.dev/fregat/ through
`.github/workflows/product-sites.yml`. Its Plates design uses an animated replica shipped
in PR #1012. The old live-app demo, mock backend and demo scenarios have been removed.

## Capture the editor

```bash
bun run agent:browser scenario editor-product --headed \
  --file plugins.ts --width 1360 --height 840 --scale 2 \
  --product-wallpaper apps/site/src/assets/eyes-wide.jpg
```

The scenario opens code-panel.tsx, syntax-highlighting.ts, save-service.ts and plugins.ts, frames the core plugin setup, and runs `bun run --filter web typecheck`. Inspect both step screenshots for a completed command and readable code. `product-terminals.json` records the capture-owned terminal IDs and cleanup results. A command failure is real output to investigate, never text to replace in an image.

The product capture copies the owner's local appearance: Rosé Pine syntax, Graphite, compact density, and the Omarchy `1-eyes-wide.jpg` wallpaper, stored as `apps/site/src/assets/eyes-wide.jpg`. The old garden wallpaper and social screenshot remain historical assets. `product-wallpaper.json` records the source and browser-only appearance overrides. The tool emulates Windows so Linux compositor wallpaper policy does not suppress the app's wallpaper layer.

`product-composition.json` records the capture scene, 1600×1000 with a 1360×840 editor frame at (120, 80). Preserve that composition when updating the product screenshot. The landing page replica has its own layout.

Copy the final screenshot into `apps/site/src/assets/workbench.webp` using lossless format conversion. Preserve the original screenshot in its evidence directory. At scale 2 the asset is 2720×1680. Keep the social image lossless.

## Verify the page

```bash
bun run build:workspaces
bun run --cwd apps/site site:build
bun run agent:browser look --site --static-dir apps/site/dist --width 1440 --height 1200
bun run agent:browser look --site --static-dir apps/site/dist --width 390 --height 844
```

Read desktop and mobile screenshots. Check `layout.json` for loaded images and a document
width that matches the viewport. Inspect the replica and page navigation links.

After publishing, run `bun run agent:browser look --site --url https://shaulavo.dev/fregat/`.
This checks document readiness and image loading on the live site.

For product assets, use `--headed`. `browser-renderer.json` records the actual browser and GPU.
