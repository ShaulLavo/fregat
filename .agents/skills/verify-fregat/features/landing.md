# Landing page and product assets

The Astro site in `apps/site` publishes at `https://shaullavo.github.io/fregat/` through `.github/workflows/site.yml` when `main` changes. Its preview is a photograph of the real app state, not a recreated interface.

## Capture the editor

```bash
bun run agent:browser scenario editor-product \
  --url https://omarchy.mesh.shaulavo.dev/platform/ \
  --file problem-count.tsx --width 1360 --height 840 --scale 2 \
  --product-wallpaper apps/site/src/assets/garden.jpeg
```

The scenario opens four real source tabs and runs `bun run --filter web typecheck`. Inspect both step screenshots for a completed command and readable code. `product-terminals.json` records the capture-owned terminal IDs and cleanup results. A command failure is real output to investigate, never text to replace in an image.

The wallpaper is the user's temporary choice from [dharmx/walls](https://github.com/dharmx/walls/blob/main/painting/a_painting_of_a_garden_with_a_house_and_trees.jpeg). `product-wallpaper.json` records the source and browser-only appearance overrides. The tool emulates Windows so Linux compositor wallpaper policy does not suppress the app's wallpaper layer.

`product-composition.json` records the shared scene: 1600×1000 with a 1360×840 editor frame at (120, 80). The site mirrors that frame at left 7.5%, top 8%, width 85%, height 84%. Both image layers use the same centered cover crop. Keep these dimensions together when changing the composition.

Copy the final screenshot into `apps/site/src/assets/workbench.webp` using lossless format conversion. Preserve the original screenshot in its evidence directory. At scale 2 the asset is 2720×1680. Link the image to the full-resolution asset so small-screen visitors can inspect it.

## Verify the page

```bash
bun run --cwd apps/site site:build
bun run agent:browser look --static-dir apps/site/dist --width 1440 --height 1000 --selector main
bun run agent:browser look --static-dir apps/site/dist --width 390 --height 844
```

Read desktop, full-main and mobile screenshots. Check `layout.json`: both images have natural dimensions, document width equals viewport width, and the product appears above the fold. Inspect the wallpaper continuity at all four frame edges. Follow the full-resolution image and the page navigation links. The static route serves only real files inside the selected build directory and starts no server.

After publishing, run `bun run agent:browser look --site --url https://shaullavo.github.io/fregat/`. This checks document readiness and image loading on the live site without expecting workbench API routes.
