# Split-view review fixes — 2026-09-19

Drop previews now run the same placement calculation as a completed drop. Unchanged center and strip placements have no overlay or insertion marker. An edge move that would recreate the same tab arrangement, sizes, selection, and active group also preserves the existing layout identities.

Pointer collision detection resolves the containing tab strip before considering tabs, so clipped tabs cannot capture a drop in another pane. Preview coordinates come from the collision detector's actual pointer position, without adding dnd-kit's scroll adjustment.

Ordinary navigation preserves each group's tab order. Breadcrumbs subscribe to the selected tab's editor controller. History presentation resets at the tab boundary when a destination reuses an existing history component. The same component-lifetime check exposed retained comparison widths, now also keyed to the tab.

## Verification

| Check                     | Result and evidence under `/work/tmp/fregat-evidence/`                                                                                                                                                                                                     |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unchanged destinations    | Before: `20260919T203427Z-scenario-editor-split-targets` failed because its own group center showed an overlay.                                                                                                                                            |
| Drop targets              | After: `20260919T203829Z-scenario-editor-split-targets` passed unchanged center/strip/edge, auto-scroll insertion, and clipped-neighbor checks. Screenshots inspected; no browser errors or warn-level operation logs.                                     |
| Independent tab order     | Before: `20260919T203328Z-scenario-editor-split-order`. After: `20260919T203431Z-scenario-editor-split-order` passed file open and reload; screenshots inspected. Focused navigation tests also cover switching away and back.                             |
| Independent breadcrumbs   | Before: `20260919T203451Z-scenario-editor-split-breadcrumbs`. After: `20260919T204243Z-scenario-editor-split-breadcrumbs` passed same-file and different-file cursor scopes plus TypeScript → Markdown switching; screenshots inspected.                   |
| History barrier selection | Before: `20260919T203708Z-scenario-editor-split-history-state` reproduced the selected barrier disappearing on move. After: `20260919T204038Z-scenario-editor-split-history-state` passed move and subsequent tab switches; screenshots inspected.         |
| Existing interactions     | `20260919T203916Z-scenario-editor-split-actions` passed keyboard reorder, split/move commands, scroll restore and strip insertion. `20260919T204038Z-scenario-editor-split-content` passed reference, history and comparison views. Screenshots inspected. |

The full `editor-split-drag` regression passed at `20260919T204057Z-scenario-editor-split-drag`. Its undo probe originally assumed typing a trailing space remained in the same undo entry; the core intentionally groups whitespace separately. The probe now uses one word and explicitly checks focus in the source pane before undo. No production undo behavior changed.

The drag/domain checks passed 62 tests, navigation/address checks passed 10, controller registration passed two, and history/comparison lifecycle checks passed eight. Web and scripts typechecks, scoped lint, formatting, linked-source validation and the design census passed. Existing missing-adapter, startup WebSocket, and screenshot GPU warnings remain separate from the assertions. Fixture roots and verification-owned terminal sessions are cleaned up.

## Deployment

Release `20260919T204338Z-e4ee5f1d-editor-split-fixes` is live at [the mesh deployment](https://omarchy.mesh.shaulavo.dev/platform/). The web-only deployment passed its live check with no failures, browser errors, or failed responses. `/platform/release` confirms the served release and reuse of the running server bundle.

The production `editor-split-targets` scenario passed all six checkpoints at `/work/tmp/fregat-evidence/20260919T204407Z-scenario-editor-split-targets/`. Screenshots were inspected, the fixture and isolated terminals were cleaned up, and the operation window had no warn-level logs. No-op previews, overflow clipping, and insertion after scrolling are verified in the served build.
