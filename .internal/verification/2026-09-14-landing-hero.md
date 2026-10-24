# Garden landing hero

The previous landing page put its screenshot below a large headline, at about 736px in the first desktop viewport. The new composition starts the garden at 208px and the editor at 278px. The editor is a real 2720×1680 capture with four source tabs and a successful `bun run --filter web typecheck` in its terminal. The garden is the user's temporary [dharmx/walls choice](https://github.com/dharmx/walls/blob/main/painting/a_painting_of_a_garden_with_a_house_and_trees.jpeg).

The page and editor share one centered garden crop. Capture geometry is 1600×1000 with the editor at (120, 80), sized 1360×840. The screenshot's wallpaper offset also accounts for the real toolbar height. The landing layout reproduces those proportions and links the preview to its full-resolution asset.

The verification CLI now supports static builds through Playwright routes, viewport size, pixel ratio, and browser-only product wallpaper overrides. It isolates capture terminal IDs from persistent user terminals and kills only the recorded capture-owned sessions after closing the page. The capture's cleanup report confirms one session killed, no unexpected connections and no cleanup error.

Evidence, all inspected:

- Before: `/work/tmp/fregat-evidence/20260914T143132Z-look-fregat/`.
- Real editor tabs and terminal command: `/work/tmp/fregat-evidence/20260914T145425Z-scenario-editor-product/`; both step screenshots, wallpaper/composition metadata, `product-terminals.json`.
- Desktop after: `/work/tmp/fregat-evidence/20260914T145507Z-look-fregat-1440x1000/`.
- Mobile after: `/work/tmp/fregat-evidence/20260914T145513Z-look-fregat-390x844/`.
- Full page review: `/work/tmp/fregat-evidence/20260914T145507Z-look-fregat-1440x1000/selector.png`.

Both final static previews report ready and no browser problems. Their layout records show loaded images and no document overflow at 1440px and 390px. The product scenario has no warn/error server logs; its console warnings are adapter availability and screenshot GPU readback stalls. Astro check, scripts typecheck and targeted lint pass. The final commit's pre-commit hook runs the root typecheck.

The capture recipe and page verification steps live in `.agents/skills/verify-fregat/features/landing.md`. Publishing uses the existing GitHub Pages site workflow, independent of the app's mesh deployment.

## Headed capture follow-up

The first capture used Playwright's Chromium headless shell. A fresh controlled pair records the actual browser and GPU through CDP: headless uses `HeadlessChrome/153.0.8010.12` with SwiftShader; headed uses `Chrome/153.0.8010.12` with the NVIDIA GeForce RTX 3060 Ti and GPU compositing enabled. The appearance-only Windows user-agent override never selected the rendering engine.

The replacement is a headed capture of `createCriticalEditorCorePlugins` in `plugins.ts`, with code-panel.tsx, syntax-highlighting.ts and save-service.ts open alongside it. The real terminal shows a successful web typecheck. The page now serves the original 2720×1680 lossless WebP directly, removing the lower-resolution, lossy image candidates. `layout.json` confirms that intrinsic size in the rendered page.

- Headless comparison: `/work/tmp/fregat-evidence/20260914T150601Z-scenario-editor-product/`.
- Headed comparison, same framing: `/work/tmp/fregat-evidence/20260914T150627Z-scenario-editor-product/`.
- Final headed capture, framed from the function declaration: `/work/tmp/fregat-evidence/20260914T150818Z-scenario-editor-product/`.
- Headed desktop preview: `/work/tmp/fregat-evidence/20260914T150858Z-look-fregat-1440x1000/`.
- Headed mobile preview: `/work/tmp/fregat-evidence/20260914T150911Z-look-fregat-390x844/`.

All listed screenshots were inspected. The headed runs report no browser problems or warn/error server logs. Capture-owned terminal cleanup succeeds. The build passes; root typecheck runs in the commit hook. Renderer metadata is now captured by every verification run, and the skill recipe explicitly selects headed mode for product assets.
