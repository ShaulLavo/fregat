# Transparent sticky tree clipping

The file row beneath a pinned folder painted into the folder's label. At scrollTop 829, `state` spans y209–229 and `ui-state.tsx` spans y220–240: 9px of the file row lies behind the header. The header uses a transparent background and the virtualized content had no clip, so both labels were visible. Normal row spacing remains 20px.

The tree now clips virtualized content at the sticky stack's bottom, retaining the visible remainder of a partially covered row. Boundary scrolling reproduced the same problem between two sticky folders: a departing child moves above its allocated slot. That child is now clipped to its slot as well. The fix preserves wallpaper, scrolling coordinates and keyboard behavior.

Evidence:

- Original product reproduction: `/work/tmp/fregat-evidence/20260914T151508Z-scenario-editor-product/` (`inspection.json`, `02-editor.png`).
- Boundary reproduction: `/work/tmp/fregat-evidence/20260914T151901Z-scenario-tree-sticky-scroll/07-scroll-6.png`; `editor` and `state` overlap by 19px.
- Fixed scrolling, including the same boundary: `/work/tmp/fregat-evidence/20260914T152351Z-scenario-tree-sticky-scroll/`. Each screenshot has a JSON sibling recording row bounds and clipping.

The screenshots were inspected. Two existing browser tests cover sticky menu anchoring and scroll/focus/rename behavior; both pass. Tree typecheck and web typecheck pass. The development server has an unrelated inherited LD_PRELOAD configuration that prints warnings in its terminals; that output is retained in the screenshots. The final scroll run has no warn/error server logs and one startup WebSocket-close warning.

The verification CLI accepts a scenario inspection function and records it with each step. `tree-sticky-scroll` exercises partial rows, folder boundaries, and reverse scrolling. Its wallpaper override now preserves the browser's Origin header when fetching settings, so the same recipe works against the separate development API origin.
