# Plan 264: Image and safe SVG preview commands

## Status and authorization

Status: APPROVED 2026-09-29. Requested by the owner: "implement everything Zed has". Size: M. Depends on Plan 206, Plan 237.

Triage assignment: ZT-45 in `/work/reports/keymap-wave/zed-feature-triage.json`; binding contexts and payloads in `/work/reports/keymap-wave/206-zed-translation.json`. Zed behavior below is pinned to `933d8d93`.

## Outcome

Inspect images at actual size or fit them to a pane, zoom in and out, reset pan/zoom, and open live SVG previews in the current pane or beside source.

## Zed actions and behavior

- `image_viewer::ZoomIn` multiplies zoom by the configured step; `image_viewer::ZoomOut` divides it, with min/max clamps. `image_viewer::ResetZoom` and `image_viewer::ZoomToActualSize` both set scale 1 and clear pan. `image_viewer::FitToView` uses the smaller width/height ratio, capped at 1, and clears pan. [crates/image_viewer/src/image_viewer.rs](https://github.com/zed-industries/zed/blob/933d8d93/crates/image_viewer/src/image_viewer.rs#L210).

- `svg::OpenPreview` reuses or opens a source-linked view in the active pane; `svg::OpenPreviewToTheSide` uses an adjacent pane and preserves source focus. The preview observes the live source buffer. [crates/svg_preview/src/svg_preview_view.rs](https://github.com/zed-industries/zed/blob/933d8d93/crates/svg_preview/src/svg_preview_view.rs#L205).

## Existing Fregat and Editor support

[apps/web/src/lib/file-preview/utils/preview.ts](../apps/web/src/lib/file-preview/utils/preview.ts) recognizes image/SVG extensions and constructs `/fs/blob` URLs. [apps/web/src/lib/fs-blob-image.ts](../apps/web/src/lib/fs-blob-image.ts) supplies the authenticated CORS image policy. Existing [apps/web/src/features/chat/components/chat-image-lightbox.tsx](../apps/web/src/features/chat/components/chat-image-lightbox.tsx) is a chat attachment view. A source-linked zoomable workbench image/SVG viewer has not been established.

SVG can read existing document snapshots from `editor/packages/editor/src/documentSession.ts` after Plan 207, verified in [the current Editor source](../editor/packages/editor/src/documentSession.ts).

## Design

Commands join [apps/web/src/keymap/table.ts](../apps/web/src/keymap/table.ts) with typed arguments and availability, following [the keymap architecture](../docs/keymap/architecture.md). Linux/macOS bindings are preset data under `apps/web/src/keymap/presets/` per Plan 206, retaining source contexts and payloads. The host dispatcher owns keys; handlers decline when their owner is unavailable. Add media preview records to Plan 237 workbench placement and a per-view zustand store for zoom/pan/source revision. `ImageViewer` handles image commands; `Editor && extension == svg` opens SVG previews. Use intrinsic dimensions and container geometry for fit, keep 1:1 distinct from fit, and reset pan on reset/actual-size. Read files through queries and release object URLs when their owner disposes. Register adjustable zoom constraints in the settings registry. Render SVG in image decoding or the Plan 179 isolated foreign-content boundary; source never enters the host DOM as active markup. Re-render live unsaved SVG with revision guards and hold the previous subject until its replacement can paint.

## Steps

- [ ] Add failing zoom geometry tests and `image-svg-preview` using small/large raster images and SVG fixtures.
- [ ] Implement source-linked current/side media preview placement with view-owned zoom/pan and intrinsic-size loading.
- [ ] Implement five image commands, dimension/resize handling, SVG live-buffer decoding and URL disposal.
- [ ] Add hostile SVG fixtures for scripts, event attributes, external resources and foreignObject; prove the chosen rendering boundary.
- [ ] Register seven actions, presets and any settings; add pending/error states, shortcut tooltips and scenario selectors.

## Acceptance

Focused geometry tests verify fit never upscales, zoom clamps, actual-size/reset equality and pan reset across resize. Browser tests prove hostile SVG cannot execute host code or make forbidden resource requests. `agent:browser scenario image-svg-preview` checks raster zoom/fit and both SVG placements with unsaved edits; inspect screenshot dimensions and read `look` evidence. Run `bun run gates` and the required typecheck. Heavy checks use `bash /work/tmp/wave-heavy/run.sh "<label>" -- env PATH="$PATH" <cmd>`. Browser evidence uses fixture providers, an isolated home and explicit free ports; read screenshots back and record `/work/tmp/fregat-evidence/<run>/`. Commit by path, push, and deploy the implementation to the mesh after review; server changes require dev verification and `bun run install-release --server --restart`.

## Out of scope

Image editing, animation playback controls, export and a new SVG editor are outside this plan. Chat attachment UX and tabular preview are separate owners.
